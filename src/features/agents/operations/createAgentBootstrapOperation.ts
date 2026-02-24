import {
  type AgentPermissionsDraft,
  updateAgentPermissionsViaStudio,
} from "@/features/agents/operations/agentPermissionsOperation";
import type { GatewayClient } from "@/lib/gateway/GatewayClient";
import {
  planCreateAgentBootstrapCommands,
  type CreateBootstrapCommand,
} from "@/features/agents/operations/createAgentBootstrapWorkflow";

type CreateCompletion = {
  agentId: string;
  agentName: string;
};

type CreatedAgent = {
  agentId: string;
  sessionKey: string;
};

const resolveBootstrapErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message || "Failed to apply default permissions.";
  }
  return "Failed to apply default permissions.";
};

export async function applyCreateAgentBootstrapPermissions(params: {
  client: GatewayClient;
  agentId: string;
  sessionKey: string;
  draft: AgentPermissionsDraft;
  loadAgents: () => Promise<void>;
}): Promise<void> {
  await updateAgentPermissionsViaStudio({
    client: params.client,
    agentId: params.agentId,
    sessionKey: params.sessionKey,
    draft: params.draft,
    loadAgents: params.loadAgents,
  });
}

export async function runCreateAgentBootstrapOperation(params: {
  completion: CreateCompletion;
  focusedAgentId: string | null;
  loadAgents: () => Promise<void>;
  findAgentById: (agentId: string) => CreatedAgent | null;
  applyDefaultPermissions: (input: { agentId: string; sessionKey: string }) => Promise<void>;
  refreshGatewayConfigSnapshot: () => Promise<unknown>;
  planCommands?: typeof planCreateAgentBootstrapCommands;
}): Promise<CreateBootstrapCommand[]> {
  const plan = params.planCommands ?? planCreateAgentBootstrapCommands;

  await params.loadAgents();
  let createdAgent = params.findAgentById(params.completion.agentId);
  if (!createdAgent) {
    await params.loadAgents();
    createdAgent = params.findAgentById(params.completion.agentId);
  }

  let bootstrapErrorMessage: string | null = null;
  if (createdAgent) {
    try {
      await params.applyDefaultPermissions({
        agentId: createdAgent.agentId,
        sessionKey: createdAgent.sessionKey,
      });
      await params.refreshGatewayConfigSnapshot();
    } catch (error) {
      bootstrapErrorMessage = resolveBootstrapErrorMessage(error);
    }
  }

  return plan({
    completion: params.completion,
    createdAgent,
    bootstrapErrorMessage,
    focusedAgentId: params.focusedAgentId,
  });
}

export function executeCreateAgentBootstrapCommands(params: {
  commands: CreateBootstrapCommand[];
  setCreateAgentModalError: (message: string | null) => void;
  setGlobalError: (message: string) => void;
  setCreateAgentBlock: (value: null) => void;
  setCreateAgentModalOpen: (open: boolean) => void;
  flushPendingDraft: (agentId: string | null) => void;
  selectAgent: (agentId: string) => void;
  setInspectSidebarCapabilities: (agentId: string) => void;
  setMobilePaneChat: () => void;
}): void {
  for (const command of params.commands) {
    if (command.kind === "set-create-modal-error") {
      params.setCreateAgentModalError(command.message);
      continue;
    }
    if (command.kind === "set-global-error") {
      params.setGlobalError(command.message);
      continue;
    }
    if (command.kind === "set-create-block") {
      params.setCreateAgentBlock(command.value);
      continue;
    }
    if (command.kind === "set-create-modal-open") {
      params.setCreateAgentModalOpen(command.open);
      continue;
    }
    if (command.kind === "flush-pending-draft") {
      params.flushPendingDraft(command.agentId);
      continue;
    }
    if (command.kind === "select-agent") {
      params.selectAgent(command.agentId);
      continue;
    }
    if (command.kind === "set-inspect-sidebar") {
      params.setInspectSidebarCapabilities(command.agentId);
      continue;
    }
    params.setMobilePaneChat();
  }
}
