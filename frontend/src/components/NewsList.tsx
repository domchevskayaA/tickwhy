import type { NewsItem } from "@/lib/api";
import { timeAgo } from "@/lib/format";

interface Props {
  items: NewsItem[];
  loading: boolean;
  error: string | null;
  highlightIds?: Set<number>;
}

export default function NewsList({ items, loading, error, highlightIds }: Props) {
  if (loading) return <p className="text-sm text-subtle">Loading news…</p>;
  if (error) return <p className="text-sm text-down">{error}</p>;
  if (items.length === 0) return <p className="text-sm text-subtle">No news in this window.</p>;

  // News the AI cited goes first.
  const sorted = highlightIds?.size
    ? [...items].sort((a, b) => Number(highlightIds.has(b.id)) - Number(highlightIds.has(a.id)))
    : items;

  return (
    <ul className="divide-y divide-border">
      {sorted.map((n) => (
        <li key={n.id} className="py-3">
          <a href={n.url} target="_blank" rel="noopener noreferrer" className="group block">
            <p className="text-xs text-subtle">
              {n.source} · {timeAgo(n.datetime)}
              {n.market_wide && !highlightIds?.has(n.id) && (
                <span className="ml-2 rounded-md bg-surface-3 px-1.5 py-0.5 text-muted">market-wide</span>
              )}
              {highlightIds?.has(n.id) && (
                <span className="ml-2 rounded-md bg-accent-soft px-1.5 py-0.5 font-medium text-accent-text">
                  cited by AI
                </span>
              )}
            </p>
            <p className="mt-0.5 text-sm font-medium text-fg transition-colors group-hover:text-accent-text">
              {n.headline}
            </p>
            {n.summary && <p className="mt-1 line-clamp-2 text-xs text-muted">{n.summary}</p>}
          </a>
        </li>
      ))}
    </ul>
  );
}
