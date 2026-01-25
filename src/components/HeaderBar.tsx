import type { GatewayStatus } from "../lib/gateway/GatewayClient";

type HeaderBarProps = {
  projects: Array<{ id: string; name: string }>;
  activeProjectId: string | null;
  status: GatewayStatus;
  onProjectChange: (projectId: string) => void;
  onCreateProject: () => void;
  onDeleteProject: () => void;
  onNewAgent: () => void;
  onCreateDiscordChannel: () => void;
  canCreateDiscordChannel: boolean;
  onCenterCanvas: () => void;
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
};

const statusStyles: Record<GatewayStatus, string> = {
  disconnected: "bg-slate-200 text-slate-700",
  connecting: "bg-amber-200 text-amber-900",
  connected: "bg-emerald-200 text-emerald-900",
};

export const HeaderBar = ({
  projects,
  activeProjectId,
  status,
  onProjectChange,
  onCreateProject,
  onDeleteProject,
  onNewAgent,
  onCreateDiscordChannel,
  canCreateDiscordChannel,
  onCenterCanvas,
  zoom,
  onZoomIn,
  onZoomOut,
  onZoomReset,
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
            <span className="text-sm font-semibold text-slate-500">No projects</span>
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
          New Project
        </button>
        <button
          className="rounded-full border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700"
          type="button"
          onClick={onDeleteProject}
          disabled={!activeProjectId}
        >
          Delete
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {activeProjectId ? (
          <button
            className="rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[var(--accent-strong)]"
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
        <button
          className="rounded-full border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700"
          type="button"
          onClick={onCenterCanvas}
        >
          Center Canvas
        </button>
        <div className="flex items-center gap-2 rounded-full border border-slate-300 px-3 py-2">
          <button
            className="text-sm font-semibold text-slate-800"
            type="button"
            onClick={onZoomOut}
          >
            −
          </button>
          <span className="text-xs font-semibold text-slate-600">
            {Math.round(zoom * 100)}%
          </span>
          <button
            className="text-sm font-semibold text-slate-800"
            type="button"
            onClick={onZoomIn}
          >
            +
          </button>
          <button
            className="ml-2 text-xs font-semibold text-slate-500"
            type="button"
            onClick={onZoomReset}
          >
            Reset
          </button>
        </div>
      </div>
    </div>
  );
};
