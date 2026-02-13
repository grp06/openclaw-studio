import {
  isMetaMarkdown,
  isToolMarkdown,
  isTraceMarkdown,
  parseMetaMarkdown,
} from "@/lib/text/message-extract";

const ENABLED_RE = /^(1|true|yes|on)$/i;

const readBooleanFlag = (value: string | undefined): boolean => {
  return ENABLED_RE.test((value ?? "").trim());
};

export const TRANSCRIPT_V2_ENABLED = readBooleanFlag(
  process.env.NEXT_PUBLIC_STUDIO_TRANSCRIPT_V2
);

export const TRANSCRIPT_DEBUG_ENABLED = readBooleanFlag(
  process.env.NEXT_PUBLIC_STUDIO_TRANSCRIPT_DEBUG
);

export const logTranscriptDebugMetric = (metric: string, meta?: unknown) => {
  if (!TRANSCRIPT_DEBUG_ENABLED) return;
  if (meta === undefined) {
    console.debug(`[transcript] ${metric}`);
    return;
  }
  console.debug(`[transcript] ${metric}`, meta);
};

export type TranscriptEntryKind = "meta" | "user" | "assistant" | "thinking" | "tool";

export type TranscriptEntryRole = "user" | "assistant" | "tool" | "system" | "other";

export type TranscriptEntrySource =
  | "local-send"
  | "runtime-chat"
  | "runtime-agent"
  | "history"
  | "legacy";

export type TranscriptEntry = {
  entryId: string;
  role: TranscriptEntryRole;
  kind: TranscriptEntryKind;
  text: string;
  sessionKey: string;
  runId: string | null;
  source: TranscriptEntrySource;
  timestampMs: number | null;
  sequenceKey: number;
  confirmed: boolean;
  fingerprint: string;
};

export type TranscriptAppendMeta = {
  source?: TranscriptEntrySource;
  runId?: string | null;
  sessionKey?: string;
  timestampMs?: number | null;
  role?: TranscriptEntryRole;
  kind?: TranscriptEntryKind;
  entryId?: string;
  confirmed?: boolean;
};

export type BuildTranscriptEntriesFromLinesParams = {
  lines: string[];
  sessionKey: string;
  source: TranscriptEntrySource;
  runId?: string | null;
  startSequence?: number;
  defaultTimestampMs?: number | null;
  confirmed?: boolean;
  entryIdPrefix?: string;
};

export type MergeTranscriptEntriesResult = {
  entries: TranscriptEntry[];
  mergedCount: number;
  confirmedCount: number;
  conflictCount: number;
};

const KIND_ORDER: Record<TranscriptEntryKind, number> = {
  meta: 0,
  user: 1,
  thinking: 2,
  tool: 3,
  assistant: 4,
};

const SOURCE_ORDER: Record<TranscriptEntrySource, number> = {
  "local-send": 0,
  "runtime-chat": 1,
  "runtime-agent": 2,
  history: 3,
  legacy: 4,
};

const BUCKET_MS = 2_000;
const MERGE_TIMESTAMP_TOLERANCE_MS = 60_000;

const normalizeComparableText = (value: string): string => {
  return value.replace(/\s+/g, " ").trim();
};

const fnv1a = (value: string): string => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
};

const toBucket = (timestampMs: number | null): string => {
  if (typeof timestampMs !== "number" || !Number.isFinite(timestampMs)) return "none";
  return String(Math.floor(timestampMs / BUCKET_MS));
};

const resolveKindRoleFromLine = (
  line: string,
  overrides?: { kind?: TranscriptEntryKind; role?: TranscriptEntryRole }
): { kind: TranscriptEntryKind; role: TranscriptEntryRole } => {
  if (overrides?.kind && overrides?.role) {
    return { kind: overrides.kind, role: overrides.role };
  }
  if (overrides?.kind) {
    const roleByKind: Record<TranscriptEntryKind, TranscriptEntryRole> = {
      meta: "other",
      user: "user",
      assistant: "assistant",
      thinking: "assistant",
      tool: "tool",
    };
    return { kind: overrides.kind, role: overrides.role ?? roleByKind[overrides.kind] };
  }
  if (isMetaMarkdown(line)) {
    const parsed = parseMetaMarkdown(line);
    const role = parsed?.role ?? overrides?.role ?? "other";
    return { kind: "meta", role };
  }
  if (line.trim().startsWith(">")) {
    return { kind: "user", role: "user" };
  }
  if (isTraceMarkdown(line)) {
    return { kind: "thinking", role: "assistant" };
  }
  if (isToolMarkdown(line)) {
    return { kind: "tool", role: "tool" };
  }
  return { kind: overrides?.kind ?? "assistant", role: overrides?.role ?? "assistant" };
};

