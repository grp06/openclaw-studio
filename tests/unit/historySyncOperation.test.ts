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
        call: async <T>() => ({ messages: [] as ChatHistoryMessage[] }) as T,
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

  it("applies history updates even when latest agent is running with active run", async () => {
    const agent = createAgent({
      status: "running",
      runId: "run-1",
      transcriptRevision: 3,
      outputLines: ["> local question", "assistant draft"],
    });
    const commands = await runHistorySyncOperation({
      client: {
        call: async <T>() =>
          ({
            sessionKey: agent.sessionKey,
            messages: [{ role: "assistant", content: "remote answer" }],
          }) as T,
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
    const metrics = getCommandsByKind(commands, "logMetric");
    expect(metrics).toEqual([]);

    const finalUpdate = updates[updates.length - 1];
    if (!finalUpdate) throw new Error("Expected final update command.");
    const patch = finalUpdate.patch;
    expect(patch.outputLines).toContain("> local question");
    expect(patch.outputLines).toContain("assistant draft");
    expect(patch.outputLines).toContain("remote answer");
    expect(patch.lastResult).toBe("remote answer");
    expect(patch.latestPreview).toBe("remote answer");
    expect(patch.lastAppliedHistoryRequestId).toBe("req-2");
  });

  it("returns transcript merge update commands when disposition is apply and transcript v2 is enabled", async () => {
    const agent = createAgent({
      transcriptRevision: 1,
      outputLines: ["> local question"],
    });
    const markdownAssistant = [
      "- first bullet",
      "- second bullet",
      "",
      "```ts",
      "console.log('merged answer');",
      "```",
    ].join("\n");
    const messages: ChatHistoryMessage[] = [{ role: "assistant", content: markdownAssistant }];
    const commands = await runHistorySyncOperation({
      client: {
        call: async <T>() =>
          ({
            sessionKey: agent.sessionKey,
            messages,
          }) as T,
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
    expect(patch.outputLines).toContain(markdownAssistant);
    expect(patch.lastResult).toBe(markdownAssistant);
    expect(patch.latestPreview).toBe(markdownAssistant);
    expect(patch.lastAppliedHistoryRequestId).toBe("req-3");
  });

  it("normalizes assistant text in transcript-v2 history sync patches", async () => {
    const agent = createAgent({
      transcriptRevision: 1,
      outputLines: ["> local question"],
    });
    const commands = await runHistorySyncOperation({
      client: {
        call: async <T>() =>
          ({
            sessionKey: agent.sessionKey,
            messages: [{ role: "assistant", content: "\n- alpha  \n\n\n- beta\t \n\n" }],
          }) as T,
      },
      agentId: "agent-1",
      getAgent: () => agent,
      inFlightSessionKeys: new Set<string>(),
      requestId: "req-3b",
      loadedAt: 3_789,
      defaultLimit: 200,
      maxLimit: 5000,
      transcriptV2Enabled: true,
    });

    const updates = getCommandsByKind(commands, "dispatchUpdateAgent");
    const finalUpdate = updates[updates.length - 1];
    if (!finalUpdate) throw new Error("Expected final update command.");
    const patch = finalUpdate.patch;
    expect(Array.isArray(patch.outputLines)).toBe(true);
    expect(patch.outputLines).toContain("> local question");
    expect(patch.outputLines).toContain("- alpha\n\n- beta");
    expect(patch.lastResult).toBe("- alpha\n\n- beta");
    expect(patch.latestPreview).toBe("- alpha\n\n- beta");
    expect(patch.lastAppliedHistoryRequestId).toBe("req-3b");
  });

  it("infers running state from recent user-terminal history in transcript-v2 mode", async () => {
    const agent = createAgent({
      status: "idle",
      runId: null,
      runStartedAt: null,
      transcriptRevision: 1,
      outputLines: [],
    });
    const loadedAt = Date.parse("2024-01-01T00:30:00.000Z");
    const lastUserAt = Date.parse("2024-01-01T00:29:40.000Z");
    const commands = await runHistorySyncOperation({
      client: {
        call: async <T>() =>
          ({
            sessionKey: agent.sessionKey,
            messages: [
              {
                role: "user",
                timestamp: new Date(lastUserAt).toISOString(),
                content: "still working?",
              },
            ],
          }) as T,
      },
      agentId: "agent-1",
      getAgent: () => agent,
      inFlightSessionKeys: new Set<string>(),
      requestId: "req-3c",
      loadedAt,
      defaultLimit: 200,
      maxLimit: 5000,
      transcriptV2Enabled: true,
    });

    const updates = getCommandsByKind(commands, "dispatchUpdateAgent");
    const finalUpdate = updates[updates.length - 1];
    if (!finalUpdate) throw new Error("Expected final update command.");
    const patch = finalUpdate.patch;
    expect(patch.status).toBe("running");
    expect(patch.runId).toBeNull();
    expect(patch.runStartedAt).toBe(lastUserAt);
    expect(patch.streamText).toBeNull();
    expect(patch.thinkingTrace).toBeNull();
    expect(patch.lastUserMessage).toBe("still working?");
    expect(patch.lastAppliedHistoryRequestId).toBe("req-3c");
  });

  it("returns legacy history sync patch command when transcript v2 is disabled", async () => {
    const agent = createAgent({
      transcriptRevision: 0,
      outputLines: ["> local question"],
    });
    const commands = await runHistorySyncOperation({
      client: {
        call: async <T>() =>
          ({
            sessionKey: agent.sessionKey,
            messages: [{ role: "assistant", content: "Legacy answer" }],
          }) as T,
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

  it("still applies history when transcript revision changes during fetch", async () => {
    const requestAgent = createAgent({
      transcriptRevision: 7,
      outputLines: ["> local question", "assistant current"],
    });
    const latestAgent = createAgent({
      transcriptRevision: 8,
      outputLines: ["> local question", "assistant current"],
    });
    let readCount = 0;
    const inFlight = new Set<string>();
    const commands = await runHistorySyncOperation({
      client: {
        call: async <T>() =>
          ({
            sessionKey: requestAgent.sessionKey,
            messages: [{ role: "assistant", content: "stale remote answer" }],
          }) as T,
      },
      agentId: "agent-1",
      getAgent: () => {
        readCount += 1;
        return readCount <= 1 ? requestAgent : latestAgent;
      },
      inFlightSessionKeys: inFlight,
      requestId: "req-5",
      loadedAt: 5_678,
      defaultLimit: 200,
      maxLimit: 5000,
      transcriptV2Enabled: true,
    });

    const metrics = getCommandsByKind(commands, "logMetric");
    expect(metrics).toEqual([]);

    const updates = getCommandsByKind(commands, "dispatchUpdateAgent");
    const finalUpdate = updates[updates.length - 1];
    if (!finalUpdate) throw new Error("Expected final update command.");
    const patch = finalUpdate.patch;
    expect(patch.outputLines).toContain("> local question");
    expect(patch.outputLines).toContain("assistant current");
    expect(patch.outputLines).toContain("stale remote answer");
    expect(patch.lastAppliedHistoryRequestId).toBe("req-5");
    expect(inFlight.size).toBe(0);
  });
});
