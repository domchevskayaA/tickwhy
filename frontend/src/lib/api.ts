export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export const RANGES = ["1M", "3M", "6M", "1Y", "2Y", "5Y"] as const;
export type RangeKey = (typeof RANGES)[number];

export interface SymbolResult {
  symbol: string;
  name: string;
  type: string;
}

export interface Overview {
  symbol: string;
  name: string;
  industry: string | null;
  exchange: string | null;
  logo: string | null;
  weburl: string | null;
  market_cap_musd: number | null;
  sector_etf: string | null;
  quote: { price: number | null; change: number | null; change_pct: number | null };
}

export interface Candle {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** An unusually large daily move (stocks and indexes). */
export interface BaseMove {
  date: string;
  return_pct: number;
  z_score: number;
  volume_ratio: number | null;
  gap_pct: number;
  intraday_pct: number;
  close: number;
}

/** A stock move with its market / sector / company split. */
export interface Move extends BaseMove {
  market_pct: number | null;
  sector_pct: number | null;
  company_pct: number;
  market_etf_pct: number | null;
  sector_etf_pct: number | null;
}

export interface Earnings {
  date: string;
  hour: string;
  eps_actual: number | null;
  eps_estimate: number | null;
  revenue_actual: number | null;
  revenue_estimate: number | null;
}

export interface PeriodStats {
  return_pct: number | null;
  typical_daily_move_pct: number | null;
  benchmark_returns_pct: Record<string, number | null>;
  beta_market: number | null;
  beta_sector: number | null;
  r2: number | null;
  sector_etf: string | null;
  moves_detected: number;
}

export interface ChartData {
  symbol: string;
  range: RangeKey;
  candles: Candle[];
  moves: Move[];
  stats: PeriodStats;
  earnings: Earnings[];
}

export interface NewsItem {
  id: number;
  datetime: number;
  headline: string;
  summary: string;
  source: string;
  url: string;
  image: string;
  /** Index news only: the story is about the market as a whole. */
  market_wide?: boolean;
}

export type StockDriver =
  | "market"
  | "sector"
  | "earnings"
  | "company_news"
  | "analyst_action"
  | "macro"
  | "unclear";

export type IndexDriver =
  | "economic_data"
  | "fed_rates"
  | "megacap_earnings"
  | "sector_move"
  | "policy_geopolitics"
  | "sentiment"
  | "unclear";

export type Driver = StockDriver | IndexDriver;

export interface IndexInfo {
  id: string;
  name: string;
  etf: string;
  description: string;
  quote: { price: number | null; change: number | null; change_pct: number | null };
}

export interface IndexChartData {
  id: string;
  range: RangeKey;
  candles: Candle[];
  moves: BaseMove[];
  stats: { return_pct: number | null; typical_daily_move_pct: number | null; moves_detected: number };
}

export interface SectorDay {
  return_pct: number;
  /** Per-sector contribution to the index's return, in %, in `sectors` order. */
  contributions: number[];
  etf_returns: number[];
  residual_pct: number;
}

export interface SectorAttribution {
  sectors: { etf: string; name: string; weight: number | null }[];
  r2: number | null;
  days: Record<string, SectorDay>;
  period: { contributions: number[]; residual_pct: number; sum_return_pct: number } | null;
  errors: string[];
}

export interface MoveExplanation {
  date: string;
  primary_driver: Driver;
  headline: string;
  explanation: string;
  confidence: "low" | "medium" | "high";
  supporting_news: Pick<NewsItem, "id" | "headline" | "source" | "url" | "datetime">[];
}

export interface PeriodSummary {
  overview: string;
  key_themes: string[];
  caveats: string;
}

async function getJSON<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, { signal });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail ?? `Request failed (${res.status})`);
  }
  return res.json();
}

export const api = {
  health: () => getJSON<{ finnhub: boolean; twelvedata: boolean; model: string }>("/api/health"),
  searchSymbols: (q: string, signal?: AbortSignal) =>
    getJSON<SymbolResult[]>(`/api/symbols/search?q=${encodeURIComponent(q)}`, signal),
  overview: (symbol: string) => getJSON<Overview>(`/api/stocks/${symbol}/overview`),
  chart: (symbol: string, range: RangeKey) =>
    getJSON<ChartData>(`/api/stocks/${symbol}/chart?range=${range}`),
  news: (symbol: string, from: string, to: string, signal?: AbortSignal) =>
    getJSON<NewsItem[]>(`/api/stocks/${symbol}/news?from=${from}&to=${to}`, signal),

  indexes: () => getJSON<IndexInfo[]>("/api/indexes"),
  indexOverview: (id: string) => getJSON<IndexInfo>(`/api/indexes/${id}/overview`),
  indexChart: (id: string, range: RangeKey) =>
    getJSON<IndexChartData>(`/api/indexes/${id}/chart?range=${range}`),
  indexSectors: (id: string, range: RangeKey, signal?: AbortSignal) =>
    getJSON<SectorAttribution>(`/api/indexes/${id}/sectors?range=${range}`, signal),
  indexNews: (id: string, from: string, to: string, signal?: AbortSignal) =>
    getJSON<NewsItem[]>(`/api/indexes/${id}/news?from=${from}&to=${to}`, signal),
};

/** Where a search result or tile links to. */
export function hrefFor(result: { symbol: string; type: string }): string {
  return result.type === "Index"
    ? `/index/${encodeURIComponent(result.symbol)}`
    : `/stock/${encodeURIComponent(result.symbol)}`;
}

export type AnalysisEvent =
  | { event: "gather_data"; data: { news_count: number | null; errors: string[] } }
  | { event: "analyze_moves"; data: { moves: BaseMove[]; explain_dates: string[] } }
  | { event: "gather_news"; data: { news_count: number; errors: string[] } }
  | { event: "explain_move"; data: { explanations?: MoveExplanation[]; errors?: string[] } }
  | { event: "summarize"; data: { summary?: PeriodSummary; errors?: string[] } }
  | { event: "error"; data: { message: string } }
  | { event: "done"; data: Record<string, never> };

/** Runs a LangGraph analysis (e.g. `/api/stocks/NVDA/analyze?range=1Y`) and yields its events. */
export async function* streamAnalysis(path: string, signal: AbortSignal): AsyncGenerator<AnalysisEvent> {
  const res = await fetch(`${API_URL}${path}`, { method: "POST", signal });
  if (!res.ok || !res.body) throw new Error(`Analysis failed (${res.status})`);

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let sep: number;
    while ((sep = buffer.indexOf("\n\n")) !== -1) {
      const raw = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      const event = raw.match(/^event: (.*)$/m)?.[1];
      const data = raw.match(/^data: (.*)$/m)?.[1];
      if (event && data) yield { event, data: JSON.parse(data) } as AnalysisEvent;
    }
  }
}
