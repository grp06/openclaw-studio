import { NextResponse } from "next/server";

import { type StudioSettingsPatch } from "@/lib/studio/settings";
import {
  isStudioDomainApiModeEnabled,
  peekControlPlaneRuntime,
} from "@/lib/controlplane/runtime";
import {
  applyStudioSettingsPatch,
  loadLocalGatewayDefaults,
  loadStudioSettings,
  redactLocalGatewayDefaultsSecrets,
  redactStudioSettingsSecrets,
} from "@/lib/studio/settings-store";

export const runtime = "nodejs";

const isPatch = (value: unknown): value is StudioSettingsPatch =>
  Boolean(value && typeof value === "object");

type RuntimeReconnectMetadata = {
  attempted: boolean;
  restarted: boolean;
  reason?: string;
  previousStatus?: string;
  error?: string;
};

const normalizeGatewaySettings = (settings: ReturnType<typeof loadStudioSettings>) => {
  const gateway = settings.gateway ?? null;
  return {
    url: typeof gateway?.url === "string" ? gateway.url.trim() : "",
    token: typeof gateway?.token === "string" ? gateway.token.trim() : "",
  };
};

const gatewaySettingsChanged = (
  previous: ReturnType<typeof loadStudioSettings>,
  next: ReturnType<typeof loadStudioSettings>
) => {
  const left = normalizeGatewaySettings(previous);
  const right = normalizeGatewaySettings(next);
  return left.url !== right.url || left.token !== right.token;
};

const reconnectRuntimeForGatewaySettingsChange = async (
  previous: ReturnType<typeof loadStudioSettings>,
  next: ReturnType<typeof loadStudioSettings>
): Promise<RuntimeReconnectMetadata | null> => {
  if (!gatewaySettingsChanged(previous, next)) return null;
  if (!isStudioDomainApiModeEnabled()) {
    return {
      attempted: false,
      restarted: false,
      reason: "domain_api_mode_disabled",
    };
  }
  const runtime = peekControlPlaneRuntime();
  if (!runtime) {
    return {
      attempted: false,
      restarted: false,
      reason: "runtime_not_initialized",
    };
  }
  const previousStatus = runtime.connectionStatus();
  if (previousStatus === "stopped") {
    return {
      attempted: false,
      restarted: false,
      reason: "runtime_stopped",
      previousStatus,
    };
  }
  try {
    await runtime.reconnectForGatewaySettingsChange();
    return {
      attempted: true,
      restarted: true,
      previousStatus,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "controlplane_reconnect_failed";
    console.error("Failed to reconnect control-plane runtime after gateway settings update.", error);
    return {
      attempted: true,
      restarted: false,
      previousStatus,
      error: message,
    };
  }
};

const buildSettingsResponseBody = (metadata?: RuntimeReconnectMetadata | null) => {
  const settings = loadStudioSettings();
  const localGatewayDefaults = loadLocalGatewayDefaults();
  return {
    settings: redactStudioSettingsSecrets(settings),
    localGatewayDefaults: redactLocalGatewayDefaultsSecrets(localGatewayDefaults),
    domainApiModeEnabled: isStudioDomainApiModeEnabled(),
    ...(metadata ? { runtimeReconnect: metadata } : {}),
  };
};

export async function GET() {
  try {
    return NextResponse.json(buildSettingsResponseBody());
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load studio settings.";
    console.error(message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const body = (await request.json()) as unknown;
    if (!isPatch(body)) {
      return NextResponse.json({ error: "Invalid settings payload." }, { status: 400 });
    }
    const previousSettings = loadStudioSettings();
    const nextSettings = applyStudioSettingsPatch(body);
    const runtimeReconnect = await reconnectRuntimeForGatewaySettingsChange(
      previousSettings,
      nextSettings
    );
    return NextResponse.json(buildSettingsResponseBody(runtimeReconnect));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to save studio settings.";
    console.error(message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