const resolveTimestampForLine = (
  line: string,
  fallback: number | null,
  explicit?: number | null
): number | null => {
  if (typeof explicit === "number" && Number.isFinite(explicit)) {
    return explicit;
  }
  if (isMetaMarkdown(line)) {
    const parsed = parseMetaMarkdown(line);
    if (parsed && typeof parsed.timestamp === "number") {
      return parsed.timestamp;
    }
  }
  return fallback;
};

const buildFingerprint = (entry: {
  role: TranscriptEntryRole;
  kind: TranscriptEntryKind;
  text: string;
  sessionKey: string;
  runId: string | null;
  timestampMs: number | null;
}) => {
  const normalized = normalizeComparableText(entry.text);
  const seed = [
    entry.role,
    entry.kind,
    normalized,
    entry.sessionKey.trim(),
    entry.runId?.trim() ?? "",
    toBucket(entry.timestampMs),
  ].join("|");
  return fnv1a(seed);
};

const hasNumericTimestamp = (value: number | null): value is number => {
  return typeof value === "number" && Number.isFinite(value);
};

const compareEntries = (a: TranscriptEntry, b: TranscriptEntry): number => {
  const aTimestamp = a.timestampMs;
  const bTimestamp = b.timestampMs;
  const aHasTs = hasNumericTimestamp(aTimestamp);
  const bHasTs = hasNumericTimestamp(bTimestamp);
  if (aHasTs && bHasTs) {
    if (aTimestamp !== bTimestamp) {
      return aTimestamp - bTimestamp;
    }
    if (a.kind !== b.kind) {
      return KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
    }
    if (a.source !== b.source) {
      return SOURCE_ORDER[a.source] - SOURCE_ORDER[b.source];
    }
  } else if (aHasTs !== bHasTs) {
    return aHasTs ? -1 : 1;
  }
  return a.sequenceKey - b.sequenceKey;
};

const withUniqueEntryIds = (entries: TranscriptEntry[]): TranscriptEntry[] => {
  const next: TranscriptEntry[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.entryId)) continue;
    seen.add(entry.entryId);
    next.push(entry);
  }
  return next;
};

export const sortTranscriptEntries = (entries: TranscriptEntry[]): TranscriptEntry[] => {
  const deduped = withUniqueEntryIds(entries);
  return [...deduped].sort(compareEntries);
};

export const buildOutputLinesFromTranscriptEntries = (
  entries: TranscriptEntry[]
): string[] => {
  return entries.map((entry) => entry.text);
};

export const areTranscriptEntriesEqual = (
  left: TranscriptEntry[],
  right: TranscriptEntry[]
): boolean => {
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i += 1) {
    const a = left[i];
    const b = right[i];
    if (!a || !b) return false;
    if (a.entryId !== b.entryId) return false;
    if (a.text !== b.text) return false;
    if (a.timestampMs !== b.timestampMs) return false;
    if (a.confirmed !== b.confirmed) return false;
  }
  return true;
};

export const createTranscriptEntryFromLine = (params: {
  line: string;
  sessionKey: string;
  source: TranscriptEntrySource;
  sequenceKey: number;
  runId?: string | null;
  timestampMs?: number | null;
  fallbackTimestampMs?: number | null;
  role?: TranscriptEntryRole;
  kind?: TranscriptEntryKind;
  entryId?: string;
  confirmed?: boolean;
}): TranscriptEntry | null => {
  const text = params.line;
  if (!text) return null;
  const sessionKey = params.sessionKey.trim();
  if (!sessionKey) return null;
  const resolved = resolveKindRoleFromLine(text, {
    kind: params.kind,
    role: params.role,
  });
  const timestampMs = resolveTimestampForLine(
    text,
    params.fallbackTimestampMs ?? null,
    params.timestampMs
  );
  const runId = params.runId?.trim() || null;
  const fingerprint = buildFingerprint({
    role: resolved.role,
    kind: resolved.kind,
    text,
    sessionKey,
    runId,
    timestampMs,
  });
  const entryId =
    params.entryId?.trim() ||
    `${params.source}:${sessionKey}:${params.sequenceKey}:${resolved.kind}:${fingerprint}`;
  return {
    entryId,
    role: resolved.role,
    kind: resolved.kind,
    text,
    sessionKey,
    runId,
    source: params.source,
    timestampMs,
    sequenceKey: params.sequenceKey,
    confirmed: params.confirmed ?? params.source === "history",
    fingerprint,
  };
};

