import DriverBadge from "@/components/DriverBadge";
import { DivergingBars, SectionLabel } from "@/components/ui";
import type { Candle, Earnings, Move, MoveExplanation } from "@/lib/api";
import { pct, shortDate, signColor } from "@/lib/format";

interface Props {
  date: string;
  candles: Candle[];
  move: Move | undefined;
  earnings: Earnings | undefined;
  explanation: MoveExplanation | undefined;
  sectorEtf: string | null;
  onClose: () => void;
}

export default function DayDetail({ date, candles, move, earnings, explanation, sectorEtf, onClose }: Props) {
  const i = candles.findIndex((c) => c.time === date);
  const dayReturn = move?.return_pct ?? (i > 0 ? (candles[i].close / candles[i - 1].close - 1) * 100 : null);

  return (
    <DayCard date={date} dayReturn={dayReturn} onClose={onClose}>
      {move ? (
        <>
          <MoveFacts move={move} />
          <div className="mt-5">
            <p className="mb-2.5 text-xs font-medium text-fg">Where the move came from</p>
            <DivergingBars
              rows={[
                { label: "Whole market (SPY)", value: move.market_pct, color: "bg-info" },
                { label: `Sector (${sectorEtf ?? "n/a"})`, value: move.sector_pct, color: "bg-violet" },
                { label: "This company", value: move.company_pct, color: "bg-accent" },
              ]}
            />
            <p className="mt-3 text-[11px] leading-snug text-subtle">
              Estimated from how this stock usually moves with the market and its sector. The company
              part is what news or earnings would need to explain.
            </p>
          </div>
        </>
      ) : (
        <p className="mt-1 text-xs text-subtle">A normal day for this stock — within its usual range.</p>
      )}

      {earnings && (
        <div className="mt-4 rounded-xl bg-warn-soft px-3 py-2.5 text-xs text-warn">
          <span className="font-semibold">Earnings</span>
          {earnings.hour === "bmo" ? " before the open" : earnings.hour === "amc" ? " after the close" : ""}
          {earnings.eps_actual != null && earnings.eps_estimate != null && (
            <>
              {" "}
              · EPS {earnings.eps_actual} vs {earnings.eps_estimate} expected (
              {earnings.eps_actual >= earnings.eps_estimate ? "beat" : "miss"})
            </>
          )}
        </div>
      )}

      {explanation && <ExplanationBlock explanation={explanation} />}
    </DayCard>
  );
}

export function DayCard({
  date,
  dayReturn,
  onClose,
  children,
}: {
  date: string;
  dayReturn: number | null;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className="card relative overflow-hidden p-5">
      <div className="absolute inset-x-0 top-0 h-0.5 bg-accent shadow-[0_0_12px_var(--glow)]" />
      <div className="flex items-start justify-between gap-2">
        <div>
          <SectionLabel>What happened</SectionLabel>
          <h3 className="mt-0.5 text-lg font-semibold text-fg">{shortDate(date)}</h3>
        </div>
        <div className="flex items-start gap-3">
          <span className={`text-2xl font-semibold tabular-nums ${signColor(dayReturn)}`}>{pct(dayReturn)}</span>
          <button
            onClick={onClose}
            aria-label="Close"
            className="grid h-7 w-7 place-items-center rounded-lg text-subtle hover:bg-surface-2 hover:text-fg"
          >
            ✕
          </button>
        </div>
      </div>
      {children}
    </section>
  );
}

export function MoveFacts({ move }: { move: { z_score: number; volume_ratio: number | null; gap_pct: number; intraday_pct: number } }) {
  return (
    <p className="mt-1 text-xs text-subtle">
      {Math.abs(move.z_score).toFixed(1)}× a typical day · volume{" "}
      {move.volume_ratio ? `${move.volume_ratio.toFixed(1)}×` : "—"} average · opened {pct(move.gap_pct, 1)}, then{" "}
      {pct(move.intraday_pct, 1)} during the day
    </p>
  );
}

export function ExplanationBlock({ explanation }: { explanation: MoveExplanation }) {
  return (
    <div className="mt-5 border-t border-border pt-4">
      <div className="flex flex-wrap items-center gap-2">
        <DriverBadge driver={explanation.primary_driver} />
        <span className="text-[11px] text-subtle">{explanation.confidence} confidence · AI</span>
      </div>
      <p className="mt-2 text-sm font-semibold text-fg">{explanation.headline}</p>
      <p className="mt-1.5 text-sm leading-relaxed text-muted">{explanation.explanation}</p>
    </div>
  );
}
