import { NextResponse } from "next/server";

import { executeRuntimeGatewayRead } from "@/lib/controlplane/runtime-read-route";
import { clampGatewayChatHistoryLimit } from "@/lib/gateway/chatHistoryLimits";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const sessionKey = (url.searchParams.get("sessionKey") ?? "").trim();
  if (!sessionKey) {
    return NextResponse.json({ error: "sessionKey is required." }, { status: 400 });
  }
  const limitRaw = (url.searchParams.get("limit") ?? "0").trim();
  const limit = clampGatewayChatHistoryLimit(Number(limitRaw));

  return await executeRuntimeGatewayRead("chat.history", {
    sessionKey,
    ...(typeof limit === "number" ? { limit } : {}),
  });
}
