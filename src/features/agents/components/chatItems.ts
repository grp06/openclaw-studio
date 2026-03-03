import {
  formatThinkingMarkdown,
  isToolMarkdown,
  isMetaMarkdown,
  isTraceMarkdown,
  parseToolMarkdown,
  parseMetaMarkdown,
  stripTraceMarkdown,
} from "@/lib/text/message-extract";
import { normalizeAssistantDisplayText } from "@/lib/text/assistantText";

type ItemMeta = {
  role: "user" | "assistant";
  timestampMs: number;
  thinkingDurationMs?: number;
};

export type AgentChatItem =
  | { kind: "user"; text: string; timestampMs?: number }
  | { kind: "assistant"; text: string; live?: boolean; timestampMs?: number; thinkingDurationMs?: number }
  | { kind: "tool"; text: string; timestampMs?: number }
  | { kind: "thinking"; text: string; live?: boolean; timestampMs?: number; thinkingDurationMs?: number };

export type AssistantTraceEvent =
  | { kind: "thinking"; text: string }
  | { kind: "tool"; text: string };

type AgentChatRenderBlock =
  | { kind: "user"; text: string; timestampMs?: number }
  | {
      kind: "assistant";
      text: string | null;
      timestampMs?: number;
      thinkingDurationMs?: number;
      traceEvents: AssistantTraceEvent[];
    };

type BuildAgentChatItemsInput = {
  outputLines: string[];
  streamText: string | null;
  liveThinkingTrace: string;
  showThinkingTraces: boolean;
  toolCallingEnabled: boolean;
};

export const DEFAULT_SEMANTIC_RENDER_TURN_LIMIT = 50;

const normalizeUserDisplayText = (value: string): string => {
  return value.replace(/\s+/g, " ").trim();
};

const normalizeThinkingDisplayText = (value: string): string => {
  const markdown = formatThinkingMarkdown(value);
  const normalized = stripTraceMarkdown(markdown).trim();
  return normalized;
};

export const buildFinalAgentChatItems = ({
  outputLines,
  showThinkingTraces,
  toolCallingEnabled,
}: Pick<
  BuildAgentChatItemsInput,
  "outputLines" | "showThinkingTraces" | "toolCallingEnabled"
>): AgentChatItem[] => {
  const items: AgentChatItem[] = [];
  let currentMeta: ItemMeta | null = null;
  const appendThinking = (text: string) => {
    const normalized = text.trim();
    if (!normalized) return;
    const previous = items[items.length - 1];
    if (!previous || previous.kind !== "thinking") {
      items.push({
        kind: "thinking",
        text: normalized,
        ...(currentMeta ? { timestampMs: currentMeta.timestampMs, thinkingDurationMs: currentMeta.thinkingDurationMs } : {}),
      });
      return;
    }
    if (previous.text === normalized) {
      return;
    }
    if (normalized.startsWith(previous.text)) {
      previous.text = normalized;
      return;
    }
    if (previous.text.startsWith(normalized)) {
      return;
    }
    previous.text = `${previous.text}\n\n${normalized}`;
  };

  for (const line of outputLines) {
    if (!line) continue;
    if (isMetaMarkdown(line)) {
      const parsed = parseMetaMarkdown(line);
      if (parsed) {
        currentMeta = {
          role: parsed.role,
          timestampMs: parsed.timestamp,
          ...(typeof parsed.thinkingDurationMs === "number" ? { thinkingDurationMs: parsed.thinkingDurationMs } : {}),
        };
      }
      continue;
    }
    if (isTraceMarkdown(line)) {
      if (!showThinkingTraces) continue;
      const text = stripTraceMarkdown(line).trim();
      if (!text) continue;
      appendThinking(text);
      continue;
    }
    if (isToolMarkdown(line)) {
      if (!toolCallingEnabled) continue;
      items.push({
        kind: "tool",
        text: line,
        ...(currentMeta ? { timestampMs: currentMeta.timestampMs } : {}),
      });
      continue;
    }
    const trimmed = line.trim();
    if (trimmed.startsWith(">")) {
      const text = trimmed.replace(/^>\s?/, "").trim();
      if (text) {
        const normalized = normalizeUserDisplayText(text);
        const currentTimestamp =
          currentMeta?.role === "user" ? currentMeta.timestampMs : undefined;
        const previous = items[items.length - 1];
        if (previous?.kind === "user") {
          const previousNormalized = normalizeUserDisplayText(previous.text);
          const previousTimestamp = previous.timestampMs;
          const shouldCollapse =
            previousNormalized === normalized &&
            ((typeof previousTimestamp === "number" &&
              typeof currentTimestamp === "number" &&
              previousTimestamp === currentTimestamp) ||
              (previousTimestamp === undefined &&
                typeof currentTimestamp === "number"));
          if (
            shouldCollapse
          ) {
            previous.text = normalized;
            if (typeof currentTimestamp === "number") {
              previous.timestampMs = currentTimestamp;
            }
            if (currentMeta?.role === "user") {
              currentMeta = null;
            }
            continue;
          }
        }
        items.push({
          kind: "user",
          text: normalized,
          ...(typeof currentTimestamp === "number" ? { timestampMs: currentTimestamp } : {}),
        });
        if (currentMeta?.role === "user") {
          currentMeta = null;
        }
      }
      continue;
    }
    const normalizedAssistant = normalizeAssistantDisplayText(line);
    if (!normalizedAssistant) continue;
    items.push({
      kind: "assistant",
      text: normalizedAssistant,
      ...(currentMeta ? { timestampMs: currentMeta.timestampMs, thinkingDurationMs: currentMeta.thinkingDurationMs } : {}),
    });
  }
  return items;
};

