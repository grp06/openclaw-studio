"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from "react";

import type { Project, ProjectTile, ProjectsStore } from "@/lib/projects/types";
import { CANVAS_BASE_ZOOM } from "@/lib/canvasDefaults";
import { MAX_TILE_HEIGHT, MIN_TILE_SIZE } from "@/lib/canvasTileDefaults";
import {
  createProjectTile as apiCreateProjectTile,
  createProject as apiCreateProject,
  deleteProjectTile as apiDeleteProjectTile,
  deleteProject as apiDeleteProject,
  fetchProjectsStore,
  openProject as apiOpenProject,
  renameProjectTile as apiRenameProjectTile,
  updateProjectTile as apiUpdateProjectTile,
  saveProjectsStore,
} from "@/lib/projects/client";

export type AgentStatus = "idle" | "running" | "error";

export type TilePosition = { x: number; y: number };
export type TileSize = { width: number; height: number };

export type AgentTile = ProjectTile & {
  status: AgentStatus;
  outputLines: string[];
  lastResult: string | null;
  lastDiff: string | null;
  runId: string | null;
  streamText: string | null;
  thinkingTrace: string | null;
  draft: string;
  sessionSettingsSynced: boolean;
};

export type ProjectRuntime = Omit<Project, "tiles"> & {
  tiles: AgentTile[];
};

export type CanvasTransform = {
  zoom: number;
  offsetX: number;
  offsetY: number;
};

export type CanvasState = {
  projects: ProjectRuntime[];
  activeProjectId: string | null;
  selectedTileId: string | null;
  canvas: CanvasTransform;
  loading: boolean;
  error: string | null;
};

type Action =
  | { type: "loadStore"; store: ProjectsStore }
  | { type: "setError"; error: string | null }
  | { type: "setActiveProject"; projectId: string | null }
  | { type: "addProject"; project: ProjectRuntime }
  | { type: "removeProject"; projectId: string }
  | { type: "updateProject"; projectId: string; patch: Partial<ProjectRuntime> }
  | { type: "addTile"; projectId: string; tile: AgentTile }
  | { type: "removeTile"; projectId: string; tileId: string }
  | { type: "updateTile"; projectId: string; tileId: string; patch: Partial<AgentTile> }
  | { type: "appendOutput"; projectId: string; tileId: string; line: string }
  | { type: "setStream"; projectId: string; tileId: string; value: string | null }
  | { type: "selectTile"; tileId: string | null }
  | { type: "setCanvas"; patch: Partial<CanvasTransform> };

const initialState: CanvasState = {
  projects: [],
  activeProjectId: null,
  selectedTileId: null,
  canvas: { zoom: CANVAS_BASE_ZOOM, offsetX: 0, offsetY: 0 },
  loading: true,
  error: null,
};

const buildSessionKey = (agentId: string) => `agent:${agentId}:main`;

const clampTileHeight = (height: number) =>
  Math.min(MAX_TILE_HEIGHT, Math.max(MIN_TILE_SIZE.height, height));

const clampTileWidth = (width: number) =>
  Math.max(MIN_TILE_SIZE.width, width);

const clampTileSize = (size: TileSize): TileSize => ({
  width: clampTileWidth(size.width),
  height: clampTileHeight(size.height),
});

const createRuntimeTile = (tile: ProjectTile): AgentTile => ({
  ...tile,
  size: clampTileSize(tile.size),
  sessionKey: tile.sessionKey || buildSessionKey(tile.agentId),
  model: tile.model ?? "openai-codex/gpt-5.2-codex",
  thinkingLevel: tile.thinkingLevel ?? "low",
  avatarSeed: tile.avatarSeed ?? tile.agentId,
  status: "idle",
  outputLines: [],
  lastResult: null,
  lastDiff: null,
  runId: null,
  streamText: null,
  thinkingTrace: null,
  draft: "",
  sessionSettingsSynced: false,
});

const hydrateProject = (project: Project): ProjectRuntime => ({
  ...project,
  tiles: Array.isArray(project.tiles) ? project.tiles.map(createRuntimeTile) : [],
});

const dehydrateStore = (state: CanvasState): ProjectsStore => ({
  version: 2,
  activeProjectId: state.activeProjectId,
  projects: state.projects.map((project) => ({
    id: project.id,
    name: project.name,
    repoPath: project.repoPath,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    tiles: project.tiles.map((tile) => ({
      id: tile.id,
      name: tile.name,
      agentId: tile.agentId,
      role: tile.role,
      sessionKey: tile.sessionKey,
      model: tile.model ?? null,
      thinkingLevel: tile.thinkingLevel ?? null,
      avatarSeed: tile.avatarSeed ?? null,
      position: tile.position,
      size: tile.size,
    })),
  })),
});

