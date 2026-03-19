// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

import { ControlPlaneGatewayConnectError } from "@/lib/controlplane/openclaw-adapter";

describe("runtime route bootstrap", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("returns mode-disabled when domain mode is off", async () => {
    vi.doMock("@/lib/controlplane/runtime", () => ({
      isStudioDomainApiModeEnabled: () => false,
      getControlPlaneRuntime: vi.fn(),
    }));

    const { bootstrapDomainRuntime } = await import("@/lib/controlplane/runtime-route-bootstrap");
    const result = await bootstrapDomainRuntime();
    expect(result).toEqual({ kind: "mode-disabled" });
  });

  it("returns runtime-init-failed when runtime creation throws", async () => {
    vi.doMock("@/lib/controlplane/runtime", () => ({
      isStudioDomainApiModeEnabled: () => true,
      getControlPlaneRuntime: () => {
        throw new Error("runtime init failed");
      },
    }));

    const { bootstrapDomainRuntime } = await import("@/lib/controlplane/runtime-route-bootstrap");
    const result = await bootstrapDomainRuntime();
    expect(result).toEqual({
      kind: "runtime-init-failed",
      failure: {
        code: "CONTROLPLANE_RUNTIME_INIT_FAILED",
        reason: "runtime_init_failed",
        message: "runtime init failed",
      },
    });
  });

  it("classifies better-sqlite3 ABI mismatch as native module mismatch", async () => {
    vi.doMock("@/lib/controlplane/runtime", () => ({
      isStudioDomainApiModeEnabled: () => true,
      getControlPlaneRuntime: () => {
        const error = new Error(
          "The module '/tmp/better_sqlite3.node' was compiled against a different Node.js version using NODE_MODULE_VERSION 141."
        ) as Error & { code: string };
        error.code = "ERR_DLOPEN_FAILED";
        throw error;
      },
    }));

    const { bootstrapDomainRuntime } = await import("@/lib/controlplane/runtime-route-bootstrap");
    const result = await bootstrapDomainRuntime();
    expect(result.kind).toBe("runtime-init-failed");
    if (result.kind !== "runtime-init-failed") {
      throw new Error("expected runtime-init-failed result");
    }
    expect(result.failure.code).toBe("NATIVE_MODULE_MISMATCH");
    expect(result.failure.reason).toBe("native_module_mismatch");
    expect(result.failure.remediation?.commands).toEqual([
      "npm rebuild better-sqlite3",
      "npm install",
    ]);
  });

  it("returns start-failed when startup fails", async () => {
    const runtime = {
      ensureStarted: async () => {
        throw new Error("start failed");
      },
    };
    vi.doMock("@/lib/controlplane/runtime", () => ({
      isStudioDomainApiModeEnabled: () => true,
      getControlPlaneRuntime: () => runtime,
    }));

    const { bootstrapDomainRuntime } = await import("@/lib/controlplane/runtime-route-bootstrap");
    const result = await bootstrapDomainRuntime();
    expect(result.kind).toBe("start-failed");
    if (result.kind !== "start-failed") {
      throw new Error("expected start-failed result");
    }
    expect(result.message).toBe("start failed");
    expect(result.startFailure).toBeNull();
    expect(result.runtime).toBe(runtime);
  });

  it("returns structured start failure when startup fails with connect metadata", async () => {
    const runtime = {
      ensureStarted: async () => {
        throw new ControlPlaneGatewayConnectError({
          code: "INVALID_REQUEST",
          message:
            "Control-plane connect rejected: INVALID_REQUEST control ui requires device identity (use HTTPS or localhost secure context)",
          profileId: "legacy-control-ui",
          details: { code: "CONTROL_UI_DEVICE_IDENTITY_REQUIRED" },
          rejectedByGateway: true,
        });
      },
    };
    vi.doMock("@/lib/controlplane/runtime", () => ({
      isStudioDomainApiModeEnabled: () => true,
      getControlPlaneRuntime: () => runtime,
    }));

    const { bootstrapDomainRuntime } = await import("@/lib/controlplane/runtime-route-bootstrap");
    const result = await bootstrapDomainRuntime();
    expect(result.kind).toBe("start-failed");
    if (result.kind !== "start-failed") {
      throw new Error("expected start-failed result");
    }
    expect(result.message).toContain("control ui requires device identity");
    expect(result.startFailure).toEqual({
      code: "INVALID_REQUEST",
      message:
        "Control-plane connect rejected: INVALID_REQUEST control ui requires device identity (use HTTPS or localhost secure context)",
      profileId: "legacy-control-ui",
      details: { code: "CONTROL_UI_DEVICE_IDENTITY_REQUIRED" },
    });
  });

  it("returns ready when runtime startup succeeds", async () => {
    const runtime = {
      ensureStarted: async () => {},
    };
    vi.doMock("@/lib/controlplane/runtime", () => ({
      isStudioDomainApiModeEnabled: () => true,
      getControlPlaneRuntime: () => runtime,
    }));

    const { bootstrapDomainRuntime } = await import("@/lib/controlplane/runtime-route-bootstrap");
    const result = await bootstrapDomainRuntime();
    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") {
      throw new Error("expected ready result");
    }
    expect(result.runtime).toBe(runtime);
  });
});
