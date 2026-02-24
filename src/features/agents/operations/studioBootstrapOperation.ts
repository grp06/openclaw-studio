import { hydrateAgentFleetFromGateway } from "@/features/agents/operations/agentFleetHydration";
import {
  planBootstrapSelection,
  planFocusedFilterPatch,
  planFocusedPreferenceRestore,
  planFocusedSelectionPatch,
} from "@/features/agents/operations/studioBootstrapWorkflow";
import type { AgentState, AgentStoreSeed, FocusFilter } from "@/features/agents/state/store";
import type { GatewayModelPolicySnapshot } from "@/lib/gateway/models";
import type { StudioSettings, StudioSettingsPatch } from "@/lib/studio/settings";

type GatewayClientLike = {
  call: (method: string, params: unknown) => Promise<unknown>;
};

export type StudioBootstrapLoadCommand =
  | { kind: "set-gateway-config-snapshot"; snapshot: GatewayModelPolicySnapshot }
  | { kind: "hydrate-agents"; seeds: AgentStoreSeed[]; initialSelectedAgentId: string | undefined }
  | { kind: "mark-session-created"; agentId: string; sessionSettingsSynced: boolean }
  | { kind: "apply-summary-patch"; agentId: string; patch: Partial<AgentState> }
  | { kind: "set-error"; message: string };

export async function runStudioBootstrapLoadOperation(params: {
  client: GatewayClientLike;
  gatewayUrl: string;
  cachedConfigSnapshot: GatewayModelPolicySnapshot | null;
  loadStudioSettings: () => Promise<StudioSettings | null>;
  isDisconnectLikeError: (err: unknown) => boolean;
  preferredSelectedAgentId: string | null;
  hasCurrentSelection: boolean;
  logError?: (message: string, error: unknown) => void;
}): Promise<StudioBootstrapLoadCommand[]> {
  try {
    const result = await hydrateAgentFleetFromGateway({
      client: params.client,
      gatewayUrl: params.gatewayUrl,
      cachedConfigSnapshot: params.cachedConfigSnapshot,
      loadStudioSettings: params.loadStudioSettings,
      isDisconnectLikeError: params.isDisconnectLikeError,
      logError: params.logError,
    });

    const selectionIntent = planBootstrapSelection({
      hasCurrentSelection: params.hasCurrentSelection,
      preferredSelectedAgentId: params.preferredSelectedAgentId,
      availableAgentIds: result.seeds.map((seed) => seed.agentId),
      suggestedSelectedAgentId: result.suggestedSelectedAgentId,
    });

    const commands: StudioBootstrapLoadCommand[] = [];
    if (!params.cachedConfigSnapshot && result.configSnapshot) {
      commands.push({
        kind: "set-gateway-config-snapshot",
        snapshot: result.configSnapshot,
      });
    }

    commands.push({
      kind: "hydrate-agents",
      seeds: result.seeds,
      initialSelectedAgentId: selectionIntent.initialSelectedAgentId,
    });

    const sessionSettingsSyncedAgentIds = new Set(result.sessionSettingsSyncedAgentIds);
    for (const agentId of result.sessionCreatedAgentIds) {
      commands.push({
        kind: "mark-session-created",
        agentId,
        sessionSettingsSynced: sessionSettingsSyncedAgentIds.has(agentId),
      });
    }

    for (const entry of result.summaryPatches) {
      commands.push({
        kind: "apply-summary-patch",
        agentId: entry.agentId,
        patch: entry.patch,
      });
    }

    return commands;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load agents.";
    return [{ kind: "set-error", message }];
  }
}

export function executeStudioBootstrapLoadCommands(params: {
  commands: StudioBootstrapLoadCommand[];
  setGatewayConfigSnapshot: (snapshot: GatewayModelPolicySnapshot) => void;
  hydrateAgents: (agents: AgentStoreSeed[], selectedAgentId?: string) => void;
  dispatchUpdateAgent: (agentId: string, patch: Partial<AgentState>) => void;
  setError: (message: string) => void;
}): void {
  for (const command of params.commands) {
    if (command.kind === "set-gateway-config-snapshot") {
      params.setGatewayConfigSnapshot(command.snapshot);
      continue;
    }
    if (command.kind === "hydrate-agents") {
      params.hydrateAgents(command.seeds, command.initialSelectedAgentId);
      continue;
    }
    if (command.kind === "mark-session-created") {
      params.dispatchUpdateAgent(command.agentId, {
        sessionCreated: true,
        sessionSettingsSynced: command.sessionSettingsSynced,
      });
      continue;
    }
    if (command.kind === "apply-summary-patch") {
      params.dispatchUpdateAgent(command.agentId, command.patch);
      continue;
    }
    params.setError(command.message);
  }
}

