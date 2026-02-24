import { createElement, useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, waitFor } from "@testing-library/react";

import type { AgentPermissionsDraft } from "@/features/agents/operations/agentPermissionsOperation";
import type { CronCreateDraft } from "@/lib/cron/createPayloadBuilder";
import type { CronRunResult } from "@/lib/cron/types";
import type { MutationBlockState } from "@/features/agents/operations/mutationLifecycleWorkflow";

import { useAgentSettingsMutationController } from "@/features/agents/operations/useAgentSettingsMutationController";
import { deleteAgentViaStudio } from "@/features/agents/operations/deleteAgentOperation";
import { performCronCreateFlow } from "@/features/agents/operations/cronCreateOperation";
import { updateAgentPermissionsViaStudio } from "@/features/agents/operations/agentPermissionsOperation";
import { runAgentConfigMutationLifecycle } from "@/features/agents/operations/mutationLifecycleWorkflow";
import { runCronJobNow, removeCronJob } from "@/lib/cron/types";
import { shouldAwaitDisconnectRestartForRemoteMutation } from "@/lib/gateway/gatewayReloadMode";

let restartBlockHookParams:
  | {
      block: MutationBlockState | null;
      onTimeout: () => void;
      onRestartComplete: (
        block: MutationBlockState,
        ctx: { isCancelled: () => boolean }
      ) => void | Promise<void>;
    }
  | null = null;

vi.mock("@/features/agents/operations/useGatewayRestartBlock", () => ({
  useGatewayRestartBlock: (params: {
    block: MutationBlockState | null;
    onTimeout: () => void;
    onRestartComplete: (
      block: MutationBlockState,
      ctx: { isCancelled: () => boolean }
    ) => void | Promise<void>;
  }) => {
    restartBlockHookParams = {
      block: params.block,
      onTimeout: params.onTimeout,
      onRestartComplete: params.onRestartComplete,
    };
  },
}));

vi.mock("@/features/agents/operations/deleteAgentOperation", () => ({
  deleteAgentViaStudio: vi.fn(),
}));

vi.mock("@/features/agents/operations/cronCreateOperation", () => ({
  performCronCreateFlow: vi.fn(),
}));

vi.mock("@/features/agents/operations/agentPermissionsOperation", async () => {
  const actual = await vi.importActual<
    typeof import("@/features/agents/operations/agentPermissionsOperation")
  >("@/features/agents/operations/agentPermissionsOperation");
  return {
    ...actual,
    updateAgentPermissionsViaStudio: vi.fn(),
  };
});

vi.mock("@/features/agents/operations/mutationLifecycleWorkflow", async () => {
  const actual = await vi.importActual<
    typeof import("@/features/agents/operations/mutationLifecycleWorkflow")
  >("@/features/agents/operations/mutationLifecycleWorkflow");
  return {
    ...actual,
    runAgentConfigMutationLifecycle: vi.fn(),
  };
});

vi.mock("@/lib/cron/types", async () => {
  const actual = await vi.importActual<typeof import("@/lib/cron/types")>("@/lib/cron/types");
  return {
    ...actual,
    runCronJobNow: vi.fn(),
    removeCronJob: vi.fn(),
    listCronJobs: vi.fn(async () => ({ jobs: [] })),
  };
});

vi.mock("@/lib/gateway/gatewayReloadMode", () => ({
  shouldAwaitDisconnectRestartForRemoteMutation: vi.fn(async () => false),
}));

type ControllerValue = ReturnType<typeof useAgentSettingsMutationController>;

const draft: AgentPermissionsDraft = {
  commandMode: "ask",
  webAccess: true,
  fileTools: false,
};

const createCronDraft = (): CronCreateDraft => ({
  templateId: "custom",
  name: "Nightly sync",
  taskText: "Sync project status.",
  scheduleKind: "every",
  everyAmount: 30,
  everyUnit: "minutes",
  deliveryMode: "announce",
  deliveryChannel: "last",
});

