"use client";

import type { ReactNode } from "react";
import DriverBadge from "@/components/DriverBadge";
import type { BaseMove, Move } from "@/lib/api";
import { pct, shortDate, signColor } from "@/lib/format";
import type { AnalysisState } from "@/lib/useAnalysis";

interface Props<M extends BaseMove> {
  moves: M[];
  /** "stock" or "index" — used in the copy. */
  subject: string;
  analysis: AnalysisState;
  onRunAnalysis: () => void;
  selectedDate: string | null;
  onSelectDate: (date: string) => void;
  /** Optional per-move breakdown column (hidden on phones). */
  breakdown?: { header: ReactNode; render: (move: M) => ReactNode };
}

export default function MovesPanel<M extends BaseMove>({
  moves,
  subject,
  analysis,
  onRunAnalysis,
  selectedDate,
  onSelectDate,
  breakdown,
}: Props<M>) {
  const running = analysis.status === "running";
  const rows = [...moves].sort((a, b) => (a.date < b.date ? 1 : -1));

  return (
    <section className="card overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3 p-5">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold text-fg">
            Unusual moves
            <span className="rounded-md bg-surface-2 px-1.5 py-0.5 text-xs font-medium text-muted">
              {moves.length}
            </span>
          </h2>
          <p className="mt-1 text-sm text-muted">
            Days the {subject} moved at least 2× its typical daily swing. Click one to see what happened.
          </p>
        </div>
        <button
          onClick={onRunAnalysis}
          disabled={running || moves.length === 0}
          className="glow flex h-10 shrink-0 items-center gap-2 rounded-xl bg-accent px-4 text-sm font-semibold text-accent-fg transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60 disabled:shadow-none"
        >
          {running ? (
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-accent-fg/30 border-t-accent-fg" />
          ) : (
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
              <path d="M12 2l1.9 5.6L19.5 9.5l-5.6 1.9L12 17l-1.9-5.6L4.5 9.5l5.6-1.9L12 2zm7 12l.9 2.6 2.6.9-2.6.9L19 21l-.9-2.6-2.6-.9 2.6-.9L19 14z" />
            </svg>
          )}
          {running ? "Analyzing…" : analysis.status === "idle" ? "Explain with AI" : "Re-run AI"}
        </button>
      </div>

      {analysis.step && (
        <p className="flex items-center gap-2 px-5 pb-4 text-xs text-muted">
          <span className="h-2 w-2 animate-pulse rounded-full bg-accent shadow-[0_0_8px_var(--glow)]" />
          {analysis.step}
        </p>
      )}

      {analysis.summary && (
        <div className="mx-5 mb-5 rounded-xl border border-accent/30 bg-accent-soft p-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-accent-text">
            Period summary
          </p>
          <p className="mt-1.5 text-sm leading-relaxed text-fg">{analysis.summary.overview}</p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {analysis.summary.key_themes.map((t) => (
              <span key={t} className="rounded-full border border-border bg-surface px-2.5 py-0.5 text-xs text-muted">
                {t}
              </span>
            ))}
          </div>
          <p className="mt-3 text-xs text-subtle">{analysis.summary.caveats}</p>
        </div>
      )}

      {rows.length === 0 ? (
        <p className="px-5 pb-5 text-sm text-subtle">No unusual moves in this range. Try a longer range.</p>
      ) : (
        <div className="max-h-[480px] overflow-y-auto border-t border-border">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-surface text-left text-[11px] uppercase tracking-wider text-subtle">
              <tr>
                <th className="px-5 py-2.5 font-medium">Date</th>
                <th className="px-2 py-2.5 text-right font-medium">Move</th>
                {breakdown && <th className="hidden px-4 py-2.5 font-medium sm:table-cell">{breakdown.header}</th>}
                <th className="px-5 py-2.5 font-medium">Why (AI)</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => {
                const exp = analysis.explanations[m.date];
                const pending = running && !exp && analysis.explainDates.includes(m.date);
                const selected = m.date === selectedDate;
                return (
                  <tr
                    key={m.date}
                    onClick={() => onSelectDate(m.date)}
                    className={`cursor-pointer border-t border-border transition-colors ${
                      selected ? "bg-accent-soft" : "hover:bg-surface-2"
                    }`}
                  >
                    <td className="relative whitespace-nowrap px-5 py-3 text-fg">
                      {selected && <span className="absolute inset-y-0 left-0 w-0.5 bg-accent" />}
                      {shortDate(m.date)}
                    </td>
                    <td className={`whitespace-nowrap px-2 py-3 text-right font-semibold tabular-nums ${signColor(m.return_pct)}`}>
                      {pct(m.return_pct, 1)}
                    </td>
                    {breakdown && <td className="hidden px-4 py-3 sm:table-cell">{breakdown.render(m)}</td>}
                    {/* w-full + max-w-0 lets this column take the leftover width and truncate. */}
                    <td className="w-full max-w-0 px-5 py-3">
                      {exp ? (
                        <div className="flex min-w-0 items-center gap-2">
                          <DriverBadge driver={exp.primary_driver} />
                          <span className="truncate text-muted" title={exp.headline}>
                            {exp.headline}
                          </span>
                        </div>
                      ) : pending ? (
                        <span className="inline-block h-3 w-40 animate-pulse rounded bg-surface-3" />
                      ) : (
                        <span
                          className="text-xs text-subtle"
                          title="The AI explains the biggest moves; smaller ones are skipped to keep it fast."
                        >
                          {analysis.status === "done" ? "smaller move, not analyzed" : "—"}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {analysis.errors.length > 0 && (
        <ul className="space-y-1 border-t border-border px-5 py-3 text-xs text-down">
          {analysis.errors.map((err, i) => (
            <li key={i}>{err}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

export const STOCK_BREAKDOWN_HEADER = (
  <>
    <span className="text-info">Mkt</span> / <span className="text-violet">Sector</span> /{" "}
    <span className="text-accent-text">Company</span>
  </>
);

/** Stacked bar showing how much of a stock's move each factor explains. */
export function AttributionBar({ move }: { move: Move }) {
  const parts = [
    { value: move.market_pct ?? 0, color: "bg-info" },
    { value: move.sector_pct ?? 0, color: "bg-violet" },
    { value: move.company_pct, color: "bg-accent" },
  ];
  const total = parts.reduce((s, p) => s + Math.abs(p.value), 0) || 1;
  return (
    <div
      className="flex h-1.5 w-28 overflow-hidden rounded-full bg-surface-3"
      title={`Market ${pct(move.market_pct)} · Sector ${pct(move.sector_pct)} · Company ${pct(move.company_pct)}`}
    >
      {parts.map((p, i) => (
        <div key={i} className={p.color} style={{ width: `${(Math.abs(p.value) / total) * 100}%` }} />
      ))}
    </div>
  );
}
