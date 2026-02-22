'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { ChevronRight, ChevronDown, Plus, Check, Zap } from 'lucide-react';
import type { TodoItem, TodosData } from '@/types/todos';

type Assignment = {
  status: 'in_progress' | 'completed' | 'failed';
};

const POLL_INTERVAL = 30_000;

export const TodosWidget = () => {
  const [data, setData] = useState<TodosData | null>(null);
  const [expanded, setExpanded] = useState(false);
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

  if (!data) return null;

  const pending = data.items.filter((i) => !i.completed);
  const completed = data.items.filter((i) => i.completed);

  if (pending.length === 0 && completed.length === 0) return null;

  return (
    <div className="w-full ui-panel">
      {/* Collapsed banner bar */}
      <button
        type="button"
        className="flex w-full items-center justify-between px-4 py-2.5"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="flex items-center gap-3">
          <span className="text-xs font-semibold tracking-wide uppercase text-muted-foreground">
            Captures
          </span>
          <div className="flex items-center gap-2">
            {pending.length > 0 && (
              <span className="inline-flex items-center gap-1 rounded-md bg-primary/15 px-2 py-0.5 text-[11px] font-semibold text-primary">
                {pending.length} pending
              </span>
            )}
            {activeAssignments > 0 && (
              <span className="inline-flex items-center gap-1 rounded-md bg-primary/15 px-2 py-0.5 text-[11px] font-semibold text-primary">
                <Zap className="w-3 h-3" />
                {activeAssignments} assigned
              </span>
            )}
            {completed.length > 0 && (
              <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                {completed.length} done
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Link
            href="/todos"
            className="text-xs text-primary hover:opacity-70 transition flex items-center gap-1"
            onClick={(e) => e.stopPropagation()}
          >
            Manage <ChevronRight className="w-3 h-3" />
          </Link>
          {expanded ? (
            <ChevronDown className="w-4 h-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="w-4 h-4 text-muted-foreground" />
          )}
        </div>
      </button>

      {/* Expanded details */}
      {expanded && (
        <div className="border-t border-border px-4 pb-3 pt-2 space-y-3 max-h-72 overflow-y-auto">
          {/* Quick add */}
          <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
            <input
              ref={inputRef}
              type="text"
              className="ui-input flex-1 rounded-md px-2.5 py-1.5 text-xs"
              placeholder="Quick add..."
              value={quickAddText}
              onChange={(e) => setQuickAddText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleQuickAdd();
              }}
            />
            <button
              type="button"
              className="ui-btn-primary px-2 py-1.5 text-[10px] font-medium flex items-center gap-1"
              onClick={handleQuickAdd}
              disabled={busy || !quickAddText.trim()}
            >
              <Plus className="w-3 h-3" />
              Add
            </button>
          </div>

          {/* Pending items with quick toggle */}
          {pending.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground mb-1.5">Pending</p>
              <div className="space-y-1">
                {pending.map((item) => {
                  const globalIdx = data.items.indexOf(item);
                  return (
                    <div key={globalIdx} className="flex items-start gap-2 text-xs group">
                      <button
                        type="button"
                        className="mt-0.5 flex-shrink-0 h-4 w-4 rounded border border-border hover:border-primary/50 flex items-center justify-center transition-colors"
                        onClick={(e) => { e.stopPropagation(); handleToggle(globalIdx, item.completed); }}
                      />
                      <div className="flex-1 min-w-0">
                        <span>{item.text}</span>
                        {item.project && (
                          <span className="ml-1.5 inline-flex rounded bg-primary/10 px-1 py-0.5 text-[9px] font-medium text-primary">
                            {item.project}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Completed (collapsed summary) */}
          {completed.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground mb-1.5">
                Completed ({completed.length})
              </p>
              <div className="space-y-1">
                {completed.slice(0, 3).map((item) => {
                  const globalIdx = data.items.indexOf(item);
                  return (
                    <div key={globalIdx} className="flex items-start gap-2 text-xs text-muted-foreground">
                      <button
                        type="button"
                        className="mt-0.5 flex-shrink-0 h-4 w-4 rounded border border-primary/30 bg-primary/10 flex items-center justify-center"
                        onClick={(e) => { e.stopPropagation(); handleToggle(globalIdx, item.completed); }}
                      >
                        <Check className="w-2.5 h-2.5 text-primary" />
                      </button>
                      <span className="line-through">{item.text}</span>
                    </div>
                  );
                })}
                {completed.length > 3 && (
                  <Link
                    href="/todos"
                    className="text-[10px] text-primary hover:opacity-70 ml-6"
                    onClick={(e) => e.stopPropagation()}
                  >
                    +{completed.length - 3} more...
                  </Link>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
