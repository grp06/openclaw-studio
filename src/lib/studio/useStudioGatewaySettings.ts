"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { GatewayClient } from "@/lib/gateway/GatewayClient";
import type { GatewayStatus } from "@/lib/gateway/gateway-status";
import { fetchJson } from "@/lib/http";
import type {
  StudioGatewaySettings,
  StudioSettings,
  StudioSettingsPatch,
} from "@/lib/studio/settings";
import type { StudioSettingsResponse } from "@/lib/studio/coordinator";

const DEFAULT_UPSTREAM_GATEWAY_URL =
  process.env.NEXT_PUBLIC_GATEWAY_URL || "ws://localhost:18789";

const removedGatewayClient: GatewayClient = {
  call: async () => {
    throw new Error("Browser gateway transport has been removed. Use Studio domain APIs.");
  },
  onEvent: () => () => {},
  onGap: () => () => {},
};

const normalizeLocalGatewayDefaults = (value: unknown): StudioGatewaySettings | null => {
  if (!value || typeof value !== "object") return null;
  const raw = value as { url?: unknown; token?: unknown };
  const url = typeof raw.url === "string" ? raw.url.trim() : "";
  const token = typeof raw.token === "string" ? raw.token.trim() : "";
  if (!url) return null;
  return { url, token };
};

const formatGatewayError = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  return "Unknown gateway error.";
};

type RuntimeSummaryEnvelope = {
  summary?: {
    status?: unknown;
  } | null;
  error?: unknown;
};

const mapRuntimeStatusToGatewayStatus = (value: unknown): GatewayStatus => {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (normalized === "connected") return "connected";
  if (normalized === "connecting" || normalized === "reconnecting") return "connecting";
  return "disconnected";
};

type StudioSettingsCoordinatorLike = {
  loadSettings: () => Promise<StudioSettings | null>;
  loadSettingsEnvelope?: () => Promise<StudioSettingsResponse>;
  schedulePatch: (patch: StudioSettingsPatch, debounceMs?: number) => void;
  flushPending: () => Promise<void>;
};

type StudioGatewaySettingsState = {
  client: GatewayClient;
  status: GatewayStatus;
  gatewayUrl: string;
  token: string;
  localGatewayDefaults: StudioGatewaySettings | null;
  domainApiModeEnabled: boolean;
  error: string | null;
  connect: () => Promise<void>;
  disconnect: () => void;
  useLocalGatewayDefaults: () => void;
  setGatewayUrl: (value: string) => void;
  setToken: (value: string) => void;
  clearError: () => void;
};

export const useStudioGatewaySettings = (
  settingsCoordinator: StudioSettingsCoordinatorLike
): StudioGatewaySettingsState => {
  const [gatewayUrl, setGatewayUrlState] = useState(DEFAULT_UPSTREAM_GATEWAY_URL);
  const [token, setTokenState] = useState("");
  const [localGatewayDefaults, setLocalGatewayDefaults] = useState<StudioGatewaySettings | null>(
    null
  );
  const domainApiModeEnabled = true;
  const [status, setStatus] = useState<GatewayStatus>("disconnected");
  const [error, setError] = useState<string | null>(null);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const manualDisconnectRef = useRef(false);
  const didAutoConnectRef = useRef(false);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

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

        const nextUrl = gateway?.url?.trim() ? gateway.url : DEFAULT_UPSTREAM_GATEWAY_URL;
        const nextToken = typeof gateway?.token === "string" ? gateway.token : "";
        setGatewayUrlState(nextUrl);
        setTokenState(nextToken);
        setLocalGatewayDefaults(normalizeLocalGatewayDefaults(envelope.localGatewayDefaults));

      } catch (nextError) {
        if (!cancelled) {
          setError(formatGatewayError(nextError));
        }
      } finally {
        if (!cancelled) {
          setSettingsLoaded(true);
        }
      }
    };
    void loadSettings();
    return () => {
      cancelled = true;
    };
  }, [settingsCoordinator]);

  const connect = useCallback(async () => {
    const trimmedGatewayUrl = gatewayUrl.trim();
    if (!trimmedGatewayUrl) {
      setStatus("disconnected");
      setError("Gateway URL is required.");
      return;
    }
    setStatus("connecting");
    setError(null);
    manualDisconnectRef.current = false;
    try {
      await settingsCoordinator.flushPending();
      const summary = await fetchJson<RuntimeSummaryEnvelope>("/api/runtime/summary", {
        cache: "no-store",
      });
      const nextStatus = mapRuntimeStatusToGatewayStatus(summary?.summary?.status);
      setStatus(nextStatus);
      const runtimeError =
        typeof summary?.error === "string" ? summary.error.trim() : "";
      if (nextStatus === "connected" || !runtimeError) {
        setError(null);
      } else {
        setError(runtimeError);
      }
    } catch (nextError) {
      setStatus("disconnected");
      setError(formatGatewayError(nextError));
    }
  }, [gatewayUrl, settingsCoordinator]);

  const disconnect = useCallback(() => {
    manualDisconnectRef.current = true;
    setStatus("disconnected");
  }, []);

  useEffect(() => {
    if (!settingsLoaded) return;
    if (manualDisconnectRef.current) return;
    if (didAutoConnectRef.current) return;
    if (status !== "disconnected") return;
    if (!gatewayUrl.trim()) return;
    didAutoConnectRef.current = true;
    void connect();
  }, [connect, gatewayUrl, settingsLoaded, status]);

  const setGatewayUrl = useCallback(
    (value: string) => {
      setGatewayUrlState(value);
      manualDisconnectRef.current = false;
      setStatus("disconnected");
      setError(null);
      settingsCoordinator.schedulePatch({ gateway: { url: value, token } }, 350);
    },
    [settingsCoordinator, token]
  );

  const setToken = useCallback(
    (value: string) => {
      setTokenState(value);
      manualDisconnectRef.current = false;
      setStatus("disconnected");
      setError(null);
      settingsCoordinator.schedulePatch({ gateway: { url: gatewayUrl, token: value } }, 350);
    },
    [gatewayUrl, settingsCoordinator]
  );

  const useLocalGatewayDefaults = useCallback(() => {
    if (!localGatewayDefaults) return;
    manualDisconnectRef.current = false;
    setGatewayUrlState(localGatewayDefaults.url);
    setTokenState(localGatewayDefaults.token ?? "");
    setStatus("disconnected");
    setError(null);
    settingsCoordinator.schedulePatch(
      {
        gateway: { url: localGatewayDefaults.url, token: localGatewayDefaults.token ?? "" },
      },
      350
    );
  }, [localGatewayDefaults, settingsCoordinator]);

  return useMemo(
    () => ({
      client: removedGatewayClient,
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
    }),
    [
      clearError,
      connect,
      disconnect,
      domainApiModeEnabled,
      error,
      gatewayUrl,
      localGatewayDefaults,
      setGatewayUrl,
      setToken,
      status,
      token,
      useLocalGatewayDefaults,
    ]
  );
};
