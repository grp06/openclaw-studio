import type { AgentState } from "./store";
import {
  extractText,
  extractThinking,
  extractToolLines,
  formatMetaMarkdown,
  formatThinkingMarkdown,
  isHeartbeatPrompt,
  isMetaMarkdown,
  isToolMarkdown,
  isTraceMarkdown,
  isUiMetadataPrefix,
  stripUiMetadata,
} from "@/lib/text/message-extract";
import { normalizeAssistantDisplayText } from "@/lib/text/assistantText";

type LifecyclePhase = "start" | "end" | "error";

type LifecyclePatchInput = {
  phase: LifecyclePhase;
  incomingRunId: string;
  currentRunId: string | null;
  lastActivityAt: number;
};

type LifecycleTransitionStart = {
  kind: "start";
  patch: Partial<AgentState>;
  clearRunTracking: false;
};

type LifecycleTransitionTerminal = {
  kind: "terminal";
  patch: Partial<AgentState>;
  clearRunTracking: true;
};

type LifecycleTransitionIgnore = {
  kind: "ignore";
};

export type LifecycleTransition =
  | LifecycleTransitionStart
  | LifecycleTransitionTerminal
  | LifecycleTransitionIgnore;

type ShouldPublishAssistantStreamInput = {
  nextText: string;
  rawText: string;
  hasChatEvents: boolean;
  currentStreamText: string | null;
};

type AssistantCompletionTimestampInput = {
  role: unknown;
  state: ChatEventPayload["state"];
  message: unknown;
  now?: number;
};

type DedupeRunLinesResult = {
  appended: string[];
  nextSeen: Set<string>;
};

export type ChatEventPayload = {
  runId: string;
  sessionKey: string;
  state: "delta" | "final" | "aborted" | "error";
  seq?: number;
  stopReason?: string;
  message?: unknown;
  errorMessage?: string;
};

export type AgentEventPayload = {
  runId: string;
  seq?: number;
  stream?: string;
  data?: Record<string, unknown>;
  sessionKey?: string;
};

export type SummarySnapshotAgent = {
  agentId: string;
  sessionKey: string;
  status?: AgentState["status"];
};

export type SummarySessionStatusEntry = {
  key: string;
  updatedAt: number | null;
};

export type SummaryStatusSnapshot = {
  sessions?: {
    recent?: SummarySessionStatusEntry[];
    byAgent?: Array<{ agentId: string; recent: SummarySessionStatusEntry[] }>;
  };
};

export type SummaryPreviewItem = {
  role: "user" | "assistant" | "tool" | "system" | "other";
  text: string;
  timestamp?: number | string;
};

export type SummaryPreviewEntry = {
  key: string;
  status: "ok" | "empty" | "missing" | "error";
  items: SummaryPreviewItem[];
};

export type SummaryPreviewSnapshot = {
  ts: number;
  previews: SummaryPreviewEntry[];
};

export type SummarySnapshotPatch = {
  agentId: string;
  patch: Partial<AgentState>;
};

export type ChatHistoryMessage = Record<string, unknown>;

export type HistoryLinesResult = {
  lines: string[];
  lastAssistant: string | null;
  lastAssistantAt: number | null;
  lastRole: string | null;
  lastUser: string | null;
  lastUserAt: number | null;
};

export type HistorySyncPatchInput = {
  messages: ChatHistoryMessage[];
  currentLines: string[];
  loadedAt: number;
  status: AgentState["status"];
  runId: string | null;
};

export type GatewayEventKind =
  | "summary-refresh"
  | "runtime-chat"
  | "runtime-agent"
  | "ignore";

const REASONING_STREAM_NAME_HINTS = ["reason", "think", "analysis", "trace"];

export const classifyGatewayEventKind = (event: string): GatewayEventKind => {
  if (event === "presence" || event === "heartbeat") return "summary-refresh";
  if (event === "chat") return "runtime-chat";
  if (event === "agent") return "runtime-agent";
  return "ignore";
};

export const isReasoningRuntimeAgentStream = (stream: string): boolean => {
  const normalized = stream.trim().toLowerCase();
  if (!normalized) return false;
  if (normalized === "assistant" || normalized === "tool" || normalized === "lifecycle") {
    return false;
  }
  return REASONING_STREAM_NAME_HINTS.some((hint) => normalized.includes(hint));
};

export const mergeRuntimeStream = (current: string, incoming: string): string => {
  if (!incoming) return current;
  if (!current) return incoming;
  if (incoming.startsWith(current)) return incoming;
  if (current.startsWith(incoming)) return current;
  if (current.endsWith(incoming)) return current;
  if (incoming.endsWith(current)) return incoming;
  return `${current}${incoming}`;
};

