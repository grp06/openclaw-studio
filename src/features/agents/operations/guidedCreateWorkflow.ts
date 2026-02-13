import type { AgentGuidedSetup } from "@/features/agents/operations/createAgentOperation";

export type GuidedCreateWorkflowDeps = {
  createAgent: (name: string) => Promise<{ id: string }>;
  applySetup: (agentId: string, setup: AgentGuidedSetup) => Promise<void>;
  upsertPending: (agentId: string, setup: AgentGuidedSetup) => void;
  removePending: (agentId: string) => void;
};

export type GuidedCreateWorkflowInput = {
  name: string;
  setup: AgentGuidedSetup;
  isLocalGateway: boolean;
};

export type GuidedCreateWorkflowResult = {
  agentId: string;
  setupStatus: "applied" | "pending";
  setupErrorMessage: string | null;
};

export type GuidedRetryWorkflowDeps = {
  applyPendingSetup: (agentId: string) => Promise<{ applied: boolean }>;
  removePending: (agentId: string) => void;
};

export type GuidedRetryWorkflowResult = {
  applied: boolean;
};

const resolveErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "Agent setup failed.";

const resolveAgentId = (value: string): string => {
  const id = value.trim();
  if (!id) {
    throw new Error("Agent id is required.");
  }
  return id;
};

export const runGuidedCreateWorkflow = async (
  input: GuidedCreateWorkflowInput,
  deps: GuidedCreateWorkflowDeps
): Promise<GuidedCreateWorkflowResult> => {
  const name = input.name.trim();
  if (!name) {
    throw new Error("Agent name is required.");
  }

  const created = await deps.createAgent(name);
  const agentId = resolveAgentId(created.id);
  if (!input.isLocalGateway) {
    deps.upsertPending(agentId, input.setup);
  }

  try {
    await deps.applySetup(agentId, input.setup);
    deps.removePending(agentId);
    return {
      agentId,
      setupStatus: "applied",
      setupErrorMessage: null,
    };
  } catch (error) {
    if (input.isLocalGateway) {
      deps.upsertPending(agentId, input.setup);
    }
    return {
      agentId,
      setupStatus: "pending",
      setupErrorMessage: resolveErrorMessage(error),
    };
  }
};

export const runGuidedRetryWorkflow = async (
  agentId: string,
  deps: GuidedRetryWorkflowDeps
): Promise<GuidedRetryWorkflowResult> => {
  const resolvedAgentId = resolveAgentId(agentId);
  const result = await deps.applyPendingSetup(resolvedAgentId);
  if (result.applied) {
    deps.removePending(resolvedAgentId);
  }
  return { applied: result.applied };
};
