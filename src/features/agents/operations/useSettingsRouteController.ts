import { useCallback, useEffect } from "react";

import {
  planBackToChatCommands,
  planFleetSelectCommands,
  planNonRouteSelectionSyncCommands,
  planOpenSettingsRouteCommands,
  planSettingsRouteSyncCommands,
  planSettingsTabChangeCommands,
  shouldConfirmDiscardPersonalityChanges,
  type InspectSidebarState,
  type SettingsRouteNavCommand,
  type SettingsRouteTab,
} from "@/features/agents/operations/settingsRouteWorkflow";

export type UseSettingsRouteControllerParams = {
  settingsRouteActive: boolean;
  settingsRouteAgentId: string | null;
  status: "disconnected" | "connecting" | "connected";
  agentsLoadedOnce: boolean;
  selectedAgentId: string | null;
  focusedAgentId: string | null;
  personalityHasUnsavedChanges: boolean;
  activeTab: SettingsRouteTab;
  inspectSidebar: InspectSidebarState;
  agents: Array<{ agentId: string }>;
  flushPendingDraft: (agentId: string | null) => void;
  dispatchSelectAgent: (agentId: string | null) => void;
  setInspectSidebar: (
    next: InspectSidebarState | ((current: InspectSidebarState) => InspectSidebarState)
  ) => void;
  setMobilePaneChat: () => void;
  setPersonalityHasUnsavedChanges: (next: boolean) => void;
  push: (href: string) => void;
  replace: (href: string) => void;
  confirmDiscard: () => boolean;
};

export type SettingsRouteController = {
  handleBackToChat: () => void;
  handleSettingsRouteTabChange: (nextTab: SettingsRouteTab) => void;
  handleOpenAgentSettingsRoute: (agentId: string) => void;
  handleFleetSelectAgent: (agentId: string) => void;
};

const executeSettingsRouteCommands = (
  commands: SettingsRouteNavCommand[],
  params: Pick<
    UseSettingsRouteControllerParams,
    | "dispatchSelectAgent"
    | "setInspectSidebar"
    | "setMobilePaneChat"
    | "setPersonalityHasUnsavedChanges"
    | "flushPendingDraft"
    | "push"
    | "replace"
  >
) => {
  for (const command of commands) {
    switch (command.kind) {
      case "select-agent":
        params.dispatchSelectAgent(command.agentId);
        break;
      case "set-inspect-sidebar":
        params.setInspectSidebar(command.value);
        break;
      case "set-mobile-pane-chat":
        params.setMobilePaneChat();
        break;
      case "set-personality-dirty":
        params.setPersonalityHasUnsavedChanges(command.value);
        break;
      case "flush-pending-draft":
        params.flushPendingDraft(command.agentId);
        break;
      case "push":
        params.push(command.href);
        break;
      case "replace":
        params.replace(command.href);
        break;
      default: {
        const _exhaustive: never = command;
        throw new Error(`Unsupported settings route command: ${_exhaustive}`);
      }
    }
  }
};

