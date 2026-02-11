"use client";

import { useCallback, useEffect, useRef } from "react";
import { isNearBottom } from "@/lib/dom";
import type { ObserveEntry } from "../state/types";
import { ActivityFeedEntry } from "./ActivityFeedEntry";

type ActivityFeedProps = {
  entries: ObserveEntry[];
  sessionFilter: string | null;
};

export const ActivityFeed = ({ entries, sessionFilter }: ActivityFeedProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const shouldAutoScroll = useRef(true);

  const filtered = sessionFilter
    ? entries.filter((e) => e.sessionKey === sessionFilter)
    : entries;

  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    shouldAutoScroll.current = isNearBottom({
      scrollTop: el.scrollTop,
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
    });
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !shouldAutoScroll.current) return;
    el.scrollTop = el.scrollHeight;
  }, [filtered.length]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border/50 px-3 py-2">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Activity Feed
          {sessionFilter && (
            <span className="ml-2 text-primary/70">
              ({sessionFilter.slice(0, 20)})
            </span>
          )}
        </h2>
        <span className="font-mono text-[10px] text-muted-foreground/60">
          {filtered.length} events
        </span>
      </div>
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto"
      >
        {filtered.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground/50">
            Waiting for events...
          </div>
        ) : (
          filtered.map((entry) => (
            <ActivityFeedEntry key={entry.id} entry={entry} />
          ))
        )}
      </div>
    </div>
  );
};
