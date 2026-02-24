export type SettingsRouteTab = "personality" | "capabilities" | "automations" | "advanced";

export type InspectSidebarState =
  | { agentId: string; tab: SettingsRouteTab }
  | null;

export type SettingsRouteNavCommand =
  | { kind: "select-agent"; agentId: string | null }
  | { kind: "set-inspect-sidebar"; value: InspectSidebarState }
  | { kind: "set-mobile-pane-chat" }
  | { kind: "set-personality-dirty"; value: boolean }
  | { kind: "flush-pending-draft"; agentId: string | null }
  | { kind: "push"; href: string }
  | { kind: "replace"; href: string };

export const SETTINGS_ROUTE_AGENT_ID_QUERY_PARAM = "settingsAgentId";

export const parseSettingsRouteAgentIdFromPathname = (pathname: string): string | null => {
  const match = pathname.match(/^\/agents\/([^/]+)\/settings\/?$/);
  if (!match) return null;
  try {
    const decoded = decodeURIComponent(match[1] ?? "");
    const trimmed = decoded.trim();
    return trimmed ? trimmed : null;
  } catch {
    const raw = (match[1] ?? "").trim();
    return raw ? raw : null;
  }
};

export const parseSettingsRouteAgentIdFromQueryParam = (value: string | null | undefined): string | null => {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return null;
  try {
    const decoded = decodeURIComponent(trimmed).trim();
    return decoded ? decoded : null;
  } catch {
    return trimmed;
  }
};

export const buildSettingsRouteHref = (agentId: string): string => {
  const resolved = agentId.trim();
  if (!resolved) {
    throw new Error("Cannot build settings route href: agent id is empty.");
  }
  return `/?${SETTINGS_ROUTE_AGENT_ID_QUERY_PARAM}=${encodeURIComponent(resolved)}`;
};

export const shouldConfirmDiscardPersonalityChanges = (params: {
  settingsRouteActive: boolean;
  activeTab: SettingsRouteTab;
  personalityHasUnsavedChanges: boolean;
}): boolean => {
  if (!params.settingsRouteActive) return false;
  if (params.activeTab !== "personality") return false;
  return params.personalityHasUnsavedChanges;
};

export const planBackToChatCommands = (input: {
  settingsRouteActive: boolean;
  activeTab: SettingsRouteTab;
  personalityHasUnsavedChanges: boolean;
  discardConfirmed: boolean;
}): SettingsRouteNavCommand[] => {
  if (
    shouldConfirmDiscardPersonalityChanges({
      settingsRouteActive: input.settingsRouteActive,
      activeTab: input.activeTab,
      personalityHasUnsavedChanges: input.personalityHasUnsavedChanges,
    }) &&
    !input.discardConfirmed
  ) {
    return [];
  }

  return [
    { kind: "set-personality-dirty", value: false },
    { kind: "push", href: "/" },
  ];
};

export const planSettingsTabChangeCommands = (input: {
  nextTab: SettingsRouteTab;
  currentInspectSidebar: InspectSidebarState;
  settingsRouteAgentId: string | null;
  settingsRouteActive: boolean;
  personalityHasUnsavedChanges: boolean;
  discardConfirmed: boolean;
}): SettingsRouteNavCommand[] => {
  const resolvedAgentId =
    (input.currentInspectSidebar?.agentId ?? input.settingsRouteAgentId ?? "").trim();
  if (!resolvedAgentId) return [];

  const currentTab = input.currentInspectSidebar?.tab ?? "personality";
  if (currentTab === input.nextTab) return [];

  const requiresDiscardConfirmation =
    currentTab === "personality" &&
    input.nextTab !== "personality" &&
    shouldConfirmDiscardPersonalityChanges({
      settingsRouteActive: input.settingsRouteActive,
      activeTab: currentTab,
      personalityHasUnsavedChanges: input.personalityHasUnsavedChanges,
    });

  if (requiresDiscardConfirmation && !input.discardConfirmed) {
    return [];
  }

  const commands: SettingsRouteNavCommand[] = [];
  if (requiresDiscardConfirmation) {
    commands.push({ kind: "set-personality-dirty", value: false });
  }
  commands.push({
    kind: "set-inspect-sidebar",
    value: { agentId: resolvedAgentId, tab: input.nextTab },
  });
  return commands;
};

