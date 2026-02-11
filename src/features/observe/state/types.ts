export type ObserveEntry = {
  id: string;
  timestamp: number;
  eventType: "chat" | "agent" | "presence" | "heartbeat" | "unknown";
  sessionKey: string | null;
  agentId: string | null;
  runId: string | null;
  stream: string | null;
  toolName: string | null;
  toolPhase: string | null;
  toolArgs: string | null;
  chatState: string | null;
  errorMessage: string | null;
  text: string | null;
  description: string;
  severity: "info" | "warn" | "error";
};

export type SessionOrigin = "interactive" | "cron" | "heartbeat" | "unknown";

export type SessionStatus = {
  sessionKey: string;
  agentId: string | null;
  displayName: string | null;
  origin: SessionOrigin;
  status: "idle" | "running" | "error";
  lastActivityAt: number | null;
  currentToolName: string | null;
  currentToolArgs: string | null;
  currentActivity: string | null;
  streamingText: string | null;
  lastError: string | null;
  eventCount: number;
};

export type ObserveState = {
  entries: ObserveEntry[];
  sessions: SessionStatus[];
  interventionCount: number;
  paused: boolean;
};

export type ObserveAction =
  | { type: "pushEntries"; entries: ObserveEntry[] }
  | { type: "hydrateSessions"; sessions: SessionStatus[] }
  | { type: "togglePause" }
  | { type: "clearLog" };

export const MAX_ENTRIES = 2000;
