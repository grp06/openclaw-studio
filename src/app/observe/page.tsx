"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { createStudioSettingsCoordinator } from "@/lib/studio/coordinator";
import {
  useGatewayConnection,
  parseAgentIdFromSessionKey,
} from "@/lib/gateway/GatewayClient";
import type { EventFrame } from "@/lib/gateway/GatewayClient";
import { createRafBatcher } from "@/lib/dom";
import { mapEventFrameToEntry } from "@/features/observe/state/observeEventHandler";
import {
  observeReducer,
  initialObserveState,
} from "@/features/observe/state/reducer";
import type { SessionStatus } from "@/features/observe/state/types";
import { ObserveHeaderBar } from "@/features/observe/components/ObserveHeaderBar";
import { SessionOverview } from "@/features/observe/components/SessionOverview";
import { ActivityFeed } from "@/features/observe/components/ActivityFeed";
import { InterventionAlerts } from "@/features/observe/components/InterventionAlerts";
import { LiveOutputPanel } from "@/features/observe/components/LiveOutputPanel";

type SessionsListResult = {
  sessions: Array<{
    key: string;
    agentId?: string;
    displayName?: string;
    origin?: { label?: string };
    updatedAt?: number;
  }>;
};

const inferOrigin = (
  label?: string,
  key?: string
): SessionStatus["origin"] => {
  if (label) {
    const lower = label.toLowerCase();
    if (lower.includes("cron") || lower.includes("isolated")) return "cron";
    if (lower.includes("heartbeat")) return "heartbeat";
    if (lower.includes("interactive") || lower.includes("main"))
      return "interactive";
  }
  if (key) {
    const lowerKey = key.toLowerCase();
    if (lowerKey.includes("cron:") || lowerKey.includes("isolated"))
      return "cron";
    if (lowerKey.includes("heartbeat")) return "heartbeat";
  }
  return "unknown";
};

export default function ObservePage() {
  const [settingsCoordinator] = useState(() =>
    createStudioSettingsCoordinator()
  );
  const { client, status } = useGatewayConnection(settingsCoordinator);
  const [state, dispatch] = useReducer(observeReducer, initialObserveState);
  const [selectedSession, setSelectedSession] = useState<string | null>(null);

  const pendingEntriesRef = useRef<ReturnType<typeof mapEventFrameToEntry>[]>(
    []
  );

  // Subscribe to ALL gateway events with RAF batching
  useEffect(() => {
    const batcher = createRafBatcher(() => {
      const pending = pendingEntriesRef.current;
      if (pending.length === 0) return;
      pendingEntriesRef.current = [];
      const valid = pending.filter(
        (e): e is NonNullable<typeof e> => e !== null
      );
      if (valid.length > 0) {
        dispatch({ type: "pushEntries", entries: valid });
      }
    });

    const unsubscribe = client.onEvent((event: EventFrame) => {
      const entry = mapEventFrameToEntry(event);
      if (entry) {
        pendingEntriesRef.current.push(entry);
        batcher.schedule();
      }
    });
    return () => {
      unsubscribe();
      batcher.cancel();
    };
  }, [client]);

  // Discover sessions on connect
  useEffect(() => {
    if (status !== "connected") return;
    let cancelled = false;

    const loadSessions = async () => {
      try {
        const result = await client.call<SessionsListResult>(
          "sessions.list",
          {
            includeGlobal: true,
            includeUnknown: true,
            limit: 200,
          }
        );
        if (cancelled) return;
        const sessions: SessionStatus[] = (result.sessions ?? []).map(
          (s) => ({
            sessionKey: s.key,
            agentId: s.agentId ?? parseAgentIdFromSessionKey(s.key),
            displayName: s.displayName ?? s.agentId ?? null,
            origin: inferOrigin(s.origin?.label, s.key),
            status: "idle" as const,
            lastActivityAt: s.updatedAt ?? null,
            currentToolName: null,
            currentToolArgs: null,
            currentActivity: null,
            streamingText: null,
            lastError: null,
            eventCount: 0,
          })
        );
        dispatch({ type: "hydrateSessions", sessions });
      } catch (err) {
        console.warn("[observe] Failed to load sessions:", err);
      }
    };

    void loadSessions();
    return () => {
      cancelled = true;
    };
  }, [client, status]);

  // Refresh sessions on presence events (throttled)
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (status !== "connected") return;

    const unsubscribe = client.onEvent((event: EventFrame) => {
      if (event.event !== "presence") return;
      if (refreshTimerRef.current) return;
      refreshTimerRef.current = setTimeout(async () => {
        refreshTimerRef.current = null;
        try {
          const result = await client.call<SessionsListResult>(
            "sessions.list",
            {
              includeGlobal: true,
              includeUnknown: true,
              limit: 200,
            }
          );
          const sessions: SessionStatus[] = (result.sessions ?? []).map(
            (s) => ({
              sessionKey: s.key,
              agentId: s.agentId ?? parseAgentIdFromSessionKey(s.key),
              displayName: s.displayName ?? s.agentId ?? null,
              origin: inferOrigin(s.origin?.label, s.key),
              status: "idle" as const,
              lastActivityAt: s.updatedAt ?? null,
              currentToolName: null,
              currentToolArgs: null,
              currentActivity: null,
              streamingText: null,
              lastError: null,
              eventCount: 0,
            })
          );
          dispatch({ type: "hydrateSessions", sessions });
        } catch {
          // ignore refresh failures
        }
      }, 2000);
    });

    return () => {
      unsubscribe();
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
    };
  }, [client, status]);

  const handleTogglePause = useCallback(() => {
    dispatch({ type: "togglePause" });
  }, []);

  const handleClear = useCallback(() => {
    dispatch({ type: "clearLog" });
  }, []);

  const handleSelectSession = useCallback((sessionKey: string | null) => {
    setSelectedSession(sessionKey);
  }, []);

  // Find the primary running session for the live output panel
  const activeSession = useMemo(() => {
    if (selectedSession) {
      return state.sessions.find(
        (s) => s.sessionKey === selectedSession && s.status === "running"
      );
    }
    return state.sessions.find((s) => s.status === "running");
  }, [state.sessions, selectedSession]);

  return (
    <main className="mx-auto flex h-screen w-full max-w-[1800px] flex-col gap-3 p-3">
      <ObserveHeaderBar
        status={status}
        paused={state.paused}
        sessions={state.sessions}
        interventionCount={state.interventionCount}
        onTogglePause={handleTogglePause}
        onClear={handleClear}
      />

      <InterventionAlerts entries={state.entries} />

      <div className="flex min-h-0 flex-1 gap-3">
        {/* Session sidebar */}
        <div className="glass-panel hidden w-[300px] shrink-0 overflow-hidden rounded-xl lg:flex lg:flex-col">
          <SessionOverview
            sessions={state.sessions}
            selectedSession={selectedSession}
            onSelectSession={handleSelectSession}
          />
        </div>

        {/* Main content: live output + activity feed */}
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          {/* Live output panel — shows streaming text from active session */}
          {activeSession && (
            <LiveOutputPanel session={activeSession} />
          )}

          {/* Activity feed */}
          <div className="glass-panel flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl">
            <ActivityFeed
              entries={state.entries}
              sessionFilter={selectedSession}
            />
          </div>
        </div>
      </div>
    </main>
  );
}
