import type { AgentState } from "@/features/agents/state/store";
import {
  logTranscriptDebugMetric,
  type TranscriptAppendMeta,
} from "@/features/agents/state/transcript";
import {
  classifyGatewayEventKind,
  dedupeRunLines,
  getAgentSummaryPatch,
  getChatSummaryPatch,
  isReasoningRuntimeAgentStream,
  mergeRuntimeStream,
  resolveLifecyclePatch,
  resolveAssistantCompletionTimestamp,
  shouldPublishAssistantStream,
  type AgentEventPayload,
  type ChatEventPayload,
} from "@/features/agents/state/runtimeEventBridge";
import { type EventFrame, isSameSessionKey } from "@/lib/gateway/GatewayClient";
import {
  extractText,
  extractThinking,
  extractThinkingFromTaggedStream,
  extractToolLines,
  formatMetaMarkdown,
  formatThinkingMarkdown,
  formatToolCallMarkdown,
  isTraceMarkdown,
  isUiMetadataPrefix,
  stripUiMetadata,
} from "@/lib/text/message-extract";

type RuntimeDispatchAction =
  | { type: "updateAgent"; agentId: string; patch: Partial<AgentState> }
  | { type: "appendOutput"; agentId: string; line: string; transcript?: TranscriptAppendMeta }
  | { type: "markActivity"; agentId: string; at?: number };

export type GatewayRuntimeEventHandlerDeps = {
  getStatus: () => "disconnected" | "connecting" | "connected";
  getAgents: () => AgentState[];
  dispatch: (action: RuntimeDispatchAction) => void;
  queueLivePatch: (agentId: string, patch: Partial<AgentState>) => void;
  clearPendingLivePatch: (agentId: string) => void;
  now?: () => number;

  loadSummarySnapshot: () => Promise<void>;
  requestHistoryRefresh: (command: {
    agentId: string;
    reason: "chat-final-no-trace";
  }) => Promise<void> | void;
  refreshHeartbeatLatestUpdate: () => void;
  bumpHeartbeatTick: () => void;

  setTimeout: (fn: () => void, delayMs: number) => number;
  clearTimeout: (id: number) => void;

  isDisconnectLikeError: (err: unknown) => boolean;
  logWarn?: (message: string, meta?: unknown) => void;

  updateSpecialLatestUpdate: (agentId: string, agent: AgentState, message: string) => void;
};

export type GatewayRuntimeEventHandler = {
  handleEvent: (event: EventFrame) => void;
  clearRunTracking: (runId?: string | null) => void;
  dispose: () => void;
};

const findAgentBySessionKey = (agents: AgentState[], sessionKey: string): string | null => {
  const exact = agents.find((agent) => isSameSessionKey(agent.sessionKey, sessionKey));
  return exact ? exact.agentId : null;
};

const findAgentByRunId = (agents: AgentState[], runId: string): string | null => {
  const match = agents.find((agent) => agent.runId === runId);
  return match ? match.agentId : null;
};

const resolveRole = (message: unknown) =>
  message && typeof message === "object"
    ? (message as Record<string, unknown>).role
    : null;

const summarizeThinkingMessage = (message: unknown) => {
  if (!message || typeof message !== "object") {
    return { type: typeof message };
  }
  const record = message as Record<string, unknown>;
  const summary: Record<string, unknown> = { keys: Object.keys(record) };
  const content = record.content;
  if (Array.isArray(content)) {
    summary.contentTypes = content.map((item) => {
      if (item && typeof item === "object") {
        const entry = item as Record<string, unknown>;
        return typeof entry.type === "string" ? entry.type : "object";
      }
      return typeof item;
    });
  } else if (typeof content === "string") {
    summary.contentLength = content.length;
  }
  if (typeof record.text === "string") {
    summary.textLength = record.text.length;
  }
  for (const key of ["analysis", "reasoning", "thinking"]) {
    const value = record[key];
    if (typeof value === "string") {
      summary[`${key}Length`] = value.length;
    } else if (value && typeof value === "object") {
      summary[`${key}Keys`] = Object.keys(value as Record<string, unknown>);
    }
  }
  return summary;
};

