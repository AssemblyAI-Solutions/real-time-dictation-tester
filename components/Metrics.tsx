"use client";

import { mean, percentile, type Metrics } from "@/lib/metrics";
import { Pill } from "./Controls";

function Stat({
  label,
  value,
  unit,
  hint,
  tone,
  big,
}: {
  label: string;
  value: string | number | null;
  unit?: string;
  hint?: string;
  tone?: "good" | "warn" | "bad";
  big?: boolean;
}) {
  const toneClass =
    tone === "good" ? "text-good" : tone === "warn" ? "text-warn" : tone === "bad" ? "text-live" : "text-ink-100";
  return (
    <div className="rounded-lg border border-ink-800 bg-ink-850/60 px-2 py-1.5">
      <div className="text-[10px] leading-tight text-ink-500">{label}</div>
      <div className={`font-mono ${big ? "text-lg" : "text-sm"} ${toneClass}`}>
        {value ?? "—"}
        {value != null && unit && <span className="ml-0.5 text-[10px] text-ink-500">{unit}</span>}
      </div>
      {hint && <div className="mt-0.5 text-[9px] leading-tight text-ink-600">{hint}</div>}
    </div>
  );
}

const round = (n: number | null) => (n == null ? null : Math.round(n));

export function StreamingMetrics({ metrics: m }: { metrics: Metrics }) {
  const lags = m.lag.map((l) => l.lagMs);
  const commits = m.commitLag.map((l) => l.lagMs);
  const deadAir = m.updateGaps.length ? Math.max(...m.updateGaps) : null;
  const churn = m.wordsRendered ? (m.revisedWords / m.wordsRendered) * 100 : null;

  return (
    <div className="space-y-2 p-2">
      <div className="grid grid-cols-2 gap-1.5">
        <Stat
          label="Dead air — worst gap between on-screen updates"
          value={round(deadAir)}
          unit="ms"
          big
          tone={deadAir == null ? undefined : deadAir > 4000 ? "bad" : deadAir > 1500 ? "warn" : "good"}
          hint="how long the screen can sit still"
        />
        <Stat
          label="Screen churn — rendered words later changed"
          value={churn == null ? null : churn.toFixed(1)}
          unit="%"
          big
          tone={churn == null ? undefined : churn > 10 ? "bad" : churn > 2 ? "warn" : "good"}
          hint={`${m.revisedWords} of ${m.wordsRendered} words`}
        />
      </div>

      <div>
        <div className="mb-1 px-0.5 text-[10px] uppercase tracking-wider text-ink-500">
          Visible lag — spoken → on screen
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          <Stat label="p50" value={round(percentile(lags, 50))} unit="ms" />
          <Stat label="p95" value={round(percentile(lags, 95))} unit="ms" />
          <Stat label="max" value={lags.length ? Math.round(Math.max(...lags)) : null} unit="ms" />
        </div>
      </div>

      <div>
        <div className="mb-1 px-0.5 text-[10px] uppercase tracking-wider text-ink-500">
          Commit lag — spoken → final, i.e. safe from revision
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          <Stat label="p50" value={round(percentile(commits, 50))} unit="ms" />
          <Stat label="p95" value={round(percentile(commits, 95))} unit="ms" />
          <Stat label="max" value={commits.length ? Math.round(Math.max(...commits)) : null} unit="ms" />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-1.5">
        <Stat label="TTFT mean" value={round(mean(m.ttft))} unit="ms" hint="SpeechStarted → first text" />
        <Stat label="Update gap p50" value={round(percentile(m.updateGaps, 50))} unit="ms" />
        <Stat label="Timed words" value={lags.length} hint="resolved at each final" />
      </div>

      <div className="flex flex-wrap gap-1 pt-0.5">
        <Pill>turns {m.turns}</Pill>
        <Pill>finals {m.finals}</Pill>
        <Pill>partials {m.partials}</Pill>
        {m.forcedEndpoints > 0 && <Pill tone="accent">forced {m.forcedEndpoints}</Pill>}
        {m.contextSwitches > 0 && <Pill tone="accent">context {m.contextSwitches}</Pill>}
      </div>

      <p className="pt-1 text-[10px] leading-relaxed text-ink-500">
        Both lags are measured against the audio timeline — a word&apos;s{" "}
        <code className="text-ink-400">end</code> timestamp from the final, subtracted from the
        wall-clock moment it was first rendered and first made final. The gap between the two
        rows is the window in which text on screen could still change. Word indices are matched
        between unformatted partials and the formatted final, so entity rewrites
        (&ldquo;five five five&rdquo; → &ldquo;555&rdquo;) can shift alignment by a word.
      </p>
    </div>
  );
}
