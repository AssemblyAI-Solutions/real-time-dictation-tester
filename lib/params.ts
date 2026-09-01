// Parameter surface for the streaming bench.
// Streaming params mirror the /v3/ws query-parameter contract; dictation params
// mirror the multipart `config` object on POST dictation.assemblyai.com/transcribe.

import type { PunctuationMode } from "./punctuation";
import { DEFAULT_GUARD_WORDS } from "./punctuation";

/** Punctuation handling. Shared by both engines, since it is a display concern. */
export interface PunctuationSettings {
  mode: PunctuationMode;
  /** Words after which a command keeps its literal sense ("the colon"). */
  guardWords: string[];
  /** Rule labels switched off. */
  disabledRules: string[];
}

export const DEFAULT_PUNCTUATION: PunctuationSettings = {
  // `assist` rather than `model`: the model converts dictated punctuation most of
  // the time, but with some voices it hears a command as an aside and leaves it
  // as words. `assist` cleans those up and cannot discard punctuation the model
  // got right, so it is the safer default.
  mode: "assist",
  guardWords: DEFAULT_GUARD_WORDS,
  disabledRules: [],
};

export type SpeechModel =
  | "universal-3-5-pro"
  | "universal-streaming-english"
  | "universal-streaming-multilingual";

export type Mode = "min_latency" | "balanced" | "max_accuracy";

export type Region = "global" | "us" | "eu";

/**
 * How committed text is derived from the wire messages. This is the crux of the
 * problem: the API's own behaviour is fixed, but what you *render* is a
 * client-side choice with very different latency characteristics.
 */
export type DeliveryMode =
  // Render only `end_of_turn: true` turns. Text appears in silent bursts at turn
  // boundaries — the usual starting point for a finals-only integration.
  | "finals"
  // Render the newest partial in full, replacing the previous render. Fast, but
  // on-screen text is rewritten as the model revises the turn.
  | "partials"
  // Word-level stability committer: a word is committed once it has appeared
  // unchanged at the same index in N consecutive partials. Word-by-word AND
  // append-only — committed text is never rewritten.
  | "stable"
  // Client drives endpointing: send ForceEndpoint on a cadence / on local
  // silence, so the server emits frequent *finals*. Finals-only, append-only,
  // at whatever granularity you choose.
  | "forced";

export const REGION_HOSTS: Record<Region, string> = {
  global: "streaming.assemblyai.com",
  us: "streaming.us.assemblyai.com",
  eu: "streaming.eu.assemblyai.com",
};

export const LANGUAGES = [
  "en", "es", "fr", "de", "it", "pt", "tr", "nl",
  "sv", "no", "da", "fi", "hi", "vi", "ar", "he", "ja", "zh",
] as const;

export interface StreamingParams {
  // --- connection ---
  region: Region;
  speech_model: SpeechModel;
  mode: Mode;
  domain: "" | "medical-v1";
  language_codes: string[];
  language_detection: boolean;
  sample_rate: number;

  // --- turn detection ---
  min_turn_silence: number | null;
  max_turn_silence: number | null;
  end_of_turn_confidence_threshold: number | null;
  vad_threshold: number | null;
  interruption_delay: number | null;

  // --- partials ---
  continuous_partials: boolean;
  include_partial_turns: boolean;
  format_turns: boolean;

  // --- accuracy context ---
  prompt: string;
  keyterms_prompt: string[];
  previous_context_n_turns: number | null;

  // --- audio cleanup ---
  voice_focus: "" | "near-field" | "far-field";
  voice_focus_threshold: number;

  // --- misc ---
  filter_profanity: boolean;
  redact_pii: boolean;
  speaker_labels: boolean;
  max_speakers: number | null;
  session_heartbeat: boolean;
  inactivity_timeout: number | null;

