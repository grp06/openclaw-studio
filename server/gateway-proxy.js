const { WebSocket, WebSocketServer } = require("ws");

const buildErrorResponse = (id, code, message) => {
  return {
    type: "res",
    id,
    ok: false,
    error: { code, message },
  };
};

const isObject = (value) => Boolean(value && typeof value === "object");

const safeJsonParse = (raw) => {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

const resolvePathname = (url) => {
  const raw = typeof url === "string" ? url : "";
  const idx = raw.indexOf("?");
  return (idx === -1 ? raw : raw.slice(0, idx)) || "/";
};

const injectAuthToken = (params, token) => {
  const next = isObject(params) ? { ...params } : {};
  const auth = isObject(next.auth) ? { ...next.auth } : {};
  auth.token = token;
  next.auth = auth;
  return next;
};

const resolveOriginForUpstream = (upstreamUrl) => {
  const url = new URL(upstreamUrl);
  const proto = url.protocol === "wss:" ? "https:" : "http:";
  const hostname =
    url.hostname === "127.0.0.1" || url.hostname === "::1" || url.hostname === "0.0.0.0"
      ? "localhost"
      : url.hostname;
  const host = url.port ? `${hostname}:${url.port}` : hostname;
  return `${proto}//${host}`;
};

const hasNonEmptyToken = (params) => {
  const raw = params && isObject(params) && isObject(params.auth) ? params.auth.token : "";
  return typeof raw === "string" && raw.trim().length > 0;
};

const hasDeviceSignature = (params) => {
  const raw =
    params && isObject(params) && isObject(params.device) ? params.device.signature : null;
  return typeof raw === "string" && raw.trim().length > 0;
};

function createGatewayProxy(options) {
  const {
    loadUpstreamSettings,
    allowWs = (req) => resolvePathname(req.url) === "/api/gateway/ws",
    log = () => {},
    logError = (msg, err) => console.error(msg, err),
  } = options || {};

  if (typeof loadUpstreamSettings !== "function") {
    throw new Error("createGatewayProxy requires loadUpstreamSettings().");
  }

  const wss = new WebSocketServer({ noServer: true });

  wss.on("connection", (browserWs) => {
    let upstreamWs = null;
    let upstreamReady = false;
    let connectRequestId = null;
    let connectResponseSent = false;
    let closed = false;

    const closeBoth = (code, reason) => {
      if (closed) return;
      closed = true;
      try {
        browserWs.close(code, reason);
      } catch {}
      try {
        upstreamWs?.close(code, reason);
      } catch {}
    };

    const sendToBrowser = (frame) => {
      if (browserWs.readyState !== WebSocket.OPEN) return;
      browserWs.send(JSON.stringify(frame));
    };

    const sendConnectError = (code, message) => {
      if (connectRequestId && !connectResponseSent) {
        connectResponseSent = true;
        sendToBrowser(buildErrorResponse(connectRequestId, code, message));
      }
      closeBoth(1011, "connect failed");
    };

    browserWs.on("message", async (raw) => {
      const parsed = safeJsonParse(String(raw ?? ""));
      if (!parsed || !isObject(parsed)) {
        closeBoth(1003, "invalid json");
        return;
      }

      if (!upstreamWs) {
        if (parsed.type !== "req" || parsed.method !== "connect") {
          closeBoth(1008, "connect required");
          return;
        }
        const id = typeof parsed.id === "string" ? parsed.id : "";
        if (!id) {
          closeBoth(1008, "connect id required");
          return;
        }
        connectRequestId = id;

        let upstreamUrl = "";
        let upstreamToken = "";
        try {
          const settings = await loadUpstreamSettings();
          upstreamUrl = typeof settings?.url === "string" ? settings.url.trim() : "";
          upstreamToken = typeof settings?.token === "string" ? settings.token.trim() : "";
        } catch (err) {
          logError("Failed to load upstream gateway settings.", err);
          sendConnectError("studio.settings_load_failed", "Failed to load Studio gateway settings.");
          return;
        }

        if (!upstreamUrl) {
          sendConnectError(
            "studio.gateway_url_missing",
            "Upstream gateway URL is not configured on the Studio host."
          );
          return;
        }
        if (!upstreamToken) {
          sendConnectError(
            "studio.gateway_token_missing",
            "Upstream gateway token is not configured on the Studio host."
          );
          return;
        }

        let upstreamOrigin = "";
        try {
          upstreamOrigin = resolveOriginForUpstream(upstreamUrl);
        } catch {
          sendConnectError(
            "studio.gateway_url_invalid",
            "Upstream gateway URL is invalid on the Studio host."
          );
          return;
        }

        upstreamWs = new WebSocket(upstreamUrl, { origin: upstreamOrigin });

        upstreamWs.on("open", () => {
          upstreamReady = true;
          if (hasNonEmptyToken(parsed.params) || hasDeviceSignature(parsed.params)) {
            upstreamWs.send(JSON.stringify(parsed));
            return;
          }

          const connectFrame = {
            ...parsed,
            params: injectAuthToken(parsed.params, upstreamToken),
          };
          upstreamWs.send(JSON.stringify(connectFrame));
        });

        upstreamWs.on("message", (upRaw) => {
          const upParsed = safeJsonParse(String(upRaw ?? ""));
          if (upParsed && isObject(upParsed) && upParsed.type === "res") {
            const resId = typeof upParsed.id === "string" ? upParsed.id : "";
            if (resId && connectRequestId && resId === connectRequestId) {
              connectResponseSent = true;
            }
          }
          if (browserWs.readyState === WebSocket.OPEN) {
            browserWs.send(String(upRaw ?? ""));
          }
        });

        upstreamWs.on("close", (ev) => {
          const reason = typeof ev?.reason === "string" ? ev.reason : "";
          if (!connectResponseSent) {
            sendToBrowser(
              buildErrorResponse(
                connectRequestId,
                "studio.upstream_closed",
                `Upstream gateway closed (${ev.code}): ${reason}`
              )
            );
          }
          closeBoth(1012, "upstream closed");
        });

        upstreamWs.on("error", (err) => {
          logError("Upstream gateway WebSocket error.", err);
          sendConnectError(
            "studio.upstream_error",
            "Failed to connect to upstream gateway WebSocket."
          );
        });

        log("proxy connected");
        return;
      }

      if (!upstreamReady || upstreamWs.readyState !== WebSocket.OPEN) {
        closeBoth(1013, "upstream not ready");
        return;
      }

      upstreamWs.send(JSON.stringify(parsed));
    });

    browserWs.on("close", () => {
      closeBoth(1000, "client closed");
    });

    browserWs.on("error", (err) => {
      logError("Browser WebSocket error.", err);
      closeBoth(1011, "client error");
    });
  });

  const handleUpgrade = (req, socket, head) => {
    if (!allowWs(req)) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  };

  return { wss, handleUpgrade };
}

module.exports = { createGatewayProxy };
