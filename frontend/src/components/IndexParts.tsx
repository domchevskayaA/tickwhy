import { DayCard, ExplanationBlock, MoveFacts } from "@/components/DayDetail";
import { DivergingBars, type BarRow } from "@/components/ui";
import type { BaseMove, Candle, MoveExplanation, SectorAttribution } from "@/lib/api";
import { pct, signColor } from "@/lib/format";

export const SHORT_SECTOR: Record<string, string> = {
  XLK: "Tech",
  XLF: "Financials",
  XLV: "Health",
  XLY: "Cons. disc.",
  XLC: "Comm.",
  XLI: "Industrials",
  XLP: "Staples",
  XLE: "Energy",
  XLU: "Utilities",
  XLRE: "Real estate",
  XLB: "Materials",
};

const SHOWN_SECTORS = 6;

/** Per-sector rows for one day (largest first), with the rest folded into "Other sectors". */
function dayRows(attribution: SectorAttribution, date: string): { rows: BarRow[]; falling: number } | null {
  const day = attribution.days[date];
  if (!day) return null;
  const sectors = attribution.sectors
    .map((s, i) => ({ ...s, contribution: day.contributions[i], etfReturn: day.etf_returns[i] }))
    .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));
  const shown = sectors.slice(0, SHOWN_SECTORS);
  const rest = sectors.slice(SHOWN_SECTORS);
  const rows: BarRow[] = shown.map((s) => ({
    label: s.name,
    value: s.contribution,
    title: `${s.etf} ${pct(s.etfReturn)} × est. weight ${((s.weight ?? 0) * 100).toFixed(0)}%`,
  }));
  if (rest.length) {
    rows.push({
      label: `${rest.length} other sectors`,
      value: rest.reduce((sum, s) => sum + s.contribution, 0),
      title: rest.map((s) => `${s.name} ${pct(s.contribution)}`).join(" · "),
    });
  }
  rows.push({
    label: "Not explained by sectors",
    value: day.residual_pct,
    color: "bg-border-strong",
  });
  return { rows, falling: day.etf_returns.filter((r) => r < 0).length };
}

export function IndexDayDetail({
  date,
  candles,
  move,
  attribution,
  sectorsLoading,
  explanation,
  onClose,
}: {
  date: string;
  candles: Candle[];
  move: BaseMove | undefined;
  attribution: SectorAttribution | null;
  sectorsLoading: boolean;
  explanation: MoveExplanation | undefined;
  onClose: () => void;
}) {
  const i = candles.findIndex((c) => c.time === date);
  const dayReturn = move?.return_pct ?? (i > 0 ? (candles[i].close / candles[i - 1].close - 1) * 100 : null);
  const breakdown = attribution ? dayRows(attribution, date) : null;

  return (
    <DayCard date={date} dayReturn={dayReturn} onClose={onClose}>
      {move ? (
        <MoveFacts move={move} />
      ) : (
        <p className="mt-1 text-xs text-subtle">A normal day for this index — within its usual range.</p>
      )}
      <div className="mt-5">
        <p className="mb-2.5 text-xs font-medium text-fg">Which sectors moved it</p>
        {breakdown ? (
          <>
            <DivergingBars rows={breakdown.rows} />
            <p className="mt-3 text-[11px] leading-snug text-subtle">
              {breakdown.falling} of {attribution!.sectors.length} sectors fell.{" "}
              {breakdown.falling >= 9 || breakdown.falling <= 2
                ? "A move this broad usually has a market-wide cause (economic data, the Fed, policy)."
                : "A mixed day: look at the biggest bars for where the move came from."}{" "}
              Each bar is the sector ETF&apos;s move × its estimated weight in the index.
            </p>
          </>
        ) : (
          <p className="text-xs text-subtle">
            {sectorsLoading ? "Loading sector data…" : "Sector data isn't available for this day."}
          </p>
        )}
      </div>
      {explanation && <ExplanationBlock explanation={explanation} />}
    </DayCard>
  );
}

/** "Tech −0.9 · Fin −0.3" — the two biggest sector contributions on a day. */
export function TopSectors({ attribution, date }: { attribution: SectorAttribution | null; date: string }) {
  const day = attribution?.days[date];
  if (!attribution || !day) return <span className="inline-block h-3 w-28 animate-pulse rounded bg-surface-3" />;
  const top = attribution.sectors
    .map((s, i) => ({ etf: s.etf, c: day.contributions[i] }))
    .sort((a, b) => Math.abs(b.c) - Math.abs(a.c))
    .slice(0, 2);
  return (
    <span className="whitespace-nowrap text-xs text-muted">
      {top.map((t, i) => (
        <span key={t.etf}>
          {i > 0 && " · "}
          {SHORT_SECTOR[t.etf] ?? t.etf} <span className={`tabular-nums ${signColor(t.c)}`}>{t.c > 0 ? "+" : ""}{t.c.toFixed(2)}</span>
        </span>
      ))}
    </span>
  );
}

/** How much each sector added to or took from the index over the whole range. */
export function SectorPanel({
  name,
  range,
  attribution,
  loading,
  error,
}: {
  name: string;
  range: string;
  attribution: SectorAttribution | null;
  loading: boolean;
  error: string | null;
}) {
  const period = attribution?.period;
  const rows: BarRow[] = period
    ? [
        ...attribution.sectors
          .map((s, i) => ({ s, c: period.contributions[i] }))
          .sort((a, b) => b.c - a.c)
          .map(({ s, c }) => ({
            label: (
              <>
                {s.name}
                {s.weight != null && <span className="ml-1.5 text-subtle">{(s.weight * 100).toFixed(0)}%</span>}
              </>
            ),
            value: c,
            title: `${s.etf} · estimated weight ${((s.weight ?? 0) * 100).toFixed(1)}%`,
          })),
        { label: "Not explained by sectors", value: period.residual_pct, color: "bg-border-strong" },
      ]
    : [];

  return (
    <section className="card p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold text-fg">
          What drove the {name} · {range}
        </h2>
        {attribution?.r2 != null && (
          <span
            className="cursor-help text-xs text-subtle"
            title="Share of the index's day-to-day moves that the 11 sector ETFs account for."
          >
            Sectors explain {(attribution.r2 * 100).toFixed(0)}% of daily moves
          </span>
        )}
      </div>
      <p className="mt-1 text-sm text-muted">
        Each sector&apos;s contribution to the index&apos;s return, added up day by day. The % next to each name is
        its estimated weight in the index.
      </p>
      <div className="mt-5">
        {loading && !attribution ? (
          <div className="space-y-2.5">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-2 animate-pulse rounded-full bg-surface-3" style={{ width: `${90 - i * 8}%` }} />
            ))}
            <p className="pt-2 text-xs text-subtle">
              Loading 11 sector ETFs. On the free data plan the first load can take about a minute, then it&apos;s
              cached.
            </p>
          </div>
        ) : error ? (
          <p className="text-sm text-down">{error}</p>
        ) : (
          <DivergingBars rows={rows} labelWidth="12rem" />
        )}
      </div>
    </section>
  );
}
