import { describe, it, expect } from "vitest";
import {
  formatRelativeTime,
  formatTime,
  formatShortDate,
  formatDateTime,
  startOfWeek,
  getWeekDays,
  formatDayHeader,
  getHourLabels,
} from "@/lib/datetime/format";

describe("formatRelativeTime", () => {
  const now = 1700000000000;

  it("returns 'just now' for very recent timestamps", () => {
    expect(formatRelativeTime(now, now)).toBe("just now");
    expect(formatRelativeTime(now - 500, now)).toBe("just now");
  });

  it("returns seconds for <60s", () => {
    expect(formatRelativeTime(now - 30000, now)).toBe("30s ago");
  });

  it("returns minutes for <60m", () => {
    expect(formatRelativeTime(now - 5 * 60 * 1000, now)).toBe("5m ago");
  });

  it("returns hours for <24h", () => {
    expect(formatRelativeTime(now - 3 * 60 * 60 * 1000, now)).toBe("3h ago");
  });

  it("returns days for <30d", () => {
    expect(formatRelativeTime(now - 7 * 24 * 60 * 60 * 1000, now)).toBe("7d ago");
  });

  it("returns months for >=30d", () => {
    expect(formatRelativeTime(now - 60 * 24 * 60 * 60 * 1000, now)).toBe("2mo ago");
  });

  it("returns 'just now' for future timestamps", () => {
    expect(formatRelativeTime(now + 5000, now)).toBe("just now");
  });
});

describe("startOfWeek", () => {
  it("returns Monday for a Wednesday", () => {
    // 2024-01-10 is a Wednesday
    const wed = new Date(2024, 0, 10, 15, 30);
    const monday = startOfWeek(wed);
    expect(monday.getDay()).toBe(1); // Monday
    expect(monday.getDate()).toBe(8);
    expect(monday.getHours()).toBe(0);
  });

  it("returns same day for a Monday", () => {
    const mon = new Date(2024, 0, 8, 12, 0);
    const result = startOfWeek(mon);
    expect(result.getDate()).toBe(8);
  });
});

describe("getWeekDays", () => {
  it("returns 7 days", () => {
    const monday = new Date(2024, 0, 8);
    const days = getWeekDays(monday);
    expect(days).toHaveLength(7);
    expect(days[0].getDate()).toBe(8);
    expect(days[6].getDate()).toBe(14);
  });
});

describe("getHourLabels", () => {
  it("returns 24 labels", () => {
    const labels = getHourLabels();
    expect(labels).toHaveLength(24);
    expect(labels[0]).toBe("00:00");
    expect(labels[23]).toBe("23:00");
  });
});

describe("formatDayHeader", () => {
  it("formats day with short weekday name", () => {
    const mon = new Date(2024, 0, 8); // Monday
    expect(formatDayHeader(mon)).toBe("Mon 8");
  });
});
