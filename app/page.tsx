"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EventLog } from "@/components/EventLog";
import { ParamPanel } from "@/components/ParamPanel";
import { Rail } from "@/components/Rail";
import { ReportEditor } from "@/components/ReportEditor";
import { ScriptPanel } from "@/components/ScriptPanel";
import { DictationMetricsView, StreamingMetrics } from "@/components/Metrics";
import { useDictation } from "@/hooks/useDictation";
import { useLatest } from "@/hooks/useLatest";
import { useStreaming } from "@/hooks/useStreaming";
import { appendDictated, convertSpokenPunctuation } from "@/lib/punctuation";
import {
  DEFAULT_DICTATION,
  DEFAULT_PUNCTUATION,
  DEFAULT_STREAMING,
  type Engine,
  type DictationParams,
  type PunctuationSettings,
  type StreamingParams,
} from "@/lib/params";
import { DICTATABLE_FIELDS, detectCommand, emptyReport } from "@/lib/report";

export default function Page() {
  const [engine, setEngine] = useState<Engine>("streaming");
  const [streamingParams, setStreamingParams] = useState<StreamingParams>(DEFAULT_STREAMING);
  const [dictationParams, setDictationParams] = useState<DictationParams>(DEFAULT_DICTATION);
  const [punctuation, setPunctuation] = useState<PunctuationSettings>(DEFAULT_PUNCTUATION);

  const [fields, setFields] = useState<Record<string, string>>(emptyReport);
  const [activeField, setActiveField] = useState(DICTATABLE_FIELDS[0].id);
  const [voiceCommands, setVoiceCommands] = useState(false);
  const [showStability, setShowStability] = useState(true);
  const [routeByCapture, setRouteByCapture] = useState(true);
  const [bottomTab, setBottomTab] = useState<"metrics" | "log">("metrics");
  const [panelOpen, setPanelOpen] = useState(true);
  const [panelHeight, setPanelHeight] = useState(240);

  /**
   * Updated synchronously inside `selectField`, unlike a useLatest ref which
   * lands an effect later. The engines read the cursor from an audio callback, so
   * a frame of lag is long enough for audio to be billed to the previous field.
   */
  const activeFieldRef = useRef(activeField);
  const voiceCommandsRef = useLatest(voiceCommands);
  const routeByCaptureRef = useLatest(routeByCapture);
  const punctuationRef = useLatest(punctuation);

  /**
   * Indirection so `selectField` can notify whichever engine is active even
   * though the hooks are constructed below it. Filled in by an effect, which
   * runs long before any keystroke.
   */
  const engineRef = useRef<{ noteField: (id: string) => void }>({ noteField: () => {} });

  /**
   * The single entry point for moving the cursor. Notifies the engines in the
   * same tick as the originating event so no audio is misattributed.
   */
  const selectField = useCallback((id: string) => {
    if (activeFieldRef.current === id) return;
    activeFieldRef.current = id;
    engineRef.current.noteField(id);
    setActiveField(id);
  }, []);

  const moveField = useCallback(
    (delta: number) => {
      const index = DICTATABLE_FIELDS.findIndex((f) => f.id === activeFieldRef.current);
      const next = Math.min(DICTATABLE_FIELDS.length - 1, Math.max(0, index + delta));
      selectField(DICTATABLE_FIELDS[next].id);
    },
    [selectField],
  );

  /** Appends a released run of words to a field, honouring spoken commands. */
  const onCommit = useCallback(
    (text: string, capturedFieldId: string) => {
      if (voiceCommandsRef.current) {
        const command = detectCommand(text);
        if (command) {
          if (command.kind === "next") moveField(1);
          else if (command.kind === "previous") moveField(-1);
          else selectField(command.fieldId);
          return;
        }
      }
      // Route to where the cursor was when the words were spoken, not where it
      // is now. Transcripts arrive hundreds of ms to seconds after the audio,
      // so delivery-time routing drops text into whatever field the radiologist
      // has since moved to.
      const id =
        routeByCaptureRef.current && capturedFieldId ? capturedFieldId : activeFieldRef.current;

      // Convert the speaker's punctuation commands, then join to what the field
      // already holds — the join is what gets spacing and capitalisation right
      // when a mark arrives in its own run.
      setFields((prev) => {
        const existing = prev[id] ?? "";
        const converted = convertSpokenPunctuation(text, {
          mode: punctuationRef.current.mode,
          guardWords: punctuationRef.current.guardWords,
          disabled: punctuationRef.current.disabledRules,
          precedingWord: existing.split(/\s+/).filter(Boolean).pop(),
        });
        return { ...prev, [id]: appendDictated(existing, converted) };
      });
    },
    [
      moveField,
      selectField,
      activeFieldRef,
      voiceCommandsRef,
      routeByCaptureRef,
      punctuationRef,
    ],
  );

  const getField = useCallback(() => activeFieldRef.current, [activeFieldRef]);

  const streaming = useStreaming({ params: streamingParams, punctuation, onCommit, getField });
  const dictation = useDictation({ params: dictationParams, onSegment: onCommit, getField });

  const noteStreamingField = streaming.noteFieldChange;
  const noteDictationField = dictation.noteFieldChange;
  useEffect(() => {
    engineRef.current.noteField =
      engine === "streaming" ? noteStreamingField : () => noteDictationField();
  }, [engine, noteStreamingField, noteDictationField]);

  const active = engine === "streaming" ? streaming : dictation;
  const isLive = active.status === "live" || active.status === "connecting";

  const toggleRecording = useCallback(() => {
    if (isLive) void active.stop();
    else void active.start();
  }, [isLive, active]);

  // Alt+Arrow moves between report fields the way a foot pedal would.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        moveField(1);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        moveField(-1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [moveField]);

  // Drag the panel's top edge to trade instrumentation space for report space.
  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = panelHeight;
    const onMove = (ev: MouseEvent) =>
      setPanelHeight(Math.min(600, Math.max(96, startH + (startY - ev.clientY))));
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [panelHeight]);

  const activeLabel = useMemo(
    () => DICTATABLE_FIELDS.find((f) => f.id === activeField)?.label ?? "",
    [activeField],
  );

  const level = Math.min(1, active.audioLevel * 12);

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-ink-950">
      {/* Patient header */}
      <header className="flex shrink-0 items-center gap-4 border-b border-ink-800 bg-ink-850 px-4 py-2">
        <div className="min-w-0">
          <h1 className="truncate text-[15px] font-semibold text-ink-100">DOE, JANE A</h1>
          <p className="font-mono text-[10px] text-ink-400">
            DOB: 01/01/1970 (56) · F · MRN: SAMPLE-0001
          </p>
        </div>

        <div className="flex items-center gap-2 border-l border-ink-700 pl-4">
          <span className="h-2 w-2 rounded-full bg-accent" />
          <span className="truncate text-[12px] text-ink-200">CT ABD PELVIS W CONT</span>
          <span className="rounded bg-ink-750 px-1.5 py-0.5 font-mono text-[10px] text-ink-400">
            ACC SAMPLE-0001
          </span>
          <span
            className="rounded bg-warn/15 px-1.5 py-0.5 font-mono text-[10px] text-warn"
            title="No real patient data is used anywhere in this project."
          >
            SAMPLE DATA
          </span>
        </div>

        <div className="ml-auto flex items-center gap-3">
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-wider text-ink-500">
              Active field <span className="text-ink-600">· ⌥↑ / ⌥↓</span>
            </div>
            <div className="font-mono text-[11px] text-accent">{activeLabel}</div>
          </div>

          <button
            onClick={toggleRecording}
            className={`flex items-center gap-2 rounded-md px-4 py-2 text-[12px] font-semibold transition ${
              isLive
                ? "bg-live text-white hover:brightness-110"
                : "bg-ink-750 text-ink-100 ring-1 ring-ink-600 hover:bg-ink-700"
            }`}
          >
            <span
              className={`h-2.5 w-2.5 rounded-full ${
                isLive ? "rec-dot bg-white" : "bg-live"
              }`}
            />
            {active.status === "connecting"
              ? "CONNECTING…"
              : isLive
                ? "STOP"
                : "RECORD"}
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <Rail active={5} />

        {/* Centre column */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex shrink-0 items-center gap-3 border-b border-ink-800 bg-ink-900/60 px-4 py-1.5">
            <span className="rounded bg-accent/15 px-2 py-0.5 font-mono text-[10px] text-accent">
              {engine === "streaming"
                ? `${streamingParams.deliveryMode} · ${streamingParams.mode}`
                : `dictation · ${dictationParams.chunking}`}
            </span>
            <span className="font-mono text-[10px] text-ink-500">Template: test template</span>

            <div className="ml-auto flex items-center gap-3">
              <label className="flex cursor-pointer items-center gap-1.5 text-[10px] text-ink-400">
                <input
                  type="checkbox"
                  checked={showStability}
                  onChange={(e) => setShowStability(e.target.checked)}
                  className="accent-[var(--color-accent)]"
                />
                highlight stability
              </label>
              <label className="flex cursor-pointer items-center gap-1.5 text-[10px] text-ink-400">
                <input
                  type="checkbox"
                  checked={voiceCommands}
                  onChange={(e) => setVoiceCommands(e.target.checked)}
                  className="accent-[var(--color-accent)]"
                />
                spoken field commands
              </label>
              <label
                className="flex cursor-pointer items-center gap-1.5 text-[10px] text-ink-400"
                title="On: text goes to the field that was active when you spoke it. Off: it goes wherever the cursor is when the transcript arrives — the naive behaviour that misroutes text."
              >
                <input
                  type="checkbox"
                  checked={routeByCapture}
                  onChange={(e) => setRouteByCapture(e.target.checked)}
                  className="accent-[var(--color-accent)]"
                />
                <span className={routeByCapture ? "" : "text-warn"}>
                  route by capture time
                </span>
              </label>

              {/* Mic level */}
              <div className="flex h-3 w-16 items-end gap-[2px]" title="Input level">
                {Array.from({ length: 8 }).map((_, i) => (
                  <span
                    key={i}
                    className={`w-full rounded-sm transition-all ${
                      level * 8 > i ? "bg-good" : "bg-ink-700"
                    }`}
                    style={{ height: `${25 + i * 10}%` }}
                  />
                ))}
              </div>
            </div>
          </div>

          {active.error && (
            <div className="shrink-0 border-b border-live/30 bg-live/10 px-4 py-1.5 font-mono text-[11px] text-live">
              {active.error}
            </div>
          )}

          <ReportEditor
            fields={fields}
            activeField={activeField}
            onActivate={selectField}
            onEdit={(id, value) => setFields((prev) => ({ ...prev, [id]: value }))}
            live={engine === "streaming" ? streaming.live : { preview: "" }}
            recording={engine === "streaming" && isLive}
            showStability={showStability}
          />

          <ScriptPanel />

          {/* Report actions */}
          <div className="flex shrink-0 items-center gap-2 border-t border-ink-800 bg-ink-900/60 px-4 py-2">
            <button
              onClick={() => setFields(emptyReport())}
              className="text-[11px] text-live/80 hover:text-live"
            >
              Discard
            </button>
            <button className="rounded border border-ink-600 px-3 py-1 text-[11px] text-ink-200 hover:bg-ink-800">
              Draft
            </button>
            {engine === "dictation" && dictation.inFlight > 0 && (
              <span className="font-mono text-[10px] text-warn">
                {dictation.inFlight} clip{dictation.inFlight > 1 ? "s" : ""} in flight
              </span>
            )}
            <label className="ml-auto flex cursor-pointer items-center gap-2 text-[11px] text-ink-300">
              Critical Result
              <input type="checkbox" className="accent-[var(--color-accent)]" />
            </label>
          </div>

          {/* Instrumentation */}
          <div
            className="flex shrink-0 flex-col border-t border-ink-800 bg-ink-900"
            style={{ height: panelOpen ? panelHeight : undefined }}
          >
            {panelOpen && (
              <div
                onMouseDown={startResize}
                title="Drag to resize"
                className="group h-1.5 shrink-0 cursor-row-resize bg-transparent hover:bg-accent/30"
              >
                <div className="mx-auto mt-0.5 h-0.5 w-8 rounded bg-ink-700 group-hover:bg-accent" />
              </div>
            )}

            <div className="flex shrink-0 gap-1 border-b border-ink-800 px-2 py-1">
              <button
                onClick={() => setPanelOpen((o) => !o)}
                title={panelOpen ? "Collapse — give the space to the report" : "Show latency and wire log"}
                className="rounded px-1.5 py-1 text-[10px] text-ink-500 hover:text-ink-200"
              >
                {panelOpen ? "▾" : "▸"}
              </button>
              {(["metrics", "log"] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => {
                    setBottomTab(tab);
                    setPanelOpen(true);
                  }}
                  className={`rounded px-2 py-1 text-[10px] font-semibold uppercase tracking-wider transition ${
                    panelOpen && bottomTab === tab
                      ? "bg-ink-750 text-ink-100"
                      : "text-ink-500 hover:text-ink-300"
                  }`}
                >
                  {tab === "metrics" ? "Latency" : "Wire log"}
                </button>
              ))}
              <span className="ml-auto self-center px-2 font-mono text-[10px] text-ink-600">
                {engine === "streaming"
                  ? "wss://streaming.assemblyai.com/v3/ws"
                  : "POST dictation.assemblyai.com/transcribe"}
              </span>
            </div>

            {panelOpen && (
              <div className="min-h-0 flex-1 overflow-y-auto">
                {bottomTab === "metrics" ? (
                  engine === "streaming" ? (
                    <StreamingMetrics metrics={streaming.metrics} />
                  ) : (
                    <DictationMetricsView metrics={dictation.metrics} />
                  )
                ) : (
                  <EventLog log={active.log} />
                )}
              </div>
            )}
          </div>
        </div>

        {/* Parameter panel */}
        <aside className="flex w-[340px] shrink-0 flex-col border-l border-ink-800 bg-ink-850">
          <ParamPanel
            engine={engine}
            onEngineChange={setEngine}
            streaming={streamingParams}
            onStreamingChange={setStreamingParams}
            dictation={dictationParams}
            onDictationChange={setDictationParams}
            punctuation={punctuation}
            onPunctuationChange={setPunctuation}
            live={engine === "streaming" && isLive}
            onApplyMidStream={streaming.applyMidStream}
            onForceEndpoint={streaming.forceEndpoint}
          />
        </aside>
      </div>
    </div>
  );
}
