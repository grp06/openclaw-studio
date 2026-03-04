// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  assessFleetPayload,
  assessRuntimePreflight,
  assessProbe,
  classifyBottleneckHint,
  parseProbeArgs,
  percentile,
  summarizeDurations,
} from "../../scripts/probe-fleet-latency.mjs";

describe("probe-fleet-latency", () => {
  it("parses cli defaults", () => {
    expect(parseProbeArgs([])).toEqual({
      baseUrl: "http://127.0.0.1:3000",
      samples: 15,
      warmup: 3,
      timeoutMs: 15_000,
      sloP95Ms: 900,
      json: false,
      allowDisconnected: false,
    });
  });

  it("parses cli overrides", () => {
    expect(
      parseProbeArgs([
        "--base-url",
        "http://localhost:3100/",
        "--samples",
        "20",
        "--warmup",
        "4",
        "--timeout-ms",
        "9000",
        "--slo-p95-ms",
        "700",
        "--allow-disconnected",
        "--json",
      ])
    ).toEqual({
      baseUrl: "http://localhost:3100",
      samples: 20,
      warmup: 4,
      timeoutMs: 9000,
      sloP95Ms: 700,
      json: true,
      allowDisconnected: true,
    });
  });

  it("fails fast on malformed cli values", () => {
    expect(() => parseProbeArgs(["--base-url", "--json"])).toThrow(
      "Missing value for --base-url"
    );
    expect(() => parseProbeArgs(["--samples", "1.5"])).toThrow("Invalid --samples: 1.5");
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

  it("assesses runtime preflight with connection requirement", () => {
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

    const disconnected = assessRuntimePreflight({
      response: {
        ok: true,
        body: {
          summary: { status: "stopped" },
        },
      },
      allowDisconnected: false,
    });
    expect(disconnected.pass).toBe(false);
    expect(disconnected.connected).toBe(false);
    expect(disconnected.status).toBe("stopped");

    const allowedDisconnected = assessRuntimePreflight({
      response: {
        ok: true,
        body: {
          summary: { status: "stopped" },
        },
      },
      allowDisconnected: true,
    });
    expect(allowedDisconnected.pass).toBe(true);
    expect(allowedDisconnected.connected).toBe(false);
    expect(allowedDisconnected.status).toBe("stopped");
  });

  it("fails preflight on malformed summary payload", () => {
    const invalidPayload = assessRuntimePreflight({
      response: { ok: true, body: null },
      allowDisconnected: true,
    });
    expect(invalidPayload.pass).toBe(false);
    expect(invalidPayload.message).toContain("invalid /api/runtime/summary payload");

    const missingSummary = assessRuntimePreflight({
      response: { ok: true, body: {} },
      allowDisconnected: true,
    });
    expect(missingSummary.pass).toBe(false);
    expect(missingSummary.message).toContain("missing summary");

    const missingStatus = assessRuntimePreflight({
      response: { ok: true, body: { summary: {} } },
      allowDisconnected: true,
    });
    expect(missingStatus.pass).toBe(false);
    expect(missingStatus.message).toContain("summary.status missing");
  });

  it("classifies degraded fleet payloads as failures", () => {
    expect(assessFleetPayload({ enabled: true, degraded: false })).toEqual({
      ok: true,
      message: null,
    });

    expect(
      assessFleetPayload({
        enabled: true,
        degraded: true,
        code: "GATEWAY_UNAVAILABLE",
        reason: "gateway_unavailable",
      })
    ).toEqual({
      ok: false,
      message: "degraded fleet response: GATEWAY_UNAVAILABLE gateway_unavailable",
    });

    expect(assessFleetPayload(null)).toEqual({
      ok: false,
      message: "invalid fleet response payload",
    });
  });

  it("assesses pass/fail and diagnosis for fleet latency", () => {
    const endpoint = {
      name: "fleet",
      sloBlocking: true,
      stats: { p95Ms: 750 },
      errors: { count: 0 },
    };

    expect(
      classifyBottleneckHint({
        endpoints: [endpoint],
        sloP95Ms: 900,
      })
    ).toBe("fleet latency is within SLO");

    expect(
      classifyBottleneckHint({
        endpoints: [{ ...endpoint, stats: { p95Ms: 1200 } }],
        sloP95Ms: 900,
      })
    ).toBe("fleet slow -> bootstrap hydration path likely bottleneck");

    expect(
      assessProbe({
        sloP95Ms: 900,
        endpoints: [endpoint],
      }).pass
    ).toBe(true);

    expect(
      assessProbe({
        sloP95Ms: 900,
        endpoints: [{ ...endpoint, stats: { p95Ms: 1200 } }],
      }).pass
    ).toBe(false);

    expect(
      assessProbe({
        sloP95Ms: 900,
        endpoints: [{ ...endpoint, errors: { count: 1 } }],
      }).pass
    ).toBe(false);
  });
});
