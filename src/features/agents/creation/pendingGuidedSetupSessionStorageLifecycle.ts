import type { AgentGuidedSetup } from "@/features/agents/operations/createAgentOperation";
import {
  loadPendingGuidedSetupsFromStorage,
  persistPendingGuidedSetupsToStorage,
} from "@/features/agents/creation/pendingSetupStore";

export const loadPendingGuidedSetupsForScope = (params: {
  storage: Storage | null | undefined;
  gatewayScope: string;
}): {
  setupsByAgentId: Record<string, AgentGuidedSetup>;
  loadedScope: string;
} => {
  const setupsByAgentId = loadPendingGuidedSetupsFromStorage({
    storage: params.storage,
    gatewayScope: params.gatewayScope,
  });
  return {
    setupsByAgentId,
    loadedScope: params.gatewayScope,
  };
};

export const persistPendingGuidedSetupsForScopeWhenLoaded = (params: {
  storage: Storage | null | undefined;
  gatewayScope: string;
  loadedScope: string | null | undefined;
  setupsByAgentId: Record<string, AgentGuidedSetup>;
}): void => {
  if (params.loadedScope !== params.gatewayScope) return;
  persistPendingGuidedSetupsToStorage({
    storage: params.storage,
    gatewayScope: params.gatewayScope,
    setupsByAgentId: params.setupsByAgentId,
  });
};

