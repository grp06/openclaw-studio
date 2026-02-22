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
import { SessionsWidget } from "@/components/SessionsWidget";
import { TodosWidget } from "@/components/TodosWidget";
import { CronWidget } from "@/components/CronWidget";
import { ConnectionPanel } from "@/features/agents/components/ConnectionPanel";
import { GatewayConnectScreen } from "@/features/agents/components/GatewayConnectScreen";
import { EmptyStatePanel } from "@/features/agents/components/EmptyStatePanel";
import {
  EXEC_APPROVAL_AUTO_RESUME_MARKER,
  isHeartbeatPrompt,
} from "@/lib/text/message-extract";
import {
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
import { mergePendingLivePatch } from "@/features/agents/state/livePatchQueue";
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
  readConfigAgentList,
  slugifyAgentName,
  updateGatewayAgentOverrides,
} from "@/lib/gateway/agentConfig";
import { buildAvatarDataUrl } from "@/lib/avatars/multiavatar";
import { createStudioSettingsCoordinator } from "@/lib/studio/coordinator";
import { resolveFocusedPreference } from "@/lib/studio/settings";
import { applySessionSettingMutation } from "@/features/agents/state/sessionSettingsMutations";
import type { AgentCreateModalSubmitPayload } from "@/features/agents/creation/types";
import {
  isGatewayDisconnectLikeError,
  type EventFrame,
} from "@/lib/gateway/GatewayClient";
import { fetchJson } from "@/lib/http";
import { deleteAgentViaStudio } from "@/features/agents/operations/deleteAgentOperation";
import { performCronCreateFlow } from "@/features/agents/operations/cronCreateOperation";
import { sendChatMessageViaStudio } from "@/features/agents/operations/chatSendOperation";
import { hydrateAgentFleetFromGateway } from "@/features/agents/operations/agentFleetHydration";
import { useConfigMutationQueue } from "@/features/agents/operations/useConfigMutationQueue";
import { isLocalGatewayUrl } from "@/lib/gateway/local-gateway";
import { shouldAwaitDisconnectRestartForRemoteMutation } from "@/lib/gateway/gatewayReloadMode";
import { useGatewayRestartBlock } from "@/features/agents/operations/useGatewayRestartBlock";
import { randomUUID } from "@/lib/uuid";
import type { ExecApprovalDecision, PendingExecApproval } from "@/features/agents/approvals/types";
import {
  resolveGatewayEventIngressDecision,
} from "@/features/agents/state/gatewayEventIngressWorkflow";
import { resolveExecApprovalViaStudio } from "@/features/agents/approvals/execApprovalResolveOperation";
import {
  mergePendingApprovalsForFocusedAgent,
  nextPendingApprovalPruneDelayMs,
  pruneExpiredPendingApprovals,
  pruneExpiredPendingApprovalsMap,
  removePendingApprovalById,
  removePendingApprovalEverywhere,
  removePendingApprovalByIdMap,
  upsertPendingApproval,
} from "@/features/agents/approvals/pendingStore";
import { shouldPauseRunForPendingExecApproval } from "@/features/agents/approvals/execApprovalPausePolicy";
import {
  TRANSCRIPT_V2_ENABLED,
  logTranscriptDebugMetric,
} from "@/features/agents/state/transcript";
import {
  resolveLatestUpdateKind,
} from "@/features/agents/operations/latestUpdateWorkflow";
import { createSpecialLatestUpdateOperation } from "@/features/agents/operations/specialLatestUpdateOperation";
import {
  updateAgentPermissionsViaStudio,
  resolveAgentPermissionsDraft,
  type AgentPermissionsDraft,
} from "@/features/agents/operations/agentPermissionsOperation";
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
  buildQueuedMutationBlock,
  isCreateBlockTimedOut,
  resolveMutationStartGuard,
  resolveConfigMutationStatusLine,
  runAgentConfigMutationLifecycle,
  runCreateAgentMutationLifecycle,
  type CreateAgentBlockState,
  type MutationBlockState,
  type MutationWorkflowKind,
} from "@/features/agents/operations/mutationLifecycleWorkflow";

const DEFAULT_CHAT_HISTORY_LIMIT = 200;
const MAX_CHAT_HISTORY_LIMIT = 5000;
const PENDING_EXEC_APPROVAL_PRUNE_GRACE_MS = 500;
const EXEC_APPROVAL_AUTO_RESUME_WAIT_TIMEOUT_MS = 3_000;
const CREATE_AGENT_DEFAULT_PERMISSIONS: AgentPermissionsDraft = {
  commandMode: "ask",
  webAccess: false,
  fileTools: false,
};

type MobilePane = "fleet" | "chat" | "settings";
type InspectSidebarTab = "personality" | "capabilities" | "automations" | "advanced";
type InspectSidebarState = { agentId: string; tab: InspectSidebarTab } | null;
type RestartingMutationBlockState = MutationBlockState & { kind: MutationWorkflowKind };

const RESERVED_MAIN_AGENT_ID = "main";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

const normalizeControlUiBasePath = (basePath: string): string => {
  let normalized = basePath.trim();
  if (!normalized || normalized === "/") return "";
  if (!normalized.startsWith("/")) {
    normalized = `/${normalized}`;
  }
  if (normalized.endsWith("/")) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
};

