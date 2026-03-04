#!/usr/bin/env node

import { performance } from "node:perf_hooks";
import process from "node:process";

const DEFAULT_BASE_URL = "http://127.0.0.1:3000";
const DEFAULT_SAMPLES = 15;
const DEFAULT_WARMUP = 3;
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_SLO_P95_MS = 900;

const asTrimmed = (value) => {
  if (typeof value !== "string") return "";
  return value.trim();
};

const parseNumericArg = (raw, label) => {
  const normalized = asTrimmed(raw);
  const parsed = Number(normalized);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${label}: ${raw}`);
  }
  return parsed;
};

export const parseProbeArgs = (argv) => {
  const config = {
    baseUrl: DEFAULT_BASE_URL,
    samples: DEFAULT_SAMPLES,
    warmup: DEFAULT_WARMUP,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    sloP95Ms: DEFAULT_SLO_P95_MS,
    json: false,
    allowDisconnected: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = asTrimmed(argv[index]);
    if (!token) continue;
    if (token === "--json") {
      config.json = true;
      continue;
    }
    if (token === "--allow-disconnected") {
      config.allowDisconnected = true;
      continue;
    }
    const value = asTrimmed(argv[index + 1]);
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for ${token}`);
    }
    if (token === "--base-url") {
      config.baseUrl = value;
      index += 1;
      continue;
    }
    if (token === "--samples") {
      config.samples = parseNumericArg(value, "--samples");
      index += 1;
      continue;
    }
    if (token === "--warmup") {
      config.warmup = parseNumericArg(value, "--warmup");
      index += 1;
      continue;
    }
    if (token === "--timeout-ms") {
      config.timeoutMs = parseNumericArg(value, "--timeout-ms");
      index += 1;
      continue;
    }
    if (token === "--slo-p95-ms") {
      config.sloP95Ms = parseNumericArg(value, "--slo-p95-ms");
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${token}`);
  }

  return {
    ...config,
    baseUrl: config.baseUrl.replace(/\/+$/, "") || DEFAULT_BASE_URL,
  };
};

export const percentile = (durations, p) => {
  if (!Array.isArray(durations) || durations.length === 0) return null;
  const sorted = [...durations].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  const index = Math.max(0, Math.min(sorted.length - 1, rank - 1));
  return sorted[index];
};

export const summarizeDurations = (durations, attempts) => {
  if (!Array.isArray(durations) || durations.length === 0) {
    return {
      attempts,
      count: 0,
      minMs: null,
      maxMs: null,
      meanMs: null,
      p50Ms: null,
      p90Ms: null,
      p95Ms: null,
    };
  }
  const count = durations.length;
  const total = durations.reduce((acc, value) => acc + value, 0);
  return {
    attempts,
    count,
    minMs: Math.min(...durations),
    maxMs: Math.max(...durations),
    meanMs: total / count,
    p50Ms: percentile(durations, 50),
    p90Ms: percentile(durations, 90),
    p95Ms: percentile(durations, 95),
  };
};

export const assessRuntimePreflight = ({ response, allowDisconnected }) => {
  if (!response.ok) {
    return {
      pass: false,
      connected: false,
      status: null,
      message: `runtime preflight failed: unable to read /api/runtime/summary (${response.error || response.status})`,
    };
  }

  const payload = response.body;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return {
      pass: false,
      connected: false,
      status: null,
      message: "runtime preflight failed: invalid /api/runtime/summary payload",
    };
  }
  const summary = payload.summary;
  if (!summary || typeof summary !== "object" || Array.isArray(summary)) {
    return {
      pass: false,
      connected: false,
      status: null,
      message: "runtime preflight failed: missing summary in /api/runtime/summary payload",
    };
  }
  const runtimeStatus = asTrimmed(summary.status ?? "");
  if (!runtimeStatus) {
    return {
      pass: false,
      connected: false,
      status: null,
      message: "runtime preflight failed: summary.status missing in /api/runtime/summary payload",
    };
  }
  const connected = runtimeStatus === "connected";

  if (connected) {
    return {
      pass: true,
      connected: true,
      status: runtimeStatus,
      message: null,
    };
  }

  if (allowDisconnected) {
    return {
      pass: true,
      connected: false,
      status: runtimeStatus,
      message: `runtime preflight warning: summary.status=\"${runtimeStatus}\"; continuing because --allow-disconnected is set`,
    };
  }

  return {
    pass: false,
    connected: false,
    status: runtimeStatus,
    message:
      `runtime preflight failed: summary.status=\"${runtimeStatus}\". ` +
      "Fleet latency samples are invalid for SLO enforcement while disconnected. " +
      "Reconnect runtime or rerun with --allow-disconnected.",
  };
};

