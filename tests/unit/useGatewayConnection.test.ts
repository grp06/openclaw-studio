import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

const ORIGINAL_ENV = { ...process.env };

const setupAndImportHook = async (gatewayUrl: string | null) => {
  process.env = { ...ORIGINAL_ENV };
  if (gatewayUrl === null) {
    delete process.env.NEXT_PUBLIC_GATEWAY_URL;
  } else {
    process.env.NEXT_PUBLIC_GATEWAY_URL = gatewayUrl;
  }

  vi.resetModules();

  vi.doMock("../../src/lib/gateway/GatewayClient", () => {
    class GatewayResponseError extends Error {
      code: string;

      constructor(payload: { code: string; message: string }) {
        super(payload.message);
        this.name = "GatewayResponseError";
        this.code = payload.code;
      }
    }

    class GatewayClient {
      async connect() {}
      disconnect() {}
      onStatus(handler: (status: "disconnected" | "connecting" | "connected") => void) {
        handler("disconnected");
        return () => {};
      }
    }

    return { GatewayClient, GatewayResponseError };
  });

  const mod = await import("@/lib/gateway/useGatewayConnection");
  return mod.useGatewayConnection as (settingsCoordinator: {
    loadSettings: () => Promise<unknown>;
    schedulePatch: (patch: unknown) => void;
    flushPending: () => Promise<void>;
  }) => { gatewayUrl: string };
};

describe("useGatewayConnection", () => {
  afterEach(() => {
    cleanup();
    process.env = { ...ORIGINAL_ENV };
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("defaults_to_env_url_when_set", async () => {
    const useGatewayConnection = await setupAndImportHook("ws://example.test:1234");
    const coordinator = {
      loadSettings: async () => null,
      schedulePatch: () => {},
      flushPending: async () => {},
    };

    const Probe = () =>
      createElement(
        "div",
        { "data-testid": "gatewayUrl" },
        useGatewayConnection(coordinator).gatewayUrl
      );

    render(createElement(Probe));

    await waitFor(() => {
      expect(screen.getByTestId("gatewayUrl")).toHaveTextContent("ws://example.test:1234");
    });
  });

  it("falls_back_to_local_default_when_env_unset", async () => {
    const useGatewayConnection = await setupAndImportHook(null);
    const coordinator = {
      loadSettings: async () => null,
      schedulePatch: () => {},
      flushPending: async () => {},
    };

    const Probe = () =>
      createElement(
        "div",
        { "data-testid": "gatewayUrl" },
        useGatewayConnection(coordinator).gatewayUrl
      );

    render(createElement(Probe));

    await waitFor(() => {
      expect(screen.getByTestId("gatewayUrl")).toHaveTextContent("ws://127.0.0.1:18789");
    });
  });
});
