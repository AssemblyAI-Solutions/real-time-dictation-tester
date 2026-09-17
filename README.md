# Real-Time Dictation Tester

A reference implementation for **dictating into a structured, templated report** — the shape of
application used in radiology reporting, clinical notes, and inspection forms — built on AssemblyAI.

Use it as a starting point for your own dictation UI, and as a tester for tuning the behaviour
before you commit to it. It runs on
**[Universal-3.5 Pro Streaming](https://www.assemblyai.com/docs/streaming)** — a WebSocket session
returning turn-based results in real time.

Every connection parameter the API supports is exposed in the UI, so you can try a configuration in
seconds instead of editing code.

> No real patient data is used anywhere in this project. The report template and sample header are
> synthetic, and the audio fixtures are generated locally by text-to-speech.

---

## Quickstart

```bash
echo "ASSEMBLYAI_API_KEY=<your key>" > .env.local
npm install
npm run dev          # http://localhost:3000
```

Get a key from the [AssemblyAI dashboard](https://www.assemblyai.com/dashboard). Use Chrome or Edge —
microphone capture requests a 16 kHz `AudioContext`, which those honour reliably.

Click **RECORD** and dictate. The read-aloud panel below the report has scripts to try, each aimed at
a specific behaviour. Start with preset **Finals only (baseline)**, then **No hypothesis on screen**,
and watch the Latency tab.

---

## Architecture

```
Browser                          Your server                 AssemblyAI
───────                          ───────────                 ──────────
mic → AudioWorklet → PCM16 ──┐
                             ├── GET /api/token ──────────→  mint temp token
       WebSocket ────────────┴─────────────────────────────→  /v3/ws
```

**Keep your API key server-side.** Browsers cannot set headers on a WebSocket, so mint a
[temporary token](https://www.assemblyai.com/docs/streaming/authenticate-with-a-temporary-token)
server-side and pass it as the `token` query parameter — see
[`app/api/token/route.ts`](app/api/token/route.ts).

**Audio capture** lives in [`public/pcm-worklet.js`](public/pcm-worklet.js) and
[`lib/audio.ts`](lib/audio.ts). The worklet converts Float32 to 16-bit PCM and emits ~80 ms chunks,
inside the 50–1000 ms per-message window the streaming API expects. It also computes per-chunk RMS,
which the client uses for its own voice detection.

---

## Rendering policy: the part that decides how it feels

The API's behaviour is fixed. What you *render* is your choice, and it dominates perceived latency
more than any connection parameter. Four policies are implemented in
[`hooks/useStreaming.ts`](hooks/useStreaming.ts):

**Finals only** — render nothing until `end_of_turn: true`. Simplest to implement. Because
[turn detection](https://www.assemblyai.com/docs/streaming/turn-detection) ends a turn when the
speaker pauses, someone dictating fluently without pausing can wait a long time before seeing
anything. Watch the **Dead air** metric to see how long.

**Live partials** — render every partial immediately, replacing the last. Fastest feedback. Each
`Turn` message re-transcribes the whole turn, so text on screen is revised as the model refines it.
Watch **Screen churn** to see how much.

**Stable-commit partials** — the recommended default. Consume partials, but release a word only once
it has held the same position across N consecutive partials. You get near word-by-word output that is
append-only: committed text is never rewritten.

```ts
// lib/metrics.ts — the whole idea in one function
export function commonPrefixLength(candidates: string[][]): number { /* … */ }

// hooks/useStreaming.ts, per partial:
turn.partialHistory.push(words);
const window = turn.partialHistory.slice(-p.stabilityWindow);
const stable = window.length >= p.stabilityWindow ? commonPrefixLength(window) : 0;
const count = Math.max(turn.committed.length, Math.min(stable, words.length));
turn.committed = words.slice(0, count);   // released
const preview = words.slice(count);       // still revisable
```

`stabilityWindow` is the dial: higher releases later and more conservatively.

**Client-driven finals** — send [`ForceEndpoint`](https://www.assemblyai.com/docs/streaming/turn-detection#bring-your-own-turn-detection)
to close a turn yourself. Useful when you run your own turn detection. Force a boundary during a
pause rather than mid-word — cutting through a word means the audio either side is transcribed
without its other half, which costs accuracy and can duplicate the fragment.

### If nothing on screen may change

Some applications cannot show text that might be revised. Stable-commit draws two things: committed
words, which are append-only, and a preview at the cursor, which is the uncommitted tail and does
change.

Set **`renderPreview: false`** (preset **No hypothesis on screen**) and only committed words are
drawn. Screen churn goes to zero, at the cost of each word appearing slightly later. The two lag rows
on the Latency tab show exactly what you are trading:

- **Visible lag** — spoken → on screen
- **Commit lag** — spoken → final, i.e. safe from revision

Partials are still read from the socket; nothing that can change reaches the screen. If your
requirement is not to *process* partial messages at all, set `include_partial_turns=false` — you then
fall back to finals-only latency, which the Dead air metric will show you.

---

## Routing text to the right field

Getting text into the field the speaker meant is a separate problem from latency, and easy to get
wrong. Three rules, all implemented in [`hooks/useStreaming.ts`](hooks/useStreaming.ts):

### 1. Route by when a word was spoken, not when it arrived

The naive approach appends each transcript to whatever field is focused when it *arrives*. Transcripts
arrive after the audio, so by then the speaker may have moved on, and every phrase lands one field
late.

Instead, keep a timeline of cursor moves stamped against the audio clock, and place each word
according to where the cursor was when that word was spoken:

```ts
// Cursor moved — record it against the audio clock, not wall clock.
noteFieldChange(fieldId);   // pushes { audioMs, fieldId }
```

Two details matter. Stamp the timeline against **audio time, which starts at the microphone** — audio
buffered before the socket opened is flushed on connect, so it is part of the timeline. And notify
**synchronously in the same event as the keystroke**; a notification deferred to an effect can be a
frame late, which is long enough for audio to be attributed to the previous field.

The `route by capture time` toggle in the toolbar switches between the two so you can see the
difference on your own audio.

### 2. Prefer punctuation over timestamps for the boundary

People change field at the end of a thought, so the boundary they mean is nearly always a sentence
break — and punctuation is part of the transcript. When a field change lands within
`snapToSentenceWords` (default 3) of a full stop, snap the boundary there:

```ts
function snapBoundary(words, raw, snapWords) { /* nearest SENTENCE_END within window */ }
```

Stop the search one word short of the end. A terminator on the last word received is where the
transcript currently *stops*, not a break between two fields; snapping there sweeps the whole turn
into the field being left.

This only helps when the speaker actually produces a sentence break. Run-on speech comes back
comma-separated, with nothing to snap to.

### 3. Freeze a boundary before you emit words under it

Snapping recomputes as more words arrive, but emission is irreversible. If a boundary moves after
words were placed under it, the fields end up interleaved — later audio in an earlier field.

- Resolve each boundary once, then **freeze** it for that turn.
- **Hold back** any word whose field could still change, until there is enough lookahead to resolve
  the boundary near it.
- On the final message, resolve everything with whatever lookahead exists — no more context is
  coming, and deferring there strands the held-back words.

### Practical guidance

Field boundaries land most reliably when the speaker **pauses briefly at the switch** — a pause is a
natural turn boundary. Verify against your own audio with `npm run bench:report`.

---

## Telling the model which section the cursor is in

Routing decides *where text lands*. This decides *what the words are*.

Some terms are homophones belonging to different sections of the same report. Nothing in the audio
separates them:

| Sounds like | In this section | Means |
|---|---|---|
| `ileum` / `ilium` | Abdomen / Pelvis | small bowel / hip bone |
| `steatosis` / `stenosis` | Liver / Vascular | fatty change / narrowing |
| `peroneal` / `perineal` | Knee / Pelvis | nerve / region |

The cursor is the only signal that can resolve them, and
[`UpdateConfiguration`](https://www.assemblyai.com/docs/streaming/updating-configuration-mid-stream)
is how it reaches the model. On every cursor move, [`hooks/useStreaming.ts`](hooks/useStreaming.ts)
sends that section's `prompt` and `keyterms_prompt` on the open socket — no reconnect:

```ts
// noteFieldChange(), on every cursor move
const context = sectionContextFor(fieldId);   // lib/report.ts
socket.send(JSON.stringify({
  type: "UpdateConfiguration",
  prompt: context.prompt,          // "…dictating the ABDOMEN subsection of FINDINGS: the liver, …"
  keyterms_prompt: context.keyterms, // ["hepatic steatosis", "ileum", "terminal ileum", …]
}));
```

Prompts are **composed from the template**, not hand-written per field. `sectionContextFor` walks up
to the parent header so an indented field carries its section, so adding a row to `REPORT_TEMPLATE`
gives it a prompt for free. Add `hint` and `keyterms` to a field to sharpen it.

`prompt` carries *context about the audio* — the study, the section, what gets dictated there. It is
not an instruction channel: formatting and punctuation directives are
[not supported](https://www.assemblyai.com/docs/streaming/prompting-and-keyterms) and are ignored.

### What it is worth

`npm run bench:sections` dictates eight sections containing the pairs above, where only the cursor
says which spelling is right. Four arms over the same audio, 4 runs each — 24 ambiguous terms:

| | no prompt | one static report-level prompt | per-section context | per-section + `ForceEndpoint` |
|---|---|---|---|---|
| **Pauses at each switch** | 67% | 67% | 88% | **96%** |
| **Read straight through** | 67% | 67% | 67% | **83%** |

Three things to take from that:

**A whole-report prompt is worth nothing here.** `static` never beats the baseline. It describes the
report, which is true everywhere and therefore discriminates nowhere. Only context that *changes with
the cursor* moves the number.

**An update that lands mid-turn does not reach the words already in that turn.** Reading straight
through, per-section context on its own scores exactly the baseline — the updates are sent (7 per
run, confirmed on the wire) and change nothing, because the turn carrying the word was already open
under the old context.

**So pair it with `endpointOnFieldChange` if your readers run sections together.** Closing the turn
at the keystroke finalises the previous section under the context that was right for it and opens the
next one clean. That is the whole gap between 67% and 83% on continuous speech. Order matters:
`ForceEndpoint` first, *then* `UpdateConfiguration`.

Both are toggles in the parameter panel (`sectionContext`, `endpointOnFieldChange`), and each switch
is visible in the Wire log.

> Measured on synthetic speech with n=4 runs per arm; streaming varies between runs, so treat the
> percentages as direction and margin, not precision. Point the fixture at recordings of your own
> readers before tuning against it.

---

## Spoken punctuation

Dictation users expect to say the marks: *"the lungs are clear comma the heart is normal period"*.
On Universal-3.5 Pro this works out of the box for every sentence — the model converts the commands
and consumes the command words. Verified against the model with no client-side processing:

| Dictated | Returned |
|---|---|
| `... clear comma ... size period` | `... clear, ... size.` |
| `Impression colon normal period` | `Impression: normal.` |
| `open paren left lobe close paren` | `(left lobe)` |
| `four hyphen five millimeters` | `4-5 mm` |
| `five slash ten milligrams` | `5/10 mg` |
| `... semicolon ...` / `question mark` | `;` / `?` |
| `new line` / `new paragraph` | **not rendered as a break** |

It also disambiguates "colon" the mark from "colon" the organ, returning
`"Findings: the colon appears normal. The sigmoid colon is unremarkable."`

That is with a clear synthetic voice. With real speakers the conversion is less certain: the model
sometimes hears a command as an aside and returns it as words, fenced with commas —
`"Biopsy, open paren, left lobe, close paren, was negative, period."` It is an inference, not a
lookup, so expect it to hold most of the time rather than always.

**`assist` mode is therefore the default.** It keeps every mark the model produced and converts only
the commands it left as words, clearing the comma it fenced them with. It cannot discard correct
punctuation, so leaving it on costs nothing:

```
model   "Biopsy, open paren, left lobe, close paren, was negative, period. ... Is that correct?"
assist  "Biopsy (left lobe) was negative. ... Is that correct?"
```

Layout commands are a separate gap — "new line" and "new paragraph" are not rendered as breaks by
either mode, so handle those in your own UI.

### When you want control back

[`lib/punctuation.ts`](lib/punctuation.ts) implements a client-side layer for the cases where the
model's output is not what you want — a different speech model, an unusual command phrasing that
survives as literal text, or a downstream system expecting bare tokens.

| Mode | Behaviour |
|---|---|
| `model` | Raw model output, no client-side processing. Use it to see what the model does on its own. |
| `assist` | **Default.** Keeps the model's punctuation and converts any command words left as literal text, clearing the comma the model fences them with. Cannot lose correct punctuation. |
| `strip` | Removes all marks — the raw token stream. |
| `spoken` | Strips the model's marks, then applies the commands itself. Only useful if you have verified the command words survive; on U-3.5 Pro they usually do not. |

The command table is data, so you can extend it without touching the matching logic:

```ts
{ say: ["period", "full stop"], emit: ".", spacing: "attach", capitalisesNext: true, label: "period" }
```

Three details that matter if you implement this yourself:

- **A dictated mark supersedes the model's.** When the model fences a literal command with commas,
  those commas have to go or you get `"Biopsy, (left lobe,)"`. Only where genuinely superseded
  though: an attaching mark replaces whatever preceded it, an opening bracket clears a comma but not
  a sentence end, and a line break keeps the full stop before it.

- **Guard words.** A command word can also be an ordinary word. After a guard word ("the",
  "sigmoid", "transverse", …) it stays literal, so "the colon appears normal" survives while
  "impression colon" becomes a mark. The list is editable in the UI.
- **Text arrives in runs.** A command can be separated from the word that guards it — "sigmoid" in
  one run, "colon" in the next — so conversion needs the preceding word passed in. Joining also has
  to handle spacing and capitalisation, since a mark can arrive in a run of its own. That is what
  `appendDictated` does.

`npm run test:punctuation` covers all of this and needs no API key.

## Reading the metrics

| Metric | What it tells you |
|---|---|
| **Dead air** | Worst gap between consecutive on-screen updates. How long the screen can sit still. |
| **Screen churn** | Share of rendered words that later changed. Zero means nothing was rewritten. |
| **Visible lag** | Spoken → on screen. |
| **Commit lag** | Spoken → final. The gap to visible lag is the window in which text could still change. |
| **TTFT** | `SpeechStarted` → first text for that turn. |

Both lags are measured against the audio timeline: a word's `end` timestamp subtracted from the
wall-clock moment it was rendered, so they include network, model, and render policy.

The **Wire log** tab shows every frame in both directions, so any behaviour can be checked against
the actual messages.

---

## Verifying your own integration

```bash
npm run fixtures        # build audio fixtures (macOS, uses `say`)
npm run bench:fields    # field routing across delivery modes
npm run bench:report    # a full eleven-field report, pausing vs reading straight through
npm run bench:sections  # does per-section context change the words? (needs ASSEMBLYAI_API_KEY)
npm run bench:latency   # streaming turn cadence and partial timing
npm run test:punctuation # punctuation layer unit tests (no API key needed)
```

The `bench:` scripts drive the real UI in Chrome with a WAV standing in for the microphone, press the
field-switch key at known points in the audio, and assert where each phrase landed. They need the dev
server running and exit non-zero on regression, so they work as a gate in CI.

They separate **boundary correctness** (routing) from **word-perfect text**, so a mishearing
mid-phrase does not register as a routing failure. `FOCUS=<substring>` runs a single configuration and
`REPEAT=<n>` repeats it — some configurations vary between runs, so repeat before drawing conclusions.

Point the fixtures at recordings of your own users and the numbers become meaningful for your domain.
Fixture generation uses macOS `say`; the benchmarks run anywhere Chrome does.

---

## Presets

Each preset is a complete configuration, not a recommendation — switch between them mid-session and
compare. **No hypothesis on screen** is the one to start from if committed text must never change;
**Finals only (baseline)** is the simplest possible integration and a useful control.

---

## Styling

The interface uses AssemblyAI's palette and type scale, defined as tokens at the top of
[`app/globals.css`](app/globals.css) — cobolt accent, warm off-white ground, and the display and
body font stacks. Restyle by editing those tokens; nothing else hard-codes a colour.

The brand fonts (`Oceanic Text`, `UN 11ST`) are referenced by stack rather than bundled, so they
render for anyone who has them and fall back to Georgia and the system sans otherwise.

Report fields carry `data-field` and `data-field-label` attributes. The benchmarks read those rather
than CSS classes, so restyling cannot quietly break them into reporting zero.

## Adapting this to your app

- **Your template** — edit `REPORT_TEMPLATE` in [`lib/report.ts`](lib/report.ts). Field ids flow
  through routing untouched. Give a field a `hint` and `keyterms` and its section prompt is composed
  for you; nothing else needs editing.
- **Your field navigation** — `selectField()` in [`app/page.tsx`](app/page.tsx) is the single entry
  point for moving the cursor. Wire a foot pedal, mouse, or spoken command to it and routing follows.
- **Your defaults** — `DEFAULT_STREAMING` and `DEFAULT_DICTATION` in
  [`lib/params.ts`](lib/params.ts).
- **Spoken commands** — `detectCommand()` in [`lib/report.ts`](lib/report.ts) parses navigation
  phrases out of committed text. Off by default, since most applications handle navigation
  themselves.

`⌥↑` / `⌥↓` moves between fields while recording, standing in for a foot pedal.

---

## Project layout

```
app/api/token/route.ts          mints a temporary streaming token
lib/params.ts                   parameter surface + /v3/ws query builder
lib/presets.ts                  complete configurations worth comparing
lib/metrics.ts                  stability committer + latency maths
lib/punctuation.ts              spoken punctuation modes, guard words, joining
lib/report.ts                   report template, per-section context, spoken navigation
lib/audio.ts                    mic capture, PCM16, WAV wrapping
public/pcm-worklet.js           AudioWorklet: Float32 -> PCM16 + RMS
hooks/useStreaming.ts           WebSocket session, delivery modes, field routing
scripts/probe.mjs               streaming turn-cadence probe
scripts/field-routing-test.mjs  drives the real UI and asserts field routing
scripts/report-routing-test.mjs full-report routing
scripts/section-context-test.mjs per-section prompting, four arms over the same audio
scripts/make-fixtures.sh        builds the audio fixtures
scripts/make-section-fixtures.sh builds the homophone fixture for bench:sections
scripts/punctuation-test.mts    punctuation unit tests
```

## Dependencies

`eslint` is held at 9.x and `typescript` at 5.x: `eslint-config-next@16.3.2` bundles an
`eslint-plugin-react` that calls the `context.getFilename()` API removed in ESLint 10, and
`@typescript-eslint@8.68` declares `typescript: ">=4.8.4 <6.1.0"`. Everything else is current.

## License

MIT — see [LICENSE](LICENSE).
