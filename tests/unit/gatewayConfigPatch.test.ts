import { describe, expect, it, vi } from "vitest";

import {
  createGatewayAgent,
  deleteGatewayAgent,
  renameGatewayAgent,
  resolveHeartbeatSettings,
  removeGatewayHeartbeatOverride,
  updateGatewayHeartbeat,
} from "@/lib/gateway/agentConfig";
import { GatewayResponseError, type GatewayClient } from "@/lib/gateway/GatewayClient";

describe("gateway agent helpers", () => {
  it("creates a new agent via agents.create and derives workspace from the config path", async () => {
    const client = {
      call: vi.fn(async (method: string, params?: unknown) => {
        if (method === "config.get") {
          return {
            exists: true,
            hash: "hash-create-1",
            path: "/Users/test/.openclaw/openclaw.json",
            config: { agents: { list: [{ id: "agent-1", name: "Agent One" }] } },
          };
        }
        if (method === "agents.create") {
          expect(params).toEqual({
            name: "New Agent",
            workspace: "/Users/test/.openclaw/workspace-new-agent",
          });
          return { ok: true, agentId: "new-agent", name: "New Agent", workspace: "ignored" };
        }
        throw new Error("unexpected method");
      }),
    } as unknown as GatewayClient;

    const entry = await createGatewayAgent({ client, name: "New Agent" });
    expect(entry.id).toBe("new-agent");
    expect(entry.name).toBe("New Agent");
  });

  it("slugifies workspace names from agent names", async () => {
    const client = {
      call: vi.fn(async (method: string, params?: unknown) => {
        if (method === "config.get") {
          return {
            exists: true,
            hash: "hash-create-slug-1",
            path: "/Users/test/.openclaw/openclaw.json",
            config: { agents: { list: [] } },
          };
        }
        if (method === "agents.create") {
          expect(params).toEqual({
            name: "My Project",
            workspace: "/Users/test/.openclaw/workspace-my-project",
          });
          return { ok: true, agentId: "my-project", name: "My Project", workspace: "ignored" };
        }
        throw new Error("unexpected method");
      }),
    } as unknown as GatewayClient;

    const entry = await createGatewayAgent({ client, name: "My Project" });
    expect(entry.id).toBe("my-project");
    expect(entry.name).toBe("My Project");
  });

  it("returns no-op on deleting a missing agent", async () => {
    const client = {
      call: vi.fn(async (method: string) => {
        if (method === "agents.delete") {
          throw new GatewayResponseError({
            code: "INVALID_REQUEST",
            message: 'agent "agent-2" not found',
          });
        }
        throw new Error("unexpected method");
      }),
    } as unknown as GatewayClient;

    const result = await deleteGatewayAgent({
      client,
      agentId: "agent-2",
    });

    expect(result).toEqual({ removed: false, removedBindings: 0 });
    expect(client.call).toHaveBeenCalledTimes(1);
    expect((client.call as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe("agents.delete");
  });

  it("fails fast on empty create name", async () => {
    const client = {
      call: vi.fn(),
    } as unknown as GatewayClient;

    await expect(createGatewayAgent({ client, name: "   " })).rejects.toThrow(
      "Agent name is required."
    );
    expect(client.call).not.toHaveBeenCalled();
  });

  it("fails when create name produces an empty id slug", async () => {
    const client = {
      call: vi.fn(async (method: string) => {
        if (method === "config.get") {
          return {
            exists: true,
            hash: "hash-create-empty-slug-1",
            path: "/Users/test/.openclaw/openclaw.json",
            config: {
              agents: { list: [] },
            },
          };
        }
        throw new Error("unexpected method");
      }),
    } as unknown as GatewayClient;

    await expect(createGatewayAgent({ client, name: "!!!" })).rejects.toThrow(
      "Name produced an empty folder name."
    );
    expect(client.call).toHaveBeenCalledTimes(1);
    expect((client.call as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toBe("config.get");
  });

  it("returns current settings when no heartbeat override exists to remove", async () => {
    const client = {
      call: vi.fn(async (method: string) => {
        if (method === "config.get") {
          return {
            exists: true,
            hash: "hash-remove-1",
            path: "/Users/test/.openclaw/openclaw.json",
            config: {
              agents: {
                defaults: {
                  heartbeat: {
                    every: "10m",
                    target: "last",
                    includeReasoning: false,
                    ackMaxChars: 300,
                  },
                },
                list: [{ id: "agent-1", name: "Agent One" }],
              },
            },
          };
        }
        throw new Error("unexpected method");
      }),
    } as unknown as GatewayClient;

    const result = await removeGatewayHeartbeatOverride({
      client,
      agentId: "agent-1",
    });

    expect(result).toEqual({
      heartbeat: {
        every: "10m",
        target: "last",
        includeReasoning: false,
        ackMaxChars: 300,
        activeHours: null,
      },
      hasOverride: false,
    });
    expect(client.call).toHaveBeenCalledTimes(1);
  });

  it("renames an agent via agents.update", async () => {
    const client = {
      call: vi.fn(async (method: string, params?: unknown) => {
        if (method === "agents.update") {
          expect(params).toEqual({ agentId: "agent-1", name: "New Name" });
          return { ok: true, agentId: "agent-1" };
        }
        throw new Error("unexpected method");
      }),
    } as unknown as GatewayClient;

    await renameGatewayAgent({ client, agentId: "agent-1", name: "New Name" });
  });

  it("resolves heartbeat defaults and overrides", () => {
    const config = {
      agents: {
        defaults: {
          heartbeat: {
            every: "2h",
            target: "last",
            includeReasoning: false,
            ackMaxChars: 200,
          },
        },
        list: [
          {
            id: "agent-1",
            heartbeat: { every: "30m", target: "none", includeReasoning: true },
          },
        ],
      },
    };
    const result = resolveHeartbeatSettings(config, "agent-1");
    expect(result.heartbeat.every).toBe("30m");
    expect(result.heartbeat.target).toBe("none");
    expect(result.heartbeat.includeReasoning).toBe(true);
    expect(result.hasOverride).toBe(true);
  });

  it("updates heartbeat overrides via config.patch", async () => {
    const client = {
      call: vi.fn(async (method: string, params?: unknown) => {
        if (method === "config.get") {
          return {
            exists: true,
            hash: "hash-2",
            path: "/Users/test/.openclaw/openclaw.json",
            config: {
              agents: {
                defaults: {
                  heartbeat: {
                    every: "1h",
                    target: "last",
                    includeReasoning: false,
                    ackMaxChars: 300,
                  },
                },
                list: [{ id: "agent-1" }],
              },
            },
          };
        }
        if (method === "config.patch") {
          const raw = (params as { raw?: string }).raw ?? "";
          const parsed = JSON.parse(raw) as {
            agents?: { list?: Array<{ id?: string; heartbeat?: unknown }> };
          };
          const entry = parsed.agents?.list?.find((item) => item.id === "agent-1");
          expect(entry && typeof entry === "object").toBe(true);
          return { ok: true };
        }
        throw new Error("unexpected method");
      }),
    } as unknown as GatewayClient;

    const result = await updateGatewayHeartbeat({
      client,
      agentId: "agent-1",
      payload: {
        override: true,
        heartbeat: {
          every: "15m",
          target: "none",
          includeReasoning: true,
          ackMaxChars: 120,
          activeHours: { start: "08:00", end: "18:00" },
        },
      },
    });

    expect(result.heartbeat.every).toBe("15m");
    expect(result.heartbeat.target).toBe("none");
    expect(result.heartbeat.includeReasoning).toBe(true);
    expect(result.hasOverride).toBe(true);
  });
});
