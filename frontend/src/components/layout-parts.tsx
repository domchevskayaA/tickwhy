"use client";

import { useCallback, useRef, useState, type ReactNode } from "react";
import NewsList from "@/components/NewsList";
import { RangeTabs } from "@/components/ui";
import type { NewsItem, RangeKey } from "@/lib/api";
import { money, pct, shortDate, signColor } from "@/lib/format";

/** Selected day + scrolling the detail panel into view on narrow screens. */
export function useDateSelection() {
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const detailRef = useRef<HTMLDivElement>(null);
  const selectDate = useCallback((date: string) => {
    setSelectedDate(date);
    if (window.matchMedia("(max-width: 1023px)").matches) {
      requestAnimationFrame(() => detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    }
  }, []);
  return { selectedDate, setSelectedDate, selectDate, detailRef };
}

export function PageHeader({
  icon,
  eyebrow,
  title,
  code,
  subtitle,
  price,
  change,
  changePct,
  error,
}: {
  icon?: ReactNode;
  eyebrow?: ReactNode;
  title: string;
  code: string;
  subtitle?: ReactNode;
  price?: number | null;
  change?: number | null;
  changePct?: number | null;
  error?: string | null;
}) {
  return (
    <section className="flex flex-wrap items-end justify-between gap-4">
      <div className="flex min-w-0 items-center gap-4">
        {icon}
        <div className="min-w-0">
          {eyebrow}
          <h1 className="flex flex-wrap items-baseline gap-x-3 text-3xl font-semibold tracking-tight text-fg">
            {title}
            <span className="font-mono text-lg font-medium text-subtle">{code}</span>
          </h1>
          {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
          {error && <p className="mt-1 text-sm text-down">{error}</p>}
        </div>
      </div>
      {price != null && (
        <div className="sm:text-right">
          <p className="text-4xl font-semibold tracking-tight tabular-nums text-fg">{money(price)}</p>
          <p className={`mt-0.5 text-sm font-medium tabular-nums ${signColor(changePct)}`}>
            {change != null && `${change > 0 ? "+" : ""}${change.toFixed(2)} `}({pct(changePct)}) today
          </p>
        </div>
      )}
    </section>
  );
}

export function ChartCard({
  range,
  onRangeChange,
  stats,
  loading,
  error,
  errorTitle,
  legend,
  children,
}: {
  range: RangeKey;
  onRangeChange: (r: RangeKey) => void;
  stats?: ReactNode;
  loading: boolean;
  error: string | null;
  errorTitle: string;
  legend: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="card p-3 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <RangeTabs value={range} onChange={onRangeChange} />
        {stats && <div className="flex flex-wrap gap-1.5">{stats}</div>}
      </div>
      <div className="relative mt-4 min-h-[340px] sm:min-h-[420px]">
        {!error && <div className={`transition-opacity ${loading ? "opacity-40" : ""}`}>{children}</div>}
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="flex items-center gap-2 rounded-xl border border-border bg-surface px-3.5 py-2 text-sm text-muted shadow-lg">
              <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-border-strong border-t-accent" />
              Loading {range} prices…
            </span>
          </div>
        )}
        {error && (
          <div className="flex h-[340px] flex-col items-center justify-center gap-1 text-center sm:h-[420px]">
            <p className="text-sm font-medium text-down">{errorTitle}</p>
            <p className="max-w-md text-xs text-subtle">{error}</p>
          </div>
        )}
      </div>
      {!error && <p className="mt-3 text-xs text-subtle">{legend}</p>}
    </section>
  );
}

export function DetailHint({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-2xl border border-dashed border-border-strong p-5 text-sm text-subtle">{children}</p>
  );
}

export function NewsCard({
  selectedDate,
  items,
  loading,
  error,
  citedIds,
}: {
  selectedDate: string | null;
  items: NewsItem[];
  loading: boolean;
  error: string | null;
  citedIds?: Set<number>;
}) {
  return (
    <section className="card shrink-0 p-5">
      <div className="flex items-baseline justify-between">
        <h2 className="text-base font-semibold text-fg">News</h2>
        <span className="text-xs text-subtle">
          {selectedDate ? `around ${shortDate(selectedDate)}` : "last 2 weeks"}
        </span>
      </div>
      <div className="mt-2 max-h-[640px] overflow-y-auto pr-1 lg:max-h-none lg:overflow-visible">
        <NewsList items={items} loading={loading} error={error} highlightIds={citedIds} />
      </div>
    </section>
  );
}

/** Two-column page body: main content + an aside that sticks below the nav on desktop. */
export function PageColumns({ main, aside }: { main: ReactNode; aside: ReactNode }) {
  return (
    <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
      <div className="min-w-0 space-y-6">{main}</div>
      <aside className="flex flex-col gap-4 lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:self-start lg:overflow-y-auto">
        {aside}
      </aside>
    </div>
  );
}

export function Disclaimer() {
  return <p className="text-xs text-subtle">For learning about past price moves only — not investment advice.</p>;
}

export const MOVE_LEGEND = (
  <>
    <span className="text-up">▲</span>/<span className="text-down">▼</span> unusual moves
  </>
);
