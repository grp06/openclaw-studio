import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { NextResponse } from "next/server";

export const runtime = "nodejs";

const resolveStateDir = () => {
  const raw = process.env.CLAWDBOT_STATE_DIR ?? path.join(os.homedir(), ".clawdbot");
  if (raw === "~") {
    return os.homedir();
  }
  if (raw.startsWith("~/")) {
    return path.join(os.homedir(), raw.slice(2));
  }
  return raw;
};

const parseJsonLoose = (raw: string) => {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    const cleaned = raw.replace(/,(\s*[}\]])/g, "$1");
    return JSON.parse(cleaned) as Record<string, unknown>;
  }
};

const resolveGatewayUrl = (config: Record<string, unknown>) => {
  const gateway = (config.gateway ?? {}) as Record<string, unknown>;
  const port = typeof gateway.port === "number" ? gateway.port : 18789;
  const host =
    typeof gateway.host === "string" && gateway.host.trim()
      ? gateway.host.trim()
      : "127.0.0.1";
  return `ws://${host}:${port}`;
};

const resolveGatewayToken = (config: Record<string, unknown>) => {
  const gateway = (config.gateway ?? {}) as Record<string, unknown>;
  const auth = (gateway.auth ?? {}) as Record<string, unknown>;
  return typeof auth.token === "string" ? auth.token : "";
};

export async function GET() {
  try {
    const stateDir = resolveStateDir();
    const configPath = path.join(stateDir, "clawdbot.json");
    if (!fs.existsSync(configPath)) {
      return NextResponse.json(
        { error: `Missing config at ${configPath}.` },
        { status: 404 }
      );
    }
    const raw = fs.readFileSync(configPath, "utf8");
    const config = parseJsonLoose(raw);
    return NextResponse.json({
      gatewayUrl: resolveGatewayUrl(config),
      token: resolveGatewayToken(config),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load gateway config.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
