"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  GatewayClient,
  GatewayResponseError,
  GatewayStatus,
} from "./GatewayClient";
import { getStudioSettingsCoordinator } from "@/lib/studio/coordinator";

const DEFAULT_GATEWAY_URL =
  process.env.NEXT_PUBLIC_GATEWAY_URL ?? "ws://127.0.0.1:18789";
const formatGatewayError = (error: unknown) => {
  if (error instanceof GatewayResponseError) {
    return `Gateway error (${error.code}): ${error.message}`;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "Unknown gateway error.";
};

export type GatewayConnectionState = {
  client: GatewayClient;
  status: GatewayStatus;
  gatewayUrl: string;
  token: string;
  error: string | null;
  connect: () => Promise<void>;
  disconnect: () => void;
  setGatewayUrl: (value: string) => void;
  setToken: (value: string) => void;
  clearError: () => void;
};

export const useGatewayConnection = (): GatewayConnectionState => {
  const [client] = useState(() => new GatewayClient());
  const [settingsCoordinator] = useState(() => getStudioSettingsCoordinator());
  const didAutoConnect = useRef(false);
  const loadedGatewaySettings = useRef<{ gatewayUrl: string; token: string } | null>(
    null
  );

  const [gatewayUrl, setGatewayUrl] = useState(DEFAULT_GATEWAY_URL);
  const [token, setToken] = useState("");
  const [status, setStatus] = useState<GatewayStatus>("disconnected");
  const [error, setError] = useState<string | null>(null);
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const loadSettings = async () => {
      try {
        const settings = await settingsCoordinator.loadSettings();
        const gateway = settings?.gateway ?? null;
        if (cancelled) return;
        const nextGatewayUrl = gateway?.url?.trim() ? gateway.url : DEFAULT_GATEWAY_URL;
        const nextToken = typeof gateway?.token === "string" ? gateway.token : "";
        loadedGatewaySettings.current = {
          gatewayUrl: nextGatewayUrl.trim(),
          token: nextToken,
        };
        setGatewayUrl(nextGatewayUrl);
        setToken(nextToken);
      } catch {
        if (!cancelled) {
          setError("Failed to load gateway settings.");
        }
      } finally {
        if (!cancelled) {
          if (!loadedGatewaySettings.current) {
            loadedGatewaySettings.current = {
              gatewayUrl: DEFAULT_GATEWAY_URL.trim(),
              token: "",
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
      }
    });
  }, [client]);

  useEffect(() => {
    return () => {
      void settingsCoordinator.flushPending();
      client.disconnect();
    };
  }, [client, settingsCoordinator]);

  const connect = useCallback(async () => {
    setError(null);
    try {
      await client.connect({ gatewayUrl, token });
    } catch (err) {
      setError(formatGatewayError(err));
    }
  }, [client, gatewayUrl, token]);

  useEffect(() => {
    if (didAutoConnect.current) return;
    if (!settingsLoaded) return;
    if (!gatewayUrl.trim()) return;
    didAutoConnect.current = true;
    void connect();
  }, [connect, gatewayUrl, settingsLoaded]);

  useEffect(() => {
    if (!settingsLoaded) return;
    const baseline = loadedGatewaySettings.current;
    if (!baseline) return;
    const nextGatewayUrl = gatewayUrl.trim();
    if (nextGatewayUrl === baseline.gatewayUrl && token === baseline.token) {
      return;
    }
    settingsCoordinator.schedulePatch(
      {
        gateway: {
          url: nextGatewayUrl,
          token,
        },
      },
      400
    );
  }, [gatewayUrl, settingsCoordinator, settingsLoaded, token]);

  const disconnect = useCallback(() => {
    setError(null);
    client.disconnect();
  }, [client]);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return {
    client,
    status,
    gatewayUrl,
    token,
    error,
    connect,
    disconnect,
    setGatewayUrl,
    setToken,
    clearError,
  };
};
