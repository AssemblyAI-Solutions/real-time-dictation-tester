// Does telling the model which report section the cursor is in actually change
// the transcript? Three arms over the same audio:
//
//   none      no prompt at all                                  (control)
//   static    one whole-report prompt set at connect            (what you get without cursor tracking)
//   section   per-section prompt + keyterms, swapped mid-stream (UpdateConfiguration on cursor move)
//
// The fixture is built from pairs that sound identical and are spelled
// differently depending on the section — ileum/ilium, steatosis/stenosis,
// peroneal/perineal. Nothing in the audio separates them, so any difference
// between the arms is the context doing the work.
//
//   ASSEMBLYAI_API_KEY=... node scripts/section-context-test.mjs
//   FIXTURE=sections-nonstop REPEAT=3 node scripts/section-context-test.mjs

const KEY = process.env.ASSEMBLYAI_API_KEY;
if (!KEY) {
  console.error(
    "Set ASSEMBLYAI_API_KEY. Example:\n  ASSEMBLYAI_API_KEY=$(grep -h ASSEMBLYAI .env.local | cut -d= -f2) \\\n    node scripts/section-context-test.mjs",
  );
  process.exit(1);
}

const fs = await import("node:fs");

const DIR = process.env.FIXTURES ?? "fixtures";
const FIXTURE = process.env.FIXTURE ?? "sections-paused";
const REPEAT = Number(process.env.REPEAT ?? 1);
const ARMS = (process.env.ARMS ?? "none,static,section").split(",");
const RATE = 16000;
const CHUNK_MS = 80;

/** The whole-report prompt: everything you can say without knowing the cursor. */
const STATIC_PROMPT =
  "Radiology report dictation by a radiologist filling in a structured CT report of the abdomen and pelvis, covering examination details, comparison with prior studies, findings by organ, and the impression.";

/**
 * Per-section context. `prompt` describes what is being dictated *at the cursor*;
 * `keyterms` pins the exact spellings that section owns.
 *
 * `expect` is the spelling that is correct in this section, and `confusable` the
 * one that is correct in some *other* section. Both are real words, so this
 * measures disambiguation rather than raw recognition.
 */
const SECTIONS = [
  {
    id: "examination",
    label: "EXAMINATION",
    prompt:
      "The radiologist is dictating the EXAMINATION field of a radiology report: the modality, the body region imaged, and the contrast protocol.",
    keyterms: ["CT", "intravenous contrast"],
    expect: ["abdomen", "pelvis"],
    confusable: [],
  },
  {
    id: "comparison",
    label: "COMPARISON",
    prompt:
      "The radiologist is dictating the COMPARISON field of a radiology report: a reference to a prior imaging study and its date.",
    keyterms: ["prior study"],
    expect: ["prior"],
    confusable: [],
  },
  {
    id: "findings_liver",
    label: "FINDINGS > LIVER",
    prompt:
      "The radiologist is dictating the LIVER subsection of the FINDINGS section of a radiology report: hepatic parenchyma, fatty change, focal lesions, and the biliary ducts.",
    keyterms: ["steatosis", "hepatic", "focal lesion"],
    expect: ["steatosis"],
    confusable: ["stenosis"],
  },
  {
    id: "findings_vascular",
    label: "FINDINGS > VASCULAR",
    prompt:
      "The radiologist is dictating the VASCULAR subsection of the FINDINGS section of a radiology report: arteries, narrowing of vessels, calcification, and aneurysm.",
    keyterms: ["stenosis", "celiac axis"],
    expect: ["stenosis"],
    confusable: ["steatosis"],
  },
  {
    id: "findings_bowel",
    label: "FINDINGS > BOWEL",
    prompt:
      "The radiologist is dictating the BOWEL subsection of the FINDINGS section of a radiology report: the small intestine, the terminal ileum, bowel wall thickening, and obstruction.",
    keyterms: ["ileum", "terminal ileum"],
    expect: ["ileum"],
    confusable: ["ilium"],
  },
  {
    id: "findings_bones",
    label: "FINDINGS > BONES",
    prompt:
      "The radiologist is dictating the OSSEOUS subsection of the FINDINGS section of a radiology report: the pelvic bones, the ilium, lytic and sclerotic lesions, and fractures.",
    keyterms: ["ilium", "lytic lesion"],
    expect: ["ilium"],
    confusable: ["ileum"],
  },
  {
    id: "findings_knee",
    label: "FINDINGS > KNEE",
    prompt:
      "The radiologist is dictating the KNEE subsection of the FINDINGS section of a radiology report: the menisci, cruciate ligaments, and the common peroneal nerve.",
    keyterms: ["peroneal nerve"],
    expect: ["peroneal"],
    confusable: ["perineal"],
  },
  {
    id: "impression",
    label: "IMPRESSION",
    prompt:
      "The radiologist is dictating the IMPRESSION section of a radiology report: the concise summary diagnosis, naming hepatic steatosis and a lesion of the ilium.",
    keyterms: ["hepatic steatosis", "ilium"],
    expect: ["steatosis", "ilium"],
    confusable: ["stenosis", "ileum"],
  },
];

