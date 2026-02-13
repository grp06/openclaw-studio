import {
  buildHistoryMetadataPatch,
  resolveHistoryRequestIntent,
  resolveHistoryResponseDisposition,
} from "@/features/agents/operations/historyLifecycleWorkflow";
import { buildHistoryLines, buildHistorySyncPatch } from "@/features/agents/state/runtimeEventBridge";
import type { AgentState } from "@/features/agents/state/store";
import {
  areTranscriptEntriesEqual,
  buildOutputLinesFromTranscriptEntries,
  buildTranscriptEntriesFromLines,
  mergeTranscriptEntriesWithHistory,
} from "@/features/agents/state/transcript";

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

const areStringArraysEqual = (left: string[], right: string[]): boolean => {
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i += 1) {
    if (left[i] !== right[i]) return false;
  }
  return true;
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
      if (responseDisposition.reason === "transcript-revision-changed") {
        const latestRevision = latest?.transcriptRevision ?? latest?.outputLines.length;
        commands.push({
          kind: "logMetric",
          metric: "history_response_dropped_stale",
          meta: {
            reason,
            agentId: params.agentId,
            requestId: requestIntent.requestId,
            requestRevision: requestIntent.requestRevision,
            latestRevision,
          },
        });
        commands.push({
          kind: "dispatchUpdateAgent",
          agentId: params.agentId,
          patch: metadataPatch,
        });
        return commands;
      }
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

    if (responseDisposition.kind === "metadata-only") {
      commands.push({
        kind: "logMetric",
        metric: "history_apply_skipped_running",
        meta: {
          agentId: params.agentId,
          requestId: requestIntent.requestId,
          runId: latest?.runId ?? null,
        },
      });
      commands.push({
        kind: "dispatchUpdateAgent",
        agentId: params.agentId,
        patch: metadataPatch,
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
      const rawHistoryEntries = buildTranscriptEntriesFromLines({
        lines: history.lines,
        sessionKey: requestIntent.sessionKey,
        source: "history",
        startSequence: latest.transcriptSequenceCounter ?? existingEntries.length,
        confirmed: true,
      });
      const historyEntries = rawHistoryEntries.map((entry) => ({
        ...entry,
        entryId: `history:${requestIntent.sessionKey}:${entry.kind}:${entry.role}:${entry.timestampMs ?? "none"}:${entry.fingerprint}`,
      }));
      const merged = mergeTranscriptEntriesWithHistory({
        existingEntries,
        historyEntries,
      });
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
      const mergedLines = buildOutputLinesFromTranscriptEntries(merged.entries);
      const transcriptChanged = !areTranscriptEntriesEqual(existingEntries, merged.entries);
      const linesChanged = !areStringArraysEqual(latest.outputLines, mergedLines);
      commands.push({
        kind: "dispatchUpdateAgent",
        agentId: params.agentId,
        patch: {
          ...metadataPatch,
          ...(transcriptChanged || linesChanged
            ? {
                transcriptEntries: merged.entries,
                outputLines: mergedLines,
              }
            : {}),
          ...(history.lastAssistant ? { lastResult: history.lastAssistant } : {}),
          ...(history.lastAssistant ? { latestPreview: history.lastAssistant } : {}),
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
