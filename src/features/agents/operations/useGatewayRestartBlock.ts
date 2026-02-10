import type { Dispatch, SetStateAction } from "react";
import { useEffect, useRef } from "react";

import { observeGatewayRestart, type GatewayStatus } from "@/features/agents/operations/gatewayRestartPolicy";

type RestartBlockState = {
  phase: string;
  startedAt: number;
  sawDisconnect: boolean;
};

export function useGatewayRestartBlock<T extends RestartBlockState>(params: {
  status: GatewayStatus;
  block: T | null;
  setBlock: Dispatch<SetStateAction<T | null>>;
  maxWaitMs: number;
  onRestartComplete: (block: T, ctx: { isCancelled: () => boolean }) => void | Promise<void>;
  onTimeout: () => void;
}) {
  const { block, maxWaitMs, onRestartComplete, onTimeout, setBlock, status } = params;
  const onRestartCompleteRef = useRef(onRestartComplete);
  const onTimeoutRef = useRef(onTimeout);

  useEffect(() => {
    onRestartCompleteRef.current = onRestartComplete;
    onTimeoutRef.current = onTimeout;
  }, [onRestartComplete, onTimeout]);

  useEffect(() => {
    if (!block || block.phase !== "awaiting-restart") return;

    const observed = observeGatewayRestart({ sawDisconnect: block.sawDisconnect }, status);

    if (!block.sawDisconnect && observed.next.sawDisconnect) {
      setBlock((current) => {
        if (!current || current.phase !== "awaiting-restart" || current.sawDisconnect) {
          return current;
        }
        return { ...current, sawDisconnect: true };
      });
      return;
    }

    if (!observed.restartComplete) return;

    const currentBlock = block;
    let cancelled = false;
    const finalize = async () => {
      await onRestartCompleteRef.current(currentBlock, { isCancelled: () => cancelled });
    };
    void finalize();
    return () => {
      cancelled = true;
    };
  }, [block, setBlock, status]);

  useEffect(() => {
    if (!block) return;
    if (block.phase === "queued") return;
    const elapsed = Date.now() - block.startedAt;
    const remaining = Math.max(0, maxWaitMs - elapsed);
    const timeoutId = window.setTimeout(() => {
      onTimeoutRef.current();
    }, remaining);
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [block, maxWaitMs]);
}
