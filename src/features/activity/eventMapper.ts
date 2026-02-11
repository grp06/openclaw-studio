/**
 * Maps gateway EventFrames to ActivityEvent records.
 */

import type { EventFrame } from "@/lib/gateway/GatewayClient";
import type { ActivityEvent, ActivityEventType } from "./types";

let nextId = 0;

const classifyEventType = (eventName: string): ActivityEventType => {
  if (eventName.startsWith("chat.") || eventName === "chat") return "chat";
  if (eventName.startsWith("agent.") || eventName === "agent") return "agent";
  if (eventName.startsWith("presence") || eventName === "presence") return "presence";
  if (eventName.startsWith("heartbeat") || eventName === "heartbeat") return "heartbeat";
  if (eventName.startsWith("cron") || eventName === "cron") return "cron";
  return "system";
};

const extractAgentId = (frame: EventFrame): string | null => {
  const p = frame.payload as Record<string, unknown> | undefined;
  if (p?.agentId && typeof p.agentId === "string") return p.agentId;
  if (p?.sessionKey && typeof p.sessionKey === "string") {
    const match = (p.sessionKey as string).match(/^agent:([^:]+):/);
    if (match) return match[1];
  }
  return null;
};

const summarize = (frame: EventFrame): string => {
  const p = frame.payload as Record<string, unknown> | undefined;
  if (p?.message && typeof p.message === "string") {
    return p.message.length > 120 ? p.message.slice(0, 117) + "..." : p.message;
  }
  if (p?.status && typeof p.status === "string") return p.status;
  return frame.event;
};

export const mapFrameToActivityEvent = (frame: EventFrame): ActivityEvent => {
  return {
    id: `activity-${++nextId}-${Date.now()}`,
    type: classifyEventType(frame.event),
    event: frame.event,
    agentId: extractAgentId(frame),
    summary: summarize(frame),
    timestampMs: Date.now(),
    payload: frame.payload,
  };
};

/** Reset ID counter (for testing). */
export const resetEventIdCounter = () => {
  nextId = 0;
};
