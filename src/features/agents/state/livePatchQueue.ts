import type { AgentState } from "@/features/agents/state/store";

const normalizedRunId = (value: unknown): string => {
  return typeof value === "string" ? value.trim() : "";
};

export const mergePendingLivePatch = (
  existing: Partial<AgentState> | undefined,
  incoming: Partial<AgentState>
): Partial<AgentState> => {
  if (!existing) return incoming;

  const existingRunId = normalizedRunId(existing.runId);
  const incomingRunId = normalizedRunId(incoming.runId);

  if (incomingRunId && existingRunId && incomingRunId !== existingRunId) {
    return incoming;
  }

  if (incomingRunId && !existingRunId) {
    const rest = { ...existing };
    delete rest.streamText;
    delete rest.thinkingTrace;
    return { ...rest, ...incoming };
  }

  return { ...existing, ...incoming };
};