export const dedupeRunLines = (seen: Set<string>, lines: string[]): DedupeRunLinesResult => {
  const nextSeen = new Set(seen);
  const appended: string[] = [];
  for (const line of lines) {
    if (!line || nextSeen.has(line)) continue;
    nextSeen.add(line);
    appended.push(line);
  }
  return { appended, nextSeen };
};

const toTimestampMs = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return null;
};

const extractMessageTimestamp = (message: unknown): number | null => {
  if (!message || typeof message !== "object") return null;
  const record = message as Record<string, unknown>;
  return (
    toTimestampMs(record.timestamp) ?? toTimestampMs(record.createdAt) ?? toTimestampMs(record.at)
  );
};

export const resolveAssistantCompletionTimestamp = ({
  role,
  state,
  message,
  now = Date.now(),
}: AssistantCompletionTimestampInput): number | null => {
  if (role !== "assistant" || state !== "final") return null;
  return extractMessageTimestamp(message) ?? now;
};

export const buildHistoryLines = (messages: ChatHistoryMessage[]): HistoryLinesResult => {
  const lines: string[] = [];
  let lastAssistant: string | null = null;
  let lastAssistantAt: number | null = null;
  let lastRole: string | null = null;
  let lastUser: string | null = null;
  let lastUserAt: number | null = null;
  const isRestartSentinelMessage = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return false;
    return /^(?:System:\s*\[[^\]]+\]\s*)?GatewayRestart:\s*\{/.test(trimmed);
  };
  for (const message of messages) {
    const role = typeof message.role === "string" ? message.role : "other";
    const extracted = extractText(message);
    const baseText = stripUiMetadata(extracted?.trim() ?? "");
    const text = role === "assistant" ? normalizeAssistantDisplayText(baseText) : baseText;
    const thinking =
      role === "assistant" ? formatThinkingMarkdown(extractThinking(message) ?? "") : "";
    const toolLines = extractToolLines(message);
    if (!text && !thinking && toolLines.length === 0) continue;
    if (role === "system") {
      if (toolLines.length > 0) {
        lines.push(...toolLines);
      }
      continue;
    }
    if (role === "user") {
      if (text && isHeartbeatPrompt(text)) continue;
      if (text && isRestartSentinelMessage(text)) continue;
      if (text) {
        const at = extractMessageTimestamp(message);
        if (typeof at === "number") {
          lines.push(formatMetaMarkdown({ role: "user", timestamp: at }));
        }
        lines.push(`> ${text}`);
        lastUser = text;
        if (typeof at === "number") {
          lastUserAt = at;
        }
      }
      lastRole = "user";
    } else if (role === "assistant") {
      const at = extractMessageTimestamp(message);
      if (typeof at === "number") {
        lastAssistantAt = at;
      }
      if (typeof at === "number") {
        lines.push(formatMetaMarkdown({ role: "assistant", timestamp: at }));
      }
      if (thinking) {
        lines.push(thinking);
      }
      if (toolLines.length > 0) {
        lines.push(...toolLines);
      }
      if (text) {
        lines.push(text);
        lastAssistant = text;
      }
      lastRole = "assistant";
    } else if (toolLines.length > 0) {
      lines.push(...toolLines);
    } else if (text) {
      lines.push(text);
    }
  }
  return { lines, lastAssistant, lastAssistantAt, lastRole, lastUser, lastUserAt };
};

const HISTORY_RUNNING_RECOVERY_WINDOW_MS = 2 * 60 * 60 * 1000;

export const resolveHistoryRunStatePatch = (params: {
  status: AgentState["status"];
  runId: string | null;
  lastRole: string | null;
  lastUserAt: number | null;
  loadedAt: number;
}): Partial<AgentState> | null => {
  const activeRunId = params.runId?.trim() ?? "";
  if (activeRunId) return null;

  if (params.status === "running" && params.lastRole === "assistant") {
    return {
      status: "idle",
      runId: null,
      runStartedAt: null,
      streamText: null,
      thinkingTrace: null,
    };
  }

  if (params.status === "running" || params.lastRole !== "user") {
    return null;
  }

  const lastUserAt = params.lastUserAt;
  if (typeof lastUserAt !== "number" || !Number.isFinite(lastUserAt)) {
    return null;
  }
  if (params.loadedAt < lastUserAt) {
    return null;
  }
  const ageMs = params.loadedAt - lastUserAt;
  if (ageMs > HISTORY_RUNNING_RECOVERY_WINDOW_MS) {
    return null;
  }

  return {
    status: "running",
    runId: null,
    runStartedAt: lastUserAt,
    streamText: null,
    thinkingTrace: null,
  };
};

