import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { AppNav } from "@/components/AppNav";

// Mock next/navigation
vi.mock("next/navigation", () => ({
  usePathname: vi.fn(() => "/"),
}));

import { usePathname } from "next/navigation";
const mockUsePathname = vi.mocked(usePathname);

afterEach(() => {
  cleanup();
});

describe("AppNav", () => {
  it("renders all 4 navigation links", () => {
    render(<AppNav />);
    expect(screen.getByText("Agents")).toBeDefined();
    expect(screen.getByText("Activity")).toBeDefined();
    expect(screen.getByText("Calendar")).toBeDefined();
    expect(screen.getByText("Search")).toBeDefined();
  });

  it("has correct href for each link", () => {
    render(<AppNav />);
    expect(screen.getByText("Agents").closest("a")?.getAttribute("href")).toBe("/");
    expect(screen.getByText("Activity").closest("a")?.getAttribute("href")).toBe("/activity");
    expect(screen.getByText("Calendar").closest("a")?.getAttribute("href")).toBe("/calendar");
    expect(screen.getByText("Search").closest("a")?.getAttribute("href")).toBe("/search");
  });

  it("highlights the active route (root)", () => {
    mockUsePathname.mockReturnValue("/");
    render(<AppNav />);
    const agentsLink = screen.getByText("Agents").closest("a")!;
    expect(agentsLink.getAttribute("aria-current")).toBe("page");
    const activityLink = screen.getByText("Activity").closest("a")!;
    expect(activityLink.getAttribute("aria-current")).toBeNull();
  });

  it("highlights /activity when pathname is /activity", () => {
    mockUsePathname.mockReturnValue("/activity");
    render(<AppNav />);
    const activityLink = screen.getByText("Activity").closest("a")!;
    expect(activityLink.getAttribute("aria-current")).toBe("page");
    const agentsLink = screen.getByText("Agents").closest("a")!;
    expect(agentsLink.getAttribute("aria-current")).toBeNull();
  });

  it("highlights /calendar for sub-routes like /calendar/week", () => {
    mockUsePathname.mockReturnValue("/calendar/week");
    render(<AppNav />);
    const calendarLink = screen.getByText("Calendar").closest("a")!;
    expect(calendarLink.getAttribute("aria-current")).toBe("page");
  });
});
