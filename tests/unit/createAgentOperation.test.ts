import { describe, expect, it, vi } from "vitest";
import type { GatewayClient } from "@/lib/gateway/GatewayClient";
import {
  compileGuidedAgentCreation,
  createDefaultGuidedDraft,
  resolveGuidedDraftFromPresetBundle,
} from "@/features/agents/creation/compiler";
import type { AgentPresetBundle } from "@/features/agents/creation/types";
import {
  applyGuidedAgentSetup,
  createAgentWithOptionalSetup,
  type AgentGuidedSetup,
} from "@/features/agents/operations/createAgentOperation";

const createSetup = (): AgentGuidedSetup => ({
  agentOverrides: {
    sandbox: { mode: "non-main", workspaceAccess: "ro" },
    tools: { profile: "coding", alsoAllow: ["group:runtime"], deny: ["group:web"] },
  },
  files: {
    "AGENTS.md": "# Mission",
    "SOUL.md": "# Tone",
  },
  execApprovals: {
    security: "allowlist",
    ask: "always",
    allowlist: [{ pattern: "/usr/bin/git" }],
  },
});

const createSetupFromBundle = (bundle: AgentPresetBundle): AgentGuidedSetup => {
  const draft = resolveGuidedDraftFromPresetBundle({
    bundle,
    seed: createDefaultGuidedDraft(),
  });
  const compiled = compileGuidedAgentCreation({
    name: "Bundle Agent",
    draft,
  });
  expect(compiled.validation.errors).toEqual([]);
  return {
    agentOverrides: compiled.agentOverrides,
    files: compiled.files,
    execApprovals: compiled.execApprovals,
  };
};

