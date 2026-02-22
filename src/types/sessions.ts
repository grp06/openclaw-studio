export interface Session {
  project: string;
  status: 'active' | 'paused' | 'completed' | 'exited';
  startTime: string;
  endTime?: string;
  details?: string;
}

export interface SessionsData {
  active: Session[];
  paused: Session[];
  completed: Session[];
  exited: Session[];
  lastUpdated: string;
}
