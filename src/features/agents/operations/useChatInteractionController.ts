import { useCallback, useEffect, useRef, useState } from "react";

import { createRafBatcher } from "@/lib/dom";
import {
  planDraftFlushIntent,
  planDraftTimerIntent,
  planNewSessionIntent,
  planStopRunIntent,
} from "@/features/agents/operations/chatInteractionWorkflow";
import { sendChatMessageViaStudio } from "@/features/agents/operations/chatSendOperation";
import { mergePendingLivePatch } from "@/features/agents/state/livePatchQueue";
import { buildNewSessionAgentPatch, type AgentState } from "@/features/agents/state/store";
import type { GatewayStatus } from "@/lib/gateway/GatewayClient";

type ChatInteractionDispatchAction =
  | { type: "updateAgent"; agentId: string; patch: Partial<AgentState> }
  | { type: "appendOutput"; agentId: string; line: string };

type GatewayClientLike = {
  call: (method: string, params: unknown) => Promise<unknown>;
};

export type UseChatInteractionControllerParams = {
  client: GatewayClientLike;
  status: GatewayStatus;
  dispatch: (action: ChatInteractionDispatchAction) => void;
  setError: (message: string) => void;
  getAgents: () => AgentState[];
  clearRunTracking: (runId?: string | null) => void;
  clearHistoryInFlight: (sessionKey: string) => void;
  clearSpecialUpdateMarker: (agentId: string) => void;
  clearSpecialLatestUpdateInFlight: (agentId: string) => void;
  setInspectSidebarNull: () => void;
  setMobilePaneChat: () => void;
  draftDebounceMs?: number;
};

export type ChatInteractionController = {
  stopBusyAgentId: string | null;
  flushPendingDraft: (agentId: string | null) => void;
  handleDraftChange: (agentId: string, value: string) => void;
  handleSend: (agentId: string, sessionKey: string, message: string) => Promise<void>;
  handleNewSession: (agentId: string) => Promise<void>;
  handleStopRun: (agentId: string, sessionKey: string) => Promise<void>;
  queueLivePatch: (agentId: string, patch: Partial<AgentState>) => void;
  clearPendingLivePatch: (agentId: string) => void;
};

