import { useCallback, useEffect, useMemo, useState } from "react";

import type { AgentPermissionsDraft } from "@/features/agents/operations/agentPermissionsOperation";
import { updateAgentPermissionsViaStudio } from "@/features/agents/operations/agentPermissionsOperation";
import { performCronCreateFlow } from "@/features/agents/operations/cronCreateOperation";
import { deleteAgentViaStudio } from "@/features/agents/operations/deleteAgentOperation";
import {
  planAgentSettingsMutation,
  type AgentSettingsMutationContext,
} from "@/features/agents/operations/agentSettingsMutationWorkflow";
import {
  buildQueuedMutationBlock,
  runAgentConfigMutationLifecycle,
  type MutationBlockState,
  type MutationWorkflowKind,
} from "@/features/agents/operations/mutationLifecycleWorkflow";
import type { ConfigMutationKind } from "@/features/agents/operations/useConfigMutationQueue";
import { useGatewayRestartBlock } from "@/features/agents/operations/useGatewayRestartBlock";
import type { AgentState } from "@/features/agents/state/store";
import type { CronCreateDraft } from "@/lib/cron/createPayloadBuilder";
import {
  filterCronJobsForAgent,
  listCronJobs,
  removeCronJob,
  runCronJobNow,
  sortCronJobsByUpdatedAt,
  type CronJobSummary,
} from "@/lib/cron/types";
import type { GatewayClient, GatewayStatus } from "@/lib/gateway/GatewayClient";
import { isGatewayDisconnectLikeError } from "@/lib/gateway/GatewayClient";
import type { GatewayModelPolicySnapshot } from "@/lib/gateway/models";
import { renameGatewayAgent } from "@/lib/gateway/agentConfig";
import { fetchJson } from "@/lib/http";

export type RestartingMutationBlockState = MutationBlockState & { kind: MutationWorkflowKind };

type AgentForSettingsMutation = Pick<AgentState, "agentId" | "name" | "sessionKey">;

export type UseAgentSettingsMutationControllerParams = {
  client: GatewayClient;
  status: GatewayStatus;
  isLocalGateway: boolean;
  agents: AgentForSettingsMutation[];
  hasCreateBlock: boolean;
  enqueueConfigMutation: (params: {
    kind: ConfigMutationKind;
    label: string;
    run: () => Promise<void>;
    requiresIdleAgents?: boolean;
  }) => Promise<void>;
  gatewayConfigSnapshot: GatewayModelPolicySnapshot | null;
  settingsRouteActive: boolean;
  inspectSidebarAgentId: string | null;
  inspectSidebarTab: string | null;
  loadAgents: () => Promise<void>;
  refreshGatewayConfigSnapshot: () => Promise<GatewayModelPolicySnapshot | null>;
  clearInspectSidebar: () => void;
  setInspectSidebarCapabilities: (agentId: string) => void;
  dispatchUpdateAgent: (agentId: string, patch: Partial<AgentState>) => void;
  setMobilePaneChat: () => void;
  setError: (message: string) => void;
};

