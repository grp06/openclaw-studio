// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

describe("studio test-connection route", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("returns 400 when the gateway URL is missing", async () => {
    const { POST } = await import("@/app/api/studio/test-connection/route");
    const response = await POST(
      new Request("http://localhost/api/studio/test-connection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gateway: { token: "secret" } }),
      })
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { ok?: boolean; error?: string };
    expect(body.ok).toBe(false);
    expect(body.error).toBe("Gateway URL is required.");
  });

  it("returns structured start failure metadata when adapter startup fails", async () => {
    vi.doMock("@/lib/controlplane/openclaw-adapter", async () => {
      const actual = await vi.importActual<typeof import("@/lib/controlplane/openclaw-adapter")>(
        "@/lib/controlplane/openclaw-adapter"
      );
      return {
        ...actual,
        OpenClawGatewayAdapter: class {
          async start() {
            throw new actual.ControlPlaneGatewayConnectError({
              code: "INVALID_REQUEST",
              message:
                "Control-plane connect rejected: INVALID_REQUEST control ui requires device identity (use HTTPS or localhost secure context)",
              profileId: "legacy-control-ui",
              details: { code: "CONTROL_UI_DEVICE_IDENTITY_REQUIRED" },
              rejectedByGateway: true,
            });
          }

          async stop() {}
        },
      };
    });
    vi.doMock("@/lib/studio/settings-store", () => ({
      loadStudioSettings: () => ({
        version: 1,
        gateway: { url: "ws://localhost:18789", token: "stored-secret" },
        gatewayAutoStart: true,
        focused: {},
        avatars: {},
      }),
    }));

    const { POST } = await import("@/app/api/studio/test-connection/route");
    const response = await POST(
      new Request("http://localhost/api/studio/test-connection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gateway: { url: "ws://localhost:18789" },
          useStoredToken: true,
        }),
      })
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      ok?: boolean;
      error?: string;
      startFailure?: {
        code?: string;
        message?: string;
        profileId?: string;
        details?: unknown;
      };
    };
    expect(body.ok).toBe(false);
    expect(body.error).toContain("control ui requires device identity");
    expect(body.startFailure).toEqual({
      code: "INVALID_REQUEST",
      message:
        "Control-plane connect rejected: INVALID_REQUEST control ui requires device identity (use HTTPS or localhost secure context)",
      profileId: "legacy-control-ui",
      details: { code: "CONTROL_UI_DEVICE_IDENTITY_REQUIRED" },
    });
  });
});
