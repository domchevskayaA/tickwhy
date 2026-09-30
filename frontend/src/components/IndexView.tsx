"use client";

import { useMemo, useState } from "react";
import { IndexDayDetail, SectorPanel, TopSectors } from "@/components/IndexParts";
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
import MovesPanel from "@/components/MovesPanel";
import NavBar from "@/components/NavBar";
import PriceChart from "@/components/PriceChart";
import { Stat } from "@/components/ui";
import {
  api,
  type IndexChartData,
  type IndexInfo,
  type NewsItem,
  type RangeKey,
  type SectorAttribution,
} from "@/lib/api";
import { addDays, pct, signColor, today } from "@/lib/format";
import { useAnalysis } from "@/lib/useAnalysis";
import { useFetch } from "@/lib/useFetch";

export default function IndexView({ id }: { id: string }) {
  const [range, setRange] = useState<RangeKey>("1Y");
  const { selectedDate, setSelectedDate, selectDate, detailRef } = useDateSelection();
  const { analysis, runAnalysis } = useAnalysis(`/api/indexes/${id}/analyze?range=${range}`);

  const info = useFetch<IndexInfo>(id, () => api.indexOverview(id));
  const chart = useFetch<IndexChartData>(`${id}:${range}`, () => api.indexChart(id, range));
  // Sector data is slower (11 ETFs), so it loads separately from the chart.
  const sectors = useFetch<SectorAttribution>(`sectors:${id}:${range}`, (signal) =>
    api.indexSectors(id, range, signal),
  );

  const [newsFrom, newsTo] = selectedDate
    ? [addDays(selectedDate, -3), addDays(selectedDate, 1)]
    : [addDays(today(), -14), today()];
  const news = useFetch<NewsItem[]>(`${id}:${newsFrom}:${newsTo}`, (signal) =>
    api.indexNews(id, newsFrom, newsTo, signal),
  );

  const attribution = sectors.loading ? null : sectors.data;
  const selectedMove = chart.data?.moves.find((m) => m.date === selectedDate);
  const selectedExplanation = selectedDate ? analysis.explanations[selectedDate] : undefined;
  const citedIds = useMemo(
    () => new Set(selectedExplanation?.supporting_news.map((n) => n.id) ?? []),
    [selectedExplanation],
  );

  const i = info.data;
  const stats = chart.data?.stats;
  const name = i?.name ?? id;

  return (
    <>
      <NavBar />
      <main className="mx-auto w-full max-w-7xl px-4 py-8">
        <PageHeader
          icon={
            <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl border border-accent/40 bg-accent-soft font-mono text-sm font-bold text-accent-text">
              {id}
            </span>
          }
          eyebrow={
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-accent-text">
              Index{i && ` · tracked via ${i.etf}`}
            </p>
          }
          title={name}
          code={id}
          subtitle={i?.description}
          error={info.error}
          price={i?.quote.price}
          change={i?.quote.change}
          changePct={i?.quote.change_pct}
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
                errorTitle={`Couldn't load prices for the ${name}`}
                legend={<>{MOVE_LEGEND} · click any day to see which sectors moved it · drag to pan</>}
                stats={
                  stats && (
                    <>
                      <Stat
                        label={range}
                        value={<span className={signColor(stats.return_pct)}>{pct(stats.return_pct, 1)}</span>}
                      />
                      {stats.typical_daily_move_pct != null && (
                        <Stat
                          label="Typical day"
                          value={`±${stats.typical_daily_move_pct.toFixed(2)}%`}
                          title="Standard deviation of daily returns over this range: most days move less than this."
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
                    earnings={[]}
                    selectedDate={selectedDate}
                    onSelectDate={selectDate}
                  />
                )}
              </ChartCard>

              <SectorPanel
                name={name}
                range={range}
                attribution={attribution}
                loading={sectors.loading}
                error={sectors.error}
              />

              {chart.data && !chart.error && (
                <MovesPanel
                  subject="index"
                  moves={chart.data.moves}
                  analysis={analysis}
                  onRunAnalysis={runAnalysis}
                  selectedDate={selectedDate}
                  onSelectDate={selectDate}
                  breakdown={{
                    header: "Biggest sectors",
                    render: (m) => <TopSectors attribution={attribution} date={m.date} />,
                  }}
                />
              )}
              <Disclaimer />
            </>
          }
          aside={
            <>
              <div ref={detailRef} className="scroll-mt-20">
                {selectedDate ? (
                  <IndexDayDetail
                    date={selectedDate}
                    candles={chart.data?.candles ?? []}
                    move={selectedMove}
                    attribution={attribution}
                    sectorsLoading={sectors.loading}
                    explanation={selectedExplanation}
                    onClose={() => setSelectedDate(null)}
                  />
                ) : (
                  <DetailHint>
                    Click a <span className="text-up">▲</span>/<span className="text-down">▼</span> marker on the
                    chart or a row in the moves list to see which sectors drove that day.
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
