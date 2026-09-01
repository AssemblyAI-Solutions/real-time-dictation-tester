"use client";

import { useEffect, useRef, useState } from "react";
import type { LogEntry } from "@/hooks/useStreaming";

const KIND_STYLES: Record<LogEntry["kind"], string> = {
  sent: "text-accent",
  recv: "text-good",
  info: "text-ink-400",
  error: "text-live",
};

const KIND_GLYPH: Record<LogEntry["kind"], string> = {
  sent: "→",
  recv: "←",
  info: "·",
  error: "!",
};

export function EventLog({ log }: { log: LogEntry[] }) {
  const [follow, setFollow] = useState(true);
  const [filter, setFilter] = useState<"all" | "turns" | "sent">("all");
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (follow) endRef.current?.scrollIntoView({ block: "end" });
  }, [log, follow]);

  const visible = log.filter((e) => {
    if (filter === "turns") return e.label.startsWith("Turn") || e.label.startsWith("Clip");
    if (filter === "sent") return e.kind === "sent";
    return true;
  });

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex shrink-0 items-center gap-1 border-b border-ink-800 px-2 py-1">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-400">
          Wire log
        </span>
        <div className="ml-auto flex gap-1">
          {(["all", "turns", "sent"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded px-1.5 py-0.5 text-[10px] transition ${
                filter === f ? "bg-ink-700 text-ink-100" : "text-ink-500 hover:text-ink-300"
              }`}
            >
              {f}
            </button>
          ))}
          <button
            onClick={() => setFollow((v) => !v)}
            className={`rounded px-1.5 py-0.5 text-[10px] transition ${
              follow ? "bg-accent/20 text-accent" : "text-ink-500 hover:text-ink-300"
            }`}
            title="Follow tail"
          >
            follow
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-1 font-mono text-[10px] leading-relaxed">
        {visible.length === 0 && (
          <p className="px-1 py-3 text-ink-600">
            Nothing yet — start a session and every frame in both directions shows up here.
          </p>
        )}
        {visible.map((entry) => (
          <div key={entry.id} className="flex gap-1.5 border-b border-ink-900/70 py-0.5">
            <span className="w-12 shrink-0 text-right text-ink-600">
              {(entry.atMs / 1000).toFixed(2)}s
            </span>
            <span className={`w-2 shrink-0 ${KIND_STYLES[entry.kind]}`}>
              {KIND_GLYPH[entry.kind]}
            </span>
            <span className="min-w-0 flex-1">
              <span className={KIND_STYLES[entry.kind]}>{entry.label}</span>
              {entry.detail && (
                <span className="ml-1 break-words text-ink-500">{entry.detail}</span>
              )}
            </span>
          </div>
        ))}
        <div ref={endRef} />
      </div>
    </div>
  );
}
