import { useEffect, useRef } from "react";

import type { EventFrame } from "@/lib/gateway/gateway-frames";
import { logTranscriptDebugMetric } from "@/features/agents/state/transcript";

type RuntimeEventStreamMessageEvent = {
  data?: unknown;
  lastEventId?: unknown;
};

type RuntimeEventStreamListener = (event: RuntimeEventStreamMessageEvent) => void;

export type RuntimeEventStreamSource = {
  addEventListener: (type: string, listener: RuntimeEventStreamListener) => void;
  close: () => void;
  onerror: ((event: unknown) => void) | null;
};

type RuntimeEventStreamFactory = (url: string) => RuntimeEventStreamSource;

const createBrowserRuntimeEventStreamSource: RuntimeEventStreamFactory = (url) =>
  new EventSource(url) as unknown as RuntimeEventStreamSource;

const toText = (value: unknown): string => (typeof value === "string" ? value : "");
const RESUME_KEY_PREFIX = "openclaw.runtime.lastEventId:";

const toStorageKey = (value: string): string => `${RESUME_KEY_PREFIX}${value}`;

const parseLastEventId = (value: unknown): number | null => {
  if (typeof value !== "string") return null;
  const parsed = Number(value.trim());
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.floor(parsed);
};

const readLastEventId = (key: string): number | null => {
  if (typeof window === "undefined") return null;
  try {
    const parsed = parseLastEventId(window.sessionStorage.getItem(toStorageKey(key)));
    return parsed;
  } catch {
    return null;
  }
};

const persistLastEventId = (key: string, lastEventId: number): void => {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(toStorageKey(key), String(lastEventId));
  } catch {}
};

const withLastEventId = (url: string, lastEventId: number | null): string => {
  if (typeof lastEventId !== "number" || !Number.isFinite(lastEventId) || lastEventId <= 0) {
    return url;
  }
  try {
    const base = typeof window !== "undefined" ? window.location.origin : "http://localhost";
    const parsed = new URL(url, base);
    parsed.searchParams.set("lastEventId", String(lastEventId));
    if (/^https?:\/\//i.test(url)) {
      return parsed.toString();
    }
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    const separator = url.includes("?") ? "&" : "?";
    return `${url}${separator}lastEventId=${encodeURIComponent(String(lastEventId))}`;
  }
};

export function useRuntimeEventStream(params: {
  onGatewayEvent: (event: EventFrame) => void;
  onRuntimeStatus: () => void;
  url?: string;
  resumeKey?: string;
  createSource?: RuntimeEventStreamFactory;
}): void {
  const onGatewayEventRef = useRef(params.onGatewayEvent);
  const onRuntimeStatusRef = useRef(params.onRuntimeStatus);

  useEffect(() => {
    onGatewayEventRef.current = params.onGatewayEvent;
  }, [params.onGatewayEvent]);

  useEffect(() => {
    onRuntimeStatusRef.current = params.onRuntimeStatus;
  }, [params.onRuntimeStatus]);

  useEffect(() => {
    const url = params.url?.trim() || "/api/runtime/stream";
    const resumeKey = params.resumeKey?.trim() ?? "";
    const persistedLastEventId = resumeKey ? readLastEventId(resumeKey) : null;
    const streamUrl = withLastEventId(url, persistedLastEventId);
    logTranscriptDebugMetric("stream_resume_start", {
      resumeKey: resumeKey || null,
      lastEventId: persistedLastEventId,
      url: streamUrl,
    });
    const createSource = params.createSource ?? createBrowserRuntimeEventStreamSource;
    const source = createSource(streamUrl);
    let latestSeenId = persistedLastEventId ?? 0;

    const recordLastEventId = (raw: RuntimeEventStreamMessageEvent) => {
      if (!resumeKey) return;
      const nextLastEventId = parseLastEventId(raw?.lastEventId);
      if (typeof nextLastEventId !== "number") return;
      if (nextLastEventId <= latestSeenId) return;
      latestSeenId = nextLastEventId;
      persistLastEventId(resumeKey, nextLastEventId);
    };

    source.addEventListener("gateway.event", (raw) => {
      recordLastEventId(raw);
      const data = toText(raw?.data);
      if (!data) return;
      try {
        const parsed = JSON.parse(data) as { event?: unknown; payload?: unknown; seq?: unknown };
        if (typeof parsed.event !== "string") return;
        const frame: EventFrame = {
          type: "event",
          event: parsed.event,
          payload: parsed.payload,
          ...(typeof parsed.seq === "number" ? { seq: parsed.seq } : {}),
        };
        onGatewayEventRef.current(frame);
      } catch {}
    });

    source.addEventListener("runtime.status", (raw) => {
      recordLastEventId(raw);
      onRuntimeStatusRef.current();
    });

    source.onerror = () => {};

    return () => {
      logTranscriptDebugMetric("stream_resume_end", {
        resumeKey: resumeKey || null,
        lastEventId: latestSeenId > 0 ? latestSeenId : null,
      });
      source.close();
    };
  }, [params.createSource, params.resumeKey, params.url]);
}
