"use client";

import { useEffect, useRef, useState } from "react";

interface Result<T> {
  key: string;
  data: T | null;
  error: string | null;
}

/**
 * Fetches whenever `key` changes. `loading` is derived from whether the stored
 * result belongs to the current key, so no state is reset inside the effect.
 */
export function useFetch<T>(key: string, fetcher: (signal: AbortSignal) => Promise<T>) {
  const [result, setResult] = useState<Result<T>>({ key: "", data: null, error: null });
  const fetcherRef = useRef(fetcher);

  useEffect(() => {
    fetcherRef.current = fetcher;
  });

  useEffect(() => {
    const controller = new AbortController();
    fetcherRef.current(controller.signal)
      .then((data) => setResult({ key, data, error: null }))
      .catch((e: Error) => {
        if (e.name !== "AbortError") setResult({ key, data: null, error: e.message });
      });
    return () => controller.abort();
  }, [key]);

  const current = result.key === key;
  return {
    // Keep showing the previous data while the next key loads.
    data: result.data,
    error: current ? result.error : null,
    loading: !current,
  };
}
