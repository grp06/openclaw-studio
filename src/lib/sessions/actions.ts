/**
 * Session action API client
 * Communicates with POST /api/sessions endpoint
 */

export type SessionAction = 'dismiss' | 'markDone' | 'addNote';

export interface SessionActionRequest {
  action: SessionAction;
  project: string;
  details?: string;
}

export interface SessionActionResponse {
  success: boolean;
  error?: string;
}

/**
 * Dismiss a session (hide from UI)
 */
export async function dismissSession(
  project: string,
  reason?: string
): Promise<SessionActionResponse> {
  try {
    const response = await fetch('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'dismiss',
        project,
        details: reason,
      } as SessionActionRequest),
    });

    if (!response.ok) {
      const errorData = await response.json();
      return { success: false, error: errorData.error || 'Failed to dismiss session' };
    }

    return await response.json();
  } catch (error) {
    console.error('Error dismissing session:', error);
    return { success: false, error: 'Network error' };
  }
}

/**
 * Mark interrupted session as done/completed
 */
export async function markSessionDone(
  project: string,
  summary: string
): Promise<SessionActionResponse> {
  try {
    const response = await fetch('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'markDone',
        project,
        details: summary,
      } as SessionActionRequest),
    });

    if (!response.ok) {
      const errorData = await response.json();
      return { success: false, error: errorData.error || 'Failed to mark session done' };
    }

    return await response.json();
  } catch (error) {
    console.error('Error marking session done:', error);
    return { success: false, error: 'Network error' };
  }
}

/**
 * Add note to a session
 */
export async function addSessionNote(
  project: string,
  note: string
): Promise<SessionActionResponse> {
  try {
    const response = await fetch('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'addNote',
        project,
        details: note,
      } as SessionActionRequest),
    });

    if (!response.ok) {
      const errorData = await response.json();
      return { success: false, error: errorData.error || 'Failed to add note' };
    }

    return await response.json();
  } catch (error) {
    console.error('Error adding session note:', error);
    return { success: false, error: 'Network error' };
  }
}

/**
 * Export sessions (JSON or CSV)
 */
export async function exportSessions(format: 'json' | 'csv' = 'json', project?: string): Promise<void> {
  try {
    const params = new URLSearchParams({ format });
    if (project) params.append('project', project);

    const response = await fetch(`/api/sessions/export?${params}`);

    if (!response.ok) {
      throw new Error('Export failed');
    }

    if (format === 'csv') {
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `sessions-${project || 'all'}-${new Date().toISOString().split('T')[0]}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } else {
      const data = await response.json();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `sessions-${project || 'all'}-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    }
  } catch (error) {
    console.error('Error exporting sessions:', error);
    throw error;
  }
}
