import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("markdown <pre> wrap regression guard", () => {
  it("keeps pre/code blocks constrained and wrappable in chat markdown", () => {
    const cssPath = path.resolve(process.cwd(), "src/app/styles/markdown.css");
    const css = readFileSync(cssPath, "utf8");

    expect(css).toContain(".agent-markdown pre {");
    expect(css).toContain("max-width: 100%;");
    expect(css).toContain("min-width: 0;");
    expect(css).toContain(".agent-markdown pre,");
    expect(css).toContain(".agent-markdown pre code {");
    expect(css).toContain("white-space: pre-wrap;");
    expect(css).toContain("overflow-wrap: anywhere;");
    expect(css).toContain("word-break: break-word;");
  });
});
