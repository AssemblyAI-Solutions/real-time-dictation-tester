"use client";

import { useCallback, useRef, useState } from "react";
import { startMic, type MicSession } from "@/lib/audio";
import { useLatest } from "./useLatest";
import {
  buildStreamingQuery,
  REGION_HOSTS,
  type PunctuationSettings,
  type StreamingParams,
} from "@/lib/params";
import { convertSpokenPunctuation } from "@/lib/punctuation";
import {
  commonPrefixLength,
  EMPTY_METRICS,
  type Metrics,
  type LatencySample,
} from "@/lib/metrics";

export type Status = "idle" | "connecting" | "live" | "stopping" | "error";

/** Trailing punctuation that ends a spoken thought. */
const SENTENCE_END = /[.!?]["')\]]?$/;

/** First word index at or after `audioMs`, or null if that is past every word. */
function rawBoundaryIndex(words: WireWord[], audioMs: number): number | null {
  const i = words.findIndex((w) => typeof w.start === "number" && w.start >= audioMs);
  return i < 0 ? null : i;
}

/**
 * Moves a boundary onto the nearest sentence break within `snapWords`.
 *
 * A reader changes field at the end of a thought, so a full stop near the
 * keystroke is where they meant to switch — and punctuation is part of the
 * transcript. The search stops one word short of the end: a terminator on the
 * last word heard is where the transcript currently stops, not a break between
 * two fields.
 */
function snapBoundary(words: WireWord[], raw: number, snapWords: number): number {
  if (snapWords <= 0) return raw;
  let best = raw;
  let bestDistance = Infinity;
  const from = Math.max(1, raw - snapWords);
  const to = Math.min(words.length - 1, raw + snapWords);
  for (let j = from; j <= to; j++) {
    if (!SENTENCE_END.test(words[j - 1]?.text ?? "")) continue;
    const distance = Math.abs(j - raw);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = j;
    }
  }
  return best;
}

/** Highest word index already frozen, so boundaries never run backwards. */
function lastFrozenIndex(bounds: Map<number, number>): number {
  let max = 0;
  for (const v of bounds.values()) if (v > max) max = v;
  return max;
}

export interface LogEntry {
  id: number;
  atMs: number;
  kind: "sent" | "recv" | "info" | "error";
  label: string;
  detail?: string;
}

export interface LiveText {
  /** Text the model may still revise. It has no field yet, so it renders at the cursor. */
  preview: string;
}

export interface WireWord {
  text: string;
  start?: number;
  end?: number;
  confidence?: number;
}

interface TurnMessage {
  type: "Turn";
  turn_order: number;
  end_of_turn: boolean;
  turn_is_formatted: boolean;
  transcript: string;
  end_of_turn_confidence?: number;
  words?: WireWord[];
  speaker_label?: string;
  language_code?: string;
}

export interface UseStreamingArgs {
  params: StreamingParams;
  /** Applied to the on-screen preview only; committed runs are emitted raw. */
  punctuation: PunctuationSettings;
  /**
   * Called as words are released, once per run of consecutive words sharing a
   * destination field. Routing is per word, not per turn: a radiologist can
   * change fields several times inside one unbroken utterance, and each word
   * belongs to the field that was active when it was *spoken*.
   */
  onCommit: (text: string, fieldId: string) => void;
  /** The field active at session start, the baseline for the timeline. */
  getField: () => string;
}

let logSeq = 0;

