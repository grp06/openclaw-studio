"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AgentChatPanel } from "@/features/agents/components/AgentChatPanel";
import { AgentCreateModal } from "@/features/agents/components/AgentCreateModal";
import {
  AgentBrainPanel,
  AgentSettingsPanel,
} from "@/features/agents/components/AgentInspectPanels";
import { FleetSidebar } from "@/features/agents/components/FleetSidebar";
import { HeaderBar } from "@/features/agents/components/HeaderBar";
import { ConnectionPanel } from "@/features/agents/components/ConnectionPanel";
import { GatewayConnectScreen } from "@/features/agents/components/GatewayConnectScreen";
import { EmptyStatePanel } from "@/features/agents/components/EmptyStatePanel";
import {
  extractText,
  isHeartbeatPrompt,
  stripUiMetadata,
} from "@/lib/text/message-extract";
import {
  parseAgentIdFromSessionKey,
  syncGatewaySessionSettings,
  useGatewayConnection,
} from "@/lib/gateway/GatewayClient";
import { createRafBatcher } from "@/lib/dom";
import {
  buildGatewayModelChoices,
  type GatewayModelChoice,
  type GatewayModelPolicySnapshot,
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
  buildSummarySnapshotPatches,
  type SummaryPreviewSnapshot,
  type SummaryStatusSnapshot,
} from "@/features/agents/state/runtimeEventBridge";
import type { AgentState } from "@/features/agents/state/store";
import { createGatewayRuntimeEventHandler } from "@/features/agents/state/gatewayRuntimeEventHandler";
import {
  type CronJobSummary,
  filterCronJobsForAgent,
  formatCronJobDisplay,
  listCronJobs,
  removeCronJob,
  resolveLatestCronJobForAgent,
  runCronJobNow,
  sortCronJobsByUpdatedAt,
} from "@/lib/cron/types";
import type { CronCreateDraft } from "@/lib/cron/createPayloadBuilder";
import {
  createGatewayAgent,
  renameGatewayAgent,
  removeGatewayHeartbeatOverride,
  listHeartbeatsForAgent,
  readConfigAgentList,
  slugifyAgentName,
  triggerHeartbeatNow,
  updateGatewayAgentOverrides,
  type AgentHeartbeatSummary,
} from "@/lib/gateway/agentConfig";
import { readGatewayAgentExecApprovals, upsertGatewayAgentExecApprovals } from "@/lib/gateway/execApprovals";
import { buildAvatarDataUrl } from "@/lib/avatars/multiavatar";
import { createStudioSettingsCoordinator } from "@/lib/studio/coordinator";
import { resolveFocusedPreference } from "@/lib/studio/settings";
import { applySessionSettingMutation } from "@/features/agents/state/sessionSettingsMutations";
import {
  compileGuidedAgentCreation,
} from "@/features/agents/creation/compiler";
import type { AgentCreateModalSubmitPayload } from "@/features/agents/creation/types";
import {
  applyPendingGuidedSetupForAgent,
  removePendingGuidedSetup,
  upsertPendingGuidedSetup,
} from "@/features/agents/creation/recovery";
import {
  normalizePendingGuidedSetupGatewayScope,
} from "@/features/agents/creation/pendingSetupStore";
import {
  loadPendingGuidedSetupsForScope,
  persistPendingGuidedSetupsForScopeWhenLoaded,
} from "@/features/agents/creation/pendingGuidedSetupSessionStorageLifecycle";
import {
  applyGuidedAgentSetup,
  type AgentGuidedSetup,
} from "@/features/agents/operations/createAgentOperation";
import {
  resolveGuidedCreateCompletion,
  runGuidedCreateWorkflow,
  runGuidedRetryWorkflow,
} from "@/features/agents/operations/guidedCreateWorkflow";
import { applyPendingGuidedSetupRetryViaStudio } from "@/features/agents/operations/pendingGuidedSetupRetryOperation";
import {
  isGatewayDisconnectLikeError,
  type EventFrame,
} from "@/lib/gateway/GatewayClient";
import { fetchJson } from "@/lib/http";
import { deleteAgentViaStudio } from "@/features/agents/operations/deleteAgentOperation";
import { performCronCreateFlow } from "@/features/agents/operations/cronCreateOperation";
import { sendChatMessageViaStudio } from "@/features/agents/operations/chatSendOperation";
import { hydrateAgentFleetFromGateway } from "@/features/agents/operations/agentFleetHydration";
import {
  buildConfigMutationFailureMessage,
  resolveConfigMutationStatusLine,
  runConfigMutationWorkflow,
} from "@/features/agents/operations/configMutationWorkflow";
import { useConfigMutationQueue } from "@/features/agents/operations/useConfigMutationQueue";
import { isLocalGatewayUrl } from "@/lib/gateway/local-gateway";
import { shouldAwaitDisconnectRestartForRemoteMutation } from "@/lib/gateway/gatewayReloadMode";
import { useGatewayRestartBlock } from "@/features/agents/operations/useGatewayRestartBlock";
import { randomUUID } from "@/lib/uuid";
import type { ExecApprovalDecision, PendingExecApproval } from "@/features/agents/approvals/types";
import {
  resolveExecApprovalEventEffects,
} from "@/features/agents/approvals/execApprovalLifecycleWorkflow";
import { resolveExecApprovalViaStudio } from "@/features/agents/approvals/execApprovalResolveOperation";
import {
  mergePendingApprovalsForFocusedAgent,
  nextPendingApprovalPruneDelayMs,
  pruneExpiredPendingApprovals,
  pruneExpiredPendingApprovalsMap,
  removePendingApprovalById,
  removePendingApprovalByIdMap,
  upsertPendingApproval,
} from "@/features/agents/approvals/pendingStore";
import {
  TRANSCRIPT_V2_ENABLED,
  logTranscriptDebugMetric,
} from "@/features/agents/state/transcript";
import {
  buildLatestUpdatePatch,
  resolveLatestUpdateIntent,
  resolveLatestUpdateKind,
} from "@/features/agents/operations/latestUpdateWorkflow";
import {
  resolveSummarySnapshotIntent,
} from "@/features/agents/operations/fleetLifecycleWorkflow";
import {
  executeAgentReconcileCommands,
  runAgentReconcileOperation,
} from "@/features/agents/operations/agentReconcileOperation";
import {
  executeHistorySyncCommands,
  runHistorySyncOperation,
} from "@/features/agents/operations/historySyncOperation";
import {
  buildMutationSideEffectCommands,
  buildQueuedMutationBlock,
  resolveMutationStartGuard,
} from "@/features/agents/operations/agentMutationLifecycleController";
import { runPendingGuidedSetupAutoRetryViaStudio } from "@/features/agents/operations/pendingGuidedSetupAutoRetryOperation";

type ChatHistoryMessage = Record<string, unknown>;

type ChatHistoryResult = {
  sessionKey: string;
  sessionId?: string;
  messages: ChatHistoryMessage[];
  thinkingLevel?: string;
};

const DEFAULT_CHAT_HISTORY_LIMIT = 200;
const MAX_CHAT_HISTORY_LIMIT = 5000;
const PENDING_EXEC_APPROVAL_PRUNE_GRACE_MS = 500;

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
type CreateAgentBlockPhase = "queued" | "creating" | "applying-setup";
type CreateAgentBlockState = {
  agentId: string | null;
  agentName: string;
  phase: CreateAgentBlockPhase;
  startedAt: number;
};
type RenameAgentBlockPhase = "queued" | "renaming" | "awaiting-restart";
type RenameAgentBlockState = {
  agentId: string;
  agentName: string;
  phase: RenameAgentBlockPhase;
  startedAt: number;
  sawDisconnect: boolean;
};