  // --- client-side render layer (not sent to the API) ---
  deliveryMode: DeliveryMode;
  stabilityWindow: number;
  reconcileOnFinal: boolean;
  forceEndpointMs: number;
  forceOnSilenceMs: number;
  /**
   * Whether to draw the uncommitted tail at the cursor.
   *
   * This is the only place hypothesis text reaches the screen. With it off,
   * every word displayed has already been committed and is never rewritten,
   * at the cost of showing each word later. Partials are still consumed on the
   * wire either way.
   */
  renderPreview: boolean;
  /**
   * Backdates a cursor move by this many ms.
   *
   * Allows for the gap between finishing a line and pressing the key. In testing
   * this made little difference — snapping the boundary to punctuation does the
   * real work — so it defaults to 0.
   */
  fieldSwitchLeadMs: number;
  /**
   * How many words either side of a field-change boundary to search for a
   * sentence terminator, snapping the boundary there when one is found.
   *
   * People change field at the end of a thought, so the boundary they mean is
   * nearly always a sentence break — and punctuation is part of the transcript.
   * This uses the text's own structure rather than the clock. 0 disables it.
   */
  snapToSentenceWords: number;
  /**
   * Send ForceEndpoint when the cursor moves, so the server closes the turn at
   * the true audio position of the keystroke.
   *
   * Defaults to false. A cut triggered by a keystroke usually lands mid-word, and
   * the audio either side is then transcribed without its other half, which can
   * duplicate the fragment. Snapping to punctuation avoids cutting the audio.
   */
  endpointOnFieldChange: boolean;
}

export const DEFAULT_STREAMING: StreamingParams = {
  region: "global",
  speech_model: "universal-3-5-pro",
  mode: "balanced",
  domain: "",
  language_codes: [],
  language_detection: false,
  sample_rate: 16000,

  min_turn_silence: null,
  max_turn_silence: null,
  end_of_turn_confidence_threshold: null,
  vad_threshold: null,
  interruption_delay: null,

  continuous_partials: true,
  include_partial_turns: true,
  format_turns: false,

  prompt: "",
  keyterms_prompt: [],
  previous_context_n_turns: null,

  voice_focus: "",
  voice_focus_threshold: 0.7,

  filter_profanity: false,
  redact_pii: false,
  speaker_labels: false,
  max_speakers: null,
  session_heartbeat: false,
  inactivity_timeout: null,

  deliveryMode: "stable",
  stabilityWindow: 2,
  reconcileOnFinal: false,
  forceEndpointMs: 1200,
  forceOnSilenceMs: 300,
  renderPreview: true,
  fieldSwitchLeadMs: 0,
  snapToSentenceWords: 3,
  endpointOnFieldChange: false,
};

/** Build the /v3/ws query string. Nulls and empties are omitted so the server default applies. */
export function buildStreamingQuery(p: StreamingParams, token: string): string {
  const q = new URLSearchParams();
  q.set("token", token);
  q.set("encoding", "pcm_s16le");
  q.set("sample_rate", String(p.sample_rate));
  q.set("speech_model", p.speech_model);

  const isPro = p.speech_model === "universal-3-5-pro";
  const isUS = !isPro;

  if (isPro) q.set("mode", p.mode);
  if (p.domain) q.set("domain", p.domain);
  if (p.language_codes.length) q.set("language_codes", JSON.stringify(p.language_codes));
  if (p.language_detection) q.set("language_detection", "true");

  if (p.min_turn_silence != null) q.set("min_turn_silence", String(p.min_turn_silence));
  if (p.max_turn_silence != null) q.set("max_turn_silence", String(p.max_turn_silence));
  if (isUS && p.end_of_turn_confidence_threshold != null)
    q.set("end_of_turn_confidence_threshold", String(p.end_of_turn_confidence_threshold));
  if (p.vad_threshold != null) q.set("vad_threshold", String(p.vad_threshold));
  if (isPro && p.interruption_delay != null)
    q.set("interruption_delay", String(p.interruption_delay));

  if (isPro && !p.continuous_partials) q.set("continuous_partials", "false");
  if (!p.include_partial_turns) q.set("include_partial_turns", "false");
  if (isUS && p.format_turns) q.set("format_turns", "true");

  if (isPro && p.prompt.trim()) q.set("prompt", p.prompt.trim());
  if (p.keyterms_prompt.length) q.set("keyterms_prompt", JSON.stringify(p.keyterms_prompt));
  if (isPro && p.previous_context_n_turns != null)
    q.set("previous_context_n_turns", String(p.previous_context_n_turns));

  if (p.voice_focus) {
    q.set("voice_focus", p.voice_focus);
    q.set("voice_focus_threshold", String(p.voice_focus_threshold));
  }

  if (p.filter_profanity) q.set("filter_profanity", "true");
  if (p.redact_pii) q.set("redact_pii", "true");
  if (p.speaker_labels) {
    q.set("speaker_labels", "true");
    if (p.max_speakers != null) q.set("max_speakers", String(p.max_speakers));
  }
  if (p.session_heartbeat) q.set("session_heartbeat", "true");
  if (p.inactivity_timeout != null) q.set("inactivity_timeout", String(p.inactivity_timeout));

  return q.toString();
}
