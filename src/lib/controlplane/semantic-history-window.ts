import type { ControlPlaneOutboxEntry } from "@/lib/controlplane/contracts";

type SemanticTurnRole = "user" | "assistant";
export type SemanticHistoryActiveRunStatus = "running" | "idle" | "error";

export type SemanticHistoryActiveRun = {
  runId: string | null;
  status: SemanticHistoryActiveRunStatus;
  complete: boolean;
};

export type SemanticHistoryWindowResult = {
  entries: ControlPlaneOutboxEntry[];
  semanticTurnsIncluded: number;
  activeRun: SemanticHistoryActiveRun;
  windowTruncated: boolean;
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const resolveGatewayEvent = (
  entry: ControlPlaneOutboxEntry
): { name: string; payload: Record<string, unknown> | null } | null => {
  if (entry.event.type !== "gateway.event") return null;
  if (typeof entry.event.event !== "string") return null;
  return {
    name: entry.event.event.trim().toLowerCase(),
    payload: asRecord(entry.event.payload),
  };
};

const resolveRunIdFromEntry = (entry: ControlPlaneOutboxEntry): string | null => {
  const gatewayEvent = resolveGatewayEvent(entry);
  if (!gatewayEvent?.payload) return null;
  const runId = gatewayEvent.payload.runId;
  if (typeof runId !== "string") return null;
  const normalized = runId.trim();
  return normalized || null;
};

const resolveLifecyclePhase = (entry: ControlPlaneOutboxEntry): string | null => {
  const gatewayEvent = resolveGatewayEvent(entry);
  if (!gatewayEvent?.payload || gatewayEvent.name !== "agent") return null;
  const stream = gatewayEvent.payload.stream;
  if (typeof stream !== "string" || stream.trim().toLowerCase() !== "lifecycle") {
    return null;
  }
  const data = asRecord(gatewayEvent.payload.data);
  const phase = data?.phase;
  if (typeof phase !== "string") return null;
  const normalized = phase.trim().toLowerCase();
  return normalized || null;
};

const resolveChatState = (entry: ControlPlaneOutboxEntry): string | null => {
  const gatewayEvent = resolveGatewayEvent(entry);
  if (!gatewayEvent?.payload || gatewayEvent.name !== "chat") return null;
  const state = gatewayEvent.payload.state;
  if (typeof state !== "string") return null;
  const normalized = state.trim().toLowerCase();
  return normalized || null;
};

const resolveChatRole = (entry: ControlPlaneOutboxEntry): string | null => {
  const gatewayEvent = resolveGatewayEvent(entry);
  if (!gatewayEvent?.payload || gatewayEvent.name !== "chat") return null;
  const message = asRecord(gatewayEvent.payload.message);
  const role = message?.role ?? gatewayEvent.payload.role;
  if (typeof role !== "string") return null;
  const normalized = role.trim().toLowerCase();
  return normalized || null;
};

const resolveSemanticTurnRole = (entry: ControlPlaneOutboxEntry): SemanticTurnRole | null => {
  const state = resolveChatState(entry);
  if (!state || state === "delta") return null;
  const role = resolveChatRole(entry);
  if (role === "user") return "user";
  if (role === "assistant") return "assistant";
  if (!role && (state === "aborted" || state === "error")) {
    return "assistant";
  }
  return null;
};

export const countSemanticTurns = (entries: ControlPlaneOutboxEntry[]): number => {
  let count = 0;
  for (const entry of entries) {
    if (resolveSemanticTurnRole(entry)) {
      count += 1;
    }
  }
  return count;
};

const resolveLatestRunId = (entries: ControlPlaneOutboxEntry[]): string | null => {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const runId = resolveRunIdFromEntry(entries[index]);
    if (runId) return runId;
  }
  return null;
};

const resolveActiveRunEarliestIndex = (
  entries: ControlPlaneOutboxEntry[],
  runId: string
): number | null => {
  for (let index = 0; index < entries.length; index += 1) {
    if (resolveRunIdFromEntry(entries[index]) === runId) {
      return index;
    }
  }
  return null;
};

