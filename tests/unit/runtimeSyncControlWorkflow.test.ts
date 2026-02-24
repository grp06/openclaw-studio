import { describe, expect, it } from "vitest";

import {
  RUNTIME_SYNC_FOCUSED_HISTORY_INTERVAL_MS,
  RUNTIME_SYNC_RECONCILE_INTERVAL_MS,
  resolveRuntimeSyncBootstrapHistoryAgentIds,
  resolveRuntimeSyncFocusedHistoryPollingIntent,
  resolveRuntimeSyncGapRecoveryIntent,
  resolveRuntimeSyncLoadMoreHistoryLimit,
  resolveRuntimeSyncReconcilePollingIntent,
  shouldRuntimeSyncContinueFocusedHistoryPolling,
} from "@/features/agents/operations/runtimeSyncControlWorkflow";

describe("runtimeSyncControlWorkflow", () => {
  it("plans reconcile polling only when connected", () => {
    expect(
      resolveRuntimeSyncReconcilePollingIntent({
        status: "disconnected",
      })
    ).toEqual({
      kind: "stop",
      reason: "not-connected",
    });

    expect(
      resolveRuntimeSyncReconcilePollingIntent({
        status: "connected",
      })
    ).toEqual({
      kind: "start",
      intervalMs: RUNTIME_SYNC_RECONCILE_INTERVAL_MS,
      runImmediately: true,
    });
  });

  it("plans history bootstrap for connected unloaded sessions", () => {
    expect(
      resolveRuntimeSyncBootstrapHistoryAgentIds({
        status: "connected",
        agents: [
          { agentId: "agent-1", sessionCreated: true, historyLoadedAt: null },
          { agentId: "agent-2", sessionCreated: true, historyLoadedAt: 1234 },
          { agentId: "agent-3", sessionCreated: false, historyLoadedAt: null },
        ],
      })
    ).toEqual(["agent-1"]);

    expect(
      resolveRuntimeSyncBootstrapHistoryAgentIds({
        status: "connecting",
        agents: [{ agentId: "agent-1", sessionCreated: true, historyLoadedAt: null }],
      })
    ).toEqual([]);
  });

  it("plans focused history polling with explicit stop reasons", () => {
    expect(
      resolveRuntimeSyncFocusedHistoryPollingIntent({
        status: "connected",
        focusedAgentId: "agent-1",
        focusedAgentRunning: true,
      })
    ).toEqual({
      kind: "start",
      agentId: "agent-1",
      intervalMs: RUNTIME_SYNC_FOCUSED_HISTORY_INTERVAL_MS,
      runImmediately: true,
    });

    expect(
      resolveRuntimeSyncFocusedHistoryPollingIntent({
        status: "connected",
        focusedAgentId: null,
        focusedAgentRunning: true,
      })
    ).toEqual({
      kind: "stop",
      reason: "missing-focused-agent",
    });

    expect(
      resolveRuntimeSyncFocusedHistoryPollingIntent({
        status: "connected",
        focusedAgentId: "agent-1",
        focusedAgentRunning: false,
      })
    ).toEqual({
      kind: "stop",
      reason: "focused-not-running",
    });
  });

  it("checks focused polling continuation against latest running state", () => {
    expect(
      shouldRuntimeSyncContinueFocusedHistoryPolling({
        agentId: "agent-1",
        agents: [{ agentId: "agent-1", status: "running" }],
      })
    ).toBe(true);

    expect(
      shouldRuntimeSyncContinueFocusedHistoryPolling({
        agentId: "agent-1",
        agents: [{ agentId: "agent-1", status: "idle" }],
      })
    ).toBe(false);

    expect(
      shouldRuntimeSyncContinueFocusedHistoryPolling({
        agentId: "agent-1",
        agents: [],
      })
    ).toBe(false);
  });

  it("resolves load-more limits with floor and max bounds", () => {
    expect(
      resolveRuntimeSyncLoadMoreHistoryLimit({
        currentLimit: 200,
        defaultLimit: 200,
        maxLimit: 5000,
      })
    ).toBe(400);

    expect(
      resolveRuntimeSyncLoadMoreHistoryLimit({
        currentLimit: 3000,
        defaultLimit: 200,
        maxLimit: 5000,
      })
    ).toBe(5000);

    expect(
      resolveRuntimeSyncLoadMoreHistoryLimit({
        currentLimit: null,
        defaultLimit: 200,
        maxLimit: 5000,
      })
    ).toBe(400);
  });

  it("always plans summary refresh plus reconcile for gap recovery", () => {
    expect(resolveRuntimeSyncGapRecoveryIntent()).toEqual({
      refreshSummarySnapshot: true,
      reconcileRunningAgents: true,
    });
  });
});
