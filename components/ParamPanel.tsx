"use client";

import { SPOKEN_RULES } from "@/lib/punctuation";
import {
  LANGUAGES,
  type DictationParams,
  type PunctuationSettings,
  type DeliveryMode,
  type Mode,
  type Region,
  type SpeechModel,
  type StreamingParams,
} from "@/lib/params";
import { STREAMING_PRESETS, applyPreset } from "@/lib/presets";
import { Num, NumberField, Row, Section, Select, TagInput, TextArea, Toggle } from "./Controls";

const DELIVERY_LABELS: Record<DeliveryMode, { title: string; blurb: string }> = {
  finals: {
    title: "Finals only",
    blurb:
      "Render nothing until end_of_turn:true. The usual starting point, and the one the dead-air metric is there to expose.",
  },
  forced: {
    title: "Client-driven finals ⚠",
    blurb:
      "Send ForceEndpoint yourself, so finals arrive on your cadence rather than at the speaker's pauses. A cadence short enough to cut through words costs accuracy — force on silence instead.",
  },
  stable: {
    title: "Stable-commit partials ★",
    blurb:
      "Release a word once it has held position across N consecutive partials. Near word-by-word, and committed text is never rewritten.",
  },
  partials: {
    title: "Live partials",
    blurb:
      "Render every partial as it arrives, replacing the previous one. Fastest, but on-screen text churns.",
  },
};

