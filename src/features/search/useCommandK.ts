"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * DASH-019: Cmd+K (or Ctrl+K) keyboard shortcut to navigate to /search.
 */
export function useCommandK() {
  const router = useRouter();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        router.push("/search");
      }
    };

    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [router]);
}
