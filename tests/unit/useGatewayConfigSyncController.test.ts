import { createElement, useEffect, useState } from "react";
import { act, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useGatewayConfigSyncController } from "@/features/agents/operations/useGatewayConfigSyncController";
import type { GatewayModelChoice, GatewayModelPolicySnapshot } from "@/lib/gateway/models";
import { updateGatewayAgentOverrides } from "@/lib/gateway/agentConfig";
import type { GatewayClient } from "@/lib/gateway/GatewayClient";

vi.mock("@/lib/gateway/agentConfig", async () => {
  const actual = await vi.importActual<typeof import("@/lib/gateway/agentConfig")>(
    "@/lib/gateway/agentConfig"
  );
  return {
    ...actual,
    updateGatewayAgentOverrides: vi.fn(async () => undefined),
  };
});

type ProbeValue = {
  gatewayConfigSnapshot: GatewayModelPolicySnapshot | null;
  gatewayModels: GatewayModelChoice[];
  gatewayModelsError: string | null;
  refreshGatewayConfigSnapshot: () => Promise<GatewayModelPolicySnapshot | null>;
};

type RenderControllerContext = {
  getValue: () => ProbeValue;
  rerenderWith: (
    overrides: Partial<{
      status: "disconnected" | "connecting" | "connected";
      settingsRouteActive: boolean;
      inspectSidebarAgentId: string | null;
      logError: (message: string, err: unknown) => void;
    }>
  ) => void;
  call: ReturnType<typeof vi.fn>;
  enqueueConfigMutation: ReturnType<typeof vi.fn>;
  loadAgents: ReturnType<typeof vi.fn>;
  logError: (message: string, err: unknown) => void;
};

const countMethodCalls = (callMock: ReturnType<typeof vi.fn>, method: string) => {
  return callMock.mock.calls.filter(([calledMethod]) => calledMethod === method).length;
};

type RenderControllerParams = {
  status: "disconnected" | "connecting" | "connected";
  settingsRouteActive: boolean;
  inspectSidebarAgentId: string | null;
  initialGatewayConfigSnapshot?: GatewayModelPolicySnapshot | null;
  isDisconnectLikeError: (err: unknown) => boolean;
  logError: (message: string, err: unknown) => void;
};