export const buildAgentChatItems = ({
  outputLines,
  streamText,
  liveThinkingTrace,
  showThinkingTraces,
  toolCallingEnabled,
}: BuildAgentChatItemsInput): AgentChatItem[] => {
  const items: AgentChatItem[] = [];
  let currentMeta: ItemMeta | null = null;
  const appendThinking = (text: string, live?: boolean) => {
    const normalized = text.trim();
    if (!normalized) return;
    const previous = items[items.length - 1];
    if (!previous || previous.kind !== "thinking") {
      items.push({
        kind: "thinking",
        text: normalized,
        live,
        ...(currentMeta ? { timestampMs: currentMeta.timestampMs, thinkingDurationMs: currentMeta.thinkingDurationMs } : {}),
      });
      return;
    }
    if (previous.text === normalized) {
      if (live) previous.live = true;
      return;
    }
    if (normalized.startsWith(previous.text)) {
      previous.text = normalized;
      if (live) previous.live = true;
      return;
    }
    if (previous.text.startsWith(normalized)) {
      if (live) previous.live = true;
      return;
    }
    previous.text = `${previous.text}\n\n${normalized}`;
    if (live) previous.live = true;
  };

  for (const line of outputLines) {
    if (!line) continue;
    if (isMetaMarkdown(line)) {
      const parsed = parseMetaMarkdown(line);
      if (parsed) {
        currentMeta = {
          role: parsed.role,
          timestampMs: parsed.timestamp,
          ...(typeof parsed.thinkingDurationMs === "number" ? { thinkingDurationMs: parsed.thinkingDurationMs } : {}),
        };
      }
      continue;
    }
    if (isTraceMarkdown(line)) {
      if (!showThinkingTraces) continue;
      const text = stripTraceMarkdown(line).trim();
      if (!text) continue;
      appendThinking(text);
      continue;
    }
    if (isToolMarkdown(line)) {
      if (!toolCallingEnabled) continue;
      items.push({
        kind: "tool",
        text: line,
        ...(currentMeta ? { timestampMs: currentMeta.timestampMs } : {}),
      });
      continue;
    }
    const trimmed = line.trim();
    if (trimmed.startsWith(">")) {
      const text = trimmed.replace(/^>\s?/, "").trim();
      if (text) {
        const currentTimestamp =
          currentMeta?.role === "user" ? currentMeta.timestampMs : undefined;
        items.push({
          kind: "user",
          text: normalizeUserDisplayText(text),
          ...(typeof currentTimestamp === "number" ? { timestampMs: currentTimestamp } : {}),
        });
        if (currentMeta?.role === "user") {
          currentMeta = null;
        }
      }
      continue;
    }
    const normalizedAssistant = normalizeAssistantDisplayText(line);
    if (!normalizedAssistant) continue;
    items.push({
      kind: "assistant",
      text: normalizedAssistant,
      ...(currentMeta ? { timestampMs: currentMeta.timestampMs, thinkingDurationMs: currentMeta.thinkingDurationMs } : {}),
    });
  }

  const liveStream = streamText?.trim();

  if (showThinkingTraces) {
    const normalizedLiveThinking = normalizeThinkingDisplayText(liveThinkingTrace);
    if (normalizedLiveThinking) {
      appendThinking(normalizedLiveThinking, true);
    }
  }

  if (liveStream) {
    const normalizedStream = normalizeAssistantDisplayText(liveStream);
    if (normalizedStream) {
      items.push({ kind: "assistant", text: normalizedStream, live: true });
    }
  }

  return items;
};

