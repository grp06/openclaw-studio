import { executeRuntimeGatewayRead } from "@/lib/controlplane/runtime-read-route";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const agentId = (url.searchParams.get("agentId") ?? "").trim();
  const includeGlobal = (url.searchParams.get("includeGlobal") ?? "false").trim() !== "false";
  const includeUnknown = (url.searchParams.get("includeUnknown") ?? "false").trim() !== "false";
  const search = (url.searchParams.get("search") ?? "").trim();
  const limitRaw = (url.searchParams.get("limit") ?? "0").trim();
  const limit = Number(limitRaw);

  return await executeRuntimeGatewayRead("sessions.list", {
    ...(agentId ? { agentId } : {}),
    includeGlobal,
    includeUnknown,
    ...(search ? { search } : {}),
    ...(Number.isFinite(limit) && limit > 0 ? { limit: Math.floor(limit) } : {}),
  });
}
