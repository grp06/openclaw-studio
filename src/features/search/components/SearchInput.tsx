"use client";

import { useCallback, useRef, type KeyboardEvent } from "react";
import { Search } from "lucide-react";

type SearchInputProps = {
  value: string;
  onChange: (value: string) => void;
  onSearch: () => void;
  loading: boolean;
};

export function SearchInput({
  value,
  onChange,
  onSearch,
  loading,
}: SearchInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        onSearch();
      }
    },
    [onSearch]
  );

  return (
    <div className="relative" data-testid="search-input-container">
      <Search
        size={16}
        className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500"
      />
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Search agent files… (Cmd+K)"
        className="w-full bg-zinc-900 border border-zinc-700 text-zinc-200 text-sm rounded-md pl-9 pr-4 py-2 outline-none focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500 placeholder:text-zinc-500"
        aria-label="Search agent files"
        data-testid="search-input"
      />
      {loading && (
        <div className="absolute right-3 top-1/2 -translate-y-1/2">
          <div className="w-4 h-4 border-2 border-zinc-600 border-t-zinc-300 rounded-full animate-spin" />
        </div>
      )}
    </div>
  );
}
