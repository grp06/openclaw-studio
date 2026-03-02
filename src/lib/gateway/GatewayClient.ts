"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  GatewayBrowserClient,
  type GatewayHelloOk,
} from "./openclaw/GatewayBrowserClient";
import type {
  StudioGatewaySettings,
  StudioSettings,
  StudioSettingsPatch,
} from "@/lib/studio/settings";
import type { StudioSettingsResponse } from "@/lib/studio/coordinator";
import { resolveStudioProxyGatewayUrl } from "@/lib/gateway/proxy-url";
import { ensureGatewayReloadModeHotForLocalStudio } from "@/lib/gateway/gatewayReloadMode";
import { GatewayResponseError } from "@/lib/gateway/errors";
import {
  buildAgentMainSessionKey,
  parseAgentIdFromSessionKey,
  isSameSessionKey,
} from "@/lib/gateway/session-keys";

type ReqFrame = {
  type: "req";
  id: string;
  method: string;
  params: unknown;
};

type ResFrame = {
  type: "res";
  id: string;
  ok: boolean;
  payload?: unknown;
  error?: {
    code: string;
    message: string;
    details?: unknown;
    retryable?: boolean;
    retryAfterMs?: number;
  };
};

export type GatewayStateVersion = {
  presence: number;
  health: number;
};

export type EventFrame = {
  type: "event";
  event: string;
  payload?: unknown;
  seq?: number;
  stateVersion?: GatewayStateVersion;
};

type GatewayFrame = ReqFrame | ResFrame | EventFrame;

export const parseGatewayFrame = (raw: string): GatewayFrame | null => {
  try {
    return JSON.parse(raw) as GatewayFrame;
  } catch {
    return null;
  }
};

export { buildAgentMainSessionKey, parseAgentIdFromSessionKey, isSameSessionKey };

const CONNECT_FAILED_CLOSE_CODE = 4008;

const parseConnectFailedCloseReason = (
  reason: string
): { code: string; message: string } | null => {
  const trimmed = reason.trim();
  if (!trimmed.toLowerCase().startsWith("connect failed:")) return null;
  const remainder = trimmed.slice("connect failed:".length).trim();
  if (!remainder) return null;
  const idx = remainder.indexOf(" ");
  const code = (idx === -1 ? remainder : remainder.slice(0, idx)).trim();
  if (!code) return null;
  const message = (idx === -1 ? "" : remainder.slice(idx + 1)).trim();
  return { code, message: message || "connect failed" };
};

const DEFAULT_UPSTREAM_GATEWAY_URL =
  process.env.NEXT_PUBLIC_GATEWAY_URL || "ws://localhost:18789";

const normalizeLocalGatewayDefaults = (value: unknown): StudioGatewaySettings | null => {
  if (!value || typeof value !== "object") return null;
  const raw = value as { url?: unknown; token?: unknown };
  const url = typeof raw.url === "string" ? raw.url.trim() : "";
  const token = typeof raw.token === "string" ? raw.token.trim() : "";
  if (!url) return null;
  return { url, token };
};

type StatusHandler = (status: GatewayStatus) => void;

type EventHandler = (event: EventFrame) => void;

export type GatewayGapInfo = { expected: number; received: number };

type GapHandler = (info: GatewayGapInfo) => void;

export type GatewayStatus = "disconnected" | "connecting" | "connected";

type GatewayConnectOptions = {
  gatewayUrl: string;
  token?: string;
  authScopeKey?: string;
  clientName?: string;
  disableDeviceAuth?: boolean;
};

export { GatewayResponseError } from "@/lib/gateway/errors";
;

export class GatewayClient {
  private client: GatewayBrowserClient | null = null;
  private statusHandlers = new Set<StatusHandler>();
  private eventHandlers = new Set<EventHandler>();
  private gapHandlers = new Set<GapHandler>();
  private status: GatewayStatus = "disconnected";
  private pendingConnect: Promise<void> | null = null;
  private resolveConnect: (() => void) | null = null;
  private rejectConnect: ((error: Error) => void) | null = null;
  private manualDisconnect = false;
  private lastHello: GatewayHelloOk | null = null;

  onStatus(handler: StatusHandler) {
    this.statusHandlers.add(handler);
    handler(this.status);
    return () => {
      this.statusHandlers.delete(handler);
    };
  }

  onEvent(handler: EventHandler) {
    this.eventHandlers.add(handler);
    return () => {
      this.eventHandlers.delete(handler);
    };
  }

