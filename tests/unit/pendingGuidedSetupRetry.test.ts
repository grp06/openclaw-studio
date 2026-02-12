import { describe, expect, it } from "vitest";
import type { AgentGuidedSetup } from "@/features/agents/operations/createAgentOperation";
import {
  beginPendingGuidedSetupRetry,
  endPendingGuidedSetupRetry,
  selectNextPendingGuidedSetupRetryAgentId,
} from "@/features/agents/creation/pendingSetupRetry";

const createSetup = (): AgentGuidedSetup => ({
  agentOverrides: {
    sandbox: { mode: "non-main", workspaceAccess: "ro" },
    tools: { profile: "coding", alsoAllow: ["group:runtime"], deny: ["group:web"] },
  },
  files: {
    "AGENTS.md": "# Mission",
  },
  execApprovals: {
    security: "allowlist",
    ask: "always",
    allowlist: [{ pattern: "/usr/bin/git" }],
  },
});

describe("pending guided setup retry coordination", () => {
  it("selects next retry target while skipping unknown, attempted, and in-flight entries", () => {
    const pendingSetupsByAgentId = {
      "agent-c": createSetup(),
      "agent-b": createSetup(),
      "agent-a": createSetup(),
    };

    const next = selectNextPendingGuidedSetupRetryAgentId({
      pendingSetupsByAgentId,
      knownAgentIds: new Set(["agent-a", "agent-b"]),
      attemptedAgentIds: new Set(["agent-a"]),
      inFlightAgentIds: new Set(),
    });

    expect(next).toBe("agent-b");
  });

  it("returns deterministic ordering for stable input", () => {
    const pendingSetupsByAgentId = {
      "agent-z": createSetup(),
      "agent-m": createSetup(),
      "agent-a": createSetup(),
    };
    const params = {
      pendingSetupsByAgentId,
      knownAgentIds: new Set(["agent-z", "agent-m", "agent-a"]),
      attemptedAgentIds: new Set<string>(),
      inFlightAgentIds: new Set<string>(),
    };

    const first = selectNextPendingGuidedSetupRetryAgentId(params);
    const second = selectNextPendingGuidedSetupRetryAgentId(params);

    expect(first).toBe("agent-a");
    expect(second).toBe("agent-a");
  });

  it("uses in-flight guards to prevent duplicate starts", () => {
    const inFlight = new Set<string>();

    const firstStart = beginPendingGuidedSetupRetry(inFlight, "agent-1");
    const secondStart = beginPendingGuidedSetupRetry(inFlight, "agent-1");

    expect(firstStart).toBe(true);
    expect(secondStart).toBe(false);
    expect(inFlight.has("agent-1")).toBe(true);

    endPendingGuidedSetupRetry(inFlight, "agent-1");
    expect(inFlight.has("agent-1")).toBe(false);
  });
});
