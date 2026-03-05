import { describe, expect, it } from "vitest";

import {
  buildLatestUpdatePatch,
  resolveLatestUpdateIntent,
} from "@/features/agents/operations/latestUpdateWorkflow";
import {
  buildReconcileTerminalPatch,
  resolveReconcileEligibility,
  resolveReconcileWaitOutcome,
  resolveSummarySnapshotIntent,
} from "@/features/agents/operations/fleetLifecycleWorkflow";
import { buildSummarySnapshotPatches } from "@/features/agents/state/runtimeEventBridge";
import type { AgentState } from "@/features/agents/state/store";

const createAgent = (agentId: string, sessionKey: string, status: AgentState["status"]): AgentState => ({
  agentId,
  name: agentId,
  sessionKey,
  status,
  sessionCreated: true,
  awaitingUserInput: false,
  hasUnseenActivity: false,
  outputLines: [],
  lastResult: null,
  lastDiff: null,
  runId: status === "running" ? "run-1" : null,
  runStartedAt: status === "running" ? 1 : null,
  streamText: null,
  thinkingTrace: null,
  latestOverride: null,
  latestOverrideKind: null,
  lastAssistantMessageAt: null,
  lastActivityAt: null,
  latestPreview: null,
  lastUserMessage: null,
  draft: "",
  sessionSettingsSynced: true,
  historyLoadedAt: null,
  historyFetchLimit: null,
  historyFetchedCount: null,
  historyMaybeTruncated: false,
  toolCallingEnabled: true,
  showThinkingTraces: true,
  model: "openai/gpt-5",
  thinkingLevel: "medium",
  avatarSeed: agentId,
  avatarUrl: null,
});

describe("fleetLifecycleWorkflow integration", () => {
  it("page adapter applies latest-update reset/update intents without behavior drift", () => {
    const resetIntent = resolveLatestUpdateIntent({
      message: "regular prompt",
      agentId: "agent-1",
      sessionKey: "agent:agent-1:main",
      hasExistingOverride: true,
    });
    expect(resetIntent).toEqual({ kind: "reset" });
    expect(buildLatestUpdatePatch("")).toEqual({
      latestOverride: null,
      latestOverrideKind: null,
    });

    const heartbeatIntent = resolveLatestUpdateIntent({
      message: "heartbeat status please",
      agentId: "",
      sessionKey: "agent:agent-1:main",
      hasExistingOverride: false,
    });
    expect(heartbeatIntent).toEqual({
      kind: "fetch-heartbeat",
      agentId: "agent-1",
      sessionLimit: 48,
      historyLimit: 200,
    });
    expect(buildLatestUpdatePatch("Heartbeat is healthy.", "heartbeat")).toEqual({
      latestOverride: "Heartbeat is healthy.",
      latestOverrideKind: "heartbeat",
    });
  });

  it("summary snapshot flow preserves status + preview patch application semantics", () => {
    const agents = [
      createAgent("agent-1", "agent:agent-1:main", "idle"),
      createAgent("agent-2", "agent:agent-2:main", "running"),
    ];
    const summaryIntent = resolveSummarySnapshotIntent({
      agents,
      maxKeys: 64,
    });
    expect(summaryIntent).toEqual({
      kind: "fetch",
      keys: ["agent:agent-1:main", "agent:agent-2:main"],
      limit: 8,
      maxChars: 240,
    });

    const patches = buildSummarySnapshotPatches({
      agents,
      statusSummary: {
        sessions: {
          recent: [{ key: "agent:agent-1:main", updatedAt: 1234 }],
          byAgent: [],
        },
      },
      previewResult: {
        ts: 1234,
        previews: [
          {
            key: "agent:agent-1:main",
            status: "ok",
            items: [
              { role: "user", text: "ping", timestamp: 1000 },
              { role: "assistant", text: "pong", timestamp: 1200 },
            ],
          },
        ],
      },
    });

    expect(patches).toEqual([
      {
        agentId: "agent-1",
        patch: {
          lastActivityAt: 1234,
          lastAssistantMessageAt: 1200,
          latestPreview: "pong",
          lastUserMessage: "ping",
          previewItems: [
            { role: "user", text: "ping", timestamp: 1000 },
            { role: "assistant", text: "pong", timestamp: 1200 },
          ],
        },
      },
    ]);
  });

  it("run reconciliation preserves terminal transition semantics and history reload trigger", () => {
    const runReconcileAdapter = (params: {
      status: AgentState["status"];
      sessionCreated: boolean;
      runId: string | null;
      waitStatus: unknown;
    }) => {
      const eligibility = resolveReconcileEligibility({
        status: params.status,
        sessionCreated: params.sessionCreated,
        runId: params.runId,
      });
      if (!eligibility.shouldCheck) {
        return { patch: null, shouldReloadHistory: false };
      }
      const outcome = resolveReconcileWaitOutcome(params.waitStatus);
      if (!outcome) {
        return { patch: null, shouldReloadHistory: false };
      }
      return {
        patch: buildReconcileTerminalPatch({ outcome }),
        shouldReloadHistory: true,
      };
    };

    expect(
      runReconcileAdapter({
        status: "running",
        sessionCreated: true,
        runId: "run-1",
        waitStatus: "ok",
      })
    ).toEqual({
      patch: {
        status: "idle",
        runId: null,
        runStartedAt: null,
        streamText: null,
        thinkingTrace: null,
      },
      shouldReloadHistory: true,
    });
    expect(
      runReconcileAdapter({
        status: "running",
        sessionCreated: true,
        runId: "run-1",
        waitStatus: "error",
      })
    ).toEqual({
      patch: {
        status: "error",
        runId: null,
        runStartedAt: null,
        streamText: null,
        thinkingTrace: null,
      },
      shouldReloadHistory: true,
    });
  });
});
