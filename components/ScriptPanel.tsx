"use client";

import { useState } from "react";
import { TEST_SCRIPTS } from "@/lib/scripts";

export function ScriptPanel() {
  const [open, setOpen] = useState(true);
  const [id, setId] = useState(TEST_SCRIPTS[0].id);
  const script = TEST_SCRIPTS.find((s) => s.id === id) ?? TEST_SCRIPTS[0];

  return (
    <div className="shrink-0 border-t border-ink-800 bg-ink-850/60">
      <div className="flex items-center gap-2 px-4 py-1.5">
        <button
          onClick={() => setOpen((o) => !o)}
          className="text-[10px] font-semibold uppercase tracking-wider text-ink-400 hover:text-ink-200"
        >
          {open ? "−" : "+"} Read-aloud script
        </button>
        {open && (
          <div className="flex flex-wrap gap-1">
            {TEST_SCRIPTS.map((s) => (
              <button
                key={s.id}
                onClick={() => setId(s.id)}
                className={`rounded px-2 py-0.5 text-[10px] transition ${
                  s.id === id ? "bg-accent/20 text-accent" : "text-ink-500 hover:text-ink-300"
                }`}
              >
                {s.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {open && (
        <div className="px-4 pb-2.5">
          <p className="mb-1.5 text-[10px] leading-relaxed text-ink-500">
            <span className="text-warn/90">{script.how}</span> {script.purpose}
          </p>
          {script.steps ? (
            <ol className="max-h-40 space-y-0.5 overflow-y-auto rounded-lg border border-ink-700 bg-ink-900 px-3 py-2">
              {script.steps.map((step, i) => (
                <li key={step.field} className="flex items-baseline gap-2 text-[14px] leading-relaxed">
                  {i > 0 && (
                    <span className="shrink-0 rounded bg-accent/20 px-1.5 font-mono text-[11px] text-accent">
                      ⌥↓
                    </span>
                  )}
                  {i === 0 && (
                    <span className="shrink-0 px-1.5 font-mono text-[11px] text-ink-600">start</span>
                  )}
                  <span className="w-36 shrink-0 truncate font-mono text-[11px] text-ink-400">
                    {step.field}
                  </span>
                  <span className="text-ink-100">{step.say}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="max-h-24 overflow-y-auto rounded-lg border border-ink-700 bg-ink-900 px-3 py-2 text-[14px] leading-relaxed text-ink-100">
              {script.text}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
