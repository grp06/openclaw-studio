const http = require("node:http");
const next = require("next");

const { createAccessGate } = require("./access-gate");
const { createGatewayProxy } = require("./gateway-proxy");
const { loadUpstreamGatewaySettings } = require("./studio-settings");

const resolveHost = () => {
  const fromEnv = process.env.HOST?.trim() || process.env.HOSTNAME?.trim();
  if (fromEnv) return fromEnv;
  return "::";
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

  const app = next({
    dev,
    hostname,
    port,
    ...(dev ? { webpack: true } : null),
  });
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
  const handleUpgrade = app.getUpgradeHandler();

  const server = http.createServer((req, res) => {
    if (accessGate.handleHttp(req, res)) return;
    handle(req, res);
  });

  const handleServerUpgrade = (req, socket, head) => {
    if (resolvePathname(req.url) === "/api/gateway/ws") {
      proxy.handleUpgrade(req, socket, head);
      return;
    }
    handleUpgrade(req, socket, head);
  };
  server.on("upgrade", handleServerUpgrade);
  server.on("newListener", (eventName, listener) => {
    if (eventName !== "upgrade") return;
    if (listener === handleServerUpgrade) return;
    process.nextTick(() => {
      server.removeListener("upgrade", listener);
    });
  });

  server.listen(port, hostname, () => {
    const hostForBrowser = hostname === "0.0.0.0" || hostname === "::" ? "localhost" : hostname;
    const browserUrl = `http://${hostForBrowser}:${port}`;
    console.info(`Open in browser: ${browserUrl}`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
