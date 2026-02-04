import type { AgentState } from "./store";
import { extractText } from "@/lib/text/message-extract";
import { isUiMetadataPrefix, stripUiMetadata } from "@/lib/text/message-metadata";

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
  mergedRaw: string;
  rawText: string;
  hasChatEvents: boolean;
  currentStreamText: string | null;
};

type DedupeRunLinesResult = {
  appended: string[];
  nextSeen: Set<string>;
};

export type ChatEventPayload = {
  runId: string;
  sessionKey: string;
  state: "delta" | "final" | "aborted" | "error";
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

export const resolveLifecyclePatch = (input: LifecyclePatchInput): LifecycleTransition => {
  const { phase, incomingRunId, currentRunId, lastActivityAt } = input;
  if (phase === "start") {
    return {
      kind: "start",
      clearRunTracking: false,
      patch: {
        status: "running",
        runId: incomingRunId,
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
      streamText: null,
      thinkingTrace: null,
      lastActivityAt,
    },
  };
};

export const shouldPublishAssistantStream = ({
  mergedRaw,
  rawText,
  hasChatEvents,
  currentStreamText,
}: ShouldPublishAssistantStreamInput): boolean => {
  if (!mergedRaw.trim()) return false;
  if (!hasChatEvents) return true;
  if (rawText.trim()) return true;
  return !currentStreamText?.trim();
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
