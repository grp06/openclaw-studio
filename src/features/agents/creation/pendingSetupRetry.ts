import type { AgentGuidedSetup } from "@/features/agents/operations/createAgentOperation";

type RetrySelectionParams = {
  pendingSetupsByAgentId: Record<string, AgentGuidedSetup>;
  knownAgentIds: Set<string>;
  attemptedAgentIds: Set<string>;
  inFlightAgentIds: Set<string>;
};

export const selectNextPendingGuidedSetupRetryAgentId = (
  params: RetrySelectionParams
): string | null => {
  const orderedIds = Object.keys(params.pendingSetupsByAgentId)
    .map((agentId) => agentId.trim())
    .filter((agentId) => agentId.length > 0)
    .sort();
  for (const agentId of orderedIds) {
    if (!params.knownAgentIds.has(agentId)) continue;
    if (params.attemptedAgentIds.has(agentId)) continue;
    if (params.inFlightAgentIds.has(agentId)) continue;
    return agentId;
  }
  return null;
};

export const beginPendingGuidedSetupRetry = (inFlightAgentIds: Set<string>, agentId: string): boolean => {
  const resolvedAgentId = agentId.trim();
  if (!resolvedAgentId) return false;
  if (inFlightAgentIds.has(resolvedAgentId)) return false;
  inFlightAgentIds.add(resolvedAgentId);
  return true;
};

export const endPendingGuidedSetupRetry = (inFlightAgentIds: Set<string>, agentId: string): void => {
  const resolvedAgentId = agentId.trim();
  if (!resolvedAgentId) return;
  inFlightAgentIds.delete(resolvedAgentId);
};
