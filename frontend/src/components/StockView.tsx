"use client";

import { useMemo, useState } from "react";
import DayDetail from "@/components/DayDetail";
import {
  ChartCard,
  DetailHint,
  Disclaimer,
  MOVE_LEGEND,
  NewsCard,
  PageColumns,
  PageHeader,
  useDateSelection,
} from "@/components/layout-parts";
import MovesPanel, { AttributionBar, STOCK_BREAKDOWN_HEADER } from "@/components/MovesPanel";
import NavBar from "@/components/NavBar";
import PriceChart from "@/components/PriceChart";
import { Stat } from "@/components/ui";
import { api, type ChartData, type NewsItem, type Overview, type RangeKey } from "@/lib/api";
import { addDays, exchangeName, marketCap, pct, signColor, today } from "@/lib/format";
import { useAnalysis } from "@/lib/useAnalysis";
import { useFetch } from "@/lib/useFetch";

export default function StockView({ symbol }: { symbol: string }) {
  const [range, setRange] = useState<RangeKey>("1Y");
  const { selectedDate, setSelectedDate, selectDate, detailRef } = useDateSelection();
  const { analysis, runAnalysis } = useAnalysis(`/api/stocks/${symbol}/analyze?range=${range}`);

  const overview = useFetch<Overview>(symbol, () => api.overview(symbol));
  const chart = useFetch<ChartData>(`${symbol}:${range}`, () => api.chart(symbol, range));

  // News window: around the selected day, or the last two weeks.
  const [newsFrom, newsTo] = selectedDate
    ? [addDays(selectedDate, -3), addDays(selectedDate, 1)]
    : [addDays(today(), -14), today()];
  const news = useFetch<NewsItem[]>(`${symbol}:${newsFrom}:${newsTo}`, (signal) =>
    api.news(symbol, newsFrom, newsTo, signal),
  );

  const selectedMove = chart.data?.moves.find((m) => m.date === selectedDate);
  const selectedEarnings = chart.data?.earnings.find((e) => e.date === selectedDate);
  const selectedExplanation = selectedDate ? analysis.explanations[selectedDate] : undefined;
  const citedIds = useMemo(
    () => new Set(selectedExplanation?.supporting_news.map((n) => n.id) ?? []),
    [selectedExplanation],
  );

  const o = overview.data;
  const stats = chart.data?.stats;

  return (
    <>
      <NavBar />
      <main className="mx-auto w-full max-w-7xl px-4 py-8">
        <PageHeader
          icon={
            o?.logo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={o.logo} alt="" className="h-14 w-14 rounded-2xl border border-border bg-white object-contain p-2" />
            ) : (
              <span className="grid h-14 w-14 place-items-center rounded-2xl border border-border bg-surface-2 font-mono text-sm font-semibold text-muted">
                {symbol.slice(0, 4)}
              </span>
            )
          }
          title={o?.name ?? symbol}
          code={symbol}
          subtitle={[o?.industry, exchangeName(o?.exchange), o && `Mkt cap ${marketCap(o.market_cap_musd)}`]
            .filter(Boolean)
            .join(" · ")}
          error={overview.error}
          price={o?.quote.price}
          change={o?.quote.change}
          changePct={o?.quote.change_pct}
        />

        <PageColumns
          main={
            <>
              <ChartCard
                range={range}
                onRangeChange={(r) => {
                  setRange(r);
                  setSelectedDate(null);
                }}
                loading={chart.loading}
                error={chart.error}
                errorTitle={`Couldn't load prices for ${symbol}`}
                legend={
                  <>
                    {MOVE_LEGEND} · <span className="text-warn">●E</span> earnings · click any day to see what
                    happened · drag to pan
                  </>
                }
                stats={
                  stats && (
                    <>
                      <Stat label={symbol} value={<span className={signColor(stats.return_pct)}>{pct(stats.return_pct, 1)}</span>} />
                      {Object.entries(stats.benchmark_returns_pct).map(([t, v]) => (
                        <Stat key={t} label={t} value={<span className={signColor(v)}>{pct(v, 1)}</span>} />
                      ))}
                      {stats.beta_market != null && (
                        <Stat
                          label="β"
                          value={stats.beta_market.toFixed(2)}
                          title={`Beta: on a typical day this stock moves about ${stats.beta_market.toFixed(1)}% when SPY moves 1%.`}
                        />
                      )}
                    </>
                  )
                }
              >
                {chart.data && (
                  <PriceChart
                    candles={chart.data.candles}
                    moves={chart.data.moves}
                    earnings={chart.data.earnings}
                    selectedDate={selectedDate}
                    onSelectDate={selectDate}
                  />
                )}
              </ChartCard>

              {chart.data && !chart.error && (
                <MovesPanel
                  subject="stock"
                  moves={chart.data.moves}
                  analysis={analysis}
                  onRunAnalysis={runAnalysis}
                  selectedDate={selectedDate}
                  onSelectDate={selectDate}
                  breakdown={{ header: STOCK_BREAKDOWN_HEADER, render: (m) => <AttributionBar move={m} /> }}
                />
              )}
              <Disclaimer />
            </>
          }
          aside={
            <>
              <div ref={detailRef} className="scroll-mt-20">
                {selectedDate ? (
                  <DayDetail
                    date={selectedDate}
                    candles={chart.data?.candles ?? []}
                    move={selectedMove}
                    earnings={selectedEarnings}
                    explanation={selectedExplanation}
                    sectorEtf={stats?.sector_etf ?? null}
                    onClose={() => setSelectedDate(null)}
                  />
                ) : (
                  <DetailHint>
                    Click a <span className="text-up">▲</span>/<span className="text-down">▼</span> marker on the
                    chart or a row in the moves list to see what drove that day.
                  </DetailHint>
                )}
              </div>
              <NewsCard
                selectedDate={selectedDate}
                items={news.data ?? []}
                loading={news.loading}
                error={news.error}
                citedIds={citedIds}
              />
            </>
          }
        />
      </main>
    </>
  );
}