const renderController = (overrides?: Partial<Parameters<typeof useAgentSettingsMutationController>[0]>) => {
  const setError = vi.fn();
  const clearInspectSidebar = vi.fn();
  const setInspectSidebarCapabilities = vi.fn();
  const dispatchUpdateAgent = vi.fn();
  const setMobilePaneChat = vi.fn();
  const loadAgents = vi.fn(async () => undefined);
  const refreshGatewayConfigSnapshot = vi.fn(async () => null);
  const enqueueConfigMutation = vi.fn(async ({ run }: { run: () => Promise<void> }) => {
    await run();
  });
  const client = {
    call: vi.fn(async () => ({})),
  };

  const params: Parameters<typeof useAgentSettingsMutationController>[0] = {
    client: client as never,
    status: "connected",
    isLocalGateway: false,
    agents: [{ agentId: "agent-1", name: "Agent One", sessionKey: "session-1" }] as never,
    hasCreateBlock: false,
    enqueueConfigMutation,
    gatewayConfigSnapshot: null,
    settingsRouteActive: false,
    inspectSidebarAgentId: null,
    inspectSidebarTab: null,
    loadAgents,
    refreshGatewayConfigSnapshot,
    clearInspectSidebar,
    setInspectSidebarCapabilities,
    dispatchUpdateAgent,
    setMobilePaneChat,
    setError,
    ...(overrides ?? {}),
  };

  const valueRef: { current: ControllerValue | null } = { current: null };
  const Probe = ({ onValue }: { onValue: (next: ControllerValue) => void }) => {
    const value = useAgentSettingsMutationController(params);
    useEffect(() => {
      onValue(value);
    }, [onValue, value]);
    return createElement("div", { "data-testid": "probe" }, "ok");
  };

  render(
    createElement(Probe, {
      onValue: (next) => {
        valueRef.current = next;
      },
    })
  );

  return {
    getValue: () => {
      if (!valueRef.current) throw new Error("hook value unavailable");
      return valueRef.current;
    },
    setError,
    clearInspectSidebar,
    setInspectSidebarCapabilities,
    dispatchUpdateAgent,
    setMobilePaneChat,
    loadAgents,
    refreshGatewayConfigSnapshot,
    enqueueConfigMutation,
  };
};

