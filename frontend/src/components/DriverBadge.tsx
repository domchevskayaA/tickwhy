import type { Driver } from "@/lib/api";
import { DRIVER_LABELS } from "@/lib/format";

const STYLES: Record<Driver, string> = {
  market: "bg-info/12 text-info",
  sector: "bg-violet/12 text-violet",
  earnings: "bg-warn-soft text-warn",
  company_news: "bg-accent-soft text-accent-text",
  analyst_action: "bg-pink-500/12 text-pink-600 dark:text-pink-300",
  macro: "bg-cyan-500/12 text-cyan-700 dark:text-cyan-300",
  unclear: "bg-surface-3 text-muted",
  economic_data: "bg-cyan-500/12 text-cyan-700 dark:text-cyan-300",
  fed_rates: "bg-info/12 text-info",
  megacap_earnings: "bg-warn-soft text-warn",
  sector_move: "bg-violet/12 text-violet",
  policy_geopolitics: "bg-orange-500/12 text-orange-700 dark:text-orange-300",
  sentiment: "bg-pink-500/12 text-pink-600 dark:text-pink-300",
};

export default function DriverBadge({ driver }: { driver: Driver }) {
  return (
    <span
      className={`inline-block whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11px] font-medium ${STYLES[driver]}`}
    >
      {DRIVER_LABELS[driver]}
    </span>
  );
}
