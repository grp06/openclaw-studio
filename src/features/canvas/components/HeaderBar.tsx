import type { GatewayStatus } from "@/lib/gateway/GatewayClient";

type HeaderBarProps = {
  projects: Array<{ id: string; name: string }>;
  activeProjectId: string | null;
  status: GatewayStatus;
  onProjectChange: (projectId: string) => void;
  onCreateProject: () => void;
  onOpenProject: () => void;
  onDeleteProject: () => void;
  onNewAgent: () => void;
  onCreateDiscordChannel: () => void;
  canCreateDiscordChannel: boolean;
};

const statusStyles: Record<GatewayStatus, string> = {
  disconnected: "bg-slate-200 text-slate-700",
  connecting: "bg-amber-200 text-amber-900",
  connected: "bg-blue-200 text-blue-900",
};

export const HeaderBar = ({
  projects,
  activeProjectId,
  status,
  onProjectChange,
  onCreateProject,
  onOpenProject,
  onDeleteProject,
  onNewAgent,
  onCreateDiscordChannel,
  canCreateDiscordChannel,
}: HeaderBarProps) => {
  const hasProjects = projects.length > 0;

  return (
    <div className="glass-panel flex flex-col gap-3 px-6 py-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto">
          {hasProjects ? (
            projects.map((project) => {
              const isActive = project.id === activeProjectId;
              return (
                <button
                  key={project.id}
                  className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                    isActive
                      ? "bg-slate-900 text-white"
                      : "border border-slate-300 bg-white/80 text-slate-700 hover:border-slate-400"
                  }`}
                  type="button"
                  onClick={() => onProjectChange(project.id)}
                >
                  {project.name}
                </button>
              );
            })
          ) : (
            <span className="text-sm font-semibold text-slate-500">No workspaces</span>
          )}
        </div>
        <span
          className={`rounded-full px-3 py-2 text-xs font-semibold uppercase ${statusStyles[status]}`}
        >
          {status}
        </span>
        <button
          className="rounded-full border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700"
          type="button"
          onClick={onCreateProject}
        >
          New Workspace
        </button>
        <button
          className="rounded-full border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700"
          type="button"
          onClick={onOpenProject}
        >
          Open Workspace
        </button>
        <button
          className="rounded-full border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700"
          type="button"
          onClick={onDeleteProject}
          disabled={!activeProjectId}
        >
          Delete Workspace
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {activeProjectId ? (
          <button
            className="rounded-full bg-[var(--accent-strong)] px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110"
            type="button"
            onClick={onNewAgent}
          >
            New Agent
          </button>
        ) : null}
        {canCreateDiscordChannel ? (
          <button
            className="rounded-full border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700"
            type="button"
            onClick={onCreateDiscordChannel}
          >
            Create Discord Channel
          </button>
        ) : null}
      </div>
    </div>
  );
};
