import type { AgentState } from "@/features/agents/state/store";

export type HistoryRequestIntent =
  | {
      kind: "skip";
      reason: "missing-agent" | "session-not-created" | "missing-session-key" | "in-flight";
    }
  | {
      kind: "fetch";
      sessionKey: string;
      limit: number;
      requestRevision: number;
      requestEpoch: number;
      requestId: string;
      loadedAt: number;
    };

export type HistoryResponseDisposition =
  | {
      kind: "drop";
      reason:
        | "session-key-changed"
        | "session-epoch-changed"
        | "transcript-revision-changed";
    }
  | {
      kind: "apply";
    };

const resolveHistoryFetchLimit = (params: {
  requestedLimit?: number;
  defaultLimit: number;
  maxLimit: number;
}): number => {
  const requested = params.requestedLimit;
  if (typeof requested !== "number" || !Number.isFinite(requested) || requested <= 0) {
    return params.defaultLimit;
  }
  return Math.min(params.maxLimit, Math.floor(requested));
};

export const resolveHistoryRequestIntent = (params: {
  agent: AgentState | null;
  requestedLimit?: number;
  maxLimit: number;
  defaultLimit: number;
  inFlightSessionKeys: Set<string>;
  requestId: string;
  loadedAt: number;
}): HistoryRequestIntent => {
  if (!params.agent) {
    return { kind: "skip", reason: "missing-agent" };
  }
  if (!params.agent.sessionCreated) {
    return { kind: "skip", reason: "session-not-created" };
  }
  const sessionKey = params.agent.sessionKey.trim();
  if (!sessionKey) {
    return { kind: "skip", reason: "missing-session-key" };
  }
  if (params.inFlightSessionKeys.has(sessionKey)) {
    return { kind: "skip", reason: "in-flight" };
  }
  return {
    kind: "fetch",
    sessionKey,
    limit: resolveHistoryFetchLimit({
      requestedLimit: params.requestedLimit,
      defaultLimit: params.defaultLimit,
      maxLimit: params.maxLimit,
    }),
    requestRevision: params.agent.transcriptRevision ?? params.agent.outputLines.length,
    requestEpoch: params.agent.sessionEpoch ?? 0,
    requestId: params.requestId,
    loadedAt: params.loadedAt,
  };
};

export const resolveHistoryResponseDisposition = (params: {
  latestAgent: AgentState | null;
  expectedSessionKey: string;
  requestEpoch: number;
  requestRevision: number;
}): HistoryResponseDisposition => {
  const latest = params.latestAgent;
  if (!latest || latest.sessionKey.trim() !== params.expectedSessionKey) {
    return { kind: "drop", reason: "session-key-changed" };
  }
  if ((latest.sessionEpoch ?? 0) !== params.requestEpoch) {
    return { kind: "drop", reason: "session-epoch-changed" };
  }
  const latestRevision = latest.transcriptRevision ?? latest.outputLines.length;
  if (latestRevision !== params.requestRevision) {
    return { kind: "drop", reason: "transcript-revision-changed" };
  }
  return { kind: "apply" };
};

export const buildHistoryMetadataPatch = (params: {
  loadedAt: number;
  fetchedCount: number;
  limit: number;
  requestId: string;
}): Pick<
  AgentState,
  | "historyLoadedAt"
  | "historyFetchLimit"
  | "historyFetchedCount"
  | "historyMaybeTruncated"
  | "lastAppliedHistoryRequestId"
> => {
  return {
    historyLoadedAt: params.loadedAt,
    historyFetchLimit: params.limit,
    historyFetchedCount: params.fetchedCount,
    historyMaybeTruncated: params.fetchedCount >= params.limit,
    lastAppliedHistoryRequestId: params.requestId,
  };
};