const resolveTerminalStatusForRunEntry = (
  entry: ControlPlaneOutboxEntry,
  runId: string
): SemanticHistoryActiveRunStatus | null => {
  const entryRunId = resolveRunIdFromEntry(entry);
  if (!entryRunId || entryRunId !== runId) return null;

  const chatState = resolveChatState(entry);
  const chatRole = resolveChatRole(entry);
  if (chatState === "error") {
    return chatRole === "user" ? null : "error";
  }
  if (chatState === "aborted") {
    return chatRole === "user" ? null : "idle";
  }
  if (chatState === "final") {
    return chatRole === "user" ? null : "idle";
  }

  const phase = resolveLifecyclePhase(entry);
  if (phase === "error") return "error";
  if (phase === "end") return "idle";

  return null;
};

export const resolveActiveRunFromEntries = (
  entries: ControlPlaneOutboxEntry[],
  hasMoreBefore: boolean
): SemanticHistoryActiveRun => {
  const runId = resolveLatestRunId(entries);
  if (!runId) {
    return { runId: null, status: "idle", complete: true };
  }

  let sawLifecycleStart = false;
  let sawUserMessage = false;
  let terminalStatus: SemanticHistoryActiveRunStatus | null = null;
  let sawRunEntries = false;

  for (const entry of entries) {
    const entryRunId = resolveRunIdFromEntry(entry);
    if (entryRunId !== runId) continue;
    sawRunEntries = true;

    const phase = resolveLifecyclePhase(entry);
    if (phase === "start") {
      sawLifecycleStart = true;
    }

    const chatState = resolveChatState(entry);
    const chatRole = resolveChatRole(entry);
    if (chatRole === "user" && chatState && chatState !== "delta") {
      sawUserMessage = true;
    }

    const nextTerminal = resolveTerminalStatusForRunEntry(entry, runId);
    if (nextTerminal) {
      terminalStatus = nextTerminal;
    }
  }

  if (!sawRunEntries) {
    return { runId: null, status: "idle", complete: true };
  }
  if (terminalStatus) {
    return { runId, status: terminalStatus, complete: true };
  }

  return {
    runId,
    status: "running",
    complete: sawLifecycleStart || sawUserMessage || !hasMoreBefore,
  };
};

export const selectSemanticHistoryWindow = (params: {
  entries: ControlPlaneOutboxEntry[];
  turnLimit: number;
  hasMoreBefore: boolean;
}): SemanticHistoryWindowResult => {
  const safeTurnLimit =
    Number.isFinite(params.turnLimit) && params.turnLimit > 0 ? Math.floor(params.turnLimit) : 50;
  const activeRun = resolveActiveRunFromEntries(params.entries, params.hasMoreBefore);

  if (params.entries.length === 0) {
    return {
      entries: [],
      semanticTurnsIncluded: 0,
      activeRun,
      windowTruncated: params.hasMoreBefore,
    };
  }

  let startIndex = 0;
  let turnCount = 0;
  for (let index = params.entries.length - 1; index >= 0; index -= 1) {
    if (!resolveSemanticTurnRole(params.entries[index])) continue;
    turnCount += 1;
    if (turnCount > safeTurnLimit) {
      startIndex = index + 1;
      break;
    }
  }

  if (activeRun.status === "running" && activeRun.runId) {
    const earliestRunIndex = resolveActiveRunEarliestIndex(params.entries, activeRun.runId);
    if (typeof earliestRunIndex === "number" && earliestRunIndex < startIndex) {
      startIndex = earliestRunIndex;
    }
  }

  const selectedEntries = params.entries.slice(startIndex);
  return {
    entries: selectedEntries,
    semanticTurnsIncluded: countSemanticTurns(selectedEntries),
    activeRun,
    windowTruncated: startIndex > 0 || params.hasMoreBefore,
  };
};
