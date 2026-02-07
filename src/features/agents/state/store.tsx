"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useReducer,
  type ReactNode,
} from "react";

export type AgentStatus = "idle" | "running" | "error";
export type FocusFilter = "all" | "needs-attention" | "running" | "idle";
export type AgentAttention = "normal" | "needs-attention";

export type AgentStoreSeed = {
  agentId: string;
  name: string;
  sessionKey: string;
  avatarSeed?: string | null;
  avatarUrl?: string | null;
  model?: string | null;
  thinkingLevel?: string | null;
  toolCallingEnabled?: boolean;
  showThinkingTraces?: boolean;
};

export type AgentState = AgentStoreSeed & {
  status: AgentStatus;
  sessionCreated: boolean;
  awaitingUserInput: boolean;
  hasUnseenActivity: boolean;
  outputLines: string[];
  lastResult: string | null;
  lastDiff: string | null;
  runId: string | null;
  streamText: string | null;
  thinkingTrace: string | null;
  latestOverride: string | null;
  latestOverrideKind: "heartbeat" | "cron" | null;
  lastAssistantMessageAt: number | null;
  lastActivityAt: number | null;
  latestPreview: string | null;
  lastUserMessage: string | null;
  draft: string;
  sessionSettingsSynced: boolean;
  historyLoadedAt: number | null;
  toolCallingEnabled: boolean;
  showThinkingTraces: boolean;
};

export const buildNewSessionAgentPatch = (agent: AgentState): Partial<AgentState> => {
  return {
    sessionKey: agent.sessionKey,
    status: "idle",
    runId: null,
    streamText: null,
    thinkingTrace: null,
    outputLines: [],
    lastResult: null,
    lastDiff: null,
    latestOverride: null,
    latestOverrideKind: null,
    lastAssistantMessageAt: null,
    lastActivityAt: null,
    latestPreview: null,
    lastUserMessage: null,
    draft: "",
    historyLoadedAt: null,
    awaitingUserInput: false,
    hasUnseenActivity: false,
    sessionCreated: true,
    sessionSettingsSynced: true,
  };
};

export type AgentStoreState = {
  agents: AgentState[];
  selectedAgentId: string | null;
  loading: boolean;
  error: string | null;
};

type Action =
  | { type: "hydrateAgents"; agents: AgentStoreSeed[] }
  | { type: "setError"; error: string | null }
  | { type: "setLoading"; loading: boolean }
  | { type: "updateAgent"; agentId: string; patch: Partial<AgentState> }
  | { type: "appendOutput"; agentId: string; line: string }
  | { type: "setStream"; agentId: string; value: string | null }
  | { type: "markActivity"; agentId: string; at?: number }
  | { type: "selectAgent"; agentId: string | null };

const initialState: AgentStoreState = {
  agents: [],
  selectedAgentId: null,
  loading: false,
  error: null,
};

const createRuntimeAgentState = (
  seed: AgentStoreSeed,
  existing?: AgentState | null
): AgentState => {
  const sameSessionKey = existing?.sessionKey === seed.sessionKey;
  return {
    ...seed,
    avatarSeed: seed.avatarSeed ?? existing?.avatarSeed ?? seed.agentId,
    avatarUrl: seed.avatarUrl ?? existing?.avatarUrl ?? null,
    model: seed.model ?? existing?.model ?? null,
    thinkingLevel: seed.thinkingLevel ?? existing?.thinkingLevel ?? "high",
    status: sameSessionKey ? (existing?.status ?? "idle") : "idle",
    sessionCreated: sameSessionKey ? (existing?.sessionCreated ?? false) : false,
    awaitingUserInput: sameSessionKey ? (existing?.awaitingUserInput ?? false) : false,
    hasUnseenActivity: sameSessionKey ? (existing?.hasUnseenActivity ?? false) : false,
    outputLines: sameSessionKey ? (existing?.outputLines ?? []) : [],
    lastResult: sameSessionKey ? (existing?.lastResult ?? null) : null,
    lastDiff: sameSessionKey ? (existing?.lastDiff ?? null) : null,
    runId: sameSessionKey ? (existing?.runId ?? null) : null,
    streamText: sameSessionKey ? (existing?.streamText ?? null) : null,
    thinkingTrace: sameSessionKey ? (existing?.thinkingTrace ?? null) : null,
    latestOverride: sameSessionKey ? (existing?.latestOverride ?? null) : null,
    latestOverrideKind: sameSessionKey ? (existing?.latestOverrideKind ?? null) : null,
    lastAssistantMessageAt: sameSessionKey ? (existing?.lastAssistantMessageAt ?? null) : null,
    lastActivityAt: sameSessionKey ? (existing?.lastActivityAt ?? null) : null,
    latestPreview: sameSessionKey ? (existing?.latestPreview ?? null) : null,
    lastUserMessage: sameSessionKey ? (existing?.lastUserMessage ?? null) : null,
    draft: sameSessionKey ? (existing?.draft ?? "") : "",
    sessionSettingsSynced: sameSessionKey ? (existing?.sessionSettingsSynced ?? false) : false,
    historyLoadedAt: sameSessionKey ? (existing?.historyLoadedAt ?? null) : null,
    toolCallingEnabled: seed.toolCallingEnabled ?? existing?.toolCallingEnabled ?? false,
    showThinkingTraces: seed.showThinkingTraces ?? existing?.showThinkingTraces ?? true,
  };
};

