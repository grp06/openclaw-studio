"use client";

import type { ActivityEventType, ActivityEvent } from "../types";
import type { ActivityFilters as ActivityFiltersType } from "../useActivityFeed";

const EVENT_TYPES: ActivityEventType[] = [
  "chat",
  "agent",
  "presence",
  "heartbeat",
  "cron",
  "system",
];

type ActivityFiltersProps = {
  filters: ActivityFiltersType;
  agentIds: string[];
  onAgentFilter: (agentId: string | null) => void;
  onToggleEventType: (type: ActivityEventType) => void;
  onClear: () => void;
};

export function ActivityFiltersBar({
  filters,
  agentIds,
  onAgentFilter,
  onToggleEventType,
  onClear,
}: ActivityFiltersProps) {
  return (
    <div
      className="flex items-center gap-3 px-4 py-2 border-b border-zinc-800 bg-zinc-950/80"
      data-testid="activity-filters"
    >
      {/* Agent filter */}
      <select
        className="bg-zinc-900 border border-zinc-700 text-zinc-300 text-xs rounded px-2 py-1 outline-none focus:border-zinc-500"
        value={filters.agentId ?? ""}
        onChange={(e) => onAgentFilter(e.target.value || null)}
        aria-label="Filter by agent"
      >
        <option value="">All agents</option>
        {agentIds.map((id) => (
          <option key={id} value={id}>
            {id}
          </option>
        ))}
      </select>

      {/* Event type toggles */}
      <div className="flex items-center gap-1">
        {EVENT_TYPES.map((type) => {
          const active = filters.eventTypes.has(type);
          return (
            <button
              key={type}
              onClick={() => onToggleEventType(type)}
              className={`text-xs px-2 py-0.5 rounded transition-colors ${
                active
                  ? "bg-zinc-700 text-zinc-200"
                  : "bg-zinc-900 text-zinc-500 hover:text-zinc-300"
              }`}
              aria-pressed={active}
              data-testid={`filter-${type}`}
            >
              {type}
            </button>
          );
        })}
      </div>

      <button
        onClick={onClear}
        className="text-xs text-zinc-500 hover:text-zinc-300 ml-auto"
        data-testid="filter-clear"
      >
        Clear
      </button>
    </div>
  );
}