  onGap(handler: GapHandler) {
    this.gapHandlers.add(handler);
    return () => {
      this.gapHandlers.delete(handler);
    };
  }

  async connect(options: GatewayConnectOptions) {
    if (!options.gatewayUrl.trim()) {
      throw new Error("Gateway URL is required.");
    }
    if (this.client) {
      throw new Error("Gateway is already connected or connecting.");
    }

    this.manualDisconnect = false;
    this.updateStatus("connecting");

    this.pendingConnect = new Promise<void>((resolve, reject) => {
      this.resolveConnect = resolve;
      this.rejectConnect = reject;
    });

    const nextClient = new GatewayBrowserClient({
      url: options.gatewayUrl,
      token: options.token,
      authScopeKey: options.authScopeKey,
      clientName: options.clientName,
      disableDeviceAuth: options.disableDeviceAuth,
      onHello: (hello) => {
        if (this.client !== nextClient) return;
        this.lastHello = hello;
        this.updateStatus("connected");
        this.resolveConnect?.();
        this.clearConnectPromise();
      },
      onEvent: (event) => {
        if (this.client !== nextClient) return;
        this.eventHandlers.forEach((handler) => handler(event));
      },
      onClose: ({ code, reason }) => {
        if (this.client !== nextClient) return;
        const connectFailed =
          code === CONNECT_FAILED_CLOSE_CODE ? parseConnectFailedCloseReason(reason) : null;
        const err = connectFailed
          ? new GatewayResponseError({
              code: connectFailed.code,
              message: connectFailed.message,
            })
          : new Error(`Gateway closed (${code}): ${reason}`);
        if (this.rejectConnect) {
          this.rejectConnect(err);
          this.clearConnectPromise();
        }
        if (!this.manualDisconnect) {
          nextClient.stop();
        }
        if (this.client === nextClient) {
          this.client = null;
        }
        this.updateStatus("disconnected");
        if (this.manualDisconnect) {
          console.info("Gateway disconnected.");
        }
      },
      onGap: ({ expected, received }) => {
        if (this.client !== nextClient) return;
        this.gapHandlers.forEach((handler) => handler({ expected, received }));
      },
    });

    this.client = nextClient;
    nextClient.start();

    try {
      await this.pendingConnect;
    } catch (err) {
      const activeClient = this.client;
      activeClient?.stop();
      if (this.client === activeClient) {
        this.client = null;
      }
      this.updateStatus("disconnected");
      throw err;
    }
  }

  disconnect() {
    if (!this.client) {
      return;
    }

    this.manualDisconnect = true;
    this.client.stop();
    this.client = null;
    this.clearConnectPromise();
    this.updateStatus("disconnected");
    console.info("Gateway disconnected.");
  }

  async call<T = unknown>(method: string, params: unknown): Promise<T> {
    if (!method.trim()) {
      throw new Error("Gateway method is required.");
    }
    if (!this.client || !this.client.connected) {
      throw new Error("Gateway is not connected.");
    }

    const payload = await this.client.request<T>(method, params);
    return payload as T;
  }

  getLastHello() {
    return this.lastHello;
  }

  private updateStatus(status: GatewayStatus) {
    this.status = status;
    this.statusHandlers.forEach((handler) => handler(status));
  }

  private clearConnectPromise() {
    this.pendingConnect = null;
    this.resolveConnect = null;
    this.rejectConnect = null;
  }
}

export const isGatewayDisconnectLikeError = (err: unknown): boolean => {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  if (!msg) return false;
  if (
    msg.includes("gateway not connected") ||
    msg.includes("gateway is not connected") ||
    msg.includes("gateway client stopped")
  ) {
    return true;
  }

  const match = msg.match(/gateway closed \\((\\d+)\\)/);
  if (!match) return false;
  const code = Number(match[1]);
  return Number.isFinite(code) && code === 1012;
};

const WEBCHAT_SESSION_MUTATION_BLOCKED_RE = /webchat clients cannot (patch|delete) sessions/i;
const WEBCHAT_SESSION_MUTATION_HINT_RE = /use chat\.send for session-scoped updates/i;

export const isWebchatSessionMutationBlockedError = (error: unknown): boolean => {
  if (!(error instanceof GatewayResponseError)) return false;
  if (error.code.trim().toUpperCase() !== "INVALID_REQUEST") return false;
  const message = error.message.trim();
  if (!message) return false;
  return (
    WEBCHAT_SESSION_MUTATION_BLOCKED_RE.test(message) &&
    WEBCHAT_SESSION_MUTATION_HINT_RE.test(message)
  );
};

