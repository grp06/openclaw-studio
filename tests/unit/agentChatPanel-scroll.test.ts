import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { AgentState } from "@/features/agents/state/store";
import { AgentChatPanel } from "@/features/agents/components/AgentChatPanel";
import type { GatewayModelChoice } from "@/lib/gateway/models";

const createAgent = (overrides: Partial<AgentState> = {}): AgentState => ({
  agentId: "agent-1",
  name: "Agent One",
  sessionKey: "agent:agent-1:studio:test-session",
  status: "idle",
  sessionCreated: true,
  awaitingUserInput: false,
  hasUnseenActivity: false,
  outputLines: [],
  lastResult: null,
  lastDiff: null,
  runId: null,
  runStartedAt: null,
  streamText: null,
  thinkingTrace: null,
  latestOverride: null,
  latestOverrideKind: null,
  lastAssistantMessageAt: null,
  lastActivityAt: null,
  latestPreview: null,
  lastUserMessage: null,
  draft: "",
  sessionSettingsSynced: true,
  historyLoadedAt: null,
  historyFetchLimit: null,
  historyFetchedCount: null,
  historyMaybeTruncated: false,
  toolCallingEnabled: true,
  showThinkingTraces: true,
  model: null,
  thinkingLevel: null,
  avatarSeed: "seed-1",
  avatarUrl: null,
  ...overrides,
});

