import { describe, expect, it } from "vitest";

import {
  runHistorySyncOperation,
  type HistorySyncCommand,
} from "@/features/agents/operations/historySyncOperation";
import type { AgentState } from "@/features/agents/state/store";

type ChatHistoryMessage = Record<string, unknown>;

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

const getCommandsByKind = <TKind extends HistorySyncCommand["kind"]>(
  commands: HistorySyncCommand[],
  kind: TKind
): Array<Extract<HistorySyncCommand, { kind: TKind }>> =>
  commands.filter((command) => command.kind === kind) as Array<
    Extract<HistorySyncCommand, { kind: TKind }>
  >;

describe("historySyncOperation", () => {
  it("returns noop when request intent resolves to skip", async () => {
    const commands = await runHistorySyncOperation({
      client: {
        call: async () => ({ messages: [] as ChatHistoryMessage[] }),
      },
      agentId: "agent-1",
      getAgent: () => null,
      inFlightSessionKeys: new Set<string>(),
      requestId: "req-1",
      loadedAt: 1_234,
      defaultLimit: 200,
      maxLimit: 5000,
      transcriptV2Enabled: true,
    });

    expect(commands).toEqual([{ kind: "noop", reason: "missing-agent" }]);
  });

  it("returns metadata-only update command when latest agent is running with active run", async () => {
    const agent = createAgent({
      status: "running",
      runId: "run-1",
      transcriptRevision: 3,
      outputLines: ["> local question", "assistant draft"],
    });
    const commands = await runHistorySyncOperation({
      client: {
        call: async () =>
          ({
            sessionKey: agent.sessionKey,
            messages: [{ role: "assistant", content: "remote answer" }],
          }) as const,
      },
      agentId: "agent-1",
      getAgent: () => agent,
      inFlightSessionKeys: new Set<string>(),
      requestId: "req-2",
      loadedAt: 2_345,
      defaultLimit: 200,
      maxLimit: 5000,
      transcriptV2Enabled: true,
    });

    const updates = getCommandsByKind(commands, "dispatchUpdateAgent");
    expect(updates).toContainEqual({
      kind: "dispatchUpdateAgent",
      agentId: "agent-1",
      patch: {
        historyLoadedAt: 2_345,
        historyFetchLimit: 200,
        historyFetchedCount: 1,
        historyMaybeTruncated: false,
        lastAppliedHistoryRequestId: "req-2",
      },
    });
    const metrics = getCommandsByKind(commands, "logMetric");
    expect(metrics).toContainEqual({
      kind: "logMetric",
      metric: "history_apply_skipped_running",
      meta: {
        agentId: "agent-1",
        requestId: "req-2",
        runId: "run-1",
      },
    });
  });

  it("returns transcript merge update commands when disposition is apply and transcript v2 is enabled", async () => {
    const agent = createAgent({
      transcriptRevision: 1,
      outputLines: ["> local question"],
    });
    const messages: ChatHistoryMessage[] = [{ role: "assistant", content: "Merged answer" }];
    const commands = await runHistorySyncOperation({
      client: {
        call: async () =>
          ({
            sessionKey: agent.sessionKey,
            messages,
          }) as const,
      },
      agentId: "agent-1",
      getAgent: () => agent,
      inFlightSessionKeys: new Set<string>(),
      requestId: "req-3",
      loadedAt: 3_456,
      defaultLimit: 200,
      maxLimit: 5000,
      transcriptV2Enabled: true,
    });

    const updates = getCommandsByKind(commands, "dispatchUpdateAgent");
    expect(updates.length).toBeGreaterThanOrEqual(2);
    expect(updates).toContainEqual({
      kind: "dispatchUpdateAgent",
      agentId: "agent-1",
      patch: { lastHistoryRequestRevision: 1 },
    });
    const finalUpdate = updates[updates.length - 1];
    if (!finalUpdate) throw new Error("Expected final update command.");
    const patch = finalUpdate.patch;
    expect(Array.isArray(patch.outputLines)).toBe(true);
    expect(patch.outputLines).toContain("> local question");
    expect(patch.outputLines).toContain("Merged answer");
    expect(patch.lastResult).toBe("Merged answer");
    expect(patch.latestPreview).toBe("Merged answer");
    expect(patch.lastAppliedHistoryRequestId).toBe("req-3");
  });

  it("returns legacy history sync patch command when transcript v2 is disabled", async () => {
    const agent = createAgent({
      transcriptRevision: 0,
      outputLines: ["> local question"],
    });
    const commands = await runHistorySyncOperation({
      client: {
        call: async () =>
          ({
            sessionKey: agent.sessionKey,
            messages: [{ role: "assistant", content: "Legacy answer" }],
          }) as const,
      },
      agentId: "agent-1",
      getAgent: () => agent,
      inFlightSessionKeys: new Set<string>(),
      requestId: "req-4",
      loadedAt: 4_567,
      defaultLimit: 200,
      maxLimit: 5000,
      transcriptV2Enabled: false,
    });

    const updates = getCommandsByKind(commands, "dispatchUpdateAgent");
    const finalUpdate = updates[updates.length - 1];
    if (!finalUpdate) throw new Error("Expected final update command.");
    const patch = finalUpdate.patch;
    expect(patch.outputLines).toContain("> local question");
    expect(patch.outputLines).toContain("Legacy answer");
    expect(patch.lastResult).toBe("Legacy answer");
    expect(patch.lastAppliedHistoryRequestId).toBe("req-4");
  });
});