const renderController = (
  overrides?: Partial<
    RenderControllerParams & {
      call: ReturnType<typeof vi.fn>;
      enqueueConfigMutation: ReturnType<typeof vi.fn>;
      loadAgents: ReturnType<typeof vi.fn>;
    }
  >
): RenderControllerContext => {
  const call =
    overrides?.call ??
    vi.fn(async (method: string) => {
      if (method === "config.get") {
        return { config: {} };
      }
      if (method === "models.list") {
        return { models: [] };
      }
      throw new Error(`Unhandled method: ${method}`);
    });
  const enqueueConfigMutation =
    overrides?.enqueueConfigMutation ??
    vi.fn(async ({ run }: { run: () => Promise<void> }) => {
      await run();
    });
  const loadAgents = overrides?.loadAgents ?? vi.fn(async () => undefined);
  const logError = (overrides?.logError ?? vi.fn()) as (message: string, err: unknown) => void;

  let currentParams: RenderControllerParams = {
    status: "connected" as const,
    settingsRouteActive: false,
    inspectSidebarAgentId: null as string | null,
    isDisconnectLikeError: overrides?.isDisconnectLikeError ?? (() => false),
    logError,
    ...overrides,
  };

  const valueRef: { current: ProbeValue | null } = { current: null };

  const Probe = ({
    params,
    onValue,
  }: {
    params: typeof currentParams;
    onValue: (value: ProbeValue) => void;
  }) => {
    const [client] = useState(() => ({ call }));
    const [gatewayConfigSnapshot, setGatewayConfigSnapshot] = useState<GatewayModelPolicySnapshot | null>(
      params.initialGatewayConfigSnapshot ?? null
    );
    const [gatewayModels, setGatewayModels] = useState<GatewayModelChoice[]>([]);
    const [gatewayModelsError, setGatewayModelsError] = useState<string | null>(null);

    const { refreshGatewayConfigSnapshot } = useGatewayConfigSyncController({
      client: client as unknown as GatewayClient,
      status: params.status,
      settingsRouteActive: params.settingsRouteActive,
      inspectSidebarAgentId: params.inspectSidebarAgentId,
      gatewayConfigSnapshot,
      setGatewayConfigSnapshot,
      setGatewayModels,
      setGatewayModelsError,
      enqueueConfigMutation: enqueueConfigMutation as (params: {
        kind: "repair-sandbox-tool-allowlist";
        label: string;
        run: () => Promise<void>;
      }) => Promise<void>,
      loadAgents: loadAgents as () => Promise<void>,
      isDisconnectLikeError: params.isDisconnectLikeError,
      logError: params.logError,
    });

    useEffect(() => {
      onValue({
        gatewayConfigSnapshot,
        gatewayModels,
        gatewayModelsError,
        refreshGatewayConfigSnapshot,
      });
    }, [gatewayConfigSnapshot, gatewayModels, gatewayModelsError, onValue, refreshGatewayConfigSnapshot]);

    return createElement("div", { "data-testid": "probe" }, "ok");
  };

  const rendered = render(
    createElement(Probe, {
      params: currentParams,
      onValue: (value) => {
        valueRef.current = value;
      },
    })
  );

  return {
    getValue: () => {
      if (!valueRef.current) throw new Error("controller value unavailable");
      return valueRef.current;
    },
    rerenderWith: (nextOverrides) => {
      currentParams = {
        ...currentParams,
        ...nextOverrides,
      };
      rendered.rerender(
        createElement(Probe, {
          params: currentParams,
          onValue: (value) => {
            valueRef.current = value;
          },
        })
      );
    },
    call,
    enqueueConfigMutation,
    loadAgents,
    logError,
  };
};

