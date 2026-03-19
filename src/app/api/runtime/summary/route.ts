import { NextResponse } from "next/server";

import { deriveRuntimeFreshness } from "@/lib/controlplane/degraded-read";
import { serializeRuntimeInitFailure } from "@/lib/controlplane/runtime-init-errors";
import { bootstrapDomainRuntime } from "@/lib/controlplane/runtime-route-bootstrap";

export const runtime = "nodejs";

export async function GET() {
  const bootstrap = await bootstrapDomainRuntime();
  if (bootstrap.kind === "mode-disabled") {
    return NextResponse.json({ enabled: false, error: "domain_api_mode_disabled" }, { status: 404 });
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
  const startFailure = bootstrap.kind === "start-failed" ? bootstrap.startFailure : null;

  const snapshot = controlPlane.snapshot();
  return NextResponse.json({
    enabled: true,
    ...(startError ? { error: startError } : {}),
    ...(startFailure ? { startFailure } : {}),
    summary: snapshot,
    freshness: deriveRuntimeFreshness(snapshot, null),
  });
}
