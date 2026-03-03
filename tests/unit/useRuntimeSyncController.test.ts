import { createElement, useEffect } from "react";
import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useRuntimeSyncController } from "@/features/agents/operations/useRuntimeSyncController";
import type { AgentState } from "@/features/agents/state/store";

import {
  executeAgentReconcileCommands,
  runAgentReconcileOperation,
} from "@/features/agents/operations/agentReconcileOperation";
import {
  executeHistorySyncCommands,
  runHistorySyncOperation,
} from "@/features/agents/operations/historySyncOperation";
import type { GatewayGapInfo } from "@/lib/gateway/GatewayClient";

vi.mock("@/features/agents/operations/historySyncOperation", () => ({
  runHistorySyncOperation: vi.fn(async () => []),
  executeHistorySyncCommands: vi.fn(),
}));

vi.mock("@/features/agents/operations/agentReconcileOperation", () => ({
  runAgentReconcileOperation: vi.fn(async () => []),
  executeAgentReconcileCommands: vi.fn(),
}));

const createAgent = (overrides?: Partial<AgentState>): AgentState => ({
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
  ...(overrides ?? {}),
});

type RuntimeSyncControllerValue = ReturnType<typeof useRuntimeSyncController>;

type RenderControllerContext = {
  getValue: () => RuntimeSyncControllerValue;
  rerenderWith: (
    overrides: Partial<Parameters<typeof useRuntimeSyncController>[0]>
  ) => void;
  unmount: () => void;
  dispatch: ReturnType<typeof vi.fn>;
  clearRunTracking: ReturnType<typeof vi.fn>;
  ingestDomainOutboxEntries: ReturnType<typeof vi.fn>;
  call: ReturnType<typeof vi.fn>;
  onGap: ReturnType<typeof vi.fn>;
  getGapHandler: () => ((info: GatewayGapInfo) => void) | null;
  unsubscribeGap: ReturnType<typeof vi.fn>;
};

const renderController = (
  overrides?: Partial<Parameters<typeof useRuntimeSyncController>[0]>
): RenderControllerContext => {
  const dispatch = vi.fn();
  const clearRunTracking = vi.fn();
  const ingestDomainOutboxEntries = vi.fn();
  const call = vi.fn(async (method: string) => {
    if (method === "status") {
      return { sessions: { recent: [], byAgent: [] } };
    }
    if (method === "sessions.preview") {
      return { ts: 123, previews: [] };
    }
    return {};
  });
  let gapHandler: ((info: GatewayGapInfo) => void) | null = null;
  const unsubscribeGap = vi.fn();
  const onGap = vi.fn((handler: (info: GatewayGapInfo) => void) => {
    gapHandler = handler;
    return unsubscribeGap;
  });

  const currentParamsBase: Omit<
    Parameters<typeof useRuntimeSyncController>[0],
    "useDomainApiReads" | "ingestDomainOutboxEntries"
  > = {
    client: {
      call,
      onGap,
    } as never,
    status: "connected",
    agents: [createAgent({ status: "running", historyLoadedAt: 1000, runId: "run-1" })],
    focusedAgentId: null,
    focusedAgentRunning: false,
    dispatch,
    clearRunTracking,
    isDisconnectLikeError: () => false,
    defaultHistoryLimit: 200,
    maxHistoryLimit: 5000,
    ...(overrides ?? {}),
  };
  let currentParams: Parameters<typeof useRuntimeSyncController>[0] = {
    ...currentParamsBase,
    useDomainApiReads: overrides?.useDomainApiReads ?? false,
    ingestDomainOutboxEntries: overrides?.ingestDomainOutboxEntries ?? ingestDomainOutboxEntries,
  };

  const valueRef: { current: RuntimeSyncControllerValue | null } = { current: null };

  const Probe = ({
    params,
    onValue,
  }: {
    params: Parameters<typeof useRuntimeSyncController>[0];
    onValue: (value: RuntimeSyncControllerValue) => void;
  }) => {
    const value = useRuntimeSyncController(params);
    useEffect(() => {
      onValue(value);
    }, [onValue, value]);
    return createElement("div", { "data-testid": "probe" }, "ok");
  };

  const rendered = render(
    createElement(Probe, {
      params: currentParams,
      onValue: (value) => {
        valueRef.current = value;
      },
    })
  );

  return {
    getValue: () => {
      if (!valueRef.current) {
        throw new Error("runtime sync controller value unavailable");
      }
      return valueRef.current;
    },
    rerenderWith: (nextOverrides) => {
      currentParams = {
        ...currentParams,
        ...nextOverrides,
        useDomainApiReads: nextOverrides.useDomainApiReads ?? currentParams.useDomainApiReads,
        ingestDomainOutboxEntries:
          nextOverrides.ingestDomainOutboxEntries ?? currentParams.ingestDomainOutboxEntries,
      };
      rendered.rerender(
        createElement(Probe, {
          params: currentParams,
          onValue: (value) => {
            valueRef.current = value;
          },
        })
      );
    },
    unmount: () => {
      rendered.unmount();
    },
    dispatch,
    clearRunTracking,
    ingestDomainOutboxEntries,
    call,
    onGap,
    getGapHandler: () => gapHandler,
    unsubscribeGap,
  };
};

