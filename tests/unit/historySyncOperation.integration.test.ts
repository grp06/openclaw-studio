import { describe, expect, it, vi } from "vitest";

import {
  executeHistorySyncCommands,
  runHistorySyncOperation,
  type HistorySyncCommand,
} from "@/features/agents/operations/historySyncOperation";
import type { AgentState } from "@/features/agents/state/store";
import { createTranscriptEntryFromLine } from "@/features/agents/state/transcript";

describe("historySyncOperation integration", () => {
  it("executes dispatch and metric commands and suppresses disconnect-like errors", () => {
    const dispatch = vi.fn();
    const logMetric = vi.fn();
    const logError = vi.fn();
    const commands: HistorySyncCommand[] = [
      {
        kind: "dispatchUpdateAgent",
        agentId: "agent-1",
        patch: { historyLoadedAt: 1234 } as Partial<AgentState>,
      },
      {
        kind: "logMetric",
        metric: "history_sync_test_metric",
        meta: { agentId: "agent-1", requestId: "req-1", runId: "run-1" },
      },
      {
        kind: "logError",
        message: "Disconnected",
        error: new Error("socket disconnected"),
      },
      {
        kind: "logError",
        message: "Unexpected failure",
        error: new Error("boom"),
      },
      { kind: "noop", reason: "missing-agent" },
    ];

    executeHistorySyncCommands({
      commands,
      dispatch,
      logMetric,
      isDisconnectLikeError: (error) =>
        error instanceof Error && error.message.toLowerCase().includes("disconnected"),
      logError,
    });

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith({
      type: "updateAgent",
      agentId: "agent-1",
      patch: { historyLoadedAt: 1234 },
    });
    expect(logMetric).toHaveBeenCalledTimes(1);
    expect(logMetric).toHaveBeenCalledWith("history_sync_test_metric", {
      agentId: "agent-1",
      requestId: "req-1",
      runId: "run-1",
    });
    expect(logError).toHaveBeenCalledTimes(1);
    expect(logError).toHaveBeenCalledWith("Unexpected failure", expect.any(Error));
  });

  it("collapses duplicate non-active run assistant terminals during gap recovery history sync", async () => {
    const sessionKey = "agent:agent-1:main";
    const duplicateOne = createTranscriptEntryFromLine({
      line: "final answer",
      sessionKey,
      source: "runtime-agent",
      sequenceKey: 10,
      runId: "run-1",
      role: "assistant",
      kind: "assistant",
      entryId: "runtime-agent:run-1:final-1",
      confirmed: false,
    });
    const duplicateTwo = createTranscriptEntryFromLine({
      line: "final answer",
      sessionKey,
      source: "runtime-chat",
      sequenceKey: 11,
      runId: "run-1",
      role: "assistant",
      kind: "assistant",
      entryId: "runtime-chat:run-1:final-2",
      confirmed: true,
    });
    if (!duplicateOne || !duplicateTwo) {
      throw new Error("Expected transcript entries.");
    }

    const requestAgent: AgentState = {
      agentId: "agent-1",
      name: "Agent One",
      sessionKey,
      status: "idle",
      sessionCreated: true,
      awaitingUserInput: false,
      hasUnseenActivity: false,
      outputLines: ["> question", "final answer", "final answer"],
      lastResult: "final answer",
      lastDiff: null,
      runId: null,
      runStartedAt: null,
      streamText: null,
      thinkingTrace: null,
      latestOverride: null,
      latestOverrideKind: null,
      lastAssistantMessageAt: null,
      lastActivityAt: null,
      latestPreview: "final answer",
      lastUserMessage: "question",
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
      transcriptEntries: [duplicateOne, duplicateTwo],
      transcriptRevision: 2,
      transcriptSequenceCounter: 12,
    };
    const commands = await runHistorySyncOperation({
      client: {
        call: async <T>() =>
          ({
            sessionKey,
            messages: [
              { role: "user", content: "question" },
              { role: "assistant", content: "final answer" },
            ],
          }) as T,
      },
      agentId: "agent-1",
      getAgent: () => requestAgent,
      inFlightSessionKeys: new Set<string>(),
      requestId: "req-gap-1",
      loadedAt: 10_000,
      defaultLimit: 200,
      maxLimit: 5000,
      transcriptV2Enabled: true,
    });

    const updates = commands.filter((entry) => entry.kind === "dispatchUpdateAgent");
    const finalUpdate = updates[updates.length - 1];
    if (!finalUpdate || finalUpdate.kind !== "dispatchUpdateAgent") {
      throw new Error("Expected final dispatch update.");
    }
    const lines = finalUpdate.patch.outputLines ?? [];
    expect(lines.filter((line) => line === "final answer")).toHaveLength(1);
  });

  it("preserves assistant duplicates for the active running run", async () => {
    const sessionKey = "agent:agent-1:main";
    const duplicateOne = createTranscriptEntryFromLine({
      line: "stream line",
      sessionKey,
      source: "runtime-agent",
      sequenceKey: 20,
      runId: "run-active",
      role: "assistant",
      kind: "assistant",
      entryId: "runtime-agent:run-active:1",
      confirmed: false,
    });
    const duplicateTwo = createTranscriptEntryFromLine({
      line: "stream line",
      sessionKey,
      source: "runtime-chat",
      sequenceKey: 21,
      runId: "run-active",
      role: "assistant",
      kind: "assistant",
      entryId: "runtime-chat:run-active:2",
      confirmed: true,
    });
    if (!duplicateOne || !duplicateTwo) {
      throw new Error("Expected transcript entries.");
    }

    const runningAgent: AgentState = {
      agentId: "agent-1",
      name: "Agent One",
      sessionKey,
      status: "running",
      sessionCreated: true,
      awaitingUserInput: false,
      hasUnseenActivity: false,
      outputLines: ["> question", "stream line", "stream line"],
      lastResult: null,
      lastDiff: null,
      runId: "run-active",
      runStartedAt: 1_000,
      streamText: "stream line",
      thinkingTrace: null,
      latestOverride: null,
      latestOverrideKind: null,
      lastAssistantMessageAt: null,
      lastActivityAt: null,
      latestPreview: "stream line",
      lastUserMessage: "question",
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
      transcriptEntries: [duplicateOne, duplicateTwo],
      transcriptRevision: 4,
      transcriptSequenceCounter: 22,
    };

    const commands = await runHistorySyncOperation({
      client: {
        call: async <T>() =>
          ({
            sessionKey,
            messages: [{ role: "assistant", content: "stream line" }],
          }) as T,
      },
      agentId: "agent-1",
      getAgent: () => runningAgent,
      inFlightSessionKeys: new Set<string>(),
      requestId: "req-gap-2",
      loadedAt: 11_000,
      defaultLimit: 200,
      maxLimit: 5000,
      transcriptV2Enabled: true,
    });

    const updates = commands.filter((entry) => entry.kind === "dispatchUpdateAgent");
    const finalUpdate = updates[updates.length - 1];
    if (!finalUpdate || finalUpdate.kind !== "dispatchUpdateAgent") {
      throw new Error("Expected final dispatch update.");
    }
    const lines = finalUpdate.patch.outputLines ?? [];
    expect(lines.filter((line) => line === "stream line")).toHaveLength(2);
  });

  it("keeps repeated canonical history entries when content and timestamp are identical", async () => {
    const sessionKey = "agent:agent-1:main";
    const agent: AgentState = {
      agentId: "agent-1",
      name: "Agent One",
      sessionKey,
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
      transcriptEntries: [],
      transcriptRevision: 0,
      transcriptSequenceCounter: 0,
    };

    const commands = await runHistorySyncOperation({
      client: {
        call: async <T>() =>
          ({
            sessionKey,
            messages: [
              {
                role: "assistant",
                timestamp: "2024-01-01T00:00:00.000Z",
                content: "same line",
              },
              {
                role: "assistant",
                timestamp: "2024-01-01T00:00:00.000Z",
                content: "same line",
              },
            ],
          }) as T,
      },
      agentId: "agent-1",
      getAgent: () => agent,
      inFlightSessionKeys: new Set<string>(),
      requestId: "req-dup-history",
      loadedAt: 12_000,
      defaultLimit: 200,
      maxLimit: 5000,
      transcriptV2Enabled: true,
    });

    const updates = commands.filter((entry) => entry.kind === "dispatchUpdateAgent");
    const finalUpdate = updates[updates.length - 1];
    if (!finalUpdate || finalUpdate.kind !== "dispatchUpdateAgent") {
      throw new Error("Expected final dispatch update.");
    }
    const lines = finalUpdate.patch.outputLines ?? [];
    expect(lines.filter((line) => line === "same line")).toHaveLength(2);
    const transcriptEntries = finalUpdate.patch.transcriptEntries ?? [];
    expect(
      transcriptEntries.filter((entry) => entry.kind === "assistant" && entry.text === "same line")
    ).toHaveLength(2);
  });

  it("does not replay prior confirmed assistant turn during running history refresh", async () => {
    const sessionKey = "agent:agent-1:main";
    const priorUser = createTranscriptEntryFromLine({
      line: "> what should we work on today?",
      sessionKey,
      source: "history",
      sequenceKey: 1,
      runId: null,
      role: "user",
      kind: "user",
      confirmed: true,
      entryId: "history:user:prior",
    });
    const priorAssistant = createTranscriptEntryFromLine({
      line: "win + progress + cleanup",
      sessionKey,
      source: "runtime-chat",
      sequenceKey: 2,
      runId: "run-prior",
      role: "assistant",
      kind: "assistant",
      confirmed: true,
      entryId: "run:run-prior:assistant:final",
    });
    const nextUser = createTranscriptEntryFromLine({
      line: "> naw - sounds boring",
      sessionKey,
      source: "local-send",
      sequenceKey: 3,
      runId: "run-active",
      role: "user",
      kind: "user",
      confirmed: false,
      entryId: "local:user:next",
    });
    if (!priorUser || !priorAssistant || !nextUser) {
      throw new Error("Expected transcript entries.");
    }

    const runningAgent: AgentState = {
      agentId: "agent-1",
      name: "Agent One",
      sessionKey,
      status: "running",
      sessionCreated: true,
      awaitingUserInput: false,
      hasUnseenActivity: false,
      outputLines: [
        "> what should we work on today?",
        "win + progress + cleanup",
        "> naw - sounds boring",
      ],
      lastResult: "win + progress + cleanup",
      lastDiff: null,
      runId: "run-active",
      runStartedAt: 10_000,
      streamText: "",
      thinkingTrace: null,
      latestOverride: null,
      latestOverrideKind: null,
      lastAssistantMessageAt: 9_000,
      lastActivityAt: 10_000,
      latestPreview: "win + progress + cleanup",
      lastUserMessage: "naw - sounds boring",
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
      transcriptEntries: [priorUser, priorAssistant, nextUser],
      transcriptRevision: 7,
      transcriptSequenceCounter: 4,
    };

    const commands = await runHistorySyncOperation({
      client: {
        call: async <T>() =>
          ({
            sessionKey,
            messages: [
              { role: "user", content: "what should we work on today?" },
              { role: "assistant", content: "win + progress + cleanup" },
            ],
          }) as T,
      },
      agentId: "agent-1",
      getAgent: () => runningAgent,
      inFlightSessionKeys: new Set<string>(),
      requestId: "req-replay-1",
      loadedAt: 15_000,
      defaultLimit: 200,
      maxLimit: 5000,
      transcriptV2Enabled: true,
    });

    const updates = commands.filter((entry) => entry.kind === "dispatchUpdateAgent");
    const finalUpdate = updates[updates.length - 1];
    if (!finalUpdate || finalUpdate.kind !== "dispatchUpdateAgent") {
      throw new Error("Expected final dispatch update.");
    }
    const lines = finalUpdate.patch.outputLines ?? runningAgent.outputLines;
    expect(lines.filter((line) => line === "win + progress + cleanup")).toHaveLength(1);
    const transcriptEntries =
      finalUpdate.patch.transcriptEntries ?? runningAgent.transcriptEntries ?? [];
    expect(
      transcriptEntries.filter(
        (entry) => entry.kind === "assistant" && entry.text === "win + progress + cleanup"
      )
    ).toHaveLength(1);
  });

  it("drops stale history response when transcript revision changes after request", async () => {
    const requestAgent: AgentState = {
      agentId: "agent-1",
      name: "Agent One",
      sessionKey: "agent:agent-1:main",
      status: "idle",
      sessionCreated: true,
      awaitingUserInput: false,
      hasUnseenActivity: false,
      outputLines: ["> local question", "assistant current"],
      lastResult: "assistant current",
      lastDiff: null,
      runId: null,
      runStartedAt: null,
      streamText: null,
      thinkingTrace: null,
      latestOverride: null,
      latestOverrideKind: null,
      lastAssistantMessageAt: null,
      lastActivityAt: null,
      latestPreview: "assistant current",
      lastUserMessage: "local question",
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
      transcriptEntries: [],
      transcriptRevision: 7,
      transcriptSequenceCounter: 0,
      sessionEpoch: 0,
    };
    const latestAgent: AgentState = {
      ...requestAgent,
      transcriptRevision: 8,
    };
    let readCount = 0;
    const inFlightSessionKeys = new Set<string>();
    const commands = await runHistorySyncOperation({
      client: {
        call: async <T>() =>
          ({
            sessionKey: requestAgent.sessionKey,
            messages: [{ role: "assistant", content: "stale remote answer" }],
          }) as T,
      },
      agentId: requestAgent.agentId,
      getAgent: () => {
        readCount += 1;
        return readCount <= 1 ? requestAgent : latestAgent;
      },
      inFlightSessionKeys,
      requestId: "req-revision-drop-1",
      loadedAt: 16_000,
      defaultLimit: 200,
      maxLimit: 5000,
      transcriptV2Enabled: true,
    });

    const updates = commands.filter((entry) => entry.kind === "dispatchUpdateAgent");
    expect(updates).toHaveLength(1);
    expect(updates[0]).toEqual({
      kind: "dispatchUpdateAgent",
      agentId: "agent-1",
      patch: { lastHistoryRequestRevision: 7 },
    });

    const staleDropMetrics = commands.filter(
      (entry) => entry.kind === "logMetric" && entry.metric === "history_response_dropped_stale"
    );
    expect(staleDropMetrics).toEqual([
      {
        kind: "logMetric",
        metric: "history_response_dropped_stale",
        meta: {
          reason: "transcript_revision_changed",
          agentId: "agent-1",
          requestId: "req-revision-drop-1",
        },
      },
    ]);

    expect(
      updates.some((entry) => {
        const patch = entry.patch;
        return (
          Object.prototype.hasOwnProperty.call(patch, "outputLines") ||
          Object.prototype.hasOwnProperty.call(patch, "lastAppliedHistoryRequestId")
        );
      })
    ).toBe(false);
    expect(inFlightSessionKeys.size).toBe(0);
  });
});
