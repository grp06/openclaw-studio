import type { ControlPlaneDomainEvent } from "@/lib/controlplane/contracts";

const safeString = (value: unknown): string => (typeof value === "string" ? value : "");

export const deriveControlPlaneEventKey = (event: ControlPlaneDomainEvent): string => {
  if (event.type === "runtime.status") {
    return ["runtime.status", event.status, safeString(event.reason), event.asOf].join(":");
  }
  const connectionEpoch = safeString(event.connectionEpoch).trim();
  if (typeof event.seq === "number" && Number.isFinite(event.seq)) {
    if (connectionEpoch) {
      return ["gateway.event", event.event, "epoch", connectionEpoch, "seq", String(event.seq)].join(
        ":"
      );
    }
    return ["gateway.event", event.event, "seq", String(event.seq), safeString(event.asOf)].join(":");
  }
  return ["gateway.event", event.event, connectionEpoch, event.asOf].join(":");
};
