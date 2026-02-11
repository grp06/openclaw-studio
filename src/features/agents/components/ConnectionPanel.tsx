import type { GatewayStatus } from "@/lib/gateway/GatewayClient";
import { X } from "lucide-react";

type ConnectionPanelProps = {
  gatewayUrl: string;
  token: string;
  status: GatewayStatus;
  error: string | null;
  onGatewayUrlChange: (value: string) => void;
  onTokenChange: (value: string) => void;
  onConnect: () => void;
  onDisconnect: () => void;
  onClose?: () => void;
};

const statusStyles: Record<GatewayStatus, { label: string; className: string }> = {
  disconnected: {
    label: "Disconnected",
    className: "border border-border/70 bg-muted text-muted-foreground",
  },
  connecting: {
    label: "Connecting",
    className: "border border-border/70 bg-secondary text-secondary-foreground",
  },
  connected: {
    label: "Connected",
    className: "border border-primary/30 bg-primary/15 text-foreground",
  },
};

export const ConnectionPanel = ({
  gatewayUrl,
  token,
  status,
  error,
  onGatewayUrlChange,
  onTokenChange,
  onConnect,
  onDisconnect,
  onClose,
}: ConnectionPanelProps) => {
  const statusConfig = statusStyles[status];
  const isConnected = status === "connected";
  const isConnecting = status === "connecting";

  return (
    <div className="fade-up-delay flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <span
            className={`inline-flex items-center rounded-md px-3 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.15em] ${statusConfig.className}`}
          >
            {statusConfig.label}
          </span>
          <button
            className="rounded-md border border-input/90 bg-surface-3 px-4 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-foreground transition hover:border-border hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-60"
            type="button"
            onClick={isConnected ? onDisconnect : onConnect}
            disabled={isConnecting || !gatewayUrl.trim()}
          >
            {isConnected ? "Disconnect" : "Connect"}
          </button>
        </div>
        {onClose ? (
          <button
            className="inline-flex items-center gap-1 rounded-md border border-input/90 bg-surface-3 px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-foreground transition hover:border-border hover:bg-surface-2"
            type="button"
            onClick={onClose}
            data-testid="gateway-connection-close"
            aria-label="Close gateway connection panel"
          >
            <X className="h-3.5 w-3.5" />
            Close
          </button>
        ) : null}
      </div>
      <div className="grid gap-3 lg:grid-cols-[1.4fr_1fr]">
        <label className="flex flex-col gap-1 font-mono text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
          Upstream Gateway URL
          <input
            className="h-10 rounded-md border border-input bg-surface-3 px-4 font-sans text-sm text-foreground outline-none transition"
            type="text"
            value={gatewayUrl}
            onChange={(event) => onGatewayUrlChange(event.target.value)}
            placeholder="ws://localhost:18789"
            spellCheck={false}
          />
        </label>
        <label className="flex flex-col gap-1 font-mono text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
          Upstream Token
          <input
            className="h-10 rounded-md border border-input bg-surface-3 px-4 font-sans text-sm text-foreground outline-none transition"
            type="password"
            value={token}
            onChange={(event) => onTokenChange(event.target.value)}
            placeholder="gateway token"
            spellCheck={false}
          />
        </label>
      </div>
      {error ? (
        <p className="rounded-md border border-destructive bg-destructive px-4 py-2 text-sm text-destructive-foreground">
          {error}
        </p>
      ) : null}
    </div>
  );
};
