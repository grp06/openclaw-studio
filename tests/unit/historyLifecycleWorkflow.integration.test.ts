import { describe, expect, it } from "vitest";

import {
  buildHistoryMetadataPatch,
  resolveHistoryRequestIntent,
  resolveHistoryResponseDisposition,
} from "@/features/agents/operations/historyLifecycleWorkflow";
import { buildHistorySyncPatch, type ChatHistoryMessage } from "@/features/agents/state/runtimeEventBridge";
import type { AgentState } from "@/features/agents/state/store";

const createAgent = (overrides?: Partial<AgentState>): AgentState => {
  const base: AgentState = {
    agentId: "agent-1",
    name: "Agent One",
    sessionKey: "agent:agent-1:main",
    status: "idle",
    sessionCreated: true,
    awaitingUserInput: false,
    hasUnseenActivity: false,
    outputLines: [],
    lastResult: null,
    lastDiff: null,
    runId: null,
    runStartedAt: null,
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
    avatarSeed: "seed-1",
    avatarUrl: null,
  };
  return { ...base, ...(overrides ?? {}) };
};

const runPageHistoryAdapter = (params: {
  requestAgent: AgentState;
  latestAgent: AgentState | null;
  messages: ChatHistoryMessage[];
  requestedLimit?: number;
}) => {
  const requestIntent = resolveHistoryRequestIntent({
    agent: params.requestAgent,
    requestedLimit: params.requestedLimit,
    defaultLimit: 200,
    maxLimit: 5000,
    inFlightSessionKeys: new Set<string>(),
    requestId: "req-1",
    loadedAt: 1_234,
  });
  if (requestIntent.kind === "skip") {
    return { disposition: "skip" as const, patch: null, next: params.requestAgent };
  }

  const latest = params.latestAgent;
  const disposition = resolveHistoryResponseDisposition({
    latestAgent: latest,
    expectedSessionKey: requestIntent.sessionKey,
    requestEpoch: requestIntent.requestEpoch,
    requestRevision: requestIntent.requestRevision,
  });
  const metadataPatch = buildHistoryMetadataPatch({
    loadedAt: requestIntent.loadedAt,
    fetchedCount: params.messages.length,
    limit: requestIntent.limit,
    requestId: requestIntent.requestId,
  });

  if (!latest) {
    return { disposition: "drop" as const, patch: null, next: params.requestAgent };
  }

  if (disposition.kind === "drop") {
    return { disposition: "drop" as const, patch: null, next: latest };
  }

  const applyPatch = buildHistorySyncPatch({
    messages: params.messages,
    currentLines: latest.outputLines,
    loadedAt: requestIntent.loadedAt,
    status: latest.status,
    runId: latest.runId,
  });
  const patch = { ...applyPatch, ...metadataPatch };
  return {
    disposition: "apply" as const,
    patch,
    next: { ...latest, ...patch },
  };
};

describe("historyLifecycleWorkflow integration", () => {
  it("page adapter applies transcript patch even when running run is still active", () => {
    const latest = createAgent({
      status: "running",
      runId: "run-1",
      outputLines: ["> user", "assistant draft"],
      transcriptRevision: 2,
    });

    const result = runPageHistoryAdapter({
      requestAgent: latest,
      latestAgent: latest,
      messages: [{ role: "assistant", content: "final" }],
    });

    expect(result.disposition).toBe("apply");
    expect(result.next.outputLines).toEqual(["> user", "assistant draft", "final"]);
    expect(result.patch).toEqual({
      outputLines: ["> user", "assistant draft", "final"],
      lastResult: "final",
      latestPreview: "final",
      historyLoadedAt: 1_234,
      historyFetchLimit: 200,
      historyFetchedCount: 1,
      historyMaybeTruncated: false,
      lastAppliedHistoryRequestId: "req-1",
    });
  });

  it("page adapter drops responses when session epoch changed and preserves existing transcript", () => {
    const requestAgent = createAgent({
      outputLines: ["> user", "assistant current"],
      transcriptRevision: 7,
    });
    const latest = createAgent({
      outputLines: ["> user", "assistant current"],
      transcriptRevision: 8,
      sessionEpoch: 1,
    });

    const result = runPageHistoryAdapter({
      requestAgent,
      latestAgent: latest,
      messages: [{ role: "assistant", content: "assistant stale" }],
    });

    expect(result.disposition).toBe("drop");
    expect(result.next.outputLines).toEqual(["> user", "assistant current"]);
    expect(result.patch).toBeNull();
  });

  it("page adapter applies transcript merge patch when workflow disposition is apply", () => {
    const latest = createAgent({
      outputLines: ["> local question"],
      transcriptRevision: 1,
    });

    const result = runPageHistoryAdapter({
      requestAgent: latest,
      latestAgent: latest,
      messages: [{ role: "assistant", content: "Merged answer" }],
    });

    expect(result.disposition).toBe("apply");
    expect(result.next.outputLines).toContain("> local question");
    expect(result.next.outputLines).toContain("Merged answer");
    expect(result.next.lastResult).toBe("Merged answer");
    expect(result.next.lastAppliedHistoryRequestId).toBe("req-1");
  });

  it("page adapter collapses duplicate terminal assistant lines after reconcile-driven history apply", () => {
    const requestAgent = createAgent({
      status: "running",
      runId: "run-1",
      outputLines: ["> question", "final answer", "final answer"],
      transcriptRevision: 5,
    });
    const latest = createAgent({
      status: "idle",
      runId: null,
      outputLines: ["> question", "final answer", "final answer"],
      transcriptRevision: 5,
    });

    const result = runPageHistoryAdapter({
      requestAgent,
      latestAgent: latest,
      messages: [
        { role: "user", content: "question" },
        { role: "assistant", content: "final answer" },
      ],
    });

    expect(result.disposition).toBe("apply");
    expect(result.next.outputLines.filter((line) => line === "final answer")).toHaveLength(1);
  });
});
