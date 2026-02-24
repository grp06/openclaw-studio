export type RuntimeTerminalCommitSource = "chat-final" | "lifecycle-fallback";

export type RuntimeTerminalRunState = {
  chatFinalSeen: boolean;
  terminalCommitted: boolean;
  lastTerminalSeq: number | null;
  commitSource: RuntimeTerminalCommitSource | null;
};

export type RuntimeTerminalState = {
  runStateByRun: ReadonlyMap<string, RuntimeTerminalRunState>;
  closedRunExpiresByRun: ReadonlyMap<string, number>;
};

export type RuntimeTerminalCommand =
  | { kind: "scheduleLifecycleFallback"; runId: string; delayMs: number; finalText: string }
  | { kind: "cancelLifecycleFallback"; runId: string }
  | { kind: "clearRunTerminalState"; runId: string }
  | { kind: "markRunClosed"; runId: string }
  | { kind: "clearRunTracking"; runId: string };

export type ChatTerminalDecision = {
  state: RuntimeTerminalState;
  commands: RuntimeTerminalCommand[];
  isStaleTerminal: boolean;
  fallbackCommittedBeforeFinal: boolean;
  lastTerminalSeqBeforeFinal: number | null;
  commitSourceBeforeFinal: RuntimeTerminalCommitSource | null;
};

type LifecycleTerminalEventDecisionInput = {
  mode: "event";
  state: RuntimeTerminalState;
  runId?: string | null;
  phase: string;
  hasPendingFallbackTimer: boolean;
  fallbackDelayMs: number;
  fallbackFinalText: string | null;
  transitionClearsRunTracking: boolean;
};

type LifecycleTerminalFallbackFireDecisionInput = {
  mode: "fallback-fired";
  state: RuntimeTerminalState;
  runId?: string | null;
};

export type LifecycleTerminalDecisionInput =
  | LifecycleTerminalEventDecisionInput
  | LifecycleTerminalFallbackFireDecisionInput;

export type LifecycleTerminalDecision = {
  state: RuntimeTerminalState;
  commands: RuntimeTerminalCommand[];
  shouldCommitFallback: boolean;
  deferTransitionPatch: boolean;
};

const emptyRunState = (): RuntimeTerminalRunState => ({
  chatFinalSeen: false,
  terminalCommitted: false,
  lastTerminalSeq: null,
  commitSource: null,
});

const normalizeRunId = (runId?: string | null): string => runId?.trim() ?? "";

const ensureRunState = (
  state: RuntimeTerminalState,
  runId: string
): { state: RuntimeTerminalState; runState: RuntimeTerminalRunState } => {
  const existing = state.runStateByRun.get(runId);
  if (existing) return { state, runState: existing };
  const runStateByRun = new Map(state.runStateByRun);
  const created = emptyRunState();
  runStateByRun.set(runId, created);
  return {
    state: {
      runStateByRun,
      closedRunExpiresByRun: state.closedRunExpiresByRun,
    },
    runState: created,
  };
};

export const clearRunTerminalState = (
  state: RuntimeTerminalState,
  input: { runId?: string | null }
): RuntimeTerminalState => {
  const runId = normalizeRunId(input.runId);
  if (!runId) return state;
  if (!state.runStateByRun.has(runId)) return state;
  const runStateByRun = new Map(state.runStateByRun);
  runStateByRun.delete(runId);
  return {
    runStateByRun,
    closedRunExpiresByRun: state.closedRunExpiresByRun,
  };
};

export const createRuntimeTerminalState = (): RuntimeTerminalState => ({
  runStateByRun: new Map<string, RuntimeTerminalRunState>(),
  closedRunExpiresByRun: new Map<string, number>(),
});

export const applyTerminalCommit = (
  state: RuntimeTerminalState,
  input: {
    runId: string;
    source: RuntimeTerminalCommitSource;
    seq: number | null;
  }
): RuntimeTerminalState => {
  const runId = normalizeRunId(input.runId);
  if (!runId) return state;
  const current = state.runStateByRun.get(runId) ?? emptyRunState();
  const next: RuntimeTerminalRunState = {
    ...current,
    terminalCommitted: true,
    commitSource: input.source,
    chatFinalSeen: input.source === "chat-final" ? true : current.chatFinalSeen,
    lastTerminalSeq:
      typeof input.seq === "number" ? input.seq : current.lastTerminalSeq,
  };
  const runStateByRun = new Map(state.runStateByRun);
  runStateByRun.set(runId, next);
  return {
    runStateByRun,
    closedRunExpiresByRun: state.closedRunExpiresByRun,
  };
};

