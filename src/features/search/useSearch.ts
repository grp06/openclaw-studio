"use client";

import { useCallback, useRef, useState } from "react";
import type { SearchResponse, SearchResult } from "./types";

export type UseSearchReturn = {
  query: string;
  setQuery: (q: string) => void;
  results: SearchResult[];
  totalMatches: number;
  loading: boolean;
  error: string | null;
  search: (q?: string) => Promise<void>;
};

export function useSearch(
  gatewayUrl: string,
  token: string
): UseSearchReturn {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [totalMatches, setTotalMatches] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const search = useCallback(
    async (q?: string) => {
      const searchQuery = (q ?? query).trim();
      if (!searchQuery) return;

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams({
          q: searchQuery,
          gatewayUrl,
        });
        if (token) params.set("token", token);

        const res = await fetch(`/api/search?${params.toString()}`, {
          signal: controller.signal,
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(
            (data as { error?: string }).error ?? "Search failed"
          );
        }

        const data = (await res.json()) as SearchResponse;
        setResults(data.results);
        setTotalMatches(data.totalMatches);
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Search failed");
      } finally {
        setLoading(false);
      }
    },
    [query, gatewayUrl, token]
  );

  return { query, setQuery, results, totalMatches, loading, error, search };
}
