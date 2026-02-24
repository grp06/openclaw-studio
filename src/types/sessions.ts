export type InterruptReason =
  | 'manual'      // User explicitly exited
  | 'crash'       // Unexpected termination
  | 'superseded'  // New START for same project
  | 'timeout'     // 4h+ inactivity
  | 'dismissed'   // User dismissed from UI
  | 'unknown';    // Legacy or unclear

export interface Session {
  project: string;
  status: 'active' | 'paused' | 'completed' | 'exited' | 'dismissed';
  startTime: string;
  endTime?: string;
  lastActivityTime?: string;
  details?: string;

  // Enhanced metadata
  interruptReason?: InterruptReason;
  durationMs?: number;
  completionNotes?: string;
  dismissedAt?: string;
}

export interface SessionsData {
  active: Session[];
  paused: Session[];
  completed: Session[];
  exited: Session[];
  dismissed?: Session[];
  lastUpdated: string;
}
