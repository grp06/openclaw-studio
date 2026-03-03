import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { AgentState } from "@/features/agents/state/store";
import { AgentChatPanel } from "@/features/agents/components/AgentChatPanel";
import type { GatewayModelChoice } from "@/lib/gateway/models";

const createAgent = (): AgentState => ({
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
});

describe("AgentChatPanel scrolling", () => {
  const models: GatewayModelChoice[] = [{ provider: "openai", id: "gpt-5", name: "gpt-5" }];

  afterEach(() => {
    cleanup();
    delete (Element.prototype as unknown as { scrollIntoView?: unknown }).scrollIntoView;
  });

  it("shows jump-to-latest when unpinned and new output arrives, and jumps on click", async () => {
    (Element.prototype as unknown as { scrollIntoView: unknown }).scrollIntoView = vi.fn();

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

    expect(
      (Element.prototype as unknown as { scrollIntoView: ReturnType<typeof vi.fn> })
        .scrollIntoView
    ).toHaveBeenCalled();
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
});