describe("AgentChatPanel scrolling", () => {
  const models: GatewayModelChoice[] = [{ provider: "openai", id: "gpt-5", name: "gpt-5" }];

  afterEach(() => {
    cleanup();
    delete (Element.prototype as unknown as { scrollIntoView?: unknown }).scrollIntoView;
  });

  it("shows jump-to-latest when unpinned and new output arrives, and jumps on click", async () => {
    const scrollIntoView = vi.fn();
    (Element.prototype as unknown as { scrollIntoView: unknown }).scrollIntoView = scrollIntoView;

    const agent = createAgent();
    const { rerender } = render(
      createElement(AgentChatPanel, {
        agent: { ...agent, outputLines: ["> hello", "first answer"] },
        isSelected: true,
        canSend: true,
        models,
        stopBusy: false,
        onLoadMoreHistory: vi.fn(),
        onOpenSettings: vi.fn(),
        onModelChange: vi.fn(),
        onThinkingChange: vi.fn(),
        onDraftChange: vi.fn(),
        onSend: vi.fn(),
        onStopRun: vi.fn(),
        onAvatarShuffle: vi.fn(),
      })
    );

    const scrollEl = screen.getByTestId("agent-chat-scroll");
    Object.defineProperty(scrollEl, "clientHeight", { value: 100, configurable: true });
    Object.defineProperty(scrollEl, "scrollHeight", { value: 1000, configurable: true });
    Object.defineProperty(scrollEl, "scrollTop", { value: 0, writable: true, configurable: true });

    fireEvent.scroll(scrollEl);

    rerender(
      createElement(AgentChatPanel, {
        agent: { ...agent, outputLines: ["> hello", "first answer", "second answer"] },
        isSelected: true,
        canSend: true,
        models,
        stopBusy: false,
        onLoadMoreHistory: vi.fn(),
        onOpenSettings: vi.fn(),
        onModelChange: vi.fn(),
        onThinkingChange: vi.fn(),
        onDraftChange: vi.fn(),
        onSend: vi.fn(),
        onStopRun: vi.fn(),
        onAvatarShuffle: vi.fn(),
      })
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Jump to latest" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Jump to latest" }));

    expect(scrollEl.scrollTop).toBe(1000);
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it("scrolls to the bottom when a different agent is opened", async () => {
    const scrollIntoView = vi.fn();
    (Element.prototype as unknown as { scrollIntoView: unknown }).scrollIntoView = scrollIntoView;

    const { rerender } = render(
      createElement(AgentChatPanel, {
        agent: createAgent({
          outputLines: ["> hello", "first answer"],
        }),
        isSelected: true,
        canSend: true,
        models,
        stopBusy: false,
        onLoadMoreHistory: vi.fn(),
        onOpenSettings: vi.fn(),
        onModelChange: vi.fn(),
        onThinkingChange: vi.fn(),
        onDraftChange: vi.fn(),
        onSend: vi.fn(),
        onStopRun: vi.fn(),
        onAvatarShuffle: vi.fn(),
      })
    );

    const scrollEl = screen.getByTestId("agent-chat-scroll");
    Object.defineProperty(scrollEl, "clientHeight", { value: 100, configurable: true });
    Object.defineProperty(scrollEl, "scrollHeight", { value: 1000, configurable: true });
    Object.defineProperty(scrollEl, "scrollTop", { value: 0, writable: true, configurable: true });

    rerender(
      createElement(AgentChatPanel, {
        agent: createAgent({
          agentId: "agent-2",
          name: "Agent Two",
          sessionKey: "agent:agent-2:studio:test-session",
          outputLines: ["> another", "reply"],
        }),
        isSelected: true,
        canSend: true,
        models,
        stopBusy: false,
        onLoadMoreHistory: vi.fn(),
        onOpenSettings: vi.fn(),
        onModelChange: vi.fn(),
        onThinkingChange: vi.fn(),
        onDraftChange: vi.fn(),
        onSend: vi.fn(),
        onStopRun: vi.fn(),
        onAvatarShuffle: vi.fn(),
      })
    );

    await waitFor(() => {
      expect(scrollEl.scrollTop).toBe(1000);
    });
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it("shows history truncation banner only when scrolled to top", () => {
    const agent = createAgent();
    render(
      createElement(AgentChatPanel, {
        agent: {
          ...agent,
          historyMaybeTruncated: true,
          historyFetchedCount: 200,
          historyFetchLimit: 200,
          outputLines: ["> hello", "response"],
        },
        isSelected: true,
        canSend: true,
        models,
        stopBusy: false,
        onLoadMoreHistory: vi.fn(),
        onOpenSettings: vi.fn(),
        onModelChange: vi.fn(),
        onThinkingChange: vi.fn(),
        onDraftChange: vi.fn(),
        onSend: vi.fn(),
        onStopRun: vi.fn(),
        onAvatarShuffle: vi.fn(),
      })
    );

    const scrollEl = screen.getByTestId("agent-chat-scroll");
    Object.defineProperty(scrollEl, "clientHeight", { value: 100, configurable: true });
    Object.defineProperty(scrollEl, "scrollHeight", { value: 1000, configurable: true });
    Object.defineProperty(scrollEl, "scrollTop", { value: 120, writable: true, configurable: true });

    fireEvent.scroll(scrollEl);
    expect(screen.queryByText(/Showing latest 200 turns/i)).not.toBeInTheDocument();

    scrollEl.scrollTop = 0;
    fireEvent.scroll(scrollEl);
    expect(screen.getByText(/Showing latest 200 turns/i)).toBeInTheDocument();
  });

  it("keeps the transcript pinned to the chat container when sending", async () => {
    const scrollIntoView = vi.fn();
    (Element.prototype as unknown as { scrollIntoView: unknown }).scrollIntoView = scrollIntoView;
    const onSend = vi.fn();
    const agent = createAgent({
      draft: "Investigate the scroll jump",
      outputLines: ["> earlier question", "earlier answer"],
    });
    const { rerender } = render(
      createElement(AgentChatPanel, {
        agent,
        isSelected: true,
        canSend: true,
        models,
        stopBusy: false,
        onLoadMoreHistory: vi.fn(),
        onOpenSettings: vi.fn(),
        onModelChange: vi.fn(),
        onThinkingChange: vi.fn(),
        onDraftChange: vi.fn(),
        onSend,
        onStopRun: vi.fn(),
        onAvatarShuffle: vi.fn(),
      })
    );

    const scrollEl = screen.getByTestId("agent-chat-scroll");
    Object.defineProperty(scrollEl, "clientHeight", { value: 100, configurable: true });
    Object.defineProperty(scrollEl, "scrollHeight", { value: 1000, writable: true, configurable: true });
    Object.defineProperty(scrollEl, "scrollTop", { value: 900, writable: true, configurable: true });

    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(onSend).toHaveBeenCalledWith("Investigate the scroll jump");

    Object.defineProperty(scrollEl, "scrollHeight", { value: 1040, writable: true, configurable: true });

    rerender(
      createElement(AgentChatPanel, {
        agent: {
          ...agent,
          draft: "",
          outputLines: ["> earlier question", "earlier answer", "> Investigate the scroll jump"],
        },
        isSelected: true,
        canSend: true,
        models,
        stopBusy: false,
        onLoadMoreHistory: vi.fn(),
        onOpenSettings: vi.fn(),
        onModelChange: vi.fn(),
        onThinkingChange: vi.fn(),
        onDraftChange: vi.fn(),
        onSend,
        onStopRun: vi.fn(),
        onAvatarShuffle: vi.fn(),
      })
    );

    await waitFor(() => {
      expect(scrollEl.scrollTop).toBe(1040);
    });
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});