type SessionSettingsPatchPayload = {
  key: string;
  model?: string | null;
  thinkingLevel?: string | null;
  execHost?: "sandbox" | "gateway" | "node" | null;
  execSecurity?: "deny" | "allowlist" | "full" | null;
  execAsk?: "off" | "on-miss" | "always" | null;
};

export type GatewaySessionsPatchResult = {
  ok: true;
  key: string;
  entry?: {
    thinkingLevel?: string;
  };
  resolved?: {
    modelProvider?: string;
    model?: string;
  };
};

type SyncGatewaySessionSettingsParams = {
  client: GatewayClient;
  sessionKey: string;
  model?: string | null;
  thinkingLevel?: string | null;
  execHost?: "sandbox" | "gateway" | "node" | null;
  execSecurity?: "deny" | "allowlist" | "full" | null;
  execAsk?: "off" | "on-miss" | "always" | null;
};

export const syncGatewaySessionSettings = async ({
  client,
  sessionKey,
  model,
  thinkingLevel,
  execHost,
  execSecurity,
  execAsk,
}: SyncGatewaySessionSettingsParams) => {
  const key = sessionKey.trim();
  if (!key) {
    throw new Error("Session key is required.");
  }
  const includeModel = model !== undefined;
  const includeThinkingLevel = thinkingLevel !== undefined;
  const includeExecHost = execHost !== undefined;
  const includeExecSecurity = execSecurity !== undefined;
  const includeExecAsk = execAsk !== undefined;
  if (
    !includeModel &&
    !includeThinkingLevel &&
    !includeExecHost &&
    !includeExecSecurity &&
    !includeExecAsk
  ) {
    throw new Error("At least one session setting must be provided.");
  }
  const payload: SessionSettingsPatchPayload = { key };
  if (includeModel) {
    payload.model = model ?? null;
  }
  if (includeThinkingLevel) {
    payload.thinkingLevel = thinkingLevel ?? null;
  }
  if (includeExecHost) {
    payload.execHost = execHost ?? null;
  }
  if (includeExecSecurity) {
    payload.execSecurity = execSecurity ?? null;
  }
  if (includeExecAsk) {
    payload.execAsk = execAsk ?? null;
  }
  return await client.call<GatewaySessionsPatchResult>("sessions.patch", payload);
};

const doctorFixHint =
  "Run `npx openclaw doctor --fix` on the gateway host (or `pnpm openclaw doctor --fix` in a source checkout).";

