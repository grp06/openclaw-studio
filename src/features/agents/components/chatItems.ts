import {
  formatThinkingMarkdown,
  isToolMarkdown,
  isMetaMarkdown,
  isTraceMarkdown,
  parseToolMarkdown,
  parseMetaMarkdown,
  stripTraceMarkdown,
} from "@/lib/text/message-extract";

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

export type BuildAgentChatItemsInput = {
  outputLines: string[];
  streamText: string | null;
  liveThinkingTrace: string;
  showThinkingTraces: boolean;
  toolCallingEnabled: boolean;
};

const coerceToolMarkdownToAssistantText = (line: string): string | null => {
  const parsed = parseToolMarkdown(line);
  if (parsed.kind !== "result") return null;
  const label = parsed.label.trim().toLowerCase();
  if (!label.startsWith("exec")) return null;
  const body = parsed.body.trim();
  return body || null;
};

export const normalizeAssistantDisplayText = (value: string): string => {
  const lines = value.replace(/\r\n?/g, "\n").split("\n");
  const normalized: string[] = [];
  let lastWasBlank = false;
  for (const rawLine of lines) {
    const line = rawLine.replace(/[ \t]+$/g, "");
    if (line.trim().length === 0) {
      if (lastWasBlank) continue;
      normalized.push("");
      lastWasBlank = true;
      continue;
    }
    normalized.push(line);
    lastWasBlank = false;
  }
  return normalized.join("\n").trim();
};

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
  let pendingExecOutputs: string[] = [];
  const flushPendingExecOutputs = () => {
    if (pendingExecOutputs.length === 0) return;
    const combined = pendingExecOutputs.join("\n\n");
    pendingExecOutputs = [];
    items.push({
      kind: "assistant",
      text: normalizeAssistantDisplayText(combined),
      ...(currentMeta
        ? { timestampMs: currentMeta.timestampMs, thinkingDurationMs: currentMeta.thinkingDurationMs }
        : {}),
    });
  };
  const clearPendingExecOutputs = () => {
    pendingExecOutputs = [];
  };
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
      if (!toolCallingEnabled) {
        const coerced = coerceToolMarkdownToAssistantText(line);
        if (coerced) {
          pendingExecOutputs.push(coerced);
        }
        continue;
      }
      items.push({
        kind: "tool",
        text: line,
        ...(currentMeta ? { timestampMs: currentMeta.timestampMs } : {}),
      });
      continue;
    }
    const trimmed = line.trim();
    if (trimmed.startsWith(">")) {
      flushPendingExecOutputs();
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
    clearPendingExecOutputs();
    items.push({
      kind: "assistant",
      text: normalizedAssistant,
      ...(currentMeta ? { timestampMs: currentMeta.timestampMs, thinkingDurationMs: currentMeta.thinkingDurationMs } : {}),
    });
  }

  flushPendingExecOutputs();
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
  let pendingExecOutputs: string[] = [];
  const flushPendingExecOutputs = () => {
    if (pendingExecOutputs.length === 0) return;
    const combined = pendingExecOutputs.join("\n\n");
    pendingExecOutputs = [];
    items.push({
      kind: "assistant",
      text: normalizeAssistantDisplayText(combined),
      ...(currentMeta
        ? { timestampMs: currentMeta.timestampMs, thinkingDurationMs: currentMeta.thinkingDurationMs }
        : {}),
    });
  };
  const clearPendingExecOutputs = () => {
    pendingExecOutputs = [];
  };
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
      if (!toolCallingEnabled) {
        const coerced = coerceToolMarkdownToAssistantText(line);
        if (coerced) {
          pendingExecOutputs.push(coerced);
        }
        continue;
      }
      items.push({
        kind: "tool",
        text: line,
        ...(currentMeta ? { timestampMs: currentMeta.timestampMs } : {}),
      });
      continue;
    }
    const trimmed = line.trim();
    if (trimmed.startsWith(">")) {
      flushPendingExecOutputs();
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
    clearPendingExecOutputs();
    items.push({
      kind: "assistant",
      text: normalizedAssistant,
      ...(currentMeta ? { timestampMs: currentMeta.timestampMs, thinkingDurationMs: currentMeta.thinkingDurationMs } : {}),
    });
  }

  const liveStream = streamText?.trim();
  if (liveStream) {
    clearPendingExecOutputs();
  }

  flushPendingExecOutputs();

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

export const summarizeToolLabel = (line: string): { summaryText: string; body: string } => {
  const parsed = parseToolMarkdown(line);
  const { toolLabel } = stripTrailingToolCallId(parsed.label);
  const toolName = toDisplayToolName(toolLabel).toUpperCase();
  const metaLine = parsed.kind === "result" ? extractToolMetaLine(parsed.body) : null;
  const argSummary = parsed.kind === "call" ? extractToolArgSummary(parsed.body) : null;
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
