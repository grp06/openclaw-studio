import { describe, expect, it, vi } from "vitest";
import type { AgentGuidedSetup } from "@/features/agents/operations/createAgentOperation";
import { runGuidedCreateWorkflow } from "@/features/agents/operations/guidedCreateWorkflow";

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

describe("guidedCreateWorkflow", () => {
  it("returns applied outcome for local gateway when setup succeeds", async () => {
    const setup = createSetup();
    const createAgent = vi.fn(async () => ({ id: "agent-1" }));
    const applySetup = vi.fn(async () => undefined);
    const upsertPending = vi.fn();
    const removePending = vi.fn();

    const result = await runGuidedCreateWorkflow(
      {
        name: "Agent One",
        setup,
        isLocalGateway: true,
      },
      {
        createAgent,
        applySetup,
        upsertPending,
        removePending,
      }
    );

    expect(result).toEqual({
      agentId: "agent-1",
      setupStatus: "applied",
      setupErrorMessage: null,
    });
    expect(upsertPending).not.toHaveBeenCalled();
    expect(removePending).toHaveBeenCalledWith("agent-1");
  });

  it("returns pending outcome for local gateway when setup fails", async () => {
    const setup = createSetup();
    const createAgent = vi.fn(async () => ({ id: "agent-2" }));
    const applySetup = vi.fn(async () => {
      throw new Error("setup failed");
    });
    const upsertPending = vi.fn();
    const removePending = vi.fn();

    const result = await runGuidedCreateWorkflow(
      {
        name: "Agent Two",
        setup,
        isLocalGateway: true,
      },
      {
        createAgent,
        applySetup,
        upsertPending,
        removePending,
      }
    );

    expect(result).toEqual({
      agentId: "agent-2",
      setupStatus: "pending",
      setupErrorMessage: "setup failed",
    });
    expect(upsertPending).toHaveBeenCalledWith("agent-2", setup);
    expect(removePending).not.toHaveBeenCalled();
  });

  it("returns pending outcome for remote gateway and keeps created agent id", async () => {
    const setup = createSetup();
    const createAgent = vi.fn(async () => ({ id: "agent-3" }));
    const applySetup = vi.fn(async () => {
      throw new Error("network error");
    });
    const upsertPending = vi.fn();
    const removePending = vi.fn();

    const result = await runGuidedCreateWorkflow(
      {
        name: "Agent Three",
        setup,
        isLocalGateway: false,
      },
      {
        createAgent,
        applySetup,
        upsertPending,
        removePending,
      }
    );

    expect(result).toEqual({
      agentId: "agent-3",
      setupStatus: "pending",
      setupErrorMessage: "network error",
    });
    expect(upsertPending).toHaveBeenCalledWith("agent-3", setup);
    expect(removePending).not.toHaveBeenCalled();
  });

  it("rejects empty agent name before any side effect", async () => {
    const setup = createSetup();
    const createAgent = vi.fn(async () => ({ id: "agent-x" }));
    const applySetup = vi.fn(async () => undefined);
    const upsertPending = vi.fn();
    const removePending = vi.fn();

    await expect(
      runGuidedCreateWorkflow(
        {
          name: "   ",
          setup,
          isLocalGateway: true,
        },
        {
          createAgent,
          applySetup,
          upsertPending,
          removePending,
        }
      )
    ).rejects.toThrow("Agent name is required.");

    expect(createAgent).not.toHaveBeenCalled();
    expect(applySetup).not.toHaveBeenCalled();
    expect(upsertPending).not.toHaveBeenCalled();
    expect(removePending).not.toHaveBeenCalled();
  });
});
