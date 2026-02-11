import {
  buildCronJobCreateInput,
  type CronCreateDraft,
} from "@/lib/cron/createPayloadBuilder";
import {
  createCronJob as createCronJobDefault,
  filterCronJobsForAgent,
  listCronJobs as listCronJobsDefault,
  sortCronJobsByUpdatedAt,
  type CronJobCreateInput,
  type CronJobSummary,
} from "@/lib/cron/types";
import type { GatewayClient } from "@/lib/gateway/GatewayClient";

export const CRON_ACTION_BUSY_MESSAGE = "Please wait for the current cron action to finish.";

const resolveCreateAgentId = (agentId: string) => {
  const trimmed = agentId.trim();
  if (!trimmed) {
    throw new Error("Failed to create cron job: missing agent id.");
  }
  return trimmed;
};

const resolveCreateErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "Failed to create cron job.";

export type CronBusyState = {
  createBusy: boolean;
  runBusyJobId: string | null;
  deleteBusyJobId: string | null;
};

type CronCreateDeps = {
  buildInput?: (agentId: string, draft: CronCreateDraft) => CronJobCreateInput;
  createCronJob?: (client: GatewayClient, input: CronJobCreateInput) => Promise<unknown>;
  listCronJobs?: (
    client: GatewayClient,
    params: { includeDisabled?: boolean }
  ) => Promise<{ jobs: CronJobSummary[] }>;
};

const isCronActionBusy = (busy: CronBusyState) =>
  busy.createBusy || Boolean(busy.runBusyJobId) || Boolean(busy.deleteBusyJobId);

export const performCronCreateFlow = async (params: {
  client: GatewayClient;
  agentId: string;
  draft: CronCreateDraft;
  busy: CronBusyState;
  onBusyChange: (busy: boolean) => void;
  onError: (message: string | null) => void;
  onJobs: (jobs: CronJobSummary[]) => void;
  deps?: CronCreateDeps;
}): Promise<"created"> => {
  if (isCronActionBusy(params.busy)) {
    params.onError(CRON_ACTION_BUSY_MESSAGE);
    throw new Error(CRON_ACTION_BUSY_MESSAGE);
  }

  let resolvedAgentId = "";
  try {
    resolvedAgentId = resolveCreateAgentId(params.agentId);
  } catch (error) {
    const message = resolveCreateErrorMessage(error);
    params.onError(message);
    throw error;
  }

  const buildInput = params.deps?.buildInput ?? buildCronJobCreateInput;
  const createCronJob = params.deps?.createCronJob ?? createCronJobDefault;
  const listCronJobs = params.deps?.listCronJobs ?? listCronJobsDefault;

  params.onBusyChange(true);
  params.onError(null);

  try {
    const input = buildInput(resolvedAgentId, params.draft);
    await createCronJob(params.client, input);
    const listResult = await listCronJobs(params.client, { includeDisabled: true });
    const jobs = sortCronJobsByUpdatedAt(filterCronJobsForAgent(listResult.jobs, resolvedAgentId));
    params.onJobs(jobs);
    return "created";
  } catch (error) {
    const message = resolveCreateErrorMessage(error);
    params.onError(message);
    throw error instanceof Error ? error : new Error(message);
  } finally {
    params.onBusyChange(false);
  }
};
