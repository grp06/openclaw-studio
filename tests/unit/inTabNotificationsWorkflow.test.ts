import { describe, expect, it } from "vitest";
import {
  decideInTabNotificationIntents,
  type InTabNotificationState,
} from "@/features/agents/operations/inTabNotificationsWorkflow";

const baseState: InTabNotificationState = {
  focusedAgentId: "agent-1",
  focusedAgentStatus: "idle",
  focusedApprovalCount: 0,
};

describe("inTabNotificationsWorkflow", () => {
  it("notifies when focused agent transitions running -> non-running", () => {
    const intents = decideInTabNotificationIntents({
      previous: { ...baseState, focusedAgentStatus: "running" },
      current: { ...baseState, focusedAgentStatus: "idle" },
      focusedAgentName: "Cody",
      enabled: true,
      permission: "granted",
    });

    expect(intents).toEqual([
      { kind: "notify-run-finished", agentId: "agent-1", agentName: "Cody" },
    ]);
  });

  it("notifies when approvals count increases for the same focused agent", () => {
    const intents = decideInTabNotificationIntents({
      previous: { ...baseState, focusedApprovalCount: 0 },
      current: { ...baseState, focusedApprovalCount: 2 },
      focusedAgentName: "Cody",
      enabled: true,
      permission: "granted",
    });

    expect(intents).toEqual([
      {
        kind: "notify-approval-needed",
        agentId: "agent-1",
        agentName: "Cody",
        count: 2,
      },
    ]);
  });

  it("does not notify on focused-agent switch (baseline reset)", () => {
    const intents = decideInTabNotificationIntents({
      previous: { ...baseState, focusedAgentId: "agent-1", focusedAgentStatus: "running" },
      current: { ...baseState, focusedAgentId: "agent-2", focusedAgentStatus: "idle" },
      focusedAgentName: "Other",
      enabled: true,
      permission: "granted",
    });

    expect(intents).toEqual([]);
  });

  it("does not notify when disabled or permission denied", () => {
    expect(
      decideInTabNotificationIntents({
        previous: { ...baseState, focusedAgentStatus: "running" },
        current: { ...baseState, focusedAgentStatus: "idle" },
        focusedAgentName: "Cody",
        enabled: false,
        permission: "granted",
      })
    ).toEqual([]);

    expect(
      decideInTabNotificationIntents({
        previous: { ...baseState, focusedAgentStatus: "running" },
        current: { ...baseState, focusedAgentStatus: "idle" },
        focusedAgentName: "Cody",
        enabled: true,
        permission: "denied",
      })
    ).toEqual([]);
  });
});
