import { describe, expect, it } from "vitest";

import {
  resolveGatewayConfigRecord,
  resolveGatewayModelsSyncIntent,
  resolveSandboxRepairAgentIds,
  resolveSandboxRepairIntent,
  shouldRefreshGatewayConfigForSettingsRoute,
} from "@/features/agents/operations/gatewayConfigSyncWorkflow";
import type { GatewayModelPolicySnapshot } from "@/lib/gateway/models";

describe("gatewayConfigSyncWorkflow", () => {
  it("resolves config record only when snapshot config is an object", () => {
    expect(resolveGatewayConfigRecord(null)).toBeNull();
    expect(resolveGatewayConfigRecord({ config: [] } as unknown as GatewayModelPolicySnapshot)).toBeNull();

    const snapshot: GatewayModelPolicySnapshot = {
      config: {
        agents: {
          list: [{ id: "agent-1" }],
        },
      },
    };

    expect(resolveGatewayConfigRecord(snapshot)).toEqual(snapshot.config);
  });

  it("finds sandbox repair candidates with sandbox all mode and empty sandbox allowlist", () => {
    const snapshot = {
      config: {
        agents: {
          list: [
            {
              id: "agent-broken",
              sandbox: { mode: "all" },
              tools: { sandbox: { tools: { allow: [] } } },
            },
            {
              id: "agent-ok-mode",
              sandbox: { mode: "off" },
              tools: { sandbox: { tools: { allow: [] } } },
            },
            {
              id: "agent-ok-allow",
              sandbox: { mode: "all" },
              tools: { sandbox: { tools: { allow: ["*"] } } },
            },
          ],
        },
      },
    } as unknown as GatewayModelPolicySnapshot;

    expect(resolveSandboxRepairAgentIds(snapshot)).toEqual(["agent-broken"]);
  });

  it("builds sandbox repair intent from status, attempt guard, and candidate list", () => {
    const snapshot = {
      config: {
        agents: {
          list: [
            {
              id: "agent-broken",
              sandbox: { mode: "all" },
              tools: { sandbox: { tools: { allow: [] } } },
            },
          ],
        },
      },
    } as unknown as GatewayModelPolicySnapshot;

    expect(
      resolveSandboxRepairIntent({
        status: "disconnected",
        attempted: false,
        snapshot,
      })
    ).toEqual({ kind: "skip", reason: "not-connected" });

    expect(
      resolveSandboxRepairIntent({
        status: "connected",
        attempted: true,
        snapshot,
      })
    ).toEqual({ kind: "skip", reason: "already-attempted" });

    expect(
      resolveSandboxRepairIntent({
        status: "connected",
        attempted: false,
        snapshot,
      })
    ).toEqual({ kind: "repair", agentIds: ["agent-broken"] });
  });

  it("gates settings-route refresh on route flag, inspect agent id, and connected status", () => {
    expect(
      shouldRefreshGatewayConfigForSettingsRoute({
        status: "connected",
        settingsRouteActive: false,
        inspectSidebarAgentId: "agent-1",
      })
    ).toBe(false);

    expect(
      shouldRefreshGatewayConfigForSettingsRoute({
        status: "connected",
        settingsRouteActive: true,
        inspectSidebarAgentId: null,
      })
    ).toBe(false);

    expect(
      shouldRefreshGatewayConfigForSettingsRoute({
        status: "connecting",
        settingsRouteActive: true,
        inspectSidebarAgentId: "agent-1",
      })
    ).toBe(false);

    expect(
      shouldRefreshGatewayConfigForSettingsRoute({
        status: "connected",
        settingsRouteActive: true,
        inspectSidebarAgentId: "agent-1",
      })
    ).toBe(true);
  });

  it("returns model sync load intent only when connected", () => {
    expect(resolveGatewayModelsSyncIntent({ status: "connected" })).toEqual({ kind: "load" });
    expect(resolveGatewayModelsSyncIntent({ status: "connecting" })).toEqual({ kind: "clear" });
    expect(resolveGatewayModelsSyncIntent({ status: "disconnected" })).toEqual({ kind: "clear" });
  });
});