const formatGatewayError = (error: unknown) => {
  if (error instanceof GatewayResponseError) {
    if (error.code === "INVALID_REQUEST" && /invalid config/i.test(error.message)) {
      return `Gateway error (${error.code}): ${error.message}. ${doctorFixHint}`;
    }
    return `Gateway error (${error.code}): ${error.message}`;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "Unknown gateway error.";
};

type GatewayConnectionState = {
  client: GatewayClient;
  status: GatewayStatus;
  gatewayUrl: string;
  token: string;
  localGatewayDefaults: StudioGatewaySettings | null;
  domainApiModeEnabled: boolean | null;
  error: string | null;
  connect: () => Promise<void>;
  disconnect: () => void;
  useLocalGatewayDefaults: () => void;
  setGatewayUrl: (value: string) => void;
  setToken: (value: string) => void;
  clearError: () => void;
};

type StudioSettingsCoordinatorLike = {
  loadSettings: () => Promise<StudioSettings | null>;
  loadSettingsEnvelope?: () => Promise<StudioSettingsResponse>;
  schedulePatch: (patch: StudioSettingsPatch, debounceMs?: number) => void;
  flushPending: () => Promise<void>;
};

const isAuthError = (errorMessage: string | null): boolean => {
  if (!errorMessage) return false;
  const lower = errorMessage.toLowerCase();
  return (
    lower.includes("auth") ||
    lower.includes("unauthorized") ||
    lower.includes("forbidden") ||
    lower.includes("invalid token") ||
    lower.includes("token required") ||
    (lower.includes("token") && lower.includes("not configured")) ||
    lower.includes("gateway_token_missing")
  );
};

const MAX_AUTO_RETRY_ATTEMPTS = 20;
const INITIAL_RETRY_DELAY_MS = 2_000;
const MAX_RETRY_DELAY_MS = 30_000;

const NON_RETRYABLE_CONNECT_ERROR_CODES = new Set([
  "studio.gateway_url_missing",
  "studio.gateway_token_missing",
  "studio.gateway_url_invalid",
  "studio.settings_load_failed",
]);

const isNonRetryableConnectErrorCode = (code: string | null): boolean => {
  const normalized = code?.trim().toLowerCase() ?? "";
  if (!normalized) return false;
  return NON_RETRYABLE_CONNECT_ERROR_CODES.has(normalized);
};

export const resolveGatewayAutoRetryDelayMs = (params: {
  status: GatewayStatus;
  didAutoConnect: boolean;
  wasManualDisconnect: boolean;
  gatewayUrl: string;
  errorMessage: string | null;
  connectErrorCode: string | null;
  attempt: number;
}): number | null => {
  if (params.status !== "disconnected") return null;
  if (!params.didAutoConnect) return null;
  if (params.wasManualDisconnect) return null;
  if (!params.gatewayUrl.trim()) return null;
  if (params.attempt >= MAX_AUTO_RETRY_ATTEMPTS) return null;
  if (isNonRetryableConnectErrorCode(params.connectErrorCode)) return null;
  if (params.connectErrorCode === null && isAuthError(params.errorMessage)) return null;

  return Math.min(
    INITIAL_RETRY_DELAY_MS * Math.pow(1.5, params.attempt),
    MAX_RETRY_DELAY_MS
  );
};

export const useGatewayConnection = (
  settingsCoordinator: StudioSettingsCoordinatorLike
): GatewayConnectionState => {
  const [client] = useState(() => new GatewayClient());
  const didAutoConnect = useRef(false);
  const loadedGatewaySettings = useRef<{ gatewayUrl: string } | null>(null);
  const retryAttemptRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wasManualDisconnectRef = useRef(false);
  const tokenDirtyRef = useRef(false);

  const [gatewayUrl, setGatewayUrl] = useState(DEFAULT_UPSTREAM_GATEWAY_URL);
  const [token, setTokenState] = useState("");
  const [localGatewayDefaults, setLocalGatewayDefaults] = useState<StudioGatewaySettings | null>(
    null
  );
  const [domainApiModeEnabled, setDomainApiModeEnabled] = useState<boolean | null>(null);
  const [status, setStatus] = useState<GatewayStatus>("disconnected");
  const [error, setError] = useState<string | null>(null);
  const [connectErrorCode, setConnectErrorCode] = useState<string | null>(null);
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const loadSettings = async () => {
      try {
        const envelope =
          typeof settingsCoordinator.loadSettingsEnvelope === "function"
            ? await settingsCoordinator.loadSettingsEnvelope()
            : { settings: await settingsCoordinator.loadSettings(), localGatewayDefaults: null };
        const settings = envelope.settings ?? null;
        const gateway = settings?.gateway ?? null;
        if (cancelled) return;
        setLocalGatewayDefaults(normalizeLocalGatewayDefaults(envelope.localGatewayDefaults));
        const envelopeDomainMode =
          "domainApiModeEnabled" in envelope ? envelope.domainApiModeEnabled : undefined;
        setDomainApiModeEnabled(
          typeof envelopeDomainMode === "boolean" ? envelopeDomainMode : null
        );
        const nextGatewayUrl = gateway?.url?.trim() ? gateway.url : DEFAULT_UPSTREAM_GATEWAY_URL;
        const nextToken = typeof gateway?.token === "string" ? gateway.token : "";
        loadedGatewaySettings.current = {
          gatewayUrl: nextGatewayUrl.trim(),
        };
        setGatewayUrl(nextGatewayUrl);
        setTokenState(nextToken);
        tokenDirtyRef.current = false;
      } catch (err) {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : "Failed to load gateway settings.";
          setError(message);
        }
      } finally {
        if (!cancelled) {
          if (!loadedGatewaySettings.current) {
            loadedGatewaySettings.current = {
              gatewayUrl: DEFAULT_UPSTREAM_GATEWAY_URL.trim(),
            };
          }
          setSettingsLoaded(true);
        }
      }
    };
    void loadSettings();
    return () => {
      cancelled = true;
    };
  }, [settingsCoordinator]);

  useEffect(() => {
    return client.onStatus((nextStatus) => {
      setStatus(nextStatus);
      if (nextStatus !== "connecting") {
        setError(null);
        if (nextStatus === "connected") {
          setConnectErrorCode(null);
        }
      }
    });
  }, [client]);

  useEffect(() => {
    return () => {
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      client.disconnect();
    };
  }, [client]);

  const connect = useCallback(async () => {
    setError(null);
    setConnectErrorCode(null);
    wasManualDisconnectRef.current = false;
    try {
      await settingsCoordinator.flushPending();
      await client.connect({
        gatewayUrl: resolveStudioProxyGatewayUrl(),
        token,
        authScopeKey: gatewayUrl,
        clientName: "openclaw-control-ui",
        disableDeviceAuth: true,
      });
      await ensureGatewayReloadModeHotForLocalStudio({
        client,
        upstreamGatewayUrl: gatewayUrl,
      });
      retryAttemptRef.current = 0;
    } catch (err) {
      setConnectErrorCode(err instanceof GatewayResponseError ? err.code : null);
      setError(formatGatewayError(err));
    }
  }, [client, gatewayUrl, settingsCoordinator, token]);

  useEffect(() => {
    if (domainApiModeEnabled === true) return;
    if (didAutoConnect.current) return;
    if (!settingsLoaded) return;
    if (!gatewayUrl.trim()) return;
    didAutoConnect.current = true;
    void connect();
  }, [connect, domainApiModeEnabled, gatewayUrl, settingsLoaded]);

  // Auto-retry on disconnect (gateway busy, network blip, etc.)
  useEffect(() => {
    if (domainApiModeEnabled === true) {
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      return;
    }
    const attempt = retryAttemptRef.current;
    const delay = resolveGatewayAutoRetryDelayMs({
      status,
      didAutoConnect: didAutoConnect.current,
      wasManualDisconnect: wasManualDisconnectRef.current,
      gatewayUrl,
      errorMessage: error,
      connectErrorCode,
      attempt,
    });
    if (delay === null) return;
    retryTimerRef.current = setTimeout(() => {
      retryAttemptRef.current = attempt + 1;
      void connect();
    }, delay);

    return () => {
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    };
  }, [connect, connectErrorCode, domainApiModeEnabled, error, gatewayUrl, status]);

  useEffect(() => {
    if (domainApiModeEnabled !== true) return;
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    retryAttemptRef.current = 0;
    didAutoConnect.current = false;
    setError(null);
    setConnectErrorCode(null);
    if (status === "disconnected") return;
    wasManualDisconnectRef.current = true;
    client.disconnect();
  }, [client, domainApiModeEnabled, status]);

  // Reset retry count on successful connection
  useEffect(() => {
    if (status === "connected") {
      retryAttemptRef.current = 0;
    }
  }, [status]);

  useEffect(() => {
    if (!settingsLoaded) return;
    const baseline = loadedGatewaySettings.current;
    if (!baseline) return;
    const nextGatewayUrl = gatewayUrl.trim();
    const shouldPersistToken = tokenDirtyRef.current;
    if (!shouldPersistToken && nextGatewayUrl === baseline.gatewayUrl) {
      return;
    }
    const gatewayPatch: { url: string; token?: string } = { url: nextGatewayUrl };
    if (shouldPersistToken) {
      gatewayPatch.token = token;
      tokenDirtyRef.current = false;
    }
    settingsCoordinator.schedulePatch(
      {
        gateway: gatewayPatch,
      },
      400
    );
    loadedGatewaySettings.current = { gatewayUrl: nextGatewayUrl };
  }, [gatewayUrl, settingsCoordinator, settingsLoaded, token]);

  const useLocalGatewayDefaults = useCallback(() => {
    if (!localGatewayDefaults) {
      return;
    }
    setGatewayUrl(localGatewayDefaults.url);
    setTokenState(localGatewayDefaults.token);
    tokenDirtyRef.current = false;
    setError(null);
    setConnectErrorCode(null);
  }, [localGatewayDefaults]);

  const setToken = useCallback((value: string) => {
    tokenDirtyRef.current = true;
    setTokenState(value);
  }, []);

  const disconnect = useCallback(() => {
    setError(null);
    setConnectErrorCode(null);
    wasManualDisconnectRef.current = true;
    client.disconnect();
  }, [client]);

  const clearError = useCallback(() => {
    setError(null);
    setConnectErrorCode(null);
  }, []);

  return {
    client,
    status,
    gatewayUrl,
    token,
    localGatewayDefaults,
    domainApiModeEnabled,
    error,
    connect,
    disconnect,
    useLocalGatewayDefaults,
    setGatewayUrl,
    setToken,
    clearError,
  };
};