describe("useGatewayConfigSyncController", () => {
  const mockedUpdateGatewayAgentOverrides = vi.mocked(updateGatewayAgentOverrides);

  beforeEach(() => {
    mockedUpdateGatewayAgentOverrides.mockReset();
    mockedUpdateGatewayAgentOverrides.mockResolvedValue();
  });

  it("clears models, model error, and snapshot when disconnected", async () => {
    const call = vi.fn(async (method: string) => {
      if (method === "config.get") {
        return { config: { agents: { list: [] } } };
      }
      if (method === "models.list") {
        return { models: [{ provider: "openai", id: "gpt-4o", name: "GPT-4o" }] };
      }
      throw new Error(`Unhandled method: ${method}`);
    });

    const ctx = renderController({ call, status: "connected" });

    await waitFor(() => {
      expect(ctx.getValue().gatewayModels).toEqual([
        { provider: "openai", id: "gpt-4o", name: "GPT-4o" },
      ]);
    });

    ctx.rerenderWith({ status: "disconnected" });

    await waitFor(() => {
      expect(ctx.getValue().gatewayModels).toEqual([]);
      expect(ctx.getValue().gatewayModelsError).toBeNull();
      expect(ctx.getValue().gatewayConfigSnapshot).toBeNull();
    });
  });

  it("still loads models when config.get fails", async () => {
    const call = vi.fn(async (method: string) => {
      if (method === "config.get") {
        throw new Error("config failed");
      }
      if (method === "models.list") {
        return {
          models: [{ provider: "openai", id: "gpt-4o", name: "GPT-4o" }],
        };
      }
      throw new Error(`Unhandled method: ${method}`);
    });
    const logError = vi.fn();
    const ctx = renderController({ call, logError });

    await waitFor(() => {
      expect(ctx.getValue().gatewayModels).toEqual([
        { provider: "openai", id: "gpt-4o", name: "GPT-4o" },
      ]);
    });

    expect(countMethodCalls(call, "models.list")).toBe(1);
    expect(logError).toHaveBeenCalledWith("Failed to load gateway config.", expect.any(Error));
  });

  it("captures model loading errors and clears models", async () => {
    const call = vi.fn(async (method: string) => {
      if (method === "config.get") {
        return { config: { agents: { list: [] } } };
      }
      if (method === "models.list") {
        throw new Error("models unavailable");
      }
      throw new Error(`Unhandled method: ${method}`);
    });
    const logError = vi.fn();
    const ctx = renderController({ call, logError });

    await waitFor(() => {
      expect(ctx.getValue().gatewayModels).toEqual([]);
      expect(ctx.getValue().gatewayModelsError).toBe("models unavailable");
    });

    expect(logError).toHaveBeenCalledWith("Failed to load gateway models.", expect.any(Error));
  });

  it("runs settings-route refresh only when inspect agent id is present", async () => {
    const call = vi.fn(async (method: string) => {
      if (method === "config.get") {
        return { config: { agents: { list: [] } } };
      }
      if (method === "models.list") {
        return { models: [] };
      }
      throw new Error(`Unhandled method: ${method}`);
    });

    renderController({
      call,
      status: "connected",
      settingsRouteActive: true,
      inspectSidebarAgentId: null,
    });

    await waitFor(() => {
      expect(countMethodCalls(call, "config.get")).toBe(1);
      expect(countMethodCalls(call, "models.list")).toBe(1);
    });

    const callEligible = vi.fn(async (method: string) => {
      if (method === "config.get") {
        return { config: { agents: { list: [] } } };
      }
      if (method === "models.list") {
        return { models: [] };
      }
      throw new Error(`Unhandled method: ${method}`);
    });

    renderController({
      call: callEligible,
      status: "connected",
      settingsRouteActive: true,
      inspectSidebarAgentId: "agent-1",
    });

    await waitFor(() => {
      expect(countMethodCalls(callEligible, "config.get")).toBeGreaterThanOrEqual(2);
      expect(countMethodCalls(callEligible, "models.list")).toBe(1);
    });
  });

  it("enqueues sandbox repair once for eligible agents", async () => {
    const brokenSnapshot = {
      config: {
        agents: {
          list: [
            {
              id: "agent-broken",
              sandbox: { mode: "all" },
              tools: {
                sandbox: {
                  tools: {
                    allow: [],
                  },
                },
              },
            },
          ],
        },
      },
    } as unknown as GatewayModelPolicySnapshot;

    const call = vi.fn(async (method: string) => {
      if (method === "config.get") {
        return brokenSnapshot;
      }
      if (method === "models.list") {
        return { models: [] };
      }
      throw new Error(`Unhandled method: ${method}`);
    });

    const enqueueConfigMutation = vi.fn(async ({ run }: { run: () => Promise<void> }) => {
      await run();
    });
    const loadAgents = vi.fn(async () => undefined);

    const ctx = renderController({
      call,
      enqueueConfigMutation,
      loadAgents,
      initialGatewayConfigSnapshot: brokenSnapshot,
    });

    await waitFor(() => {
      expect(enqueueConfigMutation).toHaveBeenCalledTimes(1);
      expect(mockedUpdateGatewayAgentOverrides).toHaveBeenCalledTimes(1);
      expect(loadAgents).toHaveBeenCalledTimes(1);
    });

    ctx.rerenderWith({ status: "connected" });
    await act(async () => {
      await Promise.resolve();
    });

    expect(enqueueConfigMutation).toHaveBeenCalledTimes(1);
    expect(mockedUpdateGatewayAgentOverrides).toHaveBeenCalledTimes(1);
  });

  it("returns null when refresh is called while disconnected", async () => {
    const call = vi.fn(async () => {
      throw new Error("should not call gateway when disconnected");
    });
    const ctx = renderController({ call, status: "disconnected" });

    const result = await ctx.getValue().refreshGatewayConfigSnapshot();

    expect(result).toBeNull();
    expect(call).not.toHaveBeenCalled();
  });
});
