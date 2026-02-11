// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocket, WebSocketServer } from "ws";

const waitForEvent = <T = unknown>(
  target: { once: (event: string, cb: (...args: unknown[]) => void) => void },
  event: string
) =>
  new Promise<T>((resolve) => {
    target.once(event, (...args: unknown[]) => resolve(args as unknown as T));
  });

describe("createGatewayProxy", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("injects gateway token into connect request", async () => {
    const upstream = new WebSocketServer({ port: 0 });
    const address = upstream.address();
    if (!address || typeof address === "string") {
      throw new Error("expected upstream server to have a port");
    }
    const upstreamUrl = `ws://127.0.0.1:${address.port}`;

    let seenToken: string | null = null;
    let seenOrigin: string | undefined;
    upstream.on("connection", (ws, req) => {
      seenOrigin = req.headers.origin;
      ws.on("message", (raw) => {
        const parsed = JSON.parse(String(raw));
        if (parsed?.method === "connect") {
          seenToken = parsed?.params?.auth?.token ?? null;
          ws.send(
            JSON.stringify({
              type: "res",
              id: parsed.id,
              ok: true,
              payload: { type: "hello-ok", protocol: 3, auth: {} },
            })
          );
        }
      });
    });

    const { createGatewayProxy } = await import("../../server/gateway-proxy");

    const proxyHttp = await import("node:http").then((m) => m.createServer());
    const proxy = createGatewayProxy({
      loadUpstreamSettings: async () => ({ url: upstreamUrl, token: "token-123" }),
      allowWs: (req: { url?: string }) => req.url === "/api/gateway/ws",
      logError: () => {},
    });
    proxyHttp.on("upgrade", (req, socket, head) => proxy.handleUpgrade(req, socket, head));

    await new Promise<void>((resolve) => proxyHttp.listen(0, "127.0.0.1", resolve));
    const proxyAddr = proxyHttp.address();
    if (!proxyAddr || typeof proxyAddr === "string") {
      throw new Error("expected proxy server to have a port");
    }

    const browser = new WebSocket(`ws://127.0.0.1:${proxyAddr.port}/api/gateway/ws`);
    await waitForEvent(browser, "open");

    browser.send(
      JSON.stringify({
        type: "req",
        id: "connect-1",
        method: "connect",
        params: { auth: {} },
      })
    );

    await waitForEvent(browser, "message");

    expect(seenToken).toBe("token-123");
    expect(seenOrigin).toBe(`http://localhost:${address.port}`);

    browser.close();
    upstream.close();
    await new Promise<void>((resolve) => proxyHttp.close(() => resolve()));
  });
});
