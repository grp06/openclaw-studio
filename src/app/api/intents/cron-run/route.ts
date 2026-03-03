import { NextResponse } from "next/server";

import { executeGatewayIntent, parseIntentBody } from "@/lib/controlplane/intent-route";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const bodyOrError = await parseIntentBody(request);
  if (bodyOrError instanceof Response) {
    return bodyOrError as NextResponse;
  }

  const id = typeof bodyOrError.id === "string" ? bodyOrError.id.trim() : "";
  if (!id) {
    return NextResponse.json({ error: "id is required." }, { status: 400 });
  }

  return await executeGatewayIntent("cron.run", {
    id,
    mode: "force",
  });
}
