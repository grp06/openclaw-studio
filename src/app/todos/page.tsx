'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { ArrowLeft, Plus, Trash2, Pencil, Check, X, Tag, Zap, Loader2 } from 'lucide-react';
import type { TodoItem, TodosData } from '@/types/todos';

type Assignment = {
  id: string;
  todoIndex: number;
  todoText: string;
  project: string;
  status: 'in_progress' | 'completed' | 'failed';
  startedAt: string;
  completedAt: string | null;
  error: string | null;
};

const POLL_INTERVAL = 30_000;

const formatTime = (timestamp: string) => {
  try {
    return new Date(timestamp).toLocaleString();
  } catch {
    return timestamp;
  }
};

export default function TodosPage() {
  const [data, setData] = useState<TodosData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'pending' | 'completed'>('all');
  const [projectFilter, setProjectFilter] = useState<string | null>(null);

  // Add form state
  const [newText, setNewText] = useState('');
  const [newProject, setNewProject] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const addInputRef = useRef<HTMLInputElement>(null);

  // Edit state
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editText, setEditText] = useState('');
  const [editProject, setEditProject] = useState('');
  const editInputRef = useRef<HTMLInputElement>(null);

  // Busy state for optimistic updates
  const [busy, setBusy] = useState(false);

  // Assignment state
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [assigningIndex, setAssigningIndex] = useState<number | null>(null);

  const fetchAssignments = useCallback(async () => {
    try {
      const response = await fetch('/api/assign');
      if (response.ok) {
        const result = await response.json();
        setAssignments(result.assignments || []);
      }
    } catch {
      // Assignments are optional
    }
  }, []);

  const handleAssign = async (todoIndex: number) => {
    setAssigningIndex(todoIndex);
    try {
      const res = await fetch('/api/assign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ todoIndex: todoIndex + 1 }), // assign-todo.js uses 1-based
      });
      const result = await res.json();
      if (res.ok) {
        await fetchAssignments();
      } else {
        console.error('Assign failed:', result.error);
      }
    } catch (err) {
      console.error('Assign failed:', err);
    } finally {
      setAssigningIndex(null);
    }
  };

  const getAssignment = (index: number): Assignment | undefined => {
    // assign-todo.js uses 1-based indexing
    return assignments.find(a => a.todoIndex === index + 1 && a.status === 'in_progress');
  };

  const fetchTodos = useCallback(async () => {
    try {
      const response = await fetch('/api/todos');
      if (!response.ok) throw new Error('Failed to fetch todos');
      const result: TodosData = await response.json();
      setData(result);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTodos();
    fetchAssignments();
    const interval = setInterval(() => { fetchTodos(); fetchAssignments(); }, POLL_INTERVAL);
    const handleVisibility = () => { if (!document.hidden) { fetchTodos(); fetchAssignments(); } };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [fetchTodos, fetchAssignments]);

  useEffect(() => {
    if (showAddForm && addInputRef.current) addInputRef.current.focus();
  }, [showAddForm]);

  useEffect(() => {
    if (editingIndex !== null && editInputRef.current) editInputRef.current.focus();
  }, [editingIndex]);

  const handleToggle = async (index: number, currentCompleted: boolean) => {
    setBusy(true);
    try {
      const res = await fetch('/api/todos', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ index, completed: !currentCompleted }),
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

  const handleAdd = async () => {
    if (!newText.trim()) return;
    setBusy(true);
    try {
      const res = await fetch('/api/todos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: newText.trim(), project: newProject.trim() || undefined }),
      });
      if (res.ok) {
        const { items } = await res.json();
        setData((prev) => prev ? { ...prev, items } : prev);
        setNewText('');
        setNewProject('');
        setShowAddForm(false);
      }
    } catch (err) {
      console.error('Add failed:', err);
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (index: number) => {
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

  const handleEditStart = (index: number, item: TodoItem) => {
    setEditingIndex(index);
    setEditText(item.text);
    setEditProject(item.project || '');
  };

  const handleEditSave = async () => {
    if (editingIndex === null || !editText.trim()) return;
    setBusy(true);
    try {
      const res = await fetch('/api/todos', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          index: editingIndex,
          text: editText.trim(),
          project: editProject.trim() || null,
        }),
      });
      if (res.ok) {
        const { items } = await res.json();
        setData((prev) => prev ? { ...prev, items } : prev);
        setEditingIndex(null);
      }
    } catch (err) {
      console.error('Edit failed:', err);
    } finally {
      setBusy(false);
    }
  };

  const handleEditCancel = () => {
    setEditingIndex(null);
    setEditText('');
    setEditProject('');
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4" />
          <p className="text-muted-foreground">Loading captures...</p>
        </div>
      </div>
    );
  }

  const allItems = data?.items ?? [];

  // Get unique projects for filter
  const projects = [...new Set(allItems.filter((i) => i.project).map((i) => i.project!))];

  // Apply filters
  let filtered = allItems.map((item, i) => ({ ...item, originalIndex: i }));
  if (filter === 'pending') filtered = filtered.filter((i) => !i.completed);
  if (filter === 'completed') filtered = filtered.filter((i) => i.completed);
  if (projectFilter === '__personal') filtered = filtered.filter((i) => !i.project);
  else if (projectFilter) filtered = filtered.filter((i) => i.project === projectFilter);

  const pendingCount = allItems.filter((i) => !i.completed).length;
  const completedCount = allItems.filter((i) => i.completed).length;

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <div className="glass-panel fade-up ui-panel ui-topbar relative z-[180] px-3.5 py-3 border-b">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/" className="hover:opacity-70 transition">
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <h1 className="console-title type-page-title">Captures & TODOs</h1>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-xs text-muted-foreground">
              {pendingCount} pending / {completedCount} done
            </div>
            <div className="text-xs text-muted-foreground">
              Updated: {data?.lastUpdated ? formatTime(data.lastUpdated) : 'never'}
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-4xl mx-auto space-y-4">
          {error && (
            <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-4">
              <p className="text-destructive">Error: {error}</p>
            </div>
          )}

          {/* Toolbar */}
          <div className="flex items-center justify-between gap-3 flex-wrap">
            {/* Status filter */}
            <div className="flex items-center gap-1">
              <div className="ui-segment grid-cols-3" style={{ display: 'inline-grid' }}>
                {(['all', 'pending', 'completed'] as const).map((f) => (
                  <button
                    key={f}
                    type="button"
                    className="ui-segment-item px-3 py-1.5 text-[12px] font-medium capitalize"
                    data-active={filter === f ? 'true' : 'false'}
                    onClick={() => setFilter(f)}
                  >
                    {f} {f === 'pending' ? `(${pendingCount})` : f === 'completed' ? `(${completedCount})` : `(${allItems.length})`}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-2">
              {/* Project filter */}
              {projects.length > 0 && (
                <select
                  className="ui-input rounded-md px-2 py-1.5 text-xs"
                  value={projectFilter || ''}
                  onChange={(e) => setProjectFilter(e.target.value || null)}
                >
                  <option value="">All projects</option>
                  <option value="__personal">Personal (no project)</option>
                  {projects.map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              )}

              {/* Add button */}
              <button
                type="button"
                className="ui-btn-primary px-3 py-1.5 text-xs font-medium flex items-center gap-1.5"
                onClick={() => setShowAddForm((v) => !v)}
              >
                <Plus className="w-3.5 h-3.5" />
                Add Item
              </button>
            </div>
          </div>

          {/* Add form */}
          {showAddForm && (
            <div className="ui-panel p-4 space-y-3">
              <div className="flex gap-2">
                <input
                  ref={addInputRef}
                  type="text"
                  className="ui-input flex-1 rounded-md px-3 py-2 text-sm"
                  placeholder="What needs to be done?"
                  value={newText}
                  onChange={(e) => setNewText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleAdd();
                    if (e.key === 'Escape') setShowAddForm(false);
                  }}
                />
                <div className="flex items-center gap-1">
                  <Tag className="w-3.5 h-3.5 text-muted-foreground" />
                  <input
                    type="text"
                    className="ui-input w-36 rounded-md px-2 py-2 text-sm"
                    placeholder="Project (optional)"
                    value={newProject}
                    onChange={(e) => setNewProject(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleAdd();
                      if (e.key === 'Escape') setShowAddForm(false);
                    }}
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="ui-btn-primary px-4 py-1.5 text-xs font-medium"
                  onClick={handleAdd}
                  disabled={busy || !newText.trim()}
                >
                  Add
                </button>
                <button
                  type="button"
                  className="ui-btn-secondary px-4 py-1.5 text-xs font-medium"
                  onClick={() => { setShowAddForm(false); setNewText(''); setNewProject(''); }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Items list */}
          {filtered.length === 0 ? (
            <div className="ui-panel p-8 text-center text-muted-foreground text-sm">
              {allItems.length === 0
                ? 'No captures yet. Add one above or send via Telegram.'
                : 'No items match the current filter.'}
            </div>
          ) : (
            <div className="space-y-1.5">
              {filtered.map((item) => {
                const idx = item.originalIndex;
                const isEditing = editingIndex === idx;

                return (
                  <div
                    key={idx}
                    className={`ui-panel flex items-start gap-3 px-4 py-3 group transition-opacity ${
                      item.completed ? 'opacity-50' : ''
                    } ${busy ? 'pointer-events-none' : ''}`}
                  >
                    {/* Checkbox */}
                    <button
                      type="button"
                      className={`mt-0.5 flex-shrink-0 h-5 w-5 rounded border-2 flex items-center justify-center transition-colors ${
                        item.completed
                          ? 'bg-primary/20 border-primary/40 text-primary'
                          : 'border-border hover:border-primary/50'
                      }`}
                      onClick={() => handleToggle(idx, item.completed)}
                    >
                      {item.completed && <Check className="w-3 h-3" />}
                    </button>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      {isEditing ? (
                        <div className="space-y-2">
                          <input
                            ref={editInputRef}
                            type="text"
                            className="ui-input w-full rounded-md px-2 py-1.5 text-sm"
                            value={editText}
                            onChange={(e) => setEditText(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleEditSave();
                              if (e.key === 'Escape') handleEditCancel();
                            }}
                          />
                          <div className="flex items-center gap-2">
                            <Tag className="w-3 h-3 text-muted-foreground" />
                            <input
                              type="text"
                              className="ui-input w-32 rounded-md px-2 py-1 text-xs"
                              placeholder="Project"
                              value={editProject}
                              onChange={(e) => setEditProject(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleEditSave();
                                if (e.key === 'Escape') handleEditCancel();
                              }}
                            />
                            <button
                              type="button"
                              className="ui-btn-primary px-2 py-1 text-[10px]"
                              onClick={handleEditSave}
                            >
                              Save
                            </button>
                            <button
                              type="button"
                              className="ui-btn-secondary px-2 py-1 text-[10px]"
                              onClick={handleEditCancel}
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div>
                          <p className={`text-sm ${item.completed ? 'line-through text-muted-foreground' : ''}`}>
                            {item.text}
                          </p>
                          {item.project && (
                            <button
                              type="button"
                              className="inline-flex rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary mt-1 hover:bg-primary/20 transition"
                              onClick={() => setProjectFilter(item.project!)}
                            >
                              {item.project}
                            </button>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Actions */}
                    {!isEditing && (
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        {/* Assign button — only for pending items with a project tag */}
                        {item.project && !item.completed && !getAssignment(idx) && (
                          <button
                            type="button"
                            className="ui-btn-icon h-7 w-7 !bg-transparent hover:!bg-primary/10 text-muted-foreground hover:!text-primary"
                            onClick={() => handleAssign(idx)}
                            disabled={assigningIndex === idx}
                            title="Assign to Claude Code"
                          >
                            {assigningIndex === idx ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Zap className="w-3.5 h-3.5" />
                            )}
                          </button>
                        )}
                        {/* Assignment in-progress indicator */}
                        {getAssignment(idx) && (
                          <span className="inline-flex items-center gap-1 rounded-md bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                            <Loader2 className="w-3 h-3 animate-spin" />
                            Assigned
                          </span>
                        )}
                        <button
                          type="button"
                          className="ui-btn-icon h-7 w-7 !bg-transparent hover:!bg-muted"
                          onClick={() => handleEditStart(idx, item)}
                          title="Edit"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          className="ui-btn-icon h-7 w-7 !bg-transparent hover:!bg-destructive/10 text-muted-foreground hover:!text-destructive"
                          onClick={() => handleDelete(idx)}
                          title="Delete"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
