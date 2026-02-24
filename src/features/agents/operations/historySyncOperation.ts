import {
  buildHistoryMetadataPatch,
  resolveHistoryRequestIntent,
  resolveHistoryResponseDisposition,
} from "@/features/agents/operations/historyLifecycleWorkflow";
import {
  buildHistoryLines,
  buildHistorySyncPatch,
  resolveHistoryRunStatePatch,
} from "@/features/agents/state/runtimeEventBridge";
import type { AgentState } from "@/features/agents/state/store";
import {
  areTranscriptEntriesEqual,
  buildOutputLinesFromTranscriptEntries,
  buildTranscriptEntriesFromLines,
  mergeTranscriptEntriesWithHistory,
  sortTranscriptEntries,
  type TranscriptEntry,
} from "@/features/agents/state/transcript";
import { normalizeAssistantDisplayText } from "@/lib/text/assistantText";

type ChatHistoryMessage = Record<string, unknown>;

type ChatHistoryResult = {
  sessionKey: string;
  messages: ChatHistoryMessage[];
};

type GatewayClientLike = {
  call: <T = unknown>(method: string, params: unknown) => Promise<T>;
};

export type HistorySyncCommand =
  | { kind: "dispatchUpdateAgent"; agentId: string; patch: Partial<AgentState> }
  | { kind: "logMetric"; metric: string; meta: Record<string, unknown> }
  | { kind: "logError"; message: string; error: unknown }
  | { kind: "noop"; reason: string };

type HistorySyncDispatchAction = {
  type: "updateAgent";
  agentId: string;
  patch: Partial<AgentState>;
};

type RunHistorySyncOperationParams = {
  client: GatewayClientLike;
  agentId: string;
  requestedLimit?: number;
  getAgent: (agentId: string) => AgentState | null;
  inFlightSessionKeys: Set<string>;
  requestId: string;
  loadedAt: number;
  defaultLimit: number;
  maxLimit: number;
  transcriptV2Enabled: boolean;
};

export const executeHistorySyncCommands = (params: {
  commands: HistorySyncCommand[];
  dispatch: (action: HistorySyncDispatchAction) => void;
  logMetric: (metric: string, meta?: unknown) => void;
  isDisconnectLikeError: (error: unknown) => boolean;
  logError: (message: string, error: unknown) => void;
}) => {
  for (const command of params.commands) {
    if (command.kind === "dispatchUpdateAgent") {
      params.dispatch({
        type: "updateAgent",
        agentId: command.agentId,
        patch: command.patch,
      });
      continue;
    }
    if (command.kind === "logMetric") {
      params.logMetric(command.metric, command.meta);
      continue;
    }
    if (command.kind === "logError") {
      if (params.isDisconnectLikeError(command.error)) continue;
      params.logError(command.message, command.error);
    }
  }
};

const areStringArraysEqual = (left: string[], right: string[]): boolean => {
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i += 1) {
    if (left[i] !== right[i]) return false;
  }
  return true;
};

const scoreResolvedRunAssistantEntry = (entry: TranscriptEntry): number => {
  let score = 0;
  if (entry.confirmed) score += 4;
  if (entry.source === "runtime-chat") score += 2;
  if (entry.source === "history") score += 1;
  if (typeof entry.timestampMs === "number" && Number.isFinite(entry.timestampMs)) {
    score += 1;
  }
  return score;
};

const collapseNonActiveRunAssistantDuplicates = (
  entries: TranscriptEntry[],
  activeRunId: string
): TranscriptEntry[] => {
  const normalizedActiveRunId = activeRunId.trim();
  const next: TranscriptEntry[] = [];
  const byRunAssistantText = new Map<string, number>();
  for (const entry of entries) {
    const normalizedRunId = entry.runId?.trim() ?? "";
    const isResolvedRunAssistant =
      normalizedRunId.length > 0 &&
      normalizedRunId !== normalizedActiveRunId &&
      entry.kind === "assistant" &&
      entry.role === "assistant";
    if (!isResolvedRunAssistant) {
      next.push(entry);
      continue;
    }
    const dedupeKey = normalizeAssistantDisplayText(entry.text);
    if (!dedupeKey) {
      next.push(entry);
      continue;
    }
    const runScopedKey = `${normalizedRunId}:${dedupeKey}`;
    const existingIndex = byRunAssistantText.get(runScopedKey);
    if (existingIndex === undefined) {
      byRunAssistantText.set(runScopedKey, next.length);
      next.push(entry);
      continue;
    }
    const current = next[existingIndex];
    if (!current) {
      byRunAssistantText.set(runScopedKey, next.length);
      next.push(entry);
      continue;
    }
    const currentScore = scoreResolvedRunAssistantEntry(current);
    const nextScore = scoreResolvedRunAssistantEntry(entry);
    const shouldReplace =
      nextScore > currentScore ||
      (nextScore === currentScore && entry.sequenceKey > current.sequenceKey);
    if (shouldReplace) {
      next[existingIndex] = entry;
    }
  }
  return sortTranscriptEntries(next);
};

