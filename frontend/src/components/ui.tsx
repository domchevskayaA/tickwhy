import type { ReactNode } from "react";
import { RANGES, type RangeKey } from "@/lib/api";
import { pct, signColor } from "@/lib/format";

/** Segmented control for the chart range. */
export function RangeTabs({ value, onChange }: { value: RangeKey; onChange: (r: RangeKey) => void }) {
  return (
    <div className="inline-flex rounded-xl border border-border bg-surface-2 p-1">
      {RANGES.map((r) => (
        <button
          key={r}
          onClick={() => onChange(r)}
          className={`rounded-lg px-3 py-1 text-xs font-semibold transition-colors ${
            r === value ? "bg-accent text-accent-fg shadow-[0_0_14px_-4px_var(--glow)]" : "text-muted hover:text-fg"
          }`}
        >
          {r}
        </button>
      ))}
    </div>
  );
}

/** Small labelled number, e.g. "SPY +15.0%". */
export function Stat({ label, value, title }: { label: ReactNode; value: ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface-2 px-2.5 py-1 text-xs text-muted ${title ? "cursor-help" : ""}`}
    >
      {label}
      <b className="font-semibold text-fg">{value}</b>
    </span>
  );
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-accent-text">{children}</p>
  );
}

export interface BarRow {
  label: ReactNode;
  value: number | null;
  /** Tailwind background class for the bar. */
  color?: string;
  title?: string;
}

/** Bars growing left (negative) or right (positive) from a center line. */
export function DivergingBars({ rows, labelWidth = "9rem" }: { rows: BarRow[]; labelWidth?: string }) {
  const scale = Math.max(...rows.map((r) => Math.abs(r.value ?? 0)), 0.01);
  return (
    <div className="space-y-2">
      {rows.map((r, i) => {
        const w = r.value == null ? 0 : (Math.abs(r.value) / scale) * 50;
        return (
          <div
            key={i}
            title={r.title}
            className="grid items-center gap-2 text-xs"
            style={{ gridTemplateColumns: `${labelWidth} 1fr 3.75rem` }}
          >
            <span className="truncate text-muted">{r.label}</span>
            <div className="relative h-2 rounded-full bg-surface-3">
              {r.value != null && (
                <div
                  className={`absolute top-0 h-2 rounded-full ${r.color ?? (r.value >= 0 ? "bg-up" : "bg-down")}`}
                  style={{ width: `${w}%`, left: r.value >= 0 ? "50%" : `${50 - w}%` }}
                />
              )}
              <div className="absolute left-1/2 top-[-3px] h-3.5 w-px bg-border-strong" />
            </div>
            <span className={`text-right font-medium tabular-nums ${signColor(r.value)}`}>{pct(r.value)}</span>
          </div>
        );
      })}
    </div>
  );
}
