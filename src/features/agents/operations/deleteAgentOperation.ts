import type { GatewayClient } from "@/lib/gateway/GatewayClient";
import { fetchJson as defaultFetchJson } from "@/lib/http";
import {
  removeCronJobsForAgentWithBackup,
  restoreCronJobs,
  type CronJobRestoreInput,
} from "@/lib/cron/types";
import {
  createRuntimeWriteTransport,
  type RuntimeWriteTransport,
} from "@/features/agents/operations/runtimeWriteTransport";

type FetchJson = typeof defaultFetchJson;

type GatewayAgentStateMove = { from: string; to: string };

type TrashAgentStateResult = {
  trashDir: string;
  moved: GatewayAgentStateMove[];
};

type RestoreAgentStateResult = {
  restored: GatewayAgentStateMove[];
};

type DeleteAgentTransactionDeps = {
  trashAgentState: (agentId: string) => Promise<TrashAgentStateResult>;
  restoreAgentState: (agentId: string, trashDir: string) => Promise<RestoreAgentStateResult>;
  removeCronJobsForAgentWithBackup: (agentId: string) => Promise<CronJobRestoreInput[]>;
  restoreCronJobs: (jobs: CronJobRestoreInput[]) => Promise<void>;
  deleteGatewayAgent: (agentId: string) => Promise<void>;
  logError?: (message: string, error: unknown) => void;
};

type DeleteAgentTransactionResult = {
  trashed: TrashAgentStateResult;
  restored: RestoreAgentStateResult | null;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

const parseRemovedCronJobs = (value: unknown): CronJobRestoreInput[] => {
  if (!isRecord(value)) {
    throw new Error("Invalid cron-remove-agent response payload.");
  }
  if (value.ok !== true) {
    throw new Error("cron-remove-agent intent did not succeed.");
  }
  const payload = isRecord(value.payload) ? value.payload : null;
  if (!payload || !Array.isArray(payload.removedJobs)) {
    throw new Error("cron-remove-agent payload is missing removedJobs.");
  }
  return payload.removedJobs as CronJobRestoreInput[];
};

const removeCronJobsViaIntent = async (params: {
  fetchJson: FetchJson;
  agentId: string;
}): Promise<CronJobRestoreInput[]> => {
  const result = await params.fetchJson<unknown>("/api/intents/cron-remove-agent", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ agentId: params.agentId }),
  });
  return parseRemovedCronJobs(result);
};

const restoreCronJobsViaIntent = async (params: {
  fetchJson: FetchJson;
  jobs: CronJobRestoreInput[];
}): Promise<void> => {
  if (params.jobs.length === 0) return;
  const result = await params.fetchJson<unknown>("/api/intents/cron-restore", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jobs: params.jobs }),
  });
  if (!isRecord(result) || result.ok !== true) {
    throw new Error("cron-restore intent did not succeed.");
  }
};

const runDeleteFlow = async (
  deps: DeleteAgentTransactionDeps,
  agentId: string
): Promise<DeleteAgentTransactionResult> => {
  const trimmedAgentId = agentId.trim();
  if (!trimmedAgentId) {
    throw new Error("Agent id is required.");
  }

  const trashed = await deps.trashAgentState(trimmedAgentId);
  let removedCronJobs: CronJobRestoreInput[] = [];

  try {
    removedCronJobs = await deps.removeCronJobsForAgentWithBackup(trimmedAgentId);
    await deps.deleteGatewayAgent(trimmedAgentId);
    return { trashed, restored: null };
  } catch (err) {
    if (removedCronJobs.length > 0) {
      try {
        await deps.restoreCronJobs(removedCronJobs);
      } catch (restoreCronErr) {
        deps.logError?.("Failed to restore removed cron jobs.", restoreCronErr);
      }
    }
    if (trashed.moved.length > 0) {
      try {
        await deps.restoreAgentState(trimmedAgentId, trashed.trashDir);
      } catch (restoreErr) {
        deps.logError?.("Failed to restore trashed agent state.", restoreErr);
      }
    }
    throw err;
  }
};

export const deleteAgentViaStudio = async (params: {
  client: GatewayClient;
  runtimeWriteTransport?: RuntimeWriteTransport;
  agentId: string;
  fetchJson?: FetchJson;
  logError?: (message: string, error: unknown) => void;
}): Promise<DeleteAgentTransactionResult> => {
  const fetchJson = params.fetchJson ?? defaultFetchJson;
  const logError = params.logError ?? ((message, error) => console.error(message, error));
  const runtimeWriteTransport =
    params.runtimeWriteTransport ??
    createRuntimeWriteTransport({
      client: params.client,
      useDomainIntents: false,
    });
  const useDomainCronIntents = runtimeWriteTransport.useDomainIntents === true;

  return runDeleteFlow(
    {
      trashAgentState: async (agentId) => {
        const { result } = await fetchJson<{ result: TrashAgentStateResult }>(
          "/api/runtime/agent-state",
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ agentId }),
          }
        );
        return result;
      },
      restoreAgentState: async (agentId, trashDir) => {
        const { result } = await fetchJson<{ result: RestoreAgentStateResult }>(
          "/api/runtime/agent-state",
          {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ agentId, trashDir }),
          }
        );
        return result;
      },
      removeCronJobsForAgentWithBackup: async (agentId) => {
        if (useDomainCronIntents) {
          return await removeCronJobsViaIntent({ fetchJson, agentId });
        }
        return await removeCronJobsForAgentWithBackup(params.client, agentId);
      },
      restoreCronJobs: async (jobs) => {
        if (useDomainCronIntents) {
          await restoreCronJobsViaIntent({ fetchJson, jobs });
          return;
        }
        await restoreCronJobs(params.client, jobs);
      },
      deleteGatewayAgent: async (agentId) => {
        await runtimeWriteTransport.agentDelete({ agentId });
      },
      logError,
    },
    params.agentId
  );
};
