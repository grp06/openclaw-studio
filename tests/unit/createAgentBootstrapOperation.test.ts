import { describe, expect, it, vi } from "vitest";

import { runCreateAgentBootstrapOperation } from "@/features/agents/operations/createAgentBootstrapOperation";

describe("createAgentBootstrapOperation", () => {
  it("retries load and lookup once before unresolved-created-agent disposition", async () => {
    const loadAgents = vi.fn(async () => undefined);
    const findAgentById = vi.fn(() => null);
    const applyDefaultPermissions = vi.fn(async () => undefined);
    const refreshGatewayConfigSnapshot = vi.fn(async () => undefined);

    const commands = await runCreateAgentBootstrapOperation({
      completion: { agentId: "agent-1", agentName: "Agent One" },
      focusedAgentId: "focused-1",
      loadAgents,
      findAgentById,
      applyDefaultPermissions,
      refreshGatewayConfigSnapshot,
    });

    expect(loadAgents).toHaveBeenCalledTimes(2);
    expect(findAgentById).toHaveBeenCalledTimes(2);
    expect(findAgentById).toHaveBeenNthCalledWith(1, "agent-1");
    expect(findAgentById).toHaveBeenNthCalledWith(2, "agent-1");
    expect(applyDefaultPermissions).not.toHaveBeenCalled();
    expect(refreshGatewayConfigSnapshot).not.toHaveBeenCalled();
    expect(commands).toEqual([
      {
        kind: "set-create-modal-error",
        message: 'Agent "Agent One" was created, but Studio could not load it yet.',
      },
      {
        kind: "set-global-error",
        message: 'Agent "Agent One" was created, but Studio could not load it yet.',
      },
      { kind: "set-create-block", value: null },
      { kind: "set-create-modal-open", open: false },
    ]);
  });

  it("runs bootstrap success flow and refreshes gateway config snapshot", async () => {
    const loadAgents = vi.fn(async () => undefined);
    const findAgentById = vi.fn(() => ({ agentId: "agent-1", sessionKey: "session-1" }));
    const applyDefaultPermissions = vi.fn(async () => undefined);
    const refreshGatewayConfigSnapshot = vi.fn(async () => undefined);

    const commands = await runCreateAgentBootstrapOperation({
      completion: { agentId: "agent-1", agentName: "Agent One" },
      focusedAgentId: "focused-1",
      loadAgents,
      findAgentById,
      applyDefaultPermissions,
      refreshGatewayConfigSnapshot,
    });

    const flushIndex = commands.findIndex((entry) => entry.kind === "flush-pending-draft");
    const selectIndex = commands.findIndex((entry) => entry.kind === "select-agent");

    expect(loadAgents).toHaveBeenCalledTimes(1);
    expect(findAgentById).toHaveBeenCalledTimes(1);
    expect(applyDefaultPermissions).toHaveBeenCalledWith({
      agentId: "agent-1",
      sessionKey: "session-1",
    });
    expect(refreshGatewayConfigSnapshot).toHaveBeenCalledTimes(1);
    expect(flushIndex).toBeGreaterThanOrEqual(0);
    expect(selectIndex).toBeGreaterThan(flushIndex);
    expect(commands.find((entry) => entry.kind === "set-global-error")).toBeUndefined();
    expect(commands).toContainEqual({ kind: "set-create-modal-error", message: null });
  });

  it("keeps create success disposition when bootstrap fails and skips snapshot refresh", async () => {
    const loadAgents = vi.fn(async () => undefined);
    const findAgentById = vi.fn(() => ({ agentId: "agent-1", sessionKey: "session-1" }));
    const applyDefaultPermissions = vi.fn(async () => {
      throw new Error("permissions exploded");
    });
    const refreshGatewayConfigSnapshot = vi.fn(async () => undefined);

    const commands = await runCreateAgentBootstrapOperation({
      completion: { agentId: "agent-1", agentName: "Agent One" },
      focusedAgentId: "focused-1",
      loadAgents,
      findAgentById,
      applyDefaultPermissions,
      refreshGatewayConfigSnapshot,
    });

    const flushIndex = commands.findIndex((entry) => entry.kind === "flush-pending-draft");
    const selectIndex = commands.findIndex((entry) => entry.kind === "select-agent");

    expect(loadAgents).toHaveBeenCalledTimes(1);
    expect(findAgentById).toHaveBeenCalledTimes(1);
    expect(applyDefaultPermissions).toHaveBeenCalledTimes(1);
    expect(refreshGatewayConfigSnapshot).not.toHaveBeenCalled();
    expect(flushIndex).toBeGreaterThanOrEqual(0);
    expect(selectIndex).toBeGreaterThan(flushIndex);
    expect(commands).toContainEqual({
      kind: "set-global-error",
      message: "Agent created, but default permissions could not be applied: permissions exploded",
    });
    expect(commands).toContainEqual({
      kind: "set-create-modal-error",
      message: "Default permissions failed: permissions exploded",
    });
    expect(commands).toContainEqual({ kind: "select-agent", agentId: "agent-1" });
  });

  it("uses fallback bootstrap error message for non-Error throws", async () => {
    const commands = await runCreateAgentBootstrapOperation({
      completion: { agentId: "agent-1", agentName: "Agent One" },
      focusedAgentId: "focused-1",
      loadAgents: async () => undefined,
      findAgentById: () => ({ agentId: "agent-1", sessionKey: "session-1" }),
      applyDefaultPermissions: async () => {
        throw "boom";
      },
      refreshGatewayConfigSnapshot: async () => undefined,
    });

    expect(commands).toContainEqual({
      kind: "set-global-error",
      message: "Agent created, but default permissions could not be applied: Failed to apply default permissions.",
    });
    expect(commands).toContainEqual({
      kind: "set-create-modal-error",
      message: "Default permissions failed: Failed to apply default permissions.",
    });
  });
});
