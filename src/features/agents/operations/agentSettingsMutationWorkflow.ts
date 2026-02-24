import {
  resolveMutationStartGuard,
  type MutationStartGuardResult,
} from "@/features/agents/operations/mutationLifecycleWorkflow";

export const RESERVED_MAIN_AGENT_ID = "main";

type GuardedActionKind = "delete-agent" | "rename-agent" | "update-agent-permissions";
type CronActionKind = "run-cron-job" | "delete-cron-job";

export type AgentSettingsMutationRequest =
  | { kind: GuardedActionKind; agentId: string }
  | { kind: "create-cron-job"; agentId: string }
  | { kind: CronActionKind; agentId: string; jobId: string };

export type AgentSettingsMutationContext = {
  status: "connected" | "connecting" | "disconnected";
  hasCreateBlock: boolean;
  hasRenameBlock: boolean;
  hasDeleteBlock: boolean;
  cronCreateBusy: boolean;
  cronRunBusyJobId: string | null;
  cronDeleteBusyJobId: string | null;
};

export type AgentSettingsMutationDenyReason =
  | "start-guard-deny"
  | "reserved-main-delete"
  | "cron-action-busy"
  | "missing-agent-id"
  | "missing-job-id";

export type AgentSettingsMutationDecision =
  | {
      kind: "allow";
      normalizedAgentId: string;
      normalizedJobId?: string;
    }
  | {
      kind: "deny";
      reason: AgentSettingsMutationDenyReason;
      message: string | null;
      guardReason?: Exclude<MutationStartGuardResult, { kind: "allow" }>["reason"];
    };

const normalizeId = (value: string) => value.trim();

const isGuardedAction = (
  kind: AgentSettingsMutationRequest["kind"]
): kind is GuardedActionKind =>
  kind === "delete-agent" || kind === "rename-agent" || kind === "update-agent-permissions";

const isCronActionBusy = (context: AgentSettingsMutationContext) =>
  context.cronCreateBusy ||
  Boolean(context.cronRunBusyJobId?.trim()) ||
  Boolean(context.cronDeleteBusyJobId?.trim());

export const planAgentSettingsMutation = (
  request: AgentSettingsMutationRequest,
  context: AgentSettingsMutationContext
): AgentSettingsMutationDecision => {
  const normalizedAgentId = normalizeId(request.agentId);
  if (!normalizedAgentId) {
    return {
      kind: "deny",
      reason: "missing-agent-id",
      message: null,
    };
  }

  if (isGuardedAction(request.kind)) {
    const startGuard = resolveMutationStartGuard({
      status: context.status,
      hasCreateBlock: context.hasCreateBlock,
      hasRenameBlock: context.hasRenameBlock,
      hasDeleteBlock: context.hasDeleteBlock,
    });
    if (startGuard.kind === "deny") {
      return {
        kind: "deny",
        reason: "start-guard-deny",
        message: null,
        guardReason: startGuard.reason,
      };
    }
  }

  if (request.kind === "delete-agent" && normalizedAgentId === RESERVED_MAIN_AGENT_ID) {
    return {
      kind: "deny",
      reason: "reserved-main-delete",
      message: "The main agent cannot be deleted.",
    };
  }

  if (request.kind === "run-cron-job" || request.kind === "delete-cron-job") {
    const normalizedJobId = normalizeId(request.jobId);
    if (!normalizedJobId) {
      return {
        kind: "deny",
        reason: "missing-job-id",
        message: null,
      };
    }

    if (isCronActionBusy(context)) {
      return {
        kind: "deny",
        reason: "cron-action-busy",
        message: null,
      };
    }

    return {
      kind: "allow",
      normalizedAgentId,
      normalizedJobId,
    };
  }

  return {
    kind: "allow",
    normalizedAgentId,
  };
};
