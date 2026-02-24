import { describe, expect, it } from "vitest";

import {
  planDraftFlushIntent,
  planDraftTimerIntent,
  planNewSessionIntent,
  planStopRunIntent,
} from "@/features/agents/operations/chatInteractionWorkflow";

describe("chatInteractionWorkflow", () => {
  it("denies stop-run when gateway is disconnected", () => {
    const intent = planStopRunIntent({
      status: "disconnected",
      agentId: "agent-1",
      sessionKey: "session-1",
      busyAgentId: null,
    });

    expect(intent).toEqual({
      kind: "deny",
      reason: "not-connected",
      message: "Connect to gateway before stopping a run.",
    });
  });

  it("denies stop-run when session key is missing", () => {
    const intent = planStopRunIntent({
      status: "connected",
      agentId: "agent-1",
      sessionKey: "   ",
      busyAgentId: null,
    });

    expect(intent).toEqual({
      kind: "deny",
      reason: "missing-session-key",
      message: "Missing session key for agent.",
    });
  });

  it("skips duplicate stop-run requests while same agent is busy", () => {
    const intent = planStopRunIntent({
      status: "connected",
      agentId: "agent-1",
      sessionKey: "session-1",
      busyAgentId: "agent-1",
    });

    expect(intent).toEqual({
      kind: "skip-busy",
    });
  });

  it("allows stop-run with a connected gateway and normalized session key", () => {
    const intent = planStopRunIntent({
      status: "connected",
      agentId: "agent-1",
      sessionKey: "  session-1  ",
      busyAgentId: "agent-2",
    });

    expect(intent).toEqual({
      kind: "allow",
      sessionKey: "session-1",
    });
  });

  it("denies new-session when the agent cannot be found", () => {
    const intent = planNewSessionIntent({
      hasAgent: false,
      sessionKey: "session-1",
    });

    expect(intent).toEqual({
      kind: "deny",
      reason: "missing-agent",
      message: "Failed to start new session: agent not found.",
    });
  });

  it("denies new-session when session key is missing", () => {
    const intent = planNewSessionIntent({
      hasAgent: true,
      sessionKey: "",
    });

    expect(intent).toEqual({
      kind: "deny",
      reason: "missing-session-key",
      message: "Missing session key for agent.",
    });
  });

  it("allows new-session when agent exists and session key is present", () => {
    const intent = planNewSessionIntent({
      hasAgent: true,
      sessionKey: "  session-1  ",
    });

    expect(intent).toEqual({
      kind: "allow",
      sessionKey: "session-1",
    });
  });

  it("skips draft flush when agent id is missing", () => {
    const intent = planDraftFlushIntent({
      agentId: null,
      hasPendingValue: true,
    });

    expect(intent).toEqual({
      kind: "skip",
      reason: "missing-agent-id",
    });
  });

  it("skips draft flush when there is no pending draft value", () => {
    const intent = planDraftFlushIntent({
      agentId: "agent-1",
      hasPendingValue: false,
    });

    expect(intent).toEqual({
      kind: "skip",
      reason: "missing-pending-value",
    });
  });

  it("flushes draft when an agent id and pending value are present", () => {
    const intent = planDraftFlushIntent({
      agentId: "agent-1",
      hasPendingValue: true,
    });

    expect(intent).toEqual({
      kind: "flush",
      agentId: "agent-1",
    });
  });

  it("schedules draft timer with default debounce", () => {
    const intent = planDraftTimerIntent({
      agentId: "agent-1",
    });

    expect(intent).toEqual({
      kind: "schedule",
      agentId: "agent-1",
      delayMs: 250,
    });
  });

  it("allows overriding draft timer delay", () => {
    const intent = planDraftTimerIntent({
      agentId: "agent-1",
      delayMs: 500,
    });

    expect(intent).toEqual({
      kind: "schedule",
      agentId: "agent-1",
      delayMs: 500,
    });
  });

  it("skips draft timer scheduling when agent id is missing", () => {
    const intent = planDraftTimerIntent({
      agentId: "",
      delayMs: 250,
    });

    expect(intent).toEqual({
      kind: "skip",
      reason: "missing-agent-id",
    });
  });
});