export const planOpenSettingsRouteCommands = (input: {
  agentId: string;
  currentInspectSidebar: InspectSidebarState;
  focusedAgentId: string | null;
}): SettingsRouteNavCommand[] => {
  const resolvedAgentId = input.agentId.trim();
  if (!resolvedAgentId) return [];

  const commands: SettingsRouteNavCommand[] = [
    {
      kind: "flush-pending-draft",
      agentId: input.focusedAgentId,
    },
    {
      kind: "select-agent",
      agentId: resolvedAgentId,
    },
  ];

  if (input.currentInspectSidebar?.agentId !== resolvedAgentId) {
    commands.push({
      kind: "set-inspect-sidebar",
      value: {
        agentId: resolvedAgentId,
        tab: input.currentInspectSidebar?.tab ?? "personality",
      },
    });
  }

  commands.push(
    { kind: "set-mobile-pane-chat" },
    { kind: "push", href: buildSettingsRouteHref(resolvedAgentId) }
  );

  return commands;
};

export const planFleetSelectCommands = (input: {
  agentId: string;
  currentInspectSidebar: InspectSidebarState;
  focusedAgentId: string | null;
}): SettingsRouteNavCommand[] => {
  const resolvedAgentId = input.agentId.trim();
  if (!resolvedAgentId) return [];

  const commands: SettingsRouteNavCommand[] = [
    {
      kind: "flush-pending-draft",
      agentId: input.focusedAgentId,
    },
    {
      kind: "select-agent",
      agentId: resolvedAgentId,
    },
  ];

  if (input.currentInspectSidebar) {
    commands.push({
      kind: "set-inspect-sidebar",
      value: {
        ...input.currentInspectSidebar,
        agentId: resolvedAgentId,
      },
    });
  }

  commands.push({ kind: "set-mobile-pane-chat" });
  return commands;
};

export const planSettingsRouteSyncCommands = (input: {
  settingsRouteActive: boolean;
  settingsRouteAgentId: string | null;
  status: "disconnected" | "connecting" | "connected";
  agentsLoadedOnce: boolean;
  selectedAgentId: string | null;
  hasRouteAgent: boolean;
  currentInspectSidebar: InspectSidebarState;
}): SettingsRouteNavCommand[] => {
  const commands: SettingsRouteNavCommand[] = [];
  const routeAgentId = (input.settingsRouteAgentId ?? "").trim();

  if (routeAgentId && input.hasRouteAgent) {
    if (input.currentInspectSidebar?.agentId !== routeAgentId) {
      commands.push({
        kind: "set-inspect-sidebar",
        value: {
          agentId: routeAgentId,
          tab: input.currentInspectSidebar?.tab ?? "personality",
        },
      });
    }
    if (input.selectedAgentId !== routeAgentId) {
      commands.push({ kind: "select-agent", agentId: routeAgentId });
    }
  }

  if (
    input.settingsRouteActive &&
    routeAgentId &&
    input.status === "connected" &&
    input.agentsLoadedOnce &&
    !input.hasRouteAgent
  ) {
    commands.push({ kind: "replace", href: "/" });
  }

  return commands;
};

export const planNonRouteSelectionSyncCommands = (input: {
  settingsRouteActive: boolean;
  selectedAgentId: string | null;
  focusedAgentId: string | null;
  hasSelectedAgentInAgents: boolean;
  currentInspectSidebar: InspectSidebarState;
  hasInspectSidebarAgent: boolean;
}): SettingsRouteNavCommand[] => {
  if (input.settingsRouteActive) return [];

  const commands: SettingsRouteNavCommand[] = [];
  const selectedAgentId = input.selectedAgentId?.trim() ?? "";

  if (input.currentInspectSidebar) {
    if (!selectedAgentId) {
      commands.push({ kind: "set-inspect-sidebar", value: null });
    } else if (input.currentInspectSidebar.agentId !== selectedAgentId) {
      commands.push({
        kind: "set-inspect-sidebar",
        value: {
          ...input.currentInspectSidebar,
          agentId: selectedAgentId,
        },
      });
    }
  }

  if (input.currentInspectSidebar?.agentId && !input.hasInspectSidebarAgent) {
    commands.push({ kind: "set-inspect-sidebar", value: null });
  }

  if (selectedAgentId && !input.hasSelectedAgentInAgents) {
    commands.push({ kind: "select-agent", agentId: null });
  }

  const nextSelectedAgentId = input.focusedAgentId ?? null;
  if (input.selectedAgentId !== nextSelectedAgentId) {
    commands.push({ kind: "select-agent", agentId: nextSelectedAgentId });
  }

  return commands;
};
