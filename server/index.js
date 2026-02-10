const http = require("node:http");
const next = require("next");

const { createAccessGate } = require("./access-gate");
const { createGatewayProxy } = require("./gateway-proxy");
const { loadUpstreamGatewaySettings } = require("./studio-settings");

const resolveHost = () => {
  const fromEnv = process.env.HOST?.trim() || process.env.HOSTNAME?.trim();
  if (fromEnv) return fromEnv;
  return "0.0.0.0";
};

const resolvePort = () => {
  const raw = process.env.PORT?.trim() || "3000";
  const port = Number(raw);
  if (!Number.isFinite(port) || port <= 0) return 3000;
  return port;
};

const resolvePathname = (url) => {
  const raw = typeof url === "string" ? url : "";
  const idx = raw.indexOf("?");
  return (idx === -1 ? raw : raw.slice(0, idx)) || "/";
};

async function main() {
  const dev = process.argv.includes("--dev");
  const hostname = resolveHost();
  const port = resolvePort();

  const app = next({ dev, hostname, port });
  const handle = app.getRequestHandler();

  const accessGate = createAccessGate({
    token: process.env.STUDIO_ACCESS_TOKEN,
  });

  const proxy = createGatewayProxy({
    loadUpstreamSettings: async () => {
      const settings = loadUpstreamGatewaySettings(process.env);
      return { url: settings.url, token: settings.token };
    },
    allowWs: (req) => {
      if (resolvePathname(req.url) !== "/api/gateway/ws") return false;
      if (!accessGate.allowUpgrade(req)) return false;
      return true;
    },
  });

  await app.prepare();

  const server = http.createServer((req, res) => {
    if (accessGate.handleHttp(req, res)) return;
    handle(req, res);
  });

  server.on("upgrade", (req, socket, head) => {
    proxy.handleUpgrade(req, socket, head);
  });

  server.listen(port, hostname, () => {
    // Keep log minimal but actionable.
    console.info(`Studio server listening on http://${hostname}:${port} (dev=${dev})`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
