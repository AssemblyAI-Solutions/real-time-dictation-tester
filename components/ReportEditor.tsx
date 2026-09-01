"use client";

import { useEffect, useRef } from "react";
import { REPORT_TEMPLATE } from "@/lib/report";
import type { LiveText } from "@/hooks/useStreaming";

export function ReportEditor({
  fields,
  activeField,
  onActivate,
  onEdit,
  live,
  recording,
  showStability,
}: {
  fields: Record<string, string>;
  activeField: string;
  onActivate: (id: string) => void;
  onEdit: (id: string, value: string) => void;
  live: LiveText;
  recording: boolean;
  showStability: boolean;
}) {
  const activeRef = useRef<HTMLDivElement>(null);
  const activeText = fields[activeField] ?? "";

  // Keep the field being dictated into on screen without yanking the page when
  // it is already visible.
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [activeField, activeText, live.preview]);

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-3xl px-6 py-4">
        <div className="rounded-md border-2 border-accent-dim/60 bg-ink-900/70 p-4">
          <div className="space-y-1">
            {REPORT_TEMPLATE.map((field) => {
              if (field.header) {
                return (
                  <div
                    key={field.id}
                    className="px-2 pt-2 font-mono text-[13px] tracking-wide text-ink-200"
                  >
                    {field.label}:
                  </div>
                );
              }

              const isActive = field.id === activeField;
              const settled = fields[field.id] ?? "";
              const isEmpty = !settled && !(isActive && recording && live.preview);

              return (
                <div
                  key={field.id}
                  ref={isActive ? activeRef : undefined}
                  onClick={() => onActivate(field.id)}
                  className={`group cursor-text rounded px-2 py-1 transition ${
                    field.indent ? "ml-0" : ""
                  } ${
                    isActive
                      ? "bg-accent/8 ring-1 ring-accent-dim/70"
                      : "hover:bg-ink-850/70"
                  }`}
                >
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                    <span
                      className={`shrink-0 font-mono text-[13px] ${
                        field.indent ? "text-ink-200" : "font-semibold text-ink-200"
                      }`}
                    >
                      {field.label}:
                    </span>

                    {recording && isActive ? (
                      // Committed words have already been routed into their own
                      // fields, so all that renders at the cursor is the preview —
                      // text with no field yet because the model may still revise it.
                      <span className="min-w-[2rem] font-mono text-[13px] leading-relaxed">
                        {settled && <span className="text-ink-100">{settled} </span>}
                        {live.preview && (
                          <span
                            className={
                              showStability
                                ? "rounded bg-warn/10 italic text-warn/90"
                                : "text-ink-400"
                            }
                          >
                            {live.preview}
                          </span>
                        )}
                        <span className="ml-0.5 inline-block h-[13px] w-[2px] animate-pulse bg-accent align-middle" />
                      </span>
                    ) : isActive ? (
                      // A mirror span in the same grid cell sizes the box, so the
                      // textarea grows with its content whether the text was typed
                      // or written by the dictation engine, and never scrolls.
                      <div className="grid min-w-[8rem] flex-1">
                        <span
                          aria-hidden
                          className="col-start-1 row-start-1 whitespace-pre-wrap break-words font-mono text-[13px] leading-relaxed text-transparent"
                        >
                          {settled || field.placeholder || " "}
                          {"\u200b"}
                        </span>
                        <textarea
                          value={settled}
                          rows={1}
                          placeholder={field.placeholder}
                          onChange={(e) => onEdit(field.id, e.target.value)}
                          className="col-start-1 row-start-1 resize-none overflow-hidden whitespace-pre-wrap break-words bg-transparent font-mono text-[13px] leading-relaxed text-ink-100 outline-none placeholder:text-ink-500"
                        />
                      </div>
                    ) : (
                      <span className="font-mono text-[13px] leading-relaxed">
                        {isEmpty ? (
                          <span className="text-ink-500">{field.placeholder}</span>
                        ) : (
                          <span className="text-ink-100">{settled}</span>
                        )}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {showStability && (
          <div className="mt-3 flex flex-wrap items-center gap-3 px-2 text-[10px] text-ink-500">
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-4 rounded bg-ink-600" />
              committed — routed to the field it was spoken into, never rewritten
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-4 rounded bg-warn/30" />
              preview — no field yet, the model may still revise it
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
