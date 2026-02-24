import type { GatewayStatus } from "@/lib/gateway/GatewayClient";

export type StopRunIntent =
  | { kind: "deny"; reason: "not-connected" | "missing-session-key"; message: string }
  | { kind: "skip-busy" }
  | { kind: "allow"; sessionKey: string };

export const planStopRunIntent = (input: {
  status: GatewayStatus;
  agentId: string;
  sessionKey: string;
  busyAgentId: string | null;
}): StopRunIntent => {
  if (input.status !== "connected") {
    return {
      kind: "deny",
      reason: "not-connected",
      message: "Connect to gateway before stopping a run.",
    };
  }
  const sessionKey = input.sessionKey.trim();
  if (!sessionKey) {
    return {
      kind: "deny",
      reason: "missing-session-key",
      message: "Missing session key for agent.",
    };
  }
  if (input.busyAgentId === input.agentId) {
    return { kind: "skip-busy" };
  }
  return {
    kind: "allow",
    sessionKey,
  };
};

export type NewSessionIntent =
  | { kind: "deny"; reason: "missing-agent" | "missing-session-key"; message: string }
  | { kind: "allow"; sessionKey: string };

export const planNewSessionIntent = (input: {
  hasAgent: boolean;
  sessionKey: string;
}): NewSessionIntent => {
  if (!input.hasAgent) {
    return {
      kind: "deny",
      reason: "missing-agent",
      message: "Failed to start new session: agent not found.",
    };
  }
  const sessionKey = input.sessionKey.trim();
  if (!sessionKey) {
    return {
      kind: "deny",
      reason: "missing-session-key",
      message: "Missing session key for agent.",
    };
  }
  return {
    kind: "allow",
    sessionKey,
  };
};

export type DraftFlushIntent =
  | { kind: "skip"; reason: "missing-agent-id" | "missing-pending-value" }
  | { kind: "flush"; agentId: string };

export const planDraftFlushIntent = (input: {
  agentId: string | null;
  hasPendingValue: boolean;
}): DraftFlushIntent => {
  if (!input.agentId) {
    return {
      kind: "skip",
      reason: "missing-agent-id",
    };
  }
  if (!input.hasPendingValue) {
    return {
      kind: "skip",
      reason: "missing-pending-value",
    };
  }
  return {
    kind: "flush",
    agentId: input.agentId,
  };
};

export type DraftTimerIntent =
  | { kind: "skip"; reason: "missing-agent-id" }
  | { kind: "schedule"; agentId: string; delayMs: number };

export const planDraftTimerIntent = (input: {
  agentId: string;
  delayMs?: number;
}): DraftTimerIntent => {
  if (!input.agentId) {
    return {
      kind: "skip",
      reason: "missing-agent-id",
    };
  }
  return {
    kind: "schedule",
    agentId: input.agentId,
    delayMs: input.delayMs ?? 250,
  };
};