export const buildTranscriptEntriesFromLines = ({
  lines,
  sessionKey,
  source,
  runId,
  startSequence = 0,
  defaultTimestampMs = null,
  confirmed,
  entryIdPrefix,
}: BuildTranscriptEntriesFromLinesParams): TranscriptEntry[] => {
  const entries: TranscriptEntry[] = [];
  let cursor = startSequence;
  let activeTimestamp = defaultTimestampMs;
  for (const line of lines) {
    const parsedMeta = isMetaMarkdown(line) ? parseMetaMarkdown(line) : null;
    if (parsedMeta && typeof parsedMeta.timestamp === "number") {
      activeTimestamp = parsedMeta.timestamp;
    }
    const entry = createTranscriptEntryFromLine({
      line,
      sessionKey,
      source,
      runId,
      sequenceKey: cursor,
      timestampMs: parsedMeta?.timestamp ?? undefined,
      fallbackTimestampMs: activeTimestamp,
      role: parsedMeta?.role,
      kind: parsedMeta ? "meta" : undefined,
      confirmed,
      entryId: entryIdPrefix
        ? `${entryIdPrefix}:${cursor}:${fnv1a(line)}`
        : undefined,
    });
    cursor += 1;
    if (!entry) continue;
    entries.push(entry);
  }
  return entries;
};

const resolveCandidateTimestampDelta = (
  candidate: TranscriptEntry,
  target: TranscriptEntry
): number => {
  if (!hasNumericTimestamp(candidate.timestampMs) || !hasNumericTimestamp(target.timestampMs)) {
    return Number.MAX_SAFE_INTEGER;
  }
  return Math.abs(candidate.timestampMs - target.timestampMs);
};

const findHistoryMatchCandidateIndex = (
  existing: TranscriptEntry[],
  historyEntry: TranscriptEntry
): { index: number; conflict: boolean } | null => {
  const normalizedTarget = normalizeComparableText(historyEntry.text);
  const candidates: number[] = [];
  for (let i = 0; i < existing.length; i += 1) {
    const candidate = existing[i];
    if (!candidate || candidate.confirmed) continue;
    if (candidate.sessionKey !== historyEntry.sessionKey) continue;
    if (candidate.kind !== historyEntry.kind || candidate.role !== historyEntry.role) continue;
    if (normalizeComparableText(candidate.text) !== normalizedTarget) continue;
    if (
      hasNumericTimestamp(candidate.timestampMs) &&
      hasNumericTimestamp(historyEntry.timestampMs) &&
      Math.abs(candidate.timestampMs - historyEntry.timestampMs) >
        MERGE_TIMESTAMP_TOLERANCE_MS
    ) {
      continue;
    }
    candidates.push(i);
  }
  if (candidates.length === 0) return null;
  if (candidates.length === 1) {
    return { index: candidates[0]!, conflict: false };
  }
  let bestIndex = candidates[0]!;
  let bestDelta = resolveCandidateTimestampDelta(existing[bestIndex]!, historyEntry);
  for (let i = 1; i < candidates.length; i += 1) {
    const index = candidates[i]!;
    const candidate = existing[index]!;
    const delta = resolveCandidateTimestampDelta(candidate, historyEntry);
    if (delta < bestDelta) {
      bestIndex = index;
      bestDelta = delta;
      continue;
    }
    if (delta === bestDelta && candidate.sequenceKey < existing[bestIndex]!.sequenceKey) {
      bestIndex = index;
    }
  }
  return { index: bestIndex, conflict: true };
};

export const mergeTranscriptEntriesWithHistory = (params: {
  existingEntries: TranscriptEntry[];
  historyEntries: TranscriptEntry[];
}): MergeTranscriptEntriesResult => {
  const next = [...params.existingEntries];
  const byEntryId = new Map<string, number>();
  for (let i = 0; i < next.length; i += 1) {
    byEntryId.set(next[i]!.entryId, i);
  }
  let mergedCount = 0;
  let confirmedCount = 0;
  let conflictCount = 0;

  for (const historyEntry of params.historyEntries) {
    const existingById = byEntryId.get(historyEntry.entryId);
    if (typeof existingById === "number") {
      const current = next[existingById]!;
      next[existingById] = {
        ...current,
        confirmed: true,
        timestampMs:
          current.timestampMs ?? historyEntry.timestampMs ?? current.timestampMs,
      };
      continue;
    }

    const matched = findHistoryMatchCandidateIndex(next, historyEntry);
    if (matched) {
      if (matched.conflict) {
        conflictCount += 1;
      }
      const current = next[matched.index]!;
      next[matched.index] = {
        ...current,
        confirmed: true,
        timestampMs:
          current.timestampMs ?? historyEntry.timestampMs ?? current.timestampMs,
        runId: current.runId ?? historyEntry.runId,
      };
      confirmedCount += 1;
      byEntryId.set(historyEntry.entryId, matched.index);
      continue;
    }

    const appendedIndex = next.length;
    next.push(historyEntry);
    byEntryId.set(historyEntry.entryId, appendedIndex);
    mergedCount += 1;
  }

  return {
    entries: sortTranscriptEntries(next),
    mergedCount,
    confirmedCount,
    conflictCount,
  };
};