export const mergeHistoryWithPending = (
  historyLines: string[],
  currentLines: string[]
): string[] => {
  const normalizeUserLine = (line: string): string | null => {
    const trimmed = line.trim();
    if (!trimmed.startsWith(">")) return null;
    const text = trimmed.replace(/^>\s?/, "");
    const normalized = text.replace(/\s+/g, " ").trim();
    return normalized || null;
  };

  const isPlainAssistantLine = (line: string): boolean => {
    const trimmed = line.trim();
    if (!trimmed) return false;
    if (trimmed.startsWith(">")) return false;
    if (isMetaMarkdown(trimmed)) return false;
    if (isTraceMarkdown(trimmed)) return false;
    if (isToolMarkdown(trimmed)) return false;
    return true;
  };

  const countLines = (lines: string[]) => {
    const counts = new Map<string, number>();
    for (const line of lines) {
      counts.set(line, (counts.get(line) ?? 0) + 1);
    }
    return counts;
  };

  if (currentLines.length === 0) return historyLines;
  if (historyLines.length === 0) return historyLines;
  const historyCounts = countLines(historyLines);
  const currentCounts = countLines(currentLines);
  const merged = [...historyLines];
  let cursor = 0;
  for (const line of currentLines) {
    let foundIndex = -1;
    for (let i = cursor; i < merged.length; i += 1) {
      if (merged[i] === line) {
        foundIndex = i;
        break;
      }
    }
    if (foundIndex !== -1) {
      cursor = foundIndex + 1;
      continue;
    }
    const normalizedUserLine = normalizeUserLine(line);
    if (normalizedUserLine) {
      for (let i = cursor; i < merged.length; i += 1) {
        const normalizedMergedLine = normalizeUserLine(merged[i] ?? "");
        if (!normalizedMergedLine) continue;
        if (normalizedMergedLine !== normalizedUserLine) continue;
        foundIndex = i;
        break;
      }
      if (foundIndex !== -1) {
        cursor = foundIndex + 1;
        continue;
      }
    }
    merged.splice(cursor, 0, line);
    cursor += 1;
  }
  const assistantLineCount = new Map<string, number>();
  const bounded: string[] = [];
  for (const line of merged) {
    if (!isPlainAssistantLine(line)) {
      bounded.push(line);
      continue;
    }
    const nextCount = (assistantLineCount.get(line) ?? 0) + 1;
    const historyCount = historyCounts.get(line) ?? 0;
    const currentCount = currentCounts.get(line) ?? 0;
    const hasOverlap = historyCount > 0 && currentCount > 0;
    if (hasOverlap && nextCount > historyCount) {
      continue;
    }
    assistantLineCount.set(line, nextCount);
    bounded.push(line);
  }
  return bounded;
};

export const buildHistorySyncPatch = ({
  messages,
  currentLines,
  loadedAt,
  status,
  runId,
}: HistorySyncPatchInput): Partial<AgentState> => {
  const { lines, lastAssistant, lastAssistantAt, lastRole, lastUser, lastUserAt } =
    buildHistoryLines(messages);
  const runStatePatch = resolveHistoryRunStatePatch({
    status,
    runId,
    lastRole,
    lastUserAt,
    loadedAt,
  });
  if (lines.length === 0) return { historyLoadedAt: loadedAt };
  const mergedLines = mergeHistoryWithPending(lines, currentLines);
  const isSame =
    mergedLines.length === currentLines.length &&
    mergedLines.every((line, index) => line === currentLines[index]);
  if (isSame) {
    const patch: Partial<AgentState> = {
      historyLoadedAt: loadedAt,
      ...(runStatePatch ?? {}),
    };
    if (typeof lastAssistantAt === "number") {
      patch.lastAssistantMessageAt = lastAssistantAt;
    }
    return patch;
  }
  const patch: Partial<AgentState> = {
    outputLines: mergedLines,
    lastResult: lastAssistant ?? null,
    ...(lastAssistant ? { latestPreview: lastAssistant } : {}),
    ...(typeof lastAssistantAt === "number" ? { lastAssistantMessageAt: lastAssistantAt } : {}),
    ...(lastUser ? { lastUserMessage: lastUser } : {}),
    historyLoadedAt: loadedAt,
    ...(runStatePatch ?? {}),
  };
  return patch;
};