export function useSettingsRouteController(
  params: UseSettingsRouteControllerParams
): SettingsRouteController {
  const applyCommands = useCallback(
    (commands: SettingsRouteNavCommand[]) => {
      executeSettingsRouteCommands(commands, {
        dispatchSelectAgent: params.dispatchSelectAgent,
        setInspectSidebar: params.setInspectSidebar,
        setMobilePaneChat: params.setMobilePaneChat,
        setPersonalityHasUnsavedChanges: params.setPersonalityHasUnsavedChanges,
        flushPendingDraft: params.flushPendingDraft,
        push: params.push,
        replace: params.replace,
      });
    },
    [
      params.dispatchSelectAgent,
      params.flushPendingDraft,
      params.push,
      params.replace,
      params.setInspectSidebar,
      params.setMobilePaneChat,
      params.setPersonalityHasUnsavedChanges,
    ]
  );

  const handleBackToChat = useCallback(() => {
    const needsDiscardConfirmation = shouldConfirmDiscardPersonalityChanges({
      settingsRouteActive: params.settingsRouteActive,
      activeTab: params.activeTab,
      personalityHasUnsavedChanges: params.personalityHasUnsavedChanges,
    });
    const discardConfirmed = needsDiscardConfirmation ? params.confirmDiscard() : true;
    const commands = planBackToChatCommands({
      settingsRouteActive: params.settingsRouteActive,
      activeTab: params.activeTab,
      personalityHasUnsavedChanges: params.personalityHasUnsavedChanges,
      discardConfirmed,
    });
    applyCommands(commands);
  }, [
    applyCommands,
    params.activeTab,
    params.confirmDiscard,
    params.personalityHasUnsavedChanges,
    params.settingsRouteActive,
  ]);

  const handleSettingsRouteTabChange = useCallback(
    (nextTab: SettingsRouteTab) => {
      const currentTab = params.inspectSidebar?.tab ?? "personality";
      const needsDiscardConfirmation =
        currentTab === "personality" &&
        nextTab !== "personality" &&
        shouldConfirmDiscardPersonalityChanges({
          settingsRouteActive: params.settingsRouteActive,
          activeTab: currentTab,
          personalityHasUnsavedChanges: params.personalityHasUnsavedChanges,
        });
      const discardConfirmed = needsDiscardConfirmation ? params.confirmDiscard() : true;

      const commands = planSettingsTabChangeCommands({
        nextTab,
        currentInspectSidebar: params.inspectSidebar,
        settingsRouteAgentId: params.settingsRouteAgentId,
        settingsRouteActive: params.settingsRouteActive,
        personalityHasUnsavedChanges: params.personalityHasUnsavedChanges,
        discardConfirmed,
      });
      applyCommands(commands);
    },
    [
      applyCommands,
      params.confirmDiscard,
      params.inspectSidebar,
      params.personalityHasUnsavedChanges,
      params.settingsRouteActive,
      params.settingsRouteAgentId,
    ]
  );

  const handleOpenAgentSettingsRoute = useCallback(
    (agentId: string) => {
      const commands = planOpenSettingsRouteCommands({
        agentId,
        currentInspectSidebar: params.inspectSidebar,
        focusedAgentId: params.focusedAgentId,
      });
      applyCommands(commands);
    },
    [applyCommands, params.focusedAgentId, params.inspectSidebar]
  );

  const handleFleetSelectAgent = useCallback(
    (agentId: string) => {
      const commands = planFleetSelectCommands({
        agentId,
        currentInspectSidebar: params.inspectSidebar,
        focusedAgentId: params.focusedAgentId,
      });
      applyCommands(commands);
    },
    [applyCommands, params.focusedAgentId, params.inspectSidebar]
  );

  useEffect(() => {
    const routeAgentId = (params.settingsRouteAgentId ?? "").trim();
    const hasRouteAgent = routeAgentId
      ? params.agents.some((agent) => agent.agentId === routeAgentId)
      : false;

    const commands = planSettingsRouteSyncCommands({
      settingsRouteActive: params.settingsRouteActive,
      settingsRouteAgentId: params.settingsRouteAgentId,
      status: params.status,
      agentsLoadedOnce: params.agentsLoadedOnce,
      selectedAgentId: params.selectedAgentId,
      hasRouteAgent,
      currentInspectSidebar: params.inspectSidebar,
    });

    applyCommands(commands);
  }, [
    applyCommands,
    params.agents,
    params.agentsLoadedOnce,
    params.inspectSidebar,
    params.selectedAgentId,
    params.settingsRouteActive,
    params.settingsRouteAgentId,
    params.status,
  ]);

  useEffect(() => {
    const hasSelectedAgentInAgents = params.selectedAgentId
      ? params.agents.some((agent) => agent.agentId === params.selectedAgentId)
      : false;
    const hasInspectSidebarAgent = params.inspectSidebar?.agentId
      ? params.agents.some((agent) => agent.agentId === params.inspectSidebar?.agentId)
      : false;

    const commands = planNonRouteSelectionSyncCommands({
      settingsRouteActive: params.settingsRouteActive,
      selectedAgentId: params.selectedAgentId,
      focusedAgentId: params.focusedAgentId,
      hasSelectedAgentInAgents,
      currentInspectSidebar: params.inspectSidebar,
      hasInspectSidebarAgent,
    });

    applyCommands(commands);
  }, [
    applyCommands,
    params.agents,
    params.focusedAgentId,
    params.inspectSidebar,
    params.selectedAgentId,
    params.settingsRouteActive,
  ]);

  return {
    handleBackToChat,
    handleSettingsRouteTabChange,
    handleOpenAgentSettingsRoute,
    handleFleetSelectAgent,
  };
}
