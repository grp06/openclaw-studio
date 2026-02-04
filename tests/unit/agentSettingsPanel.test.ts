import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { AgentState } from "@/features/agents/state/store";
import { AgentSettingsPanel } from "@/features/agents/components/AgentSettingsPanel";

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
  model: "openai/gpt-5",
  thinkingLevel: "medium",
  avatarSeed: "seed-1",
  avatarUrl: null,
});

describe("AgentSettingsPanel", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders_identity_rename_section_and_saves_trimmed_name", async () => {
    const onRename = vi.fn(async () => true);
    render(
      createElement(AgentSettingsPanel, {
        agent: createAgent(),
        onClose: vi.fn(),
        onRename,
        onNewSession: vi.fn(),
        onDelete: vi.fn(),
        onToolCallingToggle: vi.fn(),
        onThinkingTracesToggle: vi.fn(),
      })
    );

    fireEvent.change(screen.getByLabelText("Agent name"), {
      target: { value: "  Agent Two  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save name" }));

    await waitFor(() => {
      expect(onRename).toHaveBeenCalledWith("Agent Two");
    });
  });

  it("keeps_show_tool_calls_and_show_thinking_toggles", () => {
    render(
      createElement(AgentSettingsPanel, {
        agent: createAgent(),
        onClose: vi.fn(),
        onRename: vi.fn(async () => true),
        onNewSession: vi.fn(),
        onDelete: vi.fn(),
        onToolCallingToggle: vi.fn(),
        onThinkingTracesToggle: vi.fn(),
      })
    );

    expect(screen.getByLabelText("Show tool calls")).toBeInTheDocument();
    expect(screen.getByLabelText("Show thinking")).toBeInTheDocument();
  });

  it("does_not_render_runtime_settings_section", () => {
    render(
      createElement(AgentSettingsPanel, {
        agent: createAgent(),
        onClose: vi.fn(),
        onRename: vi.fn(async () => true),
        onNewSession: vi.fn(),
        onDelete: vi.fn(),
        onToolCallingToggle: vi.fn(),
        onThinkingTracesToggle: vi.fn(),
      })
    );

    expect(screen.queryByText("Runtime settings")).not.toBeInTheDocument();
    expect(screen.queryByText("Brain files")).not.toBeInTheDocument();
  });

  it("invokes_on_new_session_when_clicked", () => {
    const onNewSession = vi.fn();
    render(
      createElement(AgentSettingsPanel, {
        agent: createAgent(),
        onClose: vi.fn(),
        onRename: vi.fn(async () => true),
        onNewSession,
        onDelete: vi.fn(),
        onToolCallingToggle: vi.fn(),
        onThinkingTracesToggle: vi.fn(),
      })
    );

    fireEvent.click(screen.getByRole("button", { name: "New session" }));
    expect(onNewSession).toHaveBeenCalledTimes(1);
  });
});
