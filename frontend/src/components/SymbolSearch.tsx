"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, hrefFor, type SymbolResult } from "@/lib/api";

export default function SymbolSearch({
  autoFocus = false,
  compact = false,
  placeholder = "Search any US stock or index — e.g. NVDA, Tesla, S&P 500",
}: {
  autoFocus?: boolean;
  compact?: boolean;
  placeholder?: string;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SymbolResult[]>([]);
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchedFor, setSearchedFor] = useState("");

  useEffect(() => {
    const q = query.trim();
    if (!q) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      api
        .searchSymbols(q, controller.signal)
        .then((r) => {
          setResults(r);
          setSearchedFor(q);
          setActive(0);
          setError(null);
        })
        .catch((e) => {
          if (e.name !== "AbortError") setError(e.message);
        });
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  const go = (r: SymbolResult) => {
    setOpen(false);
    setQuery("");
    router.push(hrefFor(r));
  };

  const visible = query.trim() ? results : [];

  return (
    <div className="relative w-full">
      <svg
        viewBox="0 0 24 24"
        className={`pointer-events-none absolute top-1/2 -translate-y-1/2 text-subtle ${compact ? "left-3 h-4 w-4" : "left-4 h-5 w-5"}`}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      >
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </svg>
      <input
        autoFocus={autoFocus}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") setActive((a) => Math.min(a + 1, visible.length - 1));
          else if (e.key === "ArrowUp") setActive((a) => Math.max(a - 1, 0));
          else if (e.key === "Enter" && visible[active]) go(visible[active]);
          else if (e.key === "Escape") setOpen(false);
        }}
        placeholder={placeholder}
        className={`w-full rounded-xl border border-border bg-surface text-fg outline-none transition-shadow placeholder:text-subtle focus:border-accent focus:shadow-[0_0_0_3px_var(--accent-soft)] ${
          compact ? "h-10 pl-9 pr-3 text-sm" : "h-14 pl-12 pr-4 text-base"
        }`}
      />
      {open && query.trim() && (visible.length > 0 || error || searchedFor === query.trim()) && (
        <ul className="absolute z-40 mt-2 max-h-80 w-full overflow-auto rounded-xl border border-border bg-surface p-1 shadow-2xl shadow-black/20">
          {error && <li className="px-3 py-2 text-sm text-down">{error}</li>}
          {!error && visible.length === 0 && (
            <li className="px-3 py-2 text-sm text-subtle">No stocks or indexes match “{query.trim()}”</li>
          )}
          {visible.map((r, i) => (
            <li key={`${r.type}:${r.symbol}`}>
              <button
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => go(r)}
                onMouseEnter={() => setActive(i)}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left ${
                  i === active ? "bg-surface-2" : ""
                }`}
              >
                <span className="w-16 shrink-0 font-mono text-sm font-semibold text-fg">{r.symbol}</span>
                <span className="truncate text-sm text-muted">{r.name}</span>
                <span
                  className={`ml-auto shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
                    r.type === "Index" ? "bg-accent-soft text-accent-text" : "text-subtle"
                  }`}
                >
                  {r.type}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
