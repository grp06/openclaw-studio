import { describe, it, expect, vi } from "vitest";

const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

import { renderHook } from "@testing-library/react";
import { useCommandK } from "@/features/search/useCommandK";

describe("useCommandK", () => {
  it("navigates to /search on Cmd+K", () => {
    renderHook(() => useCommandK());
    const event = new KeyboardEvent("keydown", {
      key: "k",
      metaKey: true,
    });
    document.dispatchEvent(event);
    expect(mockPush).toHaveBeenCalledWith("/search");
  });

  it("navigates to /search on Ctrl+K", () => {
    mockPush.mockClear();
    renderHook(() => useCommandK());
    const event = new KeyboardEvent("keydown", {
      key: "k",
      ctrlKey: true,
    });
    document.dispatchEvent(event);
    expect(mockPush).toHaveBeenCalledWith("/search");
  });

  it("does not navigate on plain K", () => {
    mockPush.mockClear();
    renderHook(() => useCommandK());
    const event = new KeyboardEvent("keydown", { key: "k" });
    document.dispatchEvent(event);
    expect(mockPush).not.toHaveBeenCalled();
  });
});
