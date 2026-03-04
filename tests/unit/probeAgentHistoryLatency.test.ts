// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  assessRuntimePreflight,
  assessProbe,
  buildProbePaths,
  classifyBottleneckHint,
  parseProbeArgs,
  percentile,
  resolveTargetFromFleet,
  summarizeDurations,
} from "../../scripts/probe-agent-history-latency.mjs";

describe("probe-agent-history-latency", () => {
  it("parses cli defaults", () => {
    expect(parseProbeArgs([])).toEqual({
      baseUrl: "http://127.0.0.1:3000",
      agentId: null,
      sessionKey: null,
      samples: 15,
      warmup: 3,
      timeoutMs: 15_000,
      sloP95Ms: 750,
      json: false,
      allowDisconnected: false,
    });
  });

  it("parses cli overrides", () => {
    expect(
      parseProbeArgs([
        "--base-url",
        "http://localhost:3100/",
        "--agent-id",
        "alpha",
        "--session-key",
        "agent:alpha:main",
        "--samples",
        "20",
        "--warmup",
        "4",
        "--timeout-ms",
        "9000",
        "--slo-p95-ms",
        "600",
        "--allow-disconnected",
        "--json",
      ])
    ).toEqual({
      baseUrl: "http://localhost:3100",
      agentId: "alpha",
      sessionKey: "agent:alpha:main",
      samples: 20,
      warmup: 4,
      timeoutMs: 9000,
      sloP95Ms: 600,
      json: true,
      allowDisconnected: true,
    });
  });

  it("resolves target in priority order", () => {
    expect(
      resolveTargetFromFleet({
        explicitAgentId: "explicit-agent",
        explicitSessionKey: null,
        fleetResult: {
          suggestedSelectedAgentId: "suggested-agent",
          seeds: [{ agentId: "seed-agent" }],
        },
      })
    ).toEqual({
      agentId: "explicit-agent",
      sessionKey: "agent:explicit-agent:main",
    });

    expect(
      resolveTargetFromFleet({
        explicitAgentId: null,
        explicitSessionKey: null,
        fleetResult: {
          suggestedSelectedAgentId: "suggested-agent",
          seeds: [{ agentId: "seed-agent" }],
        },
      })
    ).toEqual({
      agentId: "suggested-agent",
      sessionKey: "agent:suggested-agent:main",
    });

    expect(
      resolveTargetFromFleet({
        explicitAgentId: null,
        explicitSessionKey: null,
        fleetResult: {
          suggestedSelectedAgentId: "",
          seeds: [{ agentId: "seed-agent" }],
        },
      })
    ).toEqual({
      agentId: "seed-agent",
      sessionKey: "agent:seed-agent:main",
    });

    expect(
      resolveTargetFromFleet({
        explicitAgentId: null,
        explicitSessionKey: null,
        fleetResult: null,
      })
    ).toEqual({
      agentId: "main",
      sessionKey: "agent:main:main",
    });
  });

  it("builds tiered endpoint paths for one agent", () => {
    expect(
      buildProbePaths({
        agentId: "main",
        sessionKey: "agent:main:main",
      }).map((entry) => entry.path)
    ).toEqual([
      "/api/runtime/summary",
      "/api/runtime/agents/main/history?limit=50&view=semantic&turnLimit=50&scanLimit=800",
      "/api/runtime/chat-history?sessionKey=agent%3Amain%3Amain&limit=50",
    ]);
  });

  it("computes percentile and stats summaries", () => {
    const durations = [100, 200, 300, 400, 500];
    expect(percentile(durations, 50)).toBe(300);
    expect(percentile(durations, 90)).toBe(500);
    expect(percentile(durations, 95)).toBe(500);
    expect(summarizeDurations(durations, 5)).toEqual({
      attempts: 5,
      count: 5,
      minMs: 100,
      maxMs: 500,
      meanMs: 300,
      p50Ms: 300,
      p90Ms: 500,
      p95Ms: 500,
    });
  });

  it("classifies bottleneck hints from endpoint stats", () => {
    expect(
      classifyBottleneckHint({
        endpoints: [
          {
            name: "summary",
            stats: { p95Ms: null },
            errors: { count: 1 },
          },
          {
            name: "semantic-history",
            stats: { p95Ms: null },
            errors: { count: 0 },
          },
          {
            name: "chat-history",
            stats: { p95Ms: null },
            errors: { count: 0 },
          },
        ],
        sloP95Ms: 750,
      })
    ).toBe("errors present -> fix endpoint failures before latency diagnosis");

    const baseEndpoints = [
      {
        name: "summary",
        stats: { p95Ms: 1500 },
        errors: { count: 0 },
      },
      {
        name: "semantic-history",
        stats: { p95Ms: 900 },
        errors: { count: 0 },
      },
      {
        name: "chat-history",
        stats: { p95Ms: 300 },
        errors: { count: 0 },
      },
    ];
    expect(
      classifyBottleneckHint({
        endpoints: baseEndpoints,
        sloP95Ms: 750,
      })
    ).toBe("semantic slow, chat-history fast -> projection/index issue likely");

    expect(
      classifyBottleneckHint({
        endpoints: [
          baseEndpoints[0],
          { name: "semantic-history", stats: { p95Ms: 300 }, errors: { count: 0 } },
          { name: "chat-history", stats: { p95Ms: 900 }, errors: { count: 0 } },
        ],
        sloP95Ms: 750,
      })
    ).toBe("chat-history slow, semantic fast -> gateway/transcript read likely");

    expect(
      classifyBottleneckHint({
        endpoints: [
          baseEndpoints[0],
          { name: "semantic-history", stats: { p95Ms: 900 }, errors: { count: 0 } },
          { name: "chat-history", stats: { p95Ms: 950 }, errors: { count: 0 } },
        ],
        sloP95Ms: 750,
      })
    ).toBe("both slow -> upstream/gateway saturation or host contention");
  });

  it("assesses pass/fail with endpoint errors and blocking slo breaches only", () => {
    expect(
      assessProbe({
        sloP95Ms: 750,
        endpoints: [
          {
            name: "summary",
            sloBlocking: false,
            stats: { p95Ms: 2_000 },
            errors: { count: 0 },
          },
          {
            name: "semantic-history",
            sloBlocking: true,
            stats: { p95Ms: 700 },
            errors: { count: 0 },
          },
          {
            name: "chat-history",
            sloBlocking: true,
            stats: { p95Ms: 700 },
            errors: { count: 0 },
          },
        ],
      }).pass
    ).toBe(true);

    expect(
      assessProbe({
        sloP95Ms: 750,
        endpoints: [
          {
            name: "summary",
            sloBlocking: false,
            stats: { p95Ms: 300 },
            errors: { count: 0 },
          },
          {
            name: "semantic-history",
            sloBlocking: true,
            stats: { p95Ms: 900 },
            errors: { count: 0 },
          },
          {
            name: "chat-history",
            sloBlocking: true,
            stats: { p95Ms: 300 },
            errors: { count: 0 },
          },
        ],
      }).pass
    ).toBe(false);

    expect(
      assessProbe({
        sloP95Ms: 750,
        endpoints: [
          {
            name: "summary",
            sloBlocking: false,
            stats: { p95Ms: 300 },
            errors: { count: 1 },
          },
          {
            name: "semantic-history",
            sloBlocking: true,
            stats: { p95Ms: 300 },
            errors: { count: 0 },
          },
          {
            name: "chat-history",
            sloBlocking: true,
            stats: { p95Ms: 300 },
            errors: { count: 0 },
          },
        ],
      }).pass
    ).toBe(false);
  });

  it("enforces runtime connectivity preflight unless explicitly allowed", () => {
    expect(
      assessRuntimePreflight({
        response: {
          ok: true,
          body: {
            summary: { status: "connected" },
          },
        },
        allowDisconnected: false,
      })
    ).toEqual({
      pass: true,
      connected: true,
      status: "connected",
      message: null,
    });

    expect(
      assessRuntimePreflight({
        response: {
          ok: true,
          body: {
            summary: { status: "stopped" },
          },
        },
        allowDisconnected: false,
      })
    ).toEqual({
      pass: false,
      connected: false,
      status: "stopped",
      message:
        'runtime preflight failed: summary.status="stopped". Latency samples are invalid for SLO enforcement while disconnected. Reconnect runtime or rerun with --allow-disconnected.',
    });

    expect(
      assessRuntimePreflight({
        response: {
          ok: true,
          body: {
            summary: { status: "stopped" },
          },
        },
        allowDisconnected: true,
      })
    ).toEqual({
      pass: true,
      connected: false,
      status: "stopped",
      message:
        'runtime preflight warning: summary.status="stopped"; continuing because --allow-disconnected is set',
    });

    expect(
      assessRuntimePreflight({
        response: {
          ok: false,
          status: 503,
          error: "service unavailable",
        },
        allowDisconnected: false,
      })
    ).toEqual({
      pass: false,
      connected: false,
      status: null,
      message:
        "runtime preflight failed: unable to read /api/runtime/summary (service unavailable)",
    });
  });
});