export const runHistorySyncOperation = async (
  params: RunHistorySyncOperationParams
): Promise<HistorySyncCommand[]> => {
  const requestAgent = params.getAgent(params.agentId);
  const requestIntent = resolveHistoryRequestIntent({
    agent: requestAgent,
    requestedLimit: params.requestedLimit,
    maxLimit: params.maxLimit,
    defaultLimit: params.defaultLimit,
    inFlightSessionKeys: params.inFlightSessionKeys,
    requestId: params.requestId,
    loadedAt: params.loadedAt,
  });
  if (requestIntent.kind === "skip") {
    return [{ kind: "noop", reason: requestIntent.reason }];
  }

  params.inFlightSessionKeys.add(requestIntent.sessionKey);
  const commands: HistorySyncCommand[] = [
    {
      kind: "dispatchUpdateAgent",
      agentId: params.agentId,
      patch: {
        lastHistoryRequestRevision: requestIntent.requestRevision,
      },
    },
  ];

  try {
    const result = await params.client.call<ChatHistoryResult>("chat.history", {
      sessionKey: requestIntent.sessionKey,
      limit: requestIntent.limit,
    });
    const latest = params.getAgent(params.agentId);
    const responseDisposition = resolveHistoryResponseDisposition({
      latestAgent: latest,
      expectedSessionKey: requestIntent.sessionKey,
      requestEpoch: requestIntent.requestEpoch,
      requestRevision: requestIntent.requestRevision,
    });
    const historyMessages = result.messages ?? [];
    const metadataPatch: Partial<AgentState> = buildHistoryMetadataPatch({
      loadedAt: requestIntent.loadedAt,
      fetchedCount: historyMessages.length,
      limit: requestIntent.limit,
      requestId: requestIntent.requestId,
    });

    if (responseDisposition.kind === "drop") {
      const reason = responseDisposition.reason.replace(/-/g, "_");
      commands.push({
        kind: "logMetric",
        metric: "history_response_dropped_stale",
        meta: {
          reason,
          agentId: params.agentId,
          requestId: requestIntent.requestId,
        },
      });
      return commands;
    }

    if (!latest) {
      return commands;
    }

    if (params.transcriptV2Enabled) {
      const existingEntries = Array.isArray(latest.transcriptEntries)
        ? latest.transcriptEntries
        : buildTranscriptEntriesFromLines({
            lines: latest.outputLines,
            sessionKey: latest.sessionKey,
            source: "legacy",
            startSequence: 0,
            confirmed: true,
          });
      const history = buildHistoryLines(historyMessages);
      const runStatePatch = resolveHistoryRunStatePatch({
        status: latest.status,
        runId: latest.runId,
        lastRole: history.lastRole,
        lastUserAt: history.lastUserAt,
        loadedAt: requestIntent.loadedAt,
      });
      const normalizedLastAssistant = history.lastAssistant
        ? normalizeAssistantDisplayText(history.lastAssistant)
        : null;
      const rawHistoryEntries = buildTranscriptEntriesFromLines({
        lines: history.lines,
        sessionKey: requestIntent.sessionKey,
        source: "history",
        startSequence: latest.transcriptSequenceCounter ?? existingEntries.length,
        confirmed: true,
      });
      const historyEntryOccurrenceByKey = new Map<string, number>();
      const historyEntries = rawHistoryEntries.map((entry) => {
        const identityKey = `${entry.kind}:${entry.role}:${entry.timestampMs ?? "none"}:${entry.fingerprint}`;
        const occurrence = historyEntryOccurrenceByKey.get(identityKey) ?? 0;
        historyEntryOccurrenceByKey.set(identityKey, occurrence + 1);
        return {
          ...entry,
          entryId: `history:${requestIntent.sessionKey}:${identityKey}:occ:${occurrence}`,
        };
      });
      const merged = mergeTranscriptEntriesWithHistory({
        existingEntries,
        historyEntries,
      });
      const activeRunId = latest.status === "running" ? (latest.runId?.trim() ?? "") : "";
      const finalEntries = collapseNonActiveRunAssistantDuplicates(merged.entries, activeRunId);
      if (merged.conflictCount > 0) {
        commands.push({
          kind: "logMetric",
          metric: "transcript_merge_conflicts",
          meta: {
            agentId: params.agentId,
            requestId: requestIntent.requestId,
            conflictCount: merged.conflictCount,
          },
        });
      }
      const mergedLines = buildOutputLinesFromTranscriptEntries(finalEntries);
      const transcriptChanged = !areTranscriptEntriesEqual(existingEntries, finalEntries);
      const linesChanged = !areStringArraysEqual(latest.outputLines, mergedLines);
      commands.push({
        kind: "dispatchUpdateAgent",
        agentId: params.agentId,
        patch: {
          ...metadataPatch,
          ...(runStatePatch ?? {}),
          ...(transcriptChanged || linesChanged
            ? {
                transcriptEntries: finalEntries,
                outputLines: mergedLines,
              }
            : {}),
          ...(normalizedLastAssistant ? { lastResult: normalizedLastAssistant } : {}),
          ...(normalizedLastAssistant ? { latestPreview: normalizedLastAssistant } : {}),
          ...(typeof history.lastAssistantAt === "number"
            ? { lastAssistantMessageAt: history.lastAssistantAt }
            : {}),
          ...(history.lastUser ? { lastUserMessage: history.lastUser } : {}),
        },
      });
      return commands;
    }

    const patch = buildHistorySyncPatch({
      messages: historyMessages,
      currentLines: latest.outputLines,
      loadedAt: requestIntent.loadedAt,
      status: latest.status,
      runId: latest.runId,
    });
    commands.push({
      kind: "dispatchUpdateAgent",
      agentId: params.agentId,
      patch: {
        ...patch,
        ...metadataPatch,
      },
    });
    return commands;
  } catch (err) {
    commands.push({
      kind: "logError",
      message: err instanceof Error ? err.message : "Failed to load chat history.",
      error: err,
    });
    return commands;
  } finally {
    params.inFlightSessionKeys.delete(requestIntent.sessionKey);
  }
};
