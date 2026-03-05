export type InTabNotificationState = {
  focusedAgentId: string | null;
  focusedAgentStatus: string | null;
  focusedApprovalCount: number;
};

export type InTabNotificationIntent =
  | { kind: "notify-run-finished"; agentId: string; agentName: string }
  | { kind: "notify-approval-needed"; agentId: string; agentName: string; count: number };

export function decideInTabNotificationIntents(params: {
  previous: InTabNotificationState;
  current: InTabNotificationState;
  focusedAgentName: string | null;
  enabled: boolean;
  permission: NotificationPermission | "unsupported";
}): InTabNotificationIntent[] {
  if (!params.enabled) return [];
  if (params.permission !== "granted") return [];

  const previous = params.previous;
  const current = params.current;
  if (previous.focusedAgentId !== current.focusedAgentId) return [];
  if (!current.focusedAgentId) return [];

  const agentName = params.focusedAgentName?.trim() || "Agent";
  const intents: InTabNotificationIntent[] = [];

  if (
    previous.focusedAgentStatus === "running" &&
    current.focusedAgentStatus &&
    current.focusedAgentStatus !== "running"
  ) {
    intents.push({
      kind: "notify-run-finished",
      agentId: current.focusedAgentId,
      agentName,
    });
  }

  if (current.focusedApprovalCount > previous.focusedApprovalCount) {
    intents.push({
      kind: "notify-approval-needed",
      agentId: current.focusedAgentId,
      agentName,
      count: current.focusedApprovalCount,
    });
  }

  return intents;
}