export function useAgentSettingsMutationController(params: UseAgentSettingsMutationControllerParams) {
  const [settingsCronJobs, setSettingsCronJobs] = useState<CronJobSummary[]>([]);
  const [settingsCronLoading, setSettingsCronLoading] = useState(false);
  const [settingsCronError, setSettingsCronError] = useState<string | null>(null);
  const [cronCreateBusy, setCronCreateBusy] = useState(false);
  const [cronRunBusyJobId, setCronRunBusyJobId] = useState<string | null>(null);
  const [cronDeleteBusyJobId, setCronDeleteBusyJobId] = useState<string | null>(null);
  const [restartingMutationBlock, setRestartingMutationBlock] =
    useState<RestartingMutationBlockState | null>(null);
  const REMOTE_MUTATION_EXEC_TIMEOUT_MS = 45_000;

  const hasRenameMutationBlock = restartingMutationBlock?.kind === "rename-agent";
  const hasDeleteMutationBlock = restartingMutationBlock?.kind === "delete-agent";
  const hasRestartBlockInProgress = Boolean(
    restartingMutationBlock && restartingMutationBlock.phase !== "queued"
  );

  const mutationContext: AgentSettingsMutationContext = useMemo(
    () => ({
      status: params.status,
      hasCreateBlock: params.hasCreateBlock,
      hasRenameBlock: hasRenameMutationBlock,
      hasDeleteBlock: hasDeleteMutationBlock,
      cronCreateBusy,
      cronRunBusyJobId,
      cronDeleteBusyJobId,
    }),
    [
      cronCreateBusy,
      cronDeleteBusyJobId,
      cronRunBusyJobId,
      hasDeleteMutationBlock,
      hasRenameMutationBlock,
      params.hasCreateBlock,
      params.status,
    ]
  );

  const loadCronJobsForSettingsAgent = useCallback(
    async (agentId: string) => {
      const resolvedAgentId = agentId.trim();
      if (!resolvedAgentId) {
        setSettingsCronJobs([]);
        setSettingsCronError("Failed to load schedules: missing agent id.");
        return;
      }
      setSettingsCronLoading(true);
      setSettingsCronError(null);
      try {
        const result = await listCronJobs(params.client, { includeDisabled: true });
        const filtered = filterCronJobsForAgent(result.jobs, resolvedAgentId);
        setSettingsCronJobs(sortCronJobsByUpdatedAt(filtered));
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to load schedules.";
        setSettingsCronJobs([]);
        setSettingsCronError(message);
        if (!isGatewayDisconnectLikeError(err)) {
          console.error(message);
        }
      } finally {
        setSettingsCronLoading(false);
      }
    },
    [params.client]
  );

  useEffect(() => {
    if (
      !params.settingsRouteActive ||
      !params.inspectSidebarAgentId ||
      params.status !== "connected" ||
      params.inspectSidebarTab !== "automations"
    ) {
      setSettingsCronJobs([]);
      setSettingsCronLoading(false);
      setSettingsCronError(null);
      setCronRunBusyJobId(null);
      setCronDeleteBusyJobId(null);
      return;
    }
    void loadCronJobsForSettingsAgent(params.inspectSidebarAgentId);
  }, [
    loadCronJobsForSettingsAgent,
    params.inspectSidebarAgentId,
    params.inspectSidebarTab,
    params.settingsRouteActive,
    params.status,
  ]);

  const runRestartingMutationLifecycle = useCallback(
    async (input: {
      kind: MutationWorkflowKind;
      agentId: string;
      agentName: string;
      label: string;
      executeMutation: () => Promise<void>;
    }) => {
      return await runAgentConfigMutationLifecycle({
        kind: input.kind,
        label: input.label,
        isLocalGateway: params.isLocalGateway,
        deps: {
          enqueueConfigMutation: params.enqueueConfigMutation,
          setQueuedBlock: () => {
            const queuedBlock = buildQueuedMutationBlock({
              kind: input.kind,
              agentId: input.agentId,
              agentName: input.agentName,
              startedAt: Date.now(),
            });
            setRestartingMutationBlock({
              kind: input.kind,
              agentId: queuedBlock.agentId,
              agentName: queuedBlock.agentName,
              phase: queuedBlock.phase,
              startedAt: queuedBlock.startedAt,
              sawDisconnect: queuedBlock.sawDisconnect,
            });
          },
          setMutatingBlock: () => {
            setRestartingMutationBlock((current) => {
              if (!current) return current;
              if (current.kind !== input.kind || current.agentId !== input.agentId) return current;
              return {
                ...current,
                phase: "mutating",
              };
            });
          },
          patchBlockAwaitingRestart: (patch) => {
            setRestartingMutationBlock((current) => {
              if (!current) return current;
              if (current.kind !== input.kind || current.agentId !== input.agentId) return current;
              return {
                ...current,
                ...patch,
              };
            });
          },
          clearBlock: () => {
            setRestartingMutationBlock((current) => {
              if (!current) return current;
              if (current.kind !== input.kind || current.agentId !== input.agentId) return current;
              return null;
            });
          },
          executeMutation: async () => {
            const timeoutLabel =
              input.kind === "delete-agent"
                ? "Delete agent request timed out."
                : "Rename agent request timed out.";
            await Promise.race([
              input.executeMutation(),
              new Promise<never>((_, reject) => {
                window.setTimeout(
                  () =>
                    reject(
                      new Error(
                        `${timeoutLabel} The gateway did not respond in time.`
                      )
                    ),
                  REMOTE_MUTATION_EXEC_TIMEOUT_MS
                );
              }),
            ]);
          },
          shouldAwaitRemoteRestart: async () => false,
          reloadAgents: params.loadAgents,
          setMobilePaneChat: params.setMobilePaneChat,
          onError: params.setError,
        },
      });
    },
    [
      params.enqueueConfigMutation,
      params.isLocalGateway,
      params.loadAgents,
      params.setError,
      params.setMobilePaneChat,
    ]
  );

  useGatewayRestartBlock({
    status: params.status,
    block: restartingMutationBlock,
    setBlock: setRestartingMutationBlock,
    maxWaitMs: 90_000,
    onTimeout: () => {
      const timeoutMessage =
        restartingMutationBlock?.kind === "delete-agent"
          ? "Gateway restart timed out after deleting the agent."
          : "Gateway restart timed out after renaming the agent.";
      setRestartingMutationBlock(null);
      params.setError(timeoutMessage);
    },
    onRestartComplete: async (_, ctx) => {
      await params.loadAgents();
      if (ctx.isCancelled()) return;
      setRestartingMutationBlock(null);
      params.setMobilePaneChat();
    },
  });

  useEffect(() => {
    if (!restartingMutationBlock) return;
    if (restartingMutationBlock.kind !== "delete-agent") return;
    if (restartingMutationBlock.phase !== "awaiting-restart") return;
    if (params.status !== "connected") return;

    const deletedAgentStillPresent = params.agents.some(
      (entry) => entry.agentId === restartingMutationBlock.agentId
    );
    if (!deletedAgentStillPresent) {
      setRestartingMutationBlock(null);
      params.setMobilePaneChat();
      return;
    }

    let cancelled = false;
    const refreshAgents = async () => {
      try {
        await params.loadAgents();
      } catch (error) {
        if (!isGatewayDisconnectLikeError(error)) {
          console.error("Failed to refresh agents while awaiting delete restart.", error);
        }
      }
    };

    const intervalId = window.setInterval(() => {
      if (cancelled) return;
      void refreshAgents();
    }, 2500);
    void refreshAgents();

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [
    params.agents,
    params.loadAgents,
    params.setMobilePaneChat,
    params.status,
    restartingMutationBlock,
  ]);

  const handleDeleteAgent = useCallback(
    async (agentId: string) => {
      const decision = planAgentSettingsMutation(
        { kind: "delete-agent", agentId },
        mutationContext
      );
      if (decision.kind === "deny") {
        if (decision.message) {
          params.setError(decision.message);
        }
        return;
      }

      const agent = params.agents.find((entry) => entry.agentId === decision.normalizedAgentId);
      if (!agent) return;
      const confirmed = window.confirm(
        `Delete ${agent.name}? This removes the agent from gateway config + scheduled automations and moves its workspace/state into ~/.openclaw/trash on the gateway host.`
      );
      if (!confirmed) return;

      await runRestartingMutationLifecycle({
        kind: "delete-agent",
        agentId: decision.normalizedAgentId,
        agentName: agent.name,
        label: `Delete ${agent.name}`,
        executeMutation: async () => {
          await deleteAgentViaStudio({
            client: params.client,
            agentId: decision.normalizedAgentId,
            fetchJson,
            logError: (message, error) => console.error(message, error),
          });
          params.clearInspectSidebar();
        },
      });
    },
    [mutationContext, params, runRestartingMutationLifecycle]
  );

  const handleCreateCronJob = useCallback(
    async (agentId: string, draft: CronCreateDraft) => {
      const decision = planAgentSettingsMutation(
        { kind: "create-cron-job", agentId },
        mutationContext
      );
      if (decision.kind === "deny") {
        if (decision.message) {
          setSettingsCronError(decision.message);
        }
        return;
      }

      try {
        await performCronCreateFlow({
          client: params.client,
          agentId: decision.normalizedAgentId,
          draft,
          busy: {
            createBusy: cronCreateBusy,
            runBusyJobId: cronRunBusyJobId,
            deleteBusyJobId: cronDeleteBusyJobId,
          },
          onBusyChange: setCronCreateBusy,
          onError: setSettingsCronError,
          onJobs: setSettingsCronJobs,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to create automation.";
        if (!isGatewayDisconnectLikeError(err)) {
          console.error(message);
        }
        throw err;
      }
    },
    [cronCreateBusy, cronDeleteBusyJobId, cronRunBusyJobId, mutationContext, params.client]
  );

  const handleRunCronJob = useCallback(
    async (agentId: string, jobId: string) => {
      const decision = planAgentSettingsMutation(
        { kind: "run-cron-job", agentId, jobId },
        mutationContext
      );
      if (decision.kind === "deny") {
        if (decision.message) {
          setSettingsCronError(decision.message);
        }
        return;
      }

      const resolvedJobId = decision.normalizedJobId as string;
      const resolvedAgentId = decision.normalizedAgentId;
      setCronRunBusyJobId(resolvedJobId);
      setSettingsCronError(null);
      try {
        await runCronJobNow(params.client, resolvedJobId);
        await loadCronJobsForSettingsAgent(resolvedAgentId);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to run schedule.";
        setSettingsCronError(message);
        console.error(message);
      } finally {
        setCronRunBusyJobId((current) => (current === resolvedJobId ? null : current));
      }
    },
    [loadCronJobsForSettingsAgent, mutationContext, params.client]
  );

  const handleDeleteCronJob = useCallback(
    async (agentId: string, jobId: string) => {
      const decision = planAgentSettingsMutation(
        { kind: "delete-cron-job", agentId, jobId },
        mutationContext
      );
      if (decision.kind === "deny") {
        if (decision.message) {
          setSettingsCronError(decision.message);
        }
        return;
      }

      const resolvedJobId = decision.normalizedJobId as string;
      const resolvedAgentId = decision.normalizedAgentId;
      setCronDeleteBusyJobId(resolvedJobId);
      setSettingsCronError(null);
      try {
        const result = await removeCronJob(params.client, resolvedJobId);
        if (result.ok && result.removed) {
          setSettingsCronJobs((jobs) => jobs.filter((job) => job.id !== resolvedJobId));
        }
        await loadCronJobsForSettingsAgent(resolvedAgentId);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to delete schedule.";
        setSettingsCronError(message);
        console.error(message);
      } finally {
        setCronDeleteBusyJobId((current) => (current === resolvedJobId ? null : current));
      }
    },
    [loadCronJobsForSettingsAgent, mutationContext, params.client]
  );

  const handleRenameAgent = useCallback(
    async (agentId: string, name: string) => {
      const decision = planAgentSettingsMutation(
        { kind: "rename-agent", agentId },
        mutationContext
      );
      if (decision.kind === "deny") {
        if (decision.message) {
          params.setError(decision.message);
        }
        return false;
      }
      const agent = params.agents.find((entry) => entry.agentId === decision.normalizedAgentId);
      if (!agent) return false;

      return await runRestartingMutationLifecycle({
        kind: "rename-agent",
        agentId: decision.normalizedAgentId,
        agentName: name,
        label: `Rename ${agent.name}`,
        executeMutation: async () => {
          await renameGatewayAgent({
            client: params.client,
            agentId: decision.normalizedAgentId,
            name,
          });
          params.dispatchUpdateAgent(decision.normalizedAgentId, { name });
        },
      });
    },
    [mutationContext, params, runRestartingMutationLifecycle]
  );

  const handleUpdateAgentPermissions = useCallback(
    async (agentId: string, draft: AgentPermissionsDraft) => {
      const decision = planAgentSettingsMutation(
        { kind: "update-agent-permissions", agentId },
        mutationContext
      );
      if (decision.kind === "deny") {
        if (decision.message) {
          params.setError(decision.message);
        }
        return;
      }

      const agent = params.agents.find((entry) => entry.agentId === decision.normalizedAgentId);
      if (!agent) return;

      await params.enqueueConfigMutation({
        kind: "update-agent-permissions",
        label: `Update permissions for ${agent.name}`,
        run: async () => {
          await updateAgentPermissionsViaStudio({
            client: params.client,
            agentId: decision.normalizedAgentId,
            sessionKey: agent.sessionKey,
            draft,
            loadAgents: async () => {},
          });
          await params.loadAgents();
          await params.refreshGatewayConfigSnapshot();
          params.setInspectSidebarCapabilities(decision.normalizedAgentId);
          params.setMobilePaneChat();
        },
      });
    },
    [mutationContext, params]
  );

  return {
    settingsCronJobs,
    settingsCronLoading,
    settingsCronError,
    cronCreateBusy,
    cronRunBusyJobId,
    cronDeleteBusyJobId,
    restartingMutationBlock,
    hasRenameMutationBlock,
    hasDeleteMutationBlock,
    hasRestartBlockInProgress,
    handleDeleteAgent,
    handleCreateCronJob,
    handleRunCronJob,
    handleDeleteCronJob,
    handleRenameAgent,
    handleUpdateAgentPermissions,
  };
}