describe("useRuntimeSyncController", () => {
  const mockedRunHistorySyncOperation = vi.mocked(runHistorySyncOperation);
  const mockedExecuteHistorySyncCommands = vi.mocked(executeHistorySyncCommands);
  const mockedRunAgentReconcileOperation = vi.mocked(runAgentReconcileOperation);
  const mockedExecuteAgentReconcileCommands = vi.mocked(executeAgentReconcileCommands);

  beforeEach(() => {
    vi.useFakeTimers();
    mockedRunHistorySyncOperation.mockReset();
    mockedRunHistorySyncOperation.mockResolvedValue([]);
    mockedExecuteHistorySyncCommands.mockReset();
    mockedRunAgentReconcileOperation.mockReset();
    mockedRunAgentReconcileOperation.mockResolvedValue([]);
    mockedExecuteAgentReconcileCommands.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("runs reconcile immediately and every 3000ms while connected then cleans up", async () => {
    const ctx = renderController({
      focusedAgentId: null,
      focusedAgentRunning: false,
    });

    await act(async () => {
      await Promise.resolve();
    });
    expect(mockedRunAgentReconcileOperation).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(2999);
    expect(mockedRunAgentReconcileOperation).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(mockedRunAgentReconcileOperation).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(3000);
    expect(mockedRunAgentReconcileOperation).toHaveBeenCalledTimes(3);

    ctx.unmount();
    await vi.advanceTimersByTimeAsync(6000);
    expect(mockedRunAgentReconcileOperation).toHaveBeenCalledTimes(3);
  });

  it("polls focused running history every 4500ms and stops when focus no longer running", async () => {
    const ctx = renderController({
      agents: [createAgent({ status: "running", historyLoadedAt: 1234 })],
      focusedAgentId: "agent-1",
      focusedAgentRunning: true,
    });

    await act(async () => {
      await Promise.resolve();
    });
    expect(mockedRunHistorySyncOperation).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(4500);
    expect(mockedRunHistorySyncOperation).toHaveBeenCalledTimes(2);

    ctx.rerenderWith({
      agents: [createAgent({ status: "idle", historyLoadedAt: 1234 })],
      focusedAgentId: "agent-1",
      focusedAgentRunning: false,
    });

    await vi.advanceTimersByTimeAsync(9000);
    expect(mockedRunHistorySyncOperation).toHaveBeenCalledTimes(2);
  });

  it("bootstraps history only for connected sessions missing loaded history", async () => {
    renderController({
      status: "connected",
      focusedAgentId: null,
      focusedAgentRunning: false,
      agents: [
        createAgent({ agentId: "agent-1", sessionCreated: true, historyLoadedAt: null }),
        createAgent({ agentId: "agent-2", sessionCreated: true, historyLoadedAt: 1234 }),
        createAgent({ agentId: "agent-3", sessionCreated: false, historyLoadedAt: null }),
      ],
    });

    await act(async () => {
      await Promise.resolve();
    });

    const bootstrappedAgentIds = mockedRunHistorySyncOperation.mock.calls
      .map(([arg]) => (arg as { agentId: string }).agentId)
      .filter((agentId) => agentId === "agent-1" || agentId === "agent-2" || agentId === "agent-3");

    expect(bootstrappedAgentIds).toContain("agent-1");
    expect(bootstrappedAgentIds).not.toContain("agent-2");
    expect(bootstrappedAgentIds).not.toContain("agent-3");
  });

  it("loads summary snapshot when status transitions to connected", async () => {
    const ctx = renderController({
      status: "disconnected",
      focusedAgentId: null,
      focusedAgentRunning: false,
      agents: [createAgent({ sessionCreated: true, historyLoadedAt: 1234 })],
    });

    expect(ctx.call).not.toHaveBeenCalledWith("status", {});

    ctx.rerenderWith({ status: "connected" });
    await act(async () => {
      await Promise.resolve();
    });

    expect(ctx.call).toHaveBeenCalledWith("status", {});
    expect(ctx.call).toHaveBeenCalledWith("sessions.preview", {
      keys: ["agent:agent-1:main"],
      limit: 8,
      maxChars: 240,
    });
  });

  it("handles gap recovery by triggering summary refresh and reconcile", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const ctx = renderController({
      agents: [createAgent({ status: "running", historyLoadedAt: 1234, runId: "run-1" })],
    });

    await act(async () => {
      await Promise.resolve();
    });
    expect(ctx.onGap).toHaveBeenCalledTimes(1);
    const handler = ctx.getGapHandler();
    if (!handler) {
      throw new Error("expected gap handler to be registered");
    }

    mockedRunAgentReconcileOperation.mockClear();
    ctx.call.mockClear();

    await act(async () => {
      handler({ expected: 10, received: 11 });
      await Promise.resolve();
    });
    expect(ctx.call).toHaveBeenCalledWith("status", {});
    expect(ctx.call).toHaveBeenCalledWith("sessions.preview", {
      keys: ["agent:agent-1:main"],
      limit: 8,
      maxChars: 240,
    });
    expect(mockedRunAgentReconcileOperation).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith("Gateway event gap expected 10, received 11.");
  });

  it("unsubscribes gap listener on unmount", () => {
    const ctx = renderController();
    ctx.unmount();
    expect(ctx.unsubscribeGap).toHaveBeenCalledTimes(1);
  });

  it("clears history in-flight tracking when requested", async () => {
    const inFlightSeen: boolean[] = [];
    mockedRunHistorySyncOperation.mockImplementation(
      async ({ agentId, getAgent, inFlightSessionKeys }) => {
        const agent = getAgent(agentId);
        if (!agent) return [];
        const sessionKey = agent.sessionKey;
        inFlightSeen.push(inFlightSessionKeys.has(sessionKey));
        inFlightSessionKeys.add(sessionKey);
        return [];
      }
    );

    const ctx = renderController({
      status: "disconnected",
      agents: [createAgent({ sessionKey: "agent:agent-1:main", historyLoadedAt: null })],
      focusedAgentId: null,
      focusedAgentRunning: false,
    });

    await act(async () => {
      await ctx.getValue().loadAgentHistory("agent-1");
    });
    await act(async () => {
      await ctx.getValue().loadAgentHistory("agent-1");
    });
    act(() => {
      ctx.getValue().clearHistoryInFlight("agent:agent-1:main");
    });
    await act(async () => {
      await ctx.getValue().loadAgentHistory("agent-1");
    });

    expect(inFlightSeen).toEqual([false, true, false]);
  });

  it("uses domain runtime APIs, ingests history entries, and paginates with beforeOutboxId", async () => {
    let historyCallCount = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/runtime/summary")) {
        return new Response(
          JSON.stringify({
            enabled: true,
            summary: { status: "connected", reason: null, asOf: null, outboxHead: 0 },
            freshness: { source: "controlplane", stale: false, asOf: null, reason: null },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      if (url.includes("/api/runtime/agents/agent-1/history")) {
        historyCallCount += 1;
        if (historyCallCount === 1 || historyCallCount === 2) {
          return new Response(
            JSON.stringify({
              enabled: true,
              entries: [
                {
                  id: 5,
                  event: {
                    type: "gateway.event",
                    event: "runtime.delta",
                    seq: 5,
                    payload: { sessionKey: "agent:agent-1:main", delta: "a" },
                    asOf: "2026-03-01T00:00:05.000Z",
                  },
                  createdAt: "2026-03-01T00:00:05.000Z",
                },
                {
                  id: 6,
                  event: {
                    type: "gateway.event",
                    event: "runtime.delta",
                    seq: 6,
                    payload: { sessionKey: "agent:agent-1:main", delta: "b" },
                    asOf: "2026-03-01T00:00:06.000Z",
                  },
                  createdAt: "2026-03-01T00:00:06.000Z",
                },
              ],
              hasMore: true,
              nextBeforeOutboxId: 5,
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }
        return new Response(
          JSON.stringify({
            enabled: true,
            entries: [
              {
                id: 3,
                event: {
                  type: "gateway.event",
                  event: "runtime.delta",
                  seq: 3,
                  payload: { sessionKey: "agent:agent-1:main", delta: "older-a" },
                  asOf: "2026-03-01T00:00:03.000Z",
                },
                createdAt: "2026-03-01T00:00:03.000Z",
              },
              {
                id: 4,
                event: {
                  type: "gateway.event",
                  event: "runtime.delta",
                  seq: 4,
                  payload: { sessionKey: "agent:agent-1:main", delta: "older-b" },
                  asOf: "2026-03-01T00:00:04.000Z",
                },
                createdAt: "2026-03-01T00:00:04.000Z",
              },
            ],
            hasMore: false,
            nextBeforeOutboxId: null,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const ingestDomainOutboxEntries = vi.fn();
    const ctx = renderController({
      status: "disconnected",
      useDomainApiReads: true,
      agents: [createAgent({ historyFetchLimit: 2 })],
      ingestDomainOutboxEntries,
      focusedAgentId: null,
      focusedAgentRunning: false,
    });

    await act(async () => {
      await ctx.getValue().loadAgentHistory("agent-1", { limit: 2 });
    });
    expect(ingestDomainOutboxEntries).toHaveBeenCalledTimes(1);
    expect(ingestDomainOutboxEntries).toHaveBeenNthCalledWith(
      1,
      expect.arrayContaining([expect.objectContaining({ id: 5 }), expect.objectContaining({ id: 6 })])
    );
    expect(ctx.dispatch).toHaveBeenCalledWith({
      type: "updateAgent",
      agentId: "agent-1",
      patch: expect.objectContaining({
        historyFetchLimit: 2,
        historyFetchedCount: 2,
        historyMaybeTruncated: true,
      }),
    });

    await act(async () => {
      await ctx.getValue().loadAgentHistory("agent-1", { limit: 2 });
    });
    expect(ingestDomainOutboxEntries).toHaveBeenCalledTimes(1);

    await act(async () => {
      ctx.getValue().loadMoreAgentHistory("agent-1");
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(
        "/api/runtime/agents/agent-1/history?limit=2&view=raw&beforeOutboxId=5"
      ),
      expect.anything()
    );
    expect(ingestDomainOutboxEntries).toHaveBeenCalledTimes(2);
    expect(ingestDomainOutboxEntries).toHaveBeenNthCalledWith(
      2,
      expect.arrayContaining([expect.objectContaining({ id: 3 }), expect.objectContaining({ id: 4 })])
    );

    expect(ctx.call).not.toHaveBeenCalledWith("status", {});
    vi.unstubAllGlobals();
    ctx.unmount();
  });

  it("backfills active domain runs to recover tool events that fell out of the newest page", async () => {
    let historyCallCount = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/runtime/agents/agent-1/history")) {
        historyCallCount += 1;
        if (historyCallCount === 1) {
          return new Response(
            JSON.stringify({
              enabled: true,
              entries: [
                {
                  id: 10,
                  event: {
                    type: "gateway.event",
                    event: "chat",
                    seq: 10,
                    payload: {
                      runId: "run-1",
                      sessionKey: "agent:agent-1:main",
                      state: "delta",
                    },
                    asOf: "2026-03-01T00:00:10.000Z",
                  },
                  createdAt: "2026-03-01T00:00:10.000Z",
                },
                {
                  id: 11,
                  event: {
                    type: "gateway.event",
                    event: "agent",
                    seq: 11,
                    payload: {
                      runId: "run-1",
                      sessionKey: "agent:agent-1:main",
                      stream: "assistant",
                      data: { delta: "still thinking" },
                    },
                    asOf: "2026-03-01T00:00:11.000Z",
                  },
                  createdAt: "2026-03-01T00:00:11.000Z",
                },
              ],
              hasMore: true,
              nextBeforeOutboxId: 10,
              semanticTurnsIncluded: 1,
              windowTruncated: true,
              activeRun: {
                runId: "run-1",
                status: "running",
                complete: false,
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }
        return new Response(
          JSON.stringify({
            enabled: true,
            entries: [
              {
                id: 8,
                event: {
                  type: "gateway.event",
                  event: "agent",
                  seq: 8,
                  payload: {
                    runId: "run-1",
                    sessionKey: "agent:agent-1:main",
                    stream: "tool",
                    data: { phase: "start", name: "search" },
                  },
                  asOf: "2026-03-01T00:00:08.000Z",
                },
                createdAt: "2026-03-01T00:00:08.000Z",
              },
              {
                id: 9,
                event: {
                  type: "gateway.event",
                  event: "agent",
                  seq: 9,
                  payload: {
                    runId: "run-1",
                    sessionKey: "agent:agent-1:main",
                    stream: "tool",
                    data: { phase: "result", name: "search" },
                  },
                  asOf: "2026-03-01T00:00:09.000Z",
                },
                createdAt: "2026-03-01T00:00:09.000Z",
              },
            ],
            hasMore: true,
            nextBeforeOutboxId: 8,
            activeRun: {
              runId: "run-1",
              status: "running",
              complete: false,
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      return new Response(JSON.stringify({ enabled: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const ingestDomainOutboxEntries = vi.fn();
    const ctx = renderController({
      status: "disconnected",
      useDomainApiReads: true,
      agents: [createAgent({ historyFetchLimit: 2 })],
      ingestDomainOutboxEntries,
      focusedAgentId: null,
      focusedAgentRunning: false,
    });

    await act(async () => {
      await ctx.getValue().loadAgentHistory("agent-1", { limit: 2 });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(
        "/api/runtime/agents/agent-1/history?limit=2&view=semantic&turnLimit=50&scanLimit=800"
      ),
      expect.anything()
    );
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(
        "/api/runtime/agents/agent-1/history?limit=2&view=raw&beforeOutboxId=10"
      ),
      expect.anything()
    );
    expect(ingestDomainOutboxEntries).toHaveBeenCalledTimes(2);
    const firstPageIngested = ingestDomainOutboxEntries.mock.calls[0]?.[0] as Array<{
      id: number;
    }>;
    expect(firstPageIngested.map((entry) => entry.id)).toEqual([10, 11]);
    const backfillIngested = ingestDomainOutboxEntries.mock.calls[1]?.[0] as Array<{
      id: number;
    }>;
    expect(backfillIngested.map((entry) => entry.id)).toEqual([8, 9]);
    expect(ctx.dispatch).toHaveBeenCalledWith({
      type: "updateAgent",
      agentId: "agent-1",
      patch: expect.objectContaining({
        historyFetchLimit: 2,
        historyFetchedCount: 1,
        historyMaybeTruncated: true,
        status: "running",
        runId: "run-1",
      }),
    });

    vi.unstubAllGlobals();
    ctx.unmount();
  });

  it("does not treat user final chat events as terminal during active-run backfill", async () => {
    let historyCallCount = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/runtime/agents/agent-1/history")) {
        historyCallCount += 1;
        if (historyCallCount === 1) {
          return new Response(
            JSON.stringify({
              enabled: true,
              entries: [
                {
                  id: 10,
                  event: {
                    type: "gateway.event",
                    event: "agent",
                    seq: 10,
                    payload: {
                      runId: "run-1",
                      sessionKey: "agent:agent-1:main",
                      stream: "assistant",
                      data: { delta: "thinking" },
                    },
                    asOf: "2026-03-01T00:00:10.000Z",
                  },
                  createdAt: "2026-03-01T00:00:10.000Z",
                },
              ],
              hasMore: true,
              nextBeforeOutboxId: 10,
              semanticTurnsIncluded: 0,
              windowTruncated: true,
              activeRun: {
                runId: "run-1",
                status: "running",
                complete: false,
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }
        if (historyCallCount === 2) {
          return new Response(
            JSON.stringify({
              enabled: true,
              entries: [
                {
                  id: 9,
                  event: {
                    type: "gateway.event",
                    event: "chat",
                    seq: 9,
                    payload: {
                      runId: "run-1",
                      sessionKey: "agent:agent-1:main",
                      state: "final",
                      message: { role: "user", content: "question" },
                    },
                    asOf: "2026-03-01T00:00:09.000Z",
                  },
                  createdAt: "2026-03-01T00:00:09.000Z",
                },
              ],
              hasMore: true,
              nextBeforeOutboxId: 9,
              activeRun: {
                runId: "run-1",
                status: "running",
                complete: false,
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }
        return new Response(
          JSON.stringify({
            enabled: true,
            entries: [
              {
                id: 8,
                event: {
                  type: "gateway.event",
                  event: "agent",
                  seq: 8,
                  payload: {
                    runId: "run-1",
                    sessionKey: "agent:agent-1:main",
                    stream: "lifecycle",
                    data: { phase: "start" },
                  },
                  asOf: "2026-03-01T00:00:08.000Z",
                },
                createdAt: "2026-03-01T00:00:08.000Z",
              },
            ],
            hasMore: false,
            nextBeforeOutboxId: null,
            activeRun: {
              runId: "run-1",
              status: "running",
              complete: false,
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      return new Response(JSON.stringify({ enabled: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const ingestDomainOutboxEntries = vi.fn();
    const ctx = renderController({
      status: "disconnected",
      useDomainApiReads: true,
      agents: [createAgent({ historyFetchLimit: 2 })],
      ingestDomainOutboxEntries,
      focusedAgentId: null,
      focusedAgentRunning: false,
    });

    await act(async () => {
      await ctx.getValue().loadAgentHistory("agent-1", { limit: 2 });
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/runtime/agents/agent-1/history?limit=2&view=raw&beforeOutboxId=9"),
      expect.anything()
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);

    vi.unstubAllGlobals();
    ctx.unmount();
  });

  it("does not drop valid history when outbox ids repeat with new createdAt values", async () => {
    let historyCallCount = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/runtime/agents/agent-1/history")) {
        historyCallCount += 1;
        if (historyCallCount === 1) {
          return new Response(
            JSON.stringify({
              enabled: true,
              entries: [
                {
                  id: 5,
                  event: {
                    type: "gateway.event",
                    event: "runtime.delta",
                    seq: 5,
                    payload: { sessionKey: "agent:agent-1:main", delta: "old" },
                    asOf: "2026-03-01T00:00:05.000Z",
                  },
                  createdAt: "2026-03-01T00:00:05.000Z",
                },
              ],
              hasMore: false,
              nextBeforeOutboxId: null,
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }
        return new Response(
          JSON.stringify({
            enabled: true,
            entries: [
              {
                id: 5,
                event: {
                  type: "gateway.event",
                  event: "runtime.delta",
                  seq: 5,
                  payload: { sessionKey: "agent:agent-1:main", delta: "new" },
                  asOf: "2026-03-02T00:00:05.000Z",
                },
                createdAt: "2026-03-02T00:00:05.000Z",
              },
            ],
            hasMore: false,
            nextBeforeOutboxId: null,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      return new Response(JSON.stringify({ enabled: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const ingestDomainOutboxEntries = vi.fn();
    const ctx = renderController({
      status: "disconnected",
      useDomainApiReads: true,
      agents: [createAgent({ historyFetchLimit: 2 })],
      ingestDomainOutboxEntries,
      focusedAgentId: null,
      focusedAgentRunning: false,
    });

    await act(async () => {
      await ctx.getValue().loadAgentHistory("agent-1", { limit: 2 });
    });
    await act(async () => {
      await ctx.getValue().loadAgentHistory("agent-1", { limit: 2 });
    });

    expect(ingestDomainOutboxEntries).toHaveBeenCalledTimes(2);
    expect(ingestDomainOutboxEntries).toHaveBeenNthCalledWith(
      1,
      expect.arrayContaining([expect.objectContaining({ id: 5, createdAt: "2026-03-01T00:00:05.000Z" })])
    );
    expect(ingestDomainOutboxEntries).toHaveBeenNthCalledWith(
      2,
      expect.arrayContaining([expect.objectContaining({ id: 5, createdAt: "2026-03-02T00:00:05.000Z" })])
    );

    vi.unstubAllGlobals();
    ctx.unmount();
  });
});
