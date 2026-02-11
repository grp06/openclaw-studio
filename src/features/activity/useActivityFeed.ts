"use client";

import { useCallback, useRef, useState } from "react";
import type { GatewayClient, EventFrame } from "@/lib/gateway/GatewayClient";
import { useGatewayEvents } from "@/lib/gateway/useGatewayEvents";
import { mapFrameToActivityEvent } from "./eventMapper";
import type { ActivityEvent, ActivityEventType } from "./types";

const MAX_EVENTS = 500;

export type ActivityFilters = {
  agentId: string | null;
  eventTypes: Set<ActivityEventType>;
};

export type UseActivityFeedReturn = {
  events: ActivityEvent[];
  filteredEvents: ActivityEvent[];
  filters: ActivityFilters;
  setAgentFilter: (agentId: string | null) => void;
  toggleEventType: (type: ActivityEventType) => void;
  clearFilters: () => void;
  agentIds: string[];
};

const ALL_EVENT_TYPES = new Set<ActivityEventType>([
  "chat",
  "agent",
  "presence",
  "heartbeat",
  "cron",
  "system",
]);

export function useActivityFeed(
  client: GatewayClient | null | undefined
): UseActivityFeedReturn {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [filters, setFilters] = useState<ActivityFilters>({
    agentId: null,
    eventTypes: new Set(ALL_EVENT_TYPES),
  });
  const agentIdSetRef = useRef(new Set<string>());
  const [agentIds, setAgentIds] = useState<string[]>([]);

  const handleEvent = useCallback((frame: EventFrame) => {
    const activityEvent = mapFrameToActivityEvent(frame);
    setEvents((prev) => {
      const next = [activityEvent, ...prev];
      return next.length > MAX_EVENTS ? next.slice(0, MAX_EVENTS) : next;
    });
    if (activityEvent.agentId && !agentIdSetRef.current.has(activityEvent.agentId)) {
      agentIdSetRef.current.add(activityEvent.agentId);
      setAgentIds(Array.from(agentIdSetRef.current).sort());
    }
  }, []);

  useGatewayEvents(client, null, handleEvent);

  const filteredEvents = events.filter((e) => {
    if (filters.agentId && e.agentId !== filters.agentId) return false;
    if (!filters.eventTypes.has(e.type)) return false;
    return true;
  });

  const setAgentFilter = useCallback((agentId: string | null) => {
    setFilters((f) => ({ ...f, agentId }));
  }, []);

  const toggleEventType = useCallback((type: ActivityEventType) => {
    setFilters((f) => {
      const next = new Set(f.eventTypes);
      if (next.has(type)) {
        next.delete(type);
      } else {
        next.add(type);
      }
      return { ...f, eventTypes: next };
    });
  }, []);

  const clearFilters = useCallback(() => {
    setFilters({ agentId: null, eventTypes: new Set(ALL_EVENT_TYPES) });
  }, []);

  return {
    events,
    filteredEvents,
    filters,
    setAgentFilter,
    toggleEventType,
    clearFilters,
    agentIds,
  };
}
