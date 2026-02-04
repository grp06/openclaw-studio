import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
  streamText: null,
  thinkingTrace: null,
  latestOverride: null,
  latestOverrideKind: null,
  lastActivityAt: null,
  latestPreview: null,
  lastUserMessage: null,
  draft: "",
  sessionSettingsSynced: true,
  historyLoadedAt: null,
  toolCallingEnabled: true,
  showThinkingTraces: true,
  model: null,
  thinkingLevel: null,
  avatarSeed: "seed-1",
  avatarUrl: null,
});

describe("AgentChatPanel controls", () => {
  const models: GatewayModelChoice[] = [
    { provider: "openai", id: "gpt-5", name: "gpt-5", reasoning: true },
    { provider: "openai", id: "gpt-5-mini", name: "gpt-5-mini", reasoning: false },
  ];

  afterEach(() => {
    cleanup();
  });

  it("renders_runtime_controls_in_agent_header_and_no_inline_name_editor", () => {
    render(
      createElement(AgentChatPanel, {
        agent: createAgent(),
        isSelected: true,
        canSend: true,
        models,
        onOpenSettings: vi.fn(),
        onModelChange: vi.fn(),
        onThinkingChange: vi.fn(),
        onDraftChange: vi.fn(),
        onSend: vi.fn(),
        onAvatarShuffle: vi.fn(),
      })
    );

    expect(screen.getByText("Model")).toBeInTheDocument();
    expect(screen.getByText("Thinking")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("Agent One")).not.toBeInTheDocument();
    expect(screen.getByTestId("agent-settings-toggle")).toBeInTheDocument();
    expect(screen.getByLabelText("Open agent settings")).toBeInTheDocument();
    expect(screen.queryByText("Inspect")).not.toBeInTheDocument();
  });

  it("invokes_on_model_change_when_model_select_changes", () => {
    const onModelChange = vi.fn();
    render(
      createElement(AgentChatPanel, {
        agent: createAgent(),
        isSelected: true,
        canSend: true,
        models,
        onOpenSettings: vi.fn(),
        onModelChange,
        onThinkingChange: vi.fn(),
        onDraftChange: vi.fn(),
        onSend: vi.fn(),
        onAvatarShuffle: vi.fn(),
      })
    );

    fireEvent.change(screen.getByLabelText("Model"), {
      target: { value: "openai/gpt-5-mini" },
    });
    expect(onModelChange).toHaveBeenCalledWith("openai/gpt-5-mini");
  });

  it("invokes_on_thinking_change_when_thinking_select_changes", () => {
    const onThinkingChange = vi.fn();
    render(
      createElement(AgentChatPanel, {
        agent: createAgent(),
        isSelected: true,
        canSend: true,
        models,
        onOpenSettings: vi.fn(),
        onModelChange: vi.fn(),
        onThinkingChange,
        onDraftChange: vi.fn(),
        onSend: vi.fn(),
        onAvatarShuffle: vi.fn(),
      })
    );

    fireEvent.change(screen.getByLabelText("Thinking"), {
      target: { value: "high" },
    });
    expect(onThinkingChange).toHaveBeenCalledWith("high");
  });

  it("invokes_on_open_settings_when_control_clicked", () => {
    const onOpenSettings = vi.fn();

    render(
      createElement(AgentChatPanel, {
        agent: createAgent(),
        isSelected: true,
        canSend: true,
        models,
        onOpenSettings,
        onModelChange: vi.fn(),
        onThinkingChange: vi.fn(),
        onDraftChange: vi.fn(),
        onSend: vi.fn(),
        onAvatarShuffle: vi.fn(),
      })
    );

    fireEvent.click(screen.getByTestId("agent-settings-toggle"));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });
});
