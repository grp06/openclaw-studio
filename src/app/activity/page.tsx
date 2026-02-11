"use client";

import { useGatewayConnectionContext } from "@/lib/gateway/GatewayConnectionContext";
import { useActivityFeed } from "@/features/activity/useActivityFeed";
import { ActivityEventList } from "@/features/activity/components/ActivityEventList";
import { ActivityFiltersBar } from "@/features/activity/components/ActivityFilters";

export default function ActivityPage() {
  const { client, status } = useGatewayConnectionContext();
  const {
    filteredEvents,
    filters,
    setAgentFilter,
    toggleEventType,
    clearFilters,
    agentIds,
  } = useActivityFeed(status === "connected" ? client : null);

  return (
    <div className="flex flex-col h-full bg-zinc-950">
      <header className="px-4 py-3 border-b border-zinc-800">
        <h1 className="text-lg font-semibold text-zinc-100">Activity Feed</h1>
        <p className="text-xs text-zinc-500 mt-0.5">
          Real-time gateway events
          {status !== "connected" && (
            <span className="ml-2 text-yellow-500">• Disconnected</span>
          )}
        </p>
      </header>
      <ActivityFiltersBar
        filters={filters}
        agentIds={agentIds}
        onAgentFilter={setAgentFilter}
        onToggleEventType={toggleEventType}
        onClear={clearFilters}
      />
      <ActivityEventList events={filteredEvents} />
    </div>
  );
}
