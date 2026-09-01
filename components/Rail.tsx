"use client";

/** Left rail: the section icons a reporting application would have. Decorative. */
const ICONS = ["search", "list", "folder", "monitor", "add", "waveform"] as const;

const PATHS: Record<string, string> = {
  search: "M7 2a5 5 0 1 1 0 10A5 5 0 0 1 7 2Zm5.5 9.5 3 3",
  list: "M2 4h12M2 8h12M2 12h8",
  folder: "M2 4h4l1.5 2H14v7H2V4Z",
  monitor: "M2 3h12v8H2V3Zm4 11h4",
  add: "M8 3v10M3 8h10",
  waveform: "M2 8h2l2-4 2 8 2-6 2 3h2",
};

export function Rail({ active }: { active: number }) {
  return (
    <div className="flex w-12 shrink-0 flex-col items-center gap-1 border-r border-ink-800 bg-ink-900 py-3">
      {ICONS.map((icon, i) => (
        <div
          key={icon}
          className={`flex h-8 w-8 items-center justify-center rounded-lg ${
            i === active ? "bg-accent-soft text-accent" : "text-ink-500"
          }`}
        >
          <svg
            width="15"
            height="15"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
          >
            <path d={PATHS[icon]} />
          </svg>
        </div>
      ))}

      <div className="mt-auto flex h-7 w-7 items-center justify-center rounded-full bg-ink-800 text-[10px] font-semibold text-ink-400">
        DR
      </div>
    </div>
  );
}
