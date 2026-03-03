// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

type RuntimeMock = {
  ensureStarted: () => Promise<void>;
  snapshot: () => { status: string; reason: string | null; asOf: string | null; outboxHead: number };
  eventsAfter: (lastSeenId: number, limit?: number) => Array<{
    id: number;
    event: unknown;
    createdAt: string;
  }>;
  eventsBefore: (beforeOutboxId: number, limit?: number) => Array<{
    id: number;
    event: unknown;
    createdAt: string;
  }>;
  eventsBeforeForAgent: (agentId: string, beforeOutboxId: number, limit?: number) => Array<{
    id: number;
    event: unknown;
    createdAt: string;
  }>;
  backfillAgentHistoryIndex: (
    beforeOutboxId: number,
    limit?: number
  ) => { scannedRows: number; updatedRows: number; exhausted: boolean };
  subscribe: (handler: (entry: { id: number; event: unknown; createdAt: string }) => void) => () => void;
};

const loadRouteModule = async <T>(modulePath: string, runtimeMock: RuntimeMock) => {
  vi.resetModules();
  vi.doMock("@/lib/controlplane/runtime", () => ({
    isStudioDomainApiModeEnabled: () => true,
    getControlPlaneRuntime: () => runtimeMock,
  }));
  return await import(modulePath) as T;
};

const readStreamUntil = async (
  reader: ReadableStreamDefaultReader<Uint8Array>,
  predicate: (text: string) => boolean,
  maxReads: number = 20
): Promise<string> => {
  let output = "";
  const decoder = new TextDecoder();
  for (let index = 0; index < maxReads; index += 1) {
    const chunk = await reader.read();
    if (chunk.done) break;
    output += decoder.decode(chunk.value);
    if (predicate(output)) break;
  }
  return output;
};

