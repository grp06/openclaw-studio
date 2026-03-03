import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import type { AgentState } from "@/features/agents/state/store";
import { AgentBrainPanel } from "@/features/agents/components/AgentInspectPanels";
import type { AgentFileName } from "@/lib/agents/agentFiles";

const mockState = vi.hoisted(() => {
  const filesByAgent: Record<string, Record<string, string>> = {
    "agent-1": {
      "AGENTS.md": "alpha agents",
      "SOUL.md": "# SOUL.md - Who You Are\n\n## Core Truths\n\nBe useful.",
      "IDENTITY.md": "# IDENTITY.md - Who Am I?\n\n- Name: Alpha\n- Creature: droid\n- Vibe: calm\n- Emoji: 🤖\n",
      "USER.md": "# USER.md - About Your Human\n\n- Name: George\n- What to call them: GP\n\n## Context\n\nBuilding OpenClaw Studio.",
      "TOOLS.md": "tool notes",
      "HEARTBEAT.md": "heartbeat notes",
      "MEMORY.md": "durable memory",
    },
    "agent-2": {
      "AGENTS.md": "beta agents",
    },
  };
  const readCalls: Array<{ agentId: string; name: AgentFileName }> = [];
  const writeCalls: Array<{ agentId: string; name: AgentFileName; content: string }> = [];
  return { filesByAgent, readCalls, writeCalls };
});

vi.mock("@/lib/controlplane/domain-runtime-client", () => ({
  readDomainAgentFile: vi.fn(async (params: { agentId: string; name: AgentFileName }) => {
    mockState.readCalls.push({ agentId: params.agentId, name: params.name });
    const content = mockState.filesByAgent[params.agentId]?.[params.name];
    if (typeof content !== "string") {
      return { exists: false, content: "" };
    }
    return { exists: true, content };
  }),
  writeDomainAgentFile: vi.fn(
    async (params: { agentId: string; name: AgentFileName; content: string }) => {
      mockState.writeCalls.push(params);
      if (!mockState.filesByAgent[params.agentId]) {
        mockState.filesByAgent[params.agentId] = {};
      }
      mockState.filesByAgent[params.agentId][params.name] = params.content;
    }
  ),
}));

const createAgent = (agentId: string, name: string, sessionKey: string): AgentState => ({
  agentId,
  name,
  sessionKey,
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
  avatarSeed: `seed-${agentId}`,
  avatarUrl: null,
});

describe("AgentBrainPanel", () => {
  beforeEach(() => {
    mockState.readCalls.length = 0;
    mockState.writeCalls.length = 0;
  });

  afterEach(() => {
    cleanup();
  });

  it("renders_behavior_sections_and_loads_agent_files", async () => {
    const agents = [
      createAgent("agent-1", "Alpha", "session-1"),
      createAgent("agent-2", "Beta", "session-2"),
    ];

    render(
      createElement(AgentBrainPanel, {
        gatewayStatus: "connected",
        agents,
        selectedAgentId: "agent-1",
      })
    );

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Persona" })).toBeInTheDocument();
    });

    expect(screen.getByRole("heading", { name: "Directives" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Context" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Identity" })).toBeInTheDocument();
    expect(screen.getByLabelText("Directives")).toHaveValue("alpha agents");
    expect(screen.getByLabelText("Persona")).toHaveValue(
      "# SOUL.md - Who You Are\n\n## Core Truths\n\nBe useful."
    );
    expect(screen.getByLabelText("Name")).toHaveValue("Alpha");
  });

  it("shows_actionable_message_when_session_key_missing", async () => {
    const agents = [createAgent("", "Alpha", "session-1")];

    render(
      createElement(AgentBrainPanel, {
        gatewayStatus: "connected",
        agents,
        selectedAgentId: "",
      })
    );

    await waitFor(() => {
      expect(screen.getByText("Agent ID is missing for this agent.")).toBeInTheDocument();
    });
  });

  it("saves_updated_behavior_files", async () => {
    const agents = [createAgent("agent-1", "Alpha", "session-1")];

    render(
      createElement(AgentBrainPanel, {
        gatewayStatus: "connected",
        agents,
        selectedAgentId: "agent-1",
      })
    );

    await waitFor(() => {
      expect(screen.getByLabelText("Directives")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText("Directives"), {
      target: { value: "alpha directives updated" },
    });

    const saveButton = screen.getByRole("button", { name: "Save" });
    expect(saveButton).not.toBeDisabled();
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(mockState.writeCalls.length).toBeGreaterThan(0);
    });
    expect(mockState.filesByAgent["agent-1"]["AGENTS.md"]).toBe("alpha directives updated");
  });

  it("discards_unsaved_changes_without_writing_files", async () => {
    const agents = [createAgent("agent-1", "Alpha", "session-1")];

    render(
      createElement(AgentBrainPanel, {
        gatewayStatus: "connected",
        agents,
        selectedAgentId: "agent-1",
      })
    );

    await waitFor(() => {
      expect(screen.getByLabelText("Name")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Alpha Prime" },
    });
    expect(screen.getByLabelText("Name")).toHaveValue("Alpha Prime");

    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(screen.getByLabelText("Name")).toHaveValue("Alpha");
    expect(mockState.writeCalls.length).toBe(0);
  });

  it("does_not_render_name_editor_in_personality_panel", async () => {
    const agents = [createAgent("agent-1", "Alpha", "session-1")];

    render(
      createElement(AgentBrainPanel, {
        gatewayStatus: "connected",
        agents,
        selectedAgentId: "agent-1",
      })
    );

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Persona" })).toBeInTheDocument();
    });
    expect(screen.queryByLabelText("Agent name")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Update Name" })).not.toBeInTheDocument();
  });

  it("loads_files_after_gateway_connects", async () => {
    const agents = [createAgent("agent-1", "Alpha", "session-1")];

    const view = render(
      createElement(AgentBrainPanel, {
        gatewayStatus: "connecting",
        agents,
        selectedAgentId: "agent-1",
      })
    );

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Persona" })).toBeInTheDocument();
    });
    expect(mockState.readCalls.length).toBe(0);

    view.rerender(
      createElement(AgentBrainPanel, {
        gatewayStatus: "connected",
        agents,
        selectedAgentId: "agent-1",
      })
    );

    await waitFor(() => {
      expect(mockState.readCalls.length).toBeGreaterThan(0);
    });
  });
});
