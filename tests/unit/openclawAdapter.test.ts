// @vitest-environment node

import { afterEach, describe, expect, it } from "vitest";
import { EventEmitter } from "node:events";
import { WebSocket, WebSocketServer } from "ws";

import { OpenClawGatewayAdapter } from "@/lib/controlplane/openclaw-adapter";
import type { ControlPlaneDomainEvent } from "@/lib/controlplane/contracts";

const closeWebSocketServer = (server: WebSocketServer) =>
  new Promise<void>((resolve) => server.close(() => resolve()));

const waitForCondition = async (predicate: () => boolean, timeoutMs: number = 3_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Condition not met before timeout.");
};

describe("OpenClawGatewayAdapter", () => {
  let upstream: WebSocketServer | null = null;

  afterEach(async () => {
    if (upstream) {
      await closeWebSocketServer(upstream);
      upstream = null;
    }
  });

  it("rejects in-flight requests immediately when the socket closes", async () => {
    upstream = new WebSocketServer({ port: 0 });
    const address = upstream.address();
    if (!address || typeof address === "string") {
      throw new Error("expected upstream server to provide a numeric port");
    }
    const upstreamUrl = `ws://127.0.0.1:${address.port}`;
    let observedConnectClientId: string | null = null;
    let observedConnectClientMode: string | null = null;
    let observedConnectClientPlatform: string | null = null;
    let observedConnectCaps: string[] | null = null;

    upstream.on("connection", (ws) => {
      ws.send(JSON.stringify({ type: "event", event: "connect.challenge", payload: {} }));
      ws.on("message", (raw) => {
        const parsed = JSON.parse(String(raw ?? "")) as {
          id?: string;
          method?: string;
          params?: {
            client?: { id?: string; mode?: string; platform?: string };
            caps?: string[];
          };
        };
        if (parsed?.method === "connect") {
          observedConnectClientId = parsed.params?.client?.id ?? null;
          observedConnectClientMode = parsed.params?.client?.mode ?? null;
          observedConnectClientPlatform = parsed.params?.client?.platform ?? null;
          observedConnectCaps = Array.isArray(parsed.params?.caps) ? parsed.params.caps : null;
          ws.send(
            JSON.stringify({
              type: "res",
              id: parsed.id,
              ok: true,
              payload: { type: "hello-ok", protocol: 3 },
            })
          );
          return;
        }
        if (parsed?.method === "status") {
          ws.close(1011, "upstream closed");
        }
      });
    });

    const adapter = new OpenClawGatewayAdapter({
      loadSettings: () => ({ url: upstreamUrl, token: "tkn" }),
    });

    await adapter.start();
    const startedAt = Date.now();
    await expect(adapter.request("status", {})).rejects.toThrow(
      "Control-plane gateway connection closed."
    );
    expect(Date.now() - startedAt).toBeLessThan(2_000);
    expect(observedConnectClientId).toBe("gateway-client");
    expect(observedConnectClientMode).toBe("backend");
    expect(observedConnectClientPlatform).toBe("node");
    expect(observedConnectCaps).toEqual(expect.arrayContaining(["tool-events"]));

    await adapter.stop();
  });

  it("fails connect gracefully when sending the connect request throws", async () => {
    class ThrowingConnectSocket extends EventEmitter {
      readyState: number = WebSocket.OPEN;

      close() {
        if (this.readyState === WebSocket.CLOSED) return;
        this.readyState = WebSocket.CLOSED;
        this.emit("close");
      }

      terminate() {
        this.close();
      }

      send(raw: string) {
        const parsed = JSON.parse(raw) as { method?: string };
        if (parsed.method === "connect") {
          throw new Error("connect send failed");
        }
      }
    }

    const socket = new ThrowingConnectSocket();
    const adapter = new OpenClawGatewayAdapter({
      loadSettings: () => ({ url: "ws://127.0.0.1:9", token: "tkn" }),
      createWebSocket: () => socket as unknown as WebSocket,
    });

    setTimeout(() => {
      socket.emit("message", JSON.stringify({ type: "event", event: "connect.challenge", payload: {} }));
    }, 0);

    await expect(adapter.start()).rejects.toThrow(
      "Control-plane gateway connection closed during connect."
    );

    await adapter.stop();
  });

  it("emits gateway events with unique connection epochs across reconnect cycles", async () => {
    upstream = new WebSocketServer({ port: 0 });
    const address = upstream.address();
    if (!address || typeof address === "string") {
      throw new Error("expected upstream server to provide a numeric port");
    }
    const upstreamUrl = `ws://127.0.0.1:${address.port}`;
    let acceptedConnections = 0;

    upstream.on("connection", (ws) => {
      acceptedConnections += 1;
      const connectionIndex = acceptedConnections;
      ws.send(JSON.stringify({ type: "event", event: "connect.challenge", payload: {} }));
      ws.on("message", (raw) => {
        const parsed = JSON.parse(String(raw ?? "")) as { id?: string; method?: string };
        if (parsed?.method !== "connect" || !parsed.id) return;
        ws.send(
          JSON.stringify({
            type: "res",
            id: parsed.id,
            ok: true,
            payload: { type: "hello-ok", protocol: 3 },
          })
        );
        ws.send(
          JSON.stringify({
            type: "event",
            event: "agent",
            seq: 1,
            payload: { connectionIndex },
          })
        );
      });
    });

    const observedEvents: ControlPlaneDomainEvent[] = [];
    const adapter = new OpenClawGatewayAdapter({
      loadSettings: () => ({ url: upstreamUrl, token: "tkn" }),
      onDomainEvent: (event) => {
        observedEvents.push(event);
      },
    });

    await adapter.start();
    await waitForCondition(() =>
      observedEvents.some(
        (event) =>
          event.type === "gateway.event" &&
          event.event === "agent" &&
          typeof (event.payload as { connectionIndex?: unknown })?.connectionIndex === "number" &&
          (event.payload as { connectionIndex?: number }).connectionIndex === 1
      )
    );

    await adapter.stop();

    await adapter.start();
    await waitForCondition(() =>
      observedEvents.some(
        (event) =>
          event.type === "gateway.event" &&
          event.event === "agent" &&
          typeof (event.payload as { connectionIndex?: unknown })?.connectionIndex === "number" &&
          (event.payload as { connectionIndex?: number }).connectionIndex === 2
      )
    );

    const firstGatewayEvent = observedEvents.find(
      (event) =>
        event.type === "gateway.event" &&
        (event.payload as { connectionIndex?: number })?.connectionIndex === 1
    );
    const secondGatewayEvent = observedEvents.find(
      (event) =>
        event.type === "gateway.event" &&
        (event.payload as { connectionIndex?: number })?.connectionIndex === 2
    );

    expect(firstGatewayEvent?.type).toBe("gateway.event");
    expect(secondGatewayEvent?.type).toBe("gateway.event");
    if (!firstGatewayEvent || firstGatewayEvent.type !== "gateway.event") {
      throw new Error("Expected first gateway event.");
    }
    if (!secondGatewayEvent || secondGatewayEvent.type !== "gateway.event") {
      throw new Error("Expected second gateway event.");
    }
    expect(firstGatewayEvent.connectionEpoch).toBeTruthy();
    expect(secondGatewayEvent.connectionEpoch).toBeTruthy();
    expect(firstGatewayEvent.connectionEpoch).not.toBe(secondGatewayEvent.connectionEpoch);

    await adapter.stop();
  });
});
