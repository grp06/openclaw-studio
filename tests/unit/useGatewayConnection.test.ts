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
  vi.spyOn(console, "info").mockImplementation(() => {});

  const captured: { url: string | null; token: unknown; authScopeKey: unknown } = {
    url: null,
    token: null,
    authScopeKey: null,
  };

  vi.doMock("../../src/lib/gateway/openclaw/GatewayBrowserClient", () => {
    class GatewayBrowserClient {
      connected = false;
      private opts: {
        onHello?: (hello: unknown) => void;
        onEvent?: (event: unknown) => void;
        onClose?: (info: { code: number; reason: string }) => void;
        onGap?: (info: { expected: number; received: number }) => void;
      };

      constructor(opts: Record<string, unknown>) {
        captured.url = typeof opts.url === "string" ? opts.url : null;
        captured.token = "token" in opts ? opts.token : null;
        captured.authScopeKey = "authScopeKey" in opts ? opts.authScopeKey : null;
        this.opts = {
          onHello: typeof opts.onHello === "function" ? (opts.onHello as (hello: unknown) => void) : undefined,
          onEvent: typeof opts.onEvent === "function" ? (opts.onEvent as (event: unknown) => void) : undefined,
          onClose: typeof opts.onClose === "function" ? (opts.onClose as (info: { code: number; reason: string }) => void) : undefined,
          onGap: typeof opts.onGap === "function" ? (opts.onGap as (info: { expected: number; received: number }) => void) : undefined,
        };
      }

      start() {
        this.connected = true;
        this.opts.onHello?.({ type: "hello-ok", protocol: 1 });
      }

      stop() {
        this.connected = false;
        this.opts.onClose?.({ code: 1000, reason: "stopped" });
      }

      async request<T = unknown>(method: string, params: unknown): Promise<T> {
        void method;
        void params;
        return {} as T;
      }
    }

    return { GatewayBrowserClient };
  });

  const mod = await import("@/lib/gateway/GatewayClient");
  return {
    useGatewayConnection: mod.useGatewayConnection as (settingsCoordinator: {
    loadSettings: () => Promise<unknown>;
    schedulePatch: (patch: unknown) => void;
    flushPending: () => Promise<void>;
  }) => { gatewayUrl: string },
    captured,
  };
};

describe("useGatewayConnection", () => {
  afterEach(() => {
    cleanup();
    process.env = { ...ORIGINAL_ENV };
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("defaults_to_env_url_when_set", async () => {
    const { useGatewayConnection } = await setupAndImportHook("ws://example.test:1234");
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
    const { useGatewayConnection } = await setupAndImportHook(null);
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
      expect(screen.getByTestId("gatewayUrl")).toHaveTextContent("ws://localhost:18789");
    });
  });

  it("connects_via_studio_proxy_ws_and_does_not_pass_token", async () => {
    const { useGatewayConnection, captured } = await setupAndImportHook(null);
    const coordinator = {
      loadSettings: async () => null,
      schedulePatch: () => {},
      flushPending: async () => {},
    };

    const Probe = () => {
      useGatewayConnection(coordinator);
      return createElement("div", null, "ok");
    };

    render(createElement(Probe));

    await waitFor(() => {
      expect(captured.url).toBe("ws://localhost:3000/api/gateway/ws");
    });
    expect(captured.token).toBe("");
    expect(captured.authScopeKey).toBe("ws://localhost:18789");
  });
});
