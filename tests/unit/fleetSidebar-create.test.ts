import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { AgentState } from "@/features/agents/state/store";
import { FleetSidebar } from "@/features/agents/components/FleetSidebar";

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

describe("FleetSidebar new agent action", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders New agent button", () => {
    render(
      createElement(FleetSidebar, {
        agents: [createAgent()],
        selectedAgentId: "agent-1",
        filter: "all",
        onFilterChange: vi.fn(),
        onSelectAgent: vi.fn(),
        onCreateAgent: vi.fn(),
      })
    );

    expect(screen.getByTestId("fleet-new-agent-button")).toBeInTheDocument();
    expect(screen.getByText("New agent")).toBeInTheDocument();
  });

  it("calls onCreateAgent when clicked", () => {
    const onCreateAgent = vi.fn();
    render(
      createElement(FleetSidebar, {
        agents: [createAgent()],
        selectedAgentId: "agent-1",
        filter: "all",
        onFilterChange: vi.fn(),
        onSelectAgent: vi.fn(),
        onCreateAgent,
      })
    );

    fireEvent.click(screen.getByTestId("fleet-new-agent-button"));
    expect(onCreateAgent).toHaveBeenCalledTimes(1);
  });

  it("disables create button when createDisabled=true", () => {
    render(
      createElement(FleetSidebar, {
        agents: [createAgent()],
        selectedAgentId: "agent-1",
        filter: "all",
        onFilterChange: vi.fn(),
        onSelectAgent: vi.fn(),
        onCreateAgent: vi.fn(),
        createDisabled: true,
      })
    );

    expect(screen.getByTestId("fleet-new-agent-button")).toBeDisabled();
  });

  it("shows approvals tab instead of idle tab", () => {
    render(
      createElement(FleetSidebar, {
        agents: [createAgent()],
        selectedAgentId: "agent-1",
        filter: "all",
        onFilterChange: vi.fn(),
        onSelectAgent: vi.fn(),
        onCreateAgent: vi.fn(),
      })
    );

    expect(screen.getByTestId("fleet-filter-approvals")).toBeInTheDocument();
    expect(screen.queryByTestId("fleet-filter-idle")).toBeNull();
  });

  it("shows needs approval badge for awaiting agents", () => {
    render(
      createElement(FleetSidebar, {
        agents: [{ ...createAgent(), awaitingUserInput: true }],
        selectedAgentId: "agent-1",
        filter: "all",
        onFilterChange: vi.fn(),
        onSelectAgent: vi.fn(),
        onCreateAgent: vi.fn(),
      })
    );

    const approvalBadge = screen.getByText("Needs approval");
    expect(approvalBadge).toBeInTheDocument();
    expect(approvalBadge).toHaveClass("ui-badge-approval");
    expect(approvalBadge).toHaveAttribute("data-status", "approval");
  });

  it("renders semantic class and status marker for agent status badge", () => {
    render(
      createElement(FleetSidebar, {
        agents: [{ ...createAgent(), status: "running" }],
        selectedAgentId: "agent-1",
        filter: "all",
        onFilterChange: vi.fn(),
        onSelectAgent: vi.fn(),
        onCreateAgent: vi.fn(),
      })
    );

    const row = screen.getByTestId("fleet-agent-row-agent-1");
    const statusBadge = within(row).getByText("Running");
    expect(statusBadge).toHaveAttribute("data-status", "running");
    expect(statusBadge).toHaveClass("ui-badge-status-running");
  });
});
