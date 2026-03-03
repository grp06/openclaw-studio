import { executeRuntimeGatewayRead } from "@/lib/controlplane/runtime-read-route";

export const runtime = "nodejs";

export async function GET() {
  return await executeRuntimeGatewayRead("models.list", {});
}
