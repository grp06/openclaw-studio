'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Plus, Check, ListTodo, Zap, RefreshCw, Trash2 } from 'lucide-react';
import type { TodoItem, TodosData } from '@/types/todos';

type Assignment = {
  status: 'in_progress' | 'completed' | 'failed';
};

const POLL_INTERVAL = 30_000;

export const TodosTab = () => {
  const [data, setData] = useState<TodosData | null>(null);
  const [loading, setLoading] = useState(true);
  const [quickAddText, setQuickAddText] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const [activeAssignments, setActiveAssignments] = useState(0);

  const fetchTodos = useCallback(async () => {
    try {
      const response = await fetch('/api/todos');
      if (response.ok) {
        const result: TodosData = await response.json();
        setData(result);
      }
    } catch (err) {
      console.error('Failed to fetch todos:', err);
    } finally {
      setLoading(false);
    }
    try {
      const response = await fetch('/api/assign');
      if (response.ok) {
        const result = await response.json();
        const active = (result.assignments || []).filter(
          (a: Assignment) => a.status === 'in_progress'
        ).length;
        setActiveAssignments(active);
      }
    } catch {
      // Assignments are optional
    }
  }, []);

  useEffect(() => {
    fetchTodos();
    const interval = setInterval(fetchTodos, POLL_INTERVAL);
    const handleVisibility = () => { if (!document.hidden) fetchTodos(); };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [fetchTodos]);

  const handleQuickAdd = async () => {
    if (!quickAddText.trim() || busy) return;
    setBusy(true);
    try {
      const res = await fetch('/api/todos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: quickAddText.trim() }),
      });
      if (res.ok) {
        const { items } = await res.json();
        setData((prev) => prev ? { ...prev, items } : prev);
        setQuickAddText('');
      }
    } catch (err) {
      console.error('Quick add failed:', err);
    } finally {
      setBusy(false);
    }
  };

  const handleToggle = async (index: number, completed: boolean) => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch('/api/todos', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ index, completed: !completed }),
      });
      if (res.ok) {
        const { items } = await res.json();
        setData((prev) => prev ? { ...prev, items } : prev);
      }
    } catch (err) {
      console.error('Toggle failed:', err);
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (index: number) => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch('/api/todos', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ index }),
      });
      if (res.ok) {
        const { items } = await res.json();
        setData((prev) => prev ? { ...prev, items } : prev);
      }
    } catch (err) {
      console.error('Delete failed:', err);
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-3" />
          <p className="text-xs text-muted-foreground">Loading captures...</p>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="p-4">
        <div className="text-center py-8 text-xs text-muted-foreground">
          Failed to load captures.
        </div>
      </div>
    );
  }

  const pending = data.items.filter((i) => !i.completed);
  const completed = data.items.filter((i) => i.completed);

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex-shrink-0 px-4 pt-4 pb-3 border-b border-border">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <ListTodo className="w-3.5 h-3.5" />
            <span className="text-xs text-muted-foreground">
              {pending.length} pending / {completed.length} done
            </span>
            {activeAssignments > 0 && (
              <span className="inline-flex items-center gap-1 rounded-md bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                <Zap className="w-2.5 h-2.5" />
                {activeAssignments}
              </span>
            )}
          </div>
          <button
            type="button"
            className="ui-btn-icon h-7 w-7 !bg-transparent hover:!bg-muted"
            onClick={fetchTodos}
            title="Refresh"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Quick add */}
        <div className="flex gap-2">
          <input
            ref={inputRef}
            type="text"
            className="ui-input flex-1 rounded-md px-2.5 py-1.5 text-xs"
            placeholder="Quick add capture..."
            value={quickAddText}
            onChange={(e) => setQuickAddText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleQuickAdd();
            }}
          />
          <button
            type="button"
            className="ui-btn-primary px-2.5 py-1.5 text-[10px] font-medium flex items-center gap-1"
            onClick={handleQuickAdd}
            disabled={busy || !quickAddText.trim()}
          >
            <Plus className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto px-4 py-4 space-y-3">
        {pending.length === 0 && completed.length === 0 ? (
          <div className="text-center py-8 text-xs text-muted-foreground">
            No captures yet. Add ideas via Telegram or the input above.
          </div>
        ) : (
          <>
            {/* Pending items */}
            {pending.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-muted-foreground mb-2">Pending</p>
                <div className="space-y-1.5">
                  {pending.map((item) => {
                    const globalIdx = data.items.indexOf(item);
                    return (
                      <div key={globalIdx} className="flex items-start gap-2 text-xs group bg-muted/20 rounded-md p-2 hover:bg-muted/40 transition">
                        <button
                          type="button"
                          className="mt-0.5 flex-shrink-0 h-4 w-4 rounded border border-border hover:border-primary/50 flex items-center justify-center transition-colors"
                          onClick={() => handleToggle(globalIdx, item.completed)}
                        />
                        <div className="flex-1 min-w-0">
                          <span>{item.text}</span>
                          {item.project && (
                            <span className="ml-1.5 inline-flex rounded bg-primary/10 px-1 py-0.5 text-[9px] font-medium text-primary">
                              {item.project}
                            </span>
                          )}
                        </div>
                        <button
                          type="button"
                          className="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                          onClick={() => handleDelete(globalIdx)}
                          title="Delete"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Completed */}
            {completed.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-muted-foreground mb-2">
                  Completed ({completed.length})
                </p>
                <div className="space-y-1.5">
                  {completed.map((item) => {
                    const globalIdx = data.items.indexOf(item);
                    return (
                      <div key={globalIdx} className="flex items-start gap-2 text-xs text-muted-foreground group bg-muted/10 rounded-md p-2 hover:bg-muted/30 transition">
                        <button
                          type="button"
                          className="mt-0.5 flex-shrink-0 h-4 w-4 rounded border border-primary/30 bg-primary/10 flex items-center justify-center hover:bg-primary/20 transition"
                          onClick={() => handleToggle(globalIdx, item.completed)}
                        >
                          <Check className="w-2.5 h-2.5 text-primary" />
                        </button>
                        <span className="line-through flex-1">{item.text}</span>
                        <button
                          type="button"
                          className="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity hover:text-destructive"
                          onClick={() => handleDelete(globalIdx)}
                          title="Delete"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};
