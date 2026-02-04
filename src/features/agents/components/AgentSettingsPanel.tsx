"use client";

import { useEffect, useState } from "react";
import type { AgentState } from "@/features/agents/state/store";

type AgentSettingsPanelProps = {
  agent: AgentState;
  onClose: () => void;
  onRename: (value: string) => Promise<boolean>;
  onNewSession: () => Promise<void> | void;
  onDelete: () => void;
  onToolCallingToggle: (enabled: boolean) => void;
  onThinkingTracesToggle: (enabled: boolean) => void;
};

export const AgentSettingsPanel = ({
  agent,
  onClose,
  onRename,
  onNewSession,
  onDelete,
  onToolCallingToggle,
  onThinkingTracesToggle,
}: AgentSettingsPanelProps) => {
  const [nameDraft, setNameDraft] = useState(agent.name);
  const [renameSaving, setRenameSaving] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [sessionBusy, setSessionBusy] = useState(false);

  useEffect(() => {
    setNameDraft(agent.name);
    setRenameError(null);
  }, [agent.agentId, agent.name]);

  const handleRename = async () => {
    const next = nameDraft.trim();
    if (!next) {
      setRenameError("Agent name is required.");
      return;
    }
    if (next === agent.name) {
      setRenameError(null);
      return;
    }
    setRenameSaving(true);
    setRenameError(null);
    try {
      const ok = await onRename(next);
      if (!ok) {
        setRenameError("Failed to rename agent.");
        return;
      }
      setNameDraft(next);
    } finally {
      setRenameSaving(false);
    }
  };

  const handleNewSession = async () => {
    setSessionBusy(true);
    try {
      await onNewSession();
    } finally {
      setSessionBusy(false);
    }
  };

  return (
    <div
      className="agent-inspect-panel"
      data-testid="agent-settings-panel"
      style={{ position: "relative", left: "auto", top: "auto", width: "100%", height: "100%" }}
    >
      <div className="flex items-center justify-between border-b border-border/80 px-4 py-3">
        <div>
          <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Agent settings
          </div>
          <div className="console-title text-2xl leading-none text-foreground">{agent.name}</div>
        </div>
        <button
          className="rounded-md border border-border/80 bg-card/70 px-3 py-2 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground transition hover:border-border hover:bg-muted/65"
          type="button"
          data-testid="agent-settings-close"
          onClick={onClose}
        >
          Close
        </button>
      </div>

      <div className="flex flex-col gap-4 p-4">
        <section className="rounded-md border border-border/80 bg-card/70 p-4" data-testid="agent-settings-identity">
          <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Identity
          </div>
          <label className="mt-3 flex flex-col gap-2 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            <span>Agent name</span>
            <input
              aria-label="Agent name"
              className="h-10 rounded-md border border-border bg-card/75 px-3 text-xs font-semibold text-foreground outline-none"
              value={nameDraft}
              disabled={renameSaving}
              onChange={(event) => setNameDraft(event.target.value)}
            />
          </label>
          {renameError ? (
            <div className="mt-3 rounded-md border border-destructive bg-destructive px-3 py-2 text-xs text-destructive-foreground">
              {renameError}
            </div>
          ) : null}
          <div className="mt-3 flex justify-end">
            <button
              className="rounded-md border border-transparent bg-primary/90 px-4 py-2 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-primary-foreground disabled:cursor-not-allowed disabled:border-border disabled:bg-muted disabled:text-muted-foreground"
              type="button"
              onClick={() => {
                void handleRename();
              }}
              disabled={renameSaving}
            >
              {renameSaving ? "Saving..." : "Save name"}
            </button>
          </div>
        </section>

        <section className="rounded-md border border-border/80 bg-card/70 p-4" data-testid="agent-settings-display">
          <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Display
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <label className="flex items-center justify-between gap-3 rounded-md border border-border/80 bg-card/75 px-3 py-2 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              <span>Show tool calls</span>
              <input
                aria-label="Show tool calls"
                type="checkbox"
                className="h-4 w-4 rounded border-input text-foreground"
                checked={agent.toolCallingEnabled}
                onChange={(event) => onToolCallingToggle(event.target.checked)}
              />
            </label>
            <label className="flex items-center justify-between gap-3 rounded-md border border-border/80 bg-card/75 px-3 py-2 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              <span>Show thinking</span>
              <input
                aria-label="Show thinking"
                type="checkbox"
                className="h-4 w-4 rounded border-input text-foreground"
                checked={agent.showThinkingTraces}
                onChange={(event) => onThinkingTracesToggle(event.target.checked)}
              />
            </label>
          </div>
        </section>

        <section className="rounded-md border border-border/80 bg-card/70 p-4" data-testid="agent-settings-session">
          <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Session
          </div>
          <div className="mt-3 text-[11px] text-muted-foreground">
            Start this agent in a fresh session and clear the visible transcript in Studio.
          </div>
          <button
            className="mt-3 w-full rounded-md border border-border/80 bg-card/75 px-3 py-2 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-foreground transition hover:border-border hover:bg-muted/70 disabled:cursor-not-allowed disabled:opacity-70"
            type="button"
            onClick={() => {
              void handleNewSession();
            }}
            disabled={sessionBusy}
          >
            {sessionBusy ? "Starting..." : "New session"}
          </button>
        </section>

        <section className="rounded-md border border-destructive/30 bg-destructive/4 p-4">
          <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-destructive">
            Delete agent
          </div>
          <div className="mt-3 text-[11px] text-muted-foreground">
            Removes the agent from the gateway config.
          </div>
          <button
            className="mt-3 w-full rounded-md border border-destructive/50 bg-transparent px-3 py-2 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-destructive shadow-sm transition hover:bg-destructive/10"
            type="button"
            onClick={onDelete}
          >
            Delete agent
          </button>
        </section>
      </div>
    </div>
  );
};
