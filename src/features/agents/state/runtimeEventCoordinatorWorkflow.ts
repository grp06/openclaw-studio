import type { AgentState } from "@/features/agents/state/store";
import type { TranscriptAppendMeta } from "@/features/agents/state/transcript";
import {
  dedupeRunLines,
  type AgentEventPayload,
  type ChatEventPayload,
} from "@/features/agents/state/runtimeEventBridge";
import type { RuntimePolicyIntent } from "@/features/agents/state/runtimeEventPolicy";
import type { RuntimeChatWorkflowCommand } from "@/features/agents/state/runtimeChatEventWorkflow";
import type { RuntimeAgentWorkflowCommand } from "@/features/agents/state/runtimeAgentEventWorkflow";
import {
  applyTerminalCommit,
  clearRunTerminalState,
  createRuntimeTerminalState,
  deriveLifecycleTerminalDecision,
  markClosedRun,
  pruneClosedRuns,
  type RuntimeTerminalCommand,
  type RuntimeTerminalState,
} from "@/features/agents/state/runtimeTerminalWorkflow";
import { formatMetaMarkdown } from "@/lib/text/message-extract";

export type RuntimeEventCoordinatorState = {
  runtimeTerminalState: RuntimeTerminalState;
  chatRunSeen: Set<string>;
  assistantStreamByRun: Map<string, string>;
  thinkingStreamByRun: Map<string, string>;
  thinkingStartedAtByRun: Map<string, number>;
  toolLinesSeenByRun: Map<string, Set<string>>;
  historyRefreshRequestedByRun: Set<string>;
  thinkingDebugBySession: Set<string>;
  lastActivityMarkByAgent: Map<string, number>;
};

export type RuntimeCoordinatorDispatchAction =
  | { type: "updateAgent"; agentId: string; patch: Partial<AgentState> }
  | {
      type: "appendOutput";
      agentId: string;
      line: string;
      transcript?: TranscriptAppendMeta;
    }
  | { type: "markActivity"; agentId: string; at?: number };

export type RuntimeCoordinatorEffectCommand =
  | { kind: "dispatch"; action: RuntimeCoordinatorDispatchAction }
  | { kind: "queueLivePatch"; agentId: string; patch: Partial<AgentState> }
  | { kind: "clearPendingLivePatch"; agentId: string }
  | {
      kind: "requestHistoryRefresh";
      agentId: string;
      reason: "chat-final-no-trace";
      deferMs: number;
    }
  | {
      kind: "scheduleSummaryRefresh";
      delayMs: number;
      includeHeartbeatRefresh: boolean;
    }
  | { kind: "cancelLifecycleFallback"; runId: string }
  | {
      kind: "scheduleLifecycleFallback";
      runId: string;
      delayMs: number;
      agentId: string;
      sessionKey: string;
      finalText: string;
      transitionPatch: Partial<AgentState>;
    }
  | {
      kind: "appendAbortedIfNotSuppressed";
      agentId: string;
      runId: string | null;
      sessionKey: string;
      stopReason: string | null;
      timestampMs: number;
    }
  | { kind: "logMetric"; metric: string; meta: Record<string, unknown> }
  | { kind: "logWarn"; message: string; meta?: unknown }
  | {
      kind: "updateSpecialLatest";
      agentId: string;
      message: string;
      agentSnapshot?: AgentState;
    };

type ReduceResult = {
  state: RuntimeEventCoordinatorState;
  effects: RuntimeCoordinatorEffectCommand[];
};

type ReduceOptions = {
  closedRunTtlMs?: number;
};

const CLOSED_RUN_TTL_MS = 30_000;
const MARK_ACTIVITY_THROTTLE_MS = 300;

const toRunId = (runId?: string | null): string => runId?.trim() ?? "";

const terminalAssistantMetaEntryId = (runId?: string | null) => {
  const key = runId?.trim() ?? "";
  return key ? `run:${key}:assistant:meta` : undefined;
};

const terminalAssistantFinalEntryId = (runId?: string | null) => {
  const key = runId?.trim() ?? "";
  return key ? `run:${key}:assistant:final` : undefined;
};