export function ParamPanel({
  engine,
  onEngineChange,
  streaming,
  onStreamingChange,
  dictation,
  onDictationChange,
  punctuation,
  onPunctuationChange,
  live,
  onApplyMidStream,
  onForceEndpoint,
}: {
  engine: "streaming" | "dictation";
  onEngineChange: (e: "streaming" | "dictation") => void;
  streaming: StreamingParams;
  onStreamingChange: (p: StreamingParams) => void;
  dictation: DictationParams;
  onDictationChange: (p: DictationParams) => void;
  punctuation: PunctuationSettings;
  onPunctuationChange: (p: PunctuationSettings) => void;
  live: boolean;
  onApplyMidStream: () => void;
  onForceEndpoint: () => void;
}) {
  const s = streaming;
  const set = <K extends keyof StreamingParams>(key: K, value: StreamingParams[K]) =>
    onStreamingChange({ ...s, [key]: value });

  const punct = punctuation;
  const setPunct = <K extends keyof PunctuationSettings>(key: K, value: PunctuationSettings[K]) =>
    onPunctuationChange({ ...punct, [key]: value });

  const d = dictation;
  const setD = <K extends keyof DictationParams>(key: K, value: DictationParams[K]) =>
    onDictationChange({ ...d, [key]: value });

  const isPro = s.speech_model === "universal-3-5-pro";
  const isUS = !isPro;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Engine switch */}
      <div className="shrink-0 border-b border-ink-800 p-2">
        <div className="grid grid-cols-2 gap-1 rounded bg-ink-900 p-1">
          {(["streaming", "dictation"] as const).map((e) => (
            <button
              key={e}
              onClick={() => onEngineChange(e)}
              disabled={live}
              className={`rounded px-2 py-1.5 text-[11px] font-medium transition disabled:cursor-not-allowed ${
                engine === e
                  ? "bg-accent/20 text-ink-100 ring-1 ring-accent-dim"
                  : "text-ink-400 hover:text-ink-200"
              }`}
            >
              {e === "streaming" ? "U-3.5 Pro Streaming" : "Dictation API"}
            </button>
          ))}
        </div>
        <p className="mt-1.5 px-1 text-[10px] leading-relaxed text-ink-500">
          {engine === "streaming"
            ? "WebSocket, wss://…/v3/ws. Continuous session, turn-based results."
            : "One-shot HTTP, POST dictation.assemblyai.com/transcribe. Clips up to 120s, phrase-at-a-time by construction."}
        </p>
      </div>

      <div className="flex-1 overflow-y-auto">
        {engine === "streaming" ? (
          <>
            <Section
              title="Presets"
              hint="Each one is a different answer to “get words on screen sooner without rewriting them”."
            >
              <div className="space-y-1">
                {STREAMING_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    disabled={live}
                    onClick={() => onStreamingChange(applyPreset(s, preset))}
                    className="block w-full rounded border border-ink-700 px-2 py-1.5 text-left transition hover:border-accent-dim hover:bg-accent/5 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <span className="block text-[11px] font-medium text-ink-100">{preset.name}</span>
                    <span className="mt-0.5 block text-[10px] leading-relaxed text-ink-500">
                      {preset.blurb}
                    </span>
                  </button>
                ))}
              </div>
            </Section>

            <Section
              title="Delivery — client-side render policy"
              hint="Not API parameters. This is how the app turns wire messages into on-screen text, and it dominates perceived latency."
            >
              <div className="space-y-1">
                {(Object.keys(DELIVERY_LABELS) as DeliveryMode[]).map((m) => (
                  <button
                    key={m}
                    onClick={() => set("deliveryMode", m)}
                    className={`block w-full rounded border px-2 py-1.5 text-left transition ${
                      s.deliveryMode === m
                        ? "border-accent-dim bg-accent/10"
                        : "border-ink-700 hover:border-ink-600"
                    }`}
                  >
                    <span className="block text-[11px] font-medium text-ink-100">
                      {DELIVERY_LABELS[m].title}
                    </span>
                    <span className="mt-0.5 block text-[10px] leading-relaxed text-ink-500">
                      {DELIVERY_LABELS[m].blurb}
                    </span>
                  </button>
                ))}
              </div>

              {s.deliveryMode === "stable" && (
                <>
                  <Row
                    label="stabilityWindow"
                    hint="partials a word must survive"
                  >
                    <Num value={s.stabilityWindow} onChange={(v) => set("stabilityWindow", v)} min={1} max={5} />
                  </Row>
                  <Toggle
                    label="reconcileOnFinal"
                    hint="Replace committed words with the formatted final — better text, but it rewrites the screen."
                    value={s.reconcileOnFinal}
                    onChange={(v) => set("reconcileOnFinal", v)}
                  />
                </>
              )}

              {s.deliveryMode === "forced" && (
                <>
                  <Row label="forceEndpointMs" hint="0 = cadence off">
                    <Num value={s.forceEndpointMs} onChange={(v) => set("forceEndpointMs", v)} min={0} max={3000} step={50} />
                  </Row>
                  <Row label="forceOnSilenceMs" hint="local VAD trigger; 0 = off">
                    <Num value={s.forceOnSilenceMs} onChange={(v) => set("forceOnSilenceMs", v)} min={0} max={1500} step={25} />
                  </Row>
                  <p className="text-[10px] leading-relaxed text-warn/80">
                    Raise min/max_turn_silence below so the server doesn&apos;t endpoint underneath you,
                    and raise previous_context_n_turns so short turns keep their context. Cadences
                    under ~1s cut mid-word: the fragment gets transcribed twice and accuracy collapses.
                    Prefer forceOnSilenceMs, which cuts at word gaps.
                  </p>
                </>
              )}

              <Row label="snapToSentenceWords" hint="0 = trust the timestamp">
                <Num value={s.snapToSentenceWords} onChange={(v) => set("snapToSentenceWords", v)} min={0} max={8} />
              </Row>
              <p className="text-[10px] leading-relaxed text-ink-400">
                People change field at the end of a thought, so the boundary they mean is nearly
                always a sentence break — and punctuation is part of the transcript. When a field
                change lands within this many words of a full stop, the boundary snaps there.
              </p>

              <Row label="fieldSwitchLeadMs" hint="reaction-time compensation">
                <Num value={s.fieldSwitchLeadMs} onChange={(v) => set("fieldSwitchLeadMs", v)} min={0} max={800} step={25} />
              </Row>
              <p className="text-[10px] leading-relaxed text-warn/80">
                Backdates the switch to allow for the gap between finishing a line and pressing
                the key. In testing it made little difference — punctuation snapping does the real
                work — so it defaults to 0. Try it on your own audio before relying on it.
              </p>

              <Toggle
                label="renderPreview"
                hint="Draw the uncommitted tail at the cursor. Off = only text that will never change reaches the screen."
                value={s.renderPreview}
                onChange={(v) => set("renderPreview", v)}
              />
              {!s.renderPreview && (
                <p className="text-[10px] leading-relaxed text-good/80">
                  Nothing on screen can change: every word displayed has already been committed.
                  Words appear later than with the preview on — the gap between the two lag rows
                  in the metrics is exactly what you are trading away.
                </p>
              )}

              <Toggle
                label="endpointOnFieldChange"
                hint="Send ForceEndpoint when the cursor moves, so the server splits the audio at the keystroke."
                value={s.endpointOnFieldChange}
                onChange={(v) => set("endpointOnFieldChange", v)}
              />
              <p className="text-[10px] leading-relaxed text-warn/80">
                Off by default. A cut triggered by a keystroke usually lands mid-word, and the
                audio either side is then transcribed without its other half — which can duplicate
                the fragment. Punctuation snapping handles the boundary without cutting the audio.
              </p>

              <p className="text-[10px] leading-relaxed text-ink-500">
                Punctuation handling has its own section below — it applies to both engines.
              </p>
            </Section>

            <Section title="Turn detection">
              <Row label="min_turn_silence" hint={isPro ? "mode-dependent" : "400 ms"}>
                <NumberField value={s.min_turn_silence} onChange={(v) => set("min_turn_silence", v)} min={50} max={10000} step={10} />
              </Row>
              <Row label="max_turn_silence" hint={isPro ? "1536 ms" : "1280 ms"}>
                <NumberField value={s.max_turn_silence} onChange={(v) => set("max_turn_silence", v)} min={100} max={10000} step={50} />
              </Row>
              <Row label="vad_threshold" hint={isPro ? "0.2" : "0.4"}>
                <NumberField value={s.vad_threshold} onChange={(v) => set("vad_threshold", v)} min={0} max={1} step={0.05} />
              </Row>
              <Row label="interruption_delay" hint={isPro ? "+256 ms fixed" : "U-3.5 Pro only"}>
                <NumberField value={s.interruption_delay} onChange={(v) => set("interruption_delay", v)} min={0} max={1000} step={25} disabled={!isPro} />
              </Row>
              <Row label="end_of_turn_confidence_threshold" hint={isUS ? "0.4" : "Universal Streaming only"}>
                <NumberField value={s.end_of_turn_confidence_threshold} onChange={(v) => set("end_of_turn_confidence_threshold", v)} min={0} max={1} step={0.05} disabled={!isUS} />
              </Row>
            </Section>

            <Section
              title="Partials"
              hint="Partials arrive at three points: an early one timed by interruption_delay, one at each pause that does not end the turn, and continuous partials during long turns. That interval is the ceiling on how fine-grained stable-commit can be."
            >
              <Toggle
                label="include_partial_turns"
                hint="Off = finals only on the wire, less to ignore client-side."
                value={s.include_partial_turns}
                onChange={(v) => set("include_partial_turns", v)}
              />
              <Toggle
                label="continuous_partials"
                hint="U-3.5 Pro. Off = one early partial per turn only."
                value={s.continuous_partials}
                onChange={(v) => set("continuous_partials", v)}
                disabled={!isPro}
              />
              <Toggle
                label="format_turns"
                hint="Universal Streaming only — punctuation/casing on finals."
                value={s.format_turns}
                onChange={(v) => set("format_turns", v)}
                disabled={!isUS}
              />
            </Section>

            <Section title="Model & language">
              <Row label="speech_model">
                <Select<SpeechModel>
                  value={s.speech_model}
                  onChange={(v) => set("speech_model", v)}
                  disabled={live}
                  options={[
                    { value: "universal-3-5-pro", label: "universal-3-5-pro" },
                    { value: "universal-streaming-english", label: "universal-streaming-english" },
                    { value: "universal-streaming-multilingual", label: "universal-streaming-multilingual" },
                  ]}
                />
              </Row>
              <Row label="mode" hint={isPro ? "" : "U-3.5 Pro only"}>
                <Select<Mode>
                  value={s.mode}
                  onChange={(v) => set("mode", v)}
                  disabled={!isPro}
                  options={[
                    { value: "min_latency", label: "min_latency" },
                    { value: "balanced", label: "balanced (default)" },
                    { value: "max_accuracy", label: "max_accuracy" },
                  ]}
                />
              </Row>
              <Row label="domain">
                <Select<"" | "medical-v1">
                  value={s.domain}
                  onChange={(v) => set("domain", v)}
                  options={[
                    { value: "", label: "none" },
                    { value: "medical-v1", label: "medical-v1 (Medical Mode)" },
                  ]}
                />
              </Row>
              <Row label="region" hint="data residency">
                <Select<Region>
                  value={s.region}
                  onChange={(v) => set("region", v)}
                  disabled={live}
                  options={[
                    { value: "global", label: "global (latency-optimised)" },
                    { value: "us", label: "us (data residency)" },
                    { value: "eu", label: "eu (data residency)" },
                  ]}
                />
              </Row>
              <Row label="language_codes" hint="empty = native code-switching">
                <TagInput
                  value={s.language_codes}
                  onChange={(v) => set("language_codes", v.filter((x) => (LANGUAGES as readonly string[]).includes(x)))}
                  placeholder="en, es, de…"
                />
              </Row>
              <Toggle
                label="language_detection"
                hint="Report language_code on turns."
                value={s.language_detection}
                onChange={(v) => set("language_detection", v)}
              />
              <Row label="sample_rate">
                <Num value={s.sample_rate} onChange={(v) => set("sample_rate", v)} min={8000} max={48000} step={8000} disabled={live} />
              </Row>
            </Section>

            <Section title="Accuracy context" defaultOpen={false}>
              <Row label="prompt" hint={isPro ? "max 1750 chars" : "U-3.5 Pro only"}>
                <TextArea
                  value={s.prompt}
                  onChange={(v) => set("prompt", v)}
                  maxLength={1750}
                  rows={4}
                  disabled={!isPro}
                  placeholder="Radiologist dictating a CT abdomen/pelvis report with contrast."
                />
              </Row>
              <Row label="keyterms_prompt" hint="max 100">
                <TagInput value={s.keyterms_prompt} onChange={(v) => set("keyterms_prompt", v)} max={100} placeholder="hepatic steatosis, adenopathy…" />
              </Row>
              <Row label="previous_context_n_turns" hint="default 5; 0 disables">
                <NumberField value={s.previous_context_n_turns} onChange={(v) => set("previous_context_n_turns", v)} min={0} max={100} disabled={!isPro} />
              </Row>
            </Section>

            <Section title="Audio & session" defaultOpen={false}>
              <Row label="voice_focus">
                <Select<"" | "near-field" | "far-field">
                  value={s.voice_focus}
                  onChange={(v) => set("voice_focus", v)}
                  options={[
                    { value: "", label: "off" },
                    { value: "near-field", label: "near-field (headset/handset)" },
                    { value: "far-field", label: "far-field (room mic)" },
                  ]}
                />
              </Row>
              {s.voice_focus && (
                <Row label="voice_focus_threshold" hint="0.7 default">
                  <Num value={s.voice_focus_threshold} onChange={(v) => set("voice_focus_threshold", v)} min={0} max={1} step={0.05} />
                </Row>
              )}
              <Toggle label="session_heartbeat" hint="Heartbeat every 5s with realtime_factor." value={s.session_heartbeat} onChange={(v) => set("session_heartbeat", v)} />
              <Row label="inactivity_timeout" hint="seconds; unset = none">
                <NumberField value={s.inactivity_timeout} onChange={(v) => set("inactivity_timeout", v)} min={5} max={3600} step={5} />
              </Row>
            </Section>

            <Section title="Advanced" defaultOpen={false}>
              <Toggle label="filter_profanity" value={s.filter_profanity} onChange={(v) => set("filter_profanity", v)} />
              <Toggle label="redact_pii" hint="Finals only. Forces include_partial_turns off unless set explicitly." value={s.redact_pii} onChange={(v) => set("redact_pii", v)} />
              <Toggle label="speaker_labels" hint="Changes turn-detection defaults and disables continuous partials." value={s.speaker_labels} onChange={(v) => set("speaker_labels", v)} />
              {s.speaker_labels && (
                <Row label="max_speakers" hint="1–10">
                  <NumberField value={s.max_speakers} onChange={(v) => set("max_speakers", v)} min={1} max={10} />
                </Row>
              )}
            </Section>
          </>
        ) : (
          <>
            <Section
              title="Clip segmentation"
              hint="Dictation is one-shot HTTP, so the client decides where clips start and end. That choice, not the model, sets perceived latency — and a clip cut mid-word gets garbled, so cut in the gaps."
            >
              <Row label="chunking">
                <Select<"vad" | "cadence">
                  value={d.chunking}
                  onChange={(v) => setD("chunking", v)}
                  options={[
                    { value: "vad", label: "vad — cut on local silence" },
                    { value: "cadence", label: "cadence — cut on a fixed clock" },
                  ]}
                />
              </Row>
              {d.chunking === "vad" ? (
                <>
                  <Row label="chunkSilenceMs" hint="silence that closes a clip">
                    <Num value={d.chunkSilenceMs} onChange={(v) => setD("chunkSilenceMs", v)} min={80} max={2000} step={10} />
                  </Row>
                  {d.chunkSilenceMs > 200 && (
                    <p className="text-[10px] leading-relaxed text-warn/80">
                      Above ~200ms this only finds sentence boundaries. During unbroken speech no
                      gap qualifies, so clips run until maxClipMs and the screen sits empty until then.
                    </p>
                  )}
                </>
              ) : (
                <>
                  <Row label="cadenceMs" hint="clip length">
                    <Num value={d.cadenceMs} onChange={(v) => setD("cadenceMs", v)} min={300} max={5000} step={100} />
                  </Row>
                  <p className="text-[10px] leading-relaxed text-warn/80">
                    Cadence guarantees a rhythm but ignores where the words are, so cuts land
                    mid-word and those fragments transcribe poorly. Prefer vad.
                  </p>
                </>
              )}
              <Row label="maxClipMs" hint="backstop, not the normal path">
                <Num value={d.maxClipMs} onChange={(v) => setD("maxClipMs", v)} min={1000} max={120000} step={1000} />
              </Row>
              <Row label="minClipMs" hint="drop clips shorter than this">
                <Num value={d.minClipMs} onChange={(v) => setD("minClipMs", v)} min={100} max={2000} step={50} />
              </Row>
              <Row label="silenceRms" hint="local VAD threshold">
                <Num value={d.silenceRms} onChange={(v) => setD("silenceRms", v)} min={0.002} max={0.08} step={0.002} />
              </Row>
            </Section>

            <Section title="Transcription context">
              <Row label="language_codes">
                <TagInput value={d.language_codes} onChange={(v) => setD("language_codes", v)} placeholder="en" />
              </Row>
              <Row label="prompt" hint="max 4096 chars">
                <TextArea value={d.prompt} onChange={(v) => setD("prompt", v)} maxLength={4096} rows={5} />
              </Row>
              <Row label="word_boost">
                <TagInput value={d.word_boost} onChange={(v) => setD("word_boost", v)} placeholder="adenopathy, steatosis…" />
              </Row>
              <Toggle
                label="conversation_context"
                hint="Feed previously dictated text back as prior turns for continuity across clips."
                value={d.useConversationContext}
                onChange={(v) => setD("useConversationContext", v)}
              />
            </Section>

            <Section
              title="LLM rewrite"
              hint="Rewrites the transcript after it is written down. 5s internal deadline; on timeout you still get the verbatim text."
              defaultOpen={false}
            >
              <Toggle label="llm.instruction" value={d.llmEnabled} onChange={(v) => setD("llmEnabled", v)} />
              <TextArea
                value={d.llmInstruction}
                onChange={(v) => setD("llmInstruction", v)}
                maxLength={2048}
                rows={4}
                disabled={!d.llmEnabled}
                placeholder="Convert spoken punctuation commands into marks and remove filler words."
              />
              <p className="text-[10px] leading-relaxed text-ink-500">
                Adds a round trip per clip. Describe only the transformation — output-format and
                injection rules are enforced by the service.
              </p>
            </Section>
          </>
        )}

        {/* Applies to both engines, so it sits outside the engine branch. */}
        <Section
          title="Spoken punctuation"
          hint="Universal-3.5 Pro converts dictated punctuation itself and consumes the command words, so most applications want “model”. The other modes are for taking control back."
        >
          <Row label="mode">
            <Select<"model" | "assist" | "strip" | "spoken">
              value={punct.mode}
              onChange={(v) => setPunct("mode", v)}
              options={[
                { value: "model", label: "model — as returned, no processing" },
                { value: "assist", label: "assist — model's marks + leftovers (default)" },
                { value: "strip", label: "strip — remove all marks" },
                { value: "spoken", label: "spoken — strip, then apply commands" },
              ]}
            />
          </Row>

          {punct.mode === "model" && (
            <p className="text-[10px] leading-relaxed text-ink-400">
              Raw model output, no client-side processing. Dictated punctuation mostly arrives as
              marks already — use this to see what the model does on its own before deciding whether
              you need anything on top.
            </p>
          )}

          {punct.mode === "assist" && (
            <p className="text-[10px] leading-relaxed text-good/80">
              Keeps every mark the model produced and converts any command words it left as words —
              clearing the comma it fences them with. It cannot lose correct punctuation, so it is
              safe to leave on.
            </p>
          )}

          {(punct.mode === "spoken" || punct.mode === "assist") && (
            <>
              <div className="rounded border border-ink-700 bg-ink-950/60 p-2">
                <div className="mb-1 text-[10px] uppercase tracking-wider text-ink-500">
                  Say these
                </div>
                <div className="flex flex-wrap gap-1">
                  {SPOKEN_RULES.map((rule) => {
                    const off = punct.disabledRules.includes(rule.label);
                    return (
                      <button
                        key={rule.label}
                        onClick={() =>
                          setPunct(
                            "disabledRules",
                            off
                              ? punct.disabledRules.filter((l) => l !== rule.label)
                              : [...punct.disabledRules, rule.label],
                          )
                        }
                        title={off ? "Disabled — click to enable" : "Click to disable"}
                        className={`rounded px-1.5 py-0.5 font-mono text-[10px] transition ${
                          off
                            ? "bg-ink-800 text-ink-600 line-through"
                            : "bg-ink-750 text-ink-200 hover:bg-ink-700"
                        }`}
                      >
                        {rule.say[0]}{" "}
                        <span className="text-accent">
                          {rule.emit === "\n" ? "⏎" : rule.emit === "\n\n" ? "¶" : rule.emit}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <Row label="guardWords" hint="command keeps its literal sense after these">
                <TagInput
                  value={punct.guardWords}
                  onChange={(v) => setPunct("guardWords", v)}
                  placeholder="the, sigmoid, transverse…"
                />
              </Row>
              <p className="text-[10px] leading-relaxed text-ink-400">
                Some command words are also ordinary words — &ldquo;colon&rdquo; is a mark and an
                organ. After a guard word it stays literal, so &ldquo;the colon appears normal&rdquo;
                survives while &ldquo;impression colon&rdquo; becomes a mark. Extend the list for
                your own vocabulary.
              </p>
            </>
          )}

          {punct.mode === "spoken" && (
            <p className="text-[10px] leading-relaxed text-warn/80">
              This strips the model&apos;s punctuation first. If the model already consumed the
              command words — which it usually does — there is nothing left to convert and the text
              comes back unpunctuated. Prefer &ldquo;assist&rdquo; unless you have checked.
            </p>
          )}

          {punct.mode === "strip" && (
            <p className="text-[10px] leading-relaxed text-ink-400">
              Marks are removed and nothing is applied — the raw token stream, for applications that
              run their own punctuation logic downstream.
            </p>
          )}
        </Section>
      </div>

      {engine === "streaming" && (
        <div className="shrink-0 space-y-1 border-t border-ink-800 p-2">
          <button
            onClick={onApplyMidStream}
            disabled={!live}
            className="w-full rounded border border-ink-700 px-2 py-1.5 text-[11px] text-ink-200 transition hover:border-accent-dim hover:bg-accent/5 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Push UpdateConfiguration
          </button>
          <button
            onClick={onForceEndpoint}
            disabled={!live}
            className="w-full rounded border border-ink-700 px-2 py-1.5 text-[11px] text-ink-200 transition hover:border-accent-dim hover:bg-accent/5 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Send ForceEndpoint now
          </button>
        </div>
      )}
    </div>
  );
}
