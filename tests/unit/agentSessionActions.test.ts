import { describe, expect, it } from "vitest";

import type { AgentState } from "@/features/agents/state/store";
import { buildNewSessionAgentPatch } from "@/features/agents/state/agentSessionActions";

const createAgent = (): AgentState => ({
  agentId: "agent-1",
  name: "Agent One",
  sessionKey: "agent:agent-1:studio:old-session",
  status: "running",
  sessionCreated: true,
  awaitingUserInput: true,
  hasUnseenActivity: true,
  outputLines: ["> hello", "response"],
  lastResult: "response",
  lastDiff: "diff",
  runId: "run-1",
  streamText: "live",
  thinkingTrace: "thinking",
  latestOverride: "override",
  latestOverrideKind: "heartbeat",
  lastAssistantMessageAt: Date.now(),
  lastActivityAt: Date.now(),
  latestPreview: "preview",
  lastUserMessage: "hello",
  draft: "draft",
  sessionSettingsSynced: true,
  historyLoadedAt: Date.now(),
  toolCallingEnabled: true,
  showThinkingTraces: true,
  model: "openai/gpt-5",
  thinkingLevel: "high",
  avatarSeed: "seed-1",
  avatarUrl: null,
});

describe("agent session actions", () => {
  it("builds a patch that resets runtime state for a new studio session", () => {
    const patch = buildNewSessionAgentPatch(createAgent(), "new-session");

    expect(patch.sessionKey).toBe("agent:agent-1:studio:new-session");
    expect(patch.status).toBe("idle");
    expect(patch.sessionCreated).toBe(false);
    expect(patch.sessionSettingsSynced).toBe(false);
    expect(patch.outputLines).toEqual([]);
    expect(patch.streamText).toBeNull();
    expect(patch.thinkingTrace).toBeNull();
    expect(patch.lastResult).toBeNull();
    expect(patch.lastDiff).toBeNull();
    expect(patch.historyLoadedAt).toBeNull();
    expect(patch.lastUserMessage).toBeNull();
    expect(patch.runId).toBeNull();
    expect(patch.latestPreview).toBeNull();
    expect(patch.latestOverride).toBeNull();
    expect(patch.latestOverrideKind).toBeNull();
    expect(patch.lastAssistantMessageAt).toBeNull();
    expect(patch.awaitingUserInput).toBe(false);
    expect(patch.hasUnseenActivity).toBe(false);
    expect(patch.draft).toBe("");
  });
});
