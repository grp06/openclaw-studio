import { NextResponse } from "next/server";

import { executeRuntimeGatewayRead } from "@/lib/controlplane/runtime-read-route";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const agentId = (url.searchParams.get("agentId") ?? "").trim();
  const name = (url.searchParams.get("name") ?? "").trim();
  if (!agentId || !name) {
    return NextResponse.json({ error: "agentId and name are required." }, { status: 400 });
  }

  return await executeRuntimeGatewayRead("agents.files.get", {
    agentId,
    name,
  });
}
