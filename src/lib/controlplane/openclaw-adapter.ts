import { randomUUID } from "node:crypto";

import { WebSocket } from "ws";

import type {
  ControlPlaneConnectionStatus,
  ControlPlaneDomainEvent,
  ControlPlaneGatewaySettings,
  GatewayEventFrame,
  GatewayResponseFrame,
} from "@/lib/controlplane/contracts";
import { loadStudioSettings } from "@/lib/studio/settings-store";

const CONNECT_TIMEOUT_MS = 8_000;
const REQUEST_TIMEOUT_MS = 15_000;
const INITIAL_RECONNECT_DELAY_MS = 1_000;
const MAX_RECONNECT_DELAY_MS = 15_000;
const CONNECT_PROTOCOL = 3;
const CONNECT_CLIENT_ID = "gateway-client";
const CONNECT_CLIENT_MODE = "backend";
const CONNECT_CAPABILITIES = ["tool-events"];

const DEFAULT_METHOD_ALLOWLIST = new Set<string>([
  "status",
  "chat.send",
  "chat.abort",
  "chat.history",
  "agents.create",
  "agents.update",
  "agents.delete",
  "agents.list",
  "agents.files.get",
  "agents.files.set",
  "sessions.list",
  "sessions.preview",
  "sessions.patch",
  "sessions.reset",
  "cron.list",
  "cron.run",
  "cron.remove",
  "cron.add",
  "config.get",
  "config.set",
  "models.list",
  "skills.status",
  "skills.install",
  "skills.update",
  "exec.approval.resolve",
  "exec.approvals.get",
  "exec.approvals.set",
  "agent.wait",
]);

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

export class ControlPlaneGatewayError extends Error {
  readonly code: string;
  readonly details?: unknown;

  constructor(params: { code: string; message: string; details?: unknown }) {
    super(params.message);
    this.name = "ControlPlaneGatewayError";
    this.code = params.code;
    this.details = params.details;
  }
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object");

const resolveOriginForUpstream = (upstreamUrl: string): string => {
  const url = new URL(upstreamUrl);
  const proto = url.protocol === "wss:" ? "https:" : "http:";
  const hostname =
    url.hostname === "127.0.0.1" || url.hostname === "::1" || url.hostname === "0.0.0.0"
      ? "localhost"
      : url.hostname;
  const host = url.port ? `${hostname}:${url.port}` : hostname;
  return `${proto}//${host}`;
};

const loadGatewaySettings = (): ControlPlaneGatewaySettings => {
  const settings = loadStudioSettings();
  const gateway = settings.gateway;
  const url = typeof gateway?.url === "string" ? gateway.url.trim() : "";
  const token = typeof gateway?.token === "string" ? gateway.token.trim() : "";
  if (!url) {
    throw new Error("Control-plane start failed: Studio gateway URL is not configured.");
  }
  if (!token) {
    throw new Error("Control-plane start failed: Studio gateway token is not configured.");
  }
  return { url, token };
};

export type OpenClawAdapterOptions = {
  loadSettings?: () => ControlPlaneGatewaySettings;
  createWebSocket?: (url: string, opts: { origin: string }) => WebSocket;
  methodAllowlist?: Set<string>;
  onDomainEvent?: (event: ControlPlaneDomainEvent) => void;
};

export class OpenClawGatewayAdapter {
  private ws: WebSocket | null = null;
  private status: ControlPlaneConnectionStatus = "stopped";
  private statusReason: string | null = null;
  private connectRequestId: string | null = null;
  private connectTimer: ReturnType<typeof setTimeout> | null = null;
  private startPromise: Promise<void> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private stopping = false;
  private nextRequestNumber = 1;
  private connectionEpoch: string | null = null;
  private pending = new Map<string, PendingRequest>();
  private loadSettings: () => ControlPlaneGatewaySettings;
  private createWebSocket: (url: string, opts: { origin: string }) => WebSocket;
  private methodAllowlist: Set<string>;
  private onDomainEvent?: (event: ControlPlaneDomainEvent) => void;