export function useStreaming({ params, punctuation, onCommit, getField }: UseStreamingArgs) {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState<LiveText>({ preview: "" });
  const [metrics, setMetrics] = useState<Metrics>(EMPTY_METRICS);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [audioLevel, setAudioLevel] = useState(0);

  const paramsRef = useLatest(params);
  const punctuationRef = useLatest(punctuation);
  const onCommitRef = useLatest(onCommit);
  const getFieldRef = useLatest(getField);

  const socketRef = useRef<WebSocket | null>(null);
  const micRef = useRef<MicSession | null>(null);
  const t0Ref = useRef(0);
  // The level meter is cosmetic; throttling it keeps render churn out of the
  // latency measurements it sits next to.
  const levelAtRef = useRef(0);
  // Audio captured between the mic opening and the socket opening. Without this
  // the first words spoken after hitting record are silently dropped, because
  // token minting plus the WebSocket handshake takes a few hundred ms.
  const preopenRef = useRef<ArrayBuffer[]>([]);
  /**
   * Wall clock of the first captured audio frame. Word timestamps sit on the
   * audio timeline, which starts at the microphone rather than at the socket, so
   * the field timeline is stamped against this and not against t0.
   */
  const audioOriginRef = useRef(0);
  /** Reported input-pipeline latency, measured once the mic is open. */
  const inputLatencyMsRef = useRef(0);
  /** Cursor movements over the audio timeline, oldest first. */
  const timelineRef = useRef<
    { audioMs: number; fieldId: string; snapped: boolean }[]
  >([]);

  // Per-turn state for the render policy.
  const turnRef = useRef({
    order: -1,
    partialHistory: [] as string[][],
    /** The actual committed word strings, so a final never rewrites them. */
    committed: [] as string[],
    /** Wall-clock ms at which word[i] first appeared on screen. */
    firstRenderAt: [] as (number | undefined)[],
    /** Wall-clock ms at which word[i] became final. */
    firstCommitAt: [] as (number | undefined)[],
    lastRenderedWords: [] as string[],
    speechStartedAt: null as number | null,
    firstAnyRenderAt: null as number | null,
    /** How many committed words have already been routed into fields. */
    emitted: 0,
    /**
     * Timeline entry index -> word index, resolved once and then frozen.
     * Snapping looks at the words available so far, so an unfrozen boundary can
     * move as the turn grows. Emission is irreversible, so a boundary that moves
     * after words were emitted under it interleaves the fields.
     */
    bounds: new Map<number, number>(),
  });

  // Local speech tracking, used to drive ForceEndpoint and the dead-air metric.
  const vadRef = useRef({
    speaking: false,
    lastVoiceAt: 0,
    lastForceAt: 0,
    turnOpenedAt: 0,
    lastUpdateAt: 0,
  });

  const now = () => (t0Ref.current ? Date.now() - t0Ref.current : 0);
  const audioNow = () => (audioOriginRef.current ? Date.now() - audioOriginRef.current : 0);

  /** Records that the cursor moved, stamped on the audio timeline. */
  const noteFieldChange = useCallback((fieldId: string) => {
    const entries = timelineRef.current;
    if (entries.length && entries[entries.length - 1].fieldId === fieldId) return;

    // Close the turn at the keystroke before recording the move. The server cuts
    // the audio at its true position, so everything spoken so far finalises into
    // the field being left, and the next turn starts clean in the new field.
    const socket = socketRef.current;
    if (
      paramsRef.current.endpointOnFieldChange &&
      socket?.readyState === WebSocket.OPEN
    ) {
      socket.send(JSON.stringify({ type: "ForceEndpoint" }));
      setMetrics((m) => ({ ...m, forcedEndpoints: m.forcedEndpoints + 1 }));
    }

    const at = Math.max(0, audioNow() - paramsRef.current.fieldSwitchLeadMs);
    timelineRef.current = [...entries, { audioMs: at, fieldId, snapped: true }];
  }, [paramsRef]);

  const addLog = useCallback((kind: LogEntry["kind"], label: string, detail?: string) => {
    setLog((prev) => {
      const next = [...prev, { id: ++logSeq, atMs: now(), kind, label, detail }];
      return next.length > 400 ? next.slice(-400) : next;
    });
  }, []);

  const send = useCallback(
    (payload: Record<string, unknown>, label: string) => {
      const socket = socketRef.current;
      if (!socket || socket.readyState !== WebSocket.OPEN) return;
      socket.send(JSON.stringify(payload));
      addLog("sent", label, JSON.stringify(payload));
    },
    [addLog],
  );

  const resetTurn = useCallback(() => {
    turnRef.current = {
      order: -1,
      partialHistory: [],
      committed: [],
      firstRenderAt: [],
      firstCommitAt: [],
      lastRenderedWords: [],
      speechStartedAt: null,
      firstAnyRenderAt: null,
      emitted: 0,
      bounds: new Map(),
    };
  }, []);

  /** Applies the render policy to one Turn message and updates live text + metrics. */
  const handleTurn = useCallback(
    (msg: TurnMessage) => {
      const p = paramsRef.current;
      const turn = turnRef.current;
      const at = now();

      if (msg.turn_order !== turn.order) {
        turn.order = msg.turn_order;
        turn.partialHistory = [];
        turn.committed = [];
        turn.firstRenderAt = [];
        turn.firstCommitAt = [];
        turn.lastRenderedWords = [];
        turn.firstAnyRenderAt = null;
        turn.emitted = 0;
        turn.bounds = new Map();
        vadRef.current.turnOpenedAt = at;
      }

      const words = (msg.transcript ?? "").trim().split(/\s+/).filter(Boolean);

      let committedWords: string[];
      let previewWords: string[];

      if (msg.end_of_turn) {
        if (p.deliveryMode === "stable" && !p.reconcileOnFinal) {
          // Keep the words already shown exactly as they were shown, and take the
          // remainder from the final — which is more accurate and formatted.
          committedWords = [
            ...turn.committed,
            ...words.slice(Math.min(turn.committed.length, words.length)),
          ];
        } else {
          committedWords = words;
        }
        previewWords = [];
      } else {
        switch (p.deliveryMode) {
          case "finals":
          case "forced":
            // Nothing is released until the turn closes. In `forced` mode the
            // client shortens that wait by driving ForceEndpoint itself.
            committedWords = [];
            previewWords = p.include_partial_turns ? words : [];
            break;

          case "partials":
            committedWords = [];
            previewWords = words;
            break;

          case "stable": {
            turn.partialHistory.push(words);
            if (turn.partialHistory.length > 8) turn.partialHistory.shift();
            const window = turn.partialHistory.slice(-p.stabilityWindow);
            const stable =
              window.length >= p.stabilityWindow ? commonPrefixLength(window) : 0;
            const count = Math.max(turn.committed.length, Math.min(stable, words.length));
            turn.committed = words.slice(0, count);
            committedWords = turn.committed;
            previewWords = words.slice(count);
            break;
          }
        }
      }

      // Churn has to be measured against what is on screen. With the preview
      // hidden, the displayed set is the committed words alone.
      const shownPreview = p.renderPreview ? previewWords : [];
      const rendered = [...committedWords, ...shownPreview];

      // Stamp when each word index was first seen and first made final. Lag is
      // resolved later against the final's word timings, which are exact.
      for (let i = 0; i < rendered.length; i++) {
        if (turn.firstRenderAt[i] == null) turn.firstRenderAt[i] = at;
      }
      for (let i = 0; i < committedWords.length; i++) {
        if (turn.firstCommitAt[i] == null) turn.firstCommitAt[i] = at;
      }

      const previous = turn.lastRenderedWords;
      let revised = 0;
      for (let i = 0; i < Math.min(previous.length, rendered.length); i++) {
        if (previous[i] !== rendered[i]) revised++;
      }

      const textChanged = rendered.length > previous.length || revised > 0;
      const gap =
        textChanged && vadRef.current.lastUpdateAt ? at - vadRef.current.lastUpdateAt : null;
      if (textChanged) vadRef.current.lastUpdateAt = at;

      const isFirstRender = rendered.length > 0 && turn.firstAnyRenderAt == null;
      if (isFirstRender) turn.firstAnyRenderAt = at;
      const ttft =
        isFirstRender && turn.speechStartedAt != null ? at - turn.speechStartedAt : null;

      const wordsAdded = Math.max(0, rendered.length - previous.length);
      turn.lastRenderedWords = rendered;

      // On the final, the server gives exact per-word audio timings. Resolve both
      // latencies against them in one pass.
      const lagSamples: LatencySample[] = [];
      const commitSamples: LatencySample[] = [];
      if (msg.end_of_turn) {
        const timed = msg.words ?? [];
        for (let i = 0; i < timed.length; i++) {
          const audioEndMs = timed[i].end;
          if (typeof audioEndMs !== "number") continue;
          const text = timed[i].text;
          const renderedAt = turn.firstRenderAt[i];
          if (renderedAt != null) {
            lagSamples.push({ text, audioEndMs, renderedAtMs: renderedAt, lagMs: renderedAt - audioEndMs });
          }
          const committedAt = turn.firstCommitAt[i];
          if (committedAt != null) {
            commitSamples.push({ text, audioEndMs, renderedAtMs: committedAt, lagMs: committedAt - audioEndMs });
          }
        }
      }

      setMetrics((m) => ({
        ...m,
        turns: msg.end_of_turn ? m.turns + 1 : m.turns,
        partials: msg.end_of_turn ? m.partials : m.partials + 1,
        finals: msg.end_of_turn ? m.finals + 1 : m.finals,
        revisedWords: m.revisedWords + revised,
        wordsRendered: m.wordsRendered + wordsAdded,
        ttft: ttft != null ? [...m.ttft, ttft] : m.ttft,
        updateGaps: gap != null ? [...m.updateGaps, gap] : m.updateGaps,
        lag: lagSamples.length ? [...m.lag, ...lagSamples] : m.lag,
        commitLag: commitSamples.length ? [...m.commitLag, ...commitSamples] : m.commitLag,
      }));

      // Committed runs are emitted raw: the page owns punctuation conversion so
      // it can join each run to the text already in the field. The preview is
      // converted here purely so what is on screen matches what will land.
      const finish = (text: string) =>
        convertSpokenPunctuation(text, {
          mode: punctuationRef.current.mode,
          guardWords: punctuationRef.current.guardWords,
          disabled: punctuationRef.current.disabledRules,
        });

      // Route everything newly released, grouping consecutive words that share a
      // field so a run becomes one append rather than one per word.
      const wireWords = msg.words ?? [];
      const entries = timelineRef.current;
      const snapWords = p.snapToSentenceWords;

      // Resolve every boundary we now have enough context for, and freeze it.
      // A boundary stays unresolved until there is lookahead past it, because
      // until then a later message could still snap it somewhere else.
      let safeLimit = committedWords.length;
      for (let e = 1; e < entries.length; e++) {
        if (turn.bounds.has(e)) continue;
        const raw = rawBoundaryIndex(wireWords, entries[e].audioMs);
        if (raw == null) continue; // boundary is past everything heard so far

        // On the final there is no more context coming, so resolve with whatever
        // lookahead exists. Deferring here would strand the held-back words: the
        // turn ends and they are never emitted, leaving the last fields empty.
        if (!msg.end_of_turn && snapWords > 0 && raw + snapWords > wireWords.length - 1) {
          // Not enough lookahead to know where this boundary lands. Hold back
          // the words that could still move rather than place them wrongly.
          safeLimit = Math.min(safeLimit, Math.max(turn.emitted, raw - snapWords));
          continue;
        }

        const frozen = Math.max(
          snapBoundary(wireWords, raw, snapWords),
          lastFrozenIndex(turn.bounds),
        );
        turn.bounds.set(e, frozen);
      }

      const fieldForIndex = (i: number): string => {
        let chosen: string | null = null;
        for (let e = 1; e < entries.length; e++) {
          const index = turn.bounds.get(e);
          if (index != null && index <= i) chosen = entries[e].fieldId;
        }
        return chosen ?? entries[0]?.fieldId ?? getFieldRef.current();
      };

      committedWords = committedWords.slice(0, Math.max(turn.emitted, safeLimit));

      if (committedWords.length > turn.emitted) {
        const runs: { fieldId: string; words: string[] }[] = [];
        for (let i = turn.emitted; i < committedWords.length; i++) {
          const fieldId = fieldForIndex(i);
          const last = runs[runs.length - 1];
          if (last && last.fieldId === fieldId) last.words.push(committedWords[i]);
          else runs.push({ fieldId, words: [committedWords[i]] });
        }
        turn.emitted = committedWords.length;
        for (const run of runs) {
          const text = run.words.join(" ");
          if (text) onCommitRef.current(text, run.fieldId);
        }
      }

      if (msg.end_of_turn) {
        setLive({ preview: "" });
        turn.partialHistory = [];
        turn.committed = [];
        turn.firstRenderAt = [];
        turn.firstCommitAt = [];
        turn.lastRenderedWords = [];
        turn.firstAnyRenderAt = null;
        turn.speechStartedAt = null;
        turn.emitted = 0;
      } else {
        setLive({ preview: p.renderPreview ? finish(previewWords.join(" ")) : "" });
      }
    },
    [paramsRef, punctuationRef, onCommitRef, getFieldRef],
  );

  const stop = useCallback(async () => {
    setStatus("stopping");
    const socket = socketRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "Terminate" }));
    }
    await micRef.current?.stop();
    micRef.current = null;
    setTimeout(() => {
      socketRef.current?.close();
      socketRef.current = null;
      setStatus("idle");
      setAudioLevel(0);
    }, 250);
  }, []);

  const start = useCallback(async () => {
    if (status === "live" || status === "connecting") return;
    setError(null);
    setLog([]);
    setMetrics(EMPTY_METRICS);
    setLive({ preview: "" });
    resetTurn();
    preopenRef.current = [];
    audioOriginRef.current = 0;
    timelineRef.current = [];
    setStatus("connecting");

    const p = paramsRef.current;

    try {
      const tokenResponse = await fetch(`/api/token?region=${p.region}`, { cache: "no-store" });
      const tokenBody = await tokenResponse.json();
      if (!tokenResponse.ok) throw new Error(tokenBody.error ?? "Could not mint a token");

      // Open the mic first so the real sample rate goes into the query string.
      const mic = await startMic(p.sample_rate, (chunk) => {
        const socket = socketRef.current;
        const cfg = paramsRef.current;

        if (!audioOriginRef.current) {
          // This frame's audio was captured *before* it arrived here: one chunk
          // of buffering plus the input pipeline's own latency. Without backing
          // the origin off, every cursor timestamp reads early by that much.
          const chunkMs = (chunk.samples / (micRef.current?.sampleRate ?? 16000)) * 1000;
          audioOriginRef.current = Date.now() - chunkMs - inputLatencyMsRef.current;
          timelineRef.current = [{ audioMs: 0, fieldId: getFieldRef.current(), snapped: true }];
        }

        const at = now();
        if (at - levelAtRef.current > 200) {
          levelAtRef.current = at;
          setAudioLevel(chunk.rms);
        }
        const vad = vadRef.current;
        const isVoice = chunk.rms > 0.01;
        if (isVoice) {
          vad.lastVoiceAt = at;
          vad.speaking = true;
        }

        if (!socket || socket.readyState === WebSocket.CONNECTING) {
          // Cap the backlog at ~4s so a failed connection can't grow unbounded.
          if (preopenRef.current.length < 50) preopenRef.current.push(chunk.pcm);
          return;
        }

        if (socket.readyState === WebSocket.OPEN) {
          socket.send(chunk.pcm);

          if (cfg.deliveryMode === "forced" && vad.speaking) {
            const sinceForce = at - Math.max(vad.lastForceAt, vad.turnOpenedAt);
            const silentFor = at - vad.lastVoiceAt;
            const cadenceHit = cfg.forceEndpointMs > 0 && sinceForce >= cfg.forceEndpointMs;
            const silenceHit =
              cfg.forceOnSilenceMs > 0 && silentFor >= cfg.forceOnSilenceMs && sinceForce > 200;

            if (cadenceHit || silenceHit) {
              vad.lastForceAt = at;
              if (silenceHit) vad.speaking = false;
              socket.send(JSON.stringify({ type: "ForceEndpoint" }));
              setMetrics((m) => ({ ...m, forcedEndpoints: m.forcedEndpoints + 1 }));
              addLog("sent", "ForceEndpoint", cadenceHit ? "cadence" : "local silence");
            }
          }
        }
      });
      micRef.current = mic;
      inputLatencyMsRef.current = mic.inputLatencyMs;
      addLog("info", "Microphone open", `${mic.sampleRate} Hz · input latency ~${Math.round(mic.inputLatencyMs)}ms`);

      const query = buildStreamingQuery({ ...p, sample_rate: mic.sampleRate }, tokenBody.token);
      const host = REGION_HOSTS[p.region];
      const socket = new WebSocket(`wss://${host}/v3/ws?${query}`);
      socket.binaryType = "arraybuffer";
      socketRef.current = socket;

      socket.onopen = () => {
        t0Ref.current = Date.now();
        // Flush anything spoken during the handshake, oldest first.
        const backlog = preopenRef.current;
        preopenRef.current = [];
        for (const pcm of backlog) socket.send(pcm);
        if (backlog.length) {
          addLog("sent", "Flushed pre-connect audio", `${backlog.length} chunks (~${backlog.length * 80}ms)`);
        }
        vadRef.current = {
          speaking: false,
          lastVoiceAt: 0,
          lastForceAt: 0,
          turnOpenedAt: 0,
          lastUpdateAt: 0,
        };
        setStatus("live");
        addLog("info", "WebSocket open", `wss://${host}/v3/ws`);
      };

      socket.onmessage = (event) => {
        const msg = JSON.parse(event.data as string);
        switch (msg.type) {
          case "Begin":
          case "SessionBegins":
            addLog("recv", "SessionBegins", msg.id ?? msg.session_id);
            break;
          case "SpeechStarted":
            turnRef.current.speechStartedAt = now();
            addLog("recv", "SpeechStarted", `t=${msg.timestamp}ms conf=${msg.confidence}`);
            break;
          case "Turn": {
            const t = msg as TurnMessage;
            addLog(
              "recv",
              t.end_of_turn ? `Turn final #${t.turn_order}` : `Turn partial #${t.turn_order}`,
              `${t.turn_is_formatted ? "formatted" : "unformatted"} · ${t.transcript}`,
            );
            handleTurn(t);
            break;
          }
          case "Heartbeat":
            addLog("recv", "Heartbeat", `rtf=${msg.realtime_factor}`);
            break;
          case "Termination":
            addLog("recv", "Termination", `audio=${msg.audio_duration_seconds}s`);
            break;
          default:
            addLog("recv", msg.type ?? "message", JSON.stringify(msg).slice(0, 200));
        }
      };

      socket.onerror = () => {
        setError("WebSocket error — check the browser console and your API key.");
        addLog("error", "WebSocket error");
      };

      socket.onclose = (event) => {
        addLog("info", `WebSocket closed (${event.code})`, event.reason);
        if (event.code !== 1000 && event.code !== 1005) {
          setError(`Session closed: ${event.code} ${event.reason}`);
          setStatus("error");
        } else {
          setStatus("idle");
        }
        micRef.current?.stop();
        micRef.current = null;
      };
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to start";
      setError(message);
      addLog("error", message);
      setStatus("error");
      await micRef.current?.stop();
      micRef.current = null;
    }
  }, [status, addLog, handleTurn, resetTurn, paramsRef, getFieldRef]);

  /** Pushes mid-stream-updatable params to a live session without reconnecting. */
  const applyMidStream = useCallback(() => {
    const p = paramsRef.current;
    const payload: Record<string, unknown> = { type: "UpdateConfiguration" };
    if (p.speech_model === "universal-3-5-pro") {
      payload.mode = p.mode;
      if (p.interruption_delay != null) payload.interruption_delay = p.interruption_delay;
      payload.continuous_partials = p.continuous_partials;
      if (p.prompt.trim()) payload.prompt = p.prompt.trim();
    }
    if (p.min_turn_silence != null) payload.min_turn_silence = p.min_turn_silence;
    if (p.max_turn_silence != null) payload.max_turn_silence = p.max_turn_silence;
    if (p.vad_threshold != null) payload.vad_threshold = p.vad_threshold;
    if (p.keyterms_prompt.length) payload.keyterms_prompt = p.keyterms_prompt;
    send(payload, "UpdateConfiguration");
  }, [send, paramsRef]);

  const forceEndpoint = useCallback(() => {
    send({ type: "ForceEndpoint" }, "ForceEndpoint (manual)");
    setMetrics((m) => ({ ...m, forcedEndpoints: m.forcedEndpoints + 1 }));
  }, [send]);

  return {
    status,
    error,
    live,
    metrics,
    log,
    audioLevel,
    start,
    stop,
    applyMidStream,
    forceEndpoint,
    noteFieldChange,
  };
}
