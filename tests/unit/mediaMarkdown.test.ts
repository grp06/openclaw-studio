import { describe, expect, it } from "vitest";

import { rewriteMediaLinesToMarkdown } from "@/lib/text/media-markdown";

describe("media-markdown", () => {
  it("rewrites MEDIA: lines pointing to images into markdown images", () => {
    const input = "Hello\nMEDIA: /home/ubuntu/.openclaw/workspace-agent/foo.png\nDone";
    const out = rewriteMediaLinesToMarkdown(input);

    expect(out).toContain("![](/api/gateway/media?path=");
    expect(out).toContain("MEDIA: /home/ubuntu/.openclaw/workspace-agent/foo.png");
    expect(out).toContain("Hello");
    expect(out).toContain("Done");
  });

  it("rewrites MEDIA: with the image path on the next line", () => {
    const input = "Hello\nMEDIA:\n/home/ubuntu/.openclaw/workspace-agent/foo.png\nDone";
    const out = rewriteMediaLinesToMarkdown(input);

    expect(out).toContain("![](/api/gateway/media?path=");
    expect(out).toContain("MEDIA: /home/ubuntu/.openclaw/workspace-agent/foo.png");
    expect(out).toContain("Hello");
    expect(out).toContain("Done");
  });

  it("does not rewrite inside fenced code blocks", () => {
    const input = "```\nMEDIA: /home/ubuntu/.openclaw/workspace-agent/foo.png\n```";
    const out = rewriteMediaLinesToMarkdown(input);
    expect(out).toBe(input);
  });
});
