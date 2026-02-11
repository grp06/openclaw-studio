/**
 * Activity Feed types.
 */

export type ActivityEventType =
  | "chat"
  | "agent"
  | "presence"
  | "heartbeat"
  | "cron"
  | "system";

export type ActivityEvent = {
  id: string;
  type: ActivityEventType;
  event: string;
  agentId: string | null;
  summary: string;
  timestampMs: number;
  payload?: unknown;
};
