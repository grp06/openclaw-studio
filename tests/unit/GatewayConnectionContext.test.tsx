import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";

// Mock the dependencies before importing the module under test
vi.mock("@/lib/gateway/GatewayClient", () => {
  const mockClient = {
    connect: vi.fn(),
    disconnect: vi.fn(),
    call: vi.fn(),
    onEvent: vi.fn(() => () => {}),
    onStatus: vi.fn(() => () => {}),
    onGap: vi.fn(() => () => {}),
  };
  return {
    GatewayClient: vi.fn(() => mockClient),
    useGatewayConnection: vi.fn(() => ({
      client: mockClient,
      status: "disconnected" as const,
      gatewayUrl: "ws://localhost:9999",
      token: "test-token",
      error: null,
      connect: vi.fn(),
      disconnect: vi.fn(),
      setGatewayUrl: vi.fn(),
      setToken: vi.fn(),
      clearError: vi.fn(),
    })),
    parseAgentIdFromSessionKey: vi.fn(),
    isGatewayDisconnectLikeError: vi.fn(() => false),
  };
});

vi.mock("@/lib/studio/coordinator", () => ({
  createStudioSettingsCoordinator: vi.fn(() => ({
    loadSettings: vi.fn(async () => null),
    schedulePatch: vi.fn(),
    flushPending: vi.fn(async () => {}),
  })),
  StudioSettingsCoordinator: vi.fn(),
}));

import {
  GatewayConnectionProvider,
  useGatewayConnectionContext,
} from "@/lib/gateway/GatewayConnectionContext";

afterEach(cleanup);

describe("GatewayConnectionContext", () => {
  it("provides client and status via context", () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <GatewayConnectionProvider>{children}</GatewayConnectionProvider>
    );

    const { result } = renderHook(() => useGatewayConnectionContext(), { wrapper });

    expect(result.current.client).toBeDefined();
    expect(result.current.status).toBe("disconnected");
    expect(result.current.gatewayUrl).toBe("ws://localhost:9999");
    expect(result.current.token).toBe("test-token");
    expect(result.current.settingsCoordinator).toBeDefined();
  });

  it("provides connect and disconnect functions", () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <GatewayConnectionProvider>{children}</GatewayConnectionProvider>
    );

    const { result } = renderHook(() => useGatewayConnectionContext(), { wrapper });

    expect(typeof result.current.connect).toBe("function");
    expect(typeof result.current.disconnect).toBe("function");
    expect(typeof result.current.setGatewayUrl).toBe("function");
    expect(typeof result.current.setToken).toBe("function");
  });

  it("throws when used outside provider", () => {
    // Suppress console.error for the expected error
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() => {
      renderHook(() => useGatewayConnectionContext());
    }).toThrow("useGatewayConnectionContext must be used within a GatewayConnectionProvider");

    spy.mockRestore();
  });

  it("exposes settingsCoordinator with expected methods", () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <GatewayConnectionProvider>{children}</GatewayConnectionProvider>
    );

    const { result } = renderHook(() => useGatewayConnectionContext(), { wrapper });

    const coord = result.current.settingsCoordinator;
    expect(typeof coord.loadSettings).toBe("function");
    expect(typeof coord.schedulePatch).toBe("function");
    expect(typeof coord.flushPending).toBe("function");
  });
});