export type StudioFocusedPreferenceLoadCommand =
  | { kind: "set-focused-preferences-loaded"; value: boolean }
  | { kind: "set-preferred-selected-agent-id"; agentId: string | null }
  | { kind: "set-focus-filter"; filter: FocusFilter }
  | { kind: "log-error"; message: string; error: unknown };

export async function runStudioFocusedPreferenceLoadOperation(params: {
  gatewayUrl: string;
  loadStudioSettings: () => Promise<StudioSettings | null>;
  isFocusFilterTouched: () => boolean;
}): Promise<StudioFocusedPreferenceLoadCommand[]> {
  const key = params.gatewayUrl.trim();
  if (!key) {
    return [
      { kind: "set-preferred-selected-agent-id", agentId: null },
      { kind: "set-focused-preferences-loaded", value: true },
    ];
  }

  try {
    const settings = await params.loadStudioSettings();
    if (!settings || params.isFocusFilterTouched()) {
      return [{ kind: "set-focused-preferences-loaded", value: true }];
    }

    const restoreIntent = planFocusedPreferenceRestore({
      settings,
      gatewayKey: key,
      focusFilterTouched: false,
    });

    return [
      {
        kind: "set-preferred-selected-agent-id",
        agentId: restoreIntent.preferredSelectedAgentId,
      },
      {
        kind: "set-focus-filter",
        filter: restoreIntent.focusFilter,
      },
      { kind: "set-focused-preferences-loaded", value: true },
    ];
  } catch (error) {
    return [
      {
        kind: "log-error",
        message: "Failed to load focused preference.",
        error,
      },
      { kind: "set-focused-preferences-loaded", value: true },
    ];
  }
}

export function executeStudioFocusedPreferenceLoadCommands(params: {
  commands: StudioFocusedPreferenceLoadCommand[];
  setFocusedPreferencesLoaded: (value: boolean) => void;
  setPreferredSelectedAgentId: (agentId: string | null) => void;
  setFocusFilter: (filter: FocusFilter) => void;
  logError: (message: string, error: unknown) => void;
}): void {
  for (const command of params.commands) {
    if (command.kind === "set-focused-preferences-loaded") {
      params.setFocusedPreferencesLoaded(command.value);
      continue;
    }
    if (command.kind === "set-preferred-selected-agent-id") {
      params.setPreferredSelectedAgentId(command.agentId);
      continue;
    }
    if (command.kind === "set-focus-filter") {
      params.setFocusFilter(command.filter);
      continue;
    }
    params.logError(command.message, command.error);
  }
}

export type StudioFocusedPatchCommand = {
  kind: "schedule-settings-patch";
  patch: StudioSettingsPatch;
  debounceMs: number;
};

export function runStudioFocusFilterPersistenceOperation(params: {
  gatewayUrl: string;
  focusFilterTouched: boolean;
  focusFilter: FocusFilter;
}): StudioFocusedPatchCommand[] {
  const patchIntent = planFocusedFilterPatch({
    gatewayKey: params.gatewayUrl,
    focusFilterTouched: params.focusFilterTouched,
    focusFilter: params.focusFilter,
  });
  if (patchIntent.kind !== "patch") {
    return [];
  }
  return [
    {
      kind: "schedule-settings-patch",
      patch: patchIntent.patch,
      debounceMs: patchIntent.debounceMs,
    },
  ];
}

export function runStudioFocusedSelectionPersistenceOperation(params: {
  gatewayUrl: string;
  status: "connected" | "connecting" | "disconnected";
  focusedPreferencesLoaded: boolean;
  agentsLoadedOnce: boolean;
  selectedAgentId: string | null;
}): StudioFocusedPatchCommand[] {
  const patchIntent = planFocusedSelectionPatch({
    gatewayKey: params.gatewayUrl,
    status: params.status,
    focusedPreferencesLoaded: params.focusedPreferencesLoaded,
    agentsLoadedOnce: params.agentsLoadedOnce,
    selectedAgentId: params.selectedAgentId,
  });

  if (patchIntent.kind !== "patch") {
    return [];
  }

  return [
    {
      kind: "schedule-settings-patch",
      patch: patchIntent.patch,
      debounceMs: patchIntent.debounceMs,
    },
  ];
}

export function executeStudioFocusedPatchCommands(params: {
  commands: StudioFocusedPatchCommand[];
  schedulePatch: (patch: StudioSettingsPatch, debounceMs?: number) => void;
}): void {
  for (const command of params.commands) {
    params.schedulePatch(command.patch, command.debounceMs);
  }
}
