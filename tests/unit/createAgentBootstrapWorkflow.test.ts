import { describe, expect, it } from "vitest";

import { planCreateAgentBootstrapCommands } from "@/features/agents/operations/createAgentBootstrapWorkflow";

describe("createAgentBootstrapWorkflow", () => {
  it("plans unresolved-created-agent failure disposition", () => {
    const commands = planCreateAgentBootstrapCommands({
      completion: { agentId: "agent-1", agentName: "Agent One" },
      createdAgent: null,
      bootstrapErrorMessage: null,
      focusedAgentId: "focused-1",
    });

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

  it("plans bootstrap success disposition with draft flush before selection", () => {
    const commands = planCreateAgentBootstrapCommands({
      completion: { agentId: "agent-1", agentName: "Agent One" },
      createdAgent: { agentId: "agent-1", sessionKey: "session-1" },
      bootstrapErrorMessage: null,
      focusedAgentId: "focused-1",
    });

    const flushIndex = commands.findIndex((entry) => entry.kind === "flush-pending-draft");
    const selectIndex = commands.findIndex((entry) => entry.kind === "select-agent");

    expect(flushIndex).toBeGreaterThanOrEqual(0);
    expect(selectIndex).toBeGreaterThan(flushIndex);
    expect(commands).toContainEqual({ kind: "set-create-modal-error", message: null });
    expect(commands).toContainEqual({ kind: "flush-pending-draft", agentId: "focused-1" });
    expect(commands).toContainEqual({ kind: "select-agent", agentId: "agent-1" });
    expect(commands).toContainEqual({
      kind: "set-inspect-sidebar",
      agentId: "agent-1",
      tab: "capabilities",
    });
    expect(commands).toContainEqual({ kind: "set-mobile-pane", pane: "chat" });
    expect(commands).toContainEqual({ kind: "set-create-block", value: null });
    expect(commands).toContainEqual({ kind: "set-create-modal-open", open: false });
    expect(commands.find((entry) => entry.kind === "set-global-error")).toBeUndefined();
  });

  it("plans bootstrap failure disposition without blocking selection flow", () => {
    const commands = planCreateAgentBootstrapCommands({
      completion: { agentId: "agent-1", agentName: "Agent One" },
      createdAgent: { agentId: "agent-1", sessionKey: "session-1" },
      bootstrapErrorMessage: "permissions exploded",
      focusedAgentId: "focused-1",
    });

    const flushIndex = commands.findIndex((entry) => entry.kind === "flush-pending-draft");
    const selectIndex = commands.findIndex((entry) => entry.kind === "select-agent");

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
    expect(commands).toContainEqual({
      kind: "set-inspect-sidebar",
      agentId: "agent-1",
      tab: "capabilities",
    });
    expect(commands).toContainEqual({ kind: "set-mobile-pane", pane: "chat" });
    expect(commands).toContainEqual({ kind: "set-create-block", value: null });
    expect(commands).toContainEqual({ kind: "set-create-modal-open", open: false });
  });
});