describe("runtime routes", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("summary route returns projection-backed snapshot and freshness", async () => {
    const runtimeMock: RuntimeMock = {
      ensureStarted: async () => {},
      snapshot: () => ({
        status: "connected",
        reason: null,
        asOf: "2026-02-28T02:40:00.000Z",
        outboxHead: 12,
      }),
      eventsAfter: () => [],
      eventsBefore: () => [],
      eventsBeforeForAgent: () => [],
      backfillAgentHistoryIndex: () => ({ scannedRows: 0, updatedRows: 0, exhausted: true }),
      subscribe: () => () => {},
    };

    const mod = await loadRouteModule<{ GET: () => Promise<Response> }>(
      "@/app/api/runtime/summary/route",
      runtimeMock
    );
    const response = await mod.GET();
    expect(response.status).toBe(200);
    const body = await response.json() as {
      enabled: boolean;
      summary: { status: string; outboxHead: number };
      freshness: { stale: boolean; source: string };
    };
    expect(body.enabled).toBe(true);
    expect(body.summary.status).toBe("connected");
    expect(body.summary.outboxHead).toBe(12);
    expect(body.freshness.stale).toBe(false);
    expect(body.freshness.source).toBe("gateway");
  });

  it("summary route returns degraded projection freshness when gateway start fails", async () => {
    vi.resetModules();
    vi.doMock("@/lib/controlplane/runtime", () => ({
      isStudioDomainApiModeEnabled: () => true,
      getControlPlaneRuntime: () => ({
        ensureStarted: async () => {
          throw new Error("gateway offline");
        },
        snapshot: () => ({
          status: "error",
          reason: "gateway_closed",
          asOf: "2026-02-28T02:40:00.000Z",
          outboxHead: 9,
        }),
        eventsAfter: () => [],
        eventsBefore: () => [],
        eventsBeforeForAgent: () => [],
        backfillAgentHistoryIndex: () => ({ scannedRows: 0, updatedRows: 0, exhausted: true }),
        subscribe: () => () => {},
      }),
    }));
    vi.doMock("@/lib/controlplane/degraded-read", async () => {
      const actual = await vi.importActual<typeof import("@/lib/controlplane/degraded-read")>(
        "@/lib/controlplane/degraded-read"
      );
      return {
        ...actual,
        probeOpenClawLocalState: vi.fn(async () => ({
          at: "2026-02-28T02:41:00.000Z",
          status: { ok: false, error: "openclaw_cli_not_found" },
          sessions: { ok: false, error: "openclaw_cli_not_found" },
        })),
      };
    });

    const mod = await import("@/app/api/runtime/summary/route");
    const response = await mod.GET();
    expect(response.status).toBe(200);
    const body = await response.json() as {
      error?: string;
      freshness: { stale: boolean; source: string; reason: string | null };
    };
    expect(body.error).toBe("gateway offline");
    expect(body.freshness.stale).toBe(true);
    expect(body.freshness.source).toBe("projection");
    expect(body.freshness.reason).toBe("gateway_unavailable");
  });

  it("summary route returns 503 when runtime initialization fails", async () => {
    vi.resetModules();
    vi.doMock("@/lib/controlplane/runtime", () => ({
      isStudioDomainApiModeEnabled: () => true,
      getControlPlaneRuntime: () => {
        throw new Error("runtime init failed");
      },
    }));

    const mod = await import("@/app/api/runtime/summary/route");
    const response = await mod.GET();
    expect(response.status).toBe(503);
    const body = await response.json() as {
      enabled: boolean;
      error: string;
      code: string;
      reason: string;
    };
    expect(body.enabled).toBe(true);
    expect(body.error).toBe("runtime init failed");
    expect(body.code).toBe("CONTROLPLANE_RUNTIME_INIT_FAILED");
    expect(body.reason).toBe("runtime_init_failed");
  });

  it("summary route returns native mismatch remediation when runtime init fails on ABI drift", async () => {
    vi.resetModules();
    vi.doMock("@/lib/controlplane/runtime", () => ({
      isStudioDomainApiModeEnabled: () => true,
      getControlPlaneRuntime: () => {
        const error = new Error(
          "The module '/tmp/better_sqlite3.node' was compiled against a different Node.js version using NODE_MODULE_VERSION 141."
        ) as Error & { code: string };
        error.code = "ERR_DLOPEN_FAILED";
        throw error;
      },
    }));

    const mod = await import("@/app/api/runtime/summary/route");
    const response = await mod.GET();
    expect(response.status).toBe(503);
    const body = await response.json() as {
      code: string;
      reason: string;
      remediation?: { commands?: string[] };
    };
    expect(body.code).toBe("NATIVE_MODULE_MISMATCH");
    expect(body.reason).toBe("native_module_mismatch");
    expect(body.remediation?.commands).toEqual([
      "npm rebuild better-sqlite3",
      "npm install",
    ]);
  });

  it("summary route returns 404 when domain mode is disabled", async () => {
    vi.resetModules();
    vi.doMock("@/lib/controlplane/runtime", () => ({
      isStudioDomainApiModeEnabled: () => false,
      getControlPlaneRuntime: vi.fn(),
    }));

    const mod = await import("@/app/api/runtime/summary/route");
    const response = await mod.GET();
    expect(response.status).toBe(404);
    const body = await response.json() as { enabled: boolean; error: string };
    expect(body.enabled).toBe(false);
    expect(body.error).toBe("domain_api_mode_disabled");
  });

  it("agent history route returns newest window with beforeOutboxId cursor metadata", async () => {
    const runtimeMock: RuntimeMock = {
      ensureStarted: async () => {},
      snapshot: () => ({
        status: "connected",
        reason: null,
        asOf: "2026-02-28T02:40:00.000Z",
        outboxHead: 5,
      }),
      eventsAfter: () => [],
      eventsBefore: () => {
        throw new Error("legacy scan path used");
      },
      eventsBeforeForAgent: (_agentId: string, beforeOutboxId: number) => {
        if (beforeOutboxId === 6) {
          return [
            {
              id: 1,
              event: {
                type: "gateway.event",
                event: "runtime.delta",
                seq: 10,
                payload: { sessionKey: "agent:alpha:main", delta: "a" },
                asOf: "2026-02-28T02:40:01.000Z",
              },
              createdAt: "2026-02-28T02:40:01.000Z",
            },
            {
              id: 3,
              event: {
                type: "gateway.event",
                event: "runtime.delta",
                seq: 12,
                payload: { sessionKey: "agent:alpha:main", delta: "c" },
                asOf: "2026-02-28T02:40:03.000Z",
              },
              createdAt: "2026-02-28T02:40:03.000Z",
            },
            {
              id: 5,
              event: {
                type: "gateway.event",
                event: "runtime.delta",
                seq: 14,
                payload: { sessionKey: "agent:alpha:main", delta: "e" },
                asOf: "2026-02-28T02:40:05.000Z",
              },
              createdAt: "2026-02-28T02:40:05.000Z",
            },
          ];
        }
        if (beforeOutboxId === 3) {
          return [
            {
              id: 1,
              event: {
                type: "gateway.event",
                event: "runtime.delta",
                seq: 10,
                payload: { sessionKey: "agent:alpha:main", delta: "a" },
                asOf: "2026-02-28T02:40:01.000Z",
              },
              createdAt: "2026-02-28T02:40:01.000Z",
            },
          ];
        }
        return [];
      },
      backfillAgentHistoryIndex: () => ({ scannedRows: 0, updatedRows: 0, exhausted: true }),
      subscribe: () => () => {},
    };

    const mod = await loadRouteModule<{
      GET: (
        request: Request,
        context: { params: Promise<{ agentId: string }> }
      ) => Promise<Response>;
    }>("@/app/api/runtime/agents/[agentId]/history/route", runtimeMock);

    const firstResponse = await mod.GET(
      new Request("http://localhost/api/runtime/agents/alpha/history?view=raw&limit=2"),
      { params: Promise.resolve({ agentId: "alpha" }) }
    );
    expect(firstResponse.status).toBe(200);
    const firstBody = (await firstResponse.json()) as {
      entries: Array<{ id: number }>;
      hasMore: boolean;
      nextBeforeOutboxId: number | null;
    };
    expect(firstBody.entries.map((entry) => entry.id)).toEqual([3, 5]);
    expect(firstBody.hasMore).toBe(true);
    expect(firstBody.nextBeforeOutboxId).toBe(3);

    const secondResponse = await mod.GET(
      new Request(
        "http://localhost/api/runtime/agents/alpha/history?view=raw&limit=2&beforeOutboxId=3"
      ),
      { params: Promise.resolve({ agentId: "alpha" }) }
    );
    expect(secondResponse.status).toBe(200);
    const secondBody = (await secondResponse.json()) as {
      entries: Array<{ id: number }>;
      hasMore: boolean;
      nextBeforeOutboxId: number | null;
    };
    expect(secondBody.entries.map((entry) => entry.id)).toEqual([1]);
    expect(secondBody.hasMore).toBe(false);
    expect(secondBody.nextBeforeOutboxId).toBeNull();
  });

  it("agent history route keeps cursor stable while backfill remains incomplete", async () => {
    const eventsBeforeForAgent = vi
      .fn()
      .mockReturnValueOnce([
        {
          id: 7,
          event: {
            type: "gateway.event",
            event: "runtime.delta",
            seq: 20,
            payload: { sessionKey: "agent:alpha:main", delta: "newest" },
            asOf: "2026-02-28T02:40:07.000Z",
          },
          createdAt: "2026-02-28T02:40:07.000Z",
        },
      ])
      .mockReturnValueOnce([
        {
          id: 3,
          event: {
            type: "gateway.event",
            event: "runtime.delta",
            seq: 18,
            payload: { sessionKey: "agent:alpha:main", delta: "older" },
            asOf: "2026-02-28T02:40:03.000Z",
          },
          createdAt: "2026-02-28T02:40:03.000Z",
        },
        {
          id: 5,
          event: {
            type: "gateway.event",
            event: "runtime.delta",
            seq: 19,
            payload: { sessionKey: "agent:alpha:main", delta: "middle" },
            asOf: "2026-02-28T02:40:05.000Z",
          },
          createdAt: "2026-02-28T02:40:05.000Z",
        },
        {
          id: 7,
          event: {
            type: "gateway.event",
            event: "runtime.delta",
            seq: 20,
            payload: { sessionKey: "agent:alpha:main", delta: "newest" },
            asOf: "2026-02-28T02:40:07.000Z",
          },
          createdAt: "2026-02-28T02:40:07.000Z",
        },
      ]);
    const backfillAgentHistoryIndex = vi
      .fn()
      .mockReturnValue({ scannedRows: 500, updatedRows: 221, exhausted: false });
    const runtimeMock: RuntimeMock = {
      ensureStarted: async () => {},
      snapshot: () => ({
        status: "connected",
        reason: null,
        asOf: "2026-02-28T02:40:00.000Z",
        outboxHead: 10,
      }),
      eventsAfter: () => [],
      eventsBefore: () => {
        throw new Error("legacy scan path used");
      },
      eventsBeforeForAgent,
      backfillAgentHistoryIndex,
      subscribe: () => () => {},
    };

    const mod = await loadRouteModule<{
      GET: (
        request: Request,
        context: { params: Promise<{ agentId: string }> }
      ) => Promise<Response>;
    }>("@/app/api/runtime/agents/[agentId]/history/route", runtimeMock);

    const response = await mod.GET(
      new Request("http://localhost/api/runtime/agents/alpha/history?view=raw&limit=2"),
      { params: Promise.resolve({ agentId: "alpha" }) }
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      entries: Array<{ id: number }>;
      hasMore: boolean;
      nextBeforeOutboxId: number | null;
    };
    expect(eventsBeforeForAgent).toHaveBeenNthCalledWith(1, "alpha", 11, 3);
    expect(backfillAgentHistoryIndex).toHaveBeenCalledWith(11, 500);
    expect(eventsBeforeForAgent).toHaveBeenNthCalledWith(2, "alpha", 11, 3);
    expect(body.entries.map((entry) => entry.id)).toEqual([5, 7]);
    expect(body.hasMore).toBe(true);
    expect(body.nextBeforeOutboxId).toBe(11);
  });

  it("agent history route reports continuation when backfill cap is reached before exhaustion", async () => {
    const eventsBeforeForAgent = vi.fn().mockReturnValue([]);
    const backfillAgentHistoryIndex = vi
      .fn()
      .mockReturnValue({ scannedRows: 500, updatedRows: 0, exhausted: false });
    const runtimeMock: RuntimeMock = {
      ensureStarted: async () => {},
      snapshot: () => ({
        status: "connected",
        reason: null,
        asOf: "2026-02-28T02:40:00.000Z",
        outboxHead: 10,
      }),
      eventsAfter: () => [],
      eventsBefore: () => {
        throw new Error("legacy scan path used");
      },
      eventsBeforeForAgent,
      backfillAgentHistoryIndex,
      subscribe: () => () => {},
    };

    const mod = await loadRouteModule<{
      GET: (
        request: Request,
        context: { params: Promise<{ agentId: string }> }
      ) => Promise<Response>;
    }>("@/app/api/runtime/agents/[agentId]/history/route", runtimeMock);

    const response = await mod.GET(
      new Request("http://localhost/api/runtime/agents/alpha/history?view=raw&limit=2"),
      { params: Promise.resolve({ agentId: "alpha" }) }
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      entries: Array<{ id: number }>;
      hasMore: boolean;
      nextBeforeOutboxId: number | null;
    };
    expect(eventsBeforeForAgent).toHaveBeenNthCalledWith(1, "alpha", 11, 3);
    expect(eventsBeforeForAgent).toHaveBeenNthCalledWith(2, "alpha", 11, 3);
    expect(eventsBeforeForAgent).toHaveBeenNthCalledWith(3, "alpha", 11, 3);
    expect(backfillAgentHistoryIndex).toHaveBeenNthCalledWith(1, 11, 500);
    expect(backfillAgentHistoryIndex).toHaveBeenNthCalledWith(2, 11, 500);
    expect(body.entries).toEqual([]);
    expect(body.hasMore).toBe(true);
    expect(body.nextBeforeOutboxId).toBe(11);
  });

  it("stream route replays from Last-Event-ID and emits live updates", async () => {
    let subscriber: ((entry: { id: number; event: unknown; createdAt: string }) => void) | null = null;
    const runtimeMock: RuntimeMock = {
      ensureStarted: async () => {},
      snapshot: () => ({
        status: "connected",
        reason: null,
        asOf: "2026-02-28T02:40:00.000Z",
        outboxHead: 4,
      }),
      eventsAfter: (lastSeenId: number) => {
        expect(lastSeenId).toBe(2);
        return [
          {
            id: 3,
            event: {
              type: "gateway.event",
              event: "runtime.delta",
              seq: 20,
              payload: { sessionKey: "agent:alpha:main", delta: "replay" },
              asOf: "2026-02-28T02:40:03.000Z",
            },
            createdAt: "2026-02-28T02:40:03.000Z",
          },
        ];
      },
      eventsBefore: () => [],
      eventsBeforeForAgent: () => [],
      backfillAgentHistoryIndex: () => ({ scannedRows: 0, updatedRows: 0, exhausted: true }),
      subscribe: (handler) => {
        subscriber = handler;
        return () => {
          subscriber = null;
        };
      },
    };

    const mod = await loadRouteModule<{ GET: (request: Request) => Promise<Response> }>(
      "@/app/api/runtime/stream/route",
      runtimeMock
    );
    const response = await mod.GET(
      new Request("http://localhost/api/runtime/stream", {
        headers: { "Last-Event-ID": "2" },
      })
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(response.body).toBeTruthy();

    const reader = response.body!.getReader();
    const first = await reader.read();
    const firstChunk = new TextDecoder().decode(first.value);
    expect(firstChunk).toContain("id: 3");
    expect(firstChunk).toContain("event: gateway.event");

    const emit = subscriber as ((entry: { id: number; event: unknown; createdAt: string }) => void) | null;
    emit?.({
      id: 4,
      event: {
        type: "runtime.status",
        status: "reconnecting",
        reason: "gateway_closed",
        asOf: "2026-02-28T02:40:04.000Z",
      },
      createdAt: "2026-02-28T02:40:04.000Z",
    });

    const second = await reader.read();
    const secondChunk = new TextDecoder().decode(second.value);
    expect(secondChunk).toContain("id: 4");
    expect(secondChunk).toContain("event: runtime.status");

    await reader.cancel();
  });

  it("stream route replays reconnect backlog across multiple pages when missed rows exceed replay limit", async () => {
    const subscriberRef: {
      current: ((entry: { id: number; event: unknown; createdAt: string }) => void) | null;
    } = { current: null };
    const eventsAfterCalls: number[] = [];
    const makeDeltaEntry = (id: number) => ({
      id,
      event: {
        type: "gateway.event" as const,
        event: "runtime.delta",
        seq: id,
        payload: { sessionKey: "agent:alpha:main", index: id },
        asOf: "2026-02-28T02:40:03.000Z",
      },
      createdAt: "2026-02-28T02:40:03.000Z",
    });
    const firstPage = Array.from({ length: 2_000 }, (_value, index) => makeDeltaEntry(index + 3));
    const secondPage = [2_003, 2_004, 2_005].map(makeDeltaEntry);

    const runtimeMock: RuntimeMock = {
      ensureStarted: async () => {},
      snapshot: () => ({
        status: "connected",
        reason: null,
        asOf: "2026-02-28T02:40:00.000Z",
        outboxHead: 2_005,
      }),
      eventsAfter: (lastSeenId: number, limit?: number) => {
        eventsAfterCalls.push(lastSeenId);
        expect(limit).toBe(2_000);
        if (lastSeenId === 2) {
          return firstPage;
        }
        if (lastSeenId === 2_002) {
          return secondPage;
        }
        return [];
      },
      eventsBefore: () => [],
      eventsBeforeForAgent: () => [],
      backfillAgentHistoryIndex: () => ({ scannedRows: 0, updatedRows: 0, exhausted: true }),
      subscribe: (handler) => {
        subscriberRef.current = handler;
        return () => {
          subscriberRef.current = null;
        };
      },
    };

    const mod = await loadRouteModule<{ GET: (request: Request) => Promise<Response> }>(
      "@/app/api/runtime/stream/route",
      runtimeMock
    );
    const response = await mod.GET(
      new Request("http://localhost/api/runtime/stream", {
        headers: { "Last-Event-ID": "2" },
      })
    );
    expect(response.status).toBe(200);
    expect(response.body).toBeTruthy();

    const reader = response.body!.getReader();
    const output = await readStreamUntil(reader, (text) => text.includes("id: 2005"), 2_500);
    expect(eventsAfterCalls).toEqual([2, 2_002]);
    expect(output).toContain("id: 2005");
    await reader.cancel();
  });

  it("stream route clamps reconnect cursor when Last-Event-ID is ahead of current outbox head", async () => {
    const subscriberRef: {
      current: ((entry: { id: number; event: unknown; createdAt: string }) => void) | null;
    } = { current: null };
    const eventsAfterCalls: number[] = [];
    const runtimeMock: RuntimeMock = {
      ensureStarted: async () => {},
      snapshot: () => ({
        status: "connected",
        reason: null,
        asOf: "2026-02-28T02:40:00.000Z",
        outboxHead: 5,
      }),
      eventsAfter: (lastSeenId: number, limit?: number) => {
        eventsAfterCalls.push(lastSeenId);
        expect(limit).toBe(2_000);
        return [];
      },
      eventsBefore: () => [],
      eventsBeforeForAgent: () => [],
      backfillAgentHistoryIndex: () => ({ scannedRows: 0, updatedRows: 0, exhausted: true }),
      subscribe: (handler) => {
        subscriberRef.current = handler;
        return () => {
          subscriberRef.current = null;
        };
      },
    };

    const mod = await loadRouteModule<{ GET: (request: Request) => Promise<Response> }>(
      "@/app/api/runtime/stream/route",
      runtimeMock
    );
    const response = await mod.GET(
      new Request("http://localhost/api/runtime/stream", {
        headers: { "Last-Event-ID": "999" },
      })
    );
    expect(response.status).toBe(200);
    expect(eventsAfterCalls).toEqual([5]);
    expect(response.body).toBeTruthy();

    const emit = subscriberRef.current;
    if (!emit) {
      throw new Error("expected runtime stream subscriber to be attached");
    }
    emit({
      id: 6,
      event: {
        type: "runtime.status",
        status: "connected",
        reason: null,
        asOf: "2026-02-28T02:40:06.000Z",
      },
      createdAt: "2026-02-28T02:40:06.000Z",
    });

    const reader = response.body!.getReader();
    const output = await readStreamUntil(reader, (text) => text.includes("id: 6"));
    expect(output).toContain("id: 6");
    await reader.cancel();
  });

  it("stream route does not drop rows committed between reconnect replay and live subscribe", async () => {
    const subscriberRef: {
      current: ((entry: { id: number; event: unknown; createdAt: string }) => void) | null;
    } = { current: null };
    const replayBackedOutbox: Array<{ id: number; event: unknown; createdAt: string }> = [
      {
        id: 3,
        event: {
          type: "gateway.event",
          event: "runtime.delta",
          seq: 20,
          payload: { sessionKey: "agent:alpha:main", delta: "replay" },
          asOf: "2026-02-28T02:40:03.000Z",
        },
        createdAt: "2026-02-28T02:40:03.000Z",
      },
    ];
    const runtimeMock: RuntimeMock = {
      ensureStarted: async () => {},
      snapshot: () => ({
        status: "connected",
        reason: null,
        asOf: "2026-02-28T02:40:00.000Z",
        outboxHead: 4,
      }),
      eventsAfter: (lastSeenId: number) => {
        expect(lastSeenId).toBe(2);
        return replayBackedOutbox.filter((entry) => entry.id > lastSeenId);
      },
      eventsBefore: () => [],
      eventsBeforeForAgent: () => [],
      backfillAgentHistoryIndex: () => ({ scannedRows: 0, updatedRows: 0, exhausted: true }),
      subscribe: (handler) => {
        replayBackedOutbox.push({
          id: 4,
          event: {
            type: "gateway.event",
            event: "runtime.delta",
            seq: 21,
            payload: { sessionKey: "agent:alpha:main", delta: "committed-during-startup" },
            asOf: "2026-02-28T02:40:04.000Z",
          },
          createdAt: "2026-02-28T02:40:04.000Z",
        });
        subscriberRef.current = handler;
        return () => {
          subscriberRef.current = null;
        };
      },
    };

    const mod = await loadRouteModule<{ GET: (request: Request) => Promise<Response> }>(
      "@/app/api/runtime/stream/route",
      runtimeMock
    );
    const response = await mod.GET(
      new Request("http://localhost/api/runtime/stream", {
        headers: { "Last-Event-ID": "2" },
      })
    );

    expect(response.status).toBe(200);
    expect(response.body).toBeTruthy();

    const emit = subscriberRef.current;
    if (!emit) {
      throw new Error("expected runtime stream subscriber to be attached");
    }
    emit({
      id: 5,
      event: {
        type: "runtime.status",
        status: "connected",
        reason: null,
        asOf: "2026-02-28T02:40:05.000Z",
      },
      createdAt: "2026-02-28T02:40:05.000Z",
    });

    const reader = response.body!.getReader();
    const output = await readStreamUntil(reader, (text) => text.includes("id: 5"));
    expect(output).toContain("id: 3");
    expect(output).toContain("id: 4");
    expect(output).toContain("id: 5");
    expect(output.indexOf("id: 3")).toBeLessThan(output.indexOf("id: 4"));
    expect(output.indexOf("id: 4")).toBeLessThan(output.indexOf("id: 5"));
    await reader.cancel();
  });

  it("stream route deduplicates rows that arrive in both replay and live startup buffer", async () => {
    const subscriberRef: {
      current: ((entry: { id: number; event: unknown; createdAt: string }) => void) | null;
    } = { current: null };
    const overlapEntry = {
      id: 4,
      event: {
        type: "gateway.event",
        event: "runtime.delta",
        seq: 21,
        payload: { sessionKey: "agent:alpha:main", delta: "overlap" },
        asOf: "2026-02-28T02:40:04.000Z",
      },
      createdAt: "2026-02-28T02:40:04.000Z",
    };
    const runtimeMock: RuntimeMock = {
      ensureStarted: async () => {},
      snapshot: () => ({
        status: "connected",
        reason: null,
        asOf: "2026-02-28T02:40:00.000Z",
        outboxHead: 4,
      }),
      eventsAfter: (lastSeenId: number) => {
        expect(lastSeenId).toBe(2);
        return [
          {
            id: 3,
            event: {
              type: "gateway.event",
              event: "runtime.delta",
              seq: 20,
              payload: { sessionKey: "agent:alpha:main", delta: "replay" },
              asOf: "2026-02-28T02:40:03.000Z",
            },
            createdAt: "2026-02-28T02:40:03.000Z",
          },
          overlapEntry,
        ];
      },
      eventsBefore: () => [],
      eventsBeforeForAgent: () => [],
      backfillAgentHistoryIndex: () => ({ scannedRows: 0, updatedRows: 0, exhausted: true }),
      subscribe: (handler) => {
        subscriberRef.current = handler;
        handler(overlapEntry);
        return () => {
          subscriberRef.current = null;
        };
      },
    };

    const mod = await loadRouteModule<{ GET: (request: Request) => Promise<Response> }>(
      "@/app/api/runtime/stream/route",
      runtimeMock
    );
    const response = await mod.GET(
      new Request("http://localhost/api/runtime/stream", {
        headers: { "Last-Event-ID": "2" },
      })
    );

    expect(response.status).toBe(200);
    expect(response.body).toBeTruthy();

    const emit = subscriberRef.current;
    if (!emit) {
      throw new Error("expected runtime stream subscriber to be attached");
    }
    emit({
      id: 5,
      event: {
        type: "runtime.status",
        status: "connected",
        reason: null,
        asOf: "2026-02-28T02:40:05.000Z",
      },
      createdAt: "2026-02-28T02:40:05.000Z",
    });

    const reader = response.body!.getReader();
    const output = await readStreamUntil(reader, (text) => text.includes("id: 5"));
    const duplicateCount = (output.match(/(^|\n)id: 4\n/gm) ?? []).length;
    expect(output).toContain("id: 3");
    expect(output).toContain("id: 4");
    expect(output).toContain("id: 5");
    expect(duplicateCount).toBe(1);
    await reader.cancel();
  });

  it("stream route does not lose newest head rows during fresh-connect capped replay startup", async () => {
    const subscriberRef: {
      current: ((entry: { id: number; event: unknown; createdAt: string }) => void) | null;
    } = { current: null };
    let outboxHead = 5_000;
    const outboxRows: Array<{ id: number; event: unknown; createdAt: string }> = [
      {
        id: 4_999,
        event: {
          type: "gateway.event",
          event: "runtime.delta",
          seq: 19,
          payload: { sessionKey: "agent:alpha:main", delta: "n-1" },
          asOf: "2026-02-28T02:40:03.000Z",
        },
        createdAt: "2026-02-28T02:40:03.000Z",
      },
      {
        id: 5_000,
        event: {
          type: "gateway.event",
          event: "runtime.delta",
          seq: 20,
          payload: { sessionKey: "agent:alpha:main", delta: "n" },
          asOf: "2026-02-28T02:40:04.000Z",
        },
        createdAt: "2026-02-28T02:40:04.000Z",
      },
    ];
    const runtimeMock: RuntimeMock = {
      ensureStarted: async () => {},
      snapshot: () => ({
        status: "connected",
        reason: null,
        asOf: "2026-02-28T02:40:00.000Z",
        outboxHead,
      }),
      eventsAfter: (lastSeenId: number, limit?: number) => {
        expect(limit).toBe(2_000);
        return outboxRows.filter((entry) => entry.id > lastSeenId).slice(0, limit);
      },
      eventsBefore: () => [],
      eventsBeforeForAgent: () => [],
      backfillAgentHistoryIndex: () => ({ scannedRows: 0, updatedRows: 0, exhausted: true }),
      subscribe: (handler) => {
        outboxHead = 5_001;
        outboxRows.push({
          id: 5_001,
          event: {
            type: "gateway.event",
            event: "runtime.delta",
            seq: 21,
            payload: { sessionKey: "agent:alpha:main", delta: "n+1 boundary" },
            asOf: "2026-02-28T02:40:05.000Z",
          },
          createdAt: "2026-02-28T02:40:05.000Z",
        });
        subscriberRef.current = handler;
        return () => {
          subscriberRef.current = null;
        };
      },
    };

    const mod = await loadRouteModule<{ GET: (request: Request) => Promise<Response> }>(
      "@/app/api/runtime/stream/route",
      runtimeMock
    );
    const response = await mod.GET(new Request("http://localhost/api/runtime/stream"));
    expect(response.status).toBe(200);
    expect(response.body).toBeTruthy();

    const emit = subscriberRef.current;
    if (!emit) {
      throw new Error("expected runtime stream subscriber to be attached");
    }
    emit({
      id: 5_002,
      event: {
        type: "runtime.status",
        status: "connected",
        reason: null,
        asOf: "2026-02-28T02:40:06.000Z",
      },
      createdAt: "2026-02-28T02:40:06.000Z",
    });

    const reader = response.body!.getReader();
    const output = await readStreamUntil(reader, (text) => text.includes("id: 5002"));
    expect(output).toContain("id: 4999");
    expect(output).toContain("id: 5000");
    expect(output).toContain("id: 5001");
    expect(output).toContain("id: 5002");
    expect(output.indexOf("id: 5000")).toBeLessThan(output.indexOf("id: 5001"));
    expect(output.indexOf("id: 5001")).toBeLessThan(output.indexOf("id: 5002"));
    await reader.cancel();
  });

  it("stream route replays newest window when Last-Event-ID is absent", async () => {
    const runtimeMock: RuntimeMock = {
      ensureStarted: async () => {},
      snapshot: () => ({
        status: "connected",
        reason: null,
        asOf: "2026-02-28T02:40:00.000Z",
        outboxHead: 5_000,
      }),
      eventsAfter: (lastSeenId: number) => {
        expect(lastSeenId).toBe(3_000);
        return [
          {
            id: 4_999,
            event: {
              type: "gateway.event",
              event: "runtime.delta",
              seq: 20,
              payload: { sessionKey: "agent:alpha:main", delta: "replay" },
              asOf: "2026-02-28T02:40:03.000Z",
            },
            createdAt: "2026-02-28T02:40:03.000Z",
          },
        ];
      },
      eventsBefore: () => [],
      eventsBeforeForAgent: () => [],
      backfillAgentHistoryIndex: () => ({ scannedRows: 0, updatedRows: 0, exhausted: true }),
      subscribe: () => () => {},
    };

    const mod = await loadRouteModule<{ GET: (request: Request) => Promise<Response> }>(
      "@/app/api/runtime/stream/route",
      runtimeMock
    );
    const response = await mod.GET(new Request("http://localhost/api/runtime/stream"));
    expect(response.status).toBe(200);
    const reader = response.body!.getReader();
    const first = await reader.read();
    const firstChunk = new TextDecoder().decode(first.value);
    expect(firstChunk).toContain("id: 4999");
    await reader.cancel();
  });

  it("stream route returns 503 when runtime cannot start", async () => {
    vi.resetModules();
    vi.doMock("@/lib/controlplane/runtime", () => ({
      isStudioDomainApiModeEnabled: () => true,
      getControlPlaneRuntime: () => ({
        ensureStarted: async () => {
          throw new Error("gateway unavailable");
        },
      }),
    }));

    const mod = await import("@/app/api/runtime/stream/route");
    const response = await mod.GET(new Request("http://localhost/api/runtime/stream"));
    expect(response.status).toBe(503);
    const body = await response.json() as { enabled: boolean; error: string };
    expect(body.enabled).toBe(true);
    expect(body.error).toBe("gateway unavailable");
  });

  it("agent-rename and agent-delete intent routes forward to runtime", async () => {
    const callGateway = vi.fn(async () => ({ ok: true }));
    vi.doMock("@/lib/controlplane/runtime", () => ({
      isStudioDomainApiModeEnabled: () => true,
      getControlPlaneRuntime: () => ({
        ensureStarted: async () => {},
        callGateway,
      }),
    }));

    const renameRoute = await import("@/app/api/intents/agent-rename/route");
    const deleteRoute = await import("@/app/api/intents/agent-delete/route");

    const renameRes = await renameRoute.POST(
      new Request("http://localhost/api/intents/agent-rename", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId: "agent-1", name: "Agent One Renamed" }),
      })
    );
    expect(renameRes.status).toBe(200);

    const deleteRes = await deleteRoute.POST(
      new Request("http://localhost/api/intents/agent-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId: "agent-1" }),
      })
    );
    expect(deleteRes.status).toBe(200);

    expect(callGateway).toHaveBeenCalledWith("agents.update", {
      agentId: "agent-1",
      name: "Agent One Renamed",
    });
    expect(callGateway).toHaveBeenCalledWith("agents.delete", {
      agentId: "agent-1",
    });
  });

  it("intent routes return 503 when runtime initialization fails", async () => {
    vi.resetModules();
    vi.doMock("@/lib/controlplane/runtime", () => ({
      isStudioDomainApiModeEnabled: () => true,
      getControlPlaneRuntime: () => {
        throw new Error("runtime init failed");
      },
    }));

    const renameRoute = await import("@/app/api/intents/agent-rename/route");
    const renameRes = await renameRoute.POST(
      new Request("http://localhost/api/intents/agent-rename", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId: "agent-1", name: "Agent One Renamed" }),
      })
    );
    expect(renameRes.status).toBe(503);
    const body = await renameRes.json() as { error: string; code: string; reason: string };
    expect(body.error).toBe("runtime init failed");
    expect(body.code).toBe("CONTROLPLANE_RUNTIME_INIT_FAILED");
    expect(body.reason).toBe("runtime_init_failed");
  });

  it("runtime fleet route hydrates through control-plane runtime", async () => {
    const callGateway = vi.fn(async () => ({ ok: true }));
    vi.doMock("@/lib/controlplane/runtime", () => ({
      isStudioDomainApiModeEnabled: () => true,
      getControlPlaneRuntime: () => ({
        ensureStarted: async () => {},
        snapshot: () => ({
          status: "connected",
          reason: null,
          asOf: "2026-02-28T02:40:00.000Z",
          outboxHead: 0,
        }),
        eventsAfter: () => [],
        callGateway,
      }),
    }));
    vi.doMock("@/lib/studio/settings-store", () => ({
      loadStudioSettings: () => ({
        version: 1,
        gateway: { url: "ws://localhost:3000/ws", token: "" },
        localGatewayDefaults: { url: "", token: "" },
        focused: {},
        avatars: {},
      }),
    }));
    vi.doMock("@/features/agents/operations/agentFleetHydration", () => ({
      hydrateAgentFleetFromGateway: vi.fn(async () => ({
        seeds: [{ agentId: "agent-1", name: "Agent One", sessionKey: "agent:agent-1:main" }],
        sessionCreatedAgentIds: ["agent-1"],
        sessionSettingsSyncedAgentIds: ["agent-1"],
        summaryPatches: [],
        suggestedSelectedAgentId: "agent-1",
        configSnapshot: null,
      })),
    }));
    const route = await import("@/app/api/runtime/fleet/route");
    const response = await route.POST(
      new Request("http://localhost/api/runtime/fleet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cachedConfigSnapshot: null }),
      })
    );
    expect(response.status).toBe(200);
    const body = await response.json() as { result: { seeds: Array<{ agentId: string }> } };
    expect(body.result.seeds[0]?.agentId).toBe("agent-1");
  });

  it("runtime fleet route returns degraded projection payload when runtime cannot start", async () => {
    vi.resetModules();
    vi.doMock("@/lib/controlplane/runtime", () => ({
      isStudioDomainApiModeEnabled: () => true,
      getControlPlaneRuntime: () => ({
        ensureStarted: async () => {
          throw new Error("gateway unavailable");
        },
        snapshot: () => ({
          status: "error",
          reason: "gateway_closed",
          asOf: "2026-02-28T02:40:00.000Z",
          outboxHead: 5,
        }),
        eventsAfter: () => [
          {
            id: 3,
            event: {
              type: "gateway.event",
              event: "runtime.delta",
              seq: 12,
              payload: {
                sessionKey: "agent:alpha:main",
              },
              asOf: "2026-02-28T02:40:03.000Z",
            },
            createdAt: "2026-02-28T02:40:03.000Z",
          },
          {
            id: 4,
            event: {
              type: "gateway.event",
              event: "runtime.delta",
              seq: 13,
              payload: {
                agentId: "beta",
                agentName: "Beta Agent",
              },
              asOf: "2026-02-28T02:40:04.000Z",
            },
            createdAt: "2026-02-28T02:40:04.000Z",
          },
        ],
      }),
    }));
    vi.doMock("@/lib/controlplane/degraded-read", async () => {
      const actual = await vi.importActual<typeof import("@/lib/controlplane/degraded-read")>(
        "@/lib/controlplane/degraded-read"
      );
      return {
        ...actual,
        probeOpenClawLocalState: vi.fn(async () => ({
          at: "2026-02-28T02:41:00.000Z",
          status: { ok: false, error: "openclaw_cli_not_found" },
          sessions: { ok: false, error: "openclaw_cli_not_found" },
        })),
      };
    });
    const route = await import("@/app/api/runtime/fleet/route");
    const response = await route.POST(
      new Request("http://localhost/api/runtime/fleet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cachedConfigSnapshot: null }),
      })
    );
    expect(response.status).toBe(200);
    const body = await response.json() as {
      enabled: boolean;
      degraded: boolean;
      error: string;
      code: string;
      reason: string;
      result: {
        seeds: Array<{ agentId: string; name: string; sessionKey: string }>;
        sessionCreatedAgentIds: string[];
      };
    };
    expect(body.enabled).toBe(true);
    expect(body.degraded).toBe(true);
    expect(body.error).toBe("gateway unavailable");
    expect(body.code).toBe("GATEWAY_UNAVAILABLE");
    expect(body.reason).toBe("gateway_unavailable");
    expect(body.result.seeds).toEqual([
      { agentId: "alpha", name: "alpha", sessionKey: "agent:alpha:main" },
      { agentId: "beta", name: "Beta Agent", sessionKey: "agent:beta:main" },
    ]);
    expect(body.result.sessionCreatedAgentIds).toEqual(["alpha", "beta"]);
  });

  it("runtime fleet route degrades when hydration fails with missing scope", async () => {
    vi.resetModules();
    vi.doMock("@/lib/controlplane/runtime", () => ({
      isStudioDomainApiModeEnabled: () => true,
      getControlPlaneRuntime: () => ({
        ensureStarted: async () => {},
        snapshot: () => ({
          status: "connected",
          reason: null,
          asOf: "2026-02-28T02:40:00.000Z",
          outboxHead: 3,
        }),
        eventsAfter: () => [
          {
            id: 3,
            event: {
              type: "gateway.event",
              event: "runtime.delta",
              seq: 12,
              payload: {
                sessionKey: "agent:alpha:main",
              },
              asOf: "2026-02-28T02:40:03.000Z",
            },
            createdAt: "2026-02-28T02:40:03.000Z",
          },
        ],
        callGateway: vi.fn(),
      }),
    }));
    vi.doMock("@/lib/studio/settings-store", () => ({
      loadStudioSettings: () => ({
        version: 1,
        gateway: { url: "ws://localhost:3000/ws", token: "" },
        localGatewayDefaults: { url: "", token: "" },
        focused: {},
        avatars: {},
      }),
    }));
    vi.doMock("@/lib/controlplane/degraded-read", async () => {
      const actual = await vi.importActual<typeof import("@/lib/controlplane/degraded-read")>(
        "@/lib/controlplane/degraded-read"
      );
      return {
        ...actual,
        probeOpenClawLocalState: vi.fn(async () => ({
          at: "2026-02-28T02:41:00.000Z",
          status: { ok: false, error: "openclaw_cli_not_found" },
          sessions: { ok: false, error: "openclaw_cli_not_found" },
        })),
      };
    });
    vi.doMock("@/features/agents/operations/agentFleetHydration", () => ({
      hydrateAgentFleetFromGateway: vi.fn(async () => {
        const error = new Error("missing scope: operator.read") as Error & { code: string };
        error.code = "INVALID_REQUEST";
        throw error;
      }),
    }));

    const route = await import("@/app/api/runtime/fleet/route");
    const response = await route.POST(
      new Request("http://localhost/api/runtime/fleet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cachedConfigSnapshot: null }),
      })
    );

    expect(response.status).toBe(200);
    const body = await response.json() as {
      enabled: boolean;
      degraded: boolean;
      code: string;
      reason: string;
      result: { seeds: Array<{ agentId: string }>; sessionCreatedAgentIds: string[] };
    };
    expect(body.enabled).toBe(true);
    expect(body.degraded).toBe(true);
    expect(body.code).toBe("INSUFFICIENT_SCOPE");
    expect(body.reason).toBe("insufficient_scope");
    expect(body.result.seeds.map((entry) => entry.agentId)).toEqual(["alpha"]);
    expect(body.result.sessionCreatedAgentIds).toEqual(["alpha"]);
  });

  it("runtime fleet route returns 503 when runtime initialization fails", async () => {
    vi.resetModules();
    vi.doMock("@/lib/controlplane/runtime", () => ({
      isStudioDomainApiModeEnabled: () => true,
      getControlPlaneRuntime: () => {
        throw new Error("runtime init failed");
      },
    }));
    const route = await import("@/app/api/runtime/fleet/route");
    const response = await route.POST(
      new Request("http://localhost/api/runtime/fleet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cachedConfigSnapshot: null }),
      })
    );
    expect(response.status).toBe(503);
    const body = await response.json() as {
      enabled: boolean;
      error: string;
      code: string;
      reason: string;
    };
    expect(body.enabled).toBe(true);
    expect(body.error).toBe("runtime init failed");
    expect(body.code).toBe("CONTROLPLANE_RUNTIME_INIT_FAILED");
    expect(body.reason).toBe("runtime_init_failed");
  });
});
