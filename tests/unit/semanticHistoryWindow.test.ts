import { describe, expect, it } from "vitest";

import type { ControlPlaneOutboxEntry } from "@/lib/controlplane/contracts";
import {
  countSemanticTurns,
  resolveActiveRunFromEntries,
  selectSemanticHistoryWindow,
} from "@/lib/controlplane/semantic-history-window";

const chatEntry = (params: {
  id: number;
  runId: string;
  role?: string;
  state: "delta" | "final" | "aborted" | "error";
}): ControlPlaneOutboxEntry => ({
  id: params.id,
  createdAt: `2026-03-03T00:00:${String(params.id).padStart(2, "0")}.000Z`,
  event: {
    type: "gateway.event",
    event: "chat",
    seq: params.id,
    payload: {
      runId: params.runId,
      state: params.state,
      ...(params.role
        ? {
            message: {
              role: params.role,
              content: `${params.role}-${params.id}`,
            },
          }
        : {}),
    },
    asOf: `2026-03-03T00:00:${String(params.id).padStart(2, "0")}.000Z`,
  },
});

const agentEntry = (params: {
  id: number;
  runId: string;
  stream: "lifecycle" | "assistant" | "tool";
  phase?: string;
}): ControlPlaneOutboxEntry => ({
  id: params.id,
  createdAt: `2026-03-03T00:00:${String(params.id).padStart(2, "0")}.000Z`,
  event: {
    type: "gateway.event",
    event: "agent",
    seq: params.id,
    payload: {
      runId: params.runId,
      stream: params.stream,
      data:
        params.phase === undefined
          ? { delta: `delta-${params.id}` }
          : {
              phase: params.phase,
            },
    },
    asOf: `2026-03-03T00:00:${String(params.id).padStart(2, "0")}.000Z`,
  },
});

describe("semantic-history-window", () => {
  it("counts semantic turns from chat events", () => {
    const entries: ControlPlaneOutboxEntry[] = [
      chatEntry({ id: 1, runId: "run-1", role: "user", state: "final" }),
      chatEntry({ id: 2, runId: "run-1", role: "assistant", state: "final" }),
      chatEntry({ id: 3, runId: "run-1", role: "assistant", state: "delta" }),
      agentEntry({ id: 4, runId: "run-1", stream: "tool", phase: "start" }),
    ];
    expect(countSemanticTurns(entries)).toBe(2);
  });

  it("builds semantic windows by turn count", () => {
    const entries: ControlPlaneOutboxEntry[] = [
      chatEntry({ id: 1, runId: "run-a", role: "user", state: "final" }),
      chatEntry({ id: 2, runId: "run-a", role: "assistant", state: "final" }),
      chatEntry({ id: 3, runId: "run-b", role: "user", state: "final" }),
      agentEntry({ id: 4, runId: "run-b", stream: "tool", phase: "start" }),
      chatEntry({ id: 5, runId: "run-b", role: "assistant", state: "final" }),
      chatEntry({ id: 6, runId: "run-c", role: "user", state: "final" }),
      agentEntry({ id: 7, runId: "run-c", stream: "assistant" }),
      agentEntry({ id: 8, runId: "run-c", stream: "tool", phase: "start" }),
    ];

    const window = selectSemanticHistoryWindow({
      entries,
      turnLimit: 2,
      hasMoreBefore: true,
    });

    expect(window.entries.map((entry) => entry.id)).toEqual([4, 5, 6, 7, 8]);
    expect(window.semanticTurnsIncluded).toBe(2);
    expect(window.windowTruncated).toBe(true);
  });

  it("preserves active run traces even when turn limit would cut them", () => {
    const entries: ControlPlaneOutboxEntry[] = [
      chatEntry({ id: 1, runId: "run-a", role: "user", state: "final" }),
      chatEntry({ id: 2, runId: "run-a", role: "assistant", state: "final" }),
      chatEntry({ id: 3, runId: "run-b", role: "user", state: "final" }),
      chatEntry({ id: 4, runId: "run-b", role: "assistant", state: "final" }),
      agentEntry({ id: 5, runId: "run-c", stream: "lifecycle", phase: "start" }),
      agentEntry({ id: 6, runId: "run-c", stream: "tool", phase: "start" }),
      chatEntry({ id: 7, runId: "run-c", role: "user", state: "final" }),
      agentEntry({ id: 8, runId: "run-c", stream: "assistant" }),
    ];

    const window = selectSemanticHistoryWindow({
      entries,
      turnLimit: 1,
      hasMoreBefore: true,
    });

    expect(window.entries.map((entry) => entry.id)).toEqual([5, 6, 7, 8]);
    expect(window.activeRun).toEqual({
      runId: "run-c",
      status: "running",
      complete: true,
    });
  });

  it("marks active runs incomplete when start is missing and older data exists", () => {
    const entries: ControlPlaneOutboxEntry[] = [
      agentEntry({ id: 10, runId: "run-z", stream: "assistant" }),
      agentEntry({ id: 11, runId: "run-z", stream: "tool" }),
    ];

    const active = resolveActiveRunFromEntries(entries, true);
    expect(active).toEqual({
      runId: "run-z",
      status: "running",
      complete: false,
    });
  });
});
