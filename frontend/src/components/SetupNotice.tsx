"use client";

import { api } from "@/lib/api";
import { useFetch } from "@/lib/useFetch";

/** Shown when the backend has no market-data keys, instead of leaving users with bare errors. */
export default function SetupNotice() {
  const health = useFetch("health", () => api.health());
  if (!health.data) return null;
  const missing = [
    !health.data.finnhub && { key: "FINNHUB_API_KEY", url: "https://finnhub.io/register" },
    !health.data.twelvedata && { key: "TWELVEDATA_API_KEY", url: "https://twelvedata.com/pricing" },
  ].filter(Boolean) as { key: string; url: string }[];
  if (!missing.length) return null;

  return (
    <div className="border-t border-warn/30 bg-warn-soft">
      <p className="mx-auto w-full max-w-7xl px-4 py-2 text-xs leading-relaxed text-warn">
        <span className="font-semibold">Market data isn&apos;t connected.</span> Add{" "}
        {missing.map((m, i) => (
          <span key={m.key}>
            {i > 0 && " and "}
            <a href={m.url} target="_blank" rel="noopener noreferrer" className="font-mono underline underline-offset-2">
              {m.key}
            </a>
          </span>
        ))}{" "}
        (free) to <code className="font-mono">backend/.env</code>, then restart the backend.
      </p>
    </div>
  );
}
