"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AgentChatPanel } from "@/features/agents/components/AgentChatPanel";
import {
  AgentBrainPanel,
  AgentSettingsPanel,
} from "@/features/agents/components/AgentInspectPanels";
import { FleetSidebar } from "@/features/agents/components/FleetSidebar";
import { HeaderBar } from "@/features/agents/components/HeaderBar";
import { ConnectionPanel } from "@/features/agents/components/ConnectionPanel";
import { EmptyStatePanel } from "@/features/agents/components/EmptyStatePanel";
import {
  extractText,
  isHeartbeatPrompt,
  stripUiMetadata,
} from "@/lib/text/message-extract";
import { useGatewayConnection } from "@/lib/gateway/GatewayClient";
import { createRafBatcher } from "@/lib/dom";
import {
  buildGatewayModelChoices,
  type GatewayModelChoice,
  type GatewayModelPolicySnapshot,
  resolveConfiguredModelKey,
} from "@/lib/gateway/models";
import {
  AgentStoreProvider,
  buildNewSessionAgentPatch,
  getFilteredAgents,
  getSelectedAgent,
  type FocusFilter,
  useAgentStore,
} from "@/features/agents/state/store";
import {
  buildHistorySyncPatch,
  buildSummarySnapshotPatches,
  type SummaryPreviewSnapshot,
  type SummarySnapshotAgent,
  type SummaryStatusSnapshot,
} from "@/features/agents/state/runtimeEventBridge";
import type { AgentStoreSeed, AgentState } from "@/features/agents/state/store";
import { createGatewayRuntimeEventHandler } from "@/features/agents/state/gatewayRuntimeEventHandler";
import {
  type CronJobSummary,
  filterCronJobsForAgent,
  formatCronJobDisplay,
  listCronJobs,
  removeCronJob,
  resolveLatestCronJobForAgent,
  runCronJobNow,
} from "@/lib/cron/types";
import {
  createGatewayAgent,
  renameGatewayAgent,
  removeGatewayHeartbeatOverride,
  listHeartbeatsForAgent,
  triggerHeartbeatNow,
  type AgentHeartbeatSummary,
} from "@/lib/gateway/agentConfig";
import { buildAvatarDataUrl } from "@/lib/avatars/multiavatar";
import { createStudioSettingsCoordinator } from "@/lib/studio/coordinator";
import { resolveAgentAvatarSeed, resolveFocusedPreference } from "@/lib/studio/settings";
import { applySessionSettingMutation } from "@/features/agents/state/sessionSettingsMutations";
import {
  buildAgentMainSessionKey,
  isSameSessionKey,
  parseAgentIdFromSessionKey,
  isGatewayDisconnectLikeError,
  type EventFrame,
} from "@/lib/gateway/GatewayClient";
import { fetchJson } from "@/lib/http";
import { bootstrapAgentBrainFilesFromTemplate } from "@/lib/gateway/agentFiles";
import { deleteAgentViaStudio } from "@/features/agents/operations/deleteAgentOperation";
import { sendChatMessageViaStudio } from "@/features/agents/operations/chatSendOperation";

type ChatHistoryMessage = Record<string, unknown>;

type ChatHistoryResult = {
  sessionKey: string;
  sessionId?: string;
  messages: ChatHistoryMessage[];
  thinkingLevel?: string;
};

type AgentsListResult = {
  defaultId: string;
  mainKey: string;
  scope?: string;
  agents: Array<{
    id: string;
    name?: string;
    identity?: {
      name?: string;
      theme?: string;
      emoji?: string;
      avatar?: string;
      avatarUrl?: string;
    };
  }>;
};

type SessionsListEntry = {
  key: string;
  updatedAt?: number | null;
  displayName?: string;
  origin?: { label?: string | null; provider?: string | null } | null;
  thinkingLevel?: string;
  modelProvider?: string;
  model?: string;
};

type SessionsListResult = {
  sessions?: SessionsListEntry[];
};

type MobilePane = "fleet" | "chat" | "settings" | "brain";
type DeleteAgentBlockPhase = "queued" | "deleting" | "awaiting-restart";
type DeleteAgentBlockState = {
  agentId: string;
  agentName: string;
  phase: DeleteAgentBlockPhase;
  startedAt: number;
  sawDisconnect: boolean;
};
type CreateAgentBlockPhase = "queued" | "creating" | "awaiting-restart" | "bootstrapping-files";
type CreateAgentBlockState = {
  agentId: string | null;
  agentName: string;
  phase: CreateAgentBlockPhase;
  startedAt: number;
  sawDisconnect: boolean;
};
type RenameAgentBlockPhase = "queued" | "renaming" | "awaiting-restart";
type RenameAgentBlockState = {
  agentId: string;
  agentName: string;
  phase: RenameAgentBlockPhase;
  startedAt: number;
  sawDisconnect: boolean;
};
type ConfigMutationKind = "create-agent" | "rename-agent" | "delete-agent";
type QueuedConfigMutation = {
  id: string;
  kind: ConfigMutationKind;
  label: string;
  run: () => Promise<void>;
  resolve: () => void;
  reject: (error: unknown) => void;
};

const RESERVED_MAIN_AGENT_ID = "main";
const SPECIAL_UPDATE_HEARTBEAT_RE = /\bheartbeat\b/i;
const SPECIAL_UPDATE_CRON_RE = /\bcron\b/i;

const resolveSpecialUpdateKind = (message: string) => {
  const lowered = message.toLowerCase();
  const heartbeatIndex = lowered.search(SPECIAL_UPDATE_HEARTBEAT_RE);
  const cronIndex = lowered.search(SPECIAL_UPDATE_CRON_RE);
  if (heartbeatIndex === -1 && cronIndex === -1) return null;
  if (heartbeatIndex === -1) return "cron";
  if (cronIndex === -1) return "heartbeat";
  return cronIndex > heartbeatIndex ? "cron" : "heartbeat";
};

const sortCronJobsByUpdatedAt = (jobs: CronJobSummary[]) =>
  [...jobs].sort((a, b) => b.updatedAtMs - a.updatedAtMs);

const findLatestHeartbeatResponse = (messages: ChatHistoryMessage[]) => {
  let awaitingHeartbeatReply = false;
  let latestResponse: string | null = null;
  for (const message of messages) {
    const role = typeof message.role === "string" ? message.role : "";
    if (role === "user") {
      const text = stripUiMetadata(extractText(message) ?? "").trim();
      awaitingHeartbeatReply = isHeartbeatPrompt(text);
      continue;
    }
    if (role === "assistant" && awaitingHeartbeatReply) {
      const text = stripUiMetadata(extractText(message) ?? "").trim();
      if (text) {
        latestResponse = text;
      }
    }
  }
  return latestResponse;
};

const resolveNextNewAgentName = (agents: AgentState[]) => {
  const baseName = "New Agent";
  const existing = new Set(
    agents.map((agent) => agent.name.trim().toLowerCase()).filter((name) => name.length > 0)
  );
  const baseLower = baseName.toLowerCase();
  if (!existing.has(baseLower)) return baseName;
  for (let index = 2; index < 10000; index += 1) {
    const candidate = `${baseName} ${index}`;
    if (!existing.has(candidate.toLowerCase())) return candidate;
  }
  throw new Error("Unable to allocate a unique agent name.");
};

