import { NextResponse } from "next/server";

import { executeGatewayIntent, parseIntentBody } from "@/lib/controlplane/intent-route";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const bodyOrError = await parseIntentBody(request);
  if (bodyOrError instanceof Response) {
    return bodyOrError as NextResponse;
  }

  const name = typeof bodyOrError.name === "string" ? bodyOrError.name.trim() : "";
  const installId =
    typeof bodyOrError.installId === "string" ? bodyOrError.installId.trim() : "";
  if (!name || !installId) {
    return NextResponse.json({ error: "name and installId are required." }, { status: 400 });
  }

  const timeoutMs =
    typeof bodyOrError.timeoutMs === "number" && Number.isFinite(bodyOrError.timeoutMs)
      ? Math.max(1, Math.floor(bodyOrError.timeoutMs))
      : undefined;

  return await executeGatewayIntent("skills.install", {
    name,
    installId,
    ...(typeof timeoutMs === "number" ? { timeoutMs } : {}),
  });
}