const resolveControlUiUrl = (params: {
  gatewayUrl: string;
  configSnapshot: GatewayModelPolicySnapshot | null;
}): string | null => {
  const rawGatewayUrl = params.gatewayUrl.trim();
  if (!rawGatewayUrl) return null;

  let controlUiEnabled = true;
  let controlUiBasePath = "";

  const config = params.configSnapshot?.config;
  if (isRecord(config)) {
    const configRecord = config as Record<string, unknown>;
    const gateway = isRecord(configRecord["gateway"])
      ? (configRecord["gateway"] as Record<string, unknown>)
      : null;
    const controlUi = gateway && isRecord(gateway.controlUi) ? gateway.controlUi : null;
    if (controlUi && typeof controlUi.enabled === "boolean") {
      controlUiEnabled = controlUi.enabled;
    }
    if (typeof controlUi?.basePath === "string") {
      controlUiBasePath = normalizeControlUiBasePath(controlUi.basePath);
    }
  }

  if (!controlUiEnabled) return null;

  try {
    const url = new URL(rawGatewayUrl);
    if (url.protocol === "ws:") {
      url.protocol = "http:";
    } else if (url.protocol === "wss:") {
      url.protocol = "https:";
    }
    url.pathname = controlUiBasePath ? `${controlUiBasePath}/` : "/";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
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
  const [inspectSidebar, setInspectSidebar] = useState<InspectSidebarState>(null);
  const [settingsCronJobs, setSettingsCronJobs] = useState<CronJobSummary[]>([]);
  const [settingsCronLoading, setSettingsCronLoading] = useState(false);
  const [settingsCronError, setSettingsCronError] = useState<string | null>(null);
  const [cronCreateBusy, setCronCreateBusy] = useState(false);
  const [cronRunBusyJobId, setCronRunBusyJobId] = useState<string | null>(null);
  const [cronDeleteBusyJobId, setCronDeleteBusyJobId] = useState<string | null>(null);
  const [createAgentBlock, setCreateAgentBlock] = useState<CreateAgentBlockState | null>(null);
  const [restartingMutationBlock, setRestartingMutationBlock] =
    useState<RestartingMutationBlockState | null>(null);
  const [pendingExecApprovalsByAgentId, setPendingExecApprovalsByAgentId] = useState<
    Record<string, PendingExecApproval[]>
  >({});
  const [unscopedPendingExecApprovals, setUnscopedPendingExecApprovals] = useState<
    PendingExecApproval[]
  >([]);
  const specialUpdateRef = useRef<Map<string, string>>(new Map());
  const seenCronEventIdsRef = useRef<Set<string>>(new Set());
  const preferredSelectedAgentIdRef = useRef<string | null>(null);
  const pendingDraftValuesRef = useRef<Map<string, string>>(new Map());
  const pendingDraftTimersRef = useRef<Map<string, number>>(new Map());
  const pendingLivePatchesRef = useRef<Map<string, Partial<AgentState>>>(new Map());
  const flushLivePatchesRef = useRef<() => void>(() => {});
  const livePatchBatcherRef = useRef(createRafBatcher(() => flushLivePatchesRef.current()));
  const runtimeEventHandlerRef = useRef<ReturnType<typeof createGatewayRuntimeEventHandler> | null>(
    null
  );
  const reconcileRunInFlightRef = useRef<Set<string>>(new Set());
  const approvalPausedRunIdByAgentRef = useRef<Map<string, string>>(new Map());

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
  const inspectSidebarAgentId = inspectSidebar?.agentId ?? null;
  const inspectSidebarTab = inspectSidebar?.tab ?? null;
  const inspectSidebarAgent = useMemo(() => {
    if (!inspectSidebarAgentId) return null;
    return agents.find((entry) => entry.agentId === inspectSidebarAgentId) ?? null;
  }, [agents, inspectSidebarAgentId]);
  const settingsAgentPermissionsDraft = useMemo(() => {
    if (!inspectSidebarAgent) return null;
    const baseConfig =
      gatewayConfigSnapshot?.config &&
      typeof gatewayConfigSnapshot.config === "object" &&
      !Array.isArray(gatewayConfigSnapshot.config)
        ? (gatewayConfigSnapshot.config as Record<string, unknown>)
        : undefined;
    const list = readConfigAgentList(baseConfig);
    const configEntry = list.find((entry) => entry.id === inspectSidebarAgent.agentId) ?? null;
    const toolsRaw =
      configEntry && typeof (configEntry as Record<string, unknown>).tools === "object"
        ? ((configEntry as Record<string, unknown>).tools as unknown)
        : null;
    const tools =
      toolsRaw && typeof toolsRaw === "object" && !Array.isArray(toolsRaw)
        ? (toolsRaw as Record<string, unknown>)
        : null;
    return resolveAgentPermissionsDraft({
      agent: inspectSidebarAgent,
      existingTools: tools,
    });
  }, [gatewayConfigSnapshot, inspectSidebarAgent]);
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
  const controlUiUrl = useMemo(
    () => resolveControlUiUrl({ gatewayUrl, configSnapshot: gatewayConfigSnapshot }),
    [gatewayConfigSnapshot, gatewayUrl]
  );

  const hasRenameMutationBlock = restartingMutationBlock?.kind === "rename-agent";
  const hasDeleteMutationBlock = restartingMutationBlock?.kind === "delete-agent";
  const hasRestartBlockInProgress = Boolean(
    (restartingMutationBlock && restartingMutationBlock.phase !== "queued") ||
      (createAgentBlock && createAgentBlock.phase !== "queued")
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
    pendingLivePatchesRef.current.set(key, mergePendingLivePatch(existing, patch));
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

  const specialLatestUpdate = useMemo(() => {
    return createSpecialLatestUpdateOperation({
      callGateway: (method, params) => client.call(method, params),
      listCronJobs: () => listCronJobs(client, { includeDisabled: true }),
      resolveCronJobForAgent,
      formatCronJobDisplay,
      dispatchUpdateAgent: (agentId, patch) => {
        dispatch({ type: "updateAgent", agentId, patch });
      },
      isDisconnectLikeError: isGatewayDisconnectLikeError,
      logError: (message) => console.error(message),
    });
  }, [client, dispatch, resolveCronJobForAgent]);

  const loadCronJobsForSettingsAgent = useCallback(
    async (agentId: string) => {
      const resolvedAgentId = agentId.trim();
      if (!resolvedAgentId) {
        setSettingsCronJobs([]);
        setSettingsCronError("Failed to load schedules: missing agent id.");
        return;
      }
      setSettingsCronLoading(true);
      setSettingsCronError(null);
      try {
        const result = await listCronJobs(client, { includeDisabled: true });
        const filtered = filterCronJobsForAgent(result.jobs, resolvedAgentId);
        setSettingsCronJobs(sortCronJobsByUpdatedAt(filtered));
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to load schedules.";
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

  const refreshHeartbeatLatestUpdate = useCallback(() => {
    const agents = stateRef.current.agents;
    specialLatestUpdate.refreshHeartbeat(agents);
  }, [specialLatestUpdate]);

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

  const refreshGatewayConfigSnapshot = useCallback(async () => {
    if (status !== "connected") return null;
    try {
      const snapshot = await client.call<GatewayModelPolicySnapshot>("config.get", {});
      setGatewayConfigSnapshot(snapshot);
      return snapshot;
    } catch (err) {
      if (!isGatewayDisconnectLikeError(err)) {
        console.error("Failed to refresh gateway config.", err);
      }
      return null;
    }
  }, [client, status]);

  const sandboxToolsRepairAttemptedRef = useRef(false);

  useEffect(() => {
    if (status !== "connected") return;
    if (sandboxToolsRepairAttemptedRef.current) return;
    const baseConfig =
      gatewayConfigSnapshot?.config &&
      typeof gatewayConfigSnapshot.config === "object" &&
      !Array.isArray(gatewayConfigSnapshot.config)
        ? (gatewayConfigSnapshot.config as Record<string, unknown>)
        : null;
    if (!baseConfig) return;

    const list = readConfigAgentList(baseConfig);
    const brokenAgentIds = list
      .filter((entry) => {
        const sandboxRaw =
          entry && typeof (entry as Record<string, unknown>).sandbox === "object"
            ? ((entry as Record<string, unknown>).sandbox as unknown)
            : null;
        const sandbox =
          sandboxRaw && typeof sandboxRaw === "object" && !Array.isArray(sandboxRaw)
            ? (sandboxRaw as Record<string, unknown>)
            : null;
        const mode = typeof sandbox?.mode === "string" ? sandbox.mode.trim().toLowerCase() : "";
        if (mode !== "all") return false;

        const toolsRaw =
          entry && typeof (entry as Record<string, unknown>).tools === "object"
            ? ((entry as Record<string, unknown>).tools as unknown)
            : null;
        const tools =
          toolsRaw && typeof toolsRaw === "object" && !Array.isArray(toolsRaw)
            ? (toolsRaw as Record<string, unknown>)
            : null;
        const sandboxBlock =
          tools && typeof tools.sandbox === "object" && !Array.isArray(tools.sandbox)
            ? (tools.sandbox as Record<string, unknown>)
            : null;
        const sandboxTools =
          sandboxBlock && typeof sandboxBlock.tools === "object" && !Array.isArray(sandboxBlock.tools)
            ? (sandboxBlock.tools as Record<string, unknown>)
            : null;
        const allow = sandboxTools?.allow;
        return Array.isArray(allow) && allow.length === 0;
      })
      .map((entry) => entry.id);

    if (brokenAgentIds.length === 0) return;
    sandboxToolsRepairAttemptedRef.current = true;

    void enqueueConfigMutation({
      kind: "repair-sandbox-tool-allowlist",
      label: "Repair sandbox tool access",
      run: async () => {
        for (const agentId of brokenAgentIds) {
          await updateGatewayAgentOverrides({
            client,
            agentId,
            overrides: {
              tools: {
                sandbox: {
                  tools: {
                    allow: ["*"],
                  },
                },
              },
            },
          });
        }
        await loadAgents();
      },
    });
  }, [client, enqueueConfigMutation, gatewayConfigSnapshot, loadAgents, status]);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

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
    if (restartingMutationBlock && restartingMutationBlock.phase !== "queued") return;
    if (createAgentBlock && createAgentBlock.phase !== "queued") return;
    void loadAgents();
  }, [
    createAgentBlock,
    focusedPreferencesLoaded,
    gatewayUrl,
    loadAgents,
    restartingMutationBlock,
    status,
  ]);

  useEffect(() => {
    if (status === "disconnected") {
      setLoading(false);
    }
  }, [setLoading, status]);


  useEffect(() => {
    if (!inspectSidebar) return;
    const selectedAgentId = state.selectedAgentId?.trim() ?? "";
    if (!selectedAgentId) {
      setInspectSidebar(null);
      return;
    }
    if (inspectSidebar.agentId === selectedAgentId) return;
    setInspectSidebar((current) =>
      current ? { ...current, agentId: selectedAgentId } : current
    );
  }, [inspectSidebar, state.selectedAgentId]);

  useEffect(() => {
    if (inspectSidebarAgentId && !inspectSidebarAgent) {
      setInspectSidebar(null);
    }
  }, [inspectSidebarAgent, inspectSidebarAgentId]);

  useEffect(() => {
    if (!inspectSidebarAgentId) return;
    if (status !== "connected") return;
    void refreshGatewayConfigSnapshot();
  }, [refreshGatewayConfigSnapshot, inspectSidebarAgentId, status]);

  useEffect(() => {
    if (!inspectSidebarAgentId || status !== "connected" || inspectSidebarTab !== "automations") {
      setSettingsCronJobs([]);
      setSettingsCronLoading(false);
      setSettingsCronError(null);
      setCronRunBusyJobId(null);
      setCronDeleteBusyJobId(null);
      return;
    }
    void loadCronJobsForSettingsAgent(inspectSidebarAgentId);
  }, [
    inspectSidebarAgentId,
    inspectSidebarTab,
    loadCronJobsForSettingsAgent,
    status,
  ]);

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
    if (mobilePane !== "settings") return;
    if (inspectSidebarAgent) return;
    setMobilePane("chat");
  }, [inspectSidebarAgent, mobilePane]);

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
      void specialLatestUpdate.update(agent.agentId, agent, lastMessage);
    }
  }, [agents, heartbeatTick, specialLatestUpdate]);

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

  const handleOpenAgentInspectSidebar = useCallback(
    (agentId: string, tab: InspectSidebarTab) => {
      flushPendingDraft(focusedAgent?.agentId ?? null);
      setInspectSidebar({ agentId, tab });
      setMobilePane("settings");
      dispatch({ type: "selectAgent", agentId });
    },
    [dispatch, flushPendingDraft, focusedAgent]
  );

  const handleOpenAgentPersonality = useCallback(
    (agentId: string) => {
      handleOpenAgentInspectSidebar(agentId, "personality");
    },
    [handleOpenAgentInspectSidebar]
  );

  const handleToggleAgentPersonality = useCallback(
    (agentId: string) => {
      if (inspectSidebar?.agentId === agentId) {
        setInspectSidebar(null);
        setMobilePane("chat");
        return;
      }
      handleOpenAgentPersonality(agentId);
    },
    [handleOpenAgentPersonality, inspectSidebar?.agentId]
  );

  const runRestartingMutationLifecycle = useCallback(
    async (params: {
      kind: MutationWorkflowKind;
      agentId: string;
      agentName: string;
      label: string;
      executeMutation: () => Promise<void>;
    }) => {
      return await runAgentConfigMutationLifecycle({
        kind: params.kind,
        label: params.label,
        isLocalGateway,
        deps: {
          enqueueConfigMutation,
          setQueuedBlock: () => {
            const queuedBlock = buildQueuedMutationBlock({
              kind: params.kind,
              agentId: params.agentId,
              agentName: params.agentName,
              startedAt: Date.now(),
            });
            setRestartingMutationBlock({
              kind: params.kind,
              agentId: queuedBlock.agentId,
              agentName: queuedBlock.agentName,
              phase: queuedBlock.phase,
              startedAt: queuedBlock.startedAt,
              sawDisconnect: queuedBlock.sawDisconnect,
            });
          },
          setMutatingBlock: () => {
            setRestartingMutationBlock((current) => {
              if (!current) return current;
              if (current.kind !== params.kind || current.agentId !== params.agentId) {
                return current;
              }
              return {
                ...current,
                phase: "mutating",
              };
            });
          },
          patchBlockAwaitingRestart: (patch) => {
            setRestartingMutationBlock((current) => {
              if (!current) return current;
              if (current.kind !== params.kind || current.agentId !== params.agentId) {
                return current;
              }
              return {
                ...current,
                ...patch,
              };
            });
          },
          clearBlock: () => {
            setRestartingMutationBlock((current) => {
              if (!current) return current;
              if (current.kind !== params.kind || current.agentId !== params.agentId) {
                return current;
              }
              return null;
            });
          },
          executeMutation: params.executeMutation,
          shouldAwaitRemoteRestart: async () =>
            shouldAwaitDisconnectRestartForRemoteMutation({
              client,
              cachedConfigSnapshot: gatewayConfigSnapshot,
              logError: (message, error) => console.error(message, error),
            }),
          reloadAgents: loadAgents,
          setMobilePaneChat: () => {
            setMobilePane("chat");
          },
          onError: (message) => {
            setError(message);
          },
        },
      });
    },
    [client, enqueueConfigMutation, gatewayConfigSnapshot, isLocalGateway, loadAgents, setError]
  );

  const handleDeleteAgent = useCallback(
    async (agentId: string) => {
      const guard = resolveMutationStartGuard({
        status: "connected",
        hasCreateBlock: Boolean(createAgentBlock),
        hasRenameBlock: hasRenameMutationBlock,
        hasDeleteBlock: hasDeleteMutationBlock,
      });
      if (guard.kind === "deny") return;
      if (agentId === RESERVED_MAIN_AGENT_ID) {
        setError("The main agent cannot be deleted.");
        return;
      }
      const agent = agents.find((entry) => entry.agentId === agentId);
      if (!agent) return;
      const confirmed = window.confirm(
        `Delete ${agent.name}? This removes the agent from gateway config + scheduled automations and moves its workspace/state into ~/.openclaw/trash on the gateway host.`
      );
      if (!confirmed) return;
      await runRestartingMutationLifecycle({
        kind: "delete-agent",
        agentId,
        agentName: agent.name,
        label: `Delete ${agent.name}`,
        executeMutation: async () => {
          await deleteAgentViaStudio({
            client,
            agentId,
            fetchJson,
            logError: (message, error) => console.error(message, error),
          });
          setInspectSidebar(null);
        },
      });
    },
    [
      agents,
      client,
      createAgentBlock,
      hasDeleteMutationBlock,
      hasRenameMutationBlock,
      runRestartingMutationLifecycle,
      setError,
    ]
  );

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
        const message = err instanceof Error ? err.message : "Failed to create automation.";
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
        const message = err instanceof Error ? err.message : "Failed to run schedule.";
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
        const message = err instanceof Error ? err.message : "Failed to delete schedule.";
        setSettingsCronError(message);
        console.error(message);
      } finally {
        setCronDeleteBusyJobId((current) => (current === resolvedJobId ? null : current));
      }
    },
    [client, cronCreateBusy, cronDeleteBusyJobId, cronRunBusyJobId, loadCronJobsForSettingsAgent]
  );

  const handleOpenCreateAgentModal = useCallback(() => {
    if (createAgentBusy) return;
    if (createAgentBlock) return;
    if (restartingMutationBlock) return;
    setCreateAgentModalError(null);
    setCreateAgentModalOpen(true);
  }, [createAgentBlock, createAgentBusy, restartingMutationBlock]);

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
      await runCreateAgentMutationLifecycle(
        {
          payload,
          status,
          hasCreateBlock: Boolean(createAgentBlock),
          hasRenameBlock: hasRenameMutationBlock,
          hasDeleteBlock: hasDeleteMutationBlock,
          createAgentBusy,
        },
        {
          enqueueConfigMutation,
          createAgent: async (name, avatarSeed) => {
            const created = await createGatewayAgent({ client, name });
            if (avatarSeed) {
              persistAvatarSeed(created.id, avatarSeed);
            }
            flushPendingDraft(focusedAgent?.agentId ?? null);
            focusFilterTouchedRef.current = true;
            setFocusFilter("all");
            dispatch({ type: "selectAgent", agentId: created.id });
            return { id: created.id };
          },
          setQueuedBlock: ({ agentName, startedAt }) => {
            const queuedCreateBlock = buildQueuedMutationBlock({
              kind: "create-agent",
              agentId: "",
              agentName,
              startedAt,
            });
            setCreateAgentBlock({
              agentName: queuedCreateBlock.agentName,
              phase: "queued",
              startedAt: queuedCreateBlock.startedAt,
            });
          },
          setCreatingBlock: (agentName) => {
            setCreateAgentBlock((current) => {
              if (!current || current.agentName !== agentName) return current;
              return { ...current, phase: "creating" };
            });
          },
          onCompletion: async (completion) => {
            await loadAgents();
            let createdAgent =
              stateRef.current.agents.find((entry) => entry.agentId === completion.agentId) ?? null;
            if (!createdAgent) {
              await loadAgents();
              createdAgent =
                stateRef.current.agents.find((entry) => entry.agentId === completion.agentId) ??
                null;
            }
            if (!createdAgent) {
              const message = `Agent "${completion.agentName}" was created, but Studio could not load it yet.`;
              setCreateAgentModalError(message);
              setError(message);
              setCreateAgentBlock(null);
              setCreateAgentModalOpen(false);
              return;
            }

            let bootstrapError: string | null = null;
            try {
              await updateAgentPermissionsViaStudio({
                client,
                agentId: createdAgent.agentId,
                sessionKey: createdAgent.sessionKey,
                draft: CREATE_AGENT_DEFAULT_PERMISSIONS,
                loadAgents,
              });
              await refreshGatewayConfigSnapshot();
            } catch (err) {
              bootstrapError =
                err instanceof Error ? err.message : "Failed to apply default permissions.";
              setError(
                `Agent created, but default permissions could not be applied: ${bootstrapError}`
              );
            }

            flushPendingDraft(focusedAgent?.agentId ?? null);
            dispatch({ type: "selectAgent", agentId: completion.agentId });
            setInspectSidebar({ agentId: completion.agentId, tab: "capabilities" });
            setMobilePane("chat");
            if (bootstrapError) {
              setCreateAgentModalError(`Default permissions failed: ${bootstrapError}`);
            } else {
              setCreateAgentModalError(null);
            }
            setCreateAgentBlock(null);
            setCreateAgentModalOpen(false);
          },
          setCreateAgentModalError,
          setCreateAgentBusy,
          clearCreateBlock: () => {
            setCreateAgentBlock(null);
          },
          onError: setError,
        }
      );
    },
    [
      client,
      createAgentBusy,
      createAgentBlock,
      dispatch,
      enqueueConfigMutation,
      flushPendingDraft,
      focusedAgent,
      hasDeleteMutationBlock,
      hasRenameMutationBlock,
      loadAgents,
      persistAvatarSeed,
      refreshGatewayConfigSnapshot,
      setError,
      status,
    ]
  );

  useEffect(() => {
    if (!createAgentBlock || createAgentBlock.phase === "queued") return;
    const maxWaitMs = 90_000;
    const timeoutNow = isCreateBlockTimedOut({
      block: createAgentBlock,
      nowMs: Date.now(),
      maxWaitMs,
    });
    const handleTimeout = () => {
      setCreateAgentBlock(null);
      setCreateAgentModalOpen(false);
      void loadAgents();
      setError("Agent creation timed out.");
    };
    if (timeoutNow) {
      handleTimeout();
      return;
    }
    const elapsed = Date.now() - createAgentBlock.startedAt;
    const remaining = Math.max(0, maxWaitMs - elapsed);
    const timeoutId = window.setTimeout(() => {
      if (
        !isCreateBlockTimedOut({
          block: createAgentBlock,
          nowMs: Date.now(),
          maxWaitMs,
        })
      ) {
        return;
      }
      handleTimeout();
    }, remaining);
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [createAgentBlock, loadAgents, setError]);

  useGatewayRestartBlock({
    status,
    block: restartingMutationBlock,
    setBlock: setRestartingMutationBlock,
    maxWaitMs: 90_000,
    onTimeout: () => {
      const timeoutMessage =
        restartingMutationBlock?.kind === "delete-agent"
          ? "Gateway restart timed out after deleting the agent."
          : "Gateway restart timed out after renaming the agent.";
      setRestartingMutationBlock(null);
      setError(timeoutMessage);
    },
    onRestartComplete: async (_, ctx) => {
      await loadAgents();
      if (ctx.isCancelled()) return;
      setRestartingMutationBlock(null);
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
        specialLatestUpdate.clearInFlight(agentId);
        dispatch({
          type: "updateAgent",
          agentId,
          patch,
        });
        setInspectSidebar(null);
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
    [agents, client, dispatch, setError, specialLatestUpdate]
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
      clearPendingLivePatch(agentId);
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
    [client, clearPendingLivePatch, dispatch]
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
        onAllowed: async ({ approval, targetAgentId }) => {
          const pausedByAgent = approvalPausedRunIdByAgentRef.current;
          const pausedRunId = pausedByAgent.get(targetAgentId) ?? null;
          if (!pausedRunId) return;

          const scopedPending = (pendingExecApprovalsByAgentId[targetAgentId] ?? []).some(
            (pendingApproval) => pendingApproval.id !== approval.id
          );
          const targetSessionKey = approval.sessionKey?.trim() ?? "";
          const unscopedPending = unscopedPendingExecApprovals.some((pendingApproval) => {
            if (pendingApproval.id === approval.id) return false;
            const pendingAgentId = pendingApproval.agentId?.trim() ?? "";
            if (pendingAgentId && pendingAgentId === targetAgentId) return true;
            if (!targetSessionKey) return false;
            return (pendingApproval.sessionKey?.trim() ?? "") === targetSessionKey;
          });
          if (scopedPending || unscopedPending) {
            return;
          }

          pausedByAgent.delete(targetAgentId);
          const nowMs = Date.now();
          dispatch({
            type: "updateAgent",
            agentId: targetAgentId,
            patch: {
              status: "running",
              runId: pausedRunId,
              lastActivityAt: nowMs,
            },
          });
          try {
            await client.call("agent.wait", { runId: pausedRunId, timeoutMs: EXEC_APPROVAL_AUTO_RESUME_WAIT_TIMEOUT_MS });
          } catch (waitError) {
            if (!isGatewayDisconnectLikeError(waitError)) {
              console.warn("Failed waiting for paused run before auto-resume.", waitError);
            }
          }

          const latest = stateRef.current.agents.find((entry) => entry.agentId === targetAgentId) ?? null;
          if (!latest) return;
          const latestRunId = latest.runId?.trim() ?? "";
          if (latest.status === "running" && latestRunId && latestRunId !== pausedRunId) {
            return;
          }
          const sessionKey = latest.sessionKey.trim();
          if (!sessionKey) return;

          await sendChatMessageViaStudio({
            client,
            dispatch,
            getAgent: (agentId) =>
              stateRef.current.agents.find((entry) => entry.agentId === agentId) ?? null,
            agentId: targetAgentId,
            sessionKey,
            message: `${EXEC_APPROVAL_AUTO_RESUME_MARKER}\nContinue where you left off and finish the task.`,
            clearRunTracking: (runId) => runtimeEventHandlerRef.current?.clearRunTracking(runId),
            echoUserMessage: false,
          });
        },
        isDisconnectLikeError: isGatewayDisconnectLikeError,
        logWarn: (message, error) => console.warn(message, error),
      });
    },
    [client, dispatch, loadAgentHistory, pendingExecApprovalsByAgentId, unscopedPendingExecApprovals]
  );

  const pauseRunForExecApproval = useCallback(
    async (approval: PendingExecApproval, preferredAgentId?: string | null) => {
      if (status !== "connected") return;

      const pausedByAgent = approvalPausedRunIdByAgentRef.current;
      for (const [trackedAgentId, trackedRunId] of pausedByAgent.entries()) {
        const trackedAgent = stateRef.current.agents.find((entry) => entry.agentId === trackedAgentId);
        const currentRunId = trackedAgent?.runId?.trim() ?? "";
        if (!currentRunId || currentRunId !== trackedRunId) {
          pausedByAgent.delete(trackedAgentId);
        }
      }

      const preferred = preferredAgentId?.trim() ?? "";
      const approvalSessionKey = approval.sessionKey?.trim() ?? "";
      const agent =
        (preferred
          ? stateRef.current.agents.find((entry) => entry.agentId === preferred)
          : null) ??
        (approvalSessionKey
          ? stateRef.current.agents.find((entry) => entry.sessionKey.trim() === approvalSessionKey)
          : null) ??
        null;
      if (!agent) return;

      const runId = agent.runId?.trim() ?? "";
      if (!runId) return;

      const pausedRunId = pausedByAgent.get(agent.agentId) ?? null;
      if (
        !shouldPauseRunForPendingExecApproval({
          agent,
          approval,
          pausedRunId,
        })
      ) {
        return;
      }

      const sessionKey = agent.sessionKey.trim();
      if (!sessionKey) return;
      pausedByAgent.set(agent.agentId, runId);
      try {
        await client.call("chat.abort", { sessionKey });
      } catch (err) {
        pausedByAgent.delete(agent.agentId);
        if (!isGatewayDisconnectLikeError(err)) {
          console.warn("Failed to pause run for pending exec approval.", err);
        }
      }
    },
    [client, status]
  );

  const handleGatewayEventIngress = useCallback(
    (event: EventFrame) => {
      const ingressDecision = resolveGatewayEventIngressDecision({
        event,
        agents: stateRef.current.agents,
        seenCronDedupeKeys: seenCronEventIdsRef.current,
        nowMs: Date.now(),
      });

      const effects = ingressDecision.approvalEffects;
      if (effects) {
        for (const removalId of effects.removals) {
          setPendingExecApprovalsByAgentId((current) => {
            return removePendingApprovalEverywhere({
              approvalsByAgentId: current,
              unscopedApprovals: [],
              approvalId: removalId,
            }).approvalsByAgentId;
          });
          setUnscopedPendingExecApprovals((current) => {
            return removePendingApprovalEverywhere({
              approvalsByAgentId: {},
              unscopedApprovals: current,
              approvalId: removalId,
            }).unscopedApprovals;
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
          void pauseRunForExecApproval(scopedUpsert.approval, scopedUpsert.agentId);
        }
        for (const unscopedUpsert of effects.unscopedUpserts) {
          setPendingExecApprovalsByAgentId((current) =>
            removePendingApprovalByIdMap(current, unscopedUpsert.id)
          );
          setUnscopedPendingExecApprovals((current) => {
            const withoutExisting = removePendingApprovalById(current, unscopedUpsert.id);
            return upsertPendingApproval(withoutExisting, unscopedUpsert);
          });
          void pauseRunForExecApproval(unscopedUpsert);
        }
        for (const agentId of effects.markActivityAgentIds) {
          dispatch({ type: "markActivity", agentId });
        }
      }

      if (ingressDecision.cronDedupeKeyToRecord) {
        seenCronEventIdsRef.current.add(ingressDecision.cronDedupeKeyToRecord);
      }
      if (!ingressDecision.cronTranscriptIntent) {
        return;
      }
      const intent = ingressDecision.cronTranscriptIntent;
      dispatch({
        type: "appendOutput",
        agentId: intent.agentId,
        line: intent.line,
        transcript: {
          source: "runtime-agent",
          role: "assistant",
          kind: "assistant",
          sessionKey: intent.sessionKey,
          timestampMs: intent.timestampMs,
          entryId: intent.dedupeKey,
          confirmed: true,
        },
      });
      dispatch({
        type: "markActivity",
        agentId: intent.agentId,
        at: intent.activityAtMs ?? undefined,
      });
    },
    [dispatch, pauseRunForExecApproval]
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
      shouldSuppressRunAbortedLine: ({ agentId, runId, stopReason }) => {
        if (stopReason !== "rpc") return false;
        const normalizedRunId = runId?.trim() ?? "";
        if (!normalizedRunId) return false;
        const pausedRunId = approvalPausedRunIdByAgentRef.current.get(agentId)?.trim() ?? "";
        return pausedRunId.length > 0 && pausedRunId === normalizedRunId;
      },
      updateSpecialLatestUpdate: (agentId, agent, message) => {
        void specialLatestUpdate.update(agentId, agent, message);
      },
    });
    runtimeEventHandlerRef.current = handler;
    const unsubscribe = client.onEvent((event: EventFrame) => {
      handler.handleEvent(event);
      handleGatewayEventIngress(event);
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
    specialLatestUpdate,
    handleGatewayEventIngress,
    status,
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
        hasRenameBlock: hasRenameMutationBlock,
        hasDeleteBlock: hasDeleteMutationBlock,
      });
      if (guard.kind === "deny") return false;
      const agent = agents.find((entry) => entry.agentId === agentId);
      if (!agent) return false;
      return await runRestartingMutationLifecycle({
        kind: "rename-agent",
        agentId,
        agentName: name,
        label: `Rename ${agent.name}`,
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
      });
    },
    [
      agents,
      client,
      createAgentBlock,
      dispatch,
      hasDeleteMutationBlock,
      hasRenameMutationBlock,
      runRestartingMutationLifecycle,
    ]
  );

  const handleUpdateAgentPermissions = useCallback(
    async (agentId: string, draft: AgentPermissionsDraft) => {
      const guard = resolveMutationStartGuard({
        status: "connected",
        hasCreateBlock: Boolean(createAgentBlock),
        hasRenameBlock: hasRenameMutationBlock,
        hasDeleteBlock: hasDeleteMutationBlock,
      });
      if (guard.kind === "deny") return;

      const resolvedAgentId = agentId.trim();
      if (!resolvedAgentId) return;
      const agent = agents.find((entry) => entry.agentId === resolvedAgentId) ?? null;
      if (!agent) return;

      await enqueueConfigMutation({
        kind: "update-agent-permissions",
        label: `Update permissions for ${agent.name}`,
        run: async () => {
          await updateAgentPermissionsViaStudio({
            client,
            agentId: resolvedAgentId,
            sessionKey: agent.sessionKey,
            draft,
            loadAgents: async () => {},
          });
          await loadAgents();
          await refreshGatewayConfigSnapshot();
          setInspectSidebar((current) => {
            if (current?.agentId === resolvedAgentId) return current;
            return { agentId: resolvedAgentId, tab: "capabilities" };
          });
          setMobilePane("settings");
        },
      });
    },
    [
      agents,
      client,
      createAgentBlock,
      enqueueConfigMutation,
      hasDeleteMutationBlock,
      hasRenameMutationBlock,
      loadAgents,
      refreshGatewayConfigSnapshot,
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
      : null
    : null;
  const restartingMutationStatusLine = resolveConfigMutationStatusLine({
    block: restartingMutationBlock
      ? {
          phase: restartingMutationBlock.phase,
          sawDisconnect: restartingMutationBlock.sawDisconnect,
        }
      : null,
    status,
  });
  const restartingMutationModalTestId = restartingMutationBlock
    ? restartingMutationBlock.kind === "delete-agent"
      ? "agent-delete-restart-modal"
      : "agent-rename-restart-modal"
    : null;
  const restartingMutationAriaLabel = restartingMutationBlock
    ? restartingMutationBlock.kind === "delete-agent"
      ? "Deleting agent and restarting gateway"
      : "Renaming agent and restarting gateway"
    : null;
  const restartingMutationHeading = restartingMutationBlock
    ? restartingMutationBlock.kind === "delete-agent"
      ? "Agent delete in progress"
      : "Agent rename in progress"
    : null;

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
          <div className="glass-panel ui-panel w-full max-w-md px-6 py-6 text-center">
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
          <div className="glass-panel ui-panel w-full max-w-md px-6 py-6 text-center">
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
          <div className="glass-panel ui-card px-6 py-3 font-mono text-[11px] tracking-[0.08em] text-muted-foreground">
            Loading agents…
          </div>
        </div>
      ) : null}
      <div className="relative z-10 flex h-screen flex-col gap-3 px-3 py-3 sm:px-4 sm:py-4 md:px-5 md:py-5">
        <div className="w-full">
          <HeaderBar
            status={status}
            onConnectionSettings={() => setShowConnectionPanel(true)}
          />
        </div>

        {connectionPanelVisible ? (
          <div className="pointer-events-none fixed inset-x-0 top-20 z-[140] flex justify-center px-3 sm:px-4 md:px-5">
            <div className="glass-panel pointer-events-auto w-full max-w-4xl !bg-card px-4 py-4 sm:px-6 sm:py-6">
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
            <div className="ui-alert-danger rounded-md px-4 py-2 text-sm">
              {errorMessage}
            </div>
          </div>
        ) : null}
        {configMutationStatusLine ? (
          <div className="w-full">
            <div className="ui-card px-4 py-2 font-mono text-[11px] tracking-[0.07em] text-muted-foreground">
              {configMutationStatusLine}
            </div>
          </div>
        ) : null}

        <SessionsWidget />
        <TodosWidget />
        <CronWidget />

        <div className="flex min-h-0 flex-1 flex-col gap-4 xl:flex-row">
          <div className="glass-panel ui-panel p-2 xl:hidden" data-testid="mobile-pane-toggle">
            <div className="ui-segment grid-cols-3">
              <button
                type="button"
                className="ui-segment-item px-2 py-2 font-mono text-[12px] font-medium tracking-[0.02em]"
                data-active={mobilePane === "fleet" ? "true" : "false"}
                onClick={() => setMobilePane("fleet")}
              >
                Fleet
              </button>
              <button
                type="button"
                className="ui-segment-item px-2 py-2 font-mono text-[12px] font-medium tracking-[0.02em]"
                data-active={mobilePane === "chat" ? "true" : "false"}
                onClick={() => setMobilePane("chat")}
              >
                Chat
              </button>
              <button
                type="button"
                className="ui-segment-item px-2 py-2 font-mono text-[12px] font-medium tracking-[0.02em]"
                data-active={mobilePane === "settings" ? "true" : "false"}
                onClick={() => {
                  if (!focusedAgent) return;
                  handleOpenAgentPersonality(focusedAgent.agentId);
                }}
                disabled={!focusedAgent}
              >
                Settings
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
                setInspectSidebar((current) =>
                  current ? { ...current, agentId } : current
                );
                setMobilePane("chat");
              }}
            />
          </div>
          <div
            className={`${mobilePane === "chat" ? "flex" : "hidden"} ui-panel ui-depth-workspace min-h-0 flex-1 overflow-hidden xl:flex`}
            data-testid="focused-agent-panel"
          >
            {focusedAgent ? (
              <div className="flex min-h-0 flex-1 flex-col">
                <div className="min-h-0 flex-1">
                  <AgentChatPanel
                    agent={focusedAgent}
                    isSelected={false}
                    canSend={status === "connected"}
                    models={gatewayModels}
                    stopBusy={stopBusyAgentId === focusedAgent.agentId}
                    stopDisabledReason={focusedAgentStopDisabledReason}
                    onLoadMoreHistory={() => loadMoreAgentHistory(focusedAgent.agentId)}
                    onOpenSettings={() => handleToggleAgentPersonality(focusedAgent.agentId)}
                    onRename={(name) => handleRenameAgent(focusedAgent.agentId, name)}
                    onNewSession={() => handleNewSession(focusedAgent.agentId)}
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
          {inspectSidebarAgent ? (
            <div
              className={`${mobilePane === "settings" ? "block" : "hidden"} sidebar-shell glass-panel ui-panel ui-depth-sidepanel flex min-h-0 w-full shrink-0 flex-col overflow-hidden p-0 xl:flex xl:min-w-[468px] xl:max-w-[559px]`}
            >
              <div className="border-b border-border/60 px-3 py-3">
                <div className="ui-segment grid-cols-4">
                  {(
                    [
                      { id: "personality", label: "Behavior" },
                      { id: "capabilities", label: "Capabilities" },
                      { id: "automations", label: "Automations" },
                      { id: "advanced", label: "Advanced" },
                    ] as const
                  ).map((entry) => {
                    const active = inspectSidebarTab === entry.id;
                    return (
                      <button
                        key={entry.id}
                        type="button"
                        className="ui-segment-item px-2 py-2 font-mono text-[11px] font-medium tracking-[0.02em]"
                        data-active={active ? "true" : "false"}
                        onClick={() =>
                          setInspectSidebar((current) => {
                            if (!current) {
                              return { agentId: inspectSidebarAgent.agentId, tab: entry.id };
                            }
                            if (current.tab === entry.id) return current;
                            return { ...current, tab: entry.id };
                          })
                        }
                      >
                        {entry.label}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="min-h-0 flex-1">
                {inspectSidebarTab === "personality" ? (
                  <AgentBrainPanel
                    client={client}
                    agents={agents}
                    selectedAgentId={inspectSidebarAgent.agentId}
                  />
                ) : (
                  <AgentSettingsPanel
                    key={`${inspectSidebarAgent.agentId}:${inspectSidebarTab ?? "capabilities"}`}
                    mode={
                      inspectSidebarTab === "automations"
                        ? "automations"
                        : inspectSidebarTab === "advanced"
                          ? "advanced"
                          : "capabilities"
                    }
                    agent={inspectSidebarAgent}
                    onClose={() => {
                      setInspectSidebar(null);
                      setMobilePane("chat");
                    }}
                    permissionsDraft={settingsAgentPermissionsDraft ?? undefined}
                    onUpdateAgentPermissions={(draft) =>
                      handleUpdateAgentPermissions(inspectSidebarAgent.agentId, draft)
                    }
                    onDelete={() => handleDeleteAgent(inspectSidebarAgent.agentId)}
                    canDelete={inspectSidebarAgent.agentId !== RESERVED_MAIN_AGENT_ID}
                    onToolCallingToggle={(enabled) =>
                      handleToolCallingToggle(inspectSidebarAgent.agentId, enabled)
                    }
                    onThinkingTracesToggle={(enabled) =>
                      handleThinkingTracesToggle(inspectSidebarAgent.agentId, enabled)
                    }
                    cronJobs={settingsCronJobs}
                    cronLoading={settingsCronLoading}
                    cronError={settingsCronError}
                    cronCreateBusy={cronCreateBusy}
                    cronRunBusyJobId={cronRunBusyJobId}
                    cronDeleteBusyJobId={cronDeleteBusyJobId}
                    onCreateCronJob={(draft) => handleCreateCronJob(inspectSidebarAgent.agentId, draft)}
                    onRunCronJob={(jobId) => handleRunCronJob(inspectSidebarAgent.agentId, jobId)}
                    onDeleteCronJob={(jobId) =>
                      handleDeleteCronJob(inspectSidebarAgent.agentId, jobId)
                    }
                    controlUiUrl={controlUiUrl}
                  />
                )}
              </div>
            </div>
          ) : null}
        </div>
      </div>
      {createAgentModalOpen ? (
        <AgentCreateModal
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
          <div className="ui-panel w-full max-w-md p-6">
            <div className="font-mono text-[10px] font-semibold tracking-[0.06em] text-muted-foreground">
              Agent create in progress
            </div>
            <div className="mt-2 text-base font-semibold text-foreground">
              {createAgentBlock.agentName}
            </div>
            <div className="mt-3 text-sm text-muted-foreground">
              Studio is temporarily locked until creation finishes.
            </div>
            {createBlockStatusLine ? (
              <div className="ui-card mt-4 px-3 py-2 font-mono text-[11px] tracking-[0.06em] text-foreground">
                {createBlockStatusLine}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
      {restartingMutationBlock && restartingMutationBlock.phase !== "queued" ? (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-background/80"
          data-testid={restartingMutationModalTestId ?? undefined}
          role="dialog"
          aria-modal="true"
          aria-label={restartingMutationAriaLabel ?? undefined}
        >
          <div className="ui-panel w-full max-w-md p-6">
            <div className="font-mono text-[10px] font-semibold tracking-[0.06em] text-muted-foreground">
              {restartingMutationHeading}
            </div>
            <div className="mt-2 text-base font-semibold text-foreground">
              {restartingMutationBlock.agentName}
            </div>
            <div className="mt-3 text-sm text-muted-foreground">
              Studio is temporarily locked until the gateway restarts.
            </div>
            {restartingMutationStatusLine ? (
              <div className="ui-card mt-4 px-3 py-2 font-mono text-[11px] tracking-[0.06em] text-foreground">
                {restartingMutationStatusLine}
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
