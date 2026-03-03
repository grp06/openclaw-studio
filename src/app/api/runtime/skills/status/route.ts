import { NextResponse } from "next/server";

import { executeRuntimeGatewayRead } from "@/lib/controlplane/runtime-read-route";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const agentId = (url.searchParams.get("agentId") ?? "").trim();
  if (!agentId) {
    return NextResponse.json({ error: "agentId is required." }, { status: 400 });
  }
  return await executeRuntimeGatewayRead("skills.status", { agentId });
}
