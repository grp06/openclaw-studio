import { describe, expect, it } from "vitest";

import { parseLastEventIdFromRequest } from "@/app/api/runtime/stream/route";

describe("runtime stream route lastEventId parsing", () => {
  it("uses query lastEventId when provided", () => {
    const request = new Request("http://localhost/api/runtime/stream?lastEventId=42", {
      headers: {
        "last-event-id": "7",
      },
    });
    expect(parseLastEventIdFromRequest(request)).toBe(42);
  });

  it("falls back to Last-Event-ID header", () => {
    const request = new Request("http://localhost/api/runtime/stream", {
      headers: {
        "last-event-id": "11",
      },
    });
    expect(parseLastEventIdFromRequest(request)).toBe(11);
  });

  it("returns zero for missing or invalid values", () => {
    const missing = new Request("http://localhost/api/runtime/stream");
    const invalid = new Request("http://localhost/api/runtime/stream?lastEventId=nan");
    expect(parseLastEventIdFromRequest(missing)).toBe(0);
    expect(parseLastEventIdFromRequest(invalid)).toBe(0);
  });
});
