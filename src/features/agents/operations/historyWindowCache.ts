import type { TranscriptEntry } from "@/features/agents/state/transcript";

const HISTORY_WINDOW_CACHE_DB = "openclaw-studio-history";
const HISTORY_WINDOW_CACHE_STORE = "windows";
const HISTORY_WINDOW_CACHE_DB_VERSION = 1;
const HISTORY_WINDOW_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export type CachedHistoryWindowKey = {
  gatewayUrl: string;
  agentId: string;
  sessionKey: string;
  sessionEpoch: number;
  includeThinking: boolean;
  includeTools: boolean;
};

export type CachedHistoryWindow = {
  cacheKey: string;
  cachedAt: number;
  transcriptEntries: TranscriptEntry[];
  historyFetchLimit: number | null;
  historyFetchedCount: number | null;
  historyVisibleTurnLimit: number | null;
  historyMaybeTruncated: boolean;
  historyHasMore: boolean;
  historyGatewayCapReached: boolean;
  lastResult: string | null;
  latestPreview: string | null;
  lastAssistantMessageAt: number | null;
  lastUserMessage: string | null;
};

const normalizeCacheKeyPart = (value: string): string => value.trim();

export const buildCachedHistoryWindowKey = (params: CachedHistoryWindowKey): string => {
  return [
    normalizeCacheKeyPart(params.gatewayUrl),
    normalizeCacheKeyPart(params.agentId),
    normalizeCacheKeyPart(params.sessionKey),
    String(Math.max(0, Math.trunc(params.sessionEpoch))),
    params.includeThinking ? "thinking:1" : "thinking:0",
    params.includeTools ? "tools:1" : "tools:0",
  ].join("\u001f");
};

let dbPromise: Promise<IDBDatabase | null> | null = null;

const openHistoryWindowCacheDb = async (): Promise<IDBDatabase | null> => {
  if (typeof indexedDB === "undefined") return null;
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    const request = indexedDB.open(HISTORY_WINDOW_CACHE_DB, HISTORY_WINDOW_CACHE_DB_VERSION);
    request.onerror = () => resolve(null);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(HISTORY_WINDOW_CACHE_STORE)) {
        db.createObjectStore(HISTORY_WINDOW_CACHE_STORE, { keyPath: "cacheKey" });
      }
    };
    request.onsuccess = () => resolve(request.result);
  });
  return dbPromise;
};

const readStoreRecord = async (cacheKey: string): Promise<CachedHistoryWindow | null> => {
  const db = await openHistoryWindowCacheDb();
  if (!db) return null;
  return await new Promise((resolve) => {
    const transaction = db.transaction(HISTORY_WINDOW_CACHE_STORE, "readonly");
    const store = transaction.objectStore(HISTORY_WINDOW_CACHE_STORE);
    const request = store.get(cacheKey);
    request.onerror = () => resolve(null);
    request.onsuccess = () => {
      const result = request.result;
      if (!result || typeof result !== "object") {
        resolve(null);
        return;
      }
      resolve(result as CachedHistoryWindow);
    };
  });
};

export const readCachedHistoryWindow = async (
  params: CachedHistoryWindowKey
): Promise<CachedHistoryWindow | null> => {
  const cacheKey = buildCachedHistoryWindowKey(params);
  const record = await readStoreRecord(cacheKey);
  if (!record) return null;
  if (!Number.isFinite(record.cachedAt) || Date.now() - record.cachedAt > HISTORY_WINDOW_CACHE_MAX_AGE_MS) {
    return null;
  }
  if (!Array.isArray(record.transcriptEntries)) {
    return null;
  }
  return record;
};

export const writeCachedHistoryWindow = async (
  params: CachedHistoryWindowKey & Omit<CachedHistoryWindow, "cacheKey">
): Promise<void> => {
  const db = await openHistoryWindowCacheDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    const transaction = db.transaction(HISTORY_WINDOW_CACHE_STORE, "readwrite");
    const store = transaction.objectStore(HISTORY_WINDOW_CACHE_STORE);
    store.put({
      cacheKey: buildCachedHistoryWindowKey(params),
      cachedAt: params.cachedAt,
      transcriptEntries: params.transcriptEntries,
      historyFetchLimit: params.historyFetchLimit,
      historyFetchedCount: params.historyFetchedCount,
      historyVisibleTurnLimit: params.historyVisibleTurnLimit,
      historyMaybeTruncated: params.historyMaybeTruncated,
      historyHasMore: params.historyHasMore,
      historyGatewayCapReached: params.historyGatewayCapReached,
      lastResult: params.lastResult,
      latestPreview: params.latestPreview,
      lastAssistantMessageAt: params.lastAssistantMessageAt,
      lastUserMessage: params.lastUserMessage,
    });
    transaction.onabort = () => resolve();
    transaction.onerror = () => resolve();
    transaction.oncomplete = () => resolve();
  });
};
