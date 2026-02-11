"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { useGatewayConnectionContext } from "@/lib/gateway/GatewayConnectionContext";
import { useSearch } from "@/features/search/useSearch";
import { SearchInput } from "@/features/search/components/SearchInput";
import { SearchResults } from "@/features/search/components/SearchResults";

export default function SearchPage() {
  const { gatewayUrl, token, status } = useGatewayConnectionContext();
  const router = useRouter();
  const { query, setQuery, results, totalMatches, loading, error, search } =
    useSearch(gatewayUrl, token);

  const handleNavigate = useCallback(
    (agentId: string, _fileName: string) => {
      // Navigate to the main agent view — the agent page will handle file focus
      router.push(`/?agent=${encodeURIComponent(agentId)}`);
    },
    [router]
  );

  return (
    <div className="flex flex-col h-full bg-zinc-950">
      <header className="px-4 py-3 border-b border-zinc-800">
        <h1 className="text-lg font-semibold text-zinc-100">Search</h1>
        <p className="text-xs text-zinc-500 mt-0.5">
          Search across agent files
          {status !== "connected" && (
            <span className="ml-2 text-yellow-500">• Disconnected</span>
          )}
        </p>
      </header>

      <div className="px-4 py-3 border-b border-zinc-800">
        <SearchInput
          value={query}
          onChange={setQuery}
          onSearch={() => search()}
          loading={loading}
        />
      </div>

      {error && (
        <div className="px-4 py-2 bg-red-950/50 border-b border-red-900 text-red-400 text-xs">
          {error}
        </div>
      )}

      {results.length > 0 ? (
        <SearchResults
          results={results}
          totalMatches={totalMatches}
          onNavigate={handleNavigate}
        />
      ) : (
        !loading &&
        query && (
          <div className="flex items-center justify-center flex-1 text-zinc-500 text-sm" data-testid="search-empty">
            No results found for &ldquo;{query}&rdquo;
          </div>
        )
      )}

      {!query && !loading && results.length === 0 && (
        <div className="flex items-center justify-center flex-1 text-zinc-500 text-sm">
          Type a query and press Enter to search agent files.
        </div>
      )}
    </div>
  );
}
