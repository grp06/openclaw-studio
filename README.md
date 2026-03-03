![Home screen](home-screen.png)

# OpenClaw Studio

[![Discord](https://img.shields.io/badge/Discord-Join-5865F2?logo=discord&logoColor=white)](https://discord.gg/YJVMZ9yf)

OpenClaw Studio is a clean web dashboard for OpenClaw. Use it to connect to your Gateway, see your agents, chat, manage approvals, and configure jobs from one place.

⭐ Drop a star to help us grow! ⭐ 

It helps more developers discover the project.

## Get Started (Pick Your Setup)

If your Gateway is already running, pick the scenario that matches where your Gateway and Studio will run:

- [A. Gateway local, Studio local (same computer)](#a-gateway-local-studio-local-same-computer)
- [B. Gateway in the cloud, Studio local (your laptop)](#b-gateway-in-the-cloud-studio-local-your-laptop)
- [C. Studio in the cloud, Gateway in the cloud](#c-studio-in-the-cloud-gateway-in-the-cloud)

All setups use the same install/run path (recommended): `npx -y openclaw-studio@latest`

## Requirements

- Node.js 20.9+ (LTS recommended)
- An OpenClaw Gateway URL + token
- Tailscale (optional, recommended for remote access)

## A) Gateway local, Studio local (same computer)

```bash
npx -y openclaw-studio@latest
cd openclaw-studio
npm run dev
```

1. Open http://localhost:3000
2. In Studio, set:
   - Upstream URL: `ws://localhost:18789`
   - Upstream Token: your gateway token (for example: `openclaw config get gateway.auth.token`)

## B) Gateway in the cloud, Studio local (your laptop)

Run Studio on your laptop as above, then set an upstream URL your laptop can reach.

Recommended (Tailscale Serve on the gateway host):

1. On the gateway host:
   - `tailscale serve --yes --bg --https 443 http://127.0.0.1:18789`
2. In Studio (on your laptop):
   - Upstream URL: `wss://<gateway-host>.ts.net`
   - Upstream Token: your gateway token

Alternative (SSH tunnel):

1. From your laptop:
   - `ssh -L 18789:127.0.0.1:18789 user@<gateway-host>`
2. In Studio:
   - Upstream URL: `ws://localhost:18789`

## C) Studio in the cloud, Gateway in the cloud

This is the “always-on” setup. The easiest secure version is to keep the Gateway private and expose Studio over Tailscale.

1. On the VPS that will run Studio:
   - Run Studio (same commands as above).
2. Expose Studio over tailnet HTTPS:
   - `tailscale serve --yes --bg --https 443 http://127.0.0.1:3000`
3. Open Studio from your laptop/phone:
   - `https://<studio-host>.ts.net`
4. In Studio, set:
   - Upstream URL: `wss://<gateway-host>.ts.net` (or whatever your gateway is reachable at from the Studio host)
   - Upstream Token: your gateway token

Notes:
- Avoid serving Studio behind `/studio` unless you configure `basePath` and rebuild.
- If Studio is reachable beyond loopback, `STUDIO_ACCESS_TOKEN` is required.

## How It Connects (Mental Model)

OpenClaw Studio now runs one runtime architecture with **two primary paths**:

1. Browser -> Studio: HTTP + SSE (`/api/runtime/*`, `/api/intents/*`, `/api/runtime/stream`)
2. Studio -> Gateway (upstream): one server-owned WebSocket opened by the Studio Node process

This is why `ws://localhost:18789` means “gateway on the Studio host”, not “gateway on your phone”.

## Install from source (advanced)

```bash
git clone https://github.com/grp06/openclaw-studio.git
cd openclaw-studio
npm install
npm run dev
```

## Configuration

Paths and key settings:
- OpenClaw config: `~/.openclaw/openclaw.json` (or via `OPENCLAW_STATE_DIR`)
- Studio settings: `~/.openclaw/openclaw-studio/settings.json`
- Control-plane runtime DB: `~/.openclaw/openclaw-studio/runtime.db`
- Default gateway URL: `ws://localhost:18789` (override via Studio Settings or `NEXT_PUBLIC_GATEWAY_URL`)
- Domain API mode: always enabled. Studio runs on the server-owned control-plane architecture.
- `STUDIO_ACCESS_TOKEN`: required when binding Studio to a public host (`HOST=0.0.0.0`, `HOST=::`, or non-loopback hostnames/IPs); optional for loopback-only binds (`127.0.0.1`, `::1`, `localhost`)

Startup guard behavior:
- `npm run dev` and `npm run dev:turbo` run `verify:native-runtime:repair` before server startup.
- `npm run start` runs `verify:native-runtime:check` before startup (check-only; no dependency mutation).

Why SQLite exists now:
- Studio’s server-owned control plane stores durable runtime projection + replay outbox in `runtime.db`.
- This keeps runtime history and SSE replay deterministic across page refreshes and process restarts.

## UI guide

See `docs/ui-guide.md` for UI workflows (agent creation, cron jobs, exec approvals).

## PI + chat streaming

See `docs/pi-chat-streaming.md` for how Studio streams runtime events over domain SSE (`/api/runtime/stream`), applies replay/history, and renders tool calls, thinking traces, and final transcript lines.

## Permissions + sandboxing

See `docs/permissions-sandboxing.md` for how agent creation choices (tool policy, sandbox config, exec approvals) flow from Studio into the OpenClaw Gateway and how upstream OpenClaw enforces them at runtime (workspaces, sandbox mounts, tool availability, and exec approval prompts).

## Color system

See `docs/color-system.md` for the semantic color contract, status mappings, and guardrails that keep action/status/danger usage consistent across the UI.

## Troubleshooting

If the UI loads but “Connect” fails, it’s usually Studio->Gateway:
- Confirm the upstream URL/token in the UI (stored on the Studio host at `<state dir>/openclaw-studio/settings.json`).
- `EPROTO` / “wrong version number”: you used `wss://...` to a non-TLS endpoint (use `ws://...`, or put the gateway behind HTTPS).
- Assets 404 under `/studio`: serve Studio at `/` or configure `basePath` and rebuild.
- 401 “Studio access token required”: `STUDIO_ACCESS_TOKEN` is enabled; open `/?access_token=...` once to set the cookie.
- Helpful error codes: `studio.gateway_url_missing`, `studio.gateway_token_missing`, `studio.upstream_error`, `studio.upstream_closed`.

If startup fails with `better_sqlite3.node` / `NODE_MODULE_VERSION` mismatch:
- Run `npm run verify:native-runtime:repair`
- Confirm `node` and `npm` point at the same runtime before launching Studio:
  - `node -v && node -p "process.versions.modules"`
  - `which node && which npm`
  - If they differ (for example Homebrew `npm` + `nvm` `node`), run `nvm use` in that terminal first.
- If it still fails, run:
  - `npm rebuild better-sqlite3`
  - `npm install`

## Architecture

See `ARCHITECTURE.md` for details on modules and data flow.
