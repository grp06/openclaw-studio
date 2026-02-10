import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type MutableRefObject,
} from "react";
import type { AgentState as AgentRecord } from "@/features/agents/state/store";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ChevronRight, Clock, Cog, Copy, Shuffle } from "lucide-react";
import type { GatewayModelChoice } from "@/lib/gateway/models";
import { isToolMarkdown, isTraceMarkdown } from "@/lib/text/message-extract";
import { isNearBottom } from "@/lib/dom";
import { AgentAvatar } from "./AgentAvatar";
import {
  buildFinalAgentChatItems,
  normalizeAssistantDisplayText,
  summarizeToolLabel,
  type AgentChatItem,
} from "./chatItems";
import { EmptyStatePanel } from "./EmptyStatePanel";

const formatChatTimestamp = (timestampMs: number): string => {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(timestampMs));
};

const formatDurationLabel = (durationMs: number): string => {
  const seconds = durationMs / 1000;
  if (!Number.isFinite(seconds) || seconds <= 0) return "0.0s";
  if (seconds < 10) return `${seconds.toFixed(1)}s`;
  return `${Math.round(seconds)}s`;
};

const SPINE_LEFT = "left-[15px]";
const ASSISTANT_GUTTER_CLASS = "pl-[44px]";
const ASSISTANT_MAX_WIDTH_DEFAULT_CLASS = "max-w-[68ch]";
const ASSISTANT_MAX_WIDTH_EXPANDED_CLASS = "max-w-[1120px]";

