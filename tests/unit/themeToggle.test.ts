import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { ThemeToggle } from "@/components/theme-toggle";

const buildMatchMedia = (matches: boolean) =>
  vi.fn().mockImplementation((query: string) => ({
    matches,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));

const createLocalStorageMock = () => {
  let store: Record<string, string> = {};

  return {
    getItem: (key: string) => (key in store ? store[key] : null),
    setItem: (key: string, value: string) => {
      store[key] = String(value);
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
    key: (index: number) => Object.keys(store)[index] ?? null,
    get length() {
      return Object.keys(store).length;
    },
  };
};

describe("ThemeToggle", () => {
  beforeEach(() => {
    // Some JS DOM shims expose a partial localStorage; tests need a full Storage-like API.
    Object.defineProperty(window, "localStorage", {
      value: createLocalStorageMock(),
      configurable: true,
    });

    document.documentElement.classList.remove("dark");
    window.localStorage.clear();
    vi.stubGlobal("matchMedia", buildMatchMedia(false));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("applies and persists theme when toggled", () => {
    render(createElement(ThemeToggle));

    fireEvent.click(screen.getByRole("button", { name: "Switch to dark mode" }));
    expect(document.documentElement).toHaveClass("dark");
    expect(window.localStorage.getItem("theme")).toBe("dark");

    fireEvent.click(screen.getByRole("button", { name: "Switch to light mode" }));
    expect(document.documentElement).not.toHaveClass("dark");
    expect(window.localStorage.getItem("theme")).toBe("light");
  });

  it("reads and applies stored theme on mount", async () => {
    window.localStorage.setItem("theme", "dark");

    render(createElement(ThemeToggle));

    await waitFor(() => {
      expect(document.documentElement).toHaveClass("dark");
    });
    expect(screen.getByRole("button", { name: "Switch to light mode" })).toBeInTheDocument();
  });
});