describe("useAgentSettingsMutationController", () => {
  const mockedDeleteAgentViaStudio = vi.mocked(deleteAgentViaStudio);
  const mockedPerformCronCreateFlow = vi.mocked(performCronCreateFlow);
  const mockedRunCronJobNow = vi.mocked(runCronJobNow);
  const mockedRemoveCronJob = vi.mocked(removeCronJob);
  const mockedRunLifecycle = vi.mocked(runAgentConfigMutationLifecycle);
  const mockedUpdateAgentPermissions = vi.mocked(updateAgentPermissionsViaStudio);
  const mockedShouldAwaitRemoteRestart = vi.mocked(shouldAwaitDisconnectRestartForRemoteMutation);

  beforeEach(() => {
    restartBlockHookParams = null;
    mockedDeleteAgentViaStudio.mockReset();
    mockedPerformCronCreateFlow.mockReset();
    mockedRunCronJobNow.mockReset();
    mockedRemoveCronJob.mockReset();
    mockedRunLifecycle.mockReset();
    mockedUpdateAgentPermissions.mockReset();
    mockedShouldAwaitRemoteRestart.mockReset();
    mockedShouldAwaitRemoteRestart.mockResolvedValue(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("delete_denied_by_guard_does_not_run_delete_side_effect", async () => {
    const ctx = renderController({ status: "disconnected" });

    await act(async () => {
      await ctx.getValue().handleDeleteAgent("agent-1");
    });

    expect(ctx.enqueueConfigMutation).not.toHaveBeenCalled();
    expect(mockedDeleteAgentViaStudio).not.toHaveBeenCalled();
  });

  it("delete_cancelled_by_confirmation_does_not_run_delete_side_effect", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const ctx = renderController();

    await act(async () => {
      await ctx.getValue().handleDeleteAgent("agent-1");
    });

    expect(mockedDeleteAgentViaStudio).not.toHaveBeenCalled();
    expect(ctx.enqueueConfigMutation).not.toHaveBeenCalled();
  });

  it("reserved_main_delete_sets_error_and_skips_enqueue", async () => {
    const ctx = renderController({
      agents: [{ agentId: "main", name: "Main", sessionKey: "main-session" }] as never,
    });

    await act(async () => {
      await ctx.getValue().handleDeleteAgent("main");
    });

    expect(ctx.setError).toHaveBeenCalledWith("The main agent cannot be deleted.");
    expect(ctx.enqueueConfigMutation).not.toHaveBeenCalled();
    expect(mockedDeleteAgentViaStudio).not.toHaveBeenCalled();
  });

  it("cron_delete_is_denied_while_run_busy_without_changing_error_state", async () => {
    mockedRunCronJobNow.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      return { ok: true, ran: true } satisfies CronRunResult;
    });
    const ctx = renderController();

    await act(async () => {
      void ctx.getValue().handleRunCronJob("agent-1", "job-running");
    });
    await waitFor(() => {
      expect(ctx.getValue().cronRunBusyJobId).toBe("job-running");
    });

    await act(async () => {
      await ctx.getValue().handleDeleteCronJob("agent-1", "job-delete");
    });

    expect(mockedRemoveCronJob).not.toHaveBeenCalled();
    expect(ctx.getValue().settingsCronError).toBeNull();
  });

  it("allowed_rename_and_delete_delegate_to_lifecycle_runner", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    mockedRunLifecycle.mockImplementation(async ({ deps }) => {
      deps.setQueuedBlock();
      deps.setMutatingBlock();
      await deps.executeMutation();
      deps.clearBlock();
      return true;
    });
    mockedDeleteAgentViaStudio.mockResolvedValue({ trashed: { trashDir: "", moved: [] }, restored: null });

    const ctx = renderController();

    await act(async () => {
      await ctx.getValue().handleRenameAgent("agent-1", "Renamed");
    });
    await act(async () => {
      await ctx.getValue().handleDeleteAgent("agent-1");
    });

    expect(mockedRunLifecycle).toHaveBeenCalledTimes(2);
    expect(mockedDeleteAgentViaStudio).toHaveBeenCalledTimes(1);
  });

  it("permissions_update_keeps_load_refresh_and_focus_side_effects", async () => {
    mockedUpdateAgentPermissions.mockResolvedValue(undefined);
    const callOrder: string[] = [];
    const ctx = renderController({
      loadAgents: vi.fn(async () => {
        callOrder.push("loadAgents");
      }),
      refreshGatewayConfigSnapshot: vi.fn(async () => {
        callOrder.push("refresh");
        return null;
      }),
    });

    await act(async () => {
      await ctx.getValue().handleUpdateAgentPermissions("agent-1", draft);
    });

    expect(mockedUpdateAgentPermissions).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: "agent-1",
        sessionKey: "session-1",
        draft,
      })
    );
    expect(callOrder).toEqual(["loadAgents", "refresh"]);
    expect(ctx.setInspectSidebarCapabilities).toHaveBeenCalledWith("agent-1");
    expect(ctx.setMobilePaneChat).toHaveBeenCalled();
  });

  it("exposes_restart_block_state_and_timeout_completion_handlers", async () => {
    mockedRunLifecycle.mockImplementation(async ({ deps }) => {
      deps.setQueuedBlock();
      deps.patchBlockAwaitingRestart({ phase: "awaiting-restart", sawDisconnect: false });
      return true;
    });
    const ctx = renderController();

    await act(async () => {
      await ctx.getValue().handleRenameAgent("agent-1", "Renamed");
    });
    await waitFor(() => {
      expect(ctx.getValue().hasRenameMutationBlock).toBe(true);
      expect(ctx.getValue().restartingMutationBlock?.phase).toBe("awaiting-restart");
      expect(ctx.getValue().hasRestartBlockInProgress).toBe(true);
    });

    expect(restartBlockHookParams?.block).not.toBeNull();

    await act(async () => {
      restartBlockHookParams?.onTimeout();
    });
    expect(ctx.setError).toHaveBeenCalledWith("Gateway restart timed out after renaming the agent.");

    mockedRunLifecycle.mockImplementation(async ({ deps }) => {
      deps.setQueuedBlock();
      deps.patchBlockAwaitingRestart({ phase: "awaiting-restart", sawDisconnect: false });
      return true;
    });
    await act(async () => {
      await ctx.getValue().handleRenameAgent("agent-1", "Renamed Again");
    });
    await waitFor(() => {
      expect(restartBlockHookParams?.block?.phase).toBe("awaiting-restart");
    });

    await act(async () => {
      await restartBlockHookParams?.onRestartComplete(
        restartBlockHookParams.block as MutationBlockState,
        { isCancelled: () => false }
      );
    });
    expect(ctx.loadAgents).toHaveBeenCalled();
    expect(ctx.setMobilePaneChat).toHaveBeenCalled();
    await waitFor(() => {
      expect(ctx.getValue().restartingMutationBlock).toBeNull();
    });
  });

  it("create_cron_handler_delegates_to_create_operation", async () => {
    mockedPerformCronCreateFlow.mockResolvedValue("created");
    const ctx = renderController();

    await act(async () => {
      await ctx.getValue().handleCreateCronJob("agent-1", createCronDraft());
    });

    expect(mockedPerformCronCreateFlow).toHaveBeenCalledTimes(1);
  });
});
