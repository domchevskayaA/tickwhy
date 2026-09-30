"use client";

import Link from "next/link";
import { api, type IndexInfo } from "@/lib/api";
import { money, pct, signColor } from "@/lib/format";
import { useFetch } from "@/lib/useFetch";

export default function MarketTiles() {
  const indexes = useFetch<IndexInfo[]>("indexes", () => api.indexes());

  if (indexes.error) return <p className="text-sm text-down">{indexes.error}</p>;

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {(indexes.data ?? Array.from({ length: 4 }, () => null)).map((i, n) =>
        i ? (
          <Link
            key={i.id}
            href={`/index/${i.id}`}
            className="group card relative overflow-hidden p-5 transition hover:-translate-y-0.5 hover:border-accent/60 hover:shadow-[0_8px_30px_-12px_var(--glow)]"
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-semibold text-fg">{i.name}</p>
                <p className="mt-0.5 font-mono text-xs text-subtle">
                  {i.id} · via {i.etf}
                </p>
              </div>
              <span
                className={`rounded-lg px-2 py-0.5 text-xs font-semibold tabular-nums ${
                  (i.quote.change_pct ?? 0) >= 0 ? "bg-accent-soft text-up" : "bg-down/10 text-down"
                }`}
              >
                {pct(i.quote.change_pct)}
              </span>
            </div>
            <p className="mt-4 text-2xl font-semibold tracking-tight tabular-nums text-fg">{money(i.quote.price)}</p>
            <p className={`text-xs tabular-nums ${signColor(i.quote.change)}`}>
              {i.quote.change != null && `${i.quote.change > 0 ? "+" : ""}${i.quote.change.toFixed(2)} today`}
            </p>
            <p className="mt-3 line-clamp-2 text-xs leading-relaxed text-muted">{i.description}</p>
            <span className="mt-4 inline-flex items-center gap-1 text-xs font-medium text-accent-text">
              Tickwhy
              <span className="transition-transform group-hover:translate-x-0.5">→</span>
            </span>
          </Link>
        ) : (
          <div key={n} className="card h-[196px] animate-pulse" />
        ),
      )}
    </div>
  );
}
