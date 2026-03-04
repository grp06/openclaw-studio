// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const mockedExecuteRuntimeGatewayRead = vi.fn();

vi.mock("@/lib/controlplane/runtime-read-route", () => ({
  executeRuntimeGatewayRead: (...args: unknown[]) =>
    mockedExecuteRuntimeGatewayRead(...args),
}));

describe("/api/runtime/chat-history route", () => {
  beforeEach(() => {
    vi.resetModules();
    mockedExecuteRuntimeGatewayRead.mockReset();
    mockedExecuteRuntimeGatewayRead.mockResolvedValue(
      new Response(JSON.stringify({ ok: true, payload: { messages: [] } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
  });

  it("returns 400 when sessionKey is missing", async () => {
    const route = await import("@/app/api/runtime/chat-history/route");
    const response = await route.GET(
      new Request("http://localhost/api/runtime/chat-history")
    );

    expect(response.status).toBe(400);
    expect(mockedExecuteRuntimeGatewayRead).not.toHaveBeenCalled();
  });

  it("forwards gateway reads with a capped limit", async () => {
    const route = await import("@/app/api/runtime/chat-history/route");
    const response = await route.GET(
      new Request(
        "http://localhost/api/runtime/chat-history?sessionKey=agent%3Amain%3Amain&limit=5000"
      )
    );

    expect(response.status).toBe(200);
    expect(mockedExecuteRuntimeGatewayRead).toHaveBeenCalledWith("chat.history", {
      sessionKey: "agent:main:main",
      limit: 1000,
    });
  });
});