export const buildSummarySnapshotPatches = ({
  agents,
  statusSummary,
  previewResult,
}: {
  agents: SummarySnapshotAgent[];
  statusSummary: SummaryStatusSnapshot;
  previewResult: SummaryPreviewSnapshot;
}): SummarySnapshotPatch[] => {
  const previewMap = new Map<string, SummaryPreviewEntry>();
  for (const entry of previewResult.previews ?? []) {
    previewMap.set(entry.key, entry);
  }
  const activityByKey = new Map<string, number>();
  const addActivity = (entries?: SummarySessionStatusEntry[]) => {
    if (!entries) return;
    for (const entry of entries) {
      if (!entry?.key || typeof entry.updatedAt !== "number") continue;
      activityByKey.set(entry.key, entry.updatedAt);
    }
  };
  addActivity(statusSummary.sessions?.recent);
  for (const group of statusSummary.sessions?.byAgent ?? []) {
    addActivity(group.recent);
  }
  const patches: SummarySnapshotPatch[] = [];
  for (const agent of agents) {
    const patch: Partial<AgentState> = {};
    const activity = activityByKey.get(agent.sessionKey);
    if (typeof activity === "number") {
      patch.lastActivityAt = activity;
    }
    const preview = previewMap.get(agent.sessionKey);
    if (preview?.items?.length) {
      const latestItem = preview.items[preview.items.length - 1];
      if (latestItem?.role === "assistant" && agent.status !== "running") {
        const previewTs = toTimestampMs(latestItem.timestamp);
        if (typeof previewTs === "number") {
          patch.lastAssistantMessageAt = previewTs;
        } else if (typeof activity === "number") {
          patch.lastAssistantMessageAt = activity;
        }
      }
      const lastAssistant = [...preview.items]
        .reverse()
        .find((item) => item.role === "assistant");
      const lastUser = [...preview.items].reverse().find((item) => item.role === "user");
      if (lastAssistant?.text) {
        patch.latestPreview = stripUiMetadata(lastAssistant.text);
      }
      if (lastUser?.text) {
        patch.lastUserMessage = stripUiMetadata(lastUser.text);
      }
    }
    if (Object.keys(patch).length > 0) {
      patches.push({ agentId: agent.agentId, patch });
    }
  }
  return patches;
};

export const resolveLifecyclePatch = (input: LifecyclePatchInput): LifecycleTransition => {
  const { phase, incomingRunId, currentRunId, lastActivityAt } = input;
  if (phase === "start") {
    return {
      kind: "start",
      clearRunTracking: false,
      patch: {
        status: "running",
        runId: incomingRunId,
        runStartedAt: lastActivityAt,
        sessionCreated: true,
        lastActivityAt,
      },
    };
  }
  if (currentRunId && currentRunId !== incomingRunId) {
    return { kind: "ignore" };
  }
  if (phase === "error") {
    return {
      kind: "terminal",
      clearRunTracking: true,
      patch: {
        status: "error",
        runId: null,
        runStartedAt: null,
        streamText: null,
        thinkingTrace: null,
        lastActivityAt,
      },
    };
  }
  return {
    kind: "terminal",
    clearRunTracking: true,
    patch: {
      status: "idle",
      runId: null,
      runStartedAt: null,
      streamText: null,
      thinkingTrace: null,
      lastActivityAt,
    },
  };
};

export const shouldPublishAssistantStream = ({
  nextText,
  rawText,
  hasChatEvents,
  currentStreamText,
}: ShouldPublishAssistantStreamInput): boolean => {
  const next = nextText.trim();
  if (!next) return false;
  if (!hasChatEvents) return true;
  if (rawText.trim()) return true;
  const current = currentStreamText?.trim() ?? "";
  if (!current) return true;
  if (next.length <= current.length) return false;
  return next.startsWith(current);
};

export const getChatSummaryPatch = (
  payload: ChatEventPayload,
  now: number = Date.now()
): Partial<AgentState> | null => {
  const message = payload.message;
  const role =
    message && typeof message === "object"
      ? (message as Record<string, unknown>).role
      : null;
  const rawText = extractText(message);
  if (typeof rawText === "string" && isUiMetadataPrefix(rawText.trim())) {
    return { lastActivityAt: now };
  }
  const cleaned = typeof rawText === "string" ? stripUiMetadata(rawText) : null;
  const patch: Partial<AgentState> = { lastActivityAt: now };
  if (role === "user") {
    if (cleaned) {
      patch.lastUserMessage = cleaned;
    }
    return patch;
  }
  if (role === "assistant") {
    if (cleaned) {
      patch.latestPreview = cleaned;
    }
    return patch;
  }
  if (payload.state === "error" && payload.errorMessage) {
    patch.latestPreview = payload.errorMessage;
  }
  return patch;
};

export const getAgentSummaryPatch = (
  payload: AgentEventPayload,
  now: number = Date.now()
): Partial<AgentState> | null => {
  if (payload.stream !== "lifecycle") return null;
  const phase = typeof payload.data?.phase === "string" ? payload.data.phase : "";
  if (!phase) return null;
  const patch: Partial<AgentState> = { lastActivityAt: now };
  if (phase === "start") {
    patch.status = "running";
    return patch;
  }
  if (phase === "end") {
    patch.status = "idle";
    return patch;
  }
  if (phase === "error") {
    patch.status = "error";
    return patch;
  }
  return patch;
};
