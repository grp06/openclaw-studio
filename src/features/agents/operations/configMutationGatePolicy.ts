import type { GatewayStatus } from "./gatewayRestartPolicy";

export type ConfigMutationGateInput = {
  status: GatewayStatus;
  hasRunningAgents: boolean;
  nextMutationRequiresIdleAgents: boolean;
  hasActiveMutation: boolean;
  hasRestartBlockInProgress: boolean;
  queuedCount: number;
};

export function shouldStartNextConfigMutation(input: ConfigMutationGateInput): boolean {
  if (input.status !== "connected") return false;
  if (input.queuedCount <= 0) return false;
  if (input.hasActiveMutation) return false;
  if (input.hasRestartBlockInProgress) return false;
  if (input.hasRunningAgents && input.nextMutationRequiresIdleAgents) return false;
  return true;
}