const updateProjectList = (
  state: CanvasState,
  updater: (projects: ProjectRuntime[]) => ProjectRuntime[]
): CanvasState => {
  return { ...state, projects: updater(state.projects) };
};

const reducer = (state: CanvasState, action: Action): CanvasState => {
  switch (action.type) {
    case "loadStore": {
      const projects = action.store.projects.map(hydrateProject);
      const activeProjectId =
        action.store.activeProjectId &&
        projects.some((project) => project.id === action.store.activeProjectId)
          ? action.store.activeProjectId
          : projects[0]?.id ?? null;
      return {
        ...state,
        projects,
        activeProjectId,
        loading: false,
        error: null,
      };
    }
    case "setError":
      return { ...state, error: action.error, loading: false };
    case "setActiveProject":
      return { ...state, activeProjectId: action.projectId, selectedTileId: null };
    case "addProject":
      return updateProjectList(state, (projects) => [...projects, action.project]);
    case "removeProject":
      return updateProjectList(state, (projects) =>
        projects.filter((project) => project.id !== action.projectId)
      );
    case "updateProject":
      return updateProjectList(state, (projects) =>
        projects.map((project) =>
          project.id === action.projectId
            ? { ...project, ...action.patch, updatedAt: Date.now() }
            : project
        )
      );
    case "addTile":
      return updateProjectList(state, (projects) =>
        projects.map((project) =>
          project.id === action.projectId
            ? {
                ...project,
                tiles: [...project.tiles, action.tile],
                updatedAt: Date.now(),
              }
            : project
        )
      );
    case "removeTile":
      return updateProjectList(state, (projects) =>
        projects.map((project) =>
          project.id === action.projectId
            ? {
                ...project,
                tiles: project.tiles.filter((tile) => tile.id !== action.tileId),
                updatedAt: Date.now(),
              }
            : project
        )
      );
    case "updateTile":
      return updateProjectList(state, (projects) =>
        projects.map((project) =>
          project.id === action.projectId
            ? {
                ...project,
                tiles: project.tiles.map((tile) =>
                  tile.id === action.tileId
                    ? {
                        ...tile,
                        ...action.patch,
                        size: action.patch.size
                          ? clampTileSize(action.patch.size)
                          : tile.size,
                      }
                    : tile
                ),
                updatedAt: Date.now(),
              }
            : project
        )
      );
    case "appendOutput":
      return updateProjectList(state, (projects) =>
        projects.map((project) =>
          project.id === action.projectId
            ? {
                ...project,
                tiles: project.tiles.map((tile) =>
                  tile.id === action.tileId
                    ? { ...tile, outputLines: [...tile.outputLines, action.line] }
                    : tile
                ),
              }
            : project
        )
      );
    case "setStream":
      return updateProjectList(state, (projects) =>
        projects.map((project) =>
          project.id === action.projectId
            ? {
                ...project,
                tiles: project.tiles.map((tile) =>
                  tile.id === action.tileId ? { ...tile, streamText: action.value } : tile
                ),
              }
            : project
        )
      );
    case "selectTile":
      return { ...state, selectedTileId: action.tileId };
    case "setCanvas":
      return { ...state, canvas: { ...state.canvas, ...action.patch } };
    default:
      return state;
  }
};

type StoreContextValue = {
  state: CanvasState;
  dispatch: React.Dispatch<Action>;
  createTile: (
    projectId: string,
    name: string,
    role: ProjectTile["role"]
  ) => Promise<{ tile: ProjectTile; warnings: string[] } | null>;
  refreshStore: () => Promise<void>;
  createProject: (name: string) => Promise<{ warnings: string[] } | null>;
  openProject: (path: string) => Promise<{ warnings: string[] } | null>;
  deleteProject: (projectId: string) => Promise<{ warnings: string[] } | null>;
  deleteTile: (
    projectId: string,
    tileId: string
  ) => Promise<{ warnings: string[] } | null>;
  renameTile: (
    projectId: string,
    tileId: string,
    name: string
  ) => Promise<{ warnings: string[] } | { error: string } | null>;
  updateTile: (
    projectId: string,
    tileId: string,
    payload: { avatarSeed?: string | null }
  ) => Promise<{ warnings: string[] } | { error: string } | null>;
};

const StoreContext = createContext<StoreContextValue | null>(null);

