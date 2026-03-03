import { executeRuntimeGatewayRead } from "@/lib/controlplane/runtime-read-route";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const includeDisabled = (url.searchParams.get("includeDisabled") ?? "true").trim();
  return await executeRuntimeGatewayRead("cron.list", {
    includeDisabled: includeDisabled !== "false",
  });
}
