"use client";

import type { SearchResult } from "../types";
import { FileText } from "lucide-react";

type SearchResultRowProps = {
  result: SearchResult;
  onNavigate: (agentId: string, fileName: string) => void;
};

function SearchResultRow({ result, onNavigate }: SearchResultRowProps) {
  return (
    <button
      onClick={() => onNavigate(result.agentId, result.fileName)}
      className="w-full text-left px-4 py-3 border-b border-zinc-800/50 hover:bg-zinc-800/30 transition-colors group"
      data-testid="search-result-row"
    >
      <div className="flex items-center gap-2 mb-1">
        <FileText size={14} className="text-zinc-500 shrink-0" />
        <span className="text-sm text-zinc-300 font-medium">
          {result.agentId}
        </span>
        <span className="text-xs text-zinc-500">/ {result.fileName}</span>
        <span className="text-xs text-zinc-600 ml-auto">
          line {result.lineNumber}
        </span>
      </div>
      <div className="ml-5">
        <pre className="text-xs text-zinc-400 font-mono whitespace-pre-wrap overflow-hidden max-h-16 leading-relaxed">
          {result.snippet}
        </pre>
      </div>
    </button>
  );
}

type SearchResultsProps = {
  results: SearchResult[];
  totalMatches: number;
  onNavigate: (agentId: string, fileName: string) => void;
};

export function SearchResults({
  results,
  totalMatches,
  onNavigate,
}: SearchResultsProps) {
  if (results.length === 0) {
    return null;
  }

  return (
    <div className="flex-1 overflow-y-auto" data-testid="search-results">
      <div className="px-4 py-2 text-xs text-zinc-500 border-b border-zinc-800">
        {totalMatches} match{totalMatches !== 1 ? "es" : ""} found
        {totalMatches > 100 && " (showing first 100)"}
      </div>
      {results.map((result, i) => (
        <SearchResultRow
          key={`${result.agentId}-${result.fileName}-${result.lineNumber}-${i}`}
          result={result}
          onNavigate={onNavigate}
        />
      ))}
    </div>
  );
}
