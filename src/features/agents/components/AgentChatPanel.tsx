import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AgentState as AgentRecord } from "@/features/agents/state/store";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Cog, Shuffle } from "lucide-react";
import type { GatewayModelChoice } from "@/lib/gateway/models";
import { isToolMarkdown, isTraceMarkdown } from "@/lib/text/message-extract";
import { AgentAvatar } from "./AgentAvatar";
import { buildAgentChatItems, summarizeToolLabel } from "./chatItems";
import { EmptyStatePanel } from "./EmptyStatePanel";

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
  const chatRef = useRef<HTMLDivElement | null>(null);
  const chatBottomRef = useRef<HTMLDivElement | null>(null);
  const scrollToBottomNextOutputRef = useRef(false);
  const plainDraftRef = useRef(agent.draft);

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
    resizeDraft();
  }, [resizeDraft, agent.draft]);

  const scrollChatToBottom = useCallback(() => {
    if (!chatRef.current) return;
    if (chatBottomRef.current) {
      chatBottomRef.current.scrollIntoView({ block: "end" });
      return;
    }
    chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, []);

  useEffect(() => {
    if (!scrollToBottomNextOutputRef.current) return;
    scrollToBottomNextOutputRef.current = false;
    requestAnimationFrame(() => {
      scrollChatToBottom();
    });
  }, [agent.outputLines.length, scrollChatToBottom]);

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
        : "Waiting for direction";

  const chatItems = useMemo(
    () =>
      buildAgentChatItems({
        outputLines: agent.outputLines,
        streamText: agent.streamText,
        liveThinkingTrace: agent.thinkingTrace?.trim() ?? "",
        showThinkingTraces: agent.showThinkingTraces,
        toolCallingEnabled: agent.toolCallingEnabled,
      }),
    [
      agent.outputLines,
      agent.streamText,
      agent.thinkingTrace,
      agent.showThinkingTraces,
      agent.toolCallingEnabled,
    ]
  );
  const hasLiveAssistantText = Boolean(agent.streamText?.trim());
  const hasVisibleLiveThinking =
    agent.showThinkingTraces && Boolean(agent.thinkingTrace?.trim());
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
  const hasSavedAssistantSinceLatestUser = useMemo(() => {
    if (latestUserOutputIndex < 0) return false;
    for (
      let index = latestUserOutputIndex + 1;
      index < agent.outputLines.length;
      index += 1
    ) {
      const line = agent.outputLines[index]?.trim() ?? "";
      if (!line) continue;
      if (line.startsWith(">")) continue;
      if (isTraceMarkdown(line)) continue;
      if (isToolMarkdown(line)) continue;
      return true;
    }
    return false;
  }, [agent.outputLines, latestUserOutputIndex]);
  const lastThinkingItemIndex = useMemo(() => {
    for (let index = chatItems.length - 1; index >= 0; index -= 1) {
      if (chatItems[index]?.kind === "thinking") {
        return index;
      }
    }
    return -1;
  }, [chatItems]);
  const autoExpandThinking =
    agent.status === "running" &&
    !hasSavedAssistantSinceLatestUser &&
    lastThinkingItemIndex >= 0;
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
  return (
    <div data-agent-panel className="group fade-up relative flex h-full w-full flex-col">
      <div className="px-3 pt-3 sm:px-4 sm:pt-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="relative">
              <AgentAvatar
                seed={avatarSeed}
                name={agent.name}
                avatarUrl={agent.avatarUrl ?? null}
                size={96}
                isSelected={isSelected}
              />
              <button
                className="nodrag absolute -bottom-2 -right-2 flex h-8 w-8 items-center justify-center rounded-md border border-border/80 bg-card text-muted-foreground shadow-sm transition hover:border-border hover:bg-muted/65"
                type="button"
                aria-label="Shuffle avatar"
                data-testid="agent-avatar-shuffle"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onAvatarShuffle();
                }}
              >
                <Shuffle className="h-4 w-4" />
              </button>
            </div>
            <div className="flex flex-col gap-2">
              <div
                className={`flex items-center gap-2 rounded-md border bg-card/80 px-3 py-1 shadow-sm ${
                  isSelected ? "agent-name-selected" : "border-border"
                }`}
              >
                <div className="w-full text-center text-xs font-semibold uppercase tracking-[0.16em] text-foreground">
                  {agent.name}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`rounded-md px-2 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-[0.14em] ${statusColor}`}
                >
                  {statusLabel}
                </span>
                <button
                  className="nodrag flex h-9 w-9 items-center justify-center rounded-md border border-border/80 bg-card/60 text-muted-foreground transition hover:border-border hover:bg-muted/65"
                  type="button"
                  data-testid="agent-settings-toggle"
                  aria-label="Open agent settings"
                  title="Agent settings"
                  onClick={onOpenSettings}
                >
                  <Cog className="h-4 w-4" />
                </button>
              </div>
              <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_128px]">
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
        </div>
      </div>

      <div className="mt-3 flex min-h-0 flex-1 flex-col gap-3 px-3 pb-3 sm:px-4 sm:pb-4">
        <div
          ref={chatRef}
          className="flex-1 overflow-auto rounded-md border border-border/80 bg-card/75 p-3 sm:p-4"
          onWheel={(event) => {
            event.stopPropagation();
          }}
          onWheelCapture={(event) => {
            event.stopPropagation();
          }}
        >
          <div className="flex flex-col gap-3 text-xs text-foreground">
            {chatItems.length === 0 ? (
              <EmptyStatePanel title="No messages yet." compact className="p-3 text-xs" />
            ) : (
              <>
                {chatItems.map((item, index) => {
                  if (item.kind === "thinking") {
                    return (
                      <details
                        key={`chat-${agent.agentId}-thinking-${index}`}
                        className="rounded-md border border-border/70 bg-muted/55 text-[11px] text-muted-foreground"
                        open={autoExpandThinking && index === lastThinkingItemIndex}
                      >
                        <summary className="flex cursor-pointer list-none items-center gap-2 px-2 py-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.11em] [&::-webkit-details-marker]:hidden">
                          <AgentAvatar
                            seed={avatarSeed}
                            name={agent.name}
                            avatarUrl={agent.avatarUrl ?? null}
                            size={22}
                          />
                          <span>Thinking</span>
                          {agent.status === "running" && item.live ? (
                            <span className="typing-dots" aria-hidden="true">
                              <span />
                              <span />
                              <span />
                            </span>
                          ) : null}
                        </summary>
                        <div className="agent-markdown px-2 pb-2 text-foreground">
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>
                            {item.text}
                          </ReactMarkdown>
                        </div>
                      </details>
                    );
                  }
                  if (item.kind === "user") {
                    return (
                      <div
                        key={`chat-${agent.agentId}-user-${index}`}
                        className="rounded-md border border-border/70 bg-muted/70 px-3 py-2 text-foreground"
                      >
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{`> ${item.text}`}</ReactMarkdown>
                      </div>
                    );
                  }
                  if (item.kind === "tool") {
                    const { summaryText, body } = summarizeToolLabel(item.text);
                    return (
                      <details
                        key={`chat-${agent.agentId}-tool-${index}`}
                        className="rounded-md border border-border/70 bg-muted/55 px-2 py-1 text-[11px] text-muted-foreground"
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
                  return (
                    <div
                      key={`chat-${agent.agentId}-assistant-${index}`}
                      className={`agent-markdown rounded-md border border-transparent px-0.5 ${item.live ? "opacity-85" : ""}`}
                    >
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{item.text}</ReactMarkdown>
                    </div>
                  );
                })}
                {showTypingIndicator ? (
                  <div
                    className="flex items-center gap-2 rounded-md border border-border/70 bg-muted/55 px-2 py-1.5 text-[11px] text-muted-foreground"
                    role="status"
                    aria-live="polite"
                    data-testid="agent-typing-indicator"
                  >
                    <AgentAvatar
                      seed={avatarSeed}
                      name={agent.name}
                      avatarUrl={agent.avatarUrl ?? null}
                      size={22}
                    />
                    <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.11em]">
                      Thinking
                    </span>
                    <span className="typing-dots" aria-hidden="true">
                      <span />
                      <span />
                      <span />
                    </span>
                  </div>
                ) : null}
                <div ref={chatBottomRef} />
              </>
            )}
          </div>
        </div>

        <div className="flex items-end gap-2">
          <textarea
            ref={handleDraftRef}
            rows={1}
            value={draftValue}
            className="flex-1 resize-none rounded-md border border-border/80 bg-card/75 px-3 py-2 text-[11px] text-foreground outline-none transition focus:border-ring"
            onChange={(event) => {
              const value = event.target.value;
              plainDraftRef.current = value;
              setDraftValue(value);
              onDraftChange(value);
              resizeDraft();
            }}
            onKeyDown={(event) => {
              if (event.key !== "Enter" || event.shiftKey) return;
              if (event.defaultPrevented) return;
              event.preventDefault();
              handleSend(draftValue);
            }}
            placeholder="type a message"
          />
          {agent.status === "running" ? (
            <button
              className="rounded-md border border-border/80 bg-card/70 px-3 py-2 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-foreground shadow-sm transition hover:bg-muted/70 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground disabled:shadow-none"
              type="button"
              onClick={onStopRun}
              disabled={!canSend || stopBusy}
            >
              {stopBusy ? "Stopping" : "Stop"}
            </button>
          ) : null}
          <button
            className="rounded-md border border-transparent bg-primary px-3 py-2 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-primary-foreground shadow-sm transition hover:brightness-110 disabled:cursor-not-allowed disabled:border-border disabled:bg-muted disabled:text-muted-foreground disabled:shadow-none"
            type="button"
            onClick={() => handleSend(draftValue)}
            disabled={!canSend || agent.status === "running" || !draftValue.trim()}
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
};