const cloneState = (state: RuntimeEventCoordinatorState): RuntimeEventCoordinatorState => ({
  runtimeTerminalState: state.runtimeTerminalState,
  chatRunSeen: new Set(state.chatRunSeen),
  assistantStreamByRun: new Map(state.assistantStreamByRun),
  thinkingStreamByRun: new Map(state.thinkingStreamByRun),
  thinkingStartedAtByRun: new Map(state.thinkingStartedAtByRun),
  toolLinesSeenByRun: new Map(state.toolLinesSeenByRun),
  historyRefreshRequestedByRun: new Set(state.historyRefreshRequestedByRun),
  thinkingDebugBySession: new Set(state.thinkingDebugBySession),
  lastActivityMarkByAgent: new Map(state.lastActivityMarkByAgent),
});

const clearRunTrackingState = (
  state: RuntimeEventCoordinatorState,
  runId?: string | null
): ReduceResult => {
  const key = toRunId(runId);
  if (!key) return { state, effects: [] };
  const nextState = cloneState(state);
  nextState.chatRunSeen.delete(key);
  nextState.assistantStreamByRun.delete(key);
  nextState.thinkingStreamByRun.delete(key);
  nextState.thinkingStartedAtByRun.delete(key);
  nextState.toolLinesSeenByRun.delete(key);
  nextState.historyRefreshRequestedByRun.delete(key);
  return {
    state: nextState,
    effects: [{ kind: "cancelLifecycleFallback", runId: key }],
  };
};

const applyRuntimeTerminalCommands = (params: {
  state: RuntimeEventCoordinatorState;
  commands: RuntimeTerminalCommand[];
  nowMs: number;
  closedRunTtlMs: number;
  onScheduleLifecycleFallback?: (
    command: Extract<RuntimeTerminalCommand, { kind: "scheduleLifecycleFallback" }>
  ) => RuntimeCoordinatorEffectCommand | null;
}): ReduceResult => {
  let nextState = params.state;
  const effects: RuntimeCoordinatorEffectCommand[] = [];

  for (const command of params.commands) {
    if (command.kind === "cancelLifecycleFallback") {
      effects.push({ kind: "cancelLifecycleFallback", runId: command.runId });
      continue;
    }
    if (command.kind === "clearRunTerminalState") {
      effects.push({ kind: "cancelLifecycleFallback", runId: command.runId });
      nextState = {
        ...nextState,
        runtimeTerminalState: clearRunTerminalState(nextState.runtimeTerminalState, {
          runId: command.runId,
        }),
      };
      continue;
    }
    if (command.kind === "markRunClosed") {
      nextState = {
        ...nextState,
        runtimeTerminalState: markClosedRun(nextState.runtimeTerminalState, {
          runId: command.runId,
          now: params.nowMs,
          ttlMs: params.closedRunTtlMs,
        }),
      };
      continue;
    }
    if (command.kind === "clearRunTracking") {
      const cleared = clearRunTrackingState(nextState, command.runId);
      nextState = cleared.state;
      effects.push(...cleared.effects);
      continue;
    }
    if (command.kind === "scheduleLifecycleFallback") {
      const scheduled = params.onScheduleLifecycleFallback?.(command);
      if (scheduled) {
        effects.push(scheduled);
      }
    }
  }

  return { state: nextState, effects };
};

const appendToolLinesEffects = (params: {
  state: RuntimeEventCoordinatorState;
  agentId: string;
  runId: string | null;
  sessionKey: string | undefined;
  source: "runtime-chat" | "runtime-agent";
  timestampMs: number;
  lines: string[];
}): ReduceResult => {
  const { agentId, runId, sessionKey, source, timestampMs, lines } = params;
  if (lines.length === 0) {
    return { state: params.state, effects: [] };
  }

  if (!runId) {
    const effects: RuntimeCoordinatorEffectCommand[] = lines.map((line) => ({
      kind: "dispatch",
      action: {
        type: "appendOutput",
        agentId,
        line,
        transcript: {
          source,
          runId: null,
          sessionKey,
          timestampMs,
          kind: "tool",
          role: "tool",
        },
      },
    }));
    return { state: params.state, effects };
  }

  const current = params.state.toolLinesSeenByRun.get(runId) ?? new Set<string>();
  const { appended, nextSeen } = dedupeRunLines(current, lines);
  if (appended.length === 0) {
    return { state: params.state, effects: [] };
  }

  const nextToolLinesSeenByRun = new Map(params.state.toolLinesSeenByRun);
  nextToolLinesSeenByRun.set(runId, nextSeen);
  const nextState = {
    ...params.state,
    toolLinesSeenByRun: nextToolLinesSeenByRun,
  };
  const effects: RuntimeCoordinatorEffectCommand[] = appended.map((line) => ({
    kind: "dispatch",
    action: {
      type: "appendOutput",
      agentId,
      line,
      transcript: {
        source,
        runId,
        sessionKey,
        timestampMs,
        kind: "tool",
        role: "tool",
      },
    },
  }));
  return { state: nextState, effects };
};