const extractReasoningBody = (value: string): string | null => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/^reasoning:\s*([\s\S]*)$/i);
  if (!match) return null;
  const body = (match[1] ?? "").trim();
  return body || null;
};

const resolveThinkingFromAgentStream = (
  data: Record<string, unknown> | null,
  rawStream: string,
  opts?: { treatPlainTextAsThinking?: boolean }
): string | null => {
  if (data) {
    const extracted = extractThinking(data);
    if (extracted) return extracted;
    const text = typeof data.text === "string" ? data.text : "";
    const delta = typeof data.delta === "string" ? data.delta : "";
    const prefixed = extractReasoningBody(text) ?? extractReasoningBody(delta);
    if (prefixed) return prefixed;
    if (opts?.treatPlainTextAsThinking) {
      const cleanedDelta = delta.trim();
      if (cleanedDelta) return cleanedDelta;
      const cleanedText = text.trim();
      if (cleanedText) return cleanedText;
    }
  }
  const tagged = extractThinkingFromTaggedStream(rawStream);
  return tagged || null;
};

export function createGatewayRuntimeEventHandler(
  deps: GatewayRuntimeEventHandlerDeps
): GatewayRuntimeEventHandler {
  const now = deps.now ?? (() => Date.now());
  const CLOSED_RUN_TTL_MS = 30_000;
  const chatRunSeen = new Set<string>();
  const assistantStreamByRun = new Map<string, string>();
  const thinkingStreamByRun = new Map<string, string>();
  const thinkingStartedAtByRun = new Map<string, number>();
  const toolLinesSeenByRun = new Map<string, Set<string>>();
  const closedRunExpiresByRun = new Map<string, number>();
  const terminalChatRunSeen = new Set<string>();
  const thinkingDebugBySession = new Set<string>();
  const lastActivityMarkByAgent = new Map<string, number>();

  let summaryRefreshTimer: number | null = null;

  const dispatchOutput = (
    agentId: string,
    line: string,
    transcript?: TranscriptAppendMeta
  ) => {
    deps.dispatch({ type: "appendOutput", agentId, line, transcript });
  };

  const pruneClosedRuns = (at: number = now()) => {
    for (const [runId, expiresAt] of closedRunExpiresByRun.entries()) {
      if (expiresAt <= at) {
        closedRunExpiresByRun.delete(runId);
      }
    }
  };

  const markRunClosed = (runId?: string | null) => {
    const key = runId?.trim() ?? "";
    if (!key) return;
    closedRunExpiresByRun.set(key, now() + CLOSED_RUN_TTL_MS);
  };

  const isClosedRun = (runId?: string | null) => {
    const key = runId?.trim() ?? "";
    if (!key) return false;
    const expiresAt = closedRunExpiresByRun.get(key);
    if (typeof expiresAt !== "number") return false;
    if (expiresAt <= now()) {
      closedRunExpiresByRun.delete(key);
      return false;
    }
    return true;
  };

  const appendUniqueToolLines = (params: {
    agentId: string;
    runId: string | null | undefined;
    sessionKey: string | null | undefined;
    source: "runtime-chat" | "runtime-agent";
    timestampMs?: number;
    lines: string[];
  }) => {
    const { agentId, runId, sessionKey, source, timestampMs, lines } = params;
    if (lines.length === 0) return;
    if (!runId) {
      for (const line of lines) {
        dispatchOutput(agentId, line, {
          source,
          runId: null,
          sessionKey: sessionKey ?? undefined,
          timestampMs,
          kind: "tool",
          role: "tool",
        });
      }
      return;
    }
    const current = toolLinesSeenByRun.get(runId) ?? new Set<string>();
    const { appended, nextSeen } = dedupeRunLines(current, lines);
    toolLinesSeenByRun.set(runId, nextSeen);
    for (const line of appended) {
      dispatchOutput(agentId, line, {
        source,
        runId,
        sessionKey: sessionKey ?? undefined,
        timestampMs,
        kind: "tool",
        role: "tool",
      });
    }
  };

  const clearRunTracking = (runId?: string | null) => {
    if (!runId) return;
    chatRunSeen.delete(runId);
    assistantStreamByRun.delete(runId);
    thinkingStreamByRun.delete(runId);
    thinkingStartedAtByRun.delete(runId);
    toolLinesSeenByRun.delete(runId);
  };

  const markTerminalRunSeen = (runId: string) => {
    terminalChatRunSeen.add(runId);
    if (terminalChatRunSeen.size <= 512) return;
    while (terminalChatRunSeen.size > 384) {
      const first = terminalChatRunSeen.values().next();
      if (first.done) break;
      terminalChatRunSeen.delete(first.value);
    }
  };

  const markActivityThrottled = (agentId: string, at: number = now()) => {
    const lastAt = lastActivityMarkByAgent.get(agentId) ?? 0;
    if (at - lastAt < 300) return;
    lastActivityMarkByAgent.set(agentId, at);
    deps.dispatch({ type: "markActivity", agentId, at });
  };

  const logWarn =
    deps.logWarn ??
    ((message: string, meta?: unknown) => {
      console.warn(message, meta);
    });
  const clearPendingLivePatch = deps.clearPendingLivePatch;

  const dispose = () => {
    if (summaryRefreshTimer !== null) {
      deps.clearTimeout(summaryRefreshTimer);
      summaryRefreshTimer = null;
    }
    chatRunSeen.clear();
    assistantStreamByRun.clear();
    thinkingStreamByRun.clear();
    toolLinesSeenByRun.clear();
    closedRunExpiresByRun.clear();
    terminalChatRunSeen.clear();
    thinkingDebugBySession.clear();
    lastActivityMarkByAgent.clear();
  };

  const handleRuntimeChatEvent = (payload: ChatEventPayload) => {
    if (!payload.sessionKey) return;
    pruneClosedRuns();
    if (
      payload.runId &&
      payload.state === "delta" &&
      isClosedRun(payload.runId)
    ) {
      logTranscriptDebugMetric("late_event_ignored_closed_run", {
        stream: "chat",
        state: payload.state,
        runId: payload.runId,
      });
      return;
    }

    if (payload.runId) {
      chatRunSeen.add(payload.runId);
    }

    const agentsSnapshot = deps.getAgents();
    const agentId = findAgentBySessionKey(agentsSnapshot, payload.sessionKey);
    if (!agentId) return;
    const agent = agentsSnapshot.find((entry) => entry.agentId === agentId);
    const activeRunId = agent?.runId?.trim() ?? "";
    const role = resolveRole(payload.message);

    if (payload.runId && activeRunId && activeRunId !== payload.runId) {
      clearRunTracking(payload.runId);
      return;
    }
    if (!activeRunId && agent?.status !== "running" && payload.state === "delta" && role !== "user" && role !== "system") {
      clearRunTracking(payload.runId ?? null);
      return;
    }
    const summaryPatch = getChatSummaryPatch(payload, now());
    if (summaryPatch) {
      deps.dispatch({
        type: "updateAgent",
        agentId,
        patch: {
          ...summaryPatch,
          sessionCreated: true,
        },
      });
    }

    if (role === "user" || role === "system") {
      return;
    }

    markActivityThrottled(agentId);

    const nextTextRaw = extractText(payload.message);
    const nextText = nextTextRaw ? stripUiMetadata(nextTextRaw) : null;
    const nextThinking = extractThinking(payload.message ?? payload);
    const toolLines = extractToolLines(payload.message ?? payload);
    const isToolRole = role === "tool" || role === "toolResult";

    if (payload.state === "delta") {
      if (typeof nextTextRaw === "string" && isUiMetadataPrefix(nextTextRaw.trim())) {
        return;
      }
      appendUniqueToolLines({
        agentId,
        runId: payload.runId ?? null,
        sessionKey: payload.sessionKey,
        source: "runtime-chat",
        timestampMs: now(),
        lines: toolLines,
      });
      const patch: Partial<AgentState> = {};
      if (nextThinking) {
        if (payload.runId && !thinkingStartedAtByRun.has(payload.runId)) {
          thinkingStartedAtByRun.set(payload.runId, now());
        }
        patch.thinkingTrace = nextThinking;
        patch.status = "running";
      }
      if (typeof nextText === "string") {
        patch.streamText = nextText;
        patch.status = "running";
      }
      if (agent && agent.runStartedAt === null) {
        patch.runStartedAt = now();
      }
      if (Object.keys(patch).length > 0) {
        deps.queueLivePatch(agentId, patch);
      }
      return;
    }

    if (payload.state === "final") {
      if (payload.runId && agent?.runId && agent.runId !== payload.runId) {
        clearRunTracking(payload.runId);
        return;
      }
      if (payload.runId && terminalChatRunSeen.has(payload.runId)) {
        return;
      }
      clearPendingLivePatch(agentId);
      if (payload.runId) {
        markTerminalRunSeen(payload.runId);
      }
      clearRunTracking(payload.runId ?? null);
      markRunClosed(payload.runId ?? null);
      if (!nextThinking && role === "assistant" && !thinkingDebugBySession.has(payload.sessionKey)) {
        thinkingDebugBySession.add(payload.sessionKey);
        logWarn("No thinking trace extracted from chat event.", {
          sessionKey: payload.sessionKey,
          message: summarizeThinkingMessage(payload.message ?? payload),
        });
      }
      const thinkingText = nextThinking ?? agent?.thinkingTrace ?? null;
      const thinkingLine = thinkingText ? formatThinkingMarkdown(thinkingText) : "";
      const assistantCompletionAt = resolveAssistantCompletionTimestamp({
        role,
        state: payload.state,
        message: payload.message,
        now: now(),
      });
      if (role === "assistant") {
        const startedAt = payload.runId ? thinkingStartedAtByRun.get(payload.runId) : undefined;
        const thinkingDurationMs =
          typeof startedAt === "number" && typeof assistantCompletionAt === "number"
            ? Math.max(0, assistantCompletionAt - startedAt)
            : null;
        if (typeof assistantCompletionAt === "number") {
          dispatchOutput(
            agentId,
            formatMetaMarkdown({
              role: "assistant",
              timestamp: assistantCompletionAt,
              thinkingDurationMs,
            }),
            {
              source: "runtime-chat",
              runId: payload.runId ?? null,
              sessionKey: payload.sessionKey,
              timestampMs: assistantCompletionAt,
              role: "assistant",
              kind: "meta",
            }
          );
        }
      }
      if (thinkingLine) {
        dispatchOutput(agentId, thinkingLine, {
          source: "runtime-chat",
          runId: payload.runId ?? null,
          sessionKey: payload.sessionKey,
          timestampMs: assistantCompletionAt ?? now(),
          role: "assistant",
          kind: "thinking",
        });
      }
      appendUniqueToolLines({
        agentId,
        runId: payload.runId ?? null,
        sessionKey: payload.sessionKey,
        source: "runtime-chat",
        timestampMs: assistantCompletionAt ?? now(),
        lines: toolLines,
      });
      if (
        !thinkingLine &&
        role === "assistant" &&
        agent &&
        !agent.outputLines.some((line) => isTraceMarkdown(line.trim()))
      ) {
        void deps.requestHistoryRefresh({
          agentId,
          reason: "chat-final-no-trace",
        });
      }
      if (!isToolRole && typeof nextText === "string") {
        dispatchOutput(agentId, nextText, {
          source: "runtime-chat",
          runId: payload.runId ?? null,
          sessionKey: payload.sessionKey,
          timestampMs: assistantCompletionAt ?? now(),
          role: "assistant",
          kind: "assistant",
        });
        deps.dispatch({
          type: "updateAgent",
          agentId,
          patch: { lastResult: nextText },
        });
      }
      if (agent?.lastUserMessage && !agent.latestOverride) {
        void deps.updateSpecialLatestUpdate(agentId, agent, agent.lastUserMessage);
      }
      const terminalPatch: Partial<AgentState> = {
        streamText: null,
        thinkingTrace: null,
        runStartedAt: null,
        ...(typeof assistantCompletionAt === "number"
          ? { lastAssistantMessageAt: assistantCompletionAt }
          : {}),
      };
      if (payload.runId && agent?.runId === payload.runId) {
        terminalPatch.status = "idle";
        terminalPatch.runId = null;
      }
      deps.dispatch({
        type: "updateAgent",
        agentId,
        patch: terminalPatch,
      });
      return;
    }

    if (payload.state === "aborted") {
      if (payload.runId && agent?.runId && agent.runId !== payload.runId) {
        clearRunTracking(payload.runId);
        return;
      }
      if (payload.runId && terminalChatRunSeen.has(payload.runId)) {
        return;
      }
      clearPendingLivePatch(agentId);
      if (payload.runId) {
        markTerminalRunSeen(payload.runId);
      }
      clearRunTracking(payload.runId ?? null);
      markRunClosed(payload.runId ?? null);
      dispatchOutput(agentId, "Run aborted.", {
        source: "runtime-chat",
        runId: payload.runId ?? null,
        sessionKey: payload.sessionKey,
        timestampMs: now(),
        role: "assistant",
        kind: "assistant",
      });
      const patch: Partial<AgentState> = {
        streamText: null,
        thinkingTrace: null,
        runStartedAt: null,
      };
      if (payload.runId && agent?.runId === payload.runId) {
        patch.status = "idle";
        patch.runId = null;
      }
      deps.dispatch({
        type: "updateAgent",
        agentId,
        patch,
      });
      return;
    }

    if (payload.state === "error") {
      if (payload.runId && agent?.runId && agent.runId !== payload.runId) {
        clearRunTracking(payload.runId);
        return;
      }
      if (payload.runId && terminalChatRunSeen.has(payload.runId)) {
        return;
      }
      clearPendingLivePatch(agentId);
      if (payload.runId) {
        markTerminalRunSeen(payload.runId);
      }
      clearRunTracking(payload.runId ?? null);
      markRunClosed(payload.runId ?? null);
      dispatchOutput(
        agentId,
        payload.errorMessage ? `Error: ${payload.errorMessage}` : "Run error.",
        {
          source: "runtime-chat",
          runId: payload.runId ?? null,
          sessionKey: payload.sessionKey,
          timestampMs: now(),
          role: "assistant",
          kind: "assistant",
        }
      );
      const patch: Partial<AgentState> = {
        streamText: null,
        thinkingTrace: null,
        runStartedAt: null,
      };
      if (payload.runId && agent?.runId === payload.runId) {
        patch.status = "error";
        patch.runId = null;
      }
      deps.dispatch({
        type: "updateAgent",
        agentId,
        patch,
      });
    }
  };

  const handleRuntimeAgentEvent = (payload: AgentEventPayload) => {
    if (!payload.runId) return;
    pruneClosedRuns();
    const agentsSnapshot = deps.getAgents();
    const directMatch = payload.sessionKey ? findAgentBySessionKey(agentsSnapshot, payload.sessionKey) : null;
    const match = directMatch ?? findAgentByRunId(agentsSnapshot, payload.runId);
    if (!match) return;
    const agent = agentsSnapshot.find((entry) => entry.agentId === match);
    if (!agent) return;
    const stream = typeof payload.stream === "string" ? payload.stream : "";
    const data =
      payload.data && typeof payload.data === "object" ? (payload.data as Record<string, unknown>) : null;
    const phase = typeof data?.phase === "string" ? data.phase : "";
    if (!(phase === "start" && payload.stream === "lifecycle") && isClosedRun(payload.runId)) {
      logTranscriptDebugMetric("late_event_ignored_closed_run", {
        stream: payload.stream,
        runId: payload.runId,
      });
      return;
    }
    const activeRunId = agent.runId?.trim() ?? "";

    if (activeRunId && activeRunId !== payload.runId) {
      if (!(stream === "lifecycle" && phase === "start")) {
        clearRunTracking(payload.runId);
        return;
      }
    }
    if (!activeRunId && agent.status !== "running") {
      if (!(stream === "lifecycle" && phase === "start")) {
        clearRunTracking(payload.runId);
        return;
      }
    }

    markActivityThrottled(match);
    const hasChatEvents = chatRunSeen.has(payload.runId);

    if (isReasoningRuntimeAgentStream(stream)) {
      const rawText = typeof data?.text === "string" ? (data.text as string) : "";
      const rawDelta = typeof data?.delta === "string" ? (data.delta as string) : "";
      const previousRaw = thinkingStreamByRun.get(payload.runId) ?? "";
      let mergedRaw = previousRaw;
      if (rawText) {
        mergedRaw = rawText;
      } else if (rawDelta) {
        mergedRaw = mergeRuntimeStream(previousRaw, rawDelta);
      }
      if (mergedRaw) {
        thinkingStreamByRun.set(payload.runId, mergedRaw);
      }
      const liveThinking =
        resolveThinkingFromAgentStream(data, mergedRaw, { treatPlainTextAsThinking: true }) ??
        (mergedRaw.trim() ? mergedRaw.trim() : null);
      if (liveThinking) {
        if (!thinkingStartedAtByRun.has(payload.runId)) {
          thinkingStartedAtByRun.set(payload.runId, now());
        }
        deps.queueLivePatch(match, {
          status: "running",
          runId: payload.runId,
          ...(agent.runStartedAt === null ? { runStartedAt: now() } : {}),
          sessionCreated: true,
          lastActivityAt: now(),
          thinkingTrace: liveThinking,
        });
      }
      return;
    }

    if (stream === "assistant") {
      const rawText = typeof data?.text === "string" ? data.text : "";
      const rawDelta = typeof data?.delta === "string" ? data.delta : "";
      const previousRaw = assistantStreamByRun.get(payload.runId) ?? "";
      let mergedRaw = previousRaw;
      if (rawText) {
        mergedRaw = rawText;
      } else if (rawDelta) {
        mergedRaw = mergeRuntimeStream(previousRaw, rawDelta);
      }
      if (mergedRaw) {
        assistantStreamByRun.set(payload.runId, mergedRaw);
      }
      const liveThinking = resolveThinkingFromAgentStream(data, mergedRaw);
      const patch: Partial<AgentState> = {
        status: "running",
        runId: payload.runId,
        lastActivityAt: now(),
        sessionCreated: true,
      };
      if (liveThinking) {
        if (!thinkingStartedAtByRun.has(payload.runId)) {
          thinkingStartedAtByRun.set(payload.runId, now());
        }
        patch.thinkingTrace = liveThinking;
      }
      if (agent.runStartedAt === null) {
        patch.runStartedAt = now();
      }
      if (mergedRaw && (!rawText || !isUiMetadataPrefix(rawText.trim()))) {
        const visibleText = extractText({ role: "assistant", content: mergedRaw }) ?? mergedRaw;
        const cleaned = stripUiMetadata(visibleText);
        if (
          cleaned &&
          shouldPublishAssistantStream({
            nextText: cleaned,
            rawText,
            hasChatEvents,
            currentStreamText: agent.streamText ?? null,
          })
        ) {
          patch.streamText = cleaned;
        }
      }
      deps.queueLivePatch(match, patch);
      return;
    }

    if (stream === "tool") {
      const phase = typeof data?.phase === "string" ? data.phase : "";
      const name = typeof data?.name === "string" ? data.name : "tool";
      const toolCallId = typeof data?.toolCallId === "string" ? data.toolCallId : "";
      if (phase && phase !== "result") {
        const args =
          (data?.arguments as unknown) ??
          (data?.args as unknown) ??
          (data?.input as unknown) ??
          (data?.parameters as unknown) ??
          null;
        const line = formatToolCallMarkdown({
          id: toolCallId || undefined,
          name,
          arguments: args,
        });
        if (line) {
          appendUniqueToolLines({
            agentId: match,
            runId: payload.runId,
            sessionKey: payload.sessionKey ?? agent.sessionKey,
            source: "runtime-agent",
            timestampMs: now(),
            lines: [line],
          });
        }
        return;
      }
      if (phase !== "result") return;
      const result = data?.result;
      const isError = typeof data?.isError === "boolean" ? data.isError : undefined;
      const resultRecord =
        result && typeof result === "object" ? (result as Record<string, unknown>) : null;
      const details = resultRecord && "details" in resultRecord ? resultRecord.details : undefined;
      let content: unknown = result;
      if (resultRecord) {
        if (Array.isArray(resultRecord.content)) {
          content = resultRecord.content;
        } else if (typeof resultRecord.text === "string") {
          content = resultRecord.text;
        }
      }
      const message = {
        role: "tool",
        toolName: name,
        toolCallId,
        isError,
        details,
        content,
      };
      appendUniqueToolLines({
        agentId: match,
        runId: payload.runId,
        sessionKey: payload.sessionKey ?? agent.sessionKey,
        source: "runtime-agent",
        timestampMs: now(),
        lines: extractToolLines(message),
      });
      return;
    }

    if (stream !== "lifecycle") return;
    const summaryPatch = getAgentSummaryPatch(payload, now());
    if (!summaryPatch) return;
    if (phase !== "start" && phase !== "end" && phase !== "error") return;
    const transition = resolveLifecyclePatch({
      phase,
      incomingRunId: payload.runId,
      currentRunId: agent.runId,
      lastActivityAt: summaryPatch.lastActivityAt ?? now(),
    });
    if (transition.kind === "ignore") return;
    if (transition.kind === "terminal") {
      clearPendingLivePatch(match);
    }
    if (phase === "end" && !hasChatEvents) {
      const finalText = agent.streamText?.trim();
      if (finalText) {
        const assistantCompletionAt = now();
        const startedAt = thinkingStartedAtByRun.get(payload.runId);
        const thinkingDurationMs =
          typeof startedAt === "number"
            ? Math.max(0, assistantCompletionAt - startedAt)
            : null;
        dispatchOutput(
          match,
          formatMetaMarkdown({
            role: "assistant",
            timestamp: assistantCompletionAt,
            thinkingDurationMs,
          }),
          {
            source: "runtime-agent",
            runId: payload.runId,
            sessionKey: payload.sessionKey ?? agent.sessionKey,
            timestampMs: assistantCompletionAt,
            role: "assistant",
            kind: "meta",
          }
        );
        dispatchOutput(match, finalText, {
          source: "runtime-agent",
          runId: payload.runId,
          sessionKey: payload.sessionKey ?? agent.sessionKey,
          timestampMs: assistantCompletionAt,
          role: "assistant",
          kind: "assistant",
        });
        deps.dispatch({
          type: "updateAgent",
          agentId: match,
          patch: {
            lastResult: finalText,
            lastAssistantMessageAt: assistantCompletionAt,
          },
        });
      }
    }
    if (transition.clearRunTracking) {
      markRunClosed(payload.runId);
      clearRunTracking(payload.runId);
    }
    deps.dispatch({
      type: "updateAgent",
      agentId: match,
      patch: transition.patch,
    });
  };

  const handleEvent = (event: EventFrame) => {
    const eventKind = classifyGatewayEventKind(event.event);
    if (eventKind === "summary-refresh") {
      if (deps.getStatus() !== "connected") return;
      if (event.event === "heartbeat") {
        deps.bumpHeartbeatTick();
        deps.refreshHeartbeatLatestUpdate();
      }
      if (summaryRefreshTimer !== null) {
        deps.clearTimeout(summaryRefreshTimer);
      }
      summaryRefreshTimer = deps.setTimeout(() => {
        summaryRefreshTimer = null;
        void deps.loadSummarySnapshot();
      }, 750);
      return;
    }
    if (eventKind === "runtime-chat") {
      const payload = event.payload as ChatEventPayload | undefined;
      if (!payload) return;
      handleRuntimeChatEvent(payload);
      return;
    }
    if (eventKind === "runtime-agent") {
      const payload = event.payload as AgentEventPayload | undefined;
      if (!payload) return;
      handleRuntimeAgentEvent(payload);
      return;
    }
  };

  return { handleEvent, clearRunTracking, dispose };
}