export const assessFleetPayload = (body) => {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return {
      ok: false,
      message: "invalid fleet response payload",
    };
  }
  if (body.degraded === true) {
    const code = typeof body.code === "string" ? body.code.trim() : "";
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    const error = typeof body.error === "string" ? body.error.trim() : "";
    const detail = [code, reason, error].filter(Boolean).join(" ").trim();
    return {
      ok: false,
      message: detail ? `degraded fleet response: ${detail}` : "degraded fleet response",
    };
  }
  return {
    ok: true,
    message: null,
  };
};

export const classifyBottleneckHint = (params) => {
  const hasErrors = params.endpoints.some((entry) => (entry.errors?.count ?? 0) > 0);
  if (hasErrors) {
    return "errors present -> fix endpoint failures before latency diagnosis";
  }
  const fleet = params.endpoints.find((entry) => entry.name === "fleet") ?? null;
  if (!fleet) {
    return "incomplete probe results.";
  }
  const fleetP95 = fleet.stats.p95Ms;
  const fleetSlow = typeof fleetP95 === "number" && fleetP95 > params.sloP95Ms;
  if (fleetSlow) {
    return "fleet slow -> bootstrap hydration path likely bottleneck";
  }
  return "fleet latency is within SLO";
};

export const assessProbe = (params) => {
  const errorsPresent = params.endpoints.some((entry) => entry.errors.count > 0);
  const blockingSloBreach = params.endpoints.some((entry) => {
    if (!entry.sloBlocking) return false;
    const p95 = entry.stats.p95Ms;
    return typeof p95 === "number" && p95 > params.sloP95Ms;
  });
  return {
    pass: !errorsPresent && !blockingSloBreach,
    bottleneckHint: classifyBottleneckHint(params),
  };
};

const toFixedMs = (value) => {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  return `${value.toFixed(1)}ms`;
};

const readErrorSnippet = async (response) => {
  try {
    const text = await response.text();
    const normalized = text.replace(/\s+/g, " ").trim();
    return normalized.slice(0, 240);
  } catch {
    return "";
  }
};

const timedRequest = async ({ baseUrl, endpoint, timeoutMs }) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = performance.now();
  try {
    const response = await fetch(`${baseUrl}${endpoint.path}`, {
      method: endpoint.method,
      signal: controller.signal,
      headers: endpoint.method === "POST" ? { "Content-Type": "application/json" } : undefined,
      body: endpoint.method === "POST" ? "{}" : undefined,
    });
    const durationMs = performance.now() - startedAt;
    if (response.status !== 200) {
      return {
        ok: false,
        status: response.status,
        durationMs,
        error: await readErrorSnippet(response),
      };
    }
    return {
      ok: true,
      status: response.status,
      durationMs,
      body: await response.json(),
    };
  } catch (error) {
    const durationMs = performance.now() - startedAt;
    const message = error instanceof Error ? error.message : "request_failed";
    return { ok: false, status: 0, durationMs, error: message };
  } finally {
    clearTimeout(timer);
  }
};

const runEndpointProbe = async ({ baseUrl, endpoint, warmup, samples, timeoutMs }) => {
  for (let index = 0; index < warmup; index += 1) {
    await timedRequest({ baseUrl, endpoint, timeoutMs });
  }

  const durations = [];
  let errorCount = 0;
  let lastError = null;
  for (let index = 0; index < samples; index += 1) {
    const response = await timedRequest({ baseUrl, endpoint, timeoutMs });
    if (!response.ok) {
      errorCount += 1;
      lastError = {
        status: response.status,
        message: response.error || "request_failed",
      };
      continue;
    }
    const payloadAssessment = assessFleetPayload(response.body);
    if (!payloadAssessment.ok) {
      errorCount += 1;
      lastError = {
        status: response.status,
        message: payloadAssessment.message ?? "invalid_fleet_payload",
      };
      continue;
    }
    durations.push(response.durationMs);
  }

  return {
    name: endpoint.name,
    path: endpoint.path,
    sloBlocking: endpoint.sloBlocking,
    status: errorCount > 0 ? "fail" : "ok",
    stats: summarizeDurations(durations, samples),
    errors: {
      count: errorCount,
      last: lastError,
    },
  };
};

