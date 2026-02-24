import { useCallback, useEffect, useRef } from "react";

import {
  resolveGatewayModelsSyncIntent,
  resolveSandboxRepairIntent,
  shouldRefreshGatewayConfigForSettingsRoute,
  type GatewayConnectionStatus,
} from "@/features/agents/operations/gatewayConfigSyncWorkflow";
import { updateGatewayAgentOverrides } from "@/lib/gateway/agentConfig";
import {
  buildGatewayModelChoices,
  type GatewayModelChoice,
  type GatewayModelPolicySnapshot,
} from "@/lib/gateway/models";
import type { GatewayClient } from "@/lib/gateway/GatewayClient";

const defaultLogError = (message: string, err: unknown) => {
  console.error(message, err);
};

export type UseGatewayConfigSyncControllerParams = {
  client: GatewayClient;
  status: GatewayConnectionStatus;
  settingsRouteActive: boolean;
  inspectSidebarAgentId: string | null;
  gatewayConfigSnapshot: GatewayModelPolicySnapshot | null;
  setGatewayConfigSnapshot: (snapshot: GatewayModelPolicySnapshot | null) => void;
  setGatewayModels: (models: GatewayModelChoice[]) => void;
  setGatewayModelsError: (message: string | null) => void;
  enqueueConfigMutation: (params: {
    kind: "repair-sandbox-tool-allowlist";
    label: string;
    run: () => Promise<void>;
    requiresIdleAgents?: boolean;
  }) => Promise<void>;
  loadAgents: () => Promise<void>;
  isDisconnectLikeError: (err: unknown) => boolean;
  logError?: (message: string, err: unknown) => void;
};

export type GatewayConfigSyncController = {
  refreshGatewayConfigSnapshot: () => Promise<GatewayModelPolicySnapshot | null>;
};

export function useGatewayConfigSyncController(
  params: UseGatewayConfigSyncControllerParams
): GatewayConfigSyncController {
  const sandboxRepairAttemptedRef = useRef(false);

  const logError = params.logError ?? defaultLogError;

  const refreshGatewayConfigSnapshot = useCallback(async () => {
    if (params.status !== "connected") return null;
    try {
      const snapshot = await params.client.call<GatewayModelPolicySnapshot>("config.get", {});
      params.setGatewayConfigSnapshot(snapshot);
      return snapshot;
    } catch (err) {
      if (!params.isDisconnectLikeError(err)) {
        logError("Failed to refresh gateway config.", err);
      }
      return null;
    }
  }, [
    params.client,
    params.isDisconnectLikeError,
    params.setGatewayConfigSnapshot,
    params.status,
    logError,
  ]);

  useEffect(() => {
    const repairIntent = resolveSandboxRepairIntent({
      status: params.status,
      attempted: sandboxRepairAttemptedRef.current,
      snapshot: params.gatewayConfigSnapshot,
    });
    if (repairIntent.kind !== "repair") return;

    sandboxRepairAttemptedRef.current = true;
    void params.enqueueConfigMutation({
      kind: "repair-sandbox-tool-allowlist",
      label: "Repair sandbox tool access",
      run: async () => {
        for (const agentId of repairIntent.agentIds) {
          await updateGatewayAgentOverrides({
            client: params.client,
            agentId,
            overrides: {
              tools: {
                sandbox: {
                  tools: {
                    allow: ["*"],
                  },
                },
              },
            },
          });
        }
        await params.loadAgents();
      },
    });
  }, [
    params.client,
    params.enqueueConfigMutation,
    params.gatewayConfigSnapshot,
    params.loadAgents,
    params.status,
  ]);

  useEffect(() => {
    if (
      !shouldRefreshGatewayConfigForSettingsRoute({
        status: params.status,
        settingsRouteActive: params.settingsRouteActive,
        inspectSidebarAgentId: params.inspectSidebarAgentId,
      })
    ) {
      return;
    }
    void refreshGatewayConfigSnapshot();
  }, [
    params.inspectSidebarAgentId,
    params.settingsRouteActive,
    params.status,
    refreshGatewayConfigSnapshot,
  ]);

  useEffect(() => {
    const syncIntent = resolveGatewayModelsSyncIntent({ status: params.status });
    if (syncIntent.kind === "clear") {
      params.setGatewayModels([]);
      params.setGatewayModelsError(null);
      params.setGatewayConfigSnapshot(null);
      return;
    }

    let cancelled = false;
    const loadModels = async () => {
      let configSnapshot: GatewayModelPolicySnapshot | null = null;
      try {
        configSnapshot = await params.client.call<GatewayModelPolicySnapshot>("config.get", {});
        if (!cancelled) {
          params.setGatewayConfigSnapshot(configSnapshot);
        }
      } catch (err) {
        if (!params.isDisconnectLikeError(err)) {
          logError("Failed to load gateway config.", err);
        }
      }

      try {
        const result = await params.client.call<{ models: GatewayModelChoice[] }>(
          "models.list",
          {}
        );
        if (cancelled) return;
        const catalog = Array.isArray(result.models) ? result.models : [];
        params.setGatewayModels(buildGatewayModelChoices(catalog, configSnapshot));
        params.setGatewayModelsError(null);
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : "Failed to load models.";
        params.setGatewayModelsError(message);
        params.setGatewayModels([]);
        if (!params.isDisconnectLikeError(err)) {
          logError("Failed to load gateway models.", err);
        }
      }
    };

    void loadModels();
    return () => {
      cancelled = true;
    };
  }, [
    params.client,
    params.isDisconnectLikeError,
    params.setGatewayConfigSnapshot,
    params.setGatewayModels,
    params.setGatewayModelsError,
    params.status,
    logError,
  ]);

  return {
    refreshGatewayConfigSnapshot,
  };
}
