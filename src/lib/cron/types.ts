import type { GatewayClient } from "@/lib/gateway/GatewayClient";

export type CronSchedule =
  | { kind: "at"; at: string }
  | { kind: "every"; everyMs: number; anchorMs?: number }
  | { kind: "cron"; expr: string; tz?: string };

export type CronSessionTarget = "main" | "isolated";
export type CronWakeMode = "next-heartbeat" | "now";

export type CronDeliveryMode = "none" | "announce";
export type CronDelivery = {
  mode: CronDeliveryMode;
  channel?: string;
  to?: string;
  bestEffort?: boolean;
};

export type CronPayload =
  | { kind: "systemEvent"; text: string }
  | {
      kind: "agentTurn";
      message: string;
      model?: string;
      thinking?: string;
      timeoutSeconds?: number;
      allowUnsafeExternalContent?: boolean;
      deliver?: boolean;
      channel?: string;
      to?: string;
      bestEffortDeliver?: boolean;
    };

export type CronJobState = {
  nextRunAtMs?: number;
  runningAtMs?: number;
  lastRunAtMs?: number;
  lastStatus?: "ok" | "error" | "skipped";
  lastError?: string;
  lastDurationMs?: number;
};

export type CronJobSummary = {
  id: string;
  name: string;
  agentId?: string;
  enabled: boolean;
  updatedAtMs: number;
  schedule: CronSchedule;
  sessionTarget: CronSessionTarget;
  wakeMode: CronWakeMode;
  payload: CronPayload;
  state: CronJobState;
  delivery?: CronDelivery;
};

export type CronJobsResult = {
  jobs: CronJobSummary[];
};

export const sortCronJobsByUpdatedAt = (jobs: CronJobSummary[]) =>
  [...jobs].sort((a, b) => b.updatedAtMs - a.updatedAtMs);

export type CronJobCreateInput = {
  name: string;
  agentId: string;
  description?: string;
  enabled?: boolean;
  deleteAfterRun?: boolean;
  schedule: CronSchedule;
  sessionTarget: CronSessionTarget;
  wakeMode: CronWakeMode;
  payload: CronPayload;
  delivery?: CronDelivery;
};

export const filterCronJobsForAgent = (jobs: CronJobSummary[], agentId: string): CronJobSummary[] => {
  const trimmedAgentId = agentId.trim();
  if (!trimmedAgentId) return [];
  return jobs.filter((job) => job.agentId?.trim() === trimmedAgentId);
};

export const resolveLatestCronJobForAgent = (
  jobs: CronJobSummary[],
  agentId: string
): CronJobSummary | null => {
  const filtered = filterCronJobsForAgent(jobs, agentId);
  if (filtered.length === 0) return null;
  return [...filtered].sort((a, b) => b.updatedAtMs - a.updatedAtMs)[0] ?? null;
};

const formatEveryMs = (everyMs: number) => {
  if (everyMs % 3600000 === 0) {
    return `${everyMs / 3600000}h`;
  }
  if (everyMs % 60000 === 0) {
    return `${everyMs / 60000}m`;
  }
  if (everyMs % 1000 === 0) {
    return `${everyMs / 1000}s`;
  }
  return `${everyMs}ms`;
};

export const formatCronSchedule = (schedule: CronSchedule) => {
  if (schedule.kind === "every") {
    return `Every ${formatEveryMs(schedule.everyMs)}`;
  }
  if (schedule.kind === "cron") {
    return schedule.tz ? `Cron: ${schedule.expr} (${schedule.tz})` : `Cron: ${schedule.expr}`;
  }
  const atDate = new Date(schedule.at);
  if (Number.isNaN(atDate.getTime())) return `At: ${schedule.at}`;
  return `At: ${atDate.toLocaleString()}`;
};

export const formatCronPayload = (payload: CronPayload) => {
  if (payload.kind === "systemEvent") return payload.text;
  return payload.message;
};

export const formatCronJobDisplay = (job: CronJobSummary) => {
  const lines = [job.name, formatCronSchedule(job.schedule), formatCronPayload(job.payload)].filter(
    Boolean
  );
  return lines.join("\n");
};

export type CronListParams = {
  includeDisabled?: boolean;
};

export type CronRunResult =
  | { ok: true; ran: true }
  | { ok: true; ran: false; reason: "not-due" }
  | { ok: false };

export type CronRemoveResult = { ok: true; removed: boolean } | { ok: false; removed: false };

const resolveJobId = (jobId: string): string => {
  const trimmed = jobId.trim();
  if (!trimmed) {
    throw new Error("Cron job id is required.");
  }
  return trimmed;
};

const resolveAgentId = (agentId: string): string => {
  const trimmed = agentId.trim();
  if (!trimmed) {
    throw new Error("Agent id is required.");
  }
  return trimmed;
};

const resolveCronJobName = (name: string): string => {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error("Cron job name is required.");
  }
  return trimmed;
};

export const listCronJobs = async (
  client: GatewayClient,
  params: CronListParams = {}
): Promise<CronJobsResult> => {
  const includeDisabled = params.includeDisabled ?? true;
  return client.call<CronJobsResult>("cron.list", {
    includeDisabled,
  });
};

export const runCronJobNow = async (client: GatewayClient, jobId: string): Promise<CronRunResult> => {
  const id = resolveJobId(jobId);
  return client.call<CronRunResult>("cron.run", {
    id,
    mode: "force",
  });
};

export const removeCronJob = async (
  client: GatewayClient,
  jobId: string
): Promise<CronRemoveResult> => {
  const id = resolveJobId(jobId);
  return client.call<CronRemoveResult>("cron.remove", {
    id,
  });
};

export const createCronJob = async (
  client: GatewayClient,
  input: CronJobCreateInput
): Promise<CronJobSummary> => {
  const name = resolveCronJobName(input.name);
  const agentId = resolveAgentId(input.agentId);
  return client.call<CronJobSummary>("cron.add", {
    ...input,
    name,
    agentId,
  });
};

export const removeCronJobsForAgent = async (client: GatewayClient, agentId: string): Promise<number> => {
  const id = resolveAgentId(agentId);
  const result = await listCronJobs(client, { includeDisabled: true });
  const jobs = result.jobs.filter((job) => job.agentId?.trim() === id);
  let removed = 0;
  for (const job of jobs) {
    const removeResult = await removeCronJob(client, job.id);
    if (!removeResult.ok) {
      throw new Error(`Failed to delete cron job "${job.name}" (${job.id}).`);
    }
    if (removeResult.removed) {
      removed += 1;
    }
  }
  return removed;
};
