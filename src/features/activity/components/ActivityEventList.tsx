"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ActivityEvent } from "../types";
import { formatRelativeTime } from "@/lib/datetime/format";

const eventTypeColors: Record<string, string> = {
  chat: "text-blue-400",
  agent: "text-green-400",
  presence: "text-yellow-400",
  heartbeat: "text-purple-400",
  cron: "text-orange-400",
  system: "text-zinc-400",
};

type ActivityEventRowProps = {
  event: ActivityEvent;
};

function ActivityEventRow({ event }: ActivityEventRowProps) {
  const colorClass = eventTypeColors[event.type] ?? "text-zinc-400";

  return (
    <div
      className="flex items-start gap-3 px-4 py-2 border-b border-zinc-800/50 hover:bg-zinc-800/30 transition-colors"
      data-testid="activity-event-row"
      data-event-type={event.type}
    >
      <span className={`text-xs font-mono uppercase shrink-0 w-20 ${colorClass}`}>
        {event.type}
      </span>
      <div className="flex-1 min-w-0">
        <div className="text-sm text-zinc-200 truncate">{event.summary}</div>
        <div className="text-xs text-zinc-500 mt-0.5">
          {event.agentId && (
            <span className="mr-2 text-zinc-400">{event.agentId}</span>
          )}
          <span>{event.event}</span>
        </div>
      </div>
      <span className="text-xs text-zinc-500 shrink-0">
        {formatRelativeTime(event.timestampMs)}
      </span>
    </div>
  );
}

type ActivityEventListProps = {
  events: ActivityEvent[];
};

export function ActivityEventList({ events }: ActivityEventListProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isHovered, setIsHovered] = useState(false);
  const shouldAutoScroll = useRef(true);

  // Auto-scroll to top (newest events) when not hovered
  useEffect(() => {
    if (!isHovered && shouldAutoScroll.current && containerRef.current) {
      containerRef.current.scrollTop = 0;
    }
  }, [events.length, isHovered]);

  const handleMouseEnter = useCallback(() => {
    setIsHovered(true);
  }, []);

  const handleMouseLeave = useCallback(() => {
    setIsHovered(false);
    shouldAutoScroll.current = true;
  }, []);

  if (events.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-zinc-500 text-sm" data-testid="activity-empty">
        No events yet. Events will appear as they arrive from the gateway.
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="flex-1 overflow-y-auto"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      data-testid="activity-event-list"
    >
      {events.map((event) => (
        <ActivityEventRow key={event.id} event={event} />
      ))}
    </div>
  );
}