const mergeIncrementalText = (existing: string, next: string): string => {
  if (existing === next) return existing;
  if (next.startsWith(existing)) return next;
  if (existing.startsWith(next)) return existing;
  return `${existing}\n\n${next}`;
};

const appendThinkingTraceEvent = (events: AssistantTraceEvent[], text: string) => {
  const normalized = text.trim();
  if (!normalized) return;
  const previous = events[events.length - 1];
  if (!previous || previous.kind !== "thinking") {
    events.push({ kind: "thinking", text: normalized });
    return;
  }
  previous.text = mergeIncrementalText(previous.text, normalized);
};

const hasMismatchedTimestamps = (
  left?: number,
  right?: number
): boolean => {
  if (typeof left !== "number" || typeof right !== "number") return false;
  return left !== right;
};

export const buildAgentChatRenderBlocks = (
  chatItems: AgentChatItem[]
): AgentChatRenderBlock[] => {
  const blocks: AgentChatRenderBlock[] = [];
  let currentAssistant: Extract<AgentChatRenderBlock, { kind: "assistant" }> | null = null;

  const flushAssistant = () => {
    if (!currentAssistant) return;
    if (currentAssistant.text || currentAssistant.traceEvents.length > 0) {
      blocks.push(currentAssistant);
    }
    currentAssistant = null;
  };

  const ensureAssistant = (meta?: {
    timestampMs?: number;
    thinkingDurationMs?: number;
  }) => {
    if (!currentAssistant) {
      currentAssistant = {
        kind: "assistant",
        text: null,
        traceEvents: [],
        ...(typeof meta?.timestampMs === "number" ? { timestampMs: meta.timestampMs } : {}),
        ...(typeof meta?.thinkingDurationMs === "number"
          ? { thinkingDurationMs: meta.thinkingDurationMs }
          : {}),
      };
      return currentAssistant;
    }
    if (
      currentAssistant.text &&
      hasMismatchedTimestamps(currentAssistant.timestampMs, meta?.timestampMs)
    ) {
      flushAssistant();
      currentAssistant = {
        kind: "assistant",
        text: null,
        traceEvents: [],
        ...(typeof meta?.timestampMs === "number" ? { timestampMs: meta.timestampMs } : {}),
        ...(typeof meta?.thinkingDurationMs === "number"
          ? { thinkingDurationMs: meta.thinkingDurationMs }
          : {}),
      };
      return currentAssistant;
    }
    if (
      typeof currentAssistant.timestampMs !== "number" &&
      typeof meta?.timestampMs === "number"
    ) {
      currentAssistant.timestampMs = meta.timestampMs;
    }
    if (typeof meta?.thinkingDurationMs === "number") {
      currentAssistant.thinkingDurationMs = meta.thinkingDurationMs;
    }
    return currentAssistant;
  };

  for (const item of chatItems) {
    if (item.kind === "user") {
      flushAssistant();
      blocks.push({ kind: "user", text: item.text, timestampMs: item.timestampMs });
      continue;
    }

    if (item.kind === "thinking") {
      const assistant = ensureAssistant({
        timestampMs: item.timestampMs,
        thinkingDurationMs: item.thinkingDurationMs,
      });
      appendThinkingTraceEvent(assistant.traceEvents, item.text);
      continue;
    }

    if (item.kind === "tool") {
      const assistant = ensureAssistant({ timestampMs: item.timestampMs });
      assistant.traceEvents.push({ kind: "tool", text: item.text });
      continue;
    }

    const assistant = ensureAssistant({
      timestampMs: item.timestampMs,
      thinkingDurationMs: item.thinkingDurationMs,
    });
    const normalized = item.text.trim();
    if (!normalized) continue;
    assistant.text =
      typeof assistant.text === "string"
        ? mergeIncrementalText(assistant.text, normalized)
        : normalized;
  }

  flushAssistant();
  return blocks;
};

const isSemanticTurnItem = (item: AgentChatItem): boolean => {
  if (item.kind !== "user" && item.kind !== "assistant") return false;
  return Boolean(item.text.trim());
};