const reduceMarkActivity = (params: {
  state: RuntimeEventCoordinatorState;
  agentId: string;
  at: number;
}): ReduceResult => {
  const lastAt = params.state.lastActivityMarkByAgent.get(params.agentId) ?? 0;
  if (params.at - lastAt < MARK_ACTIVITY_THROTTLE_MS) {
    return { state: params.state, effects: [] };
  }
  const nextLastActivity = new Map(params.state.lastActivityMarkByAgent);
  nextLastActivity.set(params.agentId, params.at);
  return {
    state: {
      ...params.state,
      lastActivityMarkByAgent: nextLastActivity,
    },
    effects: [
      {
        kind: "dispatch",
        action: {
          type: "markActivity",
          agentId: params.agentId,
          at: params.at,
        },
      },
    ],
  };
};

export function reduceMarkActivityThrottled(params: {
  state: RuntimeEventCoordinatorState;
  agentId: string;
  at: number;
}): ReduceResult {
  return reduceMarkActivity(params);
}

export function createRuntimeEventCoordinatorState(): RuntimeEventCoordinatorState {
  return {
    runtimeTerminalState: createRuntimeTerminalState(),
    chatRunSeen: new Set<string>(),
    assistantStreamByRun: new Map<string, string>(),
    thinkingStreamByRun: new Map<string, string>(),
    thinkingStartedAtByRun: new Map<string, number>(),
    toolLinesSeenByRun: new Map<string, Set<string>>(),
    historyRefreshRequestedByRun: new Set<string>(),
    thinkingDebugBySession: new Set<string>(),
    lastActivityMarkByAgent: new Map<string, number>(),
  };
}

export function markChatRunSeen(
  state: RuntimeEventCoordinatorState,
  runId?: string | null
): RuntimeEventCoordinatorState {
  const key = toRunId(runId);
  if (!key) return state;
  if (state.chatRunSeen.has(key)) return state;
  const nextChatRunSeen = new Set(state.chatRunSeen);
  nextChatRunSeen.add(key);
  return {
    ...state,
    chatRunSeen: nextChatRunSeen,
  };
}

export function reduceClearRunTracking(params: {
  state: RuntimeEventCoordinatorState;
  runId?: string | null;
}): ReduceResult {
  return clearRunTrackingState(params.state, params.runId);
}

export function pruneRuntimeEventCoordinatorState(params: {
  state: RuntimeEventCoordinatorState;
  at: number;
}): ReduceResult {
  const pruned = pruneClosedRuns(params.state.runtimeTerminalState, { at: params.at });
  if (pruned.expiredRunIds.length === 0) {
    return { state: params.state, effects: [] };
  }
  const effects: RuntimeCoordinatorEffectCommand[] = pruned.expiredRunIds.map((runId) => ({
    kind: "cancelLifecycleFallback",
    runId,
  }));
  return {
    state: {
      ...params.state,
      runtimeTerminalState: pruned.state,
    },
    effects,
  };
}

