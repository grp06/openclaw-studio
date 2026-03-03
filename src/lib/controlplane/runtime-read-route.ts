import { NextResponse } from "next/server";

import { ControlPlaneGatewayError } from "@/lib/controlplane/openclaw-adapter";
import { serializeRuntimeInitFailure } from "@/lib/controlplane/runtime-init-errors";
import { bootstrapDomainRuntime } from "@/lib/controlplane/runtime-route-bootstrap";

const mapGatewayError = (error: unknown): NextResponse => {
  if (error instanceof ControlPlaneGatewayError) {
    if (error.code.trim().toUpperCase() === "GATEWAY_UNAVAILABLE") {
      return NextResponse.json(
        {
          error: error.message,
          code: "GATEWAY_UNAVAILABLE",
          reason: "gateway_unavailable",
        },
        { status: 503 }
      );
    }
    return NextResponse.json(
      {
        error: error.message,
        code: error.code,
        details: error.details,
      },
      { status: 400 }
    );
  }

  const message = error instanceof Error ? error.message : "runtime_read_failed";
  return NextResponse.json({ error: message }, { status: 500 });
};

export const executeRuntimeGatewayRead = async <T>(method: string, params: unknown) => {
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
  if (bootstrap.kind === "start-failed") {
    return NextResponse.json(
      {
        enabled: true,
        error: bootstrap.message,
        code: "GATEWAY_UNAVAILABLE",
        reason: "gateway_unavailable",
      },
      { status: 503 }
    );
  }

  try {
    const payload = await bootstrap.runtime.callGateway<T>(method, params);
    return NextResponse.json({ ok: true, payload });
  } catch (error) {
    return mapGatewayError(error);
  }
};
