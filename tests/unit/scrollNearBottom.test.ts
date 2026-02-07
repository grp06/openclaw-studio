import { describe, expect, it } from "vitest";

import { isNearBottom } from "@/lib/dom/scroll";

describe("isNearBottom", () => {
  it("returns true when within the threshold of the bottom", () => {
    expect(
      isNearBottom({ scrollTop: 560, clientHeight: 400, scrollHeight: 1000 }, 40)
    ).toBe(true);
  });

  it("returns false when above the threshold", () => {
    expect(
      isNearBottom({ scrollTop: 500, clientHeight: 400, scrollHeight: 1000 }, 40)
    ).toBe(false);
  });

  it("treats negative remaining distance as near bottom", () => {
    expect(
      isNearBottom({ scrollTop: 700, clientHeight: 400, scrollHeight: 1000 }, 40)
    ).toBe(true);
  });
});

