import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { AgentState } from "@/features/agents/state/store";
import { AgentSettingsPanel } from "@/features/agents/components/AgentInspectPanels";
import type { CronJobSummary } from "@/lib/cron/types";

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
  model: "openai/gpt-5",
  thinkingLevel: "medium",
  avatarSeed: "seed-1",
  avatarUrl: null,
});

const createCronJob = (id: string): CronJobSummary => ({
  id,
  name: `Job ${id}`,
  agentId: "agent-1",
  enabled: true,
  updatedAtMs: Date.now(),
  schedule: { kind: "every", everyMs: 60_000 },
  sessionTarget: "isolated",
  wakeMode: "next-heartbeat",
  payload: { kind: "agentTurn", message: "hi" },
  state: {},
});

describe("AgentSettingsPanel", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("does_not_render_name_editor_in_capabilities_mode", () => {
    render(
      createElement(AgentSettingsPanel, {
        agent: createAgent(),
        onClose: vi.fn(),
        onDelete: vi.fn(),
        onToolCallingToggle: vi.fn(),
        onThinkingTracesToggle: vi.fn(),
        cronJobs: [],
        cronLoading: false,
        cronError: null,
        cronRunBusyJobId: null,
        cronDeleteBusyJobId: null,
        onRunCronJob: vi.fn(),
        onDeleteCronJob: vi.fn(),
      })
    );

    expect(screen.queryByLabelText("Agent name")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Update Name" })).not.toBeInTheDocument();
  });

  it("renders_icon_close_button_with_accessible_label", () => {
    render(
      createElement(AgentSettingsPanel, {
        agent: createAgent(),
        onClose: vi.fn(),
        onDelete: vi.fn(),
        onToolCallingToggle: vi.fn(),
        onThinkingTracesToggle: vi.fn(),
        cronJobs: [],
        cronLoading: false,
        cronError: null,
        cronRunBusyJobId: null,
        cronDeleteBusyJobId: null,
        onRunCronJob: vi.fn(),
        onDeleteCronJob: vi.fn(),
      })
    );

    expect(screen.getByLabelText("Close panel")).toBeInTheDocument();
    expect(screen.getByTestId("agent-settings-close")).toBeInTheDocument();
  });

  it("does_not_render_show_tool_calls_and_show_thinking_toggles_in_advanced_mode", () => {
    render(
      createElement(AgentSettingsPanel, {
        agent: createAgent(),
        mode: "advanced",
        onClose: vi.fn(),
        onDelete: vi.fn(),
        onToolCallingToggle: vi.fn(),
        onThinkingTracesToggle: vi.fn(),
        cronJobs: [],
        cronLoading: false,
        cronError: null,
        cronRunBusyJobId: null,
        cronDeleteBusyJobId: null,
        onRunCronJob: vi.fn(),
        onDeleteCronJob: vi.fn(),
      })
    );

    expect(screen.queryByRole("switch", { name: "Show tool calls" })).not.toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: "Show thinking" })).not.toBeInTheDocument();
  });

  it("renders_permissions_controls", () => {
    render(
      createElement(AgentSettingsPanel, {
        agent: createAgent(),
        onClose: vi.fn(),
        onDelete: vi.fn(),
        onToolCallingToggle: vi.fn(),
        onThinkingTracesToggle: vi.fn(),
        cronJobs: [],
        cronLoading: false,
        cronError: null,
        cronRunBusyJobId: null,
        cronDeleteBusyJobId: null,
        onRunCronJob: vi.fn(),
        onDeleteCronJob: vi.fn(),
      })
    );

    expect(screen.queryByText("Capabilities")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run commands off" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run commands ask" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run commands auto" })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Web access" })).toHaveAttribute(
      "aria-checked",
      "false"
    );
    expect(screen.getByRole("switch", { name: "File tools" })).toHaveAttribute(
      "aria-checked",
      "false"
    );
  });

  it("updates_switch_aria_state_when_toggled", () => {
    render(
      createElement(AgentSettingsPanel, {
        agent: createAgent(),
        onClose: vi.fn(),
        onDelete: vi.fn(),
        onToolCallingToggle: vi.fn(),
        onThinkingTracesToggle: vi.fn(),
        cronJobs: [],
        cronLoading: false,
        cronError: null,
        cronRunBusyJobId: null,
        cronDeleteBusyJobId: null,
        onRunCronJob: vi.fn(),
        onDeleteCronJob: vi.fn(),
      })
    );

    const webSwitch = screen.getByRole("switch", { name: "Web access" });
    fireEvent.click(webSwitch);
    expect(webSwitch).toHaveAttribute("aria-checked", "true");
  });

  it("autosaves_updated_permissions_draft", async () => {
    const onUpdateAgentPermissions = vi.fn(async () => {});
    render(
      createElement(AgentSettingsPanel, {
        agent: createAgent(),
        permissionsDraft: {
          commandMode: "off",
          webAccess: false,
          fileTools: false,
        },
        onUpdateAgentPermissions,
        onClose: vi.fn(),
        onDelete: vi.fn(),
        onToolCallingToggle: vi.fn(),
        onThinkingTracesToggle: vi.fn(),
        cronJobs: [],
        cronLoading: false,
        cronError: null,
        cronRunBusyJobId: null,
        cronDeleteBusyJobId: null,
        onRunCronJob: vi.fn(),
        onDeleteCronJob: vi.fn(),
      })
    );

    fireEvent.click(screen.getByRole("button", { name: "Run commands auto" }));
    fireEvent.click(screen.getByRole("switch", { name: "Web access" }));
    fireEvent.click(screen.getByRole("switch", { name: "File tools" }));

    await waitFor(
      () => {
        expect(onUpdateAgentPermissions).toHaveBeenCalledWith({
          commandMode: "auto",
          webAccess: true,
          fileTools: true,
        });
      },
      { timeout: 2000 }
    );
  });

  it("preserves_pending_permissions_toggles_during_props_refresh", () => {
    const onUpdateAgentPermissions = vi.fn(async () => {});

    const props = {
      agent: createAgent(),
      onClose: vi.fn(),
      onDelete: vi.fn(),
      onToolCallingToggle: vi.fn(),
      onThinkingTracesToggle: vi.fn(),
      cronJobs: [],
      cronLoading: false,
      cronError: null,
      cronRunBusyJobId: null,
      cronDeleteBusyJobId: null,
      onRunCronJob: vi.fn(),
      onDeleteCronJob: vi.fn(),
      onUpdateAgentPermissions,
    };

    const { rerender } = render(
      createElement(AgentSettingsPanel, {
        ...props,
        permissionsDraft: {
          commandMode: "off",
          webAccess: false,
          fileTools: false,
        },
      })
    );

    fireEvent.click(screen.getByRole("button", { name: "Run commands auto" }));
    fireEvent.click(screen.getByRole("switch", { name: "Web access" }));
    fireEvent.click(screen.getByRole("switch", { name: "File tools" }));

    rerender(
      createElement(AgentSettingsPanel, {
        ...props,
        permissionsDraft: {
          commandMode: "auto",
          webAccess: false,
          fileTools: false,
        },
      })
    );

    expect(screen.getByRole("switch", { name: "Web access" })).toHaveAttribute(
      "aria-checked",
      "true"
    );
    expect(screen.getByRole("switch", { name: "File tools" })).toHaveAttribute(
      "aria-checked",
      "true"
    );
  });

  it("does_not_render_runtime_settings_section", () => {
    render(
      createElement(AgentSettingsPanel, {
        agent: createAgent(),
        onClose: vi.fn(),
        onDelete: vi.fn(),
        onToolCallingToggle: vi.fn(),
        onThinkingTracesToggle: vi.fn(),
        cronJobs: [],
        cronLoading: false,
        cronError: null,
        cronRunBusyJobId: null,
        cronDeleteBusyJobId: null,
        onRunCronJob: vi.fn(),
        onDeleteCronJob: vi.fn(),
      })
    );

    expect(screen.queryByText("Runtime settings")).not.toBeInTheDocument();
    expect(screen.queryByText("Personality")).not.toBeInTheDocument();
  });

  it("does_not_render_new_session_control_in_advanced_mode", () => {
    render(
      createElement(AgentSettingsPanel, {
        agent: createAgent(),
        mode: "advanced",
        onClose: vi.fn(),
        onDelete: vi.fn(),
        onToolCallingToggle: vi.fn(),
        onThinkingTracesToggle: vi.fn(),
        cronJobs: [],
        cronLoading: false,
        cronError: null,
        cronRunBusyJobId: null,
        cronDeleteBusyJobId: null,
        onRunCronJob: vi.fn(),
        onDeleteCronJob: vi.fn(),
      })
    );

    expect(screen.queryByRole("button", { name: "New session" })).not.toBeInTheDocument();
  });

  it("renders_automations_section_when_mode_is_automations", () => {
    render(
      createElement(AgentSettingsPanel, {
        agent: createAgent(),
        mode: "automations",
        onClose: vi.fn(),
        onDelete: vi.fn(),
        onToolCallingToggle: vi.fn(),
        onThinkingTracesToggle: vi.fn(),
        cronJobs: [createCronJob("job-1")],
        cronLoading: false,
        cronError: null,
        cronRunBusyJobId: null,
        cronDeleteBusyJobId: null,
        onRunCronJob: vi.fn(),
        onDeleteCronJob: vi.fn(),
      })
    );

    const cronSection = screen.getByTestId("agent-settings-cron");
    expect(cronSection).toBeInTheDocument();
    expect(screen.queryByTestId("agent-settings-session")).not.toBeInTheDocument();
  });

  it("invokes_run_now_and_disables_play_while_pending", () => {
    const onRunCronJob = vi.fn();
    const cronJobs = [createCronJob("job-1")];
    const { rerender } = render(
      createElement(AgentSettingsPanel, {
        agent: createAgent(),
        mode: "automations",
        onClose: vi.fn(),
        onDelete: vi.fn(),
        onToolCallingToggle: vi.fn(),
        onThinkingTracesToggle: vi.fn(),
        cronJobs,
        cronLoading: false,
        cronError: null,
        cronRunBusyJobId: null,
        cronDeleteBusyJobId: null,
        onRunCronJob,
        onDeleteCronJob: vi.fn(),
      })
    );

    fireEvent.click(screen.getByRole("button", { name: "Run timed automation Job job-1 now" }));
    expect(onRunCronJob).toHaveBeenCalledWith("job-1");

    rerender(
      createElement(AgentSettingsPanel, {
        agent: createAgent(),
        mode: "automations",
        onClose: vi.fn(),
        onDelete: vi.fn(),
        onToolCallingToggle: vi.fn(),
        onThinkingTracesToggle: vi.fn(),
        cronJobs,
        cronLoading: false,
        cronError: null,
        cronRunBusyJobId: "job-1",
        cronDeleteBusyJobId: null,
        onRunCronJob,
        onDeleteCronJob: vi.fn(),
      })
    );

    expect(screen.getByRole("button", { name: "Run timed automation Job job-1 now" })).toBeDisabled();
  });

  it("invokes_delete_and_disables_trash_while_pending", () => {
    const onDeleteCronJob = vi.fn();
    const cronJobs = [createCronJob("job-1")];
    const { rerender } = render(
      createElement(AgentSettingsPanel, {
        agent: createAgent(),
        mode: "automations",
        onClose: vi.fn(),
        onDelete: vi.fn(),
        onToolCallingToggle: vi.fn(),
        onThinkingTracesToggle: vi.fn(),
        cronJobs,
        cronLoading: false,
        cronError: null,
        cronRunBusyJobId: null,
        cronDeleteBusyJobId: null,
        onRunCronJob: vi.fn(),
        onDeleteCronJob,
      })
    );

    fireEvent.click(screen.getByRole("button", { name: "Delete timed automation Job job-1" }));
    expect(onDeleteCronJob).toHaveBeenCalledWith("job-1");

    rerender(
      createElement(AgentSettingsPanel, {
        agent: createAgent(),
        mode: "automations",
        onClose: vi.fn(),
        onDelete: vi.fn(),
        onToolCallingToggle: vi.fn(),
        onThinkingTracesToggle: vi.fn(),
        cronJobs,
        cronLoading: false,
        cronError: null,
        cronRunBusyJobId: null,
        cronDeleteBusyJobId: "job-1",
        onRunCronJob: vi.fn(),
        onDeleteCronJob,
      })
    );

    expect(screen.getByRole("button", { name: "Delete timed automation Job job-1" })).toBeDisabled();
  });

  it("shows_empty_cron_state_when_agent_has_no_jobs", () => {
    render(
      createElement(AgentSettingsPanel, {
        agent: createAgent(),
        mode: "automations",
        onClose: vi.fn(),
        onDelete: vi.fn(),
        onToolCallingToggle: vi.fn(),
        onThinkingTracesToggle: vi.fn(),
        cronJobs: [],
        cronLoading: false,
        cronError: null,
        cronRunBusyJobId: null,
        cronDeleteBusyJobId: null,
        onRunCronJob: vi.fn(),
        onDeleteCronJob: vi.fn(),
      })
    );

    expect(screen.getByText("No timed automations for this agent.")).toBeInTheDocument();
    expect(screen.getByTestId("cron-empty-icon")).toBeInTheDocument();
  });

  it("shows_create_button_when_no_cron_jobs", () => {
    render(
      createElement(AgentSettingsPanel, {
        agent: createAgent(),
        mode: "automations",
        onClose: vi.fn(),
        onDelete: vi.fn(),
        onToolCallingToggle: vi.fn(),
        onThinkingTracesToggle: vi.fn(),
        cronJobs: [],
        cronLoading: false,
        cronError: null,
        cronRunBusyJobId: null,
        cronDeleteBusyJobId: null,
        onRunCronJob: vi.fn(),
        onDeleteCronJob: vi.fn(),
      })
    );

    expect(screen.getByRole("button", { name: "Create" })).toBeInTheDocument();
  });

  it("opens_cron_create_modal_from_empty_state_button", () => {
    render(
      createElement(AgentSettingsPanel, {
        agent: createAgent(),
        mode: "automations",
        onClose: vi.fn(),
        onDelete: vi.fn(),
        onToolCallingToggle: vi.fn(),
        onThinkingTracesToggle: vi.fn(),
        cronJobs: [],
        cronLoading: false,
        cronError: null,
        cronRunBusyJobId: null,
        cronDeleteBusyJobId: null,
        onRunCronJob: vi.fn(),
        onDeleteCronJob: vi.fn(),
      })
    );

    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    expect(screen.getByRole("dialog", { name: "Create automation" })).toBeInTheDocument();
  });

  it("updates_template_defaults_when_switching_templates", () => {
    render(
      createElement(AgentSettingsPanel, {
        agent: createAgent(),
        mode: "automations",
        onClose: vi.fn(),
        onDelete: vi.fn(),
        onToolCallingToggle: vi.fn(),
        onThinkingTracesToggle: vi.fn(),
        cronJobs: [],
        cronLoading: false,
        cronError: null,
        cronRunBusyJobId: null,
        cronDeleteBusyJobId: null,
        onRunCronJob: vi.fn(),
        onDeleteCronJob: vi.fn(),
      })
    );

    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    fireEvent.click(screen.getByRole("button", { name: "Weekly Review" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByLabelText("Automation name")).toHaveValue("Weekly review");

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    fireEvent.click(screen.getByRole("button", { name: "Morning Brief" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByLabelText("Automation name")).toHaveValue("Morning brief");
  });

  it("submits_modal_with_agent_scoped_draft", async () => {
    const onCreateCronJob = vi.fn(async () => {});
    render(
      createElement(AgentSettingsPanel, {
        agent: createAgent(),
        mode: "automations",
        onClose: vi.fn(),
        onDelete: vi.fn(),
        onToolCallingToggle: vi.fn(),
        onThinkingTracesToggle: vi.fn(),
        cronJobs: [],
        cronLoading: false,
        cronError: null,
        cronRunBusyJobId: null,
        cronDeleteBusyJobId: null,
        onRunCronJob: vi.fn(),
        onDeleteCronJob: vi.fn(),
        onCreateCronJob,
      })
    );

    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    fireEvent.click(screen.getByRole("button", { name: "Custom" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.change(screen.getByLabelText("Automation name"), {
      target: { value: "Nightly sync" },
    });
    fireEvent.change(screen.getByLabelText("Task"), {
      target: { value: "Sync project status and report blockers." },
    });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Next" })).not.toBeDisabled();
    });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Create automation" })).not.toBeDisabled();
    });
    fireEvent.click(screen.getByRole("button", { name: "Create automation" }));

    await waitFor(() => {
      expect(onCreateCronJob).toHaveBeenCalledWith({
        templateId: "custom",
        name: "Nightly sync",
        taskText: "Sync project status and report blockers.",
        scheduleKind: "every",
        everyAmount: 30,
        everyUnit: "minutes",
        deliveryMode: "none",
        deliveryChannel: "last",
      });
    });
  });

  it("hides_create_submit_before_review_step_and_disables_next_when_busy", () => {
    render(
      createElement(AgentSettingsPanel, {
        agent: createAgent(),
        mode: "automations",
        onClose: vi.fn(),
        onDelete: vi.fn(),
        onToolCallingToggle: vi.fn(),
        onThinkingTracesToggle: vi.fn(),
        cronJobs: [],
        cronLoading: false,
        cronError: null,
        cronRunBusyJobId: null,
        cronDeleteBusyJobId: null,
        onRunCronJob: vi.fn(),
        onDeleteCronJob: vi.fn(),
        cronCreateBusy: true,
      })
    );

    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    expect(screen.queryByRole("button", { name: "Create automation" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
  });

  it("keeps_modal_open_and_shows_error_when_create_fails", async () => {
    const onCreateCronJob = vi.fn(async () => {
      throw new Error("Gateway exploded");
    });
    render(
      createElement(AgentSettingsPanel, {
        agent: createAgent(),
        mode: "automations",
        onClose: vi.fn(),
        onDelete: vi.fn(),
        onToolCallingToggle: vi.fn(),
        onThinkingTracesToggle: vi.fn(),
        cronJobs: [],
        cronLoading: false,
        cronError: null,
        cronRunBusyJobId: null,
        cronDeleteBusyJobId: null,
        onRunCronJob: vi.fn(),
        onDeleteCronJob: vi.fn(),
        onCreateCronJob,
      })
    );

    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    fireEvent.click(screen.getByRole("button", { name: "Custom" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.change(screen.getByLabelText("Automation name"), {
      target: { value: "Nightly sync" },
    });
    fireEvent.change(screen.getByLabelText("Task"), {
      target: { value: "Sync project status and report blockers." },
    });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Next" })).not.toBeDisabled();
    });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Create automation" })).not.toBeDisabled();
    });
    fireEvent.click(screen.getByRole("button", { name: "Create automation" }));

    await waitFor(() => {
      expect(screen.getByText("Gateway exploded")).toBeInTheDocument();
    });
    expect(screen.getByRole("dialog", { name: "Create automation" })).toBeInTheDocument();
  });

  it("shows_heartbeat_coming_soon_in_automations_mode", () => {
    render(
      createElement(AgentSettingsPanel, {
        agent: createAgent(),
        mode: "automations",
        onClose: vi.fn(),
        onDelete: vi.fn(),
        onToolCallingToggle: vi.fn(),
        onThinkingTracesToggle: vi.fn(),
        cronJobs: [createCronJob("job-1")],
        cronLoading: false,
        cronError: null,
        cronRunBusyJobId: null,
        cronDeleteBusyJobId: null,
        onRunCronJob: vi.fn(),
        onDeleteCronJob: vi.fn(),
      })
    );

    expect(screen.getByTestId("agent-settings-heartbeat-coming-soon")).toBeInTheDocument();
    expect(screen.getByText("Heartbeat automation controls are coming soon.")).toBeInTheDocument();
  });

  it("shows_control_ui_section_in_advanced_mode", () => {
    render(
      createElement(AgentSettingsPanel, {
        agent: createAgent(),
        mode: "advanced",
        onClose: vi.fn(),
        onDelete: vi.fn(),
        onToolCallingToggle: vi.fn(),
        onThinkingTracesToggle: vi.fn(),
        cronJobs: [],
        cronLoading: false,
        cronError: null,
        cronRunBusyJobId: null,
        cronDeleteBusyJobId: null,
        onRunCronJob: vi.fn(),
        onDeleteCronJob: vi.fn(),
      })
    );

    expect(screen.getByTestId("agent-settings-control-ui")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open Full Control UI" })).toBeDisabled();
  });

  it("renders_enabled_control_ui_link_when_available", () => {
    render(
      createElement(AgentSettingsPanel, {
        agent: createAgent(),
        mode: "advanced",
        onClose: vi.fn(),
        onDelete: vi.fn(),
        onToolCallingToggle: vi.fn(),
        onThinkingTracesToggle: vi.fn(),
        cronJobs: [],
        cronLoading: false,
        cronError: null,
        cronRunBusyJobId: null,
        cronDeleteBusyJobId: null,
        onRunCronJob: vi.fn(),
        onDeleteCronJob: vi.fn(),
        controlUiUrl: "http://localhost:3000/control",
      })
    );

    const link = screen.getByRole("link", { name: "Open Full Control UI" });
    expect(link).toHaveAttribute("href", "http://localhost:3000/control");
  });
});
