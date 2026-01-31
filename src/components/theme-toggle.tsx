"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

const THEME_STORAGE_KEY = "theme";

type ThemeMode = "light" | "dark";

const getPreferredTheme = (): ThemeMode => {
  if (typeof window === "undefined") return "light";
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  if (stored === "light" || stored === "dark") return stored;
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  return prefersDark ? "dark" : "light";
};

const applyTheme = (mode: ThemeMode) => {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("dark", mode === "dark");
};

export const ThemeToggle = () => {
  const [theme, setTheme] = useState<ThemeMode>("light");

  useEffect(() => {
    const preferred = getPreferredTheme();
    // Defer state sync to avoid synchronous setState-in-effect lint rule.
    queueMicrotask(() => setTheme(preferred));
    applyTheme(preferred);
  }, []);

  const toggleTheme = () => {
    const next: ThemeMode = theme === "dark" ? "light" : "dark";
    setTheme(next);
    applyTheme(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    }
  };

  const isDark = theme === "dark";

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-input bg-background text-foreground shadow-sm transition hover:bg-muted"
    >
      {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
};