const AgentStudioPage = () => {
  const [settingsCoordinator] = useState(() => createStudioSettingsCoordinator());
  const {
    client,
    status,
    gatewayUrl,
    token,
    error: gatewayError,
    connect,
    disconnect,
    setGatewayUrl,
    setToken,
  } = useGatewayConnection(settingsCoordinator);

  const { state, dispatch, hydrateAgents, setError, setLoading } = useAgentStore();
  const [showConnectionPanel, setShowConnectionPanel] = useState(false);
  const [focusFilter, setFocusFilter] = useState<FocusFilter>("all");
  const [focusedPreferencesLoaded, setFocusedPreferencesLoaded] = useState(false);
  const [agentsLoadedOnce, setAgentsLoadedOnce] = useState(false);
  const [heartbeatTick, setHeartbeatTick] = useState(0);
  const historyInFlightRef = useRef<Set<string>>(new Set());
  const stateRef = useRef(state);
  const focusFilterTouchedRef = useRef(false);
  const [gatewayModels, setGatewayModels] = useState<GatewayModelChoice[]>([]);
  const [gatewayModelsError, setGatewayModelsError] = useState<string | null>(null);
  const [gatewayConfigSnapshot, setGatewayConfigSnapshot] =
    useState<GatewayModelPolicySnapshot | null>(null);
  const [createAgentBusy, setCreateAgentBusy] = useState(false);
  const [stopBusyAgentId, setStopBusyAgentId] = useState<string | null>(null);
  const [mobilePane, setMobilePane] = useState<MobilePane>("chat");
  const [settingsAgentId, setSettingsAgentId] = useState<string | null>(null);
  const [settingsCronJobs, setSettingsCronJobs] = useState<CronJobSummary[]>([]);
  const [settingsCronLoading, setSettingsCronLoading] = useState(false);
  const [settingsCronError, setSettingsCronError] = useState<string | null>(null);
  const [cronRunBusyJobId, setCronRunBusyJobId] = useState<string | null>(null);
  const [cronDeleteBusyJobId, setCronDeleteBusyJobId] = useState<string | null>(null);
  const [settingsHeartbeats, setSettingsHeartbeats] = useState<AgentHeartbeatSummary[]>([]);
  const [settingsHeartbeatLoading, setSettingsHeartbeatLoading] = useState(false);
  const [settingsHeartbeatError, setSettingsHeartbeatError] = useState<string | null>(null);
  const [heartbeatRunBusyId, setHeartbeatRunBusyId] = useState<string | null>(null);
  const [heartbeatDeleteBusyId, setHeartbeatDeleteBusyId] = useState<string | null>(null);
  const [brainPanelOpen, setBrainPanelOpen] = useState(false);
  const [deleteAgentBlock, setDeleteAgentBlock] = useState<DeleteAgentBlockState | null>(null);
  const [createAgentBlock, setCreateAgentBlock] = useState<CreateAgentBlockState | null>(null);
  const [renameAgentBlock, setRenameAgentBlock] = useState<RenameAgentBlockState | null>(null);
  const [queuedConfigMutations, setQueuedConfigMutations] = useState<QueuedConfigMutation[]>([]);
  const [activeConfigMutation, setActiveConfigMutation] = useState<QueuedConfigMutation | null>(
    null
  );
  const specialUpdateRef = useRef<Map<string, string>>(new Map());
  const specialUpdateInFlightRef = useRef<Set<string>>(new Set());
  const pendingDraftValuesRef = useRef<Map<string, string>>(new Map());
  const pendingDraftTimersRef = useRef<Map<string, number>>(new Map());
  const pendingLivePatchesRef = useRef<Map<string, Partial<AgentState>>>(new Map());
  const flushLivePatchesRef = useRef<() => void>(() => {});
  const livePatchBatcherRef = useRef(createRafBatcher(() => flushLivePatchesRef.current()));
  const runtimeEventHandlerRef = useRef<ReturnType<typeof createGatewayRuntimeEventHandler> | null>(
    null
  );

  const agents = state.agents;
  const selectedAgent = useMemo(() => getSelectedAgent(state), [state]);
  const filteredAgents = useMemo(
    () => getFilteredAgents(state, focusFilter),
    [focusFilter, state]
  );
  const focusedAgent = useMemo(() => {
    if (filteredAgents.length === 0) return null;
    const selectedInFilter = selectedAgent
      ? filteredAgents.find((entry) => entry.agentId === selectedAgent.agentId)
      : null;
    return selectedInFilter ?? filteredAgents[0] ?? null;
  }, [filteredAgents, selectedAgent]);
  const focusedAgentId = focusedAgent?.agentId ?? null;
  const focusedAgentRunning = focusedAgent?.status === "running";
  const settingsAgent = useMemo(() => {
    if (!settingsAgentId) return null;
    return agents.find((entry) => entry.agentId === settingsAgentId) ?? null;
  }, [agents, settingsAgentId]);
  const selectedBrainAgentId = useMemo(() => {
    return focusedAgent?.agentId ?? agents[0]?.agentId ?? null;
  }, [agents, focusedAgent]);
  const faviconSeed = useMemo(() => {
    const firstAgent = agents[0];
    const seed = firstAgent?.avatarSeed ?? firstAgent?.agentId ?? "";
    return seed.trim() || null;
  }, [agents]);
  const faviconHref = useMemo(
    () => (faviconSeed ? buildAvatarDataUrl(faviconSeed) : null),
    [faviconSeed]
  );
  const errorMessage = state.error ?? gatewayModelsError;
  const runningAgentCount = useMemo(
    () => agents.filter((agent) => agent.status === "running").length,
    [agents]
  );
  const hasRunningAgents = runningAgentCount > 0;
  const queuedConfigMutationCount = queuedConfigMutations.length;

  const flushPendingDraft = useCallback(
    (agentId: string | null) => {
      if (!agentId) return;
      const timer = pendingDraftTimersRef.current.get(agentId) ?? null;
      if (timer !== null) {
        window.clearTimeout(timer);
        pendingDraftTimersRef.current.delete(agentId);
      }
      const value = pendingDraftValuesRef.current.get(agentId);
      if (value === undefined) return;
      pendingDraftValuesRef.current.delete(agentId);
      dispatch({
        type: "updateAgent",
        agentId,
        patch: { draft: value },
      });
    },
    [dispatch]
  );

  const handleFocusFilterChange = useCallback(
    (next: FocusFilter) => {
      flushPendingDraft(focusedAgent?.agentId ?? null);
      focusFilterTouchedRef.current = true;
      setFocusFilter(next);
    },
    [flushPendingDraft, focusedAgent]
  );

  useEffect(() => {
    const timers = pendingDraftTimersRef.current;
    const values = pendingDraftValuesRef.current;
    return () => {
      for (const timer of timers.values()) {
        window.clearTimeout(timer);
      }
      timers.clear();
      values.clear();
    };
  }, []);

  useEffect(() => {
    const batcher = livePatchBatcherRef.current;
    const pending = pendingLivePatchesRef.current;
    return () => {
      batcher.cancel();
      pending.clear();
    };
  }, []);

  const flushPendingLivePatches = useCallback(() => {
    const pending = pendingLivePatchesRef.current;
    if (pending.size === 0) return;
    const entries = [...pending.entries()];
    pending.clear();
    for (const [agentId, patch] of entries) {
      dispatch({ type: "updateAgent", agentId, patch });
    }
  }, [dispatch]);

  useEffect(() => {
    flushLivePatchesRef.current = flushPendingLivePatches;
  }, [flushPendingLivePatches]);

  const queueLivePatch = useCallback((agentId: string, patch: Partial<AgentState>) => {
    const key = agentId.trim();
    if (!key) return;
    const existing = pendingLivePatchesRef.current.get(key);
    pendingLivePatchesRef.current.set(key, existing ? { ...existing, ...patch } : patch);
    livePatchBatcherRef.current.schedule();
  }, []);

  const enqueueConfigMutation = useCallback(
    (params: {
      kind: ConfigMutationKind;
      label: string;
      run: () => Promise<void>;
    }) =>
      new Promise<void>((resolve, reject) => {
        const queued: QueuedConfigMutation = {
          id: crypto.randomUUID(),
          kind: params.kind,
          label: params.label,
          run: params.run,
          resolve,
          reject,
        };
        setQueuedConfigMutations((current) => [...current, queued]);
      }),
    []
  );

  useEffect(() => {
    const selector = 'link[data-agent-favicon="true"]';
    const existing = document.querySelector(selector) as HTMLLinkElement | null;
    if (!faviconHref) {
      existing?.remove();
      return;
    }
    if (existing) {
      if (existing.href !== faviconHref) {
        existing.href = faviconHref;
      }
      return;
    }
    const link = document.createElement("link");
    link.rel = "icon";
    link.type = "image/svg+xml";
    link.href = faviconHref;
    link.setAttribute("data-agent-favicon", "true");
    document.head.appendChild(link);
  }, [faviconHref]);


  const resolveCronJobForAgent = useCallback((jobs: CronJobSummary[], agent: AgentState) => {
    return resolveLatestCronJobForAgent(jobs, agent.agentId);
  }, []);

  const loadCronJobsForSettingsAgent = useCallback(
    async (agentId: string) => {
      const resolvedAgentId = agentId.trim();
      if (!resolvedAgentId) {
        setSettingsCronJobs([]);
        setSettingsCronError("Failed to load cron jobs: missing agent id.");
        return;
      }
      setSettingsCronLoading(true);
      setSettingsCronError(null);
      try {
        const result = await listCronJobs(client, { includeDisabled: true });
        const filtered = filterCronJobsForAgent(result.jobs, resolvedAgentId);
        setSettingsCronJobs(sortCronJobsByUpdatedAt(filtered));
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to load cron jobs.";
        setSettingsCronJobs([]);
        setSettingsCronError(message);
        if (!isGatewayDisconnectLikeError(err)) {
          console.error(message);
        }
      } finally {
        setSettingsCronLoading(false);
      }
    },
    [client]
  );

  const loadHeartbeatsForSettingsAgent = useCallback(
    async (agentId: string) => {
      const resolvedAgentId = agentId.trim();
      if (!resolvedAgentId) {
        setSettingsHeartbeats([]);
        setSettingsHeartbeatError("Failed to load heartbeats: missing agent id.");
        return;
      }
      setSettingsHeartbeatLoading(true);
      setSettingsHeartbeatError(null);
      try {
        const result = await listHeartbeatsForAgent(client, resolvedAgentId);
        setSettingsHeartbeats(result.heartbeats);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to load heartbeats.";
        setSettingsHeartbeats([]);
        setSettingsHeartbeatError(message);
        if (!isGatewayDisconnectLikeError(err)) {
          console.error(message);
        }
      } finally {
        setSettingsHeartbeatLoading(false);
      }
    },
    [client]
  );

  const updateSpecialLatestUpdate = useCallback(
    async (agentId: string, agent: AgentState, message: string) => {
      const key = agentId;
      const kind = resolveSpecialUpdateKind(message);
      if (!kind) {
        if (agent.latestOverride || agent.latestOverrideKind) {
          dispatch({
            type: "updateAgent",
            agentId: agent.agentId,
            patch: { latestOverride: null, latestOverrideKind: null },
          });
        }
        return;
      }
      if (specialUpdateInFlightRef.current.has(key)) return;
      specialUpdateInFlightRef.current.add(key);
      try {
        if (kind === "heartbeat") {
          const resolvedId =
            agent.agentId?.trim() || parseAgentIdFromSessionKey(agent.sessionKey);
          if (!resolvedId) {
            dispatch({
              type: "updateAgent",
              agentId: agent.agentId,
              patch: { latestOverride: null, latestOverrideKind: null },
            });
            return;
          }
          const sessions = await client.call<SessionsListResult>("sessions.list", {
            agentId: resolvedId,
            includeGlobal: false,
            includeUnknown: false,
            limit: 48,
          });
          const entries = Array.isArray(sessions.sessions) ? sessions.sessions : [];
          const heartbeatSessions = entries.filter((entry) => {
            const label = entry.origin?.label;
            return typeof label === "string" && label.toLowerCase() === "heartbeat";
          });
          const candidates = heartbeatSessions.length > 0 ? heartbeatSessions : entries;
          const sorted = [...candidates].sort(
            (a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0)
          );
          const sessionKey = sorted[0]?.key;
          if (!sessionKey) {
            dispatch({
              type: "updateAgent",
              agentId: agent.agentId,
              patch: { latestOverride: null, latestOverrideKind: null },
            });
            return;
          }
          const history = await client.call<ChatHistoryResult>("chat.history", {
            sessionKey,
            limit: 200,
          });
          const content = findLatestHeartbeatResponse(history.messages ?? []) ?? "";
          dispatch({
            type: "updateAgent",
            agentId: agent.agentId,
            patch: {
              latestOverride: content || null,
              latestOverrideKind: content ? "heartbeat" : null,
            },
          });
          return;
        }
        const cronResult = await listCronJobs(client, { includeDisabled: true });
        const job = resolveCronJobForAgent(cronResult.jobs, agent);
        const content = job ? formatCronJobDisplay(job) : "";
        dispatch({
          type: "updateAgent",
          agentId: agent.agentId,
          patch: {
            latestOverride: content || null,
            latestOverrideKind: content ? "cron" : null,
          },
        });
      } catch (err) {
        if (!isGatewayDisconnectLikeError(err)) {
          const message =
            err instanceof Error ? err.message : "Failed to load latest cron/heartbeat update.";
          console.error(message);
        }
      } finally {
        specialUpdateInFlightRef.current.delete(key);
      }
    },
    [client, dispatch, resolveCronJobForAgent]
  );

  const refreshHeartbeatLatestUpdate = useCallback(() => {
    const agents = stateRef.current.agents;
    for (const agent of agents) {
      void updateSpecialLatestUpdate(agent.agentId, agent, "heartbeat");
    }
  }, [updateSpecialLatestUpdate]);

  const resolveAgentName = useCallback((agent: AgentsListResult["agents"][number]) => {
    const fromList = typeof agent.name === "string" ? agent.name.trim() : "";
    if (fromList) return fromList;
    const fromIdentity =
      typeof agent.identity?.name === "string" ? agent.identity.name.trim() : "";
    if (fromIdentity) return fromIdentity;
    return agent.id;
  }, []);

  const resolveAgentAvatarUrl = useCallback(
    (agent: AgentsListResult["agents"][number]) => {
      const candidate = agent.identity?.avatarUrl ?? agent.identity?.avatar ?? null;
      if (typeof candidate !== "string") return null;
      const trimmed = candidate.trim();
      if (!trimmed) return null;
      if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed;
      if (trimmed.startsWith("data:image/")) return trimmed;
      return null;
    },
    []
  );

  const resolveDefaultModelForAgent = useCallback(
    (agentId: string, snapshot: GatewayModelPolicySnapshot | null): string | null => {
      const resolvedAgentId = agentId.trim();
      if (!resolvedAgentId) return null;
      const defaults = snapshot?.config?.agents?.defaults;
      const modelAliases = defaults?.models;
      const agentEntry =
        snapshot?.config?.agents?.list?.find((entry) => entry?.id?.trim() === resolvedAgentId) ??
        null;
      const agentModel = agentEntry?.model;
      let raw: string | null = null;
      if (typeof agentModel === "string") {
        raw = agentModel;
      } else if (agentModel && typeof agentModel === "object") {
        raw = agentModel.primary ?? null;
      }
      if (!raw) {
        const defaultModel = defaults?.model;
        if (typeof defaultModel === "string") {
          raw = defaultModel;
        } else if (defaultModel && typeof defaultModel === "object") {
          raw = defaultModel.primary ?? null;
        }
      }
      if (!raw) return null;
      return resolveConfiguredModelKey(raw, modelAliases);
    },
    []
  );

  const loadAgents = useCallback(async () => {
    if (status !== "connected") return;
    setLoading(true);
    try {
      let configSnapshot = gatewayConfigSnapshot;
      if (!configSnapshot) {
        try {
          configSnapshot = await client.call<GatewayModelPolicySnapshot>("config.get", {});
          setGatewayConfigSnapshot(configSnapshot);
        } catch (err) {
          if (!isGatewayDisconnectLikeError(err)) {
            console.error("Failed to load gateway config while loading agents.", err);
          }
        }
      }
      const gatewayKey = gatewayUrl.trim();
      let settings: Awaited<ReturnType<typeof settingsCoordinator.loadSettings>> | null = null;
      if (gatewayKey) {
        try {
          settings = await settingsCoordinator.loadSettings();
        } catch (err) {
          console.error("Failed to load studio settings while loading agents.", err);
        }
      }
      const agentsResult = await client.call<AgentsListResult>("agents.list", {});
      const mainKey = agentsResult.mainKey?.trim() || "main";
      const mainSessionKeyByAgent = new Map<string, SessionsListEntry | null>();
      await Promise.all(
        agentsResult.agents.map(async (agent) => {
          try {
            const expectedMainKey = buildAgentMainSessionKey(agent.id, mainKey);
            const sessions = await client.call<SessionsListResult>("sessions.list", {
              agentId: agent.id,
              includeGlobal: false,
              includeUnknown: false,
              search: expectedMainKey,
              limit: 4,
            });
            const entries = Array.isArray(sessions.sessions) ? sessions.sessions : [];
            const mainEntry =
              entries.find((entry) => isSameSessionKey(entry.key ?? "", expectedMainKey)) ?? null;
            mainSessionKeyByAgent.set(agent.id, mainEntry);
          } catch (err) {
            if (!isGatewayDisconnectLikeError(err)) {
              console.error("Failed to list sessions while resolving agent session.", err);
            }
            mainSessionKeyByAgent.set(agent.id, null);
          }
        })
      );
      const seeds: AgentStoreSeed[] = agentsResult.agents.map((agent) => {
        const persistedSeed =
          settings && gatewayKey ? resolveAgentAvatarSeed(settings, gatewayKey, agent.id) : null;
        const avatarSeed = persistedSeed ?? agent.id;
        const avatarUrl = resolveAgentAvatarUrl(agent);
        const name = resolveAgentName(agent);
        const mainSession = mainSessionKeyByAgent.get(agent.id) ?? null;
        const modelProvider =
          typeof mainSession?.modelProvider === "string" ? mainSession.modelProvider.trim() : "";
        const modelId = typeof mainSession?.model === "string" ? mainSession.model.trim() : "";
        const model =
          modelProvider && modelId
            ? `${modelProvider}/${modelId}`
            : resolveDefaultModelForAgent(agent.id, configSnapshot);
        const thinkingLevel =
          typeof mainSession?.thinkingLevel === "string" ? mainSession.thinkingLevel : null;
        return {
          agentId: agent.id,
          name,
          sessionKey: buildAgentMainSessionKey(agent.id, mainKey),
          avatarSeed,
          avatarUrl,
          model,
          thinkingLevel,
        };
      });
      hydrateAgents(seeds);
      for (const seed of seeds) {
        const mainSession = mainSessionKeyByAgent.get(seed.agentId) ?? null;
        if (!mainSession) continue;
        dispatch({
          type: "updateAgent",
          agentId: seed.agentId,
          patch: { sessionCreated: true, sessionSettingsSynced: true },
        });
      }

      try {
        const activeAgents: SummarySnapshotAgent[] = [];
        for (const seed of seeds) {
          const mainSession = mainSessionKeyByAgent.get(seed.agentId) ?? null;
          if (!mainSession) continue;
          activeAgents.push({
            agentId: seed.agentId,
            sessionKey: seed.sessionKey,
            status: "idle",
          });
        }
        const sessionKeys = Array.from(
          new Set(
            activeAgents
              .map((agent) => agent.sessionKey)
              .filter((key): key is string => typeof key === "string" && key.trim().length > 0)
          )
        ).slice(0, 64);
        if (sessionKeys.length > 0) {
          const [statusSummary, previewResult] = await Promise.all([
            client.call<SummaryStatusSnapshot>("status", {}),
            client.call<SummaryPreviewSnapshot>("sessions.preview", {
              keys: sessionKeys,
              limit: 8,
              maxChars: 240,
            }),
          ]);
          const patches = buildSummarySnapshotPatches({
            agents: activeAgents,
            statusSummary,
            previewResult,
          });
          const assistantAtByAgentId = new Map<string, number>();
          for (const entry of patches) {
            if (typeof entry.patch.lastAssistantMessageAt === "number") {
              assistantAtByAgentId.set(entry.agentId, entry.patch.lastAssistantMessageAt);
            }
          }
          for (const entry of patches) {
            dispatch({
              type: "updateAgent",
              agentId: entry.agentId,
              patch: entry.patch,
            });
          }

          let bestAgentId: string | null = seeds[0]?.agentId ?? null;
          let bestTs = bestAgentId ? (assistantAtByAgentId.get(bestAgentId) ?? 0) : 0;
          for (const seed of seeds) {
            const ts = assistantAtByAgentId.get(seed.agentId) ?? 0;
            if (ts <= bestTs) continue;
            bestTs = ts;
            bestAgentId = seed.agentId;
          }
          if (bestAgentId) {
            dispatch({ type: "selectAgent", agentId: bestAgentId });
          }
        }
      } catch (err) {
        if (!isGatewayDisconnectLikeError(err)) {
          console.error("Failed to load initial summary snapshot.", err);
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load agents.";
      setError(message);
    } finally {
      setLoading(false);
      setAgentsLoadedOnce(true);
    }
  }, [
    client,
    dispatch,
    hydrateAgents,
    resolveAgentAvatarUrl,
    resolveAgentName,
    resolveDefaultModelForAgent,
    setError,
    setLoading,
    gatewayUrl,
    gatewayConfigSnapshot,
    settingsCoordinator,
    status,
  ]);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    if (status === "connected") return;
    setAgentsLoadedOnce(false);
  }, [gatewayUrl, status]);

	  useEffect(() => {
	    if (status !== "connected") return;
	    if (activeConfigMutation) return;
	    if (deleteAgentBlock && deleteAgentBlock.phase !== "queued") return;
	    if (createAgentBlock && createAgentBlock.phase !== "queued") return;
	    if (renameAgentBlock && renameAgentBlock.phase !== "queued") return;
	    if (hasRunningAgents) return;
	    const next = queuedConfigMutations[0];
	    if (!next) return;
	    setQueuedConfigMutations((current) => current.slice(1));
	    setActiveConfigMutation(next);
	  }, [
	    activeConfigMutation,
	    createAgentBlock,
	    deleteAgentBlock,
	    renameAgentBlock,
	    hasRunningAgents,
	    queuedConfigMutations,
	    status,
	  ]);

  useEffect(() => {
    if (!activeConfigMutation) return;
    let mounted = true;
    const run = async () => {
      try {
        await activeConfigMutation.run();
        activeConfigMutation.resolve();
      } catch (error) {
        activeConfigMutation.reject(error);
      } finally {
        if (mounted) {
          setActiveConfigMutation(null);
        }
      }
    };
    void run();
    return () => {
      mounted = false;
    };
  }, [activeConfigMutation]);

  useEffect(() => {
    let cancelled = false;
    const key = gatewayUrl.trim();
    if (!key) {
      setFocusedPreferencesLoaded(true);
      return;
    }
    setFocusedPreferencesLoaded(false);
    focusFilterTouchedRef.current = false;
    const loadFocusedPreferences = async () => {
      try {
        const settings = await settingsCoordinator.loadSettings();
        if (cancelled || !settings) {
          return;
        }
        if (focusFilterTouchedRef.current) {
          return;
        }
        const preference = resolveFocusedPreference(settings, key);
        if (preference) {
          setFocusFilter(preference.filter);
          return;
        }
        setFocusFilter("all");
      } catch (err) {
        console.error("Failed to load focused preference.", err);
      } finally {
        if (!cancelled) {
          setFocusedPreferencesLoaded(true);
        }
      }
    };
    void loadFocusedPreferences();
    return () => {
      cancelled = true;
    };
  }, [gatewayUrl, settingsCoordinator]);

  useEffect(() => {
    return () => {
      void settingsCoordinator.flushPending();
    };
  }, [settingsCoordinator]);

  useEffect(() => {
    const key = gatewayUrl.trim();
    if (!focusedPreferencesLoaded || !key) return;
    settingsCoordinator.schedulePatch(
      {
        focused: {
          [key]: {
            mode: "focused",
            filter: focusFilter,
          },
        },
      },
      300
    );
  }, [focusFilter, focusedPreferencesLoaded, gatewayUrl, settingsCoordinator]);

  useEffect(() => {
    if (status !== "connected" || !focusedPreferencesLoaded) return;
    if (deleteAgentBlock && deleteAgentBlock.phase !== "queued") return;
    if (createAgentBlock && createAgentBlock.phase !== "queued") return;
    if (renameAgentBlock && renameAgentBlock.phase !== "queued") return;
    void loadAgents();
  }, [
    createAgentBlock,
    deleteAgentBlock,
    focusedPreferencesLoaded,
    gatewayUrl,
    loadAgents,
    renameAgentBlock,
    status,
  ]);

  useEffect(() => {
    if (status === "disconnected") {
      setLoading(false);
    }
  }, [setLoading, status]);

  useEffect(() => {
    if (!settingsAgentId) return;
    if (state.selectedAgentId && state.selectedAgentId !== settingsAgentId) {
      setSettingsAgentId(null);
    }
  }, [settingsAgentId, state.selectedAgentId]);

  useEffect(() => {
    if (settingsAgentId && !settingsAgent) {
      setSettingsAgentId(null);
    }
  }, [settingsAgentId, settingsAgent]);

  useEffect(() => {
    if (!settingsAgentId || status !== "connected") {
      setSettingsCronJobs([]);
      setSettingsCronLoading(false);
      setSettingsCronError(null);
      setCronRunBusyJobId(null);
      setCronDeleteBusyJobId(null);
      setSettingsHeartbeats([]);
      setSettingsHeartbeatLoading(false);
      setSettingsHeartbeatError(null);
      setHeartbeatRunBusyId(null);
      setHeartbeatDeleteBusyId(null);
      return;
    }
    void loadCronJobsForSettingsAgent(settingsAgentId);
    void loadHeartbeatsForSettingsAgent(settingsAgentId);
  }, [loadCronJobsForSettingsAgent, loadHeartbeatsForSettingsAgent, settingsAgentId, status]);

  useEffect(() => {
    if (!brainPanelOpen) return;
    if (selectedBrainAgentId) return;
    setBrainPanelOpen(false);
  }, [brainPanelOpen, selectedBrainAgentId]);

  useEffect(() => {
    if (mobilePane !== "settings") return;
    if (settingsAgent) return;
    setMobilePane("chat");
  }, [mobilePane, settingsAgent]);

  useEffect(() => {
    if (mobilePane !== "brain") return;
    if (brainPanelOpen && selectedBrainAgentId) return;
    setMobilePane("chat");
  }, [brainPanelOpen, mobilePane, selectedBrainAgentId]);

  useEffect(() => {
    if (status !== "connected") {
      setGatewayModels([]);
      setGatewayModelsError(null);
      setGatewayConfigSnapshot(null);
      return;
    }
    let cancelled = false;
    const loadModels = async () => {
      let configSnapshot: GatewayModelPolicySnapshot | null = null;
      try {
        configSnapshot = await client.call<GatewayModelPolicySnapshot>("config.get", {});
        if (!cancelled) {
          setGatewayConfigSnapshot(configSnapshot);
        }
      } catch (err) {
        if (!isGatewayDisconnectLikeError(err)) {
          console.error("Failed to load gateway config.", err);
        }
      }
      try {
        const result = await client.call<{ models: GatewayModelChoice[] }>(
          "models.list",
          {}
        );
        if (cancelled) return;
        const catalog = Array.isArray(result.models) ? result.models : [];
        setGatewayModels(buildGatewayModelChoices(catalog, configSnapshot));
        setGatewayModelsError(null);
      } catch (err) {
        if (cancelled) return;
        const message =
          err instanceof Error ? err.message : "Failed to load models.";
        setGatewayModelsError(message);
        setGatewayModels([]);
        if (!isGatewayDisconnectLikeError(err)) {
          console.error("Failed to load gateway models.", err);
        }
      }
    };
    void loadModels();
    return () => {
      cancelled = true;
    };
  }, [client, status]);

  const loadSummarySnapshot = useCallback(async () => {
    const activeAgents = stateRef.current.agents.filter((agent) => agent.sessionCreated);
    const sessionKeys = Array.from(
      new Set(
        activeAgents
          .map((agent) => agent.sessionKey)
          .filter((key): key is string => typeof key === "string" && key.trim().length > 0)
      )
    ).slice(0, 64);
    if (sessionKeys.length === 0) return;
    try {
      const [statusSummary, previewResult] = await Promise.all([
        client.call<SummaryStatusSnapshot>("status", {}),
        client.call<SummaryPreviewSnapshot>("sessions.preview", {
          keys: sessionKeys,
          limit: 8,
          maxChars: 240,
        }),
      ]);
      for (const entry of buildSummarySnapshotPatches({
        agents: activeAgents,
        statusSummary,
        previewResult,
      })) {
        dispatch({
          type: "updateAgent",
          agentId: entry.agentId,
          patch: entry.patch,
        });
      }
    } catch (err) {
      if (!isGatewayDisconnectLikeError(err)) {
        console.error("Failed to load summary snapshot.", err);
      }
    }
  }, [client, dispatch]);

  useEffect(() => {
    if (status !== "connected") return;
    void loadSummarySnapshot();
  }, [loadSummarySnapshot, status]);

  useEffect(() => {
    if (!state.selectedAgentId) return;
    if (agents.some((agent) => agent.agentId === state.selectedAgentId)) return;
    dispatch({ type: "selectAgent", agentId: null });
  }, [agents, dispatch, state.selectedAgentId]);

  useEffect(() => {
    const nextId = focusedAgent?.agentId ?? null;
    if (state.selectedAgentId === nextId) return;
    dispatch({ type: "selectAgent", agentId: nextId });
  }, [dispatch, focusedAgent, state.selectedAgentId]);

  useEffect(() => {
    for (const agent of agents) {
      const lastMessage = agent.lastUserMessage?.trim() ?? "";
      const kind = resolveSpecialUpdateKind(lastMessage);
      const key = agent.agentId;
      const marker = kind === "heartbeat" ? `${lastMessage}:${heartbeatTick}` : lastMessage;
      const previous = specialUpdateRef.current.get(key);
      if (previous === marker) continue;
      specialUpdateRef.current.set(key, marker);
      void updateSpecialLatestUpdate(agent.agentId, agent, lastMessage);
    }
  }, [agents, heartbeatTick, updateSpecialLatestUpdate]);

  const loadAgentHistory = useCallback(
    async (agentId: string) => {
      const agent = stateRef.current.agents.find((entry) => entry.agentId === agentId);
      const sessionKey = agent?.sessionKey?.trim();
      if (!agent || !agent.sessionCreated || !sessionKey) return;
      if (historyInFlightRef.current.has(sessionKey)) return;

      historyInFlightRef.current.add(sessionKey);
      const loadedAt = Date.now();
      try {
        const result = await client.call<ChatHistoryResult>("chat.history", {
          sessionKey,
          limit: 200,
        });
        const patch = buildHistorySyncPatch({
          messages: result.messages ?? [],
          currentLines: agent.outputLines,
          loadedAt,
          status: agent.status,
          runId: agent.runId,
        });
        dispatch({
          type: "updateAgent",
          agentId,
          patch,
        });
      } catch (err) {
        if (!isGatewayDisconnectLikeError(err)) {
          const msg = err instanceof Error ? err.message : "Failed to load chat history.";
          console.error(msg);
        }
      } finally {
        historyInFlightRef.current.delete(sessionKey);
      }
    },
    [client, dispatch]
  );

  useEffect(() => {
    if (status !== "connected") return;
    for (const agent of agents) {
      if (!agent.sessionCreated || agent.historyLoadedAt) continue;
      void loadAgentHistory(agent.agentId);
    }
  }, [agents, loadAgentHistory, status]);

  const handleOpenAgentSettings = useCallback(
    (agentId: string) => {
      flushPendingDraft(focusedAgent?.agentId ?? null);
      setBrainPanelOpen(false);
      setSettingsAgentId(agentId);
      setMobilePane("settings");
      dispatch({ type: "selectAgent", agentId });
    },
    [dispatch, flushPendingDraft, focusedAgent]
  );

  const handleBrainToggle = useCallback(() => {
    setBrainPanelOpen((prev) => {
      const next = !prev;
      if (!next) return false;
      setSettingsAgentId(null);
      setMobilePane("brain");
      return true;
    });
  }, []);

  const handleDeleteAgent = useCallback(
    async (agentId: string) => {
      if (deleteAgentBlock) return;
      if (createAgentBlock) return;
      if (renameAgentBlock) return;
      if (agentId === RESERVED_MAIN_AGENT_ID) {
        setError("The main agent cannot be deleted.");
        return;
      }
      const agent = agents.find((entry) => entry.agentId === agentId);
      if (!agent) return;
      const confirmed = window.confirm(
        `Delete ${agent.name}? This removes the agent from gateway config + cron and moves its workspace/state into ~/.openclaw/trash on the gateway host.`
      );
      if (!confirmed) return;
      setDeleteAgentBlock({
        agentId,
        agentName: agent.name,
        phase: "queued",
        startedAt: Date.now(),
        sawDisconnect: false,
      });
      try {
        await enqueueConfigMutation({
          kind: "delete-agent",
          label: `Delete ${agent.name}`,
          run: async () => {
            setDeleteAgentBlock((current) => {
              if (!current || current.agentId !== agentId) return current;
              return {
                ...current,
                phase: "deleting",
              };
            });
	            await deleteAgentViaStudio({
	              client,
	              agentId,
	              fetchJson,
	              logError: (message, error) => console.error(message, error),
	            });
            setSettingsAgentId(null);
            setDeleteAgentBlock((current) => {
              if (!current || current.agentId !== agentId) return current;
              return {
                ...current,
                phase: "awaiting-restart",
                sawDisconnect: false,
              };
            });
          },
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to delete agent.";
        setDeleteAgentBlock(null);
        setError(msg);
      }
    },
    [
      agents,
      client,
      createAgentBlock,
      deleteAgentBlock,
      enqueueConfigMutation,
      renameAgentBlock,
      setError,
    ]
  );

  useEffect(() => {
    if (!deleteAgentBlock || deleteAgentBlock.phase !== "awaiting-restart") return;
    if (status !== "connected") {
      if (!deleteAgentBlock.sawDisconnect) {
        setDeleteAgentBlock((current) => {
          if (!current || current.phase !== "awaiting-restart" || current.sawDisconnect) {
            return current;
          }
          return { ...current, sawDisconnect: true };
        });
      }
      return;
    }
    if (!deleteAgentBlock.sawDisconnect) return;
    let cancelled = false;
    const finalize = async () => {
      await loadAgents();
      if (cancelled) return;
      setDeleteAgentBlock(null);
      setMobilePane("chat");
    };
    void finalize();
    return () => {
      cancelled = true;
    };
  }, [deleteAgentBlock, loadAgents, status]);

  useEffect(() => {
    if (!deleteAgentBlock) return;
    if (deleteAgentBlock.phase === "queued") return;
    const maxWaitMs = 90_000;
    const elapsed = Date.now() - deleteAgentBlock.startedAt;
    const remaining = Math.max(0, maxWaitMs - elapsed);
    const timeoutId = window.setTimeout(() => {
      setDeleteAgentBlock(null);
      setError("Gateway restart timed out after deleting the agent.");
    }, remaining);
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [deleteAgentBlock, setError]);

  const handleRunCronJob = useCallback(
    async (agentId: string, jobId: string) => {
      const resolvedJobId = jobId.trim();
      const resolvedAgentId = agentId.trim();
      if (!resolvedJobId || !resolvedAgentId) return;
      if (cronRunBusyJobId || cronDeleteBusyJobId) return;
      setCronRunBusyJobId(resolvedJobId);
      setSettingsCronError(null);
      try {
        await runCronJobNow(client, resolvedJobId);
        await loadCronJobsForSettingsAgent(resolvedAgentId);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to run cron job.";
        setSettingsCronError(message);
        console.error(message);
      } finally {
        setCronRunBusyJobId((current) => (current === resolvedJobId ? null : current));
      }
    },
    [client, cronDeleteBusyJobId, cronRunBusyJobId, loadCronJobsForSettingsAgent]
  );

  const handleDeleteCronJob = useCallback(
    async (agentId: string, jobId: string) => {
      const resolvedJobId = jobId.trim();
      const resolvedAgentId = agentId.trim();
      if (!resolvedJobId || !resolvedAgentId) return;
      if (cronRunBusyJobId || cronDeleteBusyJobId) return;
      setCronDeleteBusyJobId(resolvedJobId);
      setSettingsCronError(null);
      try {
        const result = await removeCronJob(client, resolvedJobId);
        if (result.ok && result.removed) {
          setSettingsCronJobs((jobs) => jobs.filter((job) => job.id !== resolvedJobId));
        }
        await loadCronJobsForSettingsAgent(resolvedAgentId);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to delete cron job.";
        setSettingsCronError(message);
        console.error(message);
      } finally {
        setCronDeleteBusyJobId((current) => (current === resolvedJobId ? null : current));
      }
    },
    [client, cronDeleteBusyJobId, cronRunBusyJobId, loadCronJobsForSettingsAgent]
  );

  const handleRunHeartbeat = useCallback(
    async (agentId: string, heartbeatId: string) => {
      const resolvedAgentId = agentId.trim();
      const resolvedHeartbeatId = heartbeatId.trim();
      if (!resolvedAgentId || !resolvedHeartbeatId) return;
      if (heartbeatRunBusyId || heartbeatDeleteBusyId) return;
      setHeartbeatRunBusyId(resolvedHeartbeatId);
      setSettingsHeartbeatError(null);
      try {
        await triggerHeartbeatNow(client, resolvedAgentId);
        await loadHeartbeatsForSettingsAgent(resolvedAgentId);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to trigger heartbeat.";
        setSettingsHeartbeatError(message);
        console.error(message);
      } finally {
        setHeartbeatRunBusyId((current) =>
          current === resolvedHeartbeatId ? null : current
        );
      }
    },
    [client, heartbeatDeleteBusyId, heartbeatRunBusyId, loadHeartbeatsForSettingsAgent]
  );

  const handleDeleteHeartbeat = useCallback(
    async (agentId: string, heartbeatId: string) => {
      const resolvedAgentId = agentId.trim();
      const resolvedHeartbeatId = heartbeatId.trim();
      if (!resolvedAgentId || !resolvedHeartbeatId) return;
      if (heartbeatRunBusyId || heartbeatDeleteBusyId) return;
      setHeartbeatDeleteBusyId(resolvedHeartbeatId);
      setSettingsHeartbeatError(null);
      try {
        await removeGatewayHeartbeatOverride({
          client,
          agentId: resolvedAgentId,
        });
        setSettingsHeartbeats((heartbeats) =>
          heartbeats.filter((heartbeat) => heartbeat.id !== resolvedHeartbeatId)
        );
        await loadHeartbeatsForSettingsAgent(resolvedAgentId);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to delete heartbeat.";
        setSettingsHeartbeatError(message);
        console.error(message);
      } finally {
        setHeartbeatDeleteBusyId((current) =>
          current === resolvedHeartbeatId ? null : current
        );
      }
    },
    [client, heartbeatDeleteBusyId, heartbeatRunBusyId, loadHeartbeatsForSettingsAgent]
  );

  const handleCreateAgent = useCallback(async () => {
    if (createAgentBusy) return;
    if (createAgentBlock) return;
    if (deleteAgentBlock) return;
    if (renameAgentBlock) return;
    if (status !== "connected") {
      setError("Connect to gateway before creating an agent.");
      return;
    }
    setCreateAgentBusy(true);
    try {
      const name = resolveNextNewAgentName(stateRef.current.agents);
      setCreateAgentBlock({
        agentId: null,
        agentName: name,
        phase: "queued",
        startedAt: Date.now(),
        sawDisconnect: false,
      });
      await enqueueConfigMutation({
        kind: "create-agent",
        label: `Create ${name}`,
        run: async () => {
          setCreateAgentBlock((current) => {
            if (!current || current.agentName !== name) return current;
            return { ...current, phase: "creating" };
          });
          const created = await createGatewayAgent({ client, name });
          flushPendingDraft(focusedAgent?.agentId ?? null);
          focusFilterTouchedRef.current = true;
          setFocusFilter("all");
          dispatch({ type: "selectAgent", agentId: created.id });
          setSettingsAgentId(null);
          setMobilePane("chat");
          setCreateAgentBlock((current) => {
            if (!current || current.agentName !== name) return current;
            return {
              ...current,
              agentId: created.id,
              phase: "awaiting-restart",
              sawDisconnect: false,
            };
          });
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to create agent.";
      setCreateAgentBlock(null);
      setError(message);
    } finally {
      setCreateAgentBusy(false);
    }
  }, [
    client,
    createAgentBusy,
    createAgentBlock,
    deleteAgentBlock,
    flushPendingDraft,
    focusedAgent,
    renameAgentBlock,
    dispatch,
    enqueueConfigMutation,
    setError,
    status,
  ]);

  useEffect(() => {
    if (!createAgentBlock || createAgentBlock.phase !== "awaiting-restart") return;
    if (status !== "connected") {
      if (!createAgentBlock.sawDisconnect) {
        setCreateAgentBlock((current) => {
          if (!current || current.phase !== "awaiting-restart" || current.sawDisconnect) {
            return current;
          }
          return { ...current, sawDisconnect: true };
        });
      }
      return;
    }
	    if (!createAgentBlock.sawDisconnect) return;
	    let cancelled = false;
	    const finalize = async () => {
	      await loadAgents();
	      if (cancelled) return;
	      const newAgentId = createAgentBlock.agentId?.trim() ?? "";
	      if (newAgentId) {
	        dispatch({ type: "selectAgent", agentId: newAgentId });
	        setCreateAgentBlock((current) => {
	          if (!current || current.agentId !== newAgentId) return current;
	          return { ...current, phase: "bootstrapping-files" };
	        });
	        try {
	          await bootstrapAgentBrainFilesFromTemplate({ client, agentId: newAgentId });
	        } catch (err) {
	          const message =
	            err instanceof Error
	              ? err.message
	              : "Failed to bootstrap brain files for the new agent.";
	          console.error(message, err);
	          setError(message);
	        }
	      }
	      setCreateAgentBlock(null);
	      setMobilePane("chat");
	    };
	    void finalize();
	    return () => {
	      cancelled = true;
	    };
	  }, [client, createAgentBlock, dispatch, loadAgents, setError, status]);

  useEffect(() => {
    if (!createAgentBlock) return;
    if (createAgentBlock.phase === "queued") return;
    const maxWaitMs = 90_000;
    const elapsed = Date.now() - createAgentBlock.startedAt;
    const remaining = Math.max(0, maxWaitMs - elapsed);
    const timeoutId = window.setTimeout(() => {
      setCreateAgentBlock(null);
      setError("Gateway restart timed out after creating the agent.");
    }, remaining);
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [createAgentBlock, setError]);

  useEffect(() => {
    if (!renameAgentBlock || renameAgentBlock.phase !== "awaiting-restart") return;
    if (status !== "connected") {
      if (!renameAgentBlock.sawDisconnect) {
        setRenameAgentBlock((current) => {
          if (!current || current.phase !== "awaiting-restart" || current.sawDisconnect) {
            return current;
          }
          return { ...current, sawDisconnect: true };
        });
      }
      return;
    }
    if (!renameAgentBlock.sawDisconnect) return;
    let cancelled = false;
    const finalize = async () => {
      await loadAgents();
      if (cancelled) return;
      setRenameAgentBlock(null);
      setMobilePane("chat");
    };
    void finalize();
    return () => {
      cancelled = true;
    };
  }, [loadAgents, renameAgentBlock, status]);

  useEffect(() => {
    if (!renameAgentBlock) return;
    if (renameAgentBlock.phase === "queued") return;
    const maxWaitMs = 90_000;
    const elapsed = Date.now() - renameAgentBlock.startedAt;
    const remaining = Math.max(0, maxWaitMs - elapsed);
    const timeoutId = window.setTimeout(() => {
      setRenameAgentBlock(null);
      setError("Gateway restart timed out after renaming the agent.");
    }, remaining);
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [renameAgentBlock, setError]);

  const handleNewSession = useCallback(
    async (agentId: string) => {
      const agent = agents.find((entry) => entry.agentId === agentId);
      if (!agent) {
        setError("Failed to start new session: agent not found.");
        return;
      }
      try {
        const sessionKey = agent.sessionKey.trim();
        if (!sessionKey) {
          throw new Error("Missing session key for agent.");
        }
        await client.call("sessions.reset", { key: sessionKey });
        const patch = buildNewSessionAgentPatch(agent);
        runtimeEventHandlerRef.current?.clearRunTracking(agent.runId);
        historyInFlightRef.current.delete(sessionKey);
        specialUpdateRef.current.delete(agentId);
        specialUpdateInFlightRef.current.delete(agentId);
        dispatch({
          type: "updateAgent",
          agentId,
          patch,
        });
        setSettingsAgentId(null);
        setMobilePane("chat");
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to start new session.";
        setError(message);
        dispatch({
          type: "appendOutput",
          agentId,
          line: `New session failed: ${message}`,
        });
      }
    },
    [agents, client, dispatch, setError]
  );

  useEffect(() => {
    if (status !== "connected") return;
    if (!focusedAgentId) return;
    if (!focusedAgentRunning) return;
    void loadAgentHistory(focusedAgentId);
    const timer = window.setInterval(() => {
      const latest = stateRef.current.agents.find((entry) => entry.agentId === focusedAgentId);
      if (!latest || latest.status !== "running") return;
      void loadAgentHistory(focusedAgentId);
    }, 4500);
    return () => {
      window.clearInterval(timer);
    };
  }, [focusedAgentId, focusedAgentRunning, loadAgentHistory, status]);

  const handleSend = useCallback(
    async (agentId: string, sessionKey: string, message: string) => {
      const trimmed = message.trim();
      if (!trimmed) return;
      const pendingDraftTimer = pendingDraftTimersRef.current.get(agentId) ?? null;
      if (pendingDraftTimer !== null) {
        window.clearTimeout(pendingDraftTimer);
        pendingDraftTimersRef.current.delete(agentId);
      }
      pendingDraftValuesRef.current.delete(agentId);
      await sendChatMessageViaStudio({
        client,
        dispatch,
        getAgent: (agentId) =>
          stateRef.current.agents.find((entry) => entry.agentId === agentId) ?? null,
        agentId,
        sessionKey,
        message: trimmed,
        clearRunTracking: (runId) => runtimeEventHandlerRef.current?.clearRunTracking(runId),
      });
    },
    [client, dispatch]
  );

  const handleStopRun = useCallback(
    async (agentId: string, sessionKey: string) => {
      if (status !== "connected") {
        setError("Connect to gateway before stopping a run.");
        return;
      }
      const resolvedSessionKey = sessionKey.trim();
      if (!resolvedSessionKey) {
        setError("Missing session key for agent.");
        return;
      }
      if (stopBusyAgentId === agentId) {
        return;
      }
      setStopBusyAgentId(agentId);
      try {
        await client.call("chat.abort", {
          sessionKey: resolvedSessionKey,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to stop run.";
        setError(message);
        console.error(message);
        dispatch({
          type: "appendOutput",
          agentId,
          line: `Stop failed: ${message}`,
        });
      } finally {
        setStopBusyAgentId((current) => (current === agentId ? null : current));
      }
    },
    [client, dispatch, setError, status, stopBusyAgentId]
  );

  const handleSessionSettingChange = useCallback(
    async (
      agentId: string,
      sessionKey: string,
      field: "model" | "thinkingLevel",
      value: string | null
    ) => {
      await applySessionSettingMutation({
        agents: stateRef.current.agents,
        dispatch,
        client,
        agentId,
        sessionKey,
        field,
        value,
      });
    },
    [client, dispatch]
  );

  const handleModelChange = useCallback(
    async (agentId: string, sessionKey: string, value: string | null) => {
      await handleSessionSettingChange(agentId, sessionKey, "model", value);
    },
    [handleSessionSettingChange]
  );

  const handleThinkingChange = useCallback(
    async (agentId: string, sessionKey: string, value: string | null) => {
      await handleSessionSettingChange(agentId, sessionKey, "thinkingLevel", value);
    },
    [handleSessionSettingChange]
  );


  const handleToolCallingToggle = useCallback(
    (agentId: string, enabled: boolean) => {
      dispatch({
        type: "updateAgent",
        agentId,
        patch: { toolCallingEnabled: enabled },
      });
    },
    [dispatch]
  );

  const handleThinkingTracesToggle = useCallback(
    (agentId: string, enabled: boolean) => {
      dispatch({
        type: "updateAgent",
        agentId,
        patch: { showThinkingTraces: enabled },
      });
    },
    [dispatch]
  );

  useEffect(() => {
    const handler = createGatewayRuntimeEventHandler({
      getStatus: () => status,
      getAgents: () => stateRef.current.agents,
      dispatch,
      queueLivePatch,
      loadSummarySnapshot,
      loadAgentHistory,
      refreshHeartbeatLatestUpdate,
      bumpHeartbeatTick: () => setHeartbeatTick((prev) => prev + 1),
      setTimeout: (fn, delayMs) => window.setTimeout(fn, delayMs),
      clearTimeout: (id) => window.clearTimeout(id),
      isDisconnectLikeError: isGatewayDisconnectLikeError,
      logWarn: (message, meta) => console.warn(message, meta),
      updateSpecialLatestUpdate: (agentId, agent, message) => {
        void updateSpecialLatestUpdate(agentId, agent, message);
      },
    });
    runtimeEventHandlerRef.current = handler;
    const unsubscribe = client.onEvent((event: EventFrame) => handler.handleEvent(event));
    return () => {
      runtimeEventHandlerRef.current = null;
      handler.dispose();
      unsubscribe();
    };
  }, [
    client,
    dispatch,
    loadAgentHistory,
    loadSummarySnapshot,
    queueLivePatch,
    refreshHeartbeatLatestUpdate,
    status,
    updateSpecialLatestUpdate,
  ]);

  const handleRenameAgent = useCallback(
    async (agentId: string, name: string) => {
      if (deleteAgentBlock) return false;
      if (createAgentBlock) return false;
      if (renameAgentBlock) return false;
      const agent = agents.find((entry) => entry.agentId === agentId);
      if (!agent) return false;
      try {
        setRenameAgentBlock({
          agentId,
          agentName: name,
          phase: "queued",
          startedAt: Date.now(),
          sawDisconnect: false,
        });
        await enqueueConfigMutation({
          kind: "rename-agent",
          label: `Rename ${agent.name}`,
          run: async () => {
            setRenameAgentBlock((current) => {
              if (!current || current.agentId !== agentId) return current;
              return { ...current, phase: "renaming" };
            });
            await renameGatewayAgent({
              client,
              agentId,
              name,
              sessionKey: agent.sessionKey,
            });
            dispatch({
              type: "updateAgent",
              agentId,
              patch: { name },
            });
            setRenameAgentBlock((current) => {
              if (!current || current.agentId !== agentId) return current;
              return {
                ...current,
                phase: "awaiting-restart",
                sawDisconnect: false,
              };
            });
          },
        });
        return true;
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to rename agent.";
        setRenameAgentBlock(null);
        setError(message);
        return false;
      }
    },
    [
      agents,
      client,
      createAgentBlock,
      deleteAgentBlock,
      dispatch,
      enqueueConfigMutation,
      renameAgentBlock,
      setError,
    ]
  );

  const handleAvatarShuffle = useCallback(
    async (agentId: string) => {
      const avatarSeed = crypto.randomUUID();
      dispatch({
        type: "updateAgent",
        agentId,
        patch: { avatarSeed },
      });
      const key = gatewayUrl.trim();
      if (!key) return;
      settingsCoordinator.schedulePatch(
        {
          avatars: {
            [key]: {
              [agentId]: avatarSeed,
            },
          },
        },
        0
      );
    },
    [dispatch, gatewayUrl, settingsCoordinator]
  );

  const handleDraftChange = useCallback(
    (agentId: string, value: string) => {
      pendingDraftValuesRef.current.set(agentId, value);
      const existingTimer = pendingDraftTimersRef.current.get(agentId) ?? null;
      if (existingTimer !== null) {
        window.clearTimeout(existingTimer);
      }
      const timer = window.setTimeout(() => {
        pendingDraftTimersRef.current.delete(agentId);
        const pending = pendingDraftValuesRef.current.get(agentId);
        if (pending === undefined) return;
        pendingDraftValuesRef.current.delete(agentId);
        dispatch({
          type: "updateAgent",
          agentId,
          patch: { draft: pending },
        });
      }, 250);
      pendingDraftTimersRef.current.set(agentId, timer);
    },
    [dispatch]
  );

  const connectionPanelVisible = showConnectionPanel;
  const hasAnyAgents = agents.length > 0;
  const showFleetLayout = hasAnyAgents || status === "connected";
  const configMutationStatusLine = activeConfigMutation
    ? `Applying config change: ${activeConfigMutation.label}`
    : queuedConfigMutationCount > 0
      ? hasRunningAgents
        ? `Queued ${queuedConfigMutationCount} config change${queuedConfigMutationCount === 1 ? "" : "s"}; waiting for ${runningAgentCount} running agent${runningAgentCount === 1 ? "" : "s"} to finish`
        : status !== "connected"
          ? `Queued ${queuedConfigMutationCount} config change${queuedConfigMutationCount === 1 ? "" : "s"}; waiting for gateway connection`
          : `Queued ${queuedConfigMutationCount} config change${queuedConfigMutationCount === 1 ? "" : "s"}`
      : null;
  const createBlockStatusLine = createAgentBlock
    ? createAgentBlock.phase === "queued"
      ? "Waiting for active runs to finish"
      : createAgentBlock.phase === "creating"
      ? "Submitting config change"
      : createAgentBlock.phase === "bootstrapping-files"
        ? "Bootstrapping brain files"
      : !createAgentBlock.sawDisconnect
        ? "Waiting for gateway to restart"
        : status === "connected"
          ? "Gateway is back online, syncing agents"
          : "Gateway restart in progress"
    : null;
  const renameBlockStatusLine = renameAgentBlock
    ? renameAgentBlock.phase === "queued"
      ? "Waiting for active runs to finish"
      : renameAgentBlock.phase === "renaming"
      ? "Submitting config change"
      : !renameAgentBlock.sawDisconnect
        ? "Waiting for gateway to restart"
        : status === "connected"
          ? "Gateway is back online, syncing agents"
          : "Gateway restart in progress"
    : null;
  const deleteBlockStatusLine = deleteAgentBlock
    ? deleteAgentBlock.phase === "queued"
      ? "Waiting for active runs to finish"
      : deleteAgentBlock.phase === "deleting"
      ? "Submitting config change"
      : !deleteAgentBlock.sawDisconnect
        ? "Waiting for gateway to restart"
        : status === "connected"
          ? "Gateway is back online, syncing agents"
          : "Gateway restart in progress"
      : null;

  if (status === "connecting" || (status === "connected" && !agentsLoadedOnce)) {
    return (
      <div className="relative min-h-screen w-screen overflow-hidden bg-background">
        <div className="flex min-h-screen items-center justify-center px-6">
          <div className="glass-panel w-full max-w-md px-6 py-6 text-center">
            <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              OpenClaw Studio
            </div>
            <div className="mt-3 text-sm text-muted-foreground">
              {status === "connecting" ? "Connecting to gateway…" : "Loading agents…"}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen w-screen overflow-hidden bg-background">
      {state.loading ? (
        <div className="pointer-events-none fixed bottom-4 left-0 right-0 z-50 flex justify-center px-3">
          <div className="glass-panel px-6 py-3 font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
            Loading agents…
          </div>
        </div>
      ) : null}
      <div className="relative z-10 flex h-screen flex-col gap-4 px-3 py-3 sm:px-4 sm:py-4 md:px-6 md:py-6">
        <div className="w-full">
          <HeaderBar
            status={status}
            onConnectionSettings={() => setShowConnectionPanel((prev) => !prev)}
            onBrainFiles={handleBrainToggle}
            brainFilesOpen={brainPanelOpen}
            brainDisabled={!hasAnyAgents}
          />
        </div>

        {connectionPanelVisible ? (
          <div className="w-full">
            <div className="glass-panel px-4 py-4 sm:px-6 sm:py-6">
              <ConnectionPanel
                gatewayUrl={gatewayUrl}
                token={token}
                status={status}
                error={gatewayError}
                onGatewayUrlChange={setGatewayUrl}
                onTokenChange={setToken}
                onConnect={() => void connect()}
                onDisconnect={disconnect}
              />
            </div>
          </div>
        ) : null}

        {errorMessage ? (
          <div className="w-full">
            <div className="rounded-md border border-destructive bg-destructive px-4 py-2 text-sm text-destructive-foreground">
              {errorMessage}
            </div>
          </div>
        ) : null}
        {configMutationStatusLine ? (
          <div className="w-full">
            <div className="rounded-md border border-border/80 bg-card/80 px-4 py-2 font-mono text-[11px] uppercase tracking-[0.11em] text-muted-foreground">
              {configMutationStatusLine}
            </div>
          </div>
        ) : null}

        {showFleetLayout ? (
          <div className="flex min-h-0 flex-1 flex-col gap-4 xl:flex-row">
            <div className="glass-panel p-2 xl:hidden" data-testid="mobile-pane-toggle">
              <div className="grid grid-cols-4 gap-2">
                <button
                  type="button"
                  className={`rounded-md border px-2 py-2 font-mono text-[10px] font-semibold uppercase tracking-[0.13em] transition ${
                    mobilePane === "fleet"
                      ? "border-border bg-muted text-foreground shadow-xs"
                      : "border-border/80 bg-card/65 text-muted-foreground hover:border-border hover:bg-muted/70"
                  }`}
                  onClick={() => setMobilePane("fleet")}
                >
                  Fleet
                </button>
                <button
                  type="button"
                  className={`rounded-md border px-2 py-2 font-mono text-[10px] font-semibold uppercase tracking-[0.13em] transition ${
                    mobilePane === "chat"
                      ? "border-border bg-muted text-foreground shadow-xs"
                      : "border-border/80 bg-card/65 text-muted-foreground hover:border-border hover:bg-muted/70"
                  }`}
                  onClick={() => setMobilePane("chat")}
                >
                  Chat
                </button>
                <button
                  type="button"
                  className={`rounded-md border px-2 py-2 font-mono text-[10px] font-semibold uppercase tracking-[0.13em] transition ${
                    mobilePane === "settings"
                      ? "border-border bg-muted text-foreground shadow-xs"
                      : "border-border/80 bg-card/65 text-muted-foreground hover:border-border hover:bg-muted/70"
                  }`}
                  onClick={() => setMobilePane("settings")}
                  disabled={!settingsAgent}
                >
                  Settings
                </button>
                <button
                  type="button"
                  className={`rounded-md border px-2 py-2 font-mono text-[10px] font-semibold uppercase tracking-[0.13em] transition ${
                    mobilePane === "brain"
                      ? "border-border bg-muted text-foreground shadow-xs"
                      : "border-border/80 bg-card/65 text-muted-foreground hover:border-border hover:bg-muted/70"
                  }`}
                  onClick={() => {
                    setBrainPanelOpen(true);
                    setSettingsAgentId(null);
                    setMobilePane("brain");
                  }}
                  disabled={!hasAnyAgents}
                >
                  Brain
                </button>
              </div>
            </div>
            <div
              className={`${mobilePane === "fleet" ? "block" : "hidden"} min-h-0 xl:block xl:min-h-0`}
            >
              <FleetSidebar
                agents={filteredAgents}
                selectedAgentId={focusedAgent?.agentId ?? state.selectedAgentId}
                filter={focusFilter}
                onFilterChange={handleFocusFilterChange}
                onCreateAgent={() => {
                  void handleCreateAgent();
                }}
                createDisabled={status !== "connected" || createAgentBusy || state.loading}
                createBusy={createAgentBusy}
                onSelectAgent={(agentId) => {
                  flushPendingDraft(focusedAgent?.agentId ?? null);
                  dispatch({ type: "selectAgent", agentId });
                  setMobilePane("chat");
                }}
              />
            </div>
            <div
              className={`${mobilePane === "chat" ? "flex" : "hidden"} glass-panel min-h-0 flex-1 overflow-hidden p-2 sm:p-3 xl:flex`}
              data-testid="focused-agent-panel"
            >
              {focusedAgent ? (
                <AgentChatPanel
                  agent={focusedAgent}
                  isSelected={false}
                  canSend={status === "connected"}
                  models={gatewayModels}
                  stopBusy={stopBusyAgentId === focusedAgent.agentId}
                  onOpenSettings={() => handleOpenAgentSettings(focusedAgent.agentId)}
                  onModelChange={(value) =>
                    handleModelChange(focusedAgent.agentId, focusedAgent.sessionKey, value)
                  }
                  onThinkingChange={(value) =>
                    handleThinkingChange(focusedAgent.agentId, focusedAgent.sessionKey, value)
                  }
                  onDraftChange={(value) =>
                    handleDraftChange(focusedAgent.agentId, value)
                  }
                  onSend={(message) =>
                    handleSend(
                      focusedAgent.agentId,
                      focusedAgent.sessionKey,
                      message
                    )
                  }
                  onStopRun={() =>
                    handleStopRun(focusedAgent.agentId, focusedAgent.sessionKey)
                  }
                  onAvatarShuffle={() => handleAvatarShuffle(focusedAgent.agentId)}
                />
              ) : (
                <EmptyStatePanel
                  title={hasAnyAgents ? "No agents match this filter." : "No agents available."}
                  description={
                    hasAnyAgents
                      ? undefined
                      : "Use New Agent in the sidebar to add your first agent."
                  }
                  fillHeight
                  className="items-center p-6 text-center text-sm"
                />
              )}
            </div>
            {brainPanelOpen ? (
              <div
                className={`${mobilePane === "brain" ? "block" : "hidden"} glass-panel min-h-0 w-full shrink-0 overflow-hidden p-0 xl:block xl:min-w-[360px] xl:max-w-[430px]`}
              >
                <AgentBrainPanel
                  client={client}
                  agents={agents}
                  selectedAgentId={selectedBrainAgentId}
                  onClose={() => {
                    setBrainPanelOpen(false);
                    setMobilePane("chat");
                  }}
                />
              </div>
            ) : null}
            {settingsAgent ? (
              <div
                className={`${mobilePane === "settings" ? "block" : "hidden"} glass-panel min-h-0 w-full shrink-0 overflow-hidden p-0 xl:block xl:min-w-[360px] xl:max-w-[430px]`}
              >
                <AgentSettingsPanel
                  key={settingsAgent.agentId}
                  agent={settingsAgent}
                  onClose={() => {
                    setSettingsAgentId(null);
                    setMobilePane("chat");
                  }}
                  onRename={(name) => handleRenameAgent(settingsAgent.agentId, name)}
                  onNewSession={() => handleNewSession(settingsAgent.agentId)}
                  onDelete={() => handleDeleteAgent(settingsAgent.agentId)}
                  canDelete={settingsAgent.agentId !== RESERVED_MAIN_AGENT_ID}
                  onToolCallingToggle={(enabled) =>
                    handleToolCallingToggle(settingsAgent.agentId, enabled)
                  }
                  onThinkingTracesToggle={(enabled) =>
                    handleThinkingTracesToggle(settingsAgent.agentId, enabled)
                  }
                  cronJobs={settingsCronJobs}
                  cronLoading={settingsCronLoading}
                  cronError={settingsCronError}
                  cronRunBusyJobId={cronRunBusyJobId}
                  cronDeleteBusyJobId={cronDeleteBusyJobId}
                  onRunCronJob={(jobId) => handleRunCronJob(settingsAgent.agentId, jobId)}
                  onDeleteCronJob={(jobId) => handleDeleteCronJob(settingsAgent.agentId, jobId)}
                  heartbeats={settingsHeartbeats}
                  heartbeatLoading={settingsHeartbeatLoading}
                  heartbeatError={settingsHeartbeatError}
                  heartbeatRunBusyId={heartbeatRunBusyId}
                  heartbeatDeleteBusyId={heartbeatDeleteBusyId}
                  onRunHeartbeat={(heartbeatId) =>
                    handleRunHeartbeat(settingsAgent.agentId, heartbeatId)
                  }
                  onDeleteHeartbeat={(heartbeatId) =>
                    handleDeleteHeartbeat(settingsAgent.agentId, heartbeatId)
                  }
                />
              </div>
            ) : null}
          </div>
        ) : (
          <div className="glass-panel fade-up-delay flex min-h-0 flex-1 flex-col overflow-hidden p-5 sm:p-6">
            <EmptyStatePanel
              label="Fleet"
              title="No agents available"
              description="Connect to your gateway to load agents into the studio."
              detail={gatewayUrl || "Gateway URL is empty"}
              fillHeight
              className="items-center px-6 py-10 text-center"
            />
          </div>
	        )}
	      </div>
      {createAgentBlock && createAgentBlock.phase !== "queued" ? (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-background/70 backdrop-blur-sm"
          data-testid="agent-create-restart-modal"
          role="dialog"
          aria-modal="true"
          aria-label="Creating agent and restarting gateway"
        >
          <div className="w-full max-w-md rounded-lg border border-border bg-card/95 p-6 shadow-2xl">
            <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Agent create in progress
            </div>
            <div className="mt-2 text-base font-semibold text-foreground">
              {createAgentBlock.agentName}
            </div>
            <div className="mt-3 text-sm text-muted-foreground">
              Studio is temporarily locked until the gateway restarts.
            </div>
            {createBlockStatusLine ? (
              <div className="mt-4 rounded-md border border-border/70 bg-muted/40 px-3 py-2 font-mono text-[11px] uppercase tracking-[0.12em] text-foreground">
                {createBlockStatusLine}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
      {renameAgentBlock && renameAgentBlock.phase !== "queued" ? (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-background/70 backdrop-blur-sm"
          data-testid="agent-rename-restart-modal"
          role="dialog"
          aria-modal="true"
          aria-label="Renaming agent and restarting gateway"
        >
          <div className="w-full max-w-md rounded-lg border border-border bg-card/95 p-6 shadow-2xl">
            <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Agent rename in progress
            </div>
            <div className="mt-2 text-base font-semibold text-foreground">
              {renameAgentBlock.agentName}
            </div>
            <div className="mt-3 text-sm text-muted-foreground">
              Studio is temporarily locked until the gateway restarts.
            </div>
            {renameBlockStatusLine ? (
              <div className="mt-4 rounded-md border border-border/70 bg-muted/40 px-3 py-2 font-mono text-[11px] uppercase tracking-[0.12em] text-foreground">
                {renameBlockStatusLine}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
      {deleteAgentBlock && deleteAgentBlock.phase !== "queued" ? (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-background/70 backdrop-blur-sm"
          data-testid="agent-delete-restart-modal"
          role="dialog"
          aria-modal="true"
          aria-label="Deleting agent and restarting gateway"
        >
          <div className="w-full max-w-md rounded-lg border border-border bg-card/95 p-6 shadow-2xl">
            <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Agent delete in progress
            </div>
            <div className="mt-2 text-base font-semibold text-foreground">
              {deleteAgentBlock.agentName}
            </div>
            <div className="mt-3 text-sm text-muted-foreground">
              Studio is temporarily locked until the gateway restarts.
            </div>
            {deleteBlockStatusLine ? (
              <div className="mt-4 rounded-md border border-border/70 bg-muted/40 px-3 py-2 font-mono text-[11px] uppercase tracking-[0.12em] text-foreground">
                {deleteBlockStatusLine}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default function Home() {
  return (
    <AgentStoreProvider>
      <AgentStudioPage />
    </AgentStoreProvider>
  );
}