export const boundChatItemsBySemanticTurns = (params: {
  items: AgentChatItem[];
  turnLimit: number;
}): AgentChatItem[] => {
  const safeTurnLimit =
    Number.isFinite(params.turnLimit) && params.turnLimit > 0
      ? Math.floor(params.turnLimit)
      : DEFAULT_SEMANTIC_RENDER_TURN_LIMIT;
  if (params.items.length === 0) return params.items;

  let startIndex = 0;
  let turnCount = 0;
  for (let index = params.items.length - 1; index >= 0; index -= 1) {
    if (!isSemanticTurnItem(params.items[index])) continue;
    turnCount += 1;
    if (turnCount > safeTurnLimit) {
      startIndex = index + 1;
      break;
    }
  }

  if (startIndex <= 0) return params.items;
  return params.items.slice(startIndex);
};

const stripTrailingToolCallId = (
  label: string
): { toolLabel: string; toolCallId: string | null } => {
  const trimmed = label.trim();
  const match = trimmed.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
  if (!match) return { toolLabel: trimmed, toolCallId: null };
  const toolLabel = (match[1] ?? "").trim();
  const toolCallId = (match[2] ?? "").trim();
  return { toolLabel: toolLabel || trimmed, toolCallId: toolCallId || null };
};

const toDisplayToolName = (label: string): string => {
  const cleaned = label.trim();
  if (!cleaned) return "tool";
  const segments = cleaned.split(/[.:/]/).map((s) => s.trim()).filter(Boolean);
  return segments[segments.length - 1] ?? cleaned;
};

const truncateInline = (value: string, maxChars: number): string => {
  const cleaned = value.replace(/\s+/g, " ").trim();
  if (cleaned.length <= maxChars) return cleaned;
  return `${cleaned.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
};

const extractToolMetaLine = (body: string): string | null => {
  const trimmed = body.trim();
  if (!trimmed) return null;
  const [firstLine] = trimmed.split(/\r?\n/, 1);
  const meta = (firstLine ?? "").trim();
  if (!meta) return null;
  if (meta.startsWith("```")) return null;
  return meta;
};

const extractFirstCodeBlockLine = (body: string): string | null => {
  const match = body.match(/```[a-zA-Z0-9_-]*\r?\n([^\r\n]+)\r?\n/);
  const line = (match?.[1] ?? "").trim();
  return line ? truncateInline(line, 96) : null;
};

const extractToolArgSummary = (body: string): string | null => {
  const matchers: Array<[RegExp, (m: RegExpMatchArray) => string | null]> = [
    [/"command"\s*:\s*"([^"]+)"/, (m) => (m[1] ? m[1] : null)],
    [/"file_path"\s*:\s*"([^"]+)"/, (m) => (m[1] ? m[1] : null)],
    [/"filePath"\s*:\s*"([^"]+)"/, (m) => (m[1] ? m[1] : null)],
    [/"path"\s*:\s*"([^"]+)"/, (m) => (m[1] ? m[1] : null)],
    [/"url"\s*:\s*"([^"]+)"/, (m) => (m[1] ? m[1] : null)],
  ];
  for (const [re, toSummary] of matchers) {
    const m = body.match(re);
    const summary = m ? toSummary(m) : null;
    if (summary) return truncateInline(summary, 96);
  }
  return null;
};

export const summarizeToolLabel = (
  line: string
): { summaryText: string; body: string; inlineOnly?: boolean } => {
  const parsed = parseToolMarkdown(line);
  const { toolLabel } = stripTrailingToolCallId(parsed.label);
  const toolName = toDisplayToolName(toolLabel).toUpperCase();
  const metaLine = parsed.kind === "result" ? extractToolMetaLine(parsed.body) : null;
  const argSummary = parsed.kind === "call" ? extractToolArgSummary(parsed.body) : null;
  const toolIsRead = toolName === "READ";
  if (toolIsRead && parsed.kind === "call" && argSummary) {
    return {
      summaryText: `read ${argSummary}`,
      body: "",
      inlineOnly: true,
    };
  }
  const suffix = metaLine ?? argSummary;
  const toolIsExec = toolName === "EXEC";
  const execSummary =
    parsed.kind === "call"
      ? argSummary
      : metaLine ?? extractFirstCodeBlockLine(parsed.body);
  const summaryText = toolIsExec
    ? (execSummary ?? metaLine ?? toolName)
    : (suffix ? `${toolName} · ${suffix}` : toolName);
  return {
    summaryText,
    body: parsed.body,
  };
};
