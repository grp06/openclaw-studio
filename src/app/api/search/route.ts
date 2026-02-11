/**
 * DASH-016: Global Search agent file search backend.
 * Searches agent files on the gateway for a query string.
 */

import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const AGENT_FILES = [
  "AGENTS.md",
  "SOUL.md",
  "IDENTITY.md",
  "USER.md",
  "TOOLS.md",
  "HEARTBEAT.md",
  "MEMORY.md",
];

type SearchResultItem = {
  agentId: string;
  fileName: string;
  matchLine: string;
  lineNumber: number;
  snippet: string;
};

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q")?.trim();
  const gatewayUrl = searchParams.get("gatewayUrl")?.trim();
  const token = searchParams.get("token")?.trim();

  if (!query) {
    return NextResponse.json(
      { error: "Query parameter 'q' is required." },
      { status: 400 }
    );
  }

  if (!gatewayUrl) {
    return NextResponse.json(
      { error: "Gateway URL is required." },
      { status: 400 }
    );
  }

  try {
    // Convert ws:// to http:// for REST calls
    const httpUrl = gatewayUrl
      .replace(/^ws:\/\//, "http://")
      .replace(/^wss:\/\//, "https://");

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    // Get agent list
    const agentsRes = await fetch(`${httpUrl}/api/agents`, { headers });
    if (!agentsRes.ok) {
      return NextResponse.json(
        { error: "Failed to fetch agents from gateway." },
        { status: 502 }
      );
    }

    const agentsData = (await agentsRes.json()) as { agents?: { id: string }[] };
    const agents = agentsData.agents ?? [];

    const results: SearchResultItem[] = [];
    const lowerQuery = query.toLowerCase();

    // Search each agent's files
    for (const agent of agents) {
      for (const fileName of AGENT_FILES) {
        try {
          const fileRes = await fetch(
            `${httpUrl}/api/agents/${encodeURIComponent(agent.id)}/files/${encodeURIComponent(fileName)}`,
            { headers }
          );
          if (!fileRes.ok) continue;

          const fileData = (await fileRes.json()) as { content?: string };
          const content = fileData.content ?? "";
          if (!content) continue;

          const lines = content.split("\n");
          for (let i = 0; i < lines.length; i++) {
            if (lines[i].toLowerCase().includes(lowerQuery)) {
              const snippetStart = Math.max(0, i - 1);
              const snippetEnd = Math.min(lines.length, i + 2);
              results.push({
                agentId: agent.id,
                fileName,
                matchLine: lines[i],
                lineNumber: i + 1,
                snippet: lines.slice(snippetStart, snippetEnd).join("\n"),
              });
            }
          }
        } catch {
          // Skip files that can't be fetched
        }
      }
    }

    return NextResponse.json({
      results: results.slice(0, 100),
      query,
      totalMatches: results.length,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Search failed.",
      },
      { status: 500 }
    );
  }
}