const marks = JSON.parse(fs.readFileSync(`${DIR}/${FIXTURE}.json`));
const wav = fs.readFileSync(`${DIR}/${FIXTURE}.wav`);
const pcm = wav.subarray(44);
const bytesPerChunk = (RATE * 2 * CHUNK_MS) / 1000;

const norm = (t) => t.toLowerCase().replace(/[.,;:!?()]/g, "");

async function mintToken() {
  const r = await fetch("https://streaming.assemblyai.com/v3/token?expires_in_seconds=300", {
    headers: { Authorization: KEY },
  });
  if (!r.ok) throw new Error(`token ${r.status}: ${await r.text()}`);
  return (await r.json()).token;
}

/**
 * Streams the fixture once and returns the finalised words with their audio
 * timings, so each word can be attributed to the section that was open when it
 * was spoken rather than when it arrived.
 */
async function runArm(arm) {
  const token = await mintToken();
  const q = new URLSearchParams({
    token,
    encoding: "pcm_s16le",
    sample_rate: String(RATE),
    speech_model: "universal-3-5-pro",
    mode: "balanced",
  });
  if (arm === "static") q.set("prompt", STATIC_PROMPT);
  if (arm.startsWith("section")) {
    // Open in the first section's context, as the app would: the cursor is
    // already somewhere when recording starts.
    q.set("prompt", SECTIONS[0].prompt);
    q.set("keyterms_prompt", JSON.stringify(SECTIONS[0].keyterms));
  }

  const ws = new WebSocket(`wss://streaming.assemblyai.com/v3/ws?${q}`);
  const words = [];
  const updates = [];
  let error = null;

  const done = new Promise((resolve) => {
    ws.addEventListener("close", resolve);
    ws.addEventListener("error", (e) => {
      error = e.message ?? "socket error";
      resolve();
    });
  });

  ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    if (m.type === "Turn" && m.end_of_turn) {
      for (const w of m.words ?? []) words.push({ text: w.text, start: w.start, end: w.end });
    }
  });

  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve);
    ws.addEventListener("error", reject);
    setTimeout(() => reject(new Error("connect timeout")), 15000);
  });

  // Pace the audio in real time. `sentMs` is the position in the fixture that has
  // been handed to the socket, which is the clock the cursor moves against.
  let nextSection = 1;
  for (let off = 0; off < pcm.length; off += bytesPerChunk) {
    if (ws.readyState !== 1) break;
    ws.send(pcm.subarray(off, off + bytesPerChunk));
    const sentMs = (off / 2 / RATE) * 1000;

    while (nextSection < SECTIONS.length && sentMs >= marks[nextSection].switchAtMs) {
      const s = SECTIONS[nextSection];
      if (arm.startsWith("section")) {
        // Close the open turn *before* swapping context. A turn already in flight
        // is being decoded under the old prompt, so an update that lands mid-turn
        // does not reach the words still inside it. ForceEndpoint finalises what
        // was spoken in the previous section under the context that was correct
        // for it, and starts the next turn clean under the new one.
        if (arm === "section+endpoint") ws.send(JSON.stringify({ type: "ForceEndpoint" }));
        ws.send(
          JSON.stringify({
            type: "UpdateConfiguration",
            prompt: s.prompt,
            keyterms_prompt: s.keyterms,
          }),
        );
        updates.push({ atMs: Math.round(sentMs), section: s.id });
      }
      nextSection++;
    }
    await new Promise((r) => setTimeout(r, CHUNK_MS));
  }

  // Let the tail finalise before terminating, or the last section comes back empty.
  await new Promise((r) => setTimeout(r, 3000));
  if (ws.readyState === 1) ws.send(JSON.stringify({ type: "Terminate" }));
  await done;
  if (error) throw new Error(error);
  return { words, updates };
}

