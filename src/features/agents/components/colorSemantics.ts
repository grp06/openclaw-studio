import type { AgentStatus } from "@/features/agents/state/store";
import type { GatewayStatus } from "@/lib/gateway/gateway-status";

export const AGENT_STATUS_LABEL: Record<AgentStatus, string> = {
  idle: "Idle",
  running: "Running",
  error: "Error",
};

export const AGENT_STATUS_BADGE_CLASS: Record<AgentStatus, string> = {
  idle: "ui-badge-status-idle",
  running: "ui-badge-status-running",
  error: "ui-badge-status-error",
};

export const GATEWAY_STATUS_LABEL: Record<GatewayStatus, string> = {
  disconnected: "Disconnected",
  connecting: "Connecting",
  connected: "Connected",
};

export const GATEWAY_STATUS_BADGE_CLASS: Record<GatewayStatus, string> = {
  disconnected: "ui-badge-status-disconnected",
  connecting: "ui-badge-status-connecting",
  connected: "ui-badge-status-connected",
};

export const NEEDS_APPROVAL_BADGE_CLASS = "ui-badge-approval";

export const resolveAgentStatusBadgeClass = (status: AgentStatus): string =>
  AGENT_STATUS_BADGE_CLASS[status];

export const resolveGatewayStatusBadgeClass = (status: GatewayStatus): string =>
  GATEWAY_STATUS_BADGE_CLASS[status];

export const resolveAgentStatusLabel = (status: AgentStatus): string => AGENT_STATUS_LABEL[status];

export const resolveGatewayStatusLabel = (status: GatewayStatus): string => GATEWAY_STATUS_LABEL[status];