describe("createAgentOperation", () => {
  it("applies guided setup for local gateway creation", async () => {
    const setup = createSetup();
    const client = {
      call: vi.fn(async (method: string, params?: unknown) => {
        if (method === "config.get") {
          return {
            exists: true,
            hash: "cfg-1",
            path: "/Users/test/.openclaw/openclaw.json",
            config: { agents: { list: [] } },
          };
        }
        if (method === "agents.create") {
          return { ok: true, agentId: "agent-1", name: "Agent 1" };
        }
        if (method === "config.patch") {
          const raw = (params as { raw: string }).raw;
          const parsed = JSON.parse(raw) as {
            agents?: { list?: Array<{ id: string; sandbox?: unknown; tools?: unknown }> };
          };
          const entry = parsed.agents?.list?.find((item) => item.id === "agent-1");
          expect(entry?.sandbox).toEqual({ mode: "non-main", workspaceAccess: "ro" });
          expect(entry?.tools).toEqual({
            profile: "coding",
            alsoAllow: ["group:runtime"],
            deny: ["group:web"],
          });
          return { ok: true };
        }
        if (method === "agents.files.set") {
          return { ok: true };
        }
        if (method === "exec.approvals.get") {
          return {
            exists: true,
            hash: "ap-1",
            file: {
              version: 1,
              agents: {},
            },
          };
        }
        if (method === "exec.approvals.set") {
          const payload = params as {
            file?: {
              agents?: Record<string, { security?: string; ask?: string; allowlist?: Array<{ pattern: string }> }>;
            };
          };
          expect(payload.file?.agents?.["agent-1"]).toEqual({
            security: "allowlist",
            ask: "always",
            allowlist: [{ pattern: "/usr/bin/git" }],
          });
          return { ok: true };
        }
        throw new Error(`unexpected method ${method}`);
      }),
    } as unknown as GatewayClient;

    const result = await createAgentWithOptionalSetup({
      client,
      name: "Agent 1",
      setup,
      isLocalGateway: true,
    });

    expect(result).toEqual({
      agentId: "agent-1",
      setupApplied: true,
      awaitingRestart: false,
    });
  });

  it("defers setup for remote gateways", async () => {
    const setup = createSetup();
    const client = {
      call: vi.fn(async (method: string) => {
        if (method === "config.get") {
          return {
            exists: true,
            hash: "cfg-1",
            path: "/Users/test/.openclaw/openclaw.json",
            config: { agents: { list: [] } },
          };
        }
        if (method === "agents.create") {
          return { ok: true, agentId: "agent-2", name: "Agent 2" };
        }
        throw new Error(`unexpected method ${method}`);
      }),
    } as unknown as GatewayClient;

    const result = await createAgentWithOptionalSetup({
      client,
      name: "Agent 2",
      setup,
      isLocalGateway: false,
    });

    expect(result).toEqual({
      agentId: "agent-2",
      setupApplied: false,
      awaitingRestart: true,
    });
  });

  it("applies setup directly when requested", async () => {
    const setup = createSetup();
    const calls: string[] = [];
    const client = {
      call: vi.fn(async (method: string) => {
        calls.push(method);
        if (method === "config.get") {
          return {
            exists: true,
            hash: "cfg-2",
            config: { agents: { list: [{ id: "agent-3" }] } },
          };
        }
        if (method === "config.patch") return { ok: true };
        if (method === "agents.files.set") return { ok: true };
        if (method === "exec.approvals.get") {
          return { exists: true, hash: "ap-2", file: { version: 1, agents: {} } };
        }
        if (method === "exec.approvals.set") return { ok: true };
        throw new Error(`unexpected method ${method}`);
      }),
    } as unknown as GatewayClient;

    await expect(
      applyGuidedAgentSetup({
        client,
        agentId: "agent-3",
        setup,
      })
    ).resolves.toBeUndefined();

    const lastFilesSet = Math.max(
      calls.lastIndexOf("agents.files.set"),
      calls.lastIndexOf("exec.approvals.set")
    );
    expect(lastFilesSet).toBeGreaterThanOrEqual(0);
    expect(calls.lastIndexOf("config.patch")).toBeGreaterThan(lastFilesSet);
  });

  it("skips agent override config.patch when includeAgentOverrides is false", async () => {
    const setup = createSetup();
    const calls: string[] = [];
    const client = {
      call: vi.fn(async (method: string) => {
        calls.push(method);
        if (method === "agents.files.set") return { ok: true };
        if (method === "exec.approvals.get") {
          return { exists: true, hash: "ap-3", file: { version: 1, agents: {} } };
        }
        if (method === "exec.approvals.set") return { ok: true };
        if (method === "config.get" || method === "config.patch") {
          throw new Error(`unexpected method ${method}`);
        }
        throw new Error(`unexpected method ${method}`);
      }),
    } as unknown as GatewayClient;

    await expect(
      applyGuidedAgentSetup({
        client,
        agentId: "agent-no-overrides",
        setup,
        includeAgentOverrides: false,
      })
    ).resolves.toBeUndefined();

    expect(calls).not.toContain("config.get");
    expect(calls).not.toContain("config.patch");
  });

  it("applies setup compiled from PR Engineer bundle without creating a new agent", async () => {
    const setup = createSetupFromBundle("pr-engineer");
    const calls: string[] = [];
    const client = {
      call: vi.fn(async (method: string) => {
        calls.push(method);
        if (method === "config.get") {
          return {
            exists: true,
            hash: "cfg-bundle-1",
            config: { agents: { list: [{ id: "agent-bundle" }] } },
          };
        }
        if (method === "config.patch") return { ok: true };
        if (method === "agents.files.set") return { ok: true };
        if (method === "exec.approvals.get") {
          return { exists: true, hash: "ap-bundle-1", file: { version: 1, agents: {} } };
        }
        if (method === "exec.approvals.set") return { ok: true };
        throw new Error(`unexpected method ${method}`);
      }),
    } as unknown as GatewayClient;

    await applyGuidedAgentSetup({
      client,
      agentId: "agent-bundle",
      setup,
    });

    expect(calls).not.toContain("agents.create");
    expect(calls).toContain("config.patch");
  });
});
