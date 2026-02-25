import { describe, expect, it } from "vitest";

import {
  buildHistoryMetadataPatch,
  resolveHistoryRequestIntent,
  resolveHistoryResponseDisposition,
} from "@/features/agents/operations/historyLifecycleWorkflow";
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

describe("historyLifecycleWorkflow", () => {
  it("returns skip intent when session is missing or not created", () => {
    expect(
      resolveHistoryRequestIntent({
        agent: null,
        defaultLimit: 200,
        maxLimit: 5000,
        inFlightSessionKeys: new Set<string>(),
        requestId: "req-1",
        loadedAt: 1000,
      })
    ).toEqual({ kind: "skip", reason: "missing-agent" });

    expect(
      resolveHistoryRequestIntent({
        agent: createAgent({ sessionCreated: false }),
        defaultLimit: 200,
        maxLimit: 5000,
        inFlightSessionKeys: new Set<string>(),
        requestId: "req-1",
        loadedAt: 1000,
      })
    ).toEqual({ kind: "skip", reason: "session-not-created" });

    expect(
      resolveHistoryRequestIntent({
        agent: createAgent({ sessionKey: "   " }),
        defaultLimit: 200,
        maxLimit: 5000,
        inFlightSessionKeys: new Set<string>(),
        requestId: "req-1",
        loadedAt: 1000,
      })
    ).toEqual({ kind: "skip", reason: "missing-session-key" });
  });

  it("plans history request with bounded limit and request identifiers", () => {
    expect(
      resolveHistoryRequestIntent({
        agent: createAgent({ transcriptRevision: 14, outputLines: ["one", "two"] }),
        requestedLimit: 9000,
        defaultLimit: 200,
        maxLimit: 5000,
        inFlightSessionKeys: new Set<string>(),
        requestId: "req-42",
        loadedAt: 777,
      })
    ).toEqual({
      kind: "fetch",
      sessionKey: "agent:agent-1:main",
      limit: 5000,
      requestRevision: 14,
      requestEpoch: 0,
      requestId: "req-42",
      loadedAt: 777,
    });

    expect(
      resolveHistoryRequestIntent({
        agent: createAgent(),
        defaultLimit: 200,
        maxLimit: 5000,
        inFlightSessionKeys: new Set<string>(),
        requestId: "req-2",
        loadedAt: 2000,
      })
    ).toEqual({
      kind: "fetch",
      sessionKey: "agent:agent-1:main",
      limit: 200,
      requestRevision: 0,
      requestEpoch: 0,
      requestId: "req-2",
      loadedAt: 2000,
    });
  });

  it("drops stale responses when session key, epoch, or revision changed", () => {
    expect(
      resolveHistoryResponseDisposition({
        latestAgent: createAgent({ sessionKey: "agent:agent-1:other" }),
        expectedSessionKey: "agent:agent-1:main",
        requestEpoch: 0,
        requestRevision: 0,
      })
    ).toEqual({
      kind: "drop",
      reason: "session-key-changed",
    });

    expect(
      resolveHistoryResponseDisposition({
        latestAgent: createAgent({ sessionEpoch: 4 }),
        expectedSessionKey: "agent:agent-1:main",
        requestEpoch: 3,
        requestRevision: 0,
      })
    ).toEqual({
      kind: "drop",
      reason: "session-epoch-changed",
    });

    expect(
      resolveHistoryResponseDisposition({
        latestAgent: createAgent({ transcriptRevision: 12 }),
        expectedSessionKey: "agent:agent-1:main",
        requestEpoch: 0,
        requestRevision: 11,
      })
    ).toEqual({
      kind: "drop",
      reason: "transcript-revision-changed",
    });

    expect(
      resolveHistoryResponseDisposition({
        latestAgent: createAgent({ outputLines: ["one", "two"] }),
        expectedSessionKey: "agent:agent-1:main",
        requestEpoch: 0,
        requestRevision: 1,
      })
    ).toEqual({
      kind: "drop",
      reason: "transcript-revision-changed",
    });
  });

  it("applies history even while run is still active", () => {
    expect(
      resolveHistoryResponseDisposition({
        latestAgent: createAgent({
          status: "running",
          runId: "run-1",
          transcriptRevision: 9,
        }),
        expectedSessionKey: "agent:agent-1:main",
        requestEpoch: 0,
        requestRevision: 9,
      })
    ).toEqual({
      kind: "apply",
    });

    expect(
      resolveHistoryResponseDisposition({
        latestAgent: createAgent({
          status: "idle",
          runId: null,
          transcriptRevision: 9,
        }),
        expectedSessionKey: "agent:agent-1:main",
        requestEpoch: 0,
        requestRevision: 9,
      })
    ).toEqual({
      kind: "apply",
    });

    expect(
      resolveHistoryResponseDisposition({
        latestAgent: createAgent({
          status: "idle",
          runId: null,
          outputLines: ["> q1", "a1"],
        }),
        expectedSessionKey: "agent:agent-1:main",
        requestEpoch: 0,
        requestRevision: 2,
      })
    ).toEqual({
      kind: "apply",
    });
  });

  it("builds metadata patch with truncation semantics", () => {
    expect(
      buildHistoryMetadataPatch({
        loadedAt: 123,
        fetchedCount: 8,
        limit: 8,
        requestId: "req-77",
      })
    ).toEqual({
      historyLoadedAt: 123,
      historyFetchLimit: 8,
      historyFetchedCount: 8,
      historyMaybeTruncated: true,
      lastAppliedHistoryRequestId: "req-77",
    });
  });
});