export function reduceRuntimePolicyIntents(params: {
  state: RuntimeEventCoordinatorState;
  intents: RuntimePolicyIntent[];
  nowMs: number;
  agentForLatestUpdate?: AgentState;
  options?: ReduceOptions;
}): ReduceResult {
  let nextState = params.state;
  const effects: RuntimeCoordinatorEffectCommand[] = [];
  const closedRunTtlMs = params.options?.closedRunTtlMs ?? CLOSED_RUN_TTL_MS;

  for (const intent of params.intents) {
    if (intent.kind === "ignore") {
      continue;
    }
    if (intent.kind === "clearRunTracking") {
      const cleared = clearRunTrackingState(nextState, intent.runId);
      nextState = cleared.state;
      effects.push(...cleared.effects);
      continue;
    }
    if (intent.kind === "markRunClosed") {
      nextState = {
        ...nextState,
        runtimeTerminalState: markClosedRun(nextState.runtimeTerminalState, {
          runId: intent.runId,
          now: params.nowMs,
          ttlMs: closedRunTtlMs,
        }),
      };
      continue;
    }
    if (intent.kind === "markThinkingStarted") {
      if (!nextState.thinkingStartedAtByRun.has(intent.runId)) {
        const nextThinkingStartedAtByRun = new Map(nextState.thinkingStartedAtByRun);
        nextThinkingStartedAtByRun.set(intent.runId, intent.at);
        nextState = {
          ...nextState,
          thinkingStartedAtByRun: nextThinkingStartedAtByRun,
        };
      }
      continue;
    }
    if (intent.kind === "clearPendingLivePatch") {
      effects.push({ kind: "clearPendingLivePatch", agentId: intent.agentId });
      continue;
    }
    if (intent.kind === "queueLivePatch") {
      effects.push({
        kind: "queueLivePatch",
        agentId: intent.agentId,
        patch: intent.patch,
      });
      continue;
    }
    if (intent.kind === "dispatchUpdateAgent") {
      effects.push({
        kind: "dispatch",
        action: {
          type: "updateAgent",
          agentId: intent.agentId,
          patch: intent.patch,
        },
      });
      continue;
    }
    if (intent.kind === "requestHistoryRefresh") {
      effects.push({
        kind: "requestHistoryRefresh",
        agentId: intent.agentId,
        reason: intent.reason,
        deferMs: 0,
      });
      continue;
    }
    if (intent.kind === "queueLatestUpdate") {
      const agentSnapshot =
        params.agentForLatestUpdate?.agentId === intent.agentId
          ? params.agentForLatestUpdate
          : undefined;
      effects.push({
        kind: "updateSpecialLatest",
        agentId: intent.agentId,
        message: intent.message,
        agentSnapshot,
      });
      continue;
    }
    if (intent.kind === "scheduleSummaryRefresh") {
      effects.push({
        kind: "scheduleSummaryRefresh",
        delayMs: intent.delayMs,
        includeHeartbeatRefresh: intent.includeHeartbeatRefresh,
      });
    }
  }

  return { state: nextState, effects };
}

export function reduceRuntimeChatWorkflowCommands(params: {
  state: RuntimeEventCoordinatorState;
  payload: ChatEventPayload;
  agentId: string;
  agent: AgentState | undefined;
  commands: RuntimeChatWorkflowCommand[];
  nowMs: number;
  options?: ReduceOptions;
}): ReduceResult {
  let nextState = params.state;
  const effects: RuntimeCoordinatorEffectCommand[] = [];
  const closedRunTtlMs = params.options?.closedRunTtlMs ?? CLOSED_RUN_TTL_MS;

  for (const command of params.commands) {
    if (command.kind === "applyChatTerminalDecision") {
      nextState = {
        ...nextState,
        runtimeTerminalState: command.decision.state,
      };
      const terminalReduced = applyRuntimeTerminalCommands({
        state: nextState,
        commands: command.decision.commands,
        nowMs: params.nowMs,
        closedRunTtlMs,
      });
      nextState = terminalReduced.state;
      effects.push(...terminalReduced.effects);
      continue;
    }
    if (command.kind === "logMetric") {
      effects.push({ kind: "logMetric", metric: command.metric, meta: command.meta });
      continue;
    }
    if (command.kind === "markThinkingDebugSession") {
      if (!nextState.thinkingDebugBySession.has(command.sessionKey)) {
        const nextThinkingDebugBySession = new Set(nextState.thinkingDebugBySession);
        nextThinkingDebugBySession.add(command.sessionKey);
        nextState = {
          ...nextState,
          thinkingDebugBySession: nextThinkingDebugBySession,
        };
      }
      continue;
    }
    if (command.kind === "logWarn") {
      effects.push({ kind: "logWarn", message: command.message, meta: command.meta });
      continue;
    }
    if (command.kind === "appendOutput") {
      effects.push({
        kind: "dispatch",
        action: {
          type: "appendOutput",
          agentId: params.agentId,
          line: command.line,
          transcript: command.transcript,
        },
      });
      continue;
    }
    if (command.kind === "appendToolLines") {
      const toolLinesReduced = appendToolLinesEffects({
        state: nextState,
        agentId: params.agentId,
        runId: params.payload.runId ?? null,
        sessionKey: params.payload.sessionKey,
        source: "runtime-chat",
        timestampMs: command.timestampMs,
        lines: command.lines,
      });
      nextState = toolLinesReduced.state;
      effects.push(...toolLinesReduced.effects);
      continue;
    }
    if (command.kind === "applyTerminalCommit") {
      nextState = {
        ...nextState,
        runtimeTerminalState: applyTerminalCommit(nextState.runtimeTerminalState, {
          runId: command.runId,
          source: "chat-final",
          seq: command.seq,
        }),
      };
      continue;
    }
    if (command.kind === "appendAbortedIfNotSuppressed") {
      effects.push({
        kind: "appendAbortedIfNotSuppressed",
        agentId: params.agentId,
        runId: params.payload.runId ?? null,
        sessionKey: params.payload.sessionKey,
        stopReason: params.payload.stopReason?.trim() ?? null,
        timestampMs: command.timestampMs,
      });
      continue;
    }
    if (command.kind === "applyPolicyIntents") {
      const policyReduced = reduceRuntimePolicyIntents({
        state: nextState,
        intents: command.intents,
        nowMs: params.nowMs,
        agentForLatestUpdate: params.agent,
        options: { closedRunTtlMs },
      });
      nextState = policyReduced.state;
      effects.push(...policyReduced.effects);
      continue;
    }
  }

  return { state: nextState, effects };
}