const printHumanOutput = ({ baseUrl, config, endpoint, assessment, preflightMessage }) => {
  if (preflightMessage) {
    process.stdout.write(`${preflightMessage}\n`);
  }
  process.stdout.write(`target=fleet baseUrl=${baseUrl}\n`);
  process.stdout.write(
    `samples=${config.samples} warmup=${config.warmup} timeoutMs=${config.timeoutMs} sloP95Ms=${config.sloP95Ms}\n`
  );
  process.stdout.write(
    "endpoint attempts ok  errors p50      p95      mean     min      max\n"
  );
  const row = [
    endpoint.name.padEnd(8, " "),
    String(endpoint.stats.attempts).padStart(8, " "),
    String(endpoint.stats.count).padStart(3, " "),
    String(endpoint.errors.count).padStart(6, " "),
    toFixedMs(endpoint.stats.p50Ms).padStart(8, " "),
    toFixedMs(endpoint.stats.p95Ms).padStart(8, " "),
    toFixedMs(endpoint.stats.meanMs).padStart(8, " "),
    toFixedMs(endpoint.stats.minMs).padStart(8, " "),
    toFixedMs(endpoint.stats.maxMs).padStart(8, " "),
  ].join(" ");
  process.stdout.write(`${row}\n`);
  if (endpoint.errors.last) {
    process.stdout.write(
      `  last_error: status=${endpoint.errors.last.status} message=${endpoint.errors.last.message}\n`
    );
  }
  process.stdout.write(`diagnosis: ${assessment.bottleneckHint}\n`);
  process.stdout.write(`result: ${assessment.pass ? "PASS" : "FAIL"}\n`);
};

export const runProbe = async (rawArgs) => {
  const args = parseProbeArgs(rawArgs);

  const preflightResponse = await timedRequest({
    baseUrl: args.baseUrl,
    endpoint: {
      name: "summary-preflight",
      method: "GET",
      path: "/api/runtime/summary",
    },
    timeoutMs: args.timeoutMs,
  });
  const preflight = assessRuntimePreflight({
    response: preflightResponse,
    allowDisconnected: args.allowDisconnected,
  });

  if (!preflight.pass) {
    if (args.json) {
      process.stdout.write(
        `${JSON.stringify(
          {
            target: { baseUrl: args.baseUrl },
            config: {
              samples: args.samples,
              warmup: args.warmup,
              timeoutMs: args.timeoutMs,
              sloP95Ms: args.sloP95Ms,
              allowDisconnected: args.allowDisconnected,
            },
            endpoints: [],
            assessment: {
              pass: false,
              bottleneckHint: "preflight failed",
            },
            preflight,
          },
          null,
          2
        )}\n`
      );
    } else {
      process.stdout.write(`${preflight.message}\n`);
      process.stdout.write("result: FAIL\n");
    }
    process.exitCode = 1;
    return;
  }

  const endpoint = {
    name: "fleet",
    method: "POST",
    path: "/api/runtime/fleet",
    sloBlocking: true,
  };
  const endpointResult = await runEndpointProbe({
    baseUrl: args.baseUrl,
    endpoint,
    warmup: args.warmup,
    samples: args.samples,
    timeoutMs: args.timeoutMs,
  });

  const assessment = assessProbe({
    endpoints: [endpointResult],
    sloP95Ms: args.sloP95Ms,
  });

  const payload = {
    target: {
      baseUrl: args.baseUrl,
    },
    config: {
      samples: args.samples,
      warmup: args.warmup,
      timeoutMs: args.timeoutMs,
      sloP95Ms: args.sloP95Ms,
      allowDisconnected: args.allowDisconnected,
    },
    endpoints: [
      {
        name: endpointResult.name,
        path: endpointResult.path,
        status: endpointResult.status,
        stats: endpointResult.stats,
        errors: endpointResult.errors,
      },
    ],
    assessment,
    preflight,
  };

  if (args.json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  } else {
    printHumanOutput({
      baseUrl: payload.target.baseUrl,
      config: payload.config,
      endpoint: endpointResult,
      assessment: payload.assessment,
      preflightMessage: preflight.message,
    });
  }

  if (!assessment.pass) {
    process.exitCode = 1;
  }
};

const isDirectRun = (() => {
  const scriptArg = process.argv[1];
  if (!scriptArg) return false;
  try {
    return new URL(`file://${scriptArg}`).pathname === new URL(import.meta.url).pathname;
  } catch {
    return false;
  }
})();

if (isDirectRun) {
  runProbe(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