export function useChatInteractionController(
  params: UseChatInteractionControllerParams
): ChatInteractionController {
  const [stopBusyAgentId, setStopBusyAgentId] = useState<string | null>(null);
  const stopBusyAgentIdRef = useRef<string | null>(stopBusyAgentId);
  const pendingDraftValuesRef = useRef<Map<string, string>>(new Map());
  const pendingDraftTimersRef = useRef<Map<string, number>>(new Map());
  const pendingLivePatchesRef = useRef<Map<string, Partial<AgentState>>>(new Map());
  const flushLivePatchesRef = useRef<() => void>(() => {});
  const livePatchBatcherRef = useRef(createRafBatcher(() => flushLivePatchesRef.current()));

  useEffect(() => {
    stopBusyAgentIdRef.current = stopBusyAgentId;
  }, [stopBusyAgentId]);

  const flushPendingDraft = useCallback(
    (agentId: string | null) => {
      const hasPendingValue = Boolean(agentId && pendingDraftValuesRef.current.has(agentId));
      const flushIntent = planDraftFlushIntent({
        agentId,
        hasPendingValue,
      });
      if (flushIntent.kind !== "flush") return;

      const timer = pendingDraftTimersRef.current.get(flushIntent.agentId) ?? null;
      if (timer !== null) {
        window.clearTimeout(timer);
        pendingDraftTimersRef.current.delete(flushIntent.agentId);
      }

      const value = pendingDraftValuesRef.current.get(flushIntent.agentId);
      if (value === undefined) return;
      pendingDraftValuesRef.current.delete(flushIntent.agentId);
      params.dispatch({
        type: "updateAgent",
        agentId: flushIntent.agentId,
        patch: { draft: value },
      });
    },
    [params]
  );

  useEffect(() => {
    const timers = pendingDraftTimersRef.current;
    const values = pendingDraftValuesRef.current;
    return () => {
      for (const timer of timers.values()) {
        window.clearTimeout(timer);
      }
      timers.clear();
      values.clear();
    };
  }, []);

  const flushPendingLivePatches = useCallback(() => {
    const pending = pendingLivePatchesRef.current;
    if (pending.size === 0) return;
    const entries = [...pending.entries()];
    pending.clear();
    for (const [agentId, patch] of entries) {
      params.dispatch({ type: "updateAgent", agentId, patch });
    }
  }, [params]);

  useEffect(() => {
    flushLivePatchesRef.current = flushPendingLivePatches;
  }, [flushPendingLivePatches]);

  useEffect(() => {
    const batcher = livePatchBatcherRef.current;
    const pending = pendingLivePatchesRef.current;
    return () => {
      batcher.cancel();
      pending.clear();
    };
  }, []);

  const queueLivePatch = useCallback((agentId: string, patch: Partial<AgentState>) => {
    const key = agentId.trim();
    if (!key) return;
    const existing = pendingLivePatchesRef.current.get(key);
    pendingLivePatchesRef.current.set(key, mergePendingLivePatch(existing, patch));
    livePatchBatcherRef.current.schedule();
  }, []);

  const clearPendingLivePatch = useCallback((agentId: string) => {
    const key = agentId.trim();
    if (!key) return;
    const pending = pendingLivePatchesRef.current;
    if (!pending.has(key)) return;
    pending.delete(key);
    if (pending.size === 0) {
      livePatchBatcherRef.current.cancel();
    }
  }, []);

  const handleDraftChange = useCallback(
    (agentId: string, value: string) => {
      pendingDraftValuesRef.current.set(agentId, value);
      const existingTimer = pendingDraftTimersRef.current.get(agentId) ?? null;
      if (existingTimer !== null) {
        window.clearTimeout(existingTimer);
      }

      const timerIntent = planDraftTimerIntent({
        agentId,
        delayMs: params.draftDebounceMs,
      });
      if (timerIntent.kind !== "schedule") {
        pendingDraftTimersRef.current.delete(agentId);
        return;
      }

      const timer = window.setTimeout(() => {
        pendingDraftTimersRef.current.delete(agentId);
        const pendingValue = pendingDraftValuesRef.current.get(agentId);
        const flushIntent = planDraftFlushIntent({
          agentId,
          hasPendingValue: pendingValue !== undefined,
        });
        if (flushIntent.kind !== "flush" || pendingValue === undefined) return;
        pendingDraftValuesRef.current.delete(agentId);
        params.dispatch({
          type: "updateAgent",
          agentId,
          patch: { draft: pendingValue },
        });
      }, timerIntent.delayMs);
      pendingDraftTimersRef.current.set(agentId, timer);
    },
    [params]
  );

  const handleSend = useCallback(
    async (agentId: string, sessionKey: string, message: string) => {
      const trimmed = message.trim();
      if (!trimmed) return;
      const pendingDraftTimer = pendingDraftTimersRef.current.get(agentId) ?? null;
      if (pendingDraftTimer !== null) {
        window.clearTimeout(pendingDraftTimer);
        pendingDraftTimersRef.current.delete(agentId);
      }
      pendingDraftValuesRef.current.delete(agentId);
      clearPendingLivePatch(agentId);
      await sendChatMessageViaStudio({
        client: params.client,
        dispatch: params.dispatch,
        getAgent: (currentAgentId) =>
          params.getAgents().find((entry) => entry.agentId === currentAgentId) ?? null,
        agentId,
        sessionKey,
        message: trimmed,
        clearRunTracking: (runId) => params.clearRunTracking(runId),
      });
    },
    [clearPendingLivePatch, params]
  );

  const handleStopRun = useCallback(
    async (agentId: string, sessionKey: string) => {
      const stopIntent = planStopRunIntent({
        status: params.status,
        agentId,
        sessionKey,
        busyAgentId: stopBusyAgentIdRef.current,
      });
      if (stopIntent.kind === "deny") {
        params.setError(stopIntent.message);
        return;
      }
      if (stopIntent.kind === "skip-busy") {
        return;
      }

      setStopBusyAgentId(agentId);
      stopBusyAgentIdRef.current = agentId;
      try {
        await params.client.call("chat.abort", {
          sessionKey: stopIntent.sessionKey,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to stop run.";
        params.setError(message);
        console.error(message);
        params.dispatch({
          type: "appendOutput",
          agentId,
          line: `Stop failed: ${message}`,
        });
      } finally {
        setStopBusyAgentId((current) => {
          const next = current === agentId ? null : current;
          stopBusyAgentIdRef.current = next;
          return next;
        });
      }
    },
    [params]
  );

  const handleNewSession = useCallback(
    async (agentId: string) => {
      const agent = params.getAgents().find((entry) => entry.agentId === agentId);
      const newSessionIntent = planNewSessionIntent({
        hasAgent: Boolean(agent),
        sessionKey: agent?.sessionKey ?? "",
      });
      if (newSessionIntent.kind === "deny" && newSessionIntent.reason === "missing-agent") {
        params.setError(newSessionIntent.message);
        return;
      }
      if (!agent) return;

      try {
        if (newSessionIntent.kind === "deny") {
          throw new Error(newSessionIntent.message);
        }
        await params.client.call("sessions.reset", { key: newSessionIntent.sessionKey });
        const patch = buildNewSessionAgentPatch(agent);
        params.clearRunTracking(agent.runId);
        params.clearHistoryInFlight(newSessionIntent.sessionKey);
        params.clearSpecialUpdateMarker(agentId);
        params.clearSpecialLatestUpdateInFlight(agentId);
        params.dispatch({
          type: "updateAgent",
          agentId,
          patch,
        });
        params.setInspectSidebarNull();
        params.setMobilePaneChat();
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to start new session.";
        params.setError(message);
        params.dispatch({
          type: "appendOutput",
          agentId,
          line: `New session failed: ${message}`,
        });
      }
    },
    [params]
  );

  return {
    stopBusyAgentId,
    flushPendingDraft,
    handleDraftChange,
    handleSend,
    handleNewSession,
    handleStopRun,
    queueLivePatch,
    clearPendingLivePatch,
  };
}