export function reduceRuntimeAgentWorkflowCommands(params: {
  state: RuntimeEventCoordinatorState;
  payload: AgentEventPayload;
  agentId: string;
  agent: AgentState;
  commands: RuntimeAgentWorkflowCommand[];
  nowMs: number;
  options?: ReduceOptions;
}): ReduceResult {
  let nextState = params.state;
  const effects: RuntimeCoordinatorEffectCommand[] = [];
  const closedRunTtlMs = params.options?.closedRunTtlMs ?? CLOSED_RUN_TTL_MS;

  for (const command of params.commands) {
    if (command.kind === "applyPolicyIntents") {
      const policyReduced = reduceRuntimePolicyIntents({
        state: nextState,
        intents: command.intents,
        nowMs: params.nowMs,
        options: { closedRunTtlMs },
      });
      nextState = policyReduced.state;
      effects.push(...policyReduced.effects);
      continue;
    }
    if (command.kind === "logMetric") {
      effects.push({ kind: "logMetric", metric: command.metric, meta: command.meta });
      continue;
    }
    if (command.kind === "markActivity") {
      const activityReduced = reduceMarkActivity({
        state: nextState,
        agentId: params.agentId,
        at: command.at,
      });
      nextState = activityReduced.state;
      effects.push(...activityReduced.effects);
      continue;
    }
    if (command.kind === "setThinkingStreamRaw") {
      const nextThinkingStreamByRun = new Map(nextState.thinkingStreamByRun);
      nextThinkingStreamByRun.set(command.runId, command.raw);
      nextState = {
        ...nextState,
        thinkingStreamByRun: nextThinkingStreamByRun,
      };
      continue;
    }
    if (command.kind === "setAssistantStreamRaw") {
      const nextAssistantStreamByRun = new Map(nextState.assistantStreamByRun);
      nextAssistantStreamByRun.set(command.runId, command.raw);
      nextState = {
        ...nextState,
        assistantStreamByRun: nextAssistantStreamByRun,
      };
      continue;
    }
    if (command.kind === "markThinkingStarted") {
      if (!nextState.thinkingStartedAtByRun.has(command.runId)) {
        const nextThinkingStartedAtByRun = new Map(nextState.thinkingStartedAtByRun);
        nextThinkingStartedAtByRun.set(command.runId, command.at);
        nextState = {
          ...nextState,
          thinkingStartedAtByRun: nextThinkingStartedAtByRun,
        };
      }
      continue;
    }
    if (command.kind === "queueAgentPatch") {
      effects.push({
        kind: "queueLivePatch",
        agentId: params.agentId,
        patch: command.patch,
      });
      continue;
    }
    if (command.kind === "appendToolLines") {
      const toolLinesReduced = appendToolLinesEffects({
        state: nextState,
        agentId: params.agentId,
        runId: params.payload.runId ?? null,
        sessionKey: params.payload.sessionKey ?? params.agent.sessionKey,
        source: "runtime-agent",
        timestampMs: command.timestampMs,
        lines: command.lines,
      });
      nextState = toolLinesReduced.state;
      effects.push(...toolLinesReduced.effects);
      continue;
    }
    if (command.kind === "markHistoryRefreshRequested") {
      const nextHistoryRefreshRequestedByRun = new Set(nextState.historyRefreshRequestedByRun);
      nextHistoryRefreshRequestedByRun.add(command.runId);
      nextState = {
        ...nextState,
        historyRefreshRequestedByRun: nextHistoryRefreshRequestedByRun,
      };
      continue;
    }
    if (command.kind === "scheduleHistoryRefresh") {
      effects.push({
        kind: "requestHistoryRefresh",
        agentId: params.agentId,
        reason: command.reason,
        deferMs: command.delayMs,
      });
      continue;
    }
    if (command.kind === "applyLifecycleDecision") {
      if (command.shouldClearPendingLivePatch) {
        effects.push({
          kind: "clearPendingLivePatch",
          agentId: params.agentId,
        });
      }

      nextState = {
        ...nextState,
        runtimeTerminalState: command.decision.state,
      };

      const terminalReduced = applyRuntimeTerminalCommands({
        state: nextState,
        commands: command.decision.commands,
        nowMs: params.nowMs,
        closedRunTtlMs,
        onScheduleLifecycleFallback: (scheduledCommand) => ({
          kind: "scheduleLifecycleFallback",
          runId: scheduledCommand.runId,
          delayMs: scheduledCommand.delayMs,
          agentId: params.agentId,
          sessionKey: params.payload.sessionKey ?? params.agent.sessionKey,
          finalText: scheduledCommand.finalText,
          transitionPatch: command.transitionPatch,
        }),
      });

      nextState = terminalReduced.state;
      effects.push(...terminalReduced.effects);

      if (!command.decision.deferTransitionPatch) {
        effects.push({
          kind: "dispatch",
          action: {
            type: "updateAgent",
            agentId: params.agentId,
            patch: command.transitionPatch,
          },
        });
      }
    }
  }

  return { state: nextState, effects };
}

