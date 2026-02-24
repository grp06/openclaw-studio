import { describe, expect, it, vi } from "vitest";
import {
  buildConfigMutationFailureMessage,
  buildMutationSideEffectCommands,
  buildQueuedMutationBlock,
  resolveConfigMutationPostRunEffects,
  resolveConfigMutationStatusLine,
  resolveMutationStartGuard,
  runConfigMutationWorkflow,
} from "@/features/agents/operations/mutationLifecycleWorkflow";
import { shouldStartNextConfigMutation } from "@/features/agents/operations/configMutationGatePolicy";

describe("mutationLifecycleWorkflow integration", () => {
  it("page create handler uses shared start guard and queued block shape", () => {
    const denied = resolveMutationStartGuard({
      status: "disconnected",
      hasCreateBlock: false,
      hasRenameBlock: false,
      hasDeleteBlock: false,
    });
    expect(denied).toEqual({ kind: "deny", reason: "not-connected" });

    const allowed = resolveMutationStartGuard({
      status: "connected",
      hasCreateBlock: false,
      hasRenameBlock: false,
      hasDeleteBlock: false,
    });
    expect(allowed).toEqual({ kind: "allow" });

    const queued = buildQueuedMutationBlock({
      kind: "create-agent",
      agentId: "",
      agentName: "Agent One",
      startedAt: 42,
    });
    expect(queued).toEqual({
      kind: "create-agent",
      agentId: "",
      agentName: "Agent One",
      phase: "queued",
      startedAt: 42,
      sawDisconnect: false,
    });
  });

  it("delete workflow maps awaiting-restart outcome to awaiting-restart block phase", async () => {
    const result = await runConfigMutationWorkflow(
      { kind: "delete-agent", isLocalGateway: false },
      {
        executeMutation: async () => undefined,
        shouldAwaitRemoteRestart: async () => true,
      }
    );

    const effects = resolveConfigMutationPostRunEffects(result);
    expect(effects).toEqual({
      shouldReloadAgents: false,
      shouldClearBlock: false,
      awaitingRestartPatch: {
        phase: "awaiting-restart",
        sawDisconnect: false,
      },
    });
  });

  it("rename workflow maps completed outcome to load-and-clear flow", async () => {
    const result = await runConfigMutationWorkflow(
      { kind: "rename-agent", isLocalGateway: false },
      {
        executeMutation: async () => undefined,
        shouldAwaitRemoteRestart: async () => false,
      }
    );

    const effects = resolveConfigMutationPostRunEffects(result);
    let didLoadAgents = false;
    let block: { phase: string; sawDisconnect: boolean } | null = {
      phase: "mutating",
      sawDisconnect: false,
    };
    if (effects.shouldReloadAgents) {
      didLoadAgents = true;
    }
    if (effects.shouldClearBlock) {
      block = null;
    }

    expect(didLoadAgents).toBe(true);
    expect(block).toBeNull();
    expect(effects.awaitingRestartPatch).toBeNull();
  });

  it("page rename and delete handlers share lifecycle guard plus post-run transitions", async () => {
    const blocked = resolveMutationStartGuard({
      status: "connected",
      hasCreateBlock: true,
      hasRenameBlock: false,
      hasDeleteBlock: false,
    });
    expect(blocked).toEqual({
      kind: "deny",
      reason: "create-block-active",
    });

    const allowed = resolveMutationStartGuard({
      status: "connected",
      hasCreateBlock: false,
      hasRenameBlock: false,
      hasDeleteBlock: false,
    });
    expect(allowed).toEqual({ kind: "allow" });

    const executeMutation = vi.fn(async () => undefined);

    const renameCompleted = await runConfigMutationWorkflow(
      {
        kind: "rename-agent",
        isLocalGateway: false,
      },
      {
        executeMutation,
        shouldAwaitRemoteRestart: async () => false,
      }
    );
    expect(buildMutationSideEffectCommands({ disposition: renameCompleted.disposition })).toEqual([
      { kind: "reload-agents" },
      { kind: "clear-mutation-block" },
      { kind: "set-mobile-pane", pane: "chat" },
    ]);

    const deleteAwaitingRestart = await runConfigMutationWorkflow(
      {
        kind: "delete-agent",
        isLocalGateway: false,
      },
      {
        executeMutation,
        shouldAwaitRemoteRestart: async () => true,
      }
    );
    expect(buildMutationSideEffectCommands({ disposition: deleteAwaitingRestart.disposition })).toEqual(
      [{ kind: "patch-mutation-block", patch: { phase: "awaiting-restart", sawDisconnect: false } }]
    );
    expect(executeMutation).toHaveBeenCalledTimes(2);
  });

  it("uses typed mutation commands for lifecycle side effects instead of inline branching", async () => {
    const commandLog: string[] = [];
    const runCommands = async (
      disposition: "completed" | "awaiting-restart"
    ): Promise<{ phase: string; sawDisconnect: boolean } | null> => {
      let block: { phase: string; sawDisconnect: boolean } | null = {
        phase: "mutating",
        sawDisconnect: false,
      };
      for (const command of buildMutationSideEffectCommands({ disposition })) {
        if (command.kind === "reload-agents") {
          commandLog.push("reload");
          continue;
        }
        if (command.kind === "clear-mutation-block") {
          commandLog.push("clear");
          block = null;
          continue;
        }
        if (command.kind === "set-mobile-pane") {
          commandLog.push(`pane:${command.pane}`);
          continue;
        }
        commandLog.push(`patch:${command.patch.phase}`);
        block = {
          phase: command.patch.phase,
          sawDisconnect: command.patch.sawDisconnect,
        };
      }
      return block;
    };

    const completedBlock = await runCommands("completed");
    const awaitingBlock = await runCommands("awaiting-restart");

    expect(completedBlock).toBeNull();
    expect(awaitingBlock).toEqual({
      phase: "awaiting-restart",
      sawDisconnect: false,
    });
    expect(commandLog).toEqual(["reload", "clear", "pane:chat", "patch:awaiting-restart"]);
  });

  it("workflow errors clear block and set page error message", async () => {
    let block: { phase: string; sawDisconnect: boolean } | null = {
      phase: "mutating",
      sawDisconnect: false,
    };
    let errorMessage: string | null = null;

    try {
      await runConfigMutationWorkflow(
        { kind: "rename-agent", isLocalGateway: false },
        {
          executeMutation: async () => {
            throw new Error("rename exploded");
          },
          shouldAwaitRemoteRestart: async () => false,
        }
      );
    } catch (error) {
      block = null;
      errorMessage = buildConfigMutationFailureMessage({
        kind: "rename-agent",
        error,
      });
    }

    expect(block).toBeNull();
    expect(errorMessage).toBe("rename exploded");
  });

  it("preserves queue gating when restart block is active", () => {
    expect(
      shouldStartNextConfigMutation({
        status: "connected",
        hasRunningAgents: false,
        nextMutationRequiresIdleAgents: false,
        hasActiveMutation: false,
        hasRestartBlockInProgress: true,
        queuedCount: 1,
      })
    ).toBe(false);

    expect(
      shouldStartNextConfigMutation({
        status: "connected",
        hasRunningAgents: false,
        nextMutationRequiresIdleAgents: false,
        hasActiveMutation: false,
        hasRestartBlockInProgress: false,
        queuedCount: 1,
      })
    ).toBe(true);
  });

  it("preserves lock-status text behavior across queued, mutating, and awaiting-restart phases", () => {
    expect(
      resolveConfigMutationStatusLine({
        block: { phase: "queued", sawDisconnect: false },
        status: "connected",
      })
    ).toBe("Waiting for active runs to finish");

    expect(
      resolveConfigMutationStatusLine({
        block: { phase: "mutating", sawDisconnect: false },
        status: "connected",
      })
    ).toBe("Submitting config change");

    expect(
      resolveConfigMutationStatusLine({
        block: { phase: "awaiting-restart", sawDisconnect: false },
        status: "connected",
      })
    ).toBe("Waiting for gateway to restart");

    expect(
      resolveConfigMutationStatusLine({
        block: { phase: "awaiting-restart", sawDisconnect: true },
        status: "disconnected",
      })
    ).toBe("Gateway restart in progress");

    expect(
      resolveConfigMutationStatusLine({
        block: { phase: "awaiting-restart", sawDisconnect: true },
        status: "connected",
      })
    ).toBe("Gateway is back online, syncing agents");
  });
});