export const deriveChatTerminalDecision = (input: {
  state: RuntimeTerminalState;
  runId?: string | null;
  isFinal: boolean;
  seq: number | null;
}): ChatTerminalDecision => {
  const runId = normalizeRunId(input.runId);
  if (!input.isFinal || !runId) {
    return {
      state: input.state,
      commands: [],
      isStaleTerminal: false,
      fallbackCommittedBeforeFinal: false,
      lastTerminalSeqBeforeFinal: null,
      commitSourceBeforeFinal: null,
    };
  }

  const ensured = ensureRunState(input.state, runId);
  const runState = ensured.runState;
  const fallbackCommittedBeforeFinal =
    runState.terminalCommitted && runState.commitSource === "lifecycle-fallback";
  const isStaleTerminal = (() => {
    if (!runState.terminalCommitted) return false;
    if (typeof input.seq !== "number") {
      return runState.commitSource === "chat-final";
    }
    if (typeof runState.lastTerminalSeq !== "number") return false;
    return input.seq <= runState.lastTerminalSeq;
  })();
  const runStateByRun = new Map(ensured.state.runStateByRun);
  runStateByRun.set(runId, {
    ...runState,
    chatFinalSeen: true,
  });
  return {
    state: {
      runStateByRun,
      closedRunExpiresByRun: ensured.state.closedRunExpiresByRun,
    },
    commands: [{ kind: "cancelLifecycleFallback", runId }],
    isStaleTerminal,
    fallbackCommittedBeforeFinal,
    lastTerminalSeqBeforeFinal: runState.lastTerminalSeq,
    commitSourceBeforeFinal: runState.commitSource,
  };
};

export const deriveLifecycleTerminalDecision = (
  input: LifecycleTerminalDecisionInput
): LifecycleTerminalDecision => {
  const runId = normalizeRunId(input.runId);
  if (!runId) {
    return {
      state: input.state,
      commands: [],
      shouldCommitFallback: false,
      deferTransitionPatch: false,
    };
  }

  if (input.mode === "fallback-fired") {
    const runState = input.state.runStateByRun.get(runId);
    if (!runState || runState.chatFinalSeen) {
      return {
        state: input.state,
        commands: [],
        shouldCommitFallback: false,
        deferTransitionPatch: false,
      };
    }
    return {
      state: input.state,
      commands: [
        { kind: "markRunClosed", runId },
        { kind: "clearRunTracking", runId },
      ],
      shouldCommitFallback: true,
      deferTransitionPatch: false,
    };
  }

  const ensured = ensureRunState(input.state, runId);
  const runState = ensured.runState;
  const commands: RuntimeTerminalCommand[] = [];
  let state = ensured.state;
  let deferTransitionPatch = false;

  const shouldScheduleFallback = input.phase === "end" && !runState.chatFinalSeen;
  if (shouldScheduleFallback) {
    if (input.fallbackFinalText) {
      commands.push({ kind: "cancelLifecycleFallback", runId });
      commands.push({
        kind: "scheduleLifecycleFallback",
        runId,
        delayMs: input.fallbackDelayMs,
        finalText: input.fallbackFinalText,
      });
      deferTransitionPatch = true;
    } else {
      commands.push({ kind: "clearRunTerminalState", runId });
      state = clearRunTerminalState(state, { runId });
    }
  } else if (input.hasPendingFallbackTimer) {
    commands.push({ kind: "cancelLifecycleFallback", runId });
    if (!runState.terminalCommitted && !runState.chatFinalSeen) {
      commands.push({ kind: "clearRunTerminalState", runId });
      state = clearRunTerminalState(state, { runId });
    }
  }

  if (input.transitionClearsRunTracking && !deferTransitionPatch) {
    commands.push({ kind: "markRunClosed", runId });
    commands.push({ kind: "clearRunTracking", runId });
  }

  return {
    state,
    commands,
    shouldCommitFallback: false,
    deferTransitionPatch,
  };
};

export const markClosedRun = (
  state: RuntimeTerminalState,
  input: { runId?: string | null; now: number; ttlMs: number }
): RuntimeTerminalState => {
  const runId = normalizeRunId(input.runId);
  if (!runId) return state;
  const closedRunExpiresByRun = new Map(state.closedRunExpiresByRun);
  closedRunExpiresByRun.set(runId, input.now + input.ttlMs);
  return {
    runStateByRun: state.runStateByRun,
    closedRunExpiresByRun,
  };
};

export const pruneClosedRuns = (
  state: RuntimeTerminalState,
  input: { at: number }
): { state: RuntimeTerminalState; expiredRunIds: string[] } => {
  const expiredRunIds: string[] = [];
  const closedRunExpiresByRun = new Map(state.closedRunExpiresByRun);
  for (const [runId, expiresAt] of closedRunExpiresByRun.entries()) {
    if (expiresAt <= input.at) {
      closedRunExpiresByRun.delete(runId);
      expiredRunIds.push(runId);
    }
  }
  if (expiredRunIds.length === 0) {
    return { state, expiredRunIds };
  }
  const runStateByRun = new Map(state.runStateByRun);
  for (const runId of expiredRunIds) {
    runStateByRun.delete(runId);
  }
  return {
    state: {
      runStateByRun,
      closedRunExpiresByRun,
    },
    expiredRunIds,
  };
};

export const isClosedRun = (state: RuntimeTerminalState, runId?: string | null): boolean => {
  const key = normalizeRunId(runId);
  if (!key) return false;
  return state.closedRunExpiresByRun.has(key);
};