const looksLikePath = (value: string): boolean => {
  if (!value) return false;
  if (/(^|[\s(])(?:[A-Za-z]:\\|~\/|\/)/.test(value)) return true;
  if (/(^|[\s(])(src|app|packages|components)\//.test(value)) return true;
  if (/(^|[\s(])[\w.-]+\.(ts|tsx|js|jsx|json|md|py|go|rs|java|kt|rb|sh|yaml|yml)\b/.test(value)) {
    return true;
  }
  return false;
};

const isStructuredMarkdown = (text: string): boolean => {
  if (!text) return false;
  if (/```/.test(text)) return true;
  if (/^\s*#{1,6}\s+/m.test(text)) return true;
  if (/^\s*[-*+]\s+/m.test(text)) return true;
  if (/^\s*\d+\.\s+/m.test(text)) return true;
  if (/^\s*\|.+\|\s*$/m.test(text)) return true;
  if (looksLikePath(text) && text.split("\n").filter(Boolean).length >= 3) return true;
  return false;
};

const resolveAssistantMaxWidthClass = (text: string | null | undefined): string => {
  const value = (text ?? "").trim();
  if (!value) return ASSISTANT_MAX_WIDTH_DEFAULT_CLASS;
  if (isStructuredMarkdown(value)) return ASSISTANT_MAX_WIDTH_EXPANDED_CLASS;
  const nonEmptyLines = value.split("\n").filter((line) => line.trim().length > 0);
  const shortLineCount = nonEmptyLines.filter((line) => line.trim().length <= 44).length;
  if (nonEmptyLines.length >= 10 && shortLineCount / Math.max(1, nonEmptyLines.length) >= 0.65) {
    return ASSISTANT_MAX_WIDTH_EXPANDED_CLASS;
  }
  return ASSISTANT_MAX_WIDTH_DEFAULT_CLASS;
};

const splitArtifactContent = (
  rawText: string
): { intro: string | null; artifact: string | null; artifactOnly: boolean } => {
  const text = rawText.trim();
  if (!text) return { intro: null, artifact: null, artifactOnly: false };
  if (!text.includes("\n\n")) {
    return isStructuredMarkdown(text)
      ? { intro: null, artifact: text, artifactOnly: true }
      : { intro: null, artifact: null, artifactOnly: false };
  }
  const [maybeIntro, ...restParts] = text.split(/\n\n+/);
  const rest = restParts.join("\n\n").trim();
  const intro = (maybeIntro ?? "").trim();
  const introWordCount = intro ? intro.split(/\s+/).filter(Boolean).length : 0;
  if (rest && intro && introWordCount <= 60 && isStructuredMarkdown(rest)) {
    return { intro, artifact: rest, artifactOnly: false };
  }
  return isStructuredMarkdown(text)
    ? { intro: null, artifact: text, artifactOnly: true }
    : { intro: null, artifact: null, artifactOnly: false };
};

type AgentChatPanelProps = {
  agent: AgentRecord;
  isSelected: boolean;
  canSend: boolean;
  models: GatewayModelChoice[];
  stopBusy: boolean;
  onOpenSettings: () => void;
  onModelChange: (value: string | null) => void;
  onThinkingChange: (value: string | null) => void;
  onDraftChange: (value: string) => void;
  onSend: (message: string) => void;
  onStopRun: () => void;
  onAvatarShuffle: () => void;
};

const ThinkingDetailsRow = memo(function ThinkingDetailsRow({
  avatarSeed,
  avatarUrl,
  name,
  thinkingText,
  durationMs,
  showTyping,
}: {
  avatarSeed: string;
  avatarUrl: string | null;
  name: string;
  thinkingText: string;
  durationMs?: number;
  showTyping?: boolean;
}) {
  if (!thinkingText.trim()) return null;
  return (
    <details className="group rounded-md border border-border/50 bg-muted/20 px-2 py-1.5 text-[11px] text-muted-foreground/90">
      <summary className="flex cursor-pointer list-none items-center gap-2 opacity-70 [&::-webkit-details-marker]:hidden">
        <ChevronRight className="h-3 w-3 shrink-0 transition group-open:rotate-90" />
        <span className="flex min-w-0 items-center gap-2">
          <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em]">
            Thinking (internal)
          </span>
          {typeof durationMs === "number" ? (
            <span className="inline-flex items-center gap-1 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/90">
              <Clock className="h-3 w-3" />
              {formatDurationLabel(durationMs)}
            </span>
          ) : null}
          {showTyping ? (
            <span className="typing-dots" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
          ) : null}
        </span>
      </summary>
      <div className="mt-2 flex items-start gap-2">
        <AgentAvatar seed={avatarSeed} name={name} avatarUrl={avatarUrl} size={18} />
        <div className="agent-markdown min-w-0 text-foreground/90">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{thinkingText}</ReactMarkdown>
        </div>
      </div>
    </details>
  );
});

const UserMessageCard = memo(function UserMessageCard({
  text,
  timestampMs,
}: {
  text: string;
  timestampMs?: number;
}) {
  return (
    <div className="w-full max-w-[70ch] self-end overflow-hidden rounded-md border border-border/70 bg-primary/10">
      <div className="flex items-center justify-between gap-3 bg-primary/15 px-3 py-1.5">
        <div className="min-w-0 truncate font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground/90">
          You
        </div>
        {typeof timestampMs === "number" ? (
          <time className="shrink-0 rounded-full border border-border/60 bg-card/60 px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/90">
            {formatChatTimestamp(timestampMs)}
          </time>
        ) : null}
      </div>
      <div className="agent-markdown px-3 py-2 text-foreground">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
      </div>
    </div>
  );
});

const AssistantMessageCard = memo(function AssistantMessageCard({
  avatarSeed,
  avatarUrl,
  name,
  timestampMs,
  thinkingText,
  thinkingDurationMs,
  showTypingIndicator,
  contentText,
  streaming,
}: {
  avatarSeed: string;
  avatarUrl: string | null;
  name: string;
  timestampMs?: number;
  thinkingText?: string | null;
  thinkingDurationMs?: number;
  showTypingIndicator?: boolean;
  contentText?: string | null;
  streaming?: boolean;
}) {
  const resolvedTimestamp = typeof timestampMs === "number" ? timestampMs : null;
  const widthClass = resolveAssistantMaxWidthClass(contentText);
  const { intro, artifact, artifactOnly } =
    streaming || !contentText ? { intro: null, artifact: null, artifactOnly: false } : splitArtifactContent(contentText);

  return (
    <div className="w-full self-start">
      <div className={`relative w-full ${widthClass} ${ASSISTANT_GUTTER_CLASS}`}>
        <div className="absolute left-[4px] top-[2px]">
          <AgentAvatar seed={avatarSeed} name={name} avatarUrl={avatarUrl} size={22} />
        </div>
        <div className="flex items-center justify-between gap-3 py-0.5">
          <div className="min-w-0 truncate font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground/90">
            {name}
          </div>
          {resolvedTimestamp !== null ? (
            <time className="shrink-0 rounded-full border border-border/60 bg-card/60 px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/90">
              {formatChatTimestamp(resolvedTimestamp)}
            </time>
          ) : null}
        </div>

        <div className="mt-2 rounded-md border border-border/60 bg-muted/15 px-3 py-2">
          {streaming ? (
            <div
              className="flex items-center gap-2 rounded-md border border-border/60 bg-muted/20 px-2 py-1.5 text-[11px] text-muted-foreground/90"
              role="status"
              aria-live="polite"
              data-testid="agent-typing-indicator"
            >
              <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em]">
                {showTypingIndicator ? "Typing" : "Streaming"}
              </span>
              <span className="typing-dots" aria-hidden="true">
                <span />
                <span />
                <span />
              </span>
            </div>
          ) : null}

          {thinkingText ? (
            <ThinkingDetailsRow
              avatarSeed={avatarSeed}
              avatarUrl={avatarUrl}
              name={name}
              thinkingText={thinkingText}
              durationMs={thinkingDurationMs}
              showTyping={streaming}
            />
          ) : null}

          {contentText ? (
            streaming ? (
              <div className="whitespace-pre-wrap break-words text-foreground">{contentText}</div>
            ) : artifact ? (
              <>
                {!artifactOnly && intro ? (
                  <div className="agent-markdown text-foreground">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{intro}</ReactMarkdown>
                  </div>
                ) : null}
                <div className="group rounded-md border border-border/55 bg-card/35 px-3 py-2">
                  <div className="flex items-center justify-between gap-3 pb-2">
                    <div className="min-w-0 truncate font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/90">
                      Output
                    </div>
                    <button
                      type="button"
                      className="rounded-md border border-border/60 bg-card/60 p-1.5 text-muted-foreground opacity-0 transition hover:bg-muted/50 group-hover:opacity-100"
                      aria-label="Extract output"
                      title="Copy output"
                      onClick={() => {
                        if (!navigator.clipboard?.writeText) return;
                        void navigator.clipboard.writeText(artifact).catch((err) => {
                          console.warn("Failed to copy output to clipboard.", err);
                        });
                      }}
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <div className="agent-markdown text-foreground">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{artifact}</ReactMarkdown>
                  </div>
                </div>
              </>
            ) : (
              <div className="agent-markdown text-foreground">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{contentText}</ReactMarkdown>
              </div>
            )
          ) : null}
        </div>
      </div>
    </div>
  );
});

const AgentChatFinalItems = memo(function AgentChatFinalItems({
  agentId,
  name,
  avatarSeed,
  avatarUrl,
  chatItems,
  running,
  runStartedAt,
}: {
  agentId: string;
  name: string;
  avatarSeed: string;
  avatarUrl: string | null;
  chatItems: AgentChatItem[];
  running: boolean;
  runStartedAt: number | null;
}) {
  let pendingThinking: AgentChatItem | null = null;
  const blocks: Array<
    | { kind: "user"; text: string; timestampMs?: number }
    | {
        kind: "assistant";
        text: string | null;
        timestampMs?: number;
        thinkingText?: string;
        thinkingDurationMs?: number;
      }
    | { kind: "tool"; text: string }
  > = [];

  for (const item of chatItems) {
    if (item.kind === "thinking") {
      pendingThinking = item;
      continue;
    }
    if (item.kind === "user") {
      pendingThinking = null;
      blocks.push({ kind: "user", text: item.text, timestampMs: item.timestampMs });
      continue;
    }
    if (item.kind === "assistant") {
      blocks.push({
        kind: "assistant",
        text: item.text,
        timestampMs: item.timestampMs ?? pendingThinking?.timestampMs,
        thinkingText: pendingThinking?.kind === "thinking" ? pendingThinking.text : undefined,
        thinkingDurationMs:
          item.thinkingDurationMs ??
          (pendingThinking?.kind === "thinking" ? pendingThinking.thinkingDurationMs : undefined),
      });
      pendingThinking = null;
      continue;
    }
    blocks.push({ kind: "tool", text: item.text });
  }

  if (pendingThinking?.kind === "thinking") {
    blocks.push({
      kind: "assistant",
      text: null,
      timestampMs: pendingThinking.timestampMs,
      thinkingText: pendingThinking.text,
      thinkingDurationMs: pendingThinking.thinkingDurationMs,
    });
  }

  return (
    <>
      {blocks.map((block, index) => {
        if (block.kind === "user") {
          return (
            <UserMessageCard
              key={`chat-${agentId}-user-${index}`}
              text={block.text}
              timestampMs={block.timestampMs}
            />
          );
        }
        if (block.kind === "tool") {
          const { summaryText, body } = summarizeToolLabel(block.text);
          return (
            <details
              key={`chat-${agentId}-tool-${index}`}
              className={`w-full ${ASSISTANT_MAX_WIDTH_EXPANDED_CLASS} ${ASSISTANT_GUTTER_CLASS} self-start rounded-md border border-border/60 bg-muted/15 px-2 py-1 text-[11px] text-muted-foreground`}
            >
                <summary className="cursor-pointer select-none font-mono text-[10px] font-semibold uppercase tracking-[0.11em]">
                  {summaryText}
                </summary>
                {body ? (
                  <div className="agent-markdown mt-1 text-foreground">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{body}</ReactMarkdown>
                  </div>
                ) : null}
            </details>
          );
        }
        const streaming = running && index === blocks.length - 1 && !block.text;
        return (
          <AssistantMessageCard
            key={`chat-${agentId}-assistant-${index}`}
            avatarSeed={avatarSeed}
            avatarUrl={avatarUrl}
            name={name}
            timestampMs={block.timestampMs ?? (streaming ? runStartedAt ?? undefined : undefined)}
            thinkingText={block.thinkingText ?? null}
            thinkingDurationMs={block.thinkingDurationMs}
            contentText={block.text}
            streaming={streaming}
          />
        );
      })}
    </>
  );
});

const AgentChatTranscript = memo(function AgentChatTranscript({
  agentId,
  name,
  avatarSeed,
  avatarUrl,
  status,
  chatItems,
  liveThinkingText,
  liveAssistantText,
  showTypingIndicator,
  outputLineCount,
  liveAssistantCharCount,
  liveThinkingCharCount,
  runStartedAt,
  scrollToBottomNextOutputRef,
}: {
  agentId: string;
  name: string;
  avatarSeed: string;
  avatarUrl: string | null;
  status: AgentRecord["status"];
  chatItems: AgentChatItem[];
  liveThinkingText: string;
  liveAssistantText: string;
  showTypingIndicator: boolean;
  outputLineCount: number;
  liveAssistantCharCount: number;
  liveThinkingCharCount: number;
  runStartedAt: number | null;
  scrollToBottomNextOutputRef: MutableRefObject<boolean>;
}) {
  const chatRef = useRef<HTMLDivElement | null>(null);
  const chatBottomRef = useRef<HTMLDivElement | null>(null);
  const scrollFrameRef = useRef<number | null>(null);
  const pinnedRef = useRef(true);
  const [isPinned, setIsPinned] = useState(true);

  const scrollChatToBottom = useCallback(() => {
    if (!chatRef.current) return;
    if (chatBottomRef.current) {
      chatBottomRef.current.scrollIntoView({ block: "end" });
      return;
    }
    chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, []);

  const setPinned = useCallback((nextPinned: boolean) => {
    if (pinnedRef.current === nextPinned) return;
    pinnedRef.current = nextPinned;
    setIsPinned(nextPinned);
  }, []);

  const updatePinnedFromScroll = useCallback(() => {
    const el = chatRef.current;
    if (!el) return;
    setPinned(
      isNearBottom(
        {
          scrollTop: el.scrollTop,
          scrollHeight: el.scrollHeight,
          clientHeight: el.clientHeight,
        },
        48
      )
    );
  }, [setPinned]);

  const scheduleScrollToBottom = useCallback(() => {
    if (scrollFrameRef.current !== null) return;
    scrollFrameRef.current = requestAnimationFrame(() => {
      scrollFrameRef.current = null;
      scrollChatToBottom();
    });
  }, [scrollChatToBottom]);

  useEffect(() => {
    updatePinnedFromScroll();
  }, [updatePinnedFromScroll]);

  const showJumpToLatest =
    !isPinned && (outputLineCount > 0 || liveAssistantCharCount > 0 || liveThinkingCharCount > 0);

  useEffect(() => {
    const shouldForceScroll = scrollToBottomNextOutputRef.current;
    if (shouldForceScroll) {
      scrollToBottomNextOutputRef.current = false;
      scheduleScrollToBottom();
      return;
    }

    if (pinnedRef.current) {
      scheduleScrollToBottom();
      return;
    }
  }, [
    liveAssistantCharCount,
    liveThinkingCharCount,
    outputLineCount,
    scheduleScrollToBottom,
    scrollToBottomNextOutputRef,
  ]);

  useEffect(() => {
    return () => {
      if (scrollFrameRef.current !== null) {
        cancelAnimationFrame(scrollFrameRef.current);
        scrollFrameRef.current = null;
      }
    };
  }, []);

  return (
    <div className="relative flex-1 overflow-hidden rounded-md border border-border/80 bg-card/75">
      <div
        ref={chatRef}
        data-testid="agent-chat-scroll"
        className="h-full overflow-auto p-3 sm:p-4"
        onScroll={() => updatePinnedFromScroll()}
        onWheel={(event) => {
          event.stopPropagation();
        }}
        onWheelCapture={(event) => {
          event.stopPropagation();
        }}
      >
        <div className="relative flex flex-col gap-3 text-xs text-foreground">
          <div aria-hidden className={`pointer-events-none absolute ${SPINE_LEFT} top-0 bottom-0 w-px bg-border/40`} />
          {chatItems.length === 0 ? (
            <EmptyStatePanel title="No messages yet." compact className="p-3 text-xs" />
          ) : (
            <>
              <AgentChatFinalItems
                agentId={agentId}
                name={name}
                avatarSeed={avatarSeed}
                avatarUrl={avatarUrl}
                chatItems={chatItems}
                running={status === "running"}
                runStartedAt={runStartedAt}
              />
              {liveThinkingText || liveAssistantText || showTypingIndicator ? (
                <AssistantMessageCard
                  avatarSeed={avatarSeed}
                  avatarUrl={avatarUrl}
                  name={name}
                  timestampMs={runStartedAt ?? undefined}
                  thinkingText={liveThinkingText || null}
                  thinkingDurationMs={
                    typeof runStartedAt === "number" ? Math.max(0, Date.now() - runStartedAt) : undefined
                  }
                  showTypingIndicator={showTypingIndicator}
                  contentText={liveAssistantText || null}
                  streaming={status === "running"}
                />
              ) : null}
              <div ref={chatBottomRef} />
            </>
          )}
        </div>
      </div>

      {showJumpToLatest ? (
        <button
          type="button"
          className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-md border border-border/80 bg-card/95 px-3 py-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-foreground shadow-sm transition hover:bg-muted/70"
          onClick={() => {
            setPinned(true);
            scrollChatToBottom();
          }}
          aria-label="Jump to latest"
        >
          Jump to latest
        </button>
      ) : null}
    </div>
  );
});

const AgentChatComposer = memo(function AgentChatComposer({
  value,
  onChange,
  onKeyDown,
  onSend,
  onStop,
  canSend,
  stopBusy,
  running,
  sendDisabled,
  inputRef,
}: {
  value: string;
  onChange: (event: ChangeEvent<HTMLTextAreaElement>) => void;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onSend: () => void;
  onStop: () => void;
  canSend: boolean;
  stopBusy: boolean;
  running: boolean;
  sendDisabled: boolean;
  inputRef: (el: HTMLTextAreaElement | HTMLInputElement | null) => void;
}) {
  return (
    <div className="flex items-end gap-2">
      <textarea
        ref={inputRef}
        rows={1}
        value={value}
        className="flex-1 resize-none rounded-md border border-border/80 bg-card/75 px-3 py-2 text-[11px] text-foreground outline-none transition focus:border-ring"
        onChange={onChange}
        onKeyDown={onKeyDown}
        placeholder="type a message"
      />
      {running ? (
        <button
          className="rounded-md border border-border/80 bg-card/70 px-3 py-2 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-foreground shadow-sm transition hover:bg-muted/70 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground disabled:shadow-none"
          type="button"
          onClick={onStop}
          disabled={!canSend || stopBusy}
        >
          {stopBusy ? "Stopping" : "Stop"}
        </button>
      ) : null}
      <button
        className="rounded-md border border-transparent bg-primary px-3 py-2 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-primary-foreground shadow-sm transition hover:brightness-110 disabled:cursor-not-allowed disabled:border-border disabled:bg-muted disabled:text-muted-foreground disabled:shadow-none"
        type="button"
        onClick={onSend}
        disabled={sendDisabled}
      >
        Send
      </button>
    </div>
  );
});

export const AgentChatPanel = ({
  agent,
  isSelected,
  canSend,
  models,
  stopBusy,
  onOpenSettings,
  onModelChange,
  onThinkingChange,
  onDraftChange,
  onSend,
  onStopRun,
  onAvatarShuffle,
}: AgentChatPanelProps) => {
  const [draftValue, setDraftValue] = useState(agent.draft);
  const draftRef = useRef<HTMLTextAreaElement | null>(null);
  const scrollToBottomNextOutputRef = useRef(false);
  const plainDraftRef = useRef(agent.draft);
  const pendingResizeFrameRef = useRef<number | null>(null);

  const resizeDraft = useCallback(() => {
    const el = draftRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
    el.style.overflowY = el.scrollHeight > el.clientHeight ? "auto" : "hidden";
  }, []);

  const handleDraftRef = useCallback((el: HTMLTextAreaElement | HTMLInputElement | null) => {
    draftRef.current = el instanceof HTMLTextAreaElement ? el : null;
  }, []);

  useEffect(() => {
    if (agent.draft === plainDraftRef.current) return;
    plainDraftRef.current = agent.draft;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDraftValue(agent.draft);
  }, [agent.draft]);

  useEffect(() => {
    if (pendingResizeFrameRef.current !== null) {
      cancelAnimationFrame(pendingResizeFrameRef.current);
    }
    pendingResizeFrameRef.current = requestAnimationFrame(() => {
      pendingResizeFrameRef.current = null;
      resizeDraft();
    });
    return () => {
      if (pendingResizeFrameRef.current !== null) {
        cancelAnimationFrame(pendingResizeFrameRef.current);
        pendingResizeFrameRef.current = null;
      }
    };
  }, [resizeDraft, draftValue]);

  const handleSend = useCallback(
    (message: string) => {
      if (!canSend || agent.status === "running") return;
      const trimmed = message.trim();
      if (!trimmed) return;
      scrollToBottomNextOutputRef.current = true;
      onSend(trimmed);
    },
    [agent.status, canSend, onSend]
  );

  const statusColor =
    agent.status === "running"
      ? "border border-primary/30 bg-primary/15 text-foreground"
      : agent.status === "error"
        ? "border border-destructive/35 bg-destructive/12 text-destructive"
        : "border border-border/70 bg-muted text-muted-foreground";
  const statusLabel =
    agent.status === "running"
      ? "Running"
      : agent.status === "error"
        ? "Error"
        : "Idle";

  const chatItems = useMemo(
    () =>
      buildFinalAgentChatItems({
        outputLines: agent.outputLines,
        showThinkingTraces: agent.showThinkingTraces,
        toolCallingEnabled: agent.toolCallingEnabled,
      }),
    [agent.outputLines, agent.showThinkingTraces, agent.toolCallingEnabled]
  );
  const liveAssistantText = agent.streamText ? normalizeAssistantDisplayText(agent.streamText) : "";
  const liveThinkingText =
    agent.showThinkingTraces && agent.thinkingTrace ? agent.thinkingTrace.trim() : "";
  const hasLiveAssistantText = Boolean(liveAssistantText.trim());
  const hasVisibleLiveThinking = Boolean(liveThinkingText.trim());
  const latestUserOutputIndex = useMemo(() => {
    let latestUserIndex = -1;
    for (let index = agent.outputLines.length - 1; index >= 0; index -= 1) {
      const line = agent.outputLines[index]?.trim();
      if (!line) continue;
      if (line.startsWith(">")) {
        latestUserIndex = index;
        break;
      }
    }
    return latestUserIndex;
  }, [agent.outputLines]);
  const hasSavedThinkingSinceLatestUser = useMemo(() => {
    if (!agent.showThinkingTraces || latestUserOutputIndex < 0) return false;
    for (
      let index = latestUserOutputIndex + 1;
      index < agent.outputLines.length;
      index += 1
    ) {
      if (isTraceMarkdown(agent.outputLines[index] ?? "")) {
        return true;
      }
    }
    return false;
  }, [agent.outputLines, agent.showThinkingTraces, latestUserOutputIndex]);
  const showTypingIndicator =
    agent.status === "running" &&
    !hasLiveAssistantText &&
    !hasVisibleLiveThinking &&
    !hasSavedThinkingSinceLatestUser;

  const modelOptions = useMemo(
    () =>
      models.map((entry) => ({
        value: `${entry.provider}/${entry.id}`,
        label:
          entry.name === `${entry.provider}/${entry.id}`
            ? entry.name
            : `${entry.name} (${entry.provider}/${entry.id})`,
        reasoning: entry.reasoning,
      })),
    [models]
  );
  const modelValue = agent.model ?? "";
  const modelOptionsWithFallback =
    modelValue && !modelOptions.some((option) => option.value === modelValue)
      ? [{ value: modelValue, label: modelValue, reasoning: undefined }, ...modelOptions]
      : modelOptions;
  const selectedModel = modelOptionsWithFallback.find((option) => option.value === modelValue);
  const allowThinking = selectedModel?.reasoning !== false;

  const avatarSeed = agent.avatarSeed ?? agent.agentId;
  const running = agent.status === "running";
  const sendDisabled = !canSend || running || !draftValue.trim();

  const handleComposerChange = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => {
      const value = event.target.value;
      plainDraftRef.current = value;
      setDraftValue(value);
      onDraftChange(value);
    },
    [onDraftChange]
  );

  const handleComposerKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key !== "Enter" || event.shiftKey) return;
      if (event.defaultPrevented) return;
      event.preventDefault();
      handleSend(draftValue);
    },
    [draftValue, handleSend]
  );

  const handleComposerSend = useCallback(() => {
    handleSend(draftValue);
  }, [draftValue, handleSend]);

  return (
    <div data-agent-panel className="group fade-up relative flex h-full w-full flex-col">
      <div className="px-3 pt-3 sm:px-4 sm:pt-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <div className="group/avatar relative">
              <AgentAvatar
                seed={avatarSeed}
                name={agent.name}
                avatarUrl={agent.avatarUrl ?? null}
                size={96}
                isSelected={isSelected}
              />
              <button
                className="nodrag pointer-events-none absolute bottom-1 right-1 flex h-7 w-7 items-center justify-center rounded-full border border-border/80 bg-card/90 text-muted-foreground opacity-0 shadow-sm transition group-focus-within/avatar:pointer-events-auto group-focus-within/avatar:opacity-100 group-hover/avatar:pointer-events-auto group-hover/avatar:opacity-100 hover:border-border hover:bg-muted/65"
                type="button"
                aria-label="Shuffle avatar"
                data-testid="agent-avatar-shuffle"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onAvatarShuffle();
                }}
              >
                <Shuffle className="h-3.5 w-3.5" />
              </button>
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-2">
                <div className="min-w-0 truncate text-xs font-semibold uppercase tracking-[0.16em] text-foreground sm:text-sm">
                  {agent.name}
                </div>
                <span aria-hidden className="shrink-0 text-[11px] text-muted-foreground/80">
                  •
                </span>
                <span
                  className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-[0.14em] ${statusColor}`}
                >
                  {statusLabel}
                </span>
              </div>

              <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_128px]">
                <label className="flex min-w-0 flex-col gap-1 font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  <span>Model</span>
                  <select
                    className="h-8 w-full min-w-0 overflow-hidden text-ellipsis whitespace-nowrap rounded-md border border-border bg-card/75 px-2 text-[11px] font-semibold text-foreground"
                    aria-label="Model"
                    value={modelValue}
                    onChange={(event) => {
                      const value = event.target.value.trim();
                      onModelChange(value ? value : null);
                    }}
                  >
                    {modelOptionsWithFallback.length === 0 ? (
                      <option value="">No models found</option>
                    ) : null}
                    {modelOptionsWithFallback.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                {allowThinking ? (
                  <label className="flex flex-col gap-1 font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                    <span>Thinking</span>
                    <select
                      className="h-8 rounded-md border border-border bg-card/75 px-2 text-[11px] font-semibold text-foreground"
                      aria-label="Thinking"
                      value={agent.thinkingLevel ?? ""}
                      onChange={(event) => {
                        const value = event.target.value.trim();
                        onThinkingChange(value ? value : null);
                      }}
                    >
                      <option value="">Default</option>
                      <option value="off">Off</option>
                      <option value="minimal">Minimal</option>
                      <option value="low">Low</option>
                      <option value="medium">Medium</option>
                      <option value="high">High</option>
                      <option value="xhigh">XHigh</option>
                    </select>
                  </label>
                ) : (
                  <div />
                )}
              </div>
            </div>
          </div>

          <button
            className="nodrag mt-0.5 flex h-9 w-9 items-center justify-center rounded-md border border-border/80 bg-card/60 text-muted-foreground transition hover:border-border hover:bg-muted/65"
            type="button"
            data-testid="agent-settings-toggle"
            aria-label="Open agent settings"
            title="Agent settings"
            onClick={onOpenSettings}
          >
            <Cog className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="mt-3 flex min-h-0 flex-1 flex-col gap-3 px-3 pb-3 sm:px-4 sm:pb-4">
        <AgentChatTranscript
          agentId={agent.agentId}
          name={agent.name}
          avatarSeed={avatarSeed}
          avatarUrl={agent.avatarUrl ?? null}
          status={agent.status}
          chatItems={chatItems}
          liveThinkingText={liveThinkingText}
          liveAssistantText={liveAssistantText}
          showTypingIndicator={showTypingIndicator}
          outputLineCount={agent.outputLines.length}
          liveAssistantCharCount={agent.streamText?.length ?? 0}
          liveThinkingCharCount={agent.thinkingTrace?.length ?? 0}
          runStartedAt={agent.runStartedAt}
          scrollToBottomNextOutputRef={scrollToBottomNextOutputRef}
        />

        <AgentChatComposer
          value={draftValue}
          inputRef={handleDraftRef}
          onChange={handleComposerChange}
          onKeyDown={handleComposerKeyDown}
          onSend={handleComposerSend}
          onStop={onStopRun}
          canSend={canSend}
          stopBusy={stopBusy}
          running={running}
          sendDisabled={sendDisabled}
        />
      </div>
    </div>
  );
};
