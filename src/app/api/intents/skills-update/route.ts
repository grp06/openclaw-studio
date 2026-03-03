import { NextResponse } from "next/server";

import { executeGatewayIntent, parseIntentBody } from "@/lib/controlplane/intent-route";

export const runtime = "nodejs";

const hasOwn = (value: Record<string, unknown>, key: string) =>
  Object.prototype.hasOwnProperty.call(value, key);

export async function POST(request: Request) {
  const bodyOrError = await parseIntentBody(request);
  if (bodyOrError instanceof Response) {
    return bodyOrError as NextResponse;
  }

  const skillKey = typeof bodyOrError.skillKey === "string" ? bodyOrError.skillKey.trim() : "";
  if (!skillKey) {
    return NextResponse.json({ error: "skillKey is required." }, { status: 400 });
  }

  const includeEnabled = hasOwn(bodyOrError, "enabled");
  const includeApiKey = hasOwn(bodyOrError, "apiKey");
  if (!includeEnabled && !includeApiKey) {
    return NextResponse.json({ error: "enabled or apiKey is required." }, { status: 400 });
  }

  return await executeGatewayIntent("skills.update", {
    skillKey,
    ...(includeEnabled ? { enabled: bodyOrError.enabled } : {}),
    ...(includeApiKey ? { apiKey: bodyOrError.apiKey } : {}),
  });
}
