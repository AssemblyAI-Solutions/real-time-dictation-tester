"use client";

import { useCallback, useRef, useState } from "react";
import { pcmToWav, startMic, type MicSession } from "@/lib/audio";
import type { DictationParams } from "@/lib/params";
import type { Status, LogEntry } from "./useStreaming";
import { useLatest } from "./useLatest";

export interface ClipResult {
  seq: number;
  text: string;
  llmResponse: string | null;
  llmError: string | null;
  confidence: number | null;
  audioDurationMs: number;
  /** Server-side processing time. */
  requestTimeMs: number | null;
  syncTimeMs: number | null;
  /** Browser → response, including the proxy hop. */
  roundTripMs: number;
  /** Lag for the clip's last spoken word: response time minus clip end. */
  tailLagMs: number;
  /** Lag for the clip's first spoken word: response time minus clip start. */
  headLagMs: number;
}

export interface DictationMetrics {
  clips: number;
  errors: number;
  results: ClipResult[];
}

export const EMPTY_DICTATION_METRICS: DictationMetrics = { clips: 0, errors: 0, results: [] };

let logSeq = 0;

/** Floor for a clip cut triggered by an explicit field change, in ms. */
const FIELD_CHANGE_MIN_CLIP_MS = 150;

export function useDictation({
  params,
  onSegment,
  getField,
}: {
  params: DictationParams;
  /** `fieldId` is the field that was active when speech started in the clip. */
  onSegment: (text: string, fieldId: string) => void;
  getField: () => string;
}) {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [inFlight, setInFlight] = useState(0);
  const [metrics, setMetrics] = useState<DictationMetrics>(EMPTY_DICTATION_METRICS);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [audioLevel, setAudioLevel] = useState(0);

  const paramsRef = useLatest(params);
  const onSegmentRef = useLatest(onSegment);
  const getFieldRef = useLatest(getField);

  const micRef = useRef<MicSession | null>(null);
  const t0Ref = useRef(0);
  const levelAtRef = useRef(0);

  const clipRef = useRef({
    chunks: [] as ArrayBuffer[],
    startedAt: 0,
    ms: 0,
    silentMs: 0,
    hadVoice: false,
    seq: 0,
    /** Field that was active when this clip started recording. */
    fieldId: "",
  });

  // Clips are sent concurrently but appended in order, so a fast short clip
  // can't overtake a slower one that came before it.
  const orderRef = useRef({
    nextToAppend: 0,
    pending: new Map<number, { text: string; fieldId: string }>(),
  });
  const contextRef = useRef<string[]>([]);

  const now = () => (t0Ref.current ? Date.now() - t0Ref.current : 0);

  const addLog = useCallback((kind: LogEntry["kind"], label: string, detail?: string) => {
    setLog((prev) => {
      const next = [...prev, { id: ++logSeq, atMs: now(), kind, label, detail }];
      return next.length > 400 ? next.slice(-400) : next;
    });
  }, []);

  const appendInOrder = useCallback(
    (seq: number, text: string, fieldId: string) => {
      const order = orderRef.current;
      order.pending.set(seq, { text, fieldId });
      while (order.pending.has(order.nextToAppend)) {
        const next = order.pending.get(order.nextToAppend)!;
        order.pending.delete(order.nextToAppend);
        order.nextToAppend++;
        if (next.text.trim()) {
          onSegmentRef.current(next.text.trim(), next.fieldId);
          contextRef.current = [...contextRef.current, next.text.trim()].slice(-20);
        }
      }
    },
    [onSegmentRef],
  );

  const sendClip = useCallback(
    async (
      chunks: ArrayBuffer[],
      sampleRate: number,
      startedAt: number,
      durationMs: number,
      fieldId: string,
    ) => {
      const p = paramsRef.current;
      const seq = clipRef.current.seq++;
      const clipEndedAt = now();

      const config: Record<string, unknown> = {};
      if (p.language_codes.length) config.language_codes = p.language_codes;
      if (p.prompt.trim()) config.prompt = p.prompt.trim();
      if (p.word_boost.length) config.word_boost = p.word_boost;
      if (p.useConversationContext && contextRef.current.length)
        config.conversation_context = contextRef.current;
      if (p.llmEnabled && p.llmInstruction.trim())
        config.llm = { instruction: p.llmInstruction.trim() };

      const form = new FormData();
      form.append("audio", pcmToWav(chunks, sampleRate), "clip.wav");
      form.append("config", JSON.stringify(config));

      setInFlight((n) => n + 1);
      addLog("sent", `Clip #${seq}`, `${Math.round(durationMs)}ms audio → ${fieldId || "(unbound)"}`);

      try {
        const response = await fetch("/api/dictate", { method: "POST", body: form });
        const body = await response.json();
        const respondedAt = now();

        if (!response.ok) {
          setMetrics((m) => ({ ...m, errors: m.errors + 1 }));
          addLog("error", `Clip #${seq} failed`, body.error ?? String(response.status));
          setError(body.error ?? `Dictation failed (${response.status})`);
          appendInOrder(seq, "", fieldId);
          return;
        }

        const rendered: string = p.llmEnabled && body.llm_response ? body.llm_response : body.text;
        const result: ClipResult = {
          seq,
          text: body.text ?? "",
          llmResponse: body.llm_response ?? null,
          llmError: body.llm_error ?? null,
          confidence: body.confidence ?? null,
          audioDurationMs: body.audio_duration_ms ?? durationMs,
          requestTimeMs: body.request_time_ms ?? null,
          syncTimeMs: body.sync_time_ms ?? null,
          roundTripMs: body.roundTripMs ?? respondedAt - clipEndedAt,
          tailLagMs: respondedAt - clipEndedAt,
          headLagMs: respondedAt - startedAt,
        };

        setMetrics((m) => ({
          ...m,
          clips: m.clips + 1,
          results: [...m.results, result].slice(-100),
        }));
        addLog(
          "recv",
          `Clip #${seq} → ${Math.round(result.tailLagMs)}ms`,
          `server=${result.requestTimeMs}ms · ${body.text}`,
        );
        appendInOrder(seq, rendered ?? "", fieldId);
      } catch (e) {
        setMetrics((m) => ({ ...m, errors: m.errors + 1 }));
        const message = e instanceof Error ? e.message : "Request failed";
        addLog("error", `Clip #${seq} failed`, message);
        setError(message);
        appendInOrder(seq, "", fieldId);
      } finally {
        setInFlight((n) => n - 1);
      }
    },
    [addLog, appendInOrder, paramsRef],
  );

  /**
   * Closes the current clip so the words already spoken stay with the field they
   * were spoken into. Without this, a clip that spans a cursor move is billed
   * entirely to whichever field it started in.
   */
  const noteFieldChange = useCallback(() => {
    const mic = micRef.current;
    const clip = clipRef.current;
    if (!mic) return;

    // Nothing spoken yet, or too little to be worth splitting: hand the whole
    // clip to the new field. Bind it explicitly rather than clearing — the
    // bind-on-first-voice path only runs while `hadVoice` is false, so clearing
    // a clip that already has voice ships it with no field at all.
    if (!clip.hadVoice || clip.ms < FIELD_CHANGE_MIN_CLIP_MS) {
      clip.fieldId = getFieldRef.current();
      return;
    }

    void sendClip([...clip.chunks], mic.sampleRate, clip.startedAt, clip.ms, clip.fieldId);
    clip.chunks = [];
    clip.ms = 0;
    clip.silentMs = 0;
    clip.hadVoice = false;
    // Left unbound on purpose: the next voice frame binds it to whatever field
    // is active by then.
    clip.fieldId = "";
  }, [sendClip, getFieldRef]);

  const stop = useCallback(async () => {
    setStatus("stopping");
    const mic = micRef.current;
    const clip = clipRef.current;
    // Flush whatever is still buffered so the last phrase isn't lost.
    if (mic && clip.hadVoice && clip.ms >= paramsRef.current.minClipMs) {
      void sendClip([...clip.chunks], mic.sampleRate, clip.startedAt, clip.ms, clip.fieldId);
    }
    clip.chunks = [];
    clip.ms = 0;
    clip.hadVoice = false;
    await mic?.stop();
    micRef.current = null;
    setStatus("idle");
    setAudioLevel(0);
  }, [sendClip, paramsRef]);

  const start = useCallback(async () => {
    if (status === "live" || status === "connecting") return;
    setError(null);
    setLog([]);
    setMetrics(EMPTY_DICTATION_METRICS);
    setStatus("connecting");
    clipRef.current = { chunks: [], startedAt: 0, ms: 0, silentMs: 0, hadVoice: false, seq: 0, fieldId: "" };
    orderRef.current = { nextToAppend: 0, pending: new Map() };
    contextRef.current = [];
    t0Ref.current = Date.now();

    try {
      const mic = await startMic(16000, (chunk) => {
        const p = paramsRef.current;
        const clip = clipRef.current;
        const chunkMs = (chunk.samples / mic.sampleRate) * 1000;

        const nowMs = now();
        if (nowMs - levelAtRef.current > 200) {
          levelAtRef.current = nowMs;
          setAudioLevel(chunk.rms);
        }

        if (!clip.chunks.length) clip.startedAt = now();
        clip.chunks.push(chunk.pcm);
        clip.ms += chunkMs;

        const isVoice = chunk.rms > p.silenceRms;
        if (isVoice) {
          // Bind the clip to a field when speech actually starts, not when the
          // buffer opened: a clip begins during the silence *before* the speaker
          // talks, which is often before they have finished moving the cursor.
          if (!clip.hadVoice) clip.fieldId = getFieldRef.current();
          clip.hadVoice = true;
          clip.silentMs = 0;
        } else {
          clip.silentMs += chunkMs;
        }

        const boundary =
          p.chunking === "cadence"
            ? clip.ms >= p.cadenceMs
            : clip.hadVoice && clip.silentMs >= p.chunkSilenceMs;
        const overLength = clip.ms >= p.maxClipMs;

        if ((boundary || overLength) && clip.ms >= p.minClipMs) {
          if (clip.hadVoice) {
            void sendClip([...clip.chunks], mic.sampleRate, clip.startedAt, clip.ms, clip.fieldId);
          }
          clip.chunks = [];
          clip.ms = 0;
          clip.silentMs = 0;
          clip.hadVoice = false;
        } else if (!clip.hadVoice && clip.ms > 2000) {
          // Long stretch of pure silence — drop it rather than pay for a clip.
          clip.chunks = [];
          clip.ms = 0;
          clip.silentMs = 0;
        }
      });

      micRef.current = mic;
      setStatus("live");
      addLog("info", "Dictation session started", `${mic.sampleRate} Hz`);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to start";
      setError(message);
      addLog("error", message);
      setStatus("error");
    }
  }, [status, addLog, sendClip, paramsRef, getFieldRef]);

  return { status, error, metrics, log, audioLevel, inFlight, start, stop, noteFieldChange };
}
