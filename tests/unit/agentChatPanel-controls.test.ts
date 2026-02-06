import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { AgentState } from "@/features/agents/state/store";
import { AgentChatPanel } from "@/features/agents/components/AgentChatPanel";
import type { GatewayModelChoice } from "@/lib/gateway/models";
import { formatThinkingMarkdown } from "@/lib/text/message-extract";

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
  lastAssistantMessageAt: null,
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
        stopBusy: false,
        onOpenSettings: vi.fn(),
        onModelChange: vi.fn(),
        onThinkingChange: vi.fn(),
        onDraftChange: vi.fn(),
        onSend: vi.fn(),
        onStopRun: vi.fn(),
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
        stopBusy: false,
        onOpenSettings: vi.fn(),
        onModelChange,
        onThinkingChange: vi.fn(),
        onDraftChange: vi.fn(),
        onSend: vi.fn(),
        onStopRun: vi.fn(),
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
        stopBusy: false,
        onOpenSettings: vi.fn(),
        onModelChange: vi.fn(),
        onThinkingChange,
        onDraftChange: vi.fn(),
        onSend: vi.fn(),
        onStopRun: vi.fn(),
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
        stopBusy: false,
        onOpenSettings,
        onModelChange: vi.fn(),
        onThinkingChange: vi.fn(),
        onDraftChange: vi.fn(),
        onSend: vi.fn(),
        onStopRun: vi.fn(),
        onAvatarShuffle: vi.fn(),
      })
    );

    fireEvent.click(screen.getByTestId("agent-settings-toggle"));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it("shows_stop_button_while_running_and_invokes_stop_handler", () => {
    const onStopRun = vi.fn();

    render(
      createElement(AgentChatPanel, {
        agent: { ...createAgent(), status: "running" },
        isSelected: true,
        canSend: true,
        models,
        stopBusy: false,
        onOpenSettings: vi.fn(),
        onModelChange: vi.fn(),
        onThinkingChange: vi.fn(),
        onDraftChange: vi.fn(),
        onSend: vi.fn(),
        onStopRun,
        onAvatarShuffle: vi.fn(),
      })
    );

    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(onStopRun).toHaveBeenCalledTimes(1);
  });

  it("shows_typing_indicator_while_running_before_stream_text", () => {
    render(
      createElement(AgentChatPanel, {
        agent: { ...createAgent(), status: "running", outputLines: ["> test"] },
        isSelected: true,
        canSend: true,
        models,
        stopBusy: false,
        onOpenSettings: vi.fn(),
        onModelChange: vi.fn(),
        onThinkingChange: vi.fn(),
        onDraftChange: vi.fn(),
        onSend: vi.fn(),
        onStopRun: vi.fn(),
        onAvatarShuffle: vi.fn(),
      })
    );

    expect(screen.getByTestId("agent-typing-indicator")).toBeInTheDocument();
    expect(within(screen.getByTestId("agent-typing-indicator")).getByText("Thinking")).toBeInTheDocument();
  });

  it("hides_typing_indicator_after_stream_starts", () => {
    render(
      createElement(AgentChatPanel, {
        agent: {
          ...createAgent(),
          status: "running",
          outputLines: ["> test"],
          streamText: "working on it",
        },
        isSelected: true,
        canSend: true,
        models,
        stopBusy: false,
        onOpenSettings: vi.fn(),
        onModelChange: vi.fn(),
        onThinkingChange: vi.fn(),
        onDraftChange: vi.fn(),
        onSend: vi.fn(),
        onStopRun: vi.fn(),
        onAvatarShuffle: vi.fn(),
      })
    );

    expect(screen.queryByTestId("agent-typing-indicator")).not.toBeInTheDocument();
  });

  it("hides_typing_indicator_when_thinking_trace_has_started", () => {
    render(
      createElement(AgentChatPanel, {
        agent: {
          ...createAgent(),
          status: "running",
          outputLines: ["> test", formatThinkingMarkdown("thinking now")],
        },
        isSelected: true,
        canSend: true,
        models,
        stopBusy: false,
        onOpenSettings: vi.fn(),
        onModelChange: vi.fn(),
        onThinkingChange: vi.fn(),
        onDraftChange: vi.fn(),
        onSend: vi.fn(),
        onStopRun: vi.fn(),
        onAvatarShuffle: vi.fn(),
      })
    );

    expect(screen.queryByTestId("agent-typing-indicator")).not.toBeInTheDocument();
  });

  it("auto_expands_thinking_panel_while_run_is_active", () => {
    render(
      createElement(AgentChatPanel, {
        agent: {
          ...createAgent(),
          status: "running",
          outputLines: ["> test", formatThinkingMarkdown("thinking now")],
        },
        isSelected: true,
        canSend: true,
        models,
        stopBusy: false,
        onOpenSettings: vi.fn(),
        onModelChange: vi.fn(),
        onThinkingChange: vi.fn(),
        onDraftChange: vi.fn(),
        onSend: vi.fn(),
        onStopRun: vi.fn(),
        onAvatarShuffle: vi.fn(),
      })
    );

    expect(screen.getByText("thinking now").closest("details")).toHaveAttribute("open");
  });

  it("closes_thinking_panel_when_final_message_is_present", () => {
    render(
      createElement(AgentChatPanel, {
        agent: {
          ...createAgent(),
          status: "running",
          outputLines: ["> test", formatThinkingMarkdown("thinking now"), "final response"],
        },
        isSelected: true,
        canSend: true,
        models,
        stopBusy: false,
        onOpenSettings: vi.fn(),
        onModelChange: vi.fn(),
        onThinkingChange: vi.fn(),
        onDraftChange: vi.fn(),
        onSend: vi.fn(),
        onStopRun: vi.fn(),
        onAvatarShuffle: vi.fn(),
      })
    );

    expect(screen.getByText("thinking now").closest("details")).not.toHaveAttribute("open");
  });
});
