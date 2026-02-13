import type { AgentState, FocusFilter } from "@/features/agents/state/store";
import { useLayoutEffect, useMemo, useRef } from "react";
import { AgentAvatar } from "./AgentAvatar";
import { EmptyStatePanel } from "./EmptyStatePanel";

type FleetSidebarProps = {
  agents: AgentState[];
  selectedAgentId: string | null;
  filter: FocusFilter;
  onFilterChange: (next: FocusFilter) => void;
  onSelectAgent: (agentId: string) => void;
  onCreateAgent: () => void;
  createDisabled?: boolean;
  createBusy?: boolean;
};

const FILTER_OPTIONS: Array<{ value: FocusFilter; label: string; testId: string }> = [
  { value: "all", label: "All", testId: "fleet-filter-all" },
  { value: "running", label: "Running", testId: "fleet-filter-running" },
  { value: "idle", label: "Idle", testId: "fleet-filter-idle" },
];

const statusLabel: Record<AgentState["status"], string> = {
  idle: "Idle",
  running: "Running",
  error: "Error",
};

const statusClassName: Record<AgentState["status"], string> = {
  idle: "border border-border/70 bg-muted text-muted-foreground",
  running: "border border-primary/30 bg-primary/15 text-foreground",
  error: "border border-destructive/35 bg-destructive/12 text-destructive",
};

export const FleetSidebar = ({
  agents,
  selectedAgentId,
  filter,
  onFilterChange,
  onSelectAgent,
  onCreateAgent,
  createDisabled = false,
  createBusy = false,
}: FleetSidebarProps) => {
  const rowRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const previousTopByAgentIdRef = useRef<Map<string, number>>(new Map());
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);

  const agentOrderKey = useMemo(() => agents.map((agent) => agent.agentId).join("|"), [agents]);

  useLayoutEffect(() => {
    const scroller = scrollContainerRef.current;
    if (!scroller) return;
    const scrollerRect = scroller.getBoundingClientRect();

    const getTopInScrollContent = (node: HTMLElement) =>
      node.getBoundingClientRect().top - scrollerRect.top + scroller.scrollTop;

    const nextTopByAgentId = new Map<string, number>();
    const agentIds = agentOrderKey.length === 0 ? [] : agentOrderKey.split("|");
    for (const agentId of agentIds) {
      const node = rowRefs.current.get(agentId);
      if (!node) continue;
      const nextTop = getTopInScrollContent(node);
      nextTopByAgentId.set(agentId, nextTop);
      const previousTop = previousTopByAgentIdRef.current.get(agentId);
      if (typeof previousTop !== "number") continue;
      const deltaY = previousTop - nextTop;
      if (Math.abs(deltaY) < 0.5) continue;
      if (typeof node.animate !== "function") continue;
      node.animate(
        [{ transform: `translateY(${deltaY}px)` }, { transform: "translateY(0px)" }],
        { duration: 300, easing: "cubic-bezier(0.22, 1, 0.36, 1)" }
      );
    }
    previousTopByAgentIdRef.current = nextTopByAgentId;
  }, [agentOrderKey]);

  return (
    <aside
      className="glass-panel fade-up-delay relative flex h-full w-full min-w-72 flex-col gap-3 bg-sidebar p-3 xl:max-w-[320px] xl:border-r xl:border-sidebar-border"
      data-testid="fleet-sidebar"
    >
      <div className="flex items-center justify-between gap-2 px-1">
        <p className="console-title text-2xl leading-none text-foreground">Agents ({agents.length})</p>
        <button
          type="button"
          data-testid="fleet-new-agent-button"
          className="rounded-md border border-transparent bg-primary px-3 py-2 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-primary-foreground transition hover:brightness-105 disabled:cursor-not-allowed disabled:border-border disabled:bg-muted disabled:text-muted-foreground"
          onClick={onCreateAgent}
          disabled={createDisabled || createBusy}
        >
          {createBusy ? "Creating..." : "New Agent"}
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        {FILTER_OPTIONS.map((option) => {
          const active = filter === option.value;
          return (
            <button
              key={option.value}
              type="button"
              data-testid={option.testId}
              aria-pressed={active}
                className={`rounded-md border px-2 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.13em] transition ${
                active
                  ? "border-border bg-surface-2 text-foreground"
                  : "border-border/80 bg-surface-1 text-muted-foreground hover:border-border hover:bg-surface-2"
              }`}
              onClick={() => onFilterChange(option.value)}
            >
              {option.label}
            </button>
          );
        })}
      </div>

      <div ref={scrollContainerRef} className="min-h-0 flex-1 overflow-auto">
        {agents.length === 0 ? (
          <EmptyStatePanel title="No agents available." compact className="p-3 text-xs" />
        ) : (
          <div className="flex flex-col gap-2">
            {agents.map((agent) => {
              const selected = selectedAgentId === agent.agentId;
              const avatarSeed = agent.avatarSeed ?? agent.agentId;
              return (
                <button
                  key={agent.agentId}
                  ref={(node) => {
                    if (node) {
                      rowRefs.current.set(agent.agentId, node);
                      return;
                    }
                    rowRefs.current.delete(agent.agentId);
                  }}
                  type="button"
                  data-testid={`fleet-agent-row-${agent.agentId}`}
                  className={`group flex w-full items-center gap-3 rounded-md border px-3 py-2 text-left transition ${
                    selected
                      ? "border-ring/45 bg-surface-2"
                      : "border-border/70 bg-surface-1 hover:border-border hover:bg-surface-2"
                  }`}
                  onClick={() => onSelectAgent(agent.agentId)}
                >
                  <AgentAvatar
                    seed={avatarSeed}
                    name={agent.name}
                    avatarUrl={agent.avatarUrl ?? null}
                    size={28}
                    isSelected={selected}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[11px] font-semibold uppercase tracking-[0.13em] text-foreground">
                      {agent.name}
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <span
                        className={`rounded px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-[0.12em] ${statusClassName[agent.status]}`}
                      >
                        {statusLabel[agent.status]}
                      </span>
                      {agent.awaitingUserInput ? (
                        <span className="rounded border border-amber-500/35 bg-amber-500/12 px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-amber-700">
                          Needs approval
                        </span>
                      ) : null}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </aside>
  );
};
