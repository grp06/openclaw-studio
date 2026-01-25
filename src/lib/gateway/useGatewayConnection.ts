"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  GatewayClient,
  GatewayResponseError,
  GatewayStatus,
} from "./GatewayClient";

const DEFAULT_GATEWAY_URL = "ws://127.0.0.1:18789";
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
  const didAutoConnect = useRef(false);

  const [gatewayUrl, setGatewayUrl] = useState(DEFAULT_GATEWAY_URL);
  const [token, setToken] = useState("");
  const [status, setStatus] = useState<GatewayStatus>("disconnected");
  const [error, setError] = useState<string | null>(null);
  const [configLoaded, setConfigLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const loadConfig = async () => {
      try {
        const res = await fetch("/api/gateway", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { gatewayUrl?: string; token?: string };
        if (cancelled) return;
        if (typeof data.gatewayUrl === "string" && data.gatewayUrl.trim()) {
          setGatewayUrl(data.gatewayUrl);
        }
        if (typeof data.token === "string") {
          setToken(data.token);
        }
      } catch {
        if (!cancelled) {
          setError("Failed to load gateway config.");
        }
      } finally {
        if (!cancelled) {
          setConfigLoaded(true);
        }
      }
    };
    void loadConfig();
    return () => {
      cancelled = true;
    };
  }, []);

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
      client.disconnect();
    };
  }, [client]);

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
    if (!configLoaded) return;
    if (!gatewayUrl.trim()) return;
    didAutoConnect.current = true;
    void connect();
  }, [connect, configLoaded, gatewayUrl]);

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
