export function pct(value: number | null | undefined, digits = 2): string {
  if (value == null || Number.isNaN(value)) return "—";
  const rounded = Number(value.toFixed(digits));
  if (rounded === 0) return `${(0).toFixed(digits)}%`; // avoid "-0.0%"
  return `${rounded > 0 ? "+" : ""}${rounded.toFixed(digits)}%`;
}

export function signColor(value: number | null | undefined): string {
  if (value == null || Math.abs(value) < 0.005) return "text-muted";
  return value > 0 ? "text-up" : "text-down";
}

export function money(value: number | null | undefined): string {
  if (value == null) return "—";
  return value.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export function marketCap(musd: number | null | undefined): string {
  if (!musd) return "—";
  if (musd >= 1_000_000) return `$${(musd / 1_000_000).toFixed(2)}T`;
  if (musd >= 1_000) return `$${(musd / 1_000).toFixed(1)}B`;
  return `$${musd.toFixed(0)}M`;
}

export function shortDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function timeAgo(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Add days to a YYYY-MM-DD date string. */
export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export const DRIVER_LABELS: Record<string, string> = {
  market: "Market-wide",
  sector: "Sector",
  earnings: "Earnings",
  company_news: "Company news",
  analyst_action: "Analyst action",
  macro: "Macro",
  unclear: "Unclear",
  economic_data: "Economic data",
  fed_rates: "Fed & interest rates",
  megacap_earnings: "Big-company earnings",
  sector_move: "Sector move",
  policy_geopolitics: "Policy & geopolitics",
  sentiment: "Market sentiment",
};

/** "NASDAQ NMS - GLOBAL MARKET" → "NASDAQ", "NEW YORK STOCK EXCHANGE, INC." → "NYSE". */
export function exchangeName(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const upper = raw.toUpperCase();
  if (upper.startsWith("NASDAQ")) return "NASDAQ";
  if (upper.startsWith("NEW YORK STOCK EXCHANGE")) return "NYSE";
  return raw.split(" - ")[0];
}
