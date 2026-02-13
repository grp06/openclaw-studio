import { useCallback, useEffect, useState } from "react";

import { shouldStartNextConfigMutation } from "@/features/agents/operations/configMutationGatePolicy";
import type { GatewayStatus } from "@/features/agents/operations/gatewayRestartPolicy";
import { randomUUID } from "@/lib/uuid";

export type ConfigMutationKind =
  | "create-agent"
  | "rename-agent"
  | "delete-agent"
  | "update-agent-execution-role";

type QueuedConfigMutation = {
  id: string;
  kind: ConfigMutationKind;
  label: string;
  run: () => Promise<void>;
  resolve: () => void;
  reject: (error: unknown) => void;
};

export type ActiveConfigMutation = {
  kind: ConfigMutationKind;
  label: string;
};

export function useConfigMutationQueue(params: {
  status: GatewayStatus;
  hasRunningAgents: boolean;
  hasRestartBlockInProgress: boolean;
}) {
  const [queuedConfigMutations, setQueuedConfigMutations] = useState<QueuedConfigMutation[]>([]);
  const [activeConfigMutation, setActiveConfigMutation] = useState<QueuedConfigMutation | null>(
    null
  );

  const enqueueConfigMutation = useCallback(
    (params: { kind: ConfigMutationKind; label: string; run: () => Promise<void> }) =>
      new Promise<void>((resolve, reject) => {
        const queued: QueuedConfigMutation = {
          id: randomUUID(),
          kind: params.kind,
          label: params.label,
          run: params.run,
          resolve,
          reject,
        };
        setQueuedConfigMutations((current) => [...current, queued]);
      }),
    []
  );

  useEffect(() => {
    if (
      !shouldStartNextConfigMutation({
        status: params.status,
        hasRunningAgents: params.hasRunningAgents,
        hasActiveMutation: Boolean(activeConfigMutation),
        hasRestartBlockInProgress: params.hasRestartBlockInProgress,
        queuedCount: queuedConfigMutations.length,
      })
    ) {
      return;
    }

    const next = queuedConfigMutations[0];
    if (!next) return;
    setQueuedConfigMutations((current) => current.slice(1));
    setActiveConfigMutation(next);
  }, [
    activeConfigMutation,
    params.hasRestartBlockInProgress,
    params.hasRunningAgents,
    params.status,
    queuedConfigMutations,
  ]);

  useEffect(() => {
    if (!activeConfigMutation) return;
    let mounted = true;
    const run = async () => {
      try {
        await activeConfigMutation.run();
        activeConfigMutation.resolve();
      } catch (error) {
        activeConfigMutation.reject(error);
      } finally {
        if (mounted) {
          setActiveConfigMutation(null);
        }
      }
    };
    void run();
    return () => {
      mounted = false;
    };
  }, [activeConfigMutation]);

  return {
    enqueueConfigMutation,
    queuedCount: queuedConfigMutations.length,
    activeConfigMutation: activeConfigMutation
      ? ({ kind: activeConfigMutation.kind, label: activeConfigMutation.label } satisfies ActiveConfigMutation)
      : null,
  };
}
