import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { AgentState } from "@/features/agents/state/store";
import { AgentSettingsPanel } from "@/features/agents/components/AgentInspectPanels";
import type { CronJobSummary } from "@/lib/cron/types";
import type { AgentHeartbeatSummary } from "@/lib/gateway/agentConfig";

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

const createHeartbeat = (
  source: AgentHeartbeatSummary["source"] = "override"
): AgentHeartbeatSummary => ({
  id: "agent-1",
  agentId: "agent-1",
  source,
  enabled: true,
  heartbeat: {
    every: "30m",
    target: "last",
    includeReasoning: false,
    ackMaxChars: 300,
    activeHours: null,
  },
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
        cronJobs: [],
        cronLoading: false,
        cronError: null,
        cronRunBusyJobId: null,
        cronDeleteBusyJobId: null,
        onRunCronJob: vi.fn(),
        onDeleteCronJob: vi.fn(),
      })
    );

    fireEvent.change(screen.getByLabelText("Agent name"), {
      target: { value: "  Agent Two  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Update Name" }));

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
        cronJobs: [],
        cronLoading: false,
        cronError: null,
        cronRunBusyJobId: null,
        cronDeleteBusyJobId: null,
        onRunCronJob: vi.fn(),
        onDeleteCronJob: vi.fn(),
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
        cronJobs: [],
        cronLoading: false,
        cronError: null,
        cronRunBusyJobId: null,
        cronDeleteBusyJobId: null,
        onRunCronJob: vi.fn(),
        onDeleteCronJob: vi.fn(),
      })
    );

    fireEvent.click(screen.getByRole("button", { name: "New session" }));
    expect(onNewSession).toHaveBeenCalledTimes(1);
  });

  it("renders_cron_jobs_section_below_session", () => {
    render(
      createElement(AgentSettingsPanel, {
        agent: createAgent(),
        onClose: vi.fn(),
        onRename: vi.fn(async () => true),
        onNewSession: vi.fn(),
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

    const sessionSection = screen.getByTestId("agent-settings-session");
    const cronSection = screen.getByTestId("agent-settings-cron");
    expect(cronSection).toBeInTheDocument();
    const position = sessionSection.compareDocumentPosition(cronSection);
    expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("invokes_run_now_and_disables_play_while_pending", () => {
    const onRunCronJob = vi.fn();
    const cronJobs = [createCronJob("job-1")];
    const { rerender } = render(
      createElement(AgentSettingsPanel, {
        agent: createAgent(),
        onClose: vi.fn(),
        onRename: vi.fn(async () => true),
        onNewSession: vi.fn(),
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

    fireEvent.click(screen.getByRole("button", { name: "Run cron job Job job-1 now" }));
    expect(onRunCronJob).toHaveBeenCalledWith("job-1");

    rerender(
      createElement(AgentSettingsPanel, {
        agent: createAgent(),
        onClose: vi.fn(),
        onRename: vi.fn(async () => true),
        onNewSession: vi.fn(),
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

    expect(screen.getByRole("button", { name: "Run cron job Job job-1 now" })).toBeDisabled();
  });

  it("invokes_delete_and_disables_trash_while_pending", () => {
    const onDeleteCronJob = vi.fn();
    const cronJobs = [createCronJob("job-1")];
    const { rerender } = render(
      createElement(AgentSettingsPanel, {
        agent: createAgent(),
        onClose: vi.fn(),
        onRename: vi.fn(async () => true),
        onNewSession: vi.fn(),
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

    fireEvent.click(screen.getByRole("button", { name: "Delete cron job Job job-1" }));
    expect(onDeleteCronJob).toHaveBeenCalledWith("job-1");

    rerender(
      createElement(AgentSettingsPanel, {
        agent: createAgent(),
        onClose: vi.fn(),
        onRename: vi.fn(async () => true),
        onNewSession: vi.fn(),
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

    expect(screen.getByRole("button", { name: "Delete cron job Job job-1" })).toBeDisabled();
  });

  it("shows_empty_cron_state_when_agent_has_no_jobs", () => {
    render(
      createElement(AgentSettingsPanel, {
        agent: createAgent(),
        onClose: vi.fn(),
        onRename: vi.fn(async () => true),
        onNewSession: vi.fn(),
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

    expect(screen.getByText("No cron jobs for this agent.")).toBeInTheDocument();
  });

  it("shows_create_button_when_no_cron_jobs", () => {
    render(
      createElement(AgentSettingsPanel, {
        agent: createAgent(),
        onClose: vi.fn(),
        onRename: vi.fn(async () => true),
        onNewSession: vi.fn(),
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
        onClose: vi.fn(),
        onRename: vi.fn(async () => true),
        onNewSession: vi.fn(),
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
    expect(screen.getByRole("dialog", { name: "Create cron job" })).toBeInTheDocument();
  });

  it("submits_modal_with_agent_scoped_draft", async () => {
    const onCreateCronJob = vi.fn(async () => {});
    render(
      createElement(AgentSettingsPanel, {
        agent: createAgent(),
        onClose: vi.fn(),
        onRename: vi.fn(async () => true),
        onNewSession: vi.fn(),
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
    fireEvent.change(screen.getByLabelText("Job name"), {
      target: { value: "Nightly sync" },
    });
    fireEvent.change(screen.getByLabelText("Task"), {
      target: { value: "Sync project status and report blockers." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Create cron job" }));

    await waitFor(() => {
      expect(onCreateCronJob).toHaveBeenCalledWith({
        templateId: "custom",
        name: "Nightly sync",
        taskText: "Sync project status and report blockers.",
        scheduleKind: "every",
        everyAmount: 30,
        everyUnit: "minutes",
        deliveryMode: "announce",
        deliveryChannel: "last",
      });
    });
  });

  it("disables_create_submit_while_create_in_flight", () => {
    render(
      createElement(AgentSettingsPanel, {
        agent: createAgent(),
        onClose: vi.fn(),
        onRename: vi.fn(async () => true),
        onNewSession: vi.fn(),
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
    expect(screen.getByRole("button", { name: "Create cron job" })).toBeDisabled();
  });

  it("keeps_modal_open_and_shows_error_when_create_fails", async () => {
    const onCreateCronJob = vi.fn(async () => {
      throw new Error("Gateway exploded");
    });
    render(
      createElement(AgentSettingsPanel, {
        agent: createAgent(),
        onClose: vi.fn(),
        onRename: vi.fn(async () => true),
        onNewSession: vi.fn(),
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
    fireEvent.change(screen.getByLabelText("Job name"), {
      target: { value: "Nightly sync" },
    });
    fireEvent.change(screen.getByLabelText("Task"), {
      target: { value: "Sync project status and report blockers." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Create cron job" }));

    await waitFor(() => {
      expect(screen.getByText("Gateway exploded")).toBeInTheDocument();
    });
    expect(screen.getByRole("dialog", { name: "Create cron job" })).toBeInTheDocument();
  });

  it("renders_heartbeat_section_below_cron", () => {
    render(
      createElement(AgentSettingsPanel, {
        agent: createAgent(),
        onClose: vi.fn(),
        onRename: vi.fn(async () => true),
        onNewSession: vi.fn(),
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
        heartbeats: [createHeartbeat()],
      })
    );

    const cronSection = screen.getByTestId("agent-settings-cron");
    const heartbeatSection = screen.getByTestId("agent-settings-heartbeat");
    expect(heartbeatSection).toBeInTheDocument();
    const position = cronSection.compareDocumentPosition(heartbeatSection);
    expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("invokes_run_heartbeat_and_disables_delete_for_inherited", () => {
    const onRunHeartbeat = vi.fn();
    render(
      createElement(AgentSettingsPanel, {
        agent: createAgent(),
        onClose: vi.fn(),
        onRename: vi.fn(async () => true),
        onNewSession: vi.fn(),
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
        heartbeats: [createHeartbeat("default")],
        onRunHeartbeat,
      })
    );

    fireEvent.click(screen.getByRole("button", { name: "Run heartbeat for agent-1 now" }));
    expect(onRunHeartbeat).toHaveBeenCalledWith("agent-1");
    expect(screen.getByRole("button", { name: "Delete heartbeat for agent-1" })).toBeDisabled();
  });

  it("invokes_delete_heartbeat_for_override", () => {
    const onDeleteHeartbeat = vi.fn();
    render(
      createElement(AgentSettingsPanel, {
        agent: createAgent(),
        onClose: vi.fn(),
        onRename: vi.fn(async () => true),
        onNewSession: vi.fn(),
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
        heartbeats: [createHeartbeat("override")],
        onDeleteHeartbeat,
      })
    );

    fireEvent.click(screen.getByRole("button", { name: "Delete heartbeat for agent-1" }));
    expect(onDeleteHeartbeat).toHaveBeenCalledWith("agent-1");
  });
});
