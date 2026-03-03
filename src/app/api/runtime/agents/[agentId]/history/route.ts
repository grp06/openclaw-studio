import { NextResponse } from "next/server";

import { deriveRuntimeFreshness, probeOpenClawLocalState } from "@/lib/controlplane/degraded-read";
import { serializeRuntimeInitFailure } from "@/lib/controlplane/runtime-init-errors";
import { bootstrapDomainRuntime } from "@/lib/controlplane/runtime-route-bootstrap";
import {
  countSemanticTurns,
  resolveActiveRunFromEntries,
  selectSemanticHistoryWindow,
} from "@/lib/controlplane/semantic-history-window";
import type { ControlPlaneOutboxEntry } from "@/lib/controlplane/contracts";

export const runtime = "nodejs";

type HistoryView = "raw" | "semantic";

const DEFAULT_RAW_LIMIT = 200;
const MAX_RAW_LIMIT = 1000;
const DEFAULT_TURN_LIMIT = 50;
const MAX_TURN_LIMIT = 400;
const DEFAULT_SCAN_LIMIT = 800;
const MAX_SCAN_LIMIT = 5000;
const BACKFILL_BATCH_LIMIT = 500;
const MAX_BACKFILL_BATCHES_PER_REQUEST = 2;

const resolveBoundedPositiveInt = (params: {
  raw: string | null;
  fallback: number;
  max: number;
}): number => {
  if (!params.raw) return params.fallback;
  const parsed = Number(params.raw);
  if (!Number.isFinite(parsed)) return params.fallback;
  if (parsed <= 0) return params.fallback;
  return Math.min(Math.floor(parsed), params.max);
};

const resolveRawLimit = (raw: string | null): number =>
  resolveBoundedPositiveInt({
    raw,
    fallback: DEFAULT_RAW_LIMIT,
    max: MAX_RAW_LIMIT,
  });

const resolveTurnLimit = (raw: string | null): number =>
  resolveBoundedPositiveInt({
    raw,
    fallback: DEFAULT_TURN_LIMIT,
    max: MAX_TURN_LIMIT,
  });

const resolveScanLimit = (raw: string | null): number =>
  resolveBoundedPositiveInt({
    raw,
    fallback: DEFAULT_SCAN_LIMIT,
    max: MAX_SCAN_LIMIT,
  });

const resolveBeforeOutboxId = (raw: string | null, fallback: number): number => {
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  if (parsed <= 0) return fallback;
  return Math.min(Math.floor(parsed), fallback);
};

const resolveView = (raw: string | null): HistoryView => {
  const normalized = (raw ?? "").trim().toLowerCase();
  if (normalized === "raw") return "raw";
  if (normalized === "semantic") return "semantic";
  return "semantic";
};

const resolveNextBeforeOutboxId = (params: {
  hasMore: boolean;
  beforeOutboxId: number;
  backfillIncomplete: boolean;
  entries: ControlPlaneOutboxEntry[];
  fallbackEntries: ControlPlaneOutboxEntry[];
}): number | null => {
  if (!params.hasMore) return null;
  if (params.backfillIncomplete) {
    return params.beforeOutboxId;
  }
  const candidate = params.entries[0]?.id ?? params.fallbackEntries[0]?.id ?? null;
  if (typeof candidate !== "number" || !Number.isFinite(candidate)) return null;
  if (candidate <= 0) return null;
  if (candidate >= params.beforeOutboxId) return null;
  return Math.floor(candidate);
};