const reducer = (state: AgentStoreState, action: Action): AgentStoreState => {
  switch (action.type) {
    case "hydrateAgents": {
      const byId = new Map(state.agents.map((agent) => [agent.agentId, agent]));
      const agents = action.agents.map((seed) =>
        createRuntimeAgentState(seed, byId.get(seed.agentId))
      );
      const selectedAgentId =
        state.selectedAgentId && agents.some((agent) => agent.agentId === state.selectedAgentId)
          ? state.selectedAgentId
          : agents[0]?.agentId ?? null;
      return {
        ...state,
        agents,
        selectedAgentId,
        loading: false,
        error: null,
      };
    }
    case "setError":
      return { ...state, error: action.error, loading: false };
    case "setLoading":
      return { ...state, loading: action.loading };
    case "updateAgent":
      return {
        ...state,
        agents: state.agents.map((agent) =>
          agent.agentId === action.agentId
            ? { ...agent, ...action.patch }
            : agent
        ),
      };
    case "appendOutput":
      return {
        ...state,
        agents: state.agents.map((agent) =>
          agent.agentId === action.agentId
            ? { ...agent, outputLines: [...agent.outputLines, action.line] }
            : agent
        ),
      };
    case "setStream":
      return {
        ...state,
        agents: state.agents.map((agent) =>
          agent.agentId === action.agentId
            ? { ...agent, streamText: action.value }
            : agent
        ),
      };
    case "markActivity": {
      const at = action.at ?? Date.now();
      return {
        ...state,
        agents: state.agents.map((agent) => {
          if (agent.agentId !== action.agentId) return agent;
          const isSelected = state.selectedAgentId === action.agentId;
          return {
            ...agent,
            lastActivityAt: at,
            hasUnseenActivity: isSelected ? false : true,
          };
        }),
      };
    }
    case "selectAgent":
      return {
        ...state,
        selectedAgentId: action.agentId,
        agents:
          action.agentId === null
            ? state.agents
            : state.agents.map((agent) =>
                agent.agentId === action.agentId
                  ? { ...agent, hasUnseenActivity: false }
                  : agent
              ),
      };
    default:
      return state;
  }
};

export const agentStoreReducer = reducer;
export const initialAgentStoreState = initialState;

type AgentStoreContextValue = {
  state: AgentStoreState;
  dispatch: React.Dispatch<Action>;
  hydrateAgents: (agents: AgentStoreSeed[]) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
};

const AgentStoreContext = createContext<AgentStoreContextValue | null>(null);

export const AgentStoreProvider = ({ children }: { children: ReactNode }) => {
  const [state, dispatch] = useReducer(reducer, initialState);

  const hydrateAgents = useCallback(
    (agents: AgentStoreSeed[]) => {
      dispatch({ type: "hydrateAgents", agents });
    },
    [dispatch]
  );

  const setLoading = useCallback(
    (loading: boolean) => dispatch({ type: "setLoading", loading }),
    [dispatch]
  );

  const setError = useCallback(
    (error: string | null) => dispatch({ type: "setError", error }),
    [dispatch]
  );

  const value = useMemo(
    () => ({ state, dispatch, hydrateAgents, setLoading, setError }),
    [dispatch, hydrateAgents, setError, setLoading, state]
  );

  return (
    <AgentStoreContext.Provider value={value}>{children}</AgentStoreContext.Provider>
  );
};

export const useAgentStore = () => {
  const ctx = useContext(AgentStoreContext);
  if (!ctx) {
    throw new Error("AgentStoreProvider is missing.");
  }
  return ctx;
};

export const getSelectedAgent = (state: AgentStoreState): AgentState | null => {
  if (!state.selectedAgentId) return null;
  return state.agents.find((agent) => agent.agentId === state.selectedAgentId) ?? null;
};

export const getAttentionForAgent = (
  agent: AgentState,
  selectedAgentId: string | null
): AgentAttention => {
  if (agent.status === "error") return "needs-attention";
  if (agent.awaitingUserInput) return "needs-attention";
  if (selectedAgentId !== agent.agentId && agent.hasUnseenActivity) {
    return "needs-attention";
  }
  return "normal";
};

export const getFilteredAgents = (state: AgentStoreState, filter: FocusFilter): AgentState[] => {
  const byMostRecentAssistant = (agents: AgentState[]) =>
    [...agents].sort((a, b) => {
      const aTs = a.lastAssistantMessageAt ?? 0;
      const bTs = b.lastAssistantMessageAt ?? 0;
      if (aTs !== bTs) return bTs - aTs;
      return 0;
    });
  if (filter === "all") return byMostRecentAssistant(state.agents);
  if (filter === "running") {
    return byMostRecentAssistant(state.agents.filter((agent) => agent.status === "running"));
  }
  if (filter === "idle") {
    return byMostRecentAssistant(state.agents.filter((agent) => agent.status === "idle"));
  }
  return byMostRecentAssistant(
    state.agents.filter(
      (agent) => getAttentionForAgent(agent, state.selectedAgentId) === "needs-attention"
    )
  );
};
