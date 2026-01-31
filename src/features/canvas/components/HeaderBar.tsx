import type { GatewayStatus } from "@/lib/gateway/GatewayClient";
import { ThemeToggle } from "@/components/theme-toggle";

type HeaderBarProps = {
  projects: Array<{ id: string; name: string; archivedAt: number | null }>;
  activeProjectId: string | null;
  status: GatewayStatus;
  onProjectChange: (projectId: string) => void;
  onCreateProject: () => void;
  onOpenProject: () => void;
  onDeleteProject: () => void;
  showArchived: boolean;
  onToggleArchived: () => void;
  activeProjectArchived: boolean;
  onNewAgent: () => void;
  onCreateDiscordChannel: () => void;
  canCreateDiscordChannel: boolean;
  onCleanupArchived: () => void;
  canCleanupArchived: boolean;
};

const statusDotStyles: Record<GatewayStatus, string> = {
  disconnected: "bg-muted",
  connecting: "bg-secondary",
  connected: "bg-primary",
};

const statusLabel: Record<GatewayStatus, string> = {
  disconnected: "Disconnected",
  connecting: "Connecting",
  connected: "Connected",
};

export const HeaderBar = ({
  projects,
  activeProjectId,
  status,
  onProjectChange,
  onCreateProject,
  onOpenProject,
  onDeleteProject,
  showArchived,
  onToggleArchived,
  activeProjectArchived,
  onNewAgent,
  onCreateDiscordChannel,
  canCreateDiscordChannel,
  onCleanupArchived,
  canCleanupArchived,
}: HeaderBarProps) => {
  const hasProjects = projects.length > 0;
  return (
    <div className="glass-panel px-6 py-4">
      <div className="grid items-center gap-4 lg:grid-cols-[minmax(0,1fr)_auto]">
        <div className="flex min-w-0 items-center gap-3">
          {hasProjects ? (
            <div className="relative">
              <select
                className="h-11 min-w-[200px] max-w-[min(360px,70vw)] appearance-none rounded-lg border border-input bg-background px-4 pr-10 text-sm font-semibold text-foreground shadow-sm outline-none transition focus:border-ring"
                onChange={(event) => onProjectChange(event.target.value)}
                value={activeProjectId ?? ""}
                aria-label="Workspace"
              >
                {!activeProjectId ? (
                  <option value="" disabled>
                    Select workspace
                  </option>
                ) : null}
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                    {project.archivedAt ? " (Archived)" : ""}
                  </option>
                ))}
              </select>
              <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-xs font-semibold text-muted-foreground">
                v
              </span>
            </div>
          ) : (
            <span className="text-sm font-semibold text-muted-foreground">
              No workspaces
            </span>
          )}
          <label className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            <input
              className="h-4 w-4 rounded border border-input text-primary"
              type="checkbox"
              checked={showArchived}
              onChange={onToggleArchived}
            />
            Show archived
          </label>
        </div>

        <div className="flex flex-col items-end gap-2">
          <div className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-1 text-xs font-semibold uppercase text-muted-foreground">
            <span
              className={`h-2 w-2 rounded-full ${statusDotStyles[status]}`}
              aria-hidden="true"
            />
            {statusLabel[status]}
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <button
              className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
              type="button"
              onClick={onNewAgent}
              disabled={!activeProjectId || activeProjectArchived}
            >
              New Agent
            </button>
            <details className="relative">
              <summary className="flex h-10 items-center gap-2 rounded-lg border border-input bg-background px-4 text-sm font-semibold text-foreground transition hover:border-ring [&::-webkit-details-marker]:hidden">
                Workspaces
                <span className="text-xs font-semibold text-muted-foreground">v</span>
              </summary>
              <div className="absolute right-0 mt-2 w-56 rounded-lg border border-border bg-popover p-2 text-sm shadow-md">
                <button
                  className="flex w-full items-center rounded-md px-3 py-2 text-left text-sm font-semibold text-foreground transition hover:bg-muted"
                  type="button"
                  onClick={(event) => {
                    onCreateProject();
                    const details = event.currentTarget.closest(
                      "details"
                    ) as HTMLDetailsElement | null;
                    if (details) details.open = false;
                  }}
                >
                  New Workspace
                </button>
                <button
                  className="flex w-full items-center rounded-md px-3 py-2 text-left text-sm font-semibold text-foreground transition hover:bg-muted"
                  type="button"
                  onClick={(event) => {
                    onOpenProject();
                    const details = event.currentTarget.closest(
                      "details"
                    ) as HTMLDetailsElement | null;
                    if (details) details.open = false;
                  }}
                >
                  Open Workspace
                </button>
                <button
                  className="flex w-full items-center rounded-md px-3 py-2 text-left text-sm font-semibold text-foreground transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                  type="button"
                  onClick={(event) => {
                    onDeleteProject();
                    const details = event.currentTarget.closest(
                      "details"
                    ) as HTMLDetailsElement | null;
                    if (details) details.open = false;
                  }}
                  disabled={!activeProjectId}
                >
                  {activeProjectArchived ? "Restore Workspace" : "Archive Workspace"}
                </button>
                <button
                  className="mt-1 flex w-full items-center rounded-md px-3 py-2 text-left text-sm font-semibold text-foreground transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                  type="button"
                  onClick={(event) => {
                    onCleanupArchived();
                    const details = event.currentTarget.closest(
                      "details"
                    ) as HTMLDetailsElement | null;
                    if (details) details.open = false;
                  }}
                  disabled={!canCleanupArchived}
                >
                  Clean Archived Agents
                </button>
                {canCreateDiscordChannel ? (
                  <button
                    className="mt-1 flex w-full items-center rounded-md px-3 py-2 text-left text-sm font-semibold text-foreground transition hover:bg-muted"
                    type="button"
                    onClick={(event) => {
                      onCreateDiscordChannel();
                      const details = event.currentTarget.closest(
                        "details"
                      ) as HTMLDetailsElement | null;
                      if (details) details.open = false;
                    }}
                  >
                    Create Discord Channel
                  </button>
                ) : null}
              </div>
            </details>
          </div>
        </div>
      </div>
    </div>
  );
};
