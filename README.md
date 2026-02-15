![Home screen](home-screen.png)

# OpenClaw Studio

[![Discord](https://img.shields.io/badge/Discord-Join-5865F2?logo=discord&logoColor=white)](https://discord.gg/VEpdKJ9e)

OpenClaw Studio is a Next.js dashboard for managing OpenClaw agents via the OpenClaw Gateway (WebSocket).

## How It Connects

There are **two separate network paths**:

1. **Browser -> Studio**: HTTP for the UI, plus a WebSocket to `ws(s)://<studio-host>:3000/api/gateway/ws`
2. **Studio -> OpenClaw Gateway (upstream)**: a second WebSocket opened by the Studio Node server to the configured **Upstream Gateway URL**

Key consequences:
- The **Upstream Gateway URL is dialed from the Studio host**, not from your browser device.
- `ws://localhost:18789` means “gateway on the Studio host” (laptop if Studio is local, VPS if Studio is on a VPS).
- Studio persists the upstream URL/token on the Studio host at `<state dir>/openclaw-studio/settings.json` (defaults to `~/.openclaw`).
- If Studio is served over `https://`, the browser-side WS is `wss://.../api/gateway/ws`.

## Requirements

- Node.js 18+ (LTS recommended)
- OpenClaw Gateway running (local or remote)
- Tailscale (optional, recommended for tailnet access)

## Quick start

### 1) Start the gateway (required)

If you don't already have OpenClaw installed:
```bash
npm install -g openclaw@latest
openclaw onboard --install-daemon
```

Start a gateway (foreground):
```bash
openclaw gateway run --bind loopback --port 18789 --verbose
```

Helpful checks:
```bash
openclaw gateway probe
openclaw config get gateway.auth.token
```

### 2) Run Studio

```bash
npx -y openclaw-studio@latest
cd openclaw-studio
npm run dev
```

Open http://localhost:3000 and set:
- Upstream URL: `ws://localhost:18789` (gateway on the same machine as Studio)
- Upstream Token: `openclaw config get gateway.auth.token`

## Remote access (VPS, Tailscale, SSH)

Pick the topology that matches where you are running Studio and the Gateway.

### Studio on your laptop, Gateway on a remote host

In Studio, set an upstream URL that your laptop can reach:
- Direct port (only if intentionally exposed): `ws://<gateway-host>:18789`
- Tailscale Serve (gateway host): `tailscale serve --yes --bg --https 443 http://127.0.0.1:18789`, then use `wss://<gateway-host>.ts.net`
- SSH tunnel: `ssh -L 18789:127.0.0.1:18789 user@<gateway-host>`, then use `ws://localhost:18789`

### Studio + Gateway on the same VPS (recommended)

Keep the gateway private on the VPS and expose only Studio:

1. VPS: run gateway on loopback: `openclaw gateway run --bind loopback --port 18789 --verbose`
2. VPS: expose Studio over tailnet HTTPS: `tailscale serve --yes --bg --https 443 http://127.0.0.1:3000`
3. Client device: open `https://<your-vps>.ts.net`
4. Studio settings:
   - Upstream URL: `ws://localhost:18789`
   - Token: `openclaw config get gateway.auth.token` (run on the VPS)

Notes:
- `tailscale serve reset` clears all Serve config. Avoid it unless you are intentionally wiping existing rules.
- Avoid serving Studio behind a path prefix like `/studio` unless you configure Next.js `basePath` and rebuild.

### Studio on a VPS, Gateway somewhere else

In this topology, the VPS must be able to reach the gateway from the VPS network. In Studio, set:
- `ws://<gateway-host>:18789` (plain)
- or `wss://<gateway-host>...` (TLS)

### Install (manual)
```bash
git clone https://github.com/grp06/openclaw-studio.git
cd openclaw-studio
npm install
npm run dev
```

## Configuration

Paths and key settings:
- OpenClaw config: `~/.openclaw/openclaw.json` (or `OPENCLAW_CONFIG_PATH` / `OPENCLAW_STATE_DIR`)
- Studio settings: `~/.openclaw/openclaw-studio/settings.json`
- Default gateway URL: `ws://localhost:18789` (override via Studio Settings or `NEXT_PUBLIC_GATEWAY_URL`)
- Optional Studio access gate: set `STUDIO_ACCESS_TOKEN` on the Studio server

## UI guide

See `docs/ui-guide.md` for UI workflows (agent creation, cron jobs, exec approvals).

## Troubleshooting

If the UI loads but “Connect” fails, it’s usually Studio->Gateway:
- Confirm the upstream URL/token in the UI (stored on the Studio host at `<state dir>/openclaw-studio/settings.json`).
- `EPROTO` / “wrong version number”: you used `wss://...` to a non-TLS endpoint (use `ws://...`, or put the gateway behind HTTPS).
- Assets 404 under `/studio`: serve Studio at `/` or configure `basePath` and rebuild.
- 401 “Studio access token required”: `STUDIO_ACCESS_TOKEN` is enabled; open `/?access_token=...` once to set the cookie.
- Helpful error codes: `studio.gateway_url_missing`, `studio.gateway_token_missing`, `studio.upstream_error`, `studio.upstream_closed`.

## Architecture

See `ARCHITECTURE.md` for details on modules and data flow.
