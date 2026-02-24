import type { InterruptReason } from '@/types/sessions';
import {
  XCircle,
  AlertTriangle,
  Clock,
  UserX,
  Ban,
  HelpCircle,
  type LucideIcon,
} from 'lucide-react';

/**
 * Format duration in milliseconds to human-readable string
 * Examples: "2h 15m", "45m", "< 1m"
 */
export function formatDuration(durationMs: number): string {
  if (durationMs < 60000) return '< 1m';

  const hours = Math.floor(durationMs / (60 * 60 * 1000));
  const minutes = Math.floor((durationMs % (60 * 60 * 1000)) / (60 * 1000));

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

/**
 * Get icon component for interrupt reason
 */
export function getReasonIcon(reason: InterruptReason): LucideIcon {
  switch (reason) {
    case 'manual':
      return UserX;
    case 'crash':
      return AlertTriangle;
    case 'superseded':
      return XCircle;
    case 'timeout':
      return Clock;
    case 'dismissed':
      return Ban;
    case 'unknown':
    default:
      return HelpCircle;
  }
}

/**
 * Get human-readable label for interrupt reason
 */
export function getReasonLabel(reason: InterruptReason): string {
  switch (reason) {
    case 'manual':
      return 'Manually exited';
    case 'crash':
      return 'Crashed';
    case 'superseded':
      return 'Superseded by new session';
    case 'timeout':
      return 'Timed out (inactive)';
    case 'dismissed':
      return 'Dismissed';
    case 'unknown':
    default:
      return 'Unknown reason';
  }
}

/**
 * Get Tailwind color classes for interrupt reason
 */
export function getReasonColor(reason: InterruptReason): {
  text: string;
  bg: string;
  border: string;
} {
  switch (reason) {
    case 'manual':
      return {
        text: 'text-blue-700 dark:text-blue-400',
        bg: 'bg-blue-500/10',
        border: 'border-blue-500/20',
      };
    case 'crash':
      return {
        text: 'text-red-700 dark:text-red-400',
        bg: 'bg-red-500/10',
        border: 'border-red-500/20',
      };
    case 'superseded':
      return {
        text: 'text-purple-700 dark:text-purple-400',
        bg: 'bg-purple-500/10',
        border: 'border-purple-500/20',
      };
    case 'timeout':
      return {
        text: 'text-amber-700 dark:text-amber-400',
        bg: 'bg-amber-500/10',
        border: 'border-amber-500/20',
      };
    case 'dismissed':
      return {
        text: 'text-gray-700 dark:text-gray-400',
        bg: 'bg-gray-500/10',
        border: 'border-gray-500/20',
      };
    case 'unknown':
    default:
      return {
        text: 'text-gray-700 dark:text-gray-400',
        bg: 'bg-gray-500/10',
        border: 'border-gray-500/20',
      };
  }
}

/**
 * Format relative time (e.g., "3 hours ago", "5 minutes ago")
 */
export function formatRelativeTime(timestamp: string): string {
  try {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();

    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffDays > 0) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
    if (diffHours > 0) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    if (diffMins > 0) return `${diffMins} minute${diffMins > 1 ? 's' : ''} ago`;
    return 'just now';
  } catch {
    return timestamp;
  }
}
