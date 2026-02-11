"use client";

import { useCommandK } from "@/features/search/useCommandK";

/**
 * Global Cmd+K listener component.
 * Mount once in the root layout.
 */
export function CommandKListener() {
  useCommandK();
  return null;
}
