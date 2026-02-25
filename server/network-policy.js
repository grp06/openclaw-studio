const net = require("node:net");

const normalizeHost = (host) => {
  let raw = String(host ?? "").trim().toLowerCase();
  if (!raw) return "";

  if (raw.startsWith("[")) {
    const end = raw.indexOf("]");
    if (end !== -1) {
      return raw.slice(1, end).trim();
    }
  }

  const colonCount = (raw.match(/:/g) || []).length;
  if (colonCount === 1) {
    const idx = raw.lastIndexOf(":");
    const maybePort = raw.slice(idx + 1);
    if (/^\d+$/.test(maybePort)) {
      raw = raw.slice(0, idx);
    }
  }

  return raw;
};

const resolveHosts = (env = process.env) => {
  const host = String(env.HOST ?? "").trim();
  if (host) return [host];
  return ["127.0.0.1", "::1"];
};

const resolveHost = (env = process.env) => {
  const hosts = resolveHosts(env);
  return hosts[0] ?? "127.0.0.1";
};

const isIpv4Loopback = (value) => value.startsWith("127.");

const isIpv6Loopback = (value) => {
  if (value === "::1" || value === "0:0:0:0:0:0:0:1") return true;
  if (!value.startsWith("::ffff:")) return false;
  const mapped = value.slice("::ffff:".length);
  return net.isIP(mapped) === 4 && isIpv4Loopback(mapped);
};

const isPublicHost = (host) => {
  const normalized = normalizeHost(host);
  if (!normalized) return false;

  if (normalized === "localhost") return false;
  if (normalized === "0.0.0.0" || normalized === "::") {
    return true;
  }

  const ipVersion = net.isIP(normalized);
  if (ipVersion === 4) {
    return !isIpv4Loopback(normalized);
  }
  if (ipVersion === 6) {
    return !isIpv6Loopback(normalized);
  }

  return true;
};

const assertPublicHostAllowed = ({ host, studioAccessToken }) => {
  if (!isPublicHost(host)) return;

  const token = String(studioAccessToken ?? "").trim();
  if (token) return;

  const normalized = normalizeHost(host) || String(host ?? "").trim() || "(unknown)";
  throw new Error(
    `Refusing to bind Studio to public host "${normalized}" without STUDIO_ACCESS_TOKEN. ` +
      "Set STUDIO_ACCESS_TOKEN or bind HOST to 127.0.0.1/::1/localhost."
  );
};

module.exports = {
  resolveHosts,
  resolveHost,
  isPublicHost,
  assertPublicHostAllowed,
};
