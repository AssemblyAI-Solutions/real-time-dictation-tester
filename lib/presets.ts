import { DEFAULT_STREAMING, type StreamingParams } from "./params";

export interface Preset {
  id: string;
  name: string;
  blurb: string;
  patch: Partial<StreamingParams>;
}

/**
 * Each preset is one hypothesis about how to get text on screen faster while
 * keeping the "finals only, never rewritten" property a clinical record needs.
 */
export const STREAMING_PRESETS: Preset[] = [
  {
    id: "today",
    name: "Finals only (baseline)",
    blurb:
      "Finals only, server defaults. The baseline — text lands in silent bursts at turn boundaries. Watch the dead-air metric.",
    patch: {
      deliveryMode: "finals",
      mode: "balanced",
      include_partial_turns: false,
      min_turn_silence: null,
      max_turn_silence: null,
      interruption_delay: null,
      continuous_partials: true,
      previous_context_n_turns: null,
    },
  },
  {
    id: "aggressive",
    name: "Aggressive endpointing",
    blurb:
      "Finals only, with turn detection tuned to end turns as early as it can. Turn detection responds to silence, so continuous speech without pauses may still produce long turns — compare the dead-air metric against the baseline on your own audio.",
    patch: {
      deliveryMode: "finals",
      mode: "min_latency",
      include_partial_turns: false,
      min_turn_silence: 50,
      max_turn_silence: 300,
      interruption_delay: 0,
      previous_context_n_turns: 10,
    },
  },
  {
    id: "forced",
    name: "Client-driven finals ⚠",
    blurb:
      "ForceEndpoint on a fixed cadence, so finals arrive when you ask rather than when the speaker pauses. A cadence short enough to cut through words costs accuracy, since the audio either side is transcribed without its other half. Prefer forcing on silence, and keep the cadence generous.",
    patch: {
      deliveryMode: "forced",
      mode: "min_latency",
      include_partial_turns: false,
      forceEndpointMs: 600,
      forceOnSilenceMs: 250,
      // Keep server endpointing out of the way; the client owns turn boundaries.
      min_turn_silence: 2000,
      max_turn_silence: 8000,
      interruption_delay: 0,
      previous_context_n_turns: 10,
    },
  },
  {
    id: "stable",
    name: "Stable-commit partials ★",
    blurb:
      "Consume partials, release a word only once it has held position across N of them. Near word-by-word output that is append-only — committed text is never rewritten. The recommended starting point.",
    patch: {
      deliveryMode: "stable",
      mode: "min_latency",
      include_partial_turns: true,
      continuous_partials: true,
      stabilityWindow: 2,
      reconcileOnFinal: false,
      interruption_delay: 0,
      min_turn_silence: null,
      max_turn_silence: null,
      previous_context_n_turns: null,
    },
  },
  {
    id: "nohypothesis",
    name: "No hypothesis on screen ★",
    blurb:
      "Stable-commit with the preview hidden. Partials are consumed on the wire, but every word that reaches the screen has already been committed and is never rewritten. Costs the gap between the two lag rows versus showing the preview.",
    patch: {
      deliveryMode: "stable",
      mode: "min_latency",
      include_partial_turns: true,
      continuous_partials: true,
      stabilityWindow: 2,
      reconcileOnFinal: false,
      renderPreview: false,
      interruption_delay: 0,
      previous_context_n_turns: null,
    },
  },
  {
    id: "partials",
    name: "Live partials (raw)",
    blurb:
      "Every partial rendered immediately, replacing the last. The fastest possible time-to-text, and the screen-churn metric shows what it costs.",
    patch: {
      deliveryMode: "partials",
      mode: "min_latency",
      include_partial_turns: true,
      continuous_partials: true,
      interruption_delay: 0,
      min_turn_silence: null,
      max_turn_silence: null,
    },
  },
  {
    id: "unpunctuated",
    name: "Client-owned punctuation",
    blurb:
      "Stable-commit with the preview hidden. Pair it with punctuation mode \"spoken\" below to drop the model's punctuation and apply the speaker's own dictated commands instead.",
    patch: {
      deliveryMode: "forced",
      mode: "min_latency",
      include_partial_turns: false,
      forceEndpointMs: 600,
      forceOnSilenceMs: 250,
      min_turn_silence: 2000,
      max_turn_silence: 8000,
      interruption_delay: 0,
      previous_context_n_turns: 10,
    },
  },
  {
    id: "accuracy",
    name: "Max accuracy",
    blurb:
      "The other end of the dial — longest turns, most context, best transcript. Useful as the accuracy ceiling to compare the fast presets against.",
    patch: {
      deliveryMode: "finals",
      mode: "max_accuracy",
      include_partial_turns: false,
      min_turn_silence: null,
      max_turn_silence: null,
      domain: "medical-v1",
      previous_context_n_turns: null,
    },
  },
];

export function applyPreset(current: StreamingParams, preset: Preset): StreamingParams {
  return { ...DEFAULT_STREAMING, ...{
    // Carry forward the things a preset shouldn't stomp on.
    region: current.region,
    speech_model: current.speech_model,
    language_codes: current.language_codes,
    prompt: current.prompt,
    keyterms_prompt: current.keyterms_prompt,
    voice_focus: current.voice_focus,
    voice_focus_threshold: current.voice_focus_threshold,
    sample_rate: current.sample_rate,
  }, ...preset.patch };
}
