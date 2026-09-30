"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { streamAnalysis, type MoveExplanation, type PeriodSummary } from "@/lib/api";

export interface AnalysisState {
  key: string;
  status: "idle" | "running" | "done" | "error";
  step: string;
  /** Dates of the moves the agent is explaining. */
  explainDates: string[];
  explanations: Record<string, MoveExplanation>;
  summary: PeriodSummary | null;
  errors: string[];
}

const INITIAL: AnalysisState = {
  key: "",
  status: "idle",
  step: "",
  explainDates: [],
  explanations: {},
  summary: null,
  errors: [],
};

/**
 * Runs a LangGraph analysis and accumulates its streamed results.
 * `path` is the analyze endpoint; a new path resets the state.
 */
export function useAnalysis(path: string) {
  const key = path;
  const [state, setState] = useState<AnalysisState>(INITIAL);
  const abortRef = useRef<AbortController | null>(null);

  // A new symbol or range invalidates the running analysis.
  useEffect(() => () => abortRef.current?.abort(), [key]);

  const run = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setState({ ...INITIAL, key, status: "running", step: "Fetching prices, news and earnings…" });
    try {
      for await (const e of streamAnalysis(path, controller.signal)) {
        setState((s) => {
          switch (e.event) {
            case "gather_data":
              return {
                ...s,
                step:
                  e.data.news_count == null
                    ? "Detecting unusual moves and splitting them by sector…"
                    : `Detecting unusual moves (${e.data.news_count} news items loaded)…`,
                errors: [...s.errors, ...e.data.errors],
              };
            case "analyze_moves": {
              const n = e.data.explain_dates.length;
              return {
                ...s,
                explainDates: e.data.explain_dates,
                step: n ? `Claude is explaining the ${n} biggest moves…` : "Writing summary…",
              };
            }
            case "gather_news":
              return {
                ...s,
                step: `Read ${e.data.news_count} market headlines. Claude is explaining the ${s.explainDates.length} biggest moves…`,
                errors: [...s.errors, ...e.data.errors],
              };
            case "explain_move": {
              const explanations = { ...s.explanations };
              for (const x of e.data.explanations ?? []) explanations[x.date] = x;
              const done = Object.keys(explanations).length;
              return {
                ...s,
                explanations,
                errors: [...s.errors, ...(e.data.errors ?? [])],
                step:
                  done < s.explainDates.length
                    ? `Explained ${done} of ${s.explainDates.length} moves…`
                    : "Writing summary…",
              };
            }
            case "summarize":
              return {
                ...s,
                summary: e.data.summary ?? null,
                errors: [...s.errors, ...(e.data.errors ?? [])],
                step: "",
              };
            case "error":
              return { ...s, status: "error", step: "", errors: [...s.errors, e.data.message] };
            case "done":
              return { ...s, status: s.status === "error" ? "error" : "done", step: "" };
            default:
              return s;
          }
        });
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setState((s) => ({
          ...s,
          status: "error",
          step: "",
          errors: [...s.errors, (err as Error).message],
        }));
      }
    }
  }, [key, path]);

  // Results from a previous symbol/range are not shown.
  return { analysis: state.key === key ? state : INITIAL, runAnalysis: run };
}
