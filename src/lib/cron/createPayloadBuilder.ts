import type {
  CronJobCreateInput,
  CronPayload,
  CronSchedule,
  CronSessionTarget,
  CronWakeMode,
} from "@/lib/cron/types";

export type CronCreateTemplateId =
  | "morning-brief"
  | "reminder"
  | "weekly-review"
  | "inbox-triage"
  | "custom";

export type CronCreateDraft = {
  templateId: CronCreateTemplateId;
  name: string;
  taskText: string;
  scheduleKind: "at" | "every" | "cron";
  scheduleAt?: string;
  everyAmount?: number;
  everyUnit?: "minutes" | "hours" | "days";
  cronExpr?: string;
  cronTz?: string;
  deliveryMode?: "announce" | "none";
  deliveryChannel?: string;
  deliveryTo?: string;
  advancedSessionTarget?: CronSessionTarget;
  advancedWakeMode?: CronWakeMode;
};

const resolveName = (name: string) => {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error("Cron job name is required.");
  }
  return trimmed;
};

const resolveAgentId = (agentId: string) => {
  const trimmed = agentId.trim();
  if (!trimmed) {
    throw new Error("Agent id is required.");
  }
  return trimmed;
};

const resolveTaskText = (text: string) => {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error("Task text is required.");
  }
  return trimmed;
};

const resolveAtSchedule = (raw: string): CronSchedule => {
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms)) {
    throw new Error("Invalid run time.");
  }
  return { kind: "at", at: new Date(ms).toISOString() };
};

const resolveEverySchedule = (amountRaw: number | undefined, unitRaw: CronCreateDraft["everyUnit"]) => {
  const amount = Number.isFinite(amountRaw) ? Math.floor(amountRaw ?? 0) : 0;
  if (amount <= 0) {
    throw new Error("Invalid interval amount.");
  }
  const unit = unitRaw ?? "minutes";
  const multiplier =
    unit === "minutes" ? 60_000 : unit === "hours" ? 3_600_000 : 86_400_000;
  return { kind: "every" as const, everyMs: amount * multiplier };
};

const resolveCronSchedule = (exprRaw: string | undefined, tzRaw: string | undefined): CronSchedule => {
  const expr = (exprRaw ?? "").trim();
  if (!expr) {
    throw new Error("Cron expression required.");
  }
  const tz = (tzRaw ?? "").trim();
  return { kind: "cron", expr, tz: tz || undefined };
};

const resolveSchedule = (draft: CronCreateDraft): CronSchedule => {
  if (draft.scheduleKind === "at") {
    return resolveAtSchedule(draft.scheduleAt ?? "");
  }
  if (draft.scheduleKind === "every") {
    return resolveEverySchedule(draft.everyAmount, draft.everyUnit);
  }
  return resolveCronSchedule(draft.cronExpr, draft.cronTz);
};

const resolvePayload = (sessionTarget: CronSessionTarget, text: string): CronPayload => {
  if (sessionTarget === "main") {
    return { kind: "systemEvent", text };
  }
  return { kind: "agentTurn", message: text };
};

export const buildCronJobCreateInput = (
  agentIdRaw: string,
  draft: CronCreateDraft
): CronJobCreateInput => {
  const agentId = resolveAgentId(agentIdRaw);
  const name = resolveName(draft.name);
  const taskText = resolveTaskText(draft.taskText);
  const sessionTarget = draft.advancedSessionTarget ?? "isolated";
  const wakeMode = draft.advancedWakeMode ?? "now";
  const schedule = resolveSchedule(draft);
  const payload = resolvePayload(sessionTarget, taskText);

  if (sessionTarget === "main") {
    return {
      name,
      agentId,
      enabled: true,
      schedule,
      sessionTarget,
      wakeMode,
      payload,
    };
  }

  const deliveryMode = draft.deliveryMode ?? "announce";
  const deliveryChannel = (draft.deliveryChannel ?? "").trim() || "last";
  const deliveryTo = (draft.deliveryTo ?? "").trim();

  return {
    name,
    agentId,
    enabled: true,
    schedule,
    sessionTarget,
    wakeMode,
    payload,
    delivery:
      deliveryMode === "none"
        ? { mode: "none" }
        : {
            mode: "announce",
            channel: deliveryChannel,
            to: deliveryTo || undefined,
          },
  };
};
