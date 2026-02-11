/**
 * DASH-004: Date/time formatting utilities for dashboard pages.
 */

/**
 * Format a timestamp as a relative time string (e.g. "2m ago", "3h ago").
 */
export const formatRelativeTime = (timestampMs: number, nowMs?: number): string => {
  const now = nowMs ?? Date.now();
  const diffMs = now - timestampMs;

  if (diffMs < 0) return "just now";

  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return seconds <= 1 ? "just now" : `${seconds}s ago`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;

  const months = Math.floor(days / 30);
  return `${months}mo ago`;
};

/**
 * Format a timestamp as a short time string (e.g. "14:32" or "2:32 PM").
 */
export const formatTime = (timestampMs: number, locale?: string): string => {
  const date = new Date(timestampMs);
  return date.toLocaleTimeString(locale ?? "en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
};

/**
 * Format a timestamp as a short date string (e.g. "Feb 11").
 */
export const formatShortDate = (timestampMs: number, locale?: string): string => {
  const date = new Date(timestampMs);
  return date.toLocaleDateString(locale ?? "en-US", {
    month: "short",
    day: "numeric",
  });
};

/**
 * Format a timestamp as date + time (e.g. "Feb 11, 14:32").
 */
export const formatDateTime = (timestampMs: number, locale?: string): string => {
  return `${formatShortDate(timestampMs, locale)}, ${formatTime(timestampMs, locale)}`;
};

/**
 * Get the start of week (Monday) for a given date.
 */
export const startOfWeek = (date: Date): Date => {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
};

/**
 * Get an array of 7 dates for the week starting from the given Monday.
 */
export const getWeekDays = (weekStart: Date): Date[] => {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    return d;
  });
};

/**
 * Format a day header for the calendar grid (e.g. "Mon 11").
 */
export const formatDayHeader = (date: Date): string => {
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return `${days[date.getDay()]} ${date.getDate()}`;
};

/**
 * Get hour labels for a calendar day (0-23).
 */
export const getHourLabels = (): string[] => {
  return Array.from({ length: 24 }, (_, i) =>
    i.toString().padStart(2, "0") + ":00"
  );
};