export const AgentCanvasProvider = ({ children }: { children: ReactNode }) => {
  const [state, dispatch] = useReducer(reducer, initialState);
  const lastSavedRef = useRef<string | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refreshStore = useCallback(async () => {
    try {
      const store = await fetchProjectsStore();
      dispatch({ type: "loadStore", store });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load workspaces.";
      dispatch({ type: "setError", error: message });
    }
  }, []);

  useEffect(() => {
    void refreshStore();
  }, [refreshStore]);

  useEffect(() => {
    if (state.loading) return;
    const payload = dehydrateStore(state);
    const serialized = JSON.stringify(payload);
    if (serialized === lastSavedRef.current) return;

    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
    }
    saveTimerRef.current = setTimeout(() => {
      void saveProjectsStore(payload).then(() => {
        lastSavedRef.current = serialized;
      });
    }, 250);
  }, [state]);

  const createTile = useCallback(
    async (projectId: string, name: string, role: ProjectTile["role"]) => {
      try {
        const result = await apiCreateProjectTile(projectId, { name, role });
        dispatch({ type: "loadStore", store: result.store });
        return { tile: result.tile, warnings: result.warnings };
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to create tile.";
        dispatch({ type: "setError", error: message });
        return null;
      }
    },
    [dispatch]
  );

  const createProject = useCallback(async (name: string) => {
    try {
      const result = await apiCreateProject({ name });
      dispatch({ type: "loadStore", store: result.store });
      return { warnings: result.warnings };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to create workspace.";
      dispatch({ type: "setError", error: message });
      return null;
    }
  }, []);

  const openProject = useCallback(async (path: string) => {
    try {
      const result = await apiOpenProject({ path });
      dispatch({ type: "loadStore", store: result.store });
      return { warnings: result.warnings };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to open workspace.";
      dispatch({ type: "setError", error: message });
      return null;
    }
  }, []);

  const deleteProject = useCallback(async (projectId: string) => {
    try {
      const result = await apiDeleteProject(projectId);
      dispatch({ type: "loadStore", store: result.store });
      return { warnings: result.warnings };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to delete workspace.";
      dispatch({ type: "setError", error: message });
      return null;
    }
  }, []);

  const deleteTile = useCallback(async (projectId: string, tileId: string) => {
    try {
      const result = await apiDeleteProjectTile(projectId, tileId);
      dispatch({ type: "loadStore", store: result.store });
      return { warnings: result.warnings };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to delete tile.";
      dispatch({ type: "setError", error: message });
      return null;
    }
  }, []);

  const renameTile = useCallback(
    async (projectId: string, tileId: string, name: string) => {
      const project = state.projects.find((item) => item.id === projectId);
      const tile = project?.tiles.find((item) => item.id === tileId);
      if (tile) {
        dispatch({ type: "updateTile", projectId, tileId, patch: { name } });
      }
      try {
        const result = await apiRenameProjectTile(projectId, tileId, { name });
        return { warnings: result.warnings };
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to rename tile.";
        if (tile) {
          dispatch({
            type: "updateTile",
            projectId,
            tileId,
            patch: { name: tile.name },
          });
        }
        dispatch({ type: "setError", error: message });
        return { error: message };
      }
    },
    [dispatch, state.projects]
  );

  const updateTile = useCallback(
    async (
      projectId: string,
      tileId: string,
      payload: { avatarSeed?: string | null }
    ) => {
      const project = state.projects.find((item) => item.id === projectId);
      const tile = project?.tiles.find((item) => item.id === tileId);
      if (tile) {
        dispatch({ type: "updateTile", projectId, tileId, patch: payload });
      }
      try {
        const result = await apiUpdateProjectTile(projectId, tileId, payload);
        return { warnings: result.warnings };
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to update tile.";
        if (tile) {
          dispatch({
            type: "updateTile",
            projectId,
            tileId,
            patch: { avatarSeed: tile.avatarSeed ?? null },
          });
        }
        dispatch({ type: "setError", error: message });
        return { error: message };
      }
    },
    [dispatch, state.projects]
  );

  const value = useMemo<StoreContextValue>(() => {
    return {
      state,
      dispatch,
      createTile,
      refreshStore,
      createProject,
      openProject,
      deleteProject,
      deleteTile,
      renameTile,
      updateTile,
    };
  }, [
    state,
    createTile,
    refreshStore,
    createProject,
    openProject,
    deleteProject,
    deleteTile,
    renameTile,
    updateTile,
  ]);

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
};

export const useAgentCanvasStore = () => {
  const ctx = useContext(StoreContext);
  if (!ctx) {
    throw new Error("AgentCanvasProvider is missing.");
  }
  return ctx;
};

export const getActiveProject = (state: CanvasState): ProjectRuntime | null => {
  return state.projects.find((project) => project.id === state.activeProjectId) ?? null;
};
