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
  const {
    settingsRouteActive,
    settingsRouteAgentId,
    status,
    agentsLoadedOnce,
    selectedAgentId,
    focusedAgentId,
    personalityHasUnsavedChanges,
    activeTab,
    inspectSidebar,
    agents,
    flushPendingDraft,
    dispatchSelectAgent,
    setInspectSidebar,
    setMobilePaneChat,
    setPersonalityHasUnsavedChanges,
    push,
    replace,
    confirmDiscard,
  } = params;
  const applyCommands = useCallback(
    (commands: SettingsRouteNavCommand[]) => {
      executeSettingsRouteCommands(commands, {
        dispatchSelectAgent,
        setInspectSidebar,
        setMobilePaneChat,
        setPersonalityHasUnsavedChanges,
        flushPendingDraft,
        push,
        replace,
      });
    },
    [
      dispatchSelectAgent,
      flushPendingDraft,
      push,
      replace,
      setInspectSidebar,
      setMobilePaneChat,
      setPersonalityHasUnsavedChanges,
    ]
  );

  const handleBackToChat = useCallback(() => {
    const needsDiscardConfirmation = shouldConfirmDiscardPersonalityChanges({
      settingsRouteActive,
      activeTab,
      personalityHasUnsavedChanges,
    });
    const discardConfirmed = needsDiscardConfirmation ? confirmDiscard() : true;
    const commands = planBackToChatCommands({
      settingsRouteActive,
      activeTab,
      personalityHasUnsavedChanges,
      discardConfirmed,
    });
    applyCommands(commands);
  }, [
    activeTab,
    applyCommands,
    confirmDiscard,
    personalityHasUnsavedChanges,
    settingsRouteActive,
  ]);

  const handleSettingsRouteTabChange = useCallback(
    (nextTab: SettingsRouteTab) => {
      const currentTab = inspectSidebar?.tab ?? "personality";
      const needsDiscardConfirmation =
        currentTab === "personality" &&
        nextTab !== "personality" &&
        shouldConfirmDiscardPersonalityChanges({
          settingsRouteActive,
          activeTab: currentTab,
          personalityHasUnsavedChanges,
        });
      const discardConfirmed = needsDiscardConfirmation ? confirmDiscard() : true;

      const commands = planSettingsTabChangeCommands({
        nextTab,
        currentInspectSidebar: inspectSidebar,
        settingsRouteAgentId,
        settingsRouteActive,
        personalityHasUnsavedChanges,
        discardConfirmed,
      });
      applyCommands(commands);
    },
    [
      applyCommands,
      confirmDiscard,
      inspectSidebar,
      personalityHasUnsavedChanges,
      settingsRouteActive,
      settingsRouteAgentId,
    ]
  );

  const handleOpenAgentSettingsRoute = useCallback(
    (agentId: string) => {
      const commands = planOpenSettingsRouteCommands({
        agentId,
        currentInspectSidebar: inspectSidebar,
        focusedAgentId,
      });
      applyCommands(commands);
    },
    [applyCommands, focusedAgentId, inspectSidebar]
  );

  const handleFleetSelectAgent = useCallback(
    (agentId: string) => {
      const commands = planFleetSelectCommands({
        agentId,
        currentInspectSidebar: inspectSidebar,
        focusedAgentId,
      });
      applyCommands(commands);
    },
    [applyCommands, focusedAgentId, inspectSidebar]
  );

  useEffect(() => {
    const routeAgentId = (settingsRouteAgentId ?? "").trim();
    const hasRouteAgent = routeAgentId
      ? agents.some((agent) => agent.agentId === routeAgentId)
      : false;

    const commands = planSettingsRouteSyncCommands({
      settingsRouteActive,
      settingsRouteAgentId,
      status,
      agentsLoadedOnce,
      selectedAgentId,
      hasRouteAgent,
      currentInspectSidebar: inspectSidebar,
    });

    applyCommands(commands);
  }, [
    agents,
    agentsLoadedOnce,
    applyCommands,
    inspectSidebar,
    selectedAgentId,
    settingsRouteActive,
    settingsRouteAgentId,
    status,
  ]);

  useEffect(() => {
    const hasSelectedAgentInAgents = selectedAgentId
      ? agents.some((agent) => agent.agentId === selectedAgentId)
      : false;
    const hasInspectSidebarAgent = inspectSidebar?.agentId
      ? agents.some((agent) => agent.agentId === inspectSidebar?.agentId)
      : false;

    const commands = planNonRouteSelectionSyncCommands({
      settingsRouteActive,
      selectedAgentId,
      focusedAgentId,
      hasSelectedAgentInAgents,
      currentInspectSidebar: inspectSidebar,
      hasInspectSidebarAgent,
    });

    applyCommands(commands);
  }, [
    agents,
    applyCommands,
    focusedAgentId,
    inspectSidebar,
    selectedAgentId,
    settingsRouteActive,
  ]);

  return {
    handleBackToChat,
    handleSettingsRouteTabChange,
    handleOpenAgentSettingsRoute,
    handleFleetSelectAgent,
  };
}
