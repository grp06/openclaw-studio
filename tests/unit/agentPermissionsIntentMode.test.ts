import { describe, expect, it, vi } from "vitest";

import { updateAgentPermissionsViaStudio } from "@/features/agents/operations/agentPermissionsOperation";
import { createRuntimeWriteTransport } from "@/features/agents/operations/runtimeWriteTransport";

describe("agentPermissionsOperation intent mode", () => {
  it("uses agent-permissions-update intent when domain mode is enabled", async () => {
    const call = vi.fn(async (method: string) => {
      if (method === "exec.approvals.get" || method === "exec.approvals.set") {
        throw new Error(`${method} should not be called in domain mode`);
      }
      return { ok: true };
    });
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await updateAgentPermissionsViaStudio({
      client: { call } as never,
      runtimeWriteTransport: createRuntimeWriteTransport({
        client: { call } as never,
        useDomainIntents: true,
      }),
      agentId: "agent-1",
      sessionKey: "agent:agent-1:main",
      draft: {
        commandMode: "ask",
        webAccess: true,
        fileTools: true,
      },
      loadAgents: async () => {},
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/intents/agent-permissions-update",
      expect.objectContaining({ method: "POST" })
    );
    expect(call).not.toHaveBeenCalledWith("exec.approvals.get", expect.anything());
    expect(call).not.toHaveBeenCalledWith("exec.approvals.set", expect.anything());
    expect(call).not.toHaveBeenCalledWith("config.get", expect.anything());
    expect(call).not.toHaveBeenCalledWith("config.set", expect.anything());
    expect(call).not.toHaveBeenCalledWith("sessions.patch", expect.anything());
    vi.unstubAllGlobals();
  });

  it("legacy mode does not mutate approvals when config write fails", async () => {
    const call = vi.fn(async (method: string) => {
      if (method === "config.get") {
        return {
          exists: true,
          hash: "cfg-hash-1",
          config: {
            agents: {
              list: [
                {
                  id: "agent-1",
                  sandbox: { mode: "normal" },
                  tools: { alsoAllow: ["group:web"], deny: ["group:fs"] },
                },
              ],
            },
          },
        };
      }
      if (method === "config.set") {
        throw new Error("config changed since last load");
      }
      if (method === "sessions.patch") {
        return { ok: true };
      }
      return { ok: true };
    });
    const execApprovalsSet = vi.fn(async () => undefined);

    await expect(
      updateAgentPermissionsViaStudio({
        client: { call } as never,
        runtimeWriteTransport: {
          useDomainIntents: false,
          execApprovalsSet,
        } as unknown as ReturnType<typeof createRuntimeWriteTransport>,
        agentId: "agent-1",
        sessionKey: "agent:agent-1:main",
        draft: {
          commandMode: "ask",
          webAccess: true,
          fileTools: true,
        },
      })
    ).rejects.toThrow("config changed since last load");

    expect(execApprovalsSet).not.toHaveBeenCalled();
    expect(call).not.toHaveBeenCalledWith("sessions.patch", expect.anything());
  });
});
