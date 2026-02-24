import type { FocusFilter } from "@/features/agents/state/store";
import {
  resolveFocusedPreference,
  type StudioSettings,
  type StudioSettingsPatch,
} from "@/lib/studio/settings";

const FOCUSED_PATCH_DEBOUNCE_MS = 300;

export type BootstrapSelectionIntent = {
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

export type FocusFilterPatchIntent =
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

export type FocusedSelectionPatchIntent =
  | {
      kind: "skip";
      reason:
        | "missing-gateway-key"
        | "not-connected"
        | "focused-preferences-not-loaded"
        | "agents-not-loaded";
    }
  | {
      kind: "patch";
      patch: StudioSettingsPatch;
      debounceMs: number;
    };

export function planFocusedSelectionPatch(params: {
  gatewayKey: string;
  status: "connected" | "connecting" | "disconnected";
  focusedPreferencesLoaded: boolean;
  agentsLoadedOnce: boolean;
  selectedAgentId: string | null;
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

  return {
    kind: "patch",
    patch: {
      focused: {
        [gatewayKey]: {
          mode: "focused",
          selectedAgentId: params.selectedAgentId,
        },
      },
    },
    debounceMs: FOCUSED_PATCH_DEBOUNCE_MS,
  };
}

export type FocusedPreferenceRestoreIntent = {
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

  return {
    preferredSelectedAgentId: preference.selectedAgentId,
    focusFilter: preference.filter,
  };
}