export async function GET(
  request: Request,
  context: { params: Promise<{ agentId: string }> }
) {
  const bootstrap = await bootstrapDomainRuntime();
  if (bootstrap.kind === "mode-disabled") {
    return NextResponse.json({ enabled: false, error: "domain_api_mode_disabled" }, { status: 404 });
  }

  const { agentId } = await context.params;
  const normalizedAgentId = agentId.trim();
  if (!normalizedAgentId) {
    return NextResponse.json({ error: "agentId is required." }, { status: 400 });
  }

  if (bootstrap.kind === "runtime-init-failed") {
    return NextResponse.json(
      {
        enabled: true,
        ...serializeRuntimeInitFailure(bootstrap.failure),
      },
      { status: 503 }
    );
  }
  const controlPlane = bootstrap.runtime;
  const startError = bootstrap.kind === "start-failed" ? bootstrap.message : null;

  const url = new URL(request.url);
  const view = resolveView(url.searchParams.get("view"));
  const limit = resolveRawLimit(url.searchParams.get("limit"));
  const turnLimit = resolveTurnLimit(url.searchParams.get("turnLimit"));
  const scanLimit = resolveScanLimit(url.searchParams.get("scanLimit"));
  const snapshot = controlPlane.snapshot();
  const beforeOutboxId = resolveBeforeOutboxId(
    url.searchParams.get("beforeOutboxId"),
    snapshot.outboxHead + 1
  );
  const probe = snapshot.status === "connected" ? null : await probeOpenClawLocalState();

  const loadWindowWithBackfill = (
    targetLimit: number
  ): {
    entries: ControlPlaneOutboxEntry[];
    hasMore: boolean;
    backfillIncomplete: boolean;
  } => {
    let results = controlPlane.eventsBeforeForAgent(
      normalizedAgentId,
      beforeOutboxId,
      targetLimit + 1
    );
    let backfillIncomplete = false;
    if (results.length <= targetLimit) {
      for (let attempt = 0; attempt < MAX_BACKFILL_BATCHES_PER_REQUEST; attempt += 1) {
        const backfill = controlPlane.backfillAgentHistoryIndex(
          beforeOutboxId,
          BACKFILL_BATCH_LIMIT
        );
        if (backfill.scannedRows === 0) {
          backfillIncomplete = false;
          break;
        }
        backfillIncomplete = !backfill.exhausted;
        results = controlPlane.eventsBeforeForAgent(
          normalizedAgentId,
          beforeOutboxId,
          targetLimit + 1
        );
        if (results.length > targetLimit || backfill.exhausted) {
          break;
        }
      }
    }
    const hasMore = results.length > targetLimit || backfillIncomplete;
    const entries =
      results.length > targetLimit ? results.slice(results.length - targetLimit) : results;
    return { entries, hasMore, backfillIncomplete };
  };

  let entries: ControlPlaneOutboxEntry[] = [];
  let hasMore = false;
  let nextBeforeOutboxId: number | null = null;
  let semanticTurnsIncluded = 0;
  let activeRun = resolveActiveRunFromEntries([], false);
  let windowTruncated = false;

  if (view === "semantic") {
    const scanned = loadWindowWithBackfill(scanLimit);
    const semanticWindow = selectSemanticHistoryWindow({
      entries: scanned.entries,
      turnLimit,
      hasMoreBefore: scanned.hasMore,
    });
    entries = semanticWindow.entries;
    hasMore = semanticWindow.windowTruncated;
    semanticTurnsIncluded = semanticWindow.semanticTurnsIncluded;
    activeRun = semanticWindow.activeRun;
    windowTruncated = semanticWindow.windowTruncated;
    nextBeforeOutboxId = resolveNextBeforeOutboxId({
      hasMore,
      beforeOutboxId,
      backfillIncomplete: scanned.backfillIncomplete,
      entries,
      fallbackEntries: scanned.entries,
    });
  } else {
    const rawWindow = loadWindowWithBackfill(limit);
    entries = rawWindow.entries;
    hasMore = rawWindow.hasMore;
    semanticTurnsIncluded = countSemanticTurns(entries);
    activeRun = resolveActiveRunFromEntries(entries, hasMore);
    windowTruncated = hasMore;
    nextBeforeOutboxId = resolveNextBeforeOutboxId({
      hasMore,
      beforeOutboxId,
      backfillIncomplete: rawWindow.backfillIncomplete,
      entries,
      fallbackEntries: entries,
    });
  }

  return NextResponse.json({
    enabled: true,
    agentId: normalizedAgentId,
    ...(startError ? { error: startError } : {}),
    view,
    entries,
    hasMore,
    nextBeforeOutboxId,
    semanticTurnsIncluded,
    activeRun,
    windowTruncated,
    freshness: deriveRuntimeFreshness(snapshot, probe),
    ...(probe ? { probe } : {}),
  });
}
