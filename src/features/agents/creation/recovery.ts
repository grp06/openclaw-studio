import type { GatewayClient } from "@/lib/gateway/GatewayClient";
import {
  applyGuidedAgentSetup,
  type AgentGuidedSetup,
} from "@/features/agents/operations/createAgentOperation";

export const upsertPendingGuidedSetup = (
  pendingSetupsByAgentId: Record<string, AgentGuidedSetup>,
  agentId: string,
  setup: AgentGuidedSetup
): Record<string, AgentGuidedSetup> => {
  const id = agentId.trim();
  if (!id) return pendingSetupsByAgentId;
  return {
    ...pendingSetupsByAgentId,
    [id]: setup,
  };
};

export const removePendingGuidedSetup = (
  pendingSetupsByAgentId: Record<string, AgentGuidedSetup>,
  agentId: string
): Record<string, AgentGuidedSetup> => {
  const id = agentId.trim();
  if (!id || !(id in pendingSetupsByAgentId)) {
    return pendingSetupsByAgentId;
  }
  const next = { ...pendingSetupsByAgentId };
  delete next[id];
  return next;
};

export const applyPendingGuidedSetupForAgent = async (params: {
  client: GatewayClient;
  agentId: string;
  pendingSetupsByAgentId: Record<string, AgentGuidedSetup>;
}): Promise<{ applied: boolean; pendingSetupsByAgentId: Record<string, AgentGuidedSetup> }> => {
  const id = params.agentId.trim();
  if (!id) {
    return {
      applied: false,
      pendingSetupsByAgentId: params.pendingSetupsByAgentId,
    };
  }
  const setup = params.pendingSetupsByAgentId[id];
  if (!setup) {
    return {
      applied: false,
      pendingSetupsByAgentId: params.pendingSetupsByAgentId,
    };
  }
  await applyGuidedAgentSetup({
    client: params.client,
    agentId: id,
    setup,
    includeAgentOverrides: false,
  });
  return {
    applied: true,
    pendingSetupsByAgentId: removePendingGuidedSetup(params.pendingSetupsByAgentId, id),
  };
};
