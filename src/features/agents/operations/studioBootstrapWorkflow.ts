import type { FocusFilter } from "@/features/agents/state/store";
import {
  resolveFocusedPreference,
  type StudioSettings,
  type StudioSettingsPatch,
} from "@/lib/studio/settings";

const FOCUSED_PATCH_DEBOUNCE_MS = 300;

type BootstrapSelectionIntent = {
  initialSelectedAgentId: string | undefined;
};

export function planBootstrapSelection(params: {
  hasCurrentSelection: boolean;
  preferredSelectedAgentId: string | null;
  availableAgentIds: string[];
  suggestedSelectedAgentId: string | null;
}): BootstrapSelectionIntent {
  if (params.hasCurrentSelection) {
    return { initialSelectedAgentId: undefined };
  }

  const preferredSelectedAgentId = params.preferredSelectedAgentId?.trim() ?? "";
  if (
    preferredSelectedAgentId.length > 0 &&
    params.availableAgentIds.some((agentId) => agentId === preferredSelectedAgentId)
  ) {
    return { initialSelectedAgentId: preferredSelectedAgentId };
  }

  const suggestedSelectedAgentId = params.suggestedSelectedAgentId?.trim() ?? "";
  return {
    initialSelectedAgentId:
      suggestedSelectedAgentId.length > 0 ? suggestedSelectedAgentId : undefined,
  };
}

type FocusFilterPatchIntent =
  | {
      kind: "skip";
      reason: "missing-gateway-key" | "focus-filter-not-touched";
    }
  | {
      kind: "patch";
      patch: StudioSettingsPatch;
      debounceMs: number;
    };

export function planFocusedFilterPatch(params: {
  gatewayKey: string;
  focusFilterTouched: boolean;
  focusFilter: FocusFilter;
}): FocusFilterPatchIntent {
  const gatewayKey = params.gatewayKey.trim();
  if (!gatewayKey) {
    return { kind: "skip", reason: "missing-gateway-key" };
  }
  if (!params.focusFilterTouched) {
    return { kind: "skip", reason: "focus-filter-not-touched" };
  }

  return {
    kind: "patch",
    patch: {
      focused: {
        [gatewayKey]: {
          mode: "focused",
          filter: params.focusFilter,
        },
      },
    },
    debounceMs: FOCUSED_PATCH_DEBOUNCE_MS,
  };
}

type FocusedSelectionPatchIntent =
  | {
      kind: "skip";
      reason:
        | "missing-gateway-key"
        | "not-connected"
        | "focused-preferences-not-loaded"
        | "agents-not-loaded"
        | "selected-agent-unchanged";
    }
  | {
      kind: "patch";
      patch: StudioSettingsPatch;
      persistence: "immediate";
    };

type StartupFleetBootstrapIntent =
  | {
      kind: "skip";
      reason:
        | "not-connected"
        | "focused-preferences-not-loaded"
        | "restart-blocked"
        | "create-blocked"
        | "already-loaded"
        | "in-flight";
    }
  | {
      kind: "load";
      key: string;
    };

export function planFocusedSelectionPatch(params: {
  gatewayKey: string;
  status: "connected" | "connecting" | "disconnected";
  focusedPreferencesLoaded: boolean;
  agentsLoadedOnce: boolean;
  selectedAgentId: string | null;
  lastPersistedSelectedAgentId?: string | null;
}): FocusedSelectionPatchIntent {
  const gatewayKey = params.gatewayKey.trim();
  if (!gatewayKey) {
    return { kind: "skip", reason: "missing-gateway-key" };
  }
  if (params.status !== "connected") {
    return { kind: "skip", reason: "not-connected" };
  }
  if (!params.focusedPreferencesLoaded) {
    return { kind: "skip", reason: "focused-preferences-not-loaded" };
  }
  if (!params.agentsLoadedOnce) {
    return { kind: "skip", reason: "agents-not-loaded" };
  }
  const selectedAgentId = params.selectedAgentId?.trim() ?? "";
  const lastPersistedSelectedAgentId = params.lastPersistedSelectedAgentId?.trim() ?? "";
  if (selectedAgentId === lastPersistedSelectedAgentId) {
    return { kind: "skip", reason: "selected-agent-unchanged" };
  }

  return {
    kind: "patch",
    patch: {
      focused: {
        [gatewayKey]: {
          mode: "focused",
          selectedAgentId: selectedAgentId.length > 0 ? selectedAgentId : null,
        },
      },
    },
    persistence: "immediate",
  };
}

export function planStartupFleetBootstrapIntent(params: {
  coreConnected: boolean;
  focusedPreferencesLoaded: boolean;
  hasRestartingMutationBlock: boolean;
  hasCreateAgentBlock: boolean;
  gatewayUrl: string;
  lastCompletedKey: string | null;
  inFlightKey: string | null;
}): StartupFleetBootstrapIntent {
  if (!params.coreConnected) {
    return { kind: "skip", reason: "not-connected" };
  }
  if (!params.focusedPreferencesLoaded) {
    return { kind: "skip", reason: "focused-preferences-not-loaded" };
  }
  if (params.hasRestartingMutationBlock) {
    return { kind: "skip", reason: "restart-blocked" };
  }
  if (params.hasCreateAgentBlock) {
    return { kind: "skip", reason: "create-blocked" };
  }

  const normalizedGatewayUrl = params.gatewayUrl.trim();
  if (!normalizedGatewayUrl) {
    return { kind: "skip", reason: "not-connected" };
  }
  const key = `domain:${normalizedGatewayUrl}`;
  if (params.inFlightKey === key) {
    return { kind: "skip", reason: "in-flight" };
  }
  if (params.lastCompletedKey === key) {
    return { kind: "skip", reason: "already-loaded" };
  }
  return { kind: "load", key };
}

type FocusedPreferenceRestoreIntent = {
  preferredSelectedAgentId: string | null;
  focusFilter: FocusFilter;
};

export function planFocusedPreferenceRestore(params: {
  settings: StudioSettings | null;
  gatewayKey: string;
  focusFilterTouched: boolean;
}): FocusedPreferenceRestoreIntent {
  const gatewayKey = params.gatewayKey.trim();
  if (!gatewayKey || params.focusFilterTouched || !params.settings) {
    return {
      preferredSelectedAgentId: null,
      focusFilter: "all",
    };
  }

  const preference = resolveFocusedPreference(params.settings, gatewayKey);
  if (!preference) {
    return {
      preferredSelectedAgentId: null,
      focusFilter: "all",
    };
  }

  const restoredFilter =
    preference.filter === "running" || preference.filter === "approvals"
      ? "all"
      : preference.filter;
  return {
    preferredSelectedAgentId: preference.selectedAgentId,
    focusFilter: restoredFilter,
  };
}