export function reduceLifecycleFallbackFired(params: {
  state: RuntimeEventCoordinatorState;
  runId: string;
  agentId: string;
  sessionKey: string;
  finalText: string;
  transitionPatch: Partial<AgentState>;
  nowMs: number;
  options?: ReduceOptions;
}): ReduceResult {
  const closedRunTtlMs = params.options?.closedRunTtlMs ?? CLOSED_RUN_TTL_MS;
  let nextState = params.state;
  const effects: RuntimeCoordinatorEffectCommand[] = [];
  const runId = toRunId(params.runId);
  if (!runId) return { state: nextState, effects };

  const fallbackDecision = deriveLifecycleTerminalDecision({
    mode: "fallback-fired",
    state: nextState.runtimeTerminalState,
    runId,
  });
  nextState = {
    ...nextState,
    runtimeTerminalState: fallbackDecision.state,
  };

  if (!fallbackDecision.shouldCommitFallback) {
    return { state: nextState, effects };
  }

  const assistantCompletionAt = params.nowMs;
  const startedAt = nextState.thinkingStartedAtByRun.get(runId);
  const thinkingDurationMs =
    typeof startedAt === "number"
      ? Math.max(0, assistantCompletionAt - startedAt)
      : null;

  effects.push({
    kind: "dispatch",
    action: {
      type: "appendOutput",
      agentId: params.agentId,
      line: formatMetaMarkdown({
        role: "assistant",
        timestamp: assistantCompletionAt,
        thinkingDurationMs,
      }),
      transcript: {
        source: "runtime-agent",
        runId,
        sessionKey: params.sessionKey,
        timestampMs: assistantCompletionAt,
        role: "assistant",
        kind: "meta",
        entryId: terminalAssistantMetaEntryId(runId),
        confirmed: false,
      },
    },
  });

  if (params.finalText) {
    effects.push({
      kind: "dispatch",
      action: {
        type: "appendOutput",
        agentId: params.agentId,
        line: params.finalText,
        transcript: {
          source: "runtime-agent",
          runId,
          sessionKey: params.sessionKey,
          timestampMs: assistantCompletionAt,
          role: "assistant",
          kind: "assistant",
          entryId: terminalAssistantFinalEntryId(runId),
          confirmed: false,
        },
      },
    });
  }

  effects.push({
    kind: "dispatch",
    action: {
      type: "updateAgent",
      agentId: params.agentId,
      patch: {
        lastResult: params.finalText,
        lastAssistantMessageAt: assistantCompletionAt,
      },
    },
  });

  nextState = {
    ...nextState,
    runtimeTerminalState: applyTerminalCommit(nextState.runtimeTerminalState, {
      runId,
      source: "lifecycle-fallback",
      seq: null,
    }),
  };

  const terminalReduced = applyRuntimeTerminalCommands({
    state: nextState,
    commands: fallbackDecision.commands,
    nowMs: params.nowMs,
    closedRunTtlMs,
  });
  nextState = terminalReduced.state;
  effects.push(...terminalReduced.effects);

  effects.push({
    kind: "dispatch",
    action: {
      type: "updateAgent",
      agentId: params.agentId,
      patch: params.transitionPatch,
    },
  });

  return { state: nextState, effects };
}