  constructor(options?: OpenClawAdapterOptions) {
    this.loadSettings = options?.loadSettings ?? loadGatewaySettings;
    this.createWebSocket = options?.createWebSocket ?? ((url, opts) => new WebSocket(url, opts));
    this.methodAllowlist = options?.methodAllowlist ?? DEFAULT_METHOD_ALLOWLIST;
    this.onDomainEvent = options?.onDomainEvent;
  }

  getStatus(): ControlPlaneConnectionStatus {
    return this.status;
  }

  getStatusReason(): string | null {
    return this.statusReason;
  }

  async start(): Promise<void> {
    if (this.status === "connected") return;
    if (this.startPromise) return this.startPromise;
    this.stopping = false;
    this.startPromise = this.connect().finally(() => {
      this.startPromise = null;
    });
    return this.startPromise;
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.connectTimer) {
      clearTimeout(this.connectTimer);
      this.connectTimer = null;
    }
    this.rejectPending("Control-plane adapter stopped.");
    const ws = this.ws;
    this.ws = null;
    this.connectRequestId = null;
    this.connectionEpoch = null;
    if (ws && ws.readyState === WebSocket.OPEN) {
      await new Promise<void>((resolve) => {
        ws.once("close", () => resolve());
        ws.close(1000, "controlplane stopping");
      });
    } else {
      ws?.terminate();
    }
    this.updateStatus("stopped", null);
  }

  async request<T = unknown>(method: string, params: unknown): Promise<T> {
    const normalizedMethod = method.trim();
    if (!normalizedMethod) {
      throw new Error("Gateway method is required.");
    }
    if (!this.methodAllowlist.has(normalizedMethod)) {
      throw new Error(`Gateway method is not allowlisted: ${normalizedMethod}`);
    }
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN || this.status !== "connected") {
      throw new ControlPlaneGatewayError({
        code: "GATEWAY_UNAVAILABLE",
        message: "Gateway is unavailable.",
      });
    }

    const id = String(this.nextRequestNumber++);
    const frame = { type: "req", id, method: normalizedMethod, params };

