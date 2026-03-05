import { createElement } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { AgentChatPanel } from "@/features/agents/components/AgentChatPanel";
import type { AgentState } from "@/features/agents/state/store";

const createAgent = (overrides?: Partial<AgentState>): AgentState => ({
  agentId: "agent-1",
  name: "Agent One",
  sessionKey: "agent:agent-1:main",
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
  previewItems: [],
  draft: "",
  queuedMessages: [],
  sessionSettingsSynced: true,
  historyLoadedAt: null,
  historyFetchLimit: null,
  historyFetchedCount: null,
  historyMaybeTruncated: false,
  historyHasMore: false,
  historyGatewayCapReached: false,
  toolCallingEnabled: true,
  showThinkingTraces: true,
  model: "openai/gpt-5",
  thinkingLevel: "medium",
  avatarSeed: "seed-1",
  avatarUrl: null,
  ...(overrides ?? {}),
});

const renderPanel = (agent: AgentState) => {
  render(
    createElement(AgentChatPanel, {
      agent,
      isSelected: true,
      canSend: true,
      models: [],
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
};

describe("AgentChatPanel provisional rendering", () => {
  beforeAll(() => {
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      value: vi.fn(),
      writable: true,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("renders provisional user then assistant cards when transcript is empty", () => {
    renderPanel(
      createAgent({
        outputLines: [],
        lastUserMessage: "Investigate latency spikes",
        latestPreview: "I can help analyze the bottleneck.",
      })
    );

    const provisionalUser = screen.getByTestId("agent-provisional-user");
    const provisionalAssistant = screen.getByTestId("agent-provisional-assistant");
    expect(provisionalUser).toHaveTextContent("Investigate latency spikes");
    expect(provisionalAssistant).toHaveTextContent("I can help analyze the bottleneck.");

    const position = provisionalUser.compareDocumentPosition(provisionalAssistant);
    expect((position & Node.DOCUMENT_POSITION_FOLLOWING) !== 0).toBe(true);
  });

  it("renders multiple provisional messages from preview items before history hydration", () => {
    renderPanel(
      createAgent({
        outputLines: [],
        previewItems: [
          { role: "user", text: "first user" },
          { role: "assistant", text: "first assistant" },
          { role: "user", text: "second user" },
          { role: "assistant", text: "second assistant" },
        ],
      })
    );

    expect(screen.getByText("first user")).toBeTruthy();
    expect(screen.getByText("first assistant")).toBeTruthy();
    expect(screen.getByText("second user")).toBeTruthy();
    expect(screen.getByText("second assistant")).toBeTruthy();
  });

  it("falls back to intro card when transcript and preview fields are empty", () => {
    renderPanel(createAgent({ outputLines: [], lastUserMessage: null, latestPreview: null }));

    expect(screen.queryByTestId("agent-provisional-user")).toBeNull();
    expect(screen.queryByTestId("agent-provisional-assistant")).toBeNull();
    expect(screen.getByText("Try describing a task, bug, or question to get started.")).toBeTruthy();
  });

  it("does not render provisional cards when transcript history exists", () => {
    renderPanel(
      createAgent({
        outputLines: ["> persisted question", "persisted answer"],
        lastUserMessage: "new preview user",
        latestPreview: "new preview assistant",
      })
    );

    expect(screen.queryByTestId("agent-provisional-user")).toBeNull();
    expect(screen.queryByTestId("agent-provisional-assistant")).toBeNull();
    expect(screen.getByText("persisted question")).toBeTruthy();
    expect(screen.getByText("persisted answer")).toBeTruthy();
  });
});
