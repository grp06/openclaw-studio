export type CreateBootstrapFacts = {
  completion: { agentId: string; agentName: string };
  createdAgent: { agentId: string; sessionKey: string } | null;
  bootstrapErrorMessage: string | null;
  focusedAgentId: string | null;
};

export type CreateBootstrapCommand =
  | { kind: "set-create-modal-error"; message: string | null }
  | { kind: "set-global-error"; message: string }
  | { kind: "set-create-block"; value: null }
  | { kind: "set-create-modal-open"; open: boolean }
  | { kind: "flush-pending-draft"; agentId: string | null }
  | { kind: "select-agent"; agentId: string }
  | { kind: "set-inspect-sidebar"; agentId: string; tab: "capabilities" }
  | { kind: "set-mobile-pane"; pane: "chat" };

const buildMissingCreatedAgentMessage = (agentName: string): string =>
  `Agent "${agentName}" was created, but Studio could not load it yet.`;

const buildBootstrapGlobalErrorMessage = (errorMessage: string): string =>
  `Agent created, but default permissions could not be applied: ${errorMessage}`;

const buildBootstrapModalErrorMessage = (errorMessage: string): string =>
  `Default permissions failed: ${errorMessage}`;

export function planCreateAgentBootstrapCommands(
  facts: CreateBootstrapFacts
): CreateBootstrapCommand[] {
  if (!facts.createdAgent) {
    const message = buildMissingCreatedAgentMessage(facts.completion.agentName);
    return [
      { kind: "set-create-modal-error", message },
      { kind: "set-global-error", message },
      { kind: "set-create-block", value: null },
      { kind: "set-create-modal-open", open: false },
    ];
  }

  const commands: CreateBootstrapCommand[] = [];
  if (facts.bootstrapErrorMessage) {
    commands.push({
      kind: "set-global-error",
      message: buildBootstrapGlobalErrorMessage(facts.bootstrapErrorMessage),
    });
  }
  commands.push({ kind: "flush-pending-draft", agentId: facts.focusedAgentId });
  commands.push({ kind: "select-agent", agentId: facts.completion.agentId });
  commands.push({
    kind: "set-inspect-sidebar",
    agentId: facts.completion.agentId,
    tab: "capabilities",
  });
  commands.push({ kind: "set-mobile-pane", pane: "chat" });
  commands.push({
    kind: "set-create-modal-error",
    message: facts.bootstrapErrorMessage
      ? buildBootstrapModalErrorMessage(facts.bootstrapErrorMessage)
      : null,
  });
  commands.push({ kind: "set-create-block", value: null });
  commands.push({ kind: "set-create-modal-open", open: false });
  return commands;
}
