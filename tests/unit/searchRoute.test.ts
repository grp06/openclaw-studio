import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import { GET } from "@/app/api/search/route";
import { NextRequest } from "next/server";

beforeEach(() => {
  mockFetch.mockReset();
});

describe("GET /api/search", () => {
  it("returns 400 when query is missing", async () => {
    const req = new NextRequest("http://localhost/api/search?gatewayUrl=ws://localhost:9999");
    const res = await GET(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("'q'");
  });

  it("returns 400 when gatewayUrl is missing", async () => {
    const req = new NextRequest("http://localhost/api/search?q=test");
    const res = await GET(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("Gateway URL");
  });

  it("returns results when agents and files match", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ agents: [{ id: "bot1" }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ content: "line1\nhello world\nline3" }),
      })
      // Remaining files return 404
      .mockResolvedValue({ ok: false });

    const req = new NextRequest(
      "http://localhost/api/search?q=hello&gatewayUrl=ws://localhost:9999"
    );
    const res = await GET(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.results.length).toBe(1);
    expect(data.results[0].agentId).toBe("bot1");
    expect(data.results[0].matchLine).toBe("hello world");
    expect(data.results[0].lineNumber).toBe(2);
  });

  it("returns 502 when agents fetch fails", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });
    const req = new NextRequest(
      "http://localhost/api/search?q=test&gatewayUrl=ws://localhost:9999"
    );
    const res = await GET(req);
    expect(res.status).toBe(502);
  });
});
