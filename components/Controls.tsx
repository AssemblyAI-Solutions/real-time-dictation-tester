"use client";

import { useState, type ReactNode } from "react";

export function Section({
  title,
  hint,
  children,
  defaultOpen = true,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-ink-800">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-ink-850/60"
      >
        <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-300">
          {title}
        </span>
        <span className="text-ink-500 text-xs">{open ? "−" : "+"}</span>
      </button>
      {open && (
        <div className="space-y-3 px-3 pb-3">
          {hint && <p className="text-[11px] leading-relaxed text-ink-400">{hint}</p>}
          {children}
        </div>
      )}
    </div>
  );
}

export function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="font-mono text-[11px] text-ink-300">{label}</span>
        {hint && <span className="text-[10px] text-ink-500">{hint}</span>}
      </div>
      {children}
    </label>
  );
}

export function Toggle({
  label,
  hint,
  value,
  onChange,
  disabled,
}: {
  label: string;
  hint?: string;
  value: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={() => onChange(!value)}
      disabled={disabled}
      className={`flex w-full items-center justify-between gap-3 rounded border px-2 py-1.5 text-left transition ${
        disabled
          ? "cursor-not-allowed border-ink-800 opacity-40"
          : value
            ? "border-accent-dim bg-accent/10"
            : "border-ink-700 hover:border-ink-600"
      }`}
    >
      <span>
        <span className="block font-mono text-[11px] text-ink-200">{label}</span>
        {hint && <span className="block text-[10px] text-ink-500">{hint}</span>}
      </span>
      <span
        className={`h-3.5 w-7 shrink-0 rounded-full p-0.5 transition ${
          value ? "bg-accent" : "bg-ink-700"
        }`}
      >
        <span
          className={`block h-2.5 w-2.5 rounded-full bg-white transition-transform ${
            value ? "translate-x-3.5" : ""
          }`}
        />
      </span>
    </button>
  );
}

export function Select<T extends string>({
  value,
  options,
  onChange,
  disabled,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value as T)}
      className="w-full rounded border border-ink-700 bg-ink-900 px-2 py-1.5 font-mono text-[11px] text-ink-200 outline-none focus:border-accent-dim disabled:opacity-40"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/**
 * Numeric control with an explicit "server default" state. Sending nothing is
 * meaningfully different from sending a value, so `null` is first-class here.
 */
export function NumberField({
  value,
  onChange,
  min,
  max,
  step = 1,
  defaultHint,
  disabled,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  min: number;
  max: number;
  step?: number;
  defaultHint?: string;
  disabled?: boolean;
}) {
  const active = value != null;
  return (
    <div className={`flex items-center gap-2 ${disabled ? "opacity-40" : ""}`}>
      <button
        onClick={() => onChange(active ? null : Number(((min + max) / 2).toFixed(step < 1 ? 2 : 0)))}
        disabled={disabled}
        className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] transition ${
          active
            ? "border-accent-dim bg-accent/10 text-ink-200"
            : "border-ink-700 text-ink-500 hover:border-ink-600"
        }`}
        title={active ? "Revert to server default" : "Override the server default"}
      >
        {active ? "set" : defaultHint ?? "default"}
      </button>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        disabled={disabled || !active}
        value={value ?? (min + max) / 2}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1 flex-1 accent-[var(--color-accent)] disabled:opacity-30"
      />
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        disabled={disabled || !active}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
        className="w-16 shrink-0 rounded border border-ink-700 bg-ink-900 px-1.5 py-0.5 text-right font-mono text-[11px] text-ink-200 outline-none focus:border-accent-dim disabled:opacity-30"
      />
    </div>
  );
}

export function Num({
  value,
  onChange,
  min,
  max,
  step = 1,
  disabled,
}: {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  disabled?: boolean;
}) {
  return (
    <div className={`flex items-center gap-2 ${disabled ? "opacity-40" : ""}`}>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1 flex-1 accent-[var(--color-accent)]"
      />
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-16 shrink-0 rounded border border-ink-700 bg-ink-900 px-1.5 py-0.5 text-right font-mono text-[11px] text-ink-200 outline-none focus:border-accent-dim"
      />
    </div>
  );
}

export function TextArea({
  value,
  onChange,
  rows = 3,
  placeholder,
  maxLength,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  placeholder?: string;
  maxLength?: number;
  disabled?: boolean;
}) {
  return (
    <div>
      <textarea
        value={value}
        rows={rows}
        maxLength={maxLength}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="w-full resize-y rounded border border-ink-700 bg-ink-900 px-2 py-1.5 text-[11px] leading-relaxed text-ink-200 outline-none placeholder:text-ink-600 focus:border-accent-dim disabled:opacity-40"
      />
      {maxLength && (
        <div className="mt-0.5 text-right text-[10px] text-ink-600">
          {value.length}/{maxLength}
        </div>
      )}
    </div>
  );
}

/** Comma / newline separated list editor for keyterms, word_boost, language_codes. */
export function TagInput({
  value,
  onChange,
  placeholder,
  max,
  disabled,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
  max?: number;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState("");

  const commit = () => {
    const parts = draft
      .split(/[,\n]/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (!parts.length) return;
    const next = [...value];
    for (const part of parts) {
      if (!next.includes(part) && (!max || next.length < max)) next.push(part);
    }
    onChange(next);
    setDraft("");
  };

  return (
    <div className={disabled ? "opacity-40" : ""}>
      {value.length > 0 && (
        <div className="mb-1 flex flex-wrap gap-1">
          {value.map((tag) => (
            <button
              key={tag}
              disabled={disabled}
              onClick={() => onChange(value.filter((t) => t !== tag))}
              className="group flex items-center gap-1 rounded bg-ink-750 px-1.5 py-0.5 font-mono text-[10px] text-ink-200 hover:bg-ink-700"
            >
              {tag}
              <span className="text-ink-500 group-hover:text-live">×</span>
            </button>
          ))}
        </div>
      )}
      <input
        value={draft}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            commit();
          }
        }}
        className="w-full rounded border border-ink-700 bg-ink-900 px-2 py-1.5 font-mono text-[11px] text-ink-200 outline-none placeholder:text-ink-600 focus:border-accent-dim"
      />
      {max && (
        <div className="mt-0.5 text-right text-[10px] text-ink-600">
          {value.length}/{max}
        </div>
      )}
    </div>
  );
}

export function Pill({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "good" | "warn" | "bad" | "accent";
}) {
  const tones = {
    neutral: "bg-ink-750 text-ink-300",
    good: "bg-good/15 text-good",
    warn: "bg-warn/15 text-warn",
    bad: "bg-live/15 text-live",
    accent: "bg-accent/15 text-accent",
  };
  return (
    <span className={`rounded px-1.5 py-0.5 font-mono text-[10px] ${tones[tone]}`}>{children}</span>
  );
}
