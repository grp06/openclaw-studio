import { NextResponse } from "next/server";

import { executeRuntimeGatewayRead } from "@/lib/controlplane/runtime-read-route";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const sessionKey = (url.searchParams.get("sessionKey") ?? "").trim();
  if (!sessionKey) {
    return NextResponse.json({ error: "sessionKey is required." }, { status: 400 });
  }
  const limitRaw = (url.searchParams.get("limit") ?? "0").trim();
  const limit = Number(limitRaw);

  return await executeRuntimeGatewayRead("chat.history", {
    sessionKey,
    ...(Number.isFinite(limit) && limit > 0 ? { limit: Math.floor(limit) } : {}),
  });
}
