import type { GatewayStatus } from "@/lib/gateway/GatewayClient";

type ConnectionPanelProps = {
  gatewayUrl: string;
  token: string;
  status: GatewayStatus;
  error: string | null;
  onGatewayUrlChange: (value: string) => void;
  onTokenChange: (value: string) => void;
  onConnect: () => void;
  onDisconnect: () => void;
};

const statusStyles: Record<GatewayStatus, { label: string; className: string }> =
  {
    disconnected: {
      label: "Disconnected",
      className: "bg-slate-200 text-slate-700",
    },
    connecting: {
      label: "Connecting",
      className: "bg-amber-200 text-amber-900",
    },
    connected: {
      label: "Connected",
      className: "bg-blue-200 text-blue-900",
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
}: ConnectionPanelProps) => {
  const statusConfig = statusStyles[status];
  const isConnected = status === "connected";
  const isConnecting = status === "connecting";

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <span
          className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide ${statusConfig.className}`}
        >
          {statusConfig.label}
        </span>
        <button
          className="rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-900 transition hover:border-slate-400 disabled:cursor-not-allowed disabled:opacity-60"
          type="button"
          onClick={isConnected ? onDisconnect : onConnect}
          disabled={isConnecting || !gatewayUrl.trim()}
        >
          {isConnected ? "Disconnect" : "Connect"}
        </button>
      </div>
      <div className="grid gap-3 lg:grid-cols-[1.4fr_1fr]">
        <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-wide text-slate-600">
          Gateway URL
          <input
            className="h-10 rounded-full border border-slate-300 bg-white/80 px-4 text-sm text-slate-900 outline-none transition focus:border-slate-500"
            type="text"
            value={gatewayUrl}
            onChange={(event) => onGatewayUrlChange(event.target.value)}
            placeholder="ws://127.0.0.1:18789"
            spellCheck={false}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-wide text-slate-600">
          Token
          <input
            className="h-10 rounded-full border border-slate-300 bg-white/80 px-4 text-sm text-slate-900 outline-none transition focus:border-slate-500"
            type="password"
            value={token}
            onChange={(event) => onTokenChange(event.target.value)}
            placeholder="gateway token"
            spellCheck={false}
          />
        </label>
      </div>
      {error ? (
        <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-700">
          {error}
        </p>
      ) : null}
    </div>
  );
};