/** Attributes each word to a section by when it was spoken. */
function bySection(words) {
  const out = SECTIONS.map(() => []);
  for (const w of words) {
    if (typeof w.start !== "number") continue;
    let idx = 0;
    for (let i = 0; i < marks.length; i++) if (w.start >= marks[i].startMs) idx = i;
    if (idx < out.length) out[idx].push(w.text);
  }
  return out.map((ws) => ws.join(" "));
}

/**
 * Every member of an ambiguous pair, and the ground-truth order they occur in.
 *
 * Scoring on this sequence rather than per section is deliberate. A turn can span
 * a section boundary, so a word's bucket depends on where the turn split — which
 * is a *routing* question, measured by `bench:report`. What is under test here is
 * only which spelling the model chose, so the score has to be immune to the
 * boundary landing a word either side.
 */
const PAIR_WORDS = [...new Set(SECTIONS.flatMap((s) => [...s.expect, ...s.confusable]))].filter(
  (w) => SECTIONS.some((s) => s.confusable.includes(w)),
);
const TRUTH = SECTIONS.flatMap((s) => s.expect.filter((w) => PAIR_WORDS.includes(w)));

function score(fullText) {
  const tokens = norm(fullText).split(/\s+/).filter(Boolean);
  const seen = tokens.filter((t) => PAIR_WORDS.includes(t));
  let hits = 0;
  const marksOut = [];
  for (let i = 0; i < TRUTH.length; i++) {
    const ok = seen[i] === TRUTH[i];
    if (ok) hits++;
    marksOut.push({ want: TRUTH[i], got: seen[i] ?? "—", ok });
  }
  return { hits, total: TRUTH.length, marks: marksOut, extra: Math.max(0, seen.length - TRUTH.length) };
}

console.log(`fixture: ${FIXTURE}.wav · ${SECTIONS.length} sections · ${REPEAT} run(s) per arm`);

console.log(`ambiguous terms under test: ${TRUTH.join(", ")}\n`);

const totals = {};
for (const arm of ARMS) totals[arm] = { hits: 0, total: 0, runs: 0 };

for (let run = 0; run < REPEAT; run++) {
  for (const arm of ARMS) {
    let result;
    try {
      result = await runArm(arm);
    } catch (e) {
      console.log(`\n[${arm}] run ${run + 1} failed: ${e.message}`);
      continue;
    }
    const texts = bySection(result.words);
    const full = result.words.map((w) => w.text).join(" ");
    const { hits, total, marks: got } = score(full);
    totals[arm].hits += hits;
    totals[arm].total += total;
    totals[arm].runs++;

    console.log(
      `\n===== arm=${arm} run=${run + 1} =====  ${hits}/${total} ambiguous terms correct` +
        (result.updates.length ? ` · ${result.updates.length} mid-stream updates` : ""),
    );
    for (let i = 0; i < SECTIONS.length; i++) {
      console.log(`       ${SECTIONS[i].label.padEnd(20)} "${texts[i] ?? ""}"`);
    }
    console.log(
      `  terms: ${got
        .map((m) => (m.ok ? `${m.got}` : `${m.got}	(want ${m.want})`))
        .join(" · ")}`,
    );
  }
}

console.log(`\n===== summary over ${REPEAT} run(s) · fixture ${FIXTURE} =====`);
for (const arm of ARMS) {
  const t = totals[arm];
  if (!t.total) continue;
  const pct = ((t.hits / t.total) * 100).toFixed(0);
  console.log(
    `  ${arm.padEnd(8)} ${String(t.hits).padStart(3)}/${t.total} ambiguous terms correct (${pct}%)  over ${t.runs} run(s)`,
  );
}
