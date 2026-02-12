import { describe, expect, it, vi } from "vitest";
import type { GatewayClient } from "@/lib/gateway/GatewayClient";
import type { AgentGuidedSetup } from "@/features/agents/operations/createAgentOperation";
import { applyPendingGuidedSetupForAgent, upsertPendingGuidedSetup } from "@/features/agents/creation/recovery";
import {
  loadPendingGuidedSetupsFromStorage,
  persistPendingGuidedSetupsToStorage,
} from "@/features/agents/creation/pendingSetupStore";

class MemoryStorage implements Storage {
  private readonly map = new Map<string, string>();

  get length() {
    return this.map.size;
  }

  clear(): void {
    this.map.clear();
  }

  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }

  key(index: number): string | null {
    return Array.from(this.map.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.map.delete(key);
  }

  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
}

const createSetup = (): AgentGuidedSetup => ({
  agentOverrides: {
    sandbox: { mode: "non-main", workspaceAccess: "ro" },
    tools: { profile: "coding", alsoAllow: ["group:runtime"], deny: ["group:web"] },
  },
  files: {
    "AGENTS.md": "# Mission",
  },
  execApprovals: {
    security: "allowlist",
    ask: "always",
    allowlist: [{ pattern: "/usr/bin/git" }],
  },
});

describe("guided setup recovery", () => {
  it("queues recoverable pending setup when local setup fails after create", () => {
    const setup = createSetup();
    const pending = upsertPendingGuidedSetup({}, "agent-created", setup);
    expect(pending).toEqual({ "agent-created": setup });
  });

  it("recovers pending setups from session storage after reload", () => {
    const storage = new MemoryStorage();
    const setup = createSetup();
    persistPendingGuidedSetupsToStorage({
      storage,
      setupsByAgentId: { "agent-remote": setup },
      nowMs: 1_000,
    });

    const loaded = loadPendingGuidedSetupsFromStorage({
      storage,
      nowMs: 2_000,
    });

    expect(loaded).toEqual({ "agent-remote": setup });
  });

  it("retries setup against existing agent id without creating a new agent", async () => {
    const setup = createSetup();
    const callLog: string[] = [];
    const client = {
      call: vi.fn(async (method: string) => {
        callLog.push(method);
        if (method === "config.get") {
          return {
            exists: true,
            hash: "cfg-1",
            config: { agents: { list: [{ id: "agent-1" }] } },
          };
        }
        if (method === "config.patch") return { ok: true };
        if (method === "agents.files.set") return { ok: true };
        if (method === "exec.approvals.get") {
          return {
            exists: true,
            hash: "ap-1",
            file: { version: 1, agents: {} },
          };
        }
        if (method === "exec.approvals.set") return { ok: true };
        throw new Error(`unexpected method ${method}`);
      }),
    } as unknown as GatewayClient;

    const result = await applyPendingGuidedSetupForAgent({
      client,
      agentId: "agent-1",
      pendingSetupsByAgentId: { "agent-1": setup },
    });

    expect(result.applied).toBe(true);
    expect(result.pendingSetupsByAgentId).toEqual({});
    expect(callLog).not.toContain("agents.create");
  });

  it("removes only the applied pending setup entry on success", async () => {
    const setup = createSetup();
    const otherSetup = createSetup();
    const client = {
      call: vi.fn(async (method: string) => {
        if (method === "config.get") {
          return {
            exists: true,
            hash: "cfg-2",
            config: { agents: { list: [{ id: "agent-1" }, { id: "agent-2" }] } },
          };
        }
        if (method === "config.patch") return { ok: true };
        if (method === "agents.files.set") return { ok: true };
        if (method === "exec.approvals.get") {
          return {
            exists: true,
            hash: "ap-2",
            file: { version: 1, agents: {} },
          };
        }
        if (method === "exec.approvals.set") return { ok: true };
        throw new Error(`unexpected method ${method}`);
      }),
    } as unknown as GatewayClient;

    const result = await applyPendingGuidedSetupForAgent({
      client,
      agentId: "agent-1",
      pendingSetupsByAgentId: { "agent-1": setup, "agent-2": otherSetup },
    });

    expect(result.applied).toBe(true);
    expect(result.pendingSetupsByAgentId).toEqual({ "agent-2": otherSetup });
  });
});