const RESERVED_MAIN_AGENT_ID = "main";

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
  const existingNames = new Set(
    agents.map((agent) => agent.name.trim().toLowerCase()).filter((name) => name.length > 0)
  );
  const existingIds = new Set(
    agents
      .map((agent) => agent.agentId.trim().toLowerCase())
      .filter((agentId) => agentId.length > 0)
  );
  const baseLower = baseName.toLowerCase();
  if (!existingNames.has(baseLower) && !existingIds.has(slugifyAgentName(baseName))) return baseName;
  for (let index = 2; index < 10000; index += 1) {
    const candidate = `${baseName} ${index}`;
    if (existingNames.has(candidate.toLowerCase())) continue;
    if (existingIds.has(slugifyAgentName(candidate))) continue;
    return candidate;
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
    localGatewayDefaults,
    error: gatewayError,
    connect,
    disconnect,
    useLocalGatewayDefaults,
    setGatewayUrl,
    setToken,
  } = useGatewayConnection(settingsCoordinator);

  const { state, dispatch, hydrateAgents, setError, setLoading } = useAgentStore();
  const [showConnectionPanel, setShowConnectionPanel] = useState(false);
  const [focusFilter, setFocusFilter] = useState<FocusFilter>("all");
  const [focusedPreferencesLoaded, setFocusedPreferencesLoaded] = useState(false);
  const [agentsLoadedOnce, setAgentsLoadedOnce] = useState(false);
  const [didAttemptGatewayConnect, setDidAttemptGatewayConnect] = useState(false);
  const [heartbeatTick, setHeartbeatTick] = useState(0);
  const historyInFlightRef = useRef<Set<string>>(new Set());
  const stateRef = useRef(state);
  const focusFilterTouchedRef = useRef(false);
  const [gatewayModels, setGatewayModels] = useState<GatewayModelChoice[]>([]);
  const [gatewayModelsError, setGatewayModelsError] = useState<string | null>(null);
  const [gatewayConfigSnapshot, setGatewayConfigSnapshot] =
    useState<GatewayModelPolicySnapshot | null>(null);
  const [createAgentBusy, setCreateAgentBusy] = useState(false);
  const [createAgentModalOpen, setCreateAgentModalOpen] = useState(false);
  const [createAgentModalError, setCreateAgentModalError] = useState<string | null>(null);
  const [stopBusyAgentId, setStopBusyAgentId] = useState<string | null>(null);
  const [mobilePane, setMobilePane] = useState<MobilePane>("chat");
  const [settingsAgentId, setSettingsAgentId] = useState<string | null>(null);
  const [settingsCronJobs, setSettingsCronJobs] = useState<CronJobSummary[]>([]);
  const [settingsCronLoading, setSettingsCronLoading] = useState(false);
  const [settingsCronError, setSettingsCronError] = useState<string | null>(null);
  const [cronCreateBusy, setCronCreateBusy] = useState(false);
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
  const [pendingExecApprovalsByAgentId, setPendingExecApprovalsByAgentId] = useState<
    Record<string, PendingExecApproval[]>
  >({});
  const [unscopedPendingExecApprovals, setUnscopedPendingExecApprovals] = useState<
    PendingExecApproval[]
  >([]);
  const [pendingCreateSetupsByAgentId, setPendingCreateSetupsByAgentId] = useState<
    Record<string, AgentGuidedSetup>
  >({});
  const [pendingCreateSetupsLoadedScope, setPendingCreateSetupsLoadedScope] = useState<
    string | null
  >(null);
  const [retryPendingSetupBusyAgentId, setRetryPendingSetupBusyAgentId] = useState<string | null>(
    null
  );
  const specialUpdateRef = useRef<Map<string, string>>(new Map());
  const specialUpdateInFlightRef = useRef<Set<string>>(new Set());
  const seenCronEventIdsRef = useRef<Set<string>>(new Set());
  const preferredSelectedAgentIdRef = useRef<string | null>(null);
  const pendingCreateSetupsByAgentIdRef = useRef<Record<string, AgentGuidedSetup>>({});
  const pendingDraftValuesRef = useRef<Map<string, string>>(new Map());
  const pendingDraftTimersRef = useRef<Map<string, number>>(new Map());
  const pendingLivePatchesRef = useRef<Map<string, Partial<AgentState>>>(new Map());
  const flushLivePatchesRef = useRef<() => void>(() => {});
  const livePatchBatcherRef = useRef(createRafBatcher(() => flushLivePatchesRef.current()));
  const runtimeEventHandlerRef = useRef<ReturnType<typeof createGatewayRuntimeEventHandler> | null>(
    null
  );
  const reconcileRunInFlightRef = useRef<Set<string>>(new Set());
  const pendingSetupAutoRetryAttemptedRef = useRef<Set<string>>(new Set());
  const pendingSetupAutoRetryInFlightRef = useRef<Set<string>>(new Set());

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
  const focusedAgentStopDisabledReason = useMemo(() => {
    if (!focusedAgent) return null;
    if (focusedAgent.status !== "running") return null;
    const lastMessage = focusedAgent.lastUserMessage?.trim() ?? "";
    if (!lastMessage || !isHeartbeatPrompt(lastMessage)) return null;
    return "This task is running as an automatic heartbeat check. Stopping heartbeat runs from Studio isn't available yet (coming soon).";
  }, [focusedAgent]);
  const settingsAgent = useMemo(() => {
    if (!settingsAgentId) return null;
    return agents.find((entry) => entry.agentId === settingsAgentId) ?? null;
  }, [agents, settingsAgentId]);
  const selectedBrainAgentId = useMemo(() => {
    return focusedAgent?.agentId ?? agents[0]?.agentId ?? null;
  }, [agents, focusedAgent]);
  const focusedPendingExecApprovals = useMemo(() => {
    if (!focusedAgentId) return unscopedPendingExecApprovals;
    const scoped = pendingExecApprovalsByAgentId[focusedAgentId] ?? [];
    return mergePendingApprovalsForFocusedAgent({
      scopedApprovals: scoped,
      unscopedApprovals: unscopedPendingExecApprovals,
    });
  }, [focusedAgentId, pendingExecApprovalsByAgentId, unscopedPendingExecApprovals]);
  const suggestedCreateAgentName = useMemo(() => {
    try {
      return resolveNextNewAgentName(state.agents);
    } catch {
      return "New Agent";
    }
  }, [state.agents]);
  const focusedPendingCreateSetup = useMemo(() => {
    if (!focusedAgentId) return null;
    return pendingCreateSetupsByAgentId[focusedAgentId] ?? null;
  }, [focusedAgentId, pendingCreateSetupsByAgentId]);
  const focusedPendingCreateSetupBusy =
    focusedAgent !== null && retryPendingSetupBusyAgentId === focusedAgent.agentId;
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
  const isLocalGateway = useMemo(() => isLocalGatewayUrl(gatewayUrl), [gatewayUrl]);
  const pendingGuidedSetupGatewayScope = useMemo(
    () => normalizePendingGuidedSetupGatewayScope(gatewayUrl),
    [gatewayUrl]
  );

  const hasRestartBlockInProgress = Boolean(
    (deleteAgentBlock && deleteAgentBlock.phase !== "queued") ||
      (createAgentBlock && createAgentBlock.phase !== "queued") ||
      (renameAgentBlock && renameAgentBlock.phase !== "queued")
  );

  const { enqueueConfigMutation, queuedCount: queuedConfigMutationCount, activeConfigMutation } =
    useConfigMutationQueue({
      status,
      hasRunningAgents,
      hasRestartBlockInProgress,
    });

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

  const clearPendingLivePatch = useCallback((agentId: string) => {
    const key = agentId.trim();
    if (!key) return;
    const pending = pendingLivePatchesRef.current;
    if (!pending.has(key)) return;
    pending.delete(key);
    if (pending.size === 0) {
      livePatchBatcherRef.current.cancel();
    }
  }, []);

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


  const resolveCronJobForAgent = useCallback((jobs: CronJobSummary[], agentId: string) => {
    return resolveLatestCronJobForAgent(jobs, agentId);
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
      const intent = resolveLatestUpdateIntent({
        message,
        agentId: agent.agentId,
        sessionKey: agent.sessionKey,
        hasExistingOverride: Boolean(agent.latestOverride || agent.latestOverrideKind),
      });
      if (intent.kind === "noop") return;
      if (intent.kind === "reset") {
        dispatch({
          type: "updateAgent",
          agentId: agent.agentId,
          patch: buildLatestUpdatePatch(""),
        });
        return;
      }
      const key = agentId;
      if (specialUpdateInFlightRef.current.has(key)) return;
      specialUpdateInFlightRef.current.add(key);
      try {
        if (intent.kind === "fetch-heartbeat") {
          const sessions = await client.call<SessionsListResult>("sessions.list", {
            agentId: intent.agentId,
            includeGlobal: false,
            includeUnknown: false,
            limit: intent.sessionLimit,
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
              patch: buildLatestUpdatePatch(""),
            });
            return;
          }
          const history = await client.call<ChatHistoryResult>("chat.history", {
            sessionKey,
            limit: intent.historyLimit,
          });
          const content = findLatestHeartbeatResponse(history.messages ?? []) ?? "";
          dispatch({
            type: "updateAgent",
            agentId: agent.agentId,
            patch: buildLatestUpdatePatch(content, "heartbeat"),
          });
          return;
        }
        const cronResult = await listCronJobs(client, { includeDisabled: true });
        const job = resolveCronJobForAgent(cronResult.jobs, intent.agentId);
        const content = job ? formatCronJobDisplay(job) : "";
        dispatch({
          type: "updateAgent",
          agentId: agent.agentId,
          patch: buildLatestUpdatePatch(content, "cron"),
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

  const loadAgents = useCallback(async () => {
    if (status !== "connected") return;
    setLoading(true);
    try {
      const result = await hydrateAgentFleetFromGateway({
        client,
        gatewayUrl,
        cachedConfigSnapshot: gatewayConfigSnapshot,
        loadStudioSettings: () => settingsCoordinator.loadSettings(),
        isDisconnectLikeError: isGatewayDisconnectLikeError,
        logError: (message, error) => console.error(message, error),
      });
      if (!gatewayConfigSnapshot && result.configSnapshot) {
        setGatewayConfigSnapshot(result.configSnapshot);
      }
      const preferredSelectedAgentId = preferredSelectedAgentIdRef.current?.trim() ?? "";
      const hasCurrentSelection = Boolean(stateRef.current.selectedAgentId);
      const preferredSelectedAgentExists =
        preferredSelectedAgentId.length > 0 &&
        result.seeds.some((seed) => seed.agentId === preferredSelectedAgentId);
      const initialSelectedAgentId = hasCurrentSelection
        ? undefined
        : preferredSelectedAgentExists
          ? preferredSelectedAgentId
          : result.suggestedSelectedAgentId ?? undefined;
      hydrateAgents(result.seeds, initialSelectedAgentId);
      const sessionSettingsSyncedAgentIds = new Set(result.sessionSettingsSyncedAgentIds);
      for (const agentId of result.sessionCreatedAgentIds) {
        dispatch({
          type: "updateAgent",
          agentId,
          patch: {
            sessionCreated: true,
            sessionSettingsSynced: sessionSettingsSyncedAgentIds.has(agentId),
          },
        });
      }
      for (const entry of result.summaryPatches) {
        dispatch({
          type: "updateAgent",
          agentId: entry.agentId,
          patch: entry.patch,
        });
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
    setError,
    setLoading,
    gatewayUrl,
    gatewayConfigSnapshot,
    settingsCoordinator,
    status,
  ]);

  const applyPendingCreateSetupForAgentId = useCallback(
    async (params: { agentId: string; source: "auto" | "manual" }) => {
      return await applyPendingGuidedSetupRetryViaStudio({
        agentId: params.agentId,
        source: params.source,
        retryBusyAgentId: retryPendingSetupBusyAgentId,
        inFlightAgentIds: pendingSetupAutoRetryInFlightRef.current,
        pendingSetupsByAgentId: pendingCreateSetupsByAgentIdRef.current,
        setRetryBusyAgentId: setRetryPendingSetupBusyAgentId,
        executeRetry: async (agentId) =>
          runGuidedRetryWorkflow(agentId, {
            applyPendingSetup: async (targetAgentId) =>
              applyPendingGuidedSetupForAgent({
                client,
                agentId: targetAgentId,
                pendingSetupsByAgentId: pendingCreateSetupsByAgentIdRef.current,
              }),
            removePending: (targetAgentId) => {
              setPendingCreateSetupsByAgentId((current) =>
                removePendingGuidedSetup(current, targetAgentId)
              );
            },
          }),
        isDisconnectLikeError: isGatewayDisconnectLikeError,
        resolveAgentName: (agentId) =>
          stateRef.current.agents.find((agent) => agent.agentId === agentId)?.name ??
          agentId,
        onApplied: async () => {
          await loadAgents();
        },
        onError: (message) => {
          setError(message);
        },
      });
    },
    [client, loadAgents, retryPendingSetupBusyAgentId, setError]
  );

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    pendingCreateSetupsByAgentIdRef.current = pendingCreateSetupsByAgentId;
  }, [pendingCreateSetupsByAgentId]);

  useEffect(() => {
    if (status === "connected") return;
    setAgentsLoadedOnce(false);
  }, [gatewayUrl, status]);

  useEffect(() => {
    let cancelled = false;
    const key = gatewayUrl.trim();
    if (!key) {
      preferredSelectedAgentIdRef.current = null;
      setFocusedPreferencesLoaded(true);
      return;
    }
    setFocusedPreferencesLoaded(false);
    focusFilterTouchedRef.current = false;
    preferredSelectedAgentIdRef.current = null;
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
          preferredSelectedAgentIdRef.current = preference.selectedAgentId;
          setFocusFilter(preference.filter);
          return;
        }
        preferredSelectedAgentIdRef.current = null;
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
    if (!key) return;
    if (!focusFilterTouchedRef.current) return;
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
  }, [focusFilter, gatewayUrl, settingsCoordinator]);

  useEffect(() => {
    const key = gatewayUrl.trim();
    if (!key) return;
    if (status !== "connected") return;
    if (!focusedPreferencesLoaded || !agentsLoadedOnce) return;
    settingsCoordinator.schedulePatch(
      {
        focused: {
          [key]: {
            mode: "focused",
            selectedAgentId: state.selectedAgentId,
          },
        },
      },
      300
    );
  }, [
    agentsLoadedOnce,
    focusedPreferencesLoaded,
    gatewayUrl,
    settingsCoordinator,
    status,
    state.selectedAgentId,
  ]);

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
    const loaded = loadPendingGuidedSetupsForScope({
      storage: window.sessionStorage,
      gatewayScope: pendingGuidedSetupGatewayScope,
    });
    setPendingCreateSetupsByAgentId(loaded.setupsByAgentId);
    setPendingCreateSetupsLoadedScope(loaded.loadedScope);
  }, [pendingGuidedSetupGatewayScope]);

  useEffect(() => {
    pendingSetupAutoRetryAttemptedRef.current.clear();
    pendingSetupAutoRetryInFlightRef.current.clear();
    setRetryPendingSetupBusyAgentId(null);
  }, [pendingGuidedSetupGatewayScope]);

  useEffect(() => {
    if (status === "connected") return;
    pendingSetupAutoRetryAttemptedRef.current.clear();
    pendingSetupAutoRetryInFlightRef.current.clear();
    setRetryPendingSetupBusyAgentId(null);
  }, [status]);

  useEffect(() => {
    persistPendingGuidedSetupsForScopeWhenLoaded({
      storage: window.sessionStorage,
      gatewayScope: pendingGuidedSetupGatewayScope,
      loadedScope: pendingCreateSetupsLoadedScope,
      setupsByAgentId: pendingCreateSetupsByAgentId,
    });
  }, [pendingCreateSetupsByAgentId, pendingCreateSetupsLoadedScope, pendingGuidedSetupGatewayScope]);

  useEffect(() => {
    void runPendingGuidedSetupAutoRetryViaStudio({
      status,
      agentsLoadedOnce,
      loadedScopeMatches: pendingCreateSetupsLoadedScope === pendingGuidedSetupGatewayScope,
      hasActiveCreateBlock: Boolean(createAgentBlock && createAgentBlock.phase !== "queued"),
      retryBusyAgentId: retryPendingSetupBusyAgentId,
      pendingSetupsByAgentId: pendingCreateSetupsByAgentId,
      knownAgentIds: new Set(agents.map((agent) => agent.agentId)),
      attemptedAgentIds: pendingSetupAutoRetryAttemptedRef.current,
      inFlightAgentIds: pendingSetupAutoRetryInFlightRef.current,
      applyRetry: (agentId) =>
        applyPendingCreateSetupForAgentId({
          agentId,
          source: "auto",
        }),
    });
  }, [
    agents,
    agentsLoadedOnce,
    applyPendingCreateSetupForAgentId,
    createAgentBlock,
    pendingCreateSetupsByAgentId,
    pendingCreateSetupsLoadedScope,
    pendingGuidedSetupGatewayScope,
    retryPendingSetupBusyAgentId,
    status,
  ]);

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
    const nowMs = Date.now();
    const delayMs = nextPendingApprovalPruneDelayMs({
      approvalsByAgentId: pendingExecApprovalsByAgentId,
      unscopedApprovals: unscopedPendingExecApprovals,
      nowMs,
      graceMs: PENDING_EXEC_APPROVAL_PRUNE_GRACE_MS,
    });
    if (delayMs === null) return;
    const timerId = window.setTimeout(() => {
      const pruneNowMs = Date.now();
      setPendingExecApprovalsByAgentId((current) =>
        pruneExpiredPendingApprovalsMap(current, {
          nowMs: pruneNowMs,
          graceMs: PENDING_EXEC_APPROVAL_PRUNE_GRACE_MS,
        })
      );
      setUnscopedPendingExecApprovals((current) =>
        pruneExpiredPendingApprovals(current, {
          nowMs: pruneNowMs,
          graceMs: PENDING_EXEC_APPROVAL_PRUNE_GRACE_MS,
        })
      );
    }, delayMs);
    return () => {
      window.clearTimeout(timerId);
    };
  }, [pendingExecApprovalsByAgentId, unscopedPendingExecApprovals]);

  useEffect(() => {
    const pendingCountsByAgentId = new Map<string, number>();
    for (const [agentId, approvals] of Object.entries(pendingExecApprovalsByAgentId)) {
      if (approvals.length <= 0) continue;
      pendingCountsByAgentId.set(agentId, approvals.length);
    }
    for (const agent of agents) {
      const awaiting = (pendingCountsByAgentId.get(agent.agentId) ?? 0) > 0;
      if (agent.awaitingUserInput === awaiting) continue;
      dispatch({
        type: "updateAgent",
        agentId: agent.agentId,
        patch: { awaitingUserInput: awaiting },
      });
    }
  }, [agents, dispatch, pendingExecApprovalsByAgentId]);

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
    const snapshotAgents = stateRef.current.agents;
    const summaryIntent = resolveSummarySnapshotIntent({
      agents: snapshotAgents,
      maxKeys: 64,
    });
    if (summaryIntent.kind === "skip") return;
    const activeAgents = snapshotAgents.filter((agent) => agent.sessionCreated);
    try {
      const [statusSummary, previewResult] = await Promise.all([
        client.call<SummaryStatusSnapshot>("status", {}),
        client.call<SummaryPreviewSnapshot>("sessions.preview", {
          keys: summaryIntent.keys,
          limit: summaryIntent.limit,
          maxChars: summaryIntent.maxChars,
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
      const kind = resolveLatestUpdateKind(lastMessage);
      const key = agent.agentId;
      const marker = kind === "heartbeat" ? `${lastMessage}:${heartbeatTick}` : lastMessage;
      const previous = specialUpdateRef.current.get(key);
      if (previous === marker) continue;
      specialUpdateRef.current.set(key, marker);
      void updateSpecialLatestUpdate(agent.agentId, agent, lastMessage);
    }
  }, [agents, heartbeatTick, updateSpecialLatestUpdate]);

  const loadAgentHistory = useCallback(
    async (agentId: string, options?: { limit?: number }) => {
      const historyRequestId = randomUUID();
      const loadedAt = Date.now();
      const commands = await runHistorySyncOperation({
        client,
        agentId,
        requestedLimit: options?.limit,
        getAgent: (targetAgentId) =>
          stateRef.current.agents.find((entry) => entry.agentId === targetAgentId) ?? null,
        inFlightSessionKeys: historyInFlightRef.current,
        requestId: historyRequestId,
        loadedAt,
        defaultLimit: DEFAULT_CHAT_HISTORY_LIMIT,
        maxLimit: MAX_CHAT_HISTORY_LIMIT,
        transcriptV2Enabled: TRANSCRIPT_V2_ENABLED,
      });
      executeHistorySyncCommands({
        commands,
        dispatch,
        logMetric: (metric, meta) => logTranscriptDebugMetric(metric, meta),
        isDisconnectLikeError: isGatewayDisconnectLikeError,
        logError: (message) => console.error(message),
      });
    },
    [client, dispatch]
  );

  const loadMoreAgentHistory = useCallback(
    (agentId: string) => {
      const agent = stateRef.current.agents.find((entry) => entry.agentId === agentId);
      const currentLimit = agent?.historyFetchLimit ?? DEFAULT_CHAT_HISTORY_LIMIT;
      const nextLimit = Math.min(MAX_CHAT_HISTORY_LIMIT, Math.max(400, currentLimit * 2));
      void loadAgentHistory(agentId, { limit: nextLimit });
    },
    [loadAgentHistory]
  );

  const reconcileRunningAgents = useCallback(async () => {
    if (status !== "connected") return;
    const snapshot = stateRef.current.agents;
    const commands = await runAgentReconcileOperation({
      client,
      agents: snapshot,
      getLatestAgent: (agentId) =>
        stateRef.current.agents.find((entry) => entry.agentId === agentId) ?? null,
      claimRunId: (runId) => {
        const normalized = runId.trim();
        if (!normalized) return false;
        if (reconcileRunInFlightRef.current.has(normalized)) return false;
        reconcileRunInFlightRef.current.add(normalized);
        return true;
      },
      releaseRunId: (runId) => {
        const normalized = runId.trim();
        if (!normalized) return;
        reconcileRunInFlightRef.current.delete(normalized);
      },
      isDisconnectLikeError: isGatewayDisconnectLikeError,
    });
    executeAgentReconcileCommands({
      commands,
      dispatch,
      clearRunTracking: (runId) => {
        runtimeEventHandlerRef.current?.clearRunTracking(runId);
      },
      requestHistoryRefresh: (agentId) => {
        void loadAgentHistory(agentId);
      },
      logInfo: (message) => {
        console.info(message);
      },
      logWarn: (message, error) => {
        console.warn(message, error);
      },
    });
  }, [client, dispatch, loadAgentHistory, status]);

  useEffect(() => {
    if (status !== "connected") return;
    void reconcileRunningAgents();
    const timer = window.setInterval(() => {
      void reconcileRunningAgents();
    }, 3000);
    return () => {
      window.clearInterval(timer);
    };
  }, [reconcileRunningAgents, status]);

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
      const guard = resolveMutationStartGuard({
        status: "connected",
        hasCreateBlock: Boolean(createAgentBlock),
        hasRenameBlock: Boolean(renameAgentBlock),
        hasDeleteBlock: Boolean(deleteAgentBlock),
      });
      if (guard.kind === "deny") return;
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
      const queuedDeleteBlock = buildQueuedMutationBlock({
        kind: "delete-agent",
        agentId,
        agentName: agent.name,
        startedAt: Date.now(),
      });
      setDeleteAgentBlock({
        agentId: queuedDeleteBlock.agentId,
        agentName: queuedDeleteBlock.agentName,
        phase: "queued",
        startedAt: queuedDeleteBlock.startedAt,
        sawDisconnect: queuedDeleteBlock.sawDisconnect,
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
            const result = await runConfigMutationWorkflow(
              { kind: "delete-agent", isLocalGateway },
              {
                executeMutation: async () => {
                  await deleteAgentViaStudio({
                    client,
                    agentId,
                    fetchJson,
                    logError: (message, error) => console.error(message, error),
                  });
                  setSettingsAgentId(null);
                },
                shouldAwaitRemoteRestart: async () =>
                  shouldAwaitDisconnectRestartForRemoteMutation({
                    client,
                    cachedConfigSnapshot: gatewayConfigSnapshot,
                    logError: (message, error) => console.error(message, error),
                  }),
              }
            );
            const commands = buildMutationSideEffectCommands({
              disposition: result.disposition,
            });
            for (const command of commands) {
              if (command.kind === "reload-agents") {
                await loadAgents();
                continue;
              }
              if (command.kind === "clear-mutation-block") {
                setDeleteAgentBlock(null);
                continue;
              }
              if (command.kind === "set-mobile-pane") {
                setMobilePane(command.pane);
                continue;
              }
              setDeleteAgentBlock((current) => {
                if (!current || current.agentId !== agentId) return current;
                return {
                  ...current,
                  ...command.patch,
                };
              });
            }
          },
        });
      } catch (err) {
        const msg = buildConfigMutationFailureMessage({
          kind: "delete-agent",
          error: err,
        });
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
      gatewayConfigSnapshot,
      isLocalGateway,
      loadAgents,
      renameAgentBlock,
      setError,
    ]
  );

  useGatewayRestartBlock({
    status,
    block: deleteAgentBlock,
    setBlock: setDeleteAgentBlock,
    maxWaitMs: 90_000,
    onTimeout: () => {
      setDeleteAgentBlock(null);
      setError("Gateway restart timed out after deleting the agent.");
    },
    onRestartComplete: async (_, ctx) => {
      await loadAgents();
      if (ctx.isCancelled()) return;
      setDeleteAgentBlock(null);
      setMobilePane("chat");
    },
  });

  const handleCreateCronJob = useCallback(
    async (agentId: string, draft: CronCreateDraft) => {
      try {
        await performCronCreateFlow({
          client,
          agentId,
          draft,
          busy: {
            createBusy: cronCreateBusy,
            runBusyJobId: cronRunBusyJobId,
            deleteBusyJobId: cronDeleteBusyJobId,
          },
          onBusyChange: setCronCreateBusy,
          onError: setSettingsCronError,
          onJobs: setSettingsCronJobs,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to create cron job.";
        if (!isGatewayDisconnectLikeError(err)) {
          console.error(message);
        }
        throw err;
      }
    },
    [client, cronCreateBusy, cronDeleteBusyJobId, cronRunBusyJobId]
  );

  const handleRunCronJob = useCallback(
    async (agentId: string, jobId: string) => {
      const resolvedJobId = jobId.trim();
      const resolvedAgentId = agentId.trim();
      if (!resolvedJobId || !resolvedAgentId) return;
      if (cronCreateBusy || cronRunBusyJobId || cronDeleteBusyJobId) return;
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
    [client, cronCreateBusy, cronDeleteBusyJobId, cronRunBusyJobId, loadCronJobsForSettingsAgent]
  );

  const handleDeleteCronJob = useCallback(
    async (agentId: string, jobId: string) => {
      const resolvedJobId = jobId.trim();
      const resolvedAgentId = agentId.trim();
      if (!resolvedJobId || !resolvedAgentId) return;
      if (cronCreateBusy || cronRunBusyJobId || cronDeleteBusyJobId) return;
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
    [client, cronCreateBusy, cronDeleteBusyJobId, cronRunBusyJobId, loadCronJobsForSettingsAgent]
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

  const handleOpenCreateAgentModal = useCallback(() => {
    if (createAgentBusy) return;
    if (createAgentBlock) return;
    if (deleteAgentBlock) return;
    if (renameAgentBlock) return;
    setCreateAgentModalError(null);
    setCreateAgentModalOpen(true);
  }, [createAgentBlock, createAgentBusy, deleteAgentBlock, renameAgentBlock]);

  const persistAvatarSeed = useCallback(
    (agentId: string, avatarSeed: string) => {
      const resolvedAgentId = agentId.trim();
      const resolvedAvatarSeed = avatarSeed.trim();
      const key = gatewayUrl.trim();
      if (!resolvedAgentId || !resolvedAvatarSeed || !key) return;
      settingsCoordinator.schedulePatch(
        {
          avatars: {
            [key]: {
              [resolvedAgentId]: resolvedAvatarSeed,
            },
          },
        },
        0
      );
    },
    [gatewayUrl, settingsCoordinator]
  );

  const handleCreateAgentSubmit = useCallback(
    async (payload: AgentCreateModalSubmitPayload) => {
      if (createAgentBusy) return;
      const guard = resolveMutationStartGuard({
        status,
        hasCreateBlock: Boolean(createAgentBlock),
        hasRenameBlock: Boolean(renameAgentBlock),
        hasDeleteBlock: Boolean(deleteAgentBlock),
      });
      if (guard.kind === "deny") {
        if (guard.reason !== "not-connected") return;
        setCreateAgentModalError("Connect to gateway before creating an agent.");
        return;
      }

      const name = payload.name.trim();
      const selectedAvatarSeed = payload.avatarSeed?.trim() ?? "";
      if (!name) {
        setCreateAgentModalError("Agent name is required.");
        return;
      }

      const compiled = compileGuidedAgentCreation({ name, draft: payload.draft });
      if (compiled.validation.errors.length > 0) {
        setCreateAgentModalError(compiled.validation.errors[0] ?? "Guided setup is incomplete.");
        return;
      }
      const setup: AgentGuidedSetup = {
        agentOverrides: compiled.agentOverrides,
        files: compiled.files,
        execApprovals: compiled.execApprovals,
      };

      setCreateAgentBusy(true);
      setCreateAgentModalError(null);
      const queuedCreateBlock = buildQueuedMutationBlock({
        kind: "create-agent",
        agentId: "",
        agentName: name,
        startedAt: Date.now(),
      });
      setCreateAgentBlock({
        agentId: null,
        agentName: queuedCreateBlock.agentName,
        phase: "queued",
        startedAt: queuedCreateBlock.startedAt,
      });
      try {
        const queuedMutation = enqueueConfigMutation({
          kind: "create-agent",
          label: `Create ${name}`,
          run: async () => {
            setCreateAgentBlock((current) => {
              if (!current || current.agentName !== name) return current;
              return { ...current, phase: "creating" };
            });
            const result = await runGuidedCreateWorkflow(
              {
                name,
                setup,
                isLocalGateway,
              },
              {
                createAgent: async (agentName) => {
                  const created = await createGatewayAgent({ client, name: agentName });
                  if (selectedAvatarSeed) {
                    persistAvatarSeed(created.id, selectedAvatarSeed);
                  }
                  flushPendingDraft(focusedAgent?.agentId ?? null);
                  focusFilterTouchedRef.current = true;
                  setFocusFilter("all");
                  dispatch({ type: "selectAgent", agentId: created.id });
                  setSettingsAgentId(null);
                  setMobilePane("chat");
                  return { id: created.id };
                },
                applySetup: async (agentId, nextSetup) => {
                  setCreateAgentBlock((current) => {
                    if (!current || current.agentName !== name) return current;
                    return { ...current, agentId, phase: "applying-setup" };
                  });
                  await applyGuidedAgentSetup({
                    client,
                    agentId,
                    setup: nextSetup,
                  });
                },
                upsertPending: (agentId, nextSetup) => {
                  setPendingCreateSetupsByAgentId((current) =>
                    upsertPendingGuidedSetup(current, agentId, nextSetup)
                  );
                },
                removePending: (agentId) => {
                  setPendingCreateSetupsByAgentId((current) =>
                    removePendingGuidedSetup(current, agentId)
                  );
                },
              }
            );
            const completion = resolveGuidedCreateCompletion({
              agentName: name,
              result,
            });
            if (completion.shouldReloadAgents) {
              await loadAgents();
            }
            setCreateAgentBlock(null);
            if (completion.shouldCloseCreateModal) {
              setCreateAgentModalOpen(false);
            }
            setMobilePane("chat");
            if (completion.pendingErrorMessage) {
              setError(completion.pendingErrorMessage);
            }
          },
        });
        setCreateAgentModalOpen(false);
        await queuedMutation;
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to create agent.";
        setCreateAgentBlock(null);
        setCreateAgentModalError(message);
        setError(message);
      } finally {
        setCreateAgentBusy(false);
      }
    },
    [
      client,
      createAgentBusy,
      createAgentBlock,
      deleteAgentBlock,
      dispatch,
      enqueueConfigMutation,
      flushPendingDraft,
      focusedAgent,
      isLocalGateway,
      loadAgents,
      persistAvatarSeed,
      renameAgentBlock,
      setError,
      status,
    ]
  );

  useEffect(() => {
    if (!createAgentBlock || createAgentBlock.phase === "queued") return;
    const elapsed = Date.now() - createAgentBlock.startedAt;
    const remaining = Math.max(0, 90_000 - elapsed);
    const timeoutId = window.setTimeout(() => {
      setCreateAgentBlock(null);
      setCreateAgentModalOpen(false);
      void loadAgents();
      setError("Agent creation timed out.");
    }, remaining);
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [createAgentBlock, loadAgents, setError]);

  useGatewayRestartBlock({
    status,
    block: renameAgentBlock,
    setBlock: setRenameAgentBlock,
    maxWaitMs: 90_000,
    onTimeout: () => {
      setRenameAgentBlock(null);
      setError("Gateway restart timed out after renaming the agent.");
    },
    onRestartComplete: async (_, ctx) => {
      await loadAgents();
      if (ctx.isCancelled()) return;
      setRenameAgentBlock(null);
      setMobilePane("chat");
    },
  });

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

  const handleRetryPendingCreateSetup = useCallback(
    async (agentId: string) => {
      const resolvedAgentId = agentId.trim();
      if (!resolvedAgentId) return;
      await applyPendingCreateSetupForAgentId({
        agentId: resolvedAgentId,
        source: "manual",
      });
    },
    [applyPendingCreateSetupForAgentId]
  );

  const handleDiscardPendingCreateSetup = useCallback((agentId: string) => {
    const resolvedAgentId = agentId.trim();
    if (!resolvedAgentId) return;
    const confirmed = window.confirm(
      `Discard pending guided setup for "${resolvedAgentId}"? The agent will remain unchanged.`
    );
    if (!confirmed) return;
    setPendingCreateSetupsByAgentId((current) =>
      removePendingGuidedSetup(current, resolvedAgentId)
    );
  }, []);

  const handleResolveExecApproval = useCallback(
    async (approvalId: string, decision: ExecApprovalDecision) => {
      await resolveExecApprovalViaStudio({
        client,
        approvalId,
        decision,
        getAgents: () => stateRef.current.agents,
        getLatestAgent: (agentId) =>
          stateRef.current.agents.find((entry) => entry.agentId === agentId) ?? null,
        getPendingState: () => ({
          approvalsByAgentId: pendingExecApprovalsByAgentId,
          unscopedApprovals: unscopedPendingExecApprovals,
        }),
        setPendingExecApprovalsByAgentId,
        setUnscopedPendingExecApprovals,
        requestHistoryRefresh: (agentId) => loadAgentHistory(agentId),
        isDisconnectLikeError: isGatewayDisconnectLikeError,
        logWarn: (message, error) => console.warn(message, error),
      });
    },
    [client, loadAgentHistory, pendingExecApprovalsByAgentId, unscopedPendingExecApprovals]
  );

  const handleExecApprovalEvent = useCallback(
    (event: EventFrame) => {
      const effects = resolveExecApprovalEventEffects({
        event,
        agents: stateRef.current.agents,
      });
      if (!effects) return;
      for (const removalId of effects.removals) {
        setPendingExecApprovalsByAgentId((current) => {
          return removePendingApprovalByIdMap(current, removalId);
        });
        setUnscopedPendingExecApprovals((current) => {
          return removePendingApprovalById(current, removalId);
        });
      }
      for (const scopedUpsert of effects.scopedUpserts) {
        setPendingExecApprovalsByAgentId((current) => {
          const withoutExisting = removePendingApprovalByIdMap(current, scopedUpsert.approval.id);
          const existing = withoutExisting[scopedUpsert.agentId] ?? [];
          const upserted = upsertPendingApproval(existing, scopedUpsert.approval);
          if (upserted === existing) return withoutExisting;
          return {
            ...withoutExisting,
            [scopedUpsert.agentId]: upserted,
          };
        });
        setUnscopedPendingExecApprovals((current) =>
          removePendingApprovalById(current, scopedUpsert.approval.id)
        );
      }
      for (const unscopedUpsert of effects.unscopedUpserts) {
        setPendingExecApprovalsByAgentId((current) =>
          removePendingApprovalByIdMap(current, unscopedUpsert.id)
        );
        setUnscopedPendingExecApprovals((current) => {
          const withoutExisting = removePendingApprovalById(current, unscopedUpsert.id);
          return upsertPendingApproval(withoutExisting, unscopedUpsert);
        });
      }
      for (const agentId of effects.markActivityAgentIds) {
        dispatch({ type: "markActivity", agentId });
      }
    },
    [dispatch]
  );

  useEffect(() => {
    const handler = createGatewayRuntimeEventHandler({
      getStatus: () => status,
      getAgents: () => stateRef.current.agents,
      dispatch,
      queueLivePatch,
      clearPendingLivePatch,
      loadSummarySnapshot,
      requestHistoryRefresh: ({ agentId }) => loadAgentHistory(agentId),
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
    const unsubscribe = client.onEvent((event: EventFrame) => {
      handler.handleEvent(event);
      handleExecApprovalEvent(event);
      if (event.event === "cron") {
        const payload = event.payload;
        if (!payload || typeof payload !== "object") return;
        const record = payload as Record<string, unknown>;
        if (record.action !== "finished") return;
        const sessionKey = typeof record.sessionKey === "string" ? record.sessionKey.trim() : "";
        if (!sessionKey) return;
        const agentId = parseAgentIdFromSessionKey(sessionKey);
        if (!agentId) return;
        const jobId = typeof record.jobId === "string" ? record.jobId.trim() : "";
        if (!jobId) return;
        const sessionId = typeof record.sessionId === "string" ? record.sessionId.trim() : "";
        const runAtMs = typeof record.runAtMs === "number" ? record.runAtMs : null;
        const status = typeof record.status === "string" ? record.status.trim() : "";
        const error = typeof record.error === "string" ? record.error.trim() : "";
        const summary = typeof record.summary === "string" ? record.summary.trim() : "";

        const dedupeKey = `cron:${jobId}:${sessionId || (runAtMs ?? "none")}`;
        if (seenCronEventIdsRef.current.has(dedupeKey)) return;
        seenCronEventIdsRef.current.add(dedupeKey);

        const agent = stateRef.current.agents.find((entry) => entry.agentId === agentId) ?? null;
        if (!agent) return;

        const header = `Cron finished (${status || "unknown"}): ${jobId}`;
        const body = summary || error || "(no output)";
        dispatch({
          type: "appendOutput",
          agentId,
          line: `${header}\n\n${body}`,
          transcript: {
            source: "runtime-agent",
            role: "assistant",
            kind: "assistant",
            sessionKey: agent.sessionKey,
            timestampMs: runAtMs ?? Date.now(),
            entryId: dedupeKey,
            confirmed: true,
          },
        });
        dispatch({ type: "markActivity", agentId, at: runAtMs ?? undefined });
      }
    });
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
    clearPendingLivePatch,
    queueLivePatch,
    refreshHeartbeatLatestUpdate,
    handleExecApprovalEvent,
    status,
    updateSpecialLatestUpdate,
  ]);

  useEffect(() => {
    return client.onGap((info) => {
      console.warn(`Gateway event gap expected ${info.expected}, received ${info.received}.`);
      void loadSummarySnapshot();
      void reconcileRunningAgents();
    });
  }, [client, loadSummarySnapshot, reconcileRunningAgents]);

  const handleRenameAgent = useCallback(
    async (agentId: string, name: string) => {
      const guard = resolveMutationStartGuard({
        status: "connected",
        hasCreateBlock: Boolean(createAgentBlock),
        hasRenameBlock: Boolean(renameAgentBlock),
        hasDeleteBlock: Boolean(deleteAgentBlock),
      });
      if (guard.kind === "deny") return false;
      const agent = agents.find((entry) => entry.agentId === agentId);
      if (!agent) return false;
      try {
        const queuedRenameBlock = buildQueuedMutationBlock({
          kind: "rename-agent",
          agentId,
          agentName: name,
          startedAt: Date.now(),
        });
        setRenameAgentBlock({
          agentId: queuedRenameBlock.agentId,
          agentName: queuedRenameBlock.agentName,
          phase: "queued",
          startedAt: queuedRenameBlock.startedAt,
          sawDisconnect: queuedRenameBlock.sawDisconnect,
        });
        await enqueueConfigMutation({
          kind: "rename-agent",
          label: `Rename ${agent.name}`,
          run: async () => {
            setRenameAgentBlock((current) => {
              if (!current || current.agentId !== agentId) return current;
              return { ...current, phase: "renaming" };
            });
            const result = await runConfigMutationWorkflow(
              { kind: "rename-agent", isLocalGateway },
              {
                executeMutation: async () => {
                  await renameGatewayAgent({
                    client,
                    agentId,
                    name,
                  });
                  dispatch({
                    type: "updateAgent",
                    agentId,
                    patch: { name },
                  });
                },
                shouldAwaitRemoteRestart: async () =>
                  shouldAwaitDisconnectRestartForRemoteMutation({
                    client,
                    cachedConfigSnapshot: gatewayConfigSnapshot,
                    logError: (message, error) => console.error(message, error),
                  }),
              }
            );
            const commands = buildMutationSideEffectCommands({
              disposition: result.disposition,
            });
            for (const command of commands) {
              if (command.kind === "reload-agents") {
                await loadAgents();
                continue;
              }
              if (command.kind === "clear-mutation-block") {
                setRenameAgentBlock(null);
                continue;
              }
              if (command.kind === "set-mobile-pane") {
                setMobilePane(command.pane);
                continue;
              }
              setRenameAgentBlock((current) => {
                if (!current || current.agentId !== agentId) return current;
                return {
                  ...current,
                  ...command.patch,
                };
              });
            }
          },
        });
        return true;
      } catch (err) {
        const message = buildConfigMutationFailureMessage({
          kind: "rename-agent",
          error: err,
        });
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
      gatewayConfigSnapshot,
      isLocalGateway,
      loadAgents,
      renameAgentBlock,
      setError,
    ]
  );

  type ExecutionRoleId = "conservative" | "collaborative" | "autonomous";

  const handleUpdateExecutionRole = useCallback(
    async (agentId: string, role: ExecutionRoleId) => {
      const guard = resolveMutationStartGuard({
        status: "connected",
        hasCreateBlock: Boolean(createAgentBlock),
        hasRenameBlock: Boolean(renameAgentBlock),
        hasDeleteBlock: Boolean(deleteAgentBlock),
      });
      if (guard.kind === "deny") return;

      const resolvedAgentId = agentId.trim();
      if (!resolvedAgentId) return;
      const agent = agents.find((entry) => entry.agentId === resolvedAgentId) ?? null;
      if (!agent) return;

      await enqueueConfigMutation({
        kind: "update-agent-execution-role",
        label: `Update execution role for ${agent.name}`,
        run: async () => {
          const existingPolicy = await readGatewayAgentExecApprovals({
            client,
            agentId: resolvedAgentId,
          });
          const allowlist = existingPolicy?.allowlist ?? [];
          const nextPolicy =
            role === "conservative"
              ? null
              : role === "autonomous"
                ? {
                    security: "full" as const,
                    ask: "off" as const,
                    allowlist,
                  }
                : {
                    security: "allowlist" as const,
                    ask: "always" as const,
                    allowlist,
                  };

          await upsertGatewayAgentExecApprovals({
            client,
            agentId: resolvedAgentId,
            policy: nextPolicy,
          });

          const snapshot = await client.call<{ config?: unknown }>("config.get", {});
          const baseConfig =
            snapshot.config && typeof snapshot.config === "object" && !Array.isArray(snapshot.config)
              ? (snapshot.config as Record<string, unknown>)
              : undefined;
          const list = readConfigAgentList(baseConfig);
          const configEntry = list.find((entry) => entry.id === resolvedAgentId) ?? null;
          const sandboxRaw =
            configEntry && typeof (configEntry as Record<string, unknown>).sandbox === "object"
              ? ((configEntry as Record<string, unknown>).sandbox as unknown)
              : null;
          const sandbox =
            sandboxRaw && typeof sandboxRaw === "object" && !Array.isArray(sandboxRaw)
              ? (sandboxRaw as Record<string, unknown>)
              : null;
          const sandboxMode =
            typeof sandbox?.mode === "string" ? sandbox.mode.trim().toLowerCase() : "";

          const toolsRaw =
            configEntry && typeof (configEntry as Record<string, unknown>).tools === "object"
              ? ((configEntry as Record<string, unknown>).tools as unknown)
              : null;
          const tools =
            toolsRaw && typeof toolsRaw === "object" && !Array.isArray(toolsRaw)
              ? (toolsRaw as Record<string, unknown>)
              : null;
          const coerceStringArray = (value: unknown): string[] | null => {
            if (!Array.isArray(value)) return null;
            return value
              .filter((item): item is string => typeof item === "string")
              .map((item) => item.trim())
              .filter((item) => item.length > 0);
          };

          const existingAllow = coerceStringArray(tools?.allow);
          const existingAlsoAllow = coerceStringArray(tools?.alsoAllow);
          const existingDeny = coerceStringArray(tools?.deny) ?? [];

          const usesAllow = existingAllow !== null;
          const baseAllowed = new Set(usesAllow ? existingAllow : existingAlsoAllow ?? []);
          const deny = new Set(existingDeny);

          if (role === "conservative") {
            baseAllowed.delete("group:runtime");
            deny.add("group:runtime");
          } else {
            baseAllowed.add("group:runtime");
            deny.delete("group:runtime");
          }

          const allowedList = Array.from(baseAllowed);
          const denyList = Array.from(deny).filter((entry) => !baseAllowed.has(entry));

          await updateGatewayAgentOverrides({
            client,
            agentId: resolvedAgentId,
            overrides: {
              tools: usesAllow ? { allow: allowedList, deny: denyList } : { alsoAllow: allowedList, deny: denyList },
            },
          });

          const execHost =
            role === "conservative"
              ? null
              : sandboxMode === "all"
                ? "sandbox"
                : "gateway";
          const execSecurity =
            role === "conservative"
              ? "deny"
              : role === "autonomous"
                ? "full"
                : "allowlist";
          const execAsk =
            role === "conservative" ? "off" : role === "autonomous" ? "off" : "always";
          await syncGatewaySessionSettings({
            client,
            sessionKey: agent.sessionKey,
            execHost,
            execSecurity,
            execAsk,
          });

          await loadAgents();
        },
      });
    },
    [
      agents,
      client,
      createAgentBlock,
      deleteAgentBlock,
      enqueueConfigMutation,
      loadAgents,
      renameAgentBlock,
    ]
  );

  const handleAvatarShuffle = useCallback(
    async (agentId: string) => {
      const avatarSeed = randomUUID();
      dispatch({
        type: "updateAgent",
        agentId,
        patch: { avatarSeed },
      });
      persistAvatarSeed(agentId, avatarSeed);
    },
    [dispatch, persistAvatarSeed]
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
      : createAgentBlock.phase === "applying-setup"
        ? "Applying guided setup"
        : null
    : null;
  const renameBlockStatusLine = resolveConfigMutationStatusLine({
    block: renameAgentBlock
      ? {
          phase: renameAgentBlock.phase === "renaming" ? "mutating" : renameAgentBlock.phase,
          sawDisconnect: renameAgentBlock.sawDisconnect,
        }
      : null,
    status,
  });
  const deleteBlockStatusLine = resolveConfigMutationStatusLine({
    block: deleteAgentBlock
      ? {
          phase: deleteAgentBlock.phase === "deleting" ? "mutating" : deleteAgentBlock.phase,
          sawDisconnect: deleteAgentBlock.sawDisconnect,
        }
      : null,
    status,
  });

  useEffect(() => {
    if (status === "connecting") {
      setDidAttemptGatewayConnect(true);
    }
  }, [status]);

  useEffect(() => {
    if (gatewayError) {
      setDidAttemptGatewayConnect(true);
    }
  }, [gatewayError]);

  if (!agentsLoadedOnce && (!didAttemptGatewayConnect || status === "connecting")) {
    return (
      <div className="relative min-h-screen w-screen overflow-hidden bg-background">
        <div className="flex min-h-screen items-center justify-center px-6">
          <div className="glass-panel w-full max-w-md px-6 py-6 text-center">
            <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              OpenClaw Studio
            </div>
            <div className="mt-3 text-sm text-muted-foreground">
              {status === "connecting" ? "Connecting to gateway…" : "Booting Studio…"}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (status === "disconnected" && !agentsLoadedOnce && didAttemptGatewayConnect) {
    return (
      <div className="relative min-h-screen w-screen overflow-hidden bg-background">
        <div className="relative z-10 flex h-screen flex-col gap-4 px-3 py-3 sm:px-4 sm:py-4 md:px-6 md:py-6">
          <div className="w-full">
            <HeaderBar
              status={status}
              onConnectionSettings={() => setShowConnectionPanel(true)}
              onBrainFiles={handleBrainToggle}
              brainFilesOpen={brainPanelOpen}
              brainDisabled
            />
          </div>
          <GatewayConnectScreen
            gatewayUrl={gatewayUrl}
            token={token}
            localGatewayDefaults={localGatewayDefaults}
            status={status}
            error={gatewayError}
            onGatewayUrlChange={setGatewayUrl}
            onTokenChange={setToken}
            onUseLocalDefaults={useLocalGatewayDefaults}
            onConnect={() => void connect()}
          />
        </div>
      </div>
    );
  }

  if (status === "connected" && !agentsLoadedOnce) {
    return (
      <div className="relative min-h-screen w-screen overflow-hidden bg-background">
        <div className="flex min-h-screen items-center justify-center px-6">
          <div className="glass-panel w-full max-w-md px-6 py-6 text-center">
            <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              OpenClaw Studio
            </div>
            <div className="mt-3 text-sm text-muted-foreground">Loading agents…</div>
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
      <div className="relative z-10 flex h-screen flex-col gap-3 px-3 py-3 sm:px-4 sm:py-4 md:px-5 md:py-5">
        <div className="w-full">
          <HeaderBar
            status={status}
            onConnectionSettings={() => setShowConnectionPanel(true)}
            onBrainFiles={handleBrainToggle}
            brainFilesOpen={brainPanelOpen}
            brainDisabled={!hasAnyAgents}
          />
        </div>

        {connectionPanelVisible ? (
          <div className="pointer-events-none fixed inset-x-0 top-20 z-[140] flex justify-center px-3 sm:px-4 md:px-5">
            <div className="glass-panel pointer-events-auto w-full max-w-4xl border border-border/80 !bg-card px-4 py-4 sm:px-6 sm:py-6">
              <ConnectionPanel
                gatewayUrl={gatewayUrl}
                token={token}
                status={status}
                error={gatewayError}
                onGatewayUrlChange={setGatewayUrl}
                onTokenChange={setToken}
                onConnect={() => void connect()}
                onDisconnect={disconnect}
                onClose={() => setShowConnectionPanel(false)}
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
            <div className="rounded-md border border-border/80 bg-surface-2 px-4 py-2 font-mono text-[11px] uppercase tracking-[0.11em] text-muted-foreground">
              {configMutationStatusLine}
            </div>
          </div>
        ) : null}

        <div className="flex min-h-0 flex-1 flex-col gap-4 xl:flex-row">
          <div className="glass-panel bg-surface-1 p-2 xl:hidden" data-testid="mobile-pane-toggle">
            <div className="grid grid-cols-4 gap-2">
              <button
                type="button"
                className={`rounded-md border px-2 py-2 font-mono text-[10px] font-semibold uppercase tracking-[0.13em] transition ${
                  mobilePane === "fleet"
                    ? "border-border bg-surface-2 text-foreground"
                    : "border-border/80 bg-surface-1 text-muted-foreground hover:border-border hover:bg-surface-2"
                }`}
                onClick={() => setMobilePane("fleet")}
              >
                Fleet
              </button>
              <button
                type="button"
                className={`rounded-md border px-2 py-2 font-mono text-[10px] font-semibold uppercase tracking-[0.13em] transition ${
                  mobilePane === "chat"
                    ? "border-border bg-surface-2 text-foreground"
                    : "border-border/80 bg-surface-1 text-muted-foreground hover:border-border hover:bg-surface-2"
                }`}
                onClick={() => setMobilePane("chat")}
              >
                Chat
              </button>
              <button
                type="button"
                className={`rounded-md border px-2 py-2 font-mono text-[10px] font-semibold uppercase tracking-[0.13em] transition ${
                  mobilePane === "settings"
                    ? "border-border bg-surface-2 text-foreground"
                    : "border-border/80 bg-surface-1 text-muted-foreground hover:border-border hover:bg-surface-2"
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
                    ? "border-border bg-surface-2 text-foreground"
                    : "border-border/80 bg-surface-1 text-muted-foreground hover:border-border hover:bg-surface-2"
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
                handleOpenCreateAgentModal();
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
            className={`${mobilePane === "chat" ? "flex" : "hidden"} min-h-0 flex-1 overflow-hidden rounded-md border border-border/80 bg-surface-1 xl:flex`}
            data-testid="focused-agent-panel"
          >
            {focusedAgent ? (
              <div className="flex min-h-0 flex-1 flex-col">
                {focusedPendingCreateSetup ? (
                  <div
                    className="mx-3 mt-3 rounded-md border border-amber-500/40 bg-amber-500/12 px-3 py-2 sm:mx-4"
                    data-testid="pending-guided-setup-card"
                  >
                    <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-amber-900">
                      Guided setup pending
                    </div>
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      This agent was created, but setup did not finish. Retry setup now or discard
                      the pending setup and keep the current agent state.
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="rounded-[8px] border border-border/70 bg-surface-3 px-2.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-foreground transition hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-60"
                        onClick={() => {
                          void handleRetryPendingCreateSetup(focusedAgent.agentId);
                        }}
                        disabled={status !== "connected" || focusedPendingCreateSetupBusy}
                      >
                        {focusedPendingCreateSetupBusy ? "Applying..." : "Retry setup"}
                      </button>
                      <button
                        type="button"
                        className="rounded-[8px] border border-border/70 bg-surface-3 px-2.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-foreground transition hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-60"
                        onClick={() => handleDiscardPendingCreateSetup(focusedAgent.agentId)}
                        disabled={focusedPendingCreateSetupBusy}
                      >
                        Discard pending setup
                      </button>
                    </div>
                  </div>
                ) : null}
                <div className="min-h-0 flex-1">
                  <AgentChatPanel
                    agent={focusedAgent}
                    isSelected={false}
                    canSend={status === "connected"}
                    models={gatewayModels}
                    stopBusy={stopBusyAgentId === focusedAgent.agentId}
                    stopDisabledReason={focusedAgentStopDisabledReason}
                    onLoadMoreHistory={() => loadMoreAgentHistory(focusedAgent.agentId)}
                    onOpenSettings={() => handleOpenAgentSettings(focusedAgent.agentId)}
                    onModelChange={(value) =>
                      handleModelChange(focusedAgent.agentId, focusedAgent.sessionKey, value)
                    }
                    onThinkingChange={(value) =>
                      handleThinkingChange(focusedAgent.agentId, focusedAgent.sessionKey, value)
                    }
                    onDraftChange={(value) => handleDraftChange(focusedAgent.agentId, value)}
                    onSend={(message) =>
                      handleSend(focusedAgent.agentId, focusedAgent.sessionKey, message)
                    }
                    onStopRun={() => handleStopRun(focusedAgent.agentId, focusedAgent.sessionKey)}
                    onAvatarShuffle={() => handleAvatarShuffle(focusedAgent.agentId)}
                    pendingExecApprovals={focusedPendingExecApprovals}
                    onResolveExecApproval={(id, decision) => {
                      void handleResolveExecApproval(id, decision);
                    }}
                  />
                </div>
              </div>
            ) : (
              <EmptyStatePanel
                title={hasAnyAgents ? "No agents match this filter." : "No agents available."}
                description={
                  hasAnyAgents
                    ? undefined
                    : status === "connected"
                      ? "Use New Agent in the sidebar to add your first agent."
                      : "Connect to your gateway to load agents into the studio."
                }
                fillHeight
                className="items-center p-6 text-center text-sm"
              />
            )}
          </div>
          {brainPanelOpen ? (
            <div
              className={`${mobilePane === "brain" ? "block" : "hidden"} glass-panel min-h-0 w-full shrink-0 overflow-hidden p-0 xl:block xl:min-w-[360px] xl:max-w-[430px] xl:border-l xl:border-border/70`}
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
              className={`${mobilePane === "settings" ? "block" : "hidden"} glass-panel min-h-0 w-full shrink-0 overflow-hidden p-0 xl:block xl:min-w-[360px] xl:max-w-[430px] xl:border-l xl:border-border/70`}
            >
              <AgentSettingsPanel
                key={settingsAgent.agentId}
                agent={settingsAgent}
                onClose={() => {
                  setSettingsAgentId(null);
                  setMobilePane("chat");
                }}
                onRename={(name) => handleRenameAgent(settingsAgent.agentId, name)}
                onUpdateExecutionRole={(role) =>
                  handleUpdateExecutionRole(settingsAgent.agentId, role)
                }
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
                cronCreateBusy={cronCreateBusy}
                cronRunBusyJobId={cronRunBusyJobId}
                cronDeleteBusyJobId={cronDeleteBusyJobId}
                onCreateCronJob={(draft) => handleCreateCronJob(settingsAgent.agentId, draft)}
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
      </div>
      {createAgentModalOpen ? (
        <AgentCreateModal
          key={suggestedCreateAgentName}
          open={createAgentModalOpen}
          suggestedName={suggestedCreateAgentName}
          busy={createAgentBusy}
          submitError={createAgentModalError}
          onClose={() => {
            if (createAgentBusy) return;
            setCreateAgentModalError(null);
            setCreateAgentModalOpen(false);
          }}
          onSubmit={(payload) => {
            void handleCreateAgentSubmit(payload);
          }}
        />
      ) : null}
      {createAgentBlock && createAgentBlock.phase !== "queued" ? (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-background/80"
          data-testid="agent-create-restart-modal"
          role="dialog"
          aria-modal="true"
          aria-label="Creating agent"
        >
          <div className="w-full max-w-md rounded-lg border border-border bg-card p-6">
            <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Agent create in progress
            </div>
            <div className="mt-2 text-base font-semibold text-foreground">
              {createAgentBlock.agentName}
            </div>
            <div className="mt-3 text-sm text-muted-foreground">
              Studio is temporarily locked until creation finishes.
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
          className="fixed inset-0 z-[100] flex items-center justify-center bg-background/80"
          data-testid="agent-rename-restart-modal"
          role="dialog"
          aria-modal="true"
          aria-label="Renaming agent and restarting gateway"
        >
          <div className="w-full max-w-md rounded-lg border border-border bg-card p-6">
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
          className="fixed inset-0 z-[100] flex items-center justify-center bg-background/80"
          data-testid="agent-delete-restart-modal"
          role="dialog"
          aria-modal="true"
          aria-label="Deleting agent and restarting gateway"
        >
          <div className="w-full max-w-md rounded-lg border border-border bg-card p-6">
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