    const response = await new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Gateway request timed out for method: ${normalizedMethod}`));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      ws.send(JSON.stringify(frame), (err) => {
        if (!err) return;
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new Error(`Failed to send gateway request for method: ${normalizedMethod}`));
      });
    });

    return response as T;
  }

  private async connect(): Promise<void> {
    const settings = this.loadSettings();
    this.connectionEpoch = randomUUID();
    const ws = this.createWebSocket(settings.url, { origin: resolveOriginForUpstream(settings.url) });
    this.ws = ws;
    this.connectRequestId = null;
    this.updateStatus(this.reconnectAttempt > 0 ? "reconnecting" : "connecting", null);

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        if (this.connectTimer) {
          clearTimeout(this.connectTimer);
          this.connectTimer = null;
        }
        fn();
      };

      this.connectTimer = setTimeout(() => {
        settle(() => {
          ws.close(1011, "connect timeout");
          reject(new Error("Control-plane connect timed out waiting for connect response."));
        });
      }, CONNECT_TIMEOUT_MS);

      ws.on("message", (raw) => {
        const parsed = this.parseFrame(String(raw ?? ""));
        if (!parsed) return;
        if (parsed.type === "event") {
          if (parsed.event === "connect.challenge") {
            this.sendConnectRequest(settings.token);
            return;
          }
          this.emitEvent({
            type: "gateway.event",
            event: parsed.event,
            seq: typeof parsed.seq === "number" ? parsed.seq : null,
            connectionEpoch: this.connectionEpoch,
            payload: parsed.payload,
            asOf: new Date().toISOString(),
          });
          return;
        }
        if (!this.handleResponseFrame(parsed)) return;
        if (parsed.id === this.connectRequestId) {
          if (parsed.ok) {
            this.reconnectAttempt = 0;
            this.updateStatus("connected", null);
            settle(() => resolve());
            return;
          }
          const code = parsed.error?.code ?? "CONNECT_FAILED";
          const message = parsed.error?.message ?? "Connect failed.";
          settle(() => {
            ws.close(1011, "connect failed");
            reject(new Error(`Control-plane connect rejected: ${code} ${message}`));
          });
        }
      });

      ws.on("close", () => {
        if (this.stopping) return;
        if (!settled) {
          settle(() => reject(new Error("Control-plane gateway connection closed during connect.")));
          return;
        }
        this.rejectPending("Control-plane gateway connection closed.");
        this.connectionEpoch = null;
        this.updateStatus("reconnecting", "gateway_closed");
        this.scheduleReconnect();
      });

      ws.on("error", () => {
        if (this.stopping) return;
        if (!settled) {
          settle(() => reject(new Error("Control-plane gateway connection failed.")));
        }
      });
    }).catch((err) => {
      this.connectionEpoch = null;
      this.updateStatus("error", err instanceof Error ? err.message : "connect_error");
      this.scheduleReconnect();
      throw err;
    });
  }

  private scheduleReconnect(): void {
    if (this.stopping) return;
    if (this.reconnectTimer) return;
    const delay = Math.min(
      INITIAL_RECONNECT_DELAY_MS * Math.pow(1.7, this.reconnectAttempt),
      MAX_RECONNECT_DELAY_MS
    );
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.start().catch(() => {});
    }, delay);
  }

  private sendConnectRequest(token: string): void {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN || this.connectRequestId) return;
    const id = String(this.nextRequestNumber++);
    this.connectRequestId = id;
    try {
      ws.send(
        JSON.stringify({
          type: "req",
          id,
          method: "connect",
          params: {
            minProtocol: CONNECT_PROTOCOL,
            maxProtocol: CONNECT_PROTOCOL,
            client: {
              id: CONNECT_CLIENT_ID,
              version: "dev",
              platform: "node",
              mode: CONNECT_CLIENT_MODE,
            },
            role: "operator",
            scopes: [
              "operator.admin",
              "operator.read",
              "operator.write",
              "operator.approvals",
              "operator.pairing",
            ],
            caps: CONNECT_CAPABILITIES,
            auth: { token },
          },
        })
      );
    } catch (err) {
      this.connectRequestId = null;
      const reason = err instanceof Error ? err.message : "connect_send_failed";
      this.updateStatus("error", reason);
      try {
        ws.close(1011, "connect send failed");
      } catch (closeErr) {
        console.error("Failed to close gateway socket after connect-send failure.", closeErr);
      }
    }
  }

  private parseFrame(raw: string): GatewayEventFrame | GatewayResponseFrame | null {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
    if (!isObject(parsed) || typeof parsed.type !== "string") return null;
    if (parsed.type === "event" && typeof parsed.event === "string") {
      return parsed as GatewayEventFrame;
    }
    if (parsed.type === "res" && typeof parsed.id === "string") {
      return parsed as GatewayResponseFrame;
    }
    return null;
  }

  private handleResponseFrame(frame: GatewayResponseFrame): boolean {
    const pending = this.pending.get(frame.id);
    if (!pending) return true;
    clearTimeout(pending.timer);
    this.pending.delete(frame.id);
    if (frame.ok) {
      pending.resolve(frame.payload);
      return true;
    }
    pending.reject(
      new ControlPlaneGatewayError({
        code: frame.error?.code ?? "GATEWAY_REQUEST_FAILED",
        message: frame.error?.message ?? "Gateway request failed.",
        details: frame.error?.details,
      })
    );
    return true;
  }

  private rejectPending(message: string): void {
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error(message));
    }
    this.pending.clear();
  }

  private updateStatus(status: ControlPlaneConnectionStatus, reason: string | null): void {
    this.status = status;
    this.statusReason = reason;
    this.emitEvent({
      type: "runtime.status",
      status,
      reason,
      asOf: new Date().toISOString(),
    });
  }

  private emitEvent(event: ControlPlaneDomainEvent): void {
    this.onDomainEvent?.(event);
  }
}
