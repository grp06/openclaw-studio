import { NextResponse } from "next/server";

import { executeGatewayIntent, parseIntentBody } from "@/lib/controlplane/intent-route";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const bodyOrError = await parseIntentBody(request);
  if (bodyOrError instanceof Response) {
    return bodyOrError as NextResponse;
  }
  const sessionKey = typeof bodyOrError.sessionKey === "string" ? bodyOrError.sessionKey.trim() : "";
  if (!sessionKey) {
    return NextResponse.json({ error: "sessionKey is required." }, { status: 400 });
  }
  const runId = typeof bodyOrError.runId === "string" ? bodyOrError.runId.trim() : "";
  return await executeGatewayIntent("chat.abort", runId ? { sessionKey, runId } : { sessionKey });
}
