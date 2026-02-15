![Home screen](home-screen.png)

# OpenClaw Studio

[![Discord](https://img.shields.io/badge/Discord-Join-5865F2?logo=discord&logoColor=white)](https://discord.gg/VEpdKJ9e)

OpenClaw Studio is a Next.js dashboard for managing OpenClaw agents via the OpenClaw Gateway (WebSocket).

## How Studio Connects (Read This If You Use A Phone / Remote Host)

There are **two separate network paths** involved:

1. **Your browser -> Studio** (HTTP) at `http://<studio-host>:3000`
2. **Your browser -> Studio** (WebSocket) at `ws(s)://<studio-host>:3000/api/gateway/ws`, then **Studio -> OpenClaw Gateway** (WebSocket) at the configured **Gateway URL**

Important consequences:
- The upstream **Gateway URL is dialed from the Studio host**, not from your browser device.
- `ws://localhost:18789` means “connect to a gateway on the same machine as Studio”.
  - If Studio is running on a VPS, `localhost` is the VPS.
  - If Studio is running on your laptop and you browse it from your phone, `localhost` is still your laptop (the Studio host).
- Studio **persists** the Gateway URL/token under `~/.openclaw/openclaw-studio/settings.json`. Once set in the UI, this will be used on future runs and will override the default `NEXT_PUBLIC_GATEWAY_URL`.
- If you access Studio over `https://`, the browser-side bridge is `wss://.../api/gateway/ws`. The upstream Gateway URL can be `ws://...` (local/private) or `wss://...` (recommended for remote gateways).

## Requirements

- Node.js 18+ (LTS recommended)
- OpenClaw Gateway running (local or remote)
- Tailscale (optional, recommended for tailnet access)

## Quick start

### Start the gateway (required)

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

### Remote access (VPS, Tailscale, SSH)

Studio is designed to work when the browser device (laptop/phone) is not the same machine as Studio or the Gateway. The key is understanding which machine is making which connection.

#### Connection model (two network paths)

Studio does not have your browser connect directly to the upstream Gateway URL.

There are two separate network paths:

1. Browser -> Studio
   - HTTP for the UI, plus a WebSocket to Studio at `/api/gateway/ws`.
2. Studio -> OpenClaw Gateway (upstream)
   - A second WebSocket opened by the Studio Node server to the configured upstream Gateway URL.

When troubleshooting, always ask: is the problem Browser->Studio, or Studio->Gateway?

#### What “localhost” means

The “Upstream Gateway URL” is dialed by the machine running Studio.

- If Studio runs on your laptop: `ws://localhost:18789` means “gateway on your laptop”.
- If Studio runs on a VPS: `ws://localhost:18789` means “gateway on the VPS”, even when you open Studio from a phone.

#### Where Studio stores the upstream URL/token

Studio persists upstream connection settings on the Studio host:

- Settings file: `<state dir>/openclaw-studio/settings.json`
- Default `<state dir>`: `~/.openclaw` (with legacy fallbacks to `~/.moltbot` and `~/.clawdbot`)
- Override state dir: `OPENCLAW_STATE_DIR`

The UI reads/writes these via `GET/PUT /api/studio`. If you set a URL/token once in the UI, those values will be used on the next run on that same Studio host.

#### Recipes

##### A) Studio on your laptop, Gateway on a remote host

In Studio, set:
- Upstream Gateway URL: something reachable from your laptop
- Upstream Token: `openclaw config get gateway.auth.token` (run on the gateway host)

Options:

1. Direct port (only if you intentionally expose it)
   - Upstream URL: `ws://<gateway-host>:18789`
2. Tailscale Serve for the gateway (recommended over public exposure)
   - On the gateway host: `tailscale serve status`
   - Example serve rule: `tailscale serve --yes --bg --https 443 http://127.0.0.1:18789`
   - In Studio: Upstream URL `wss://<gateway-host>.ts.net`
3. SSH tunnel
   - From your laptop: `ssh -L 18789:127.0.0.1:18789 user@<gateway-host>`
   - In Studio: Upstream URL `ws://localhost:18789`

##### B) Studio + Gateway on the same VPS (use from laptop/phone)

This is the simplest remote setup: keep the gateway private on the VPS and only expose Studio.

1. On the VPS, run the gateway bound to loopback:
   - `openclaw gateway run --bind loopback --port 18789 --verbose`
2. On the VPS, expose Studio over HTTPS on your tailnet (example: 443):
   - Check current config: `tailscale serve status`
   - Add a serve rule: `tailscale serve --yes --bg --https 443 http://127.0.0.1:3000`

Notes:
- `tailscale serve reset` clears all Serve config. Avoid it unless you are intentionally wiping existing rules.
- Avoid serving Studio behind a path prefix like `/studio` unless you configure Next.js `basePath` and rebuild. Prefer serving Studio at `/`.

3. From your laptop/phone, open `https://<your-vps>.ts.net`
4. In Studio, set:
   - Upstream URL: `ws://localhost:18789`
   - Token: `openclaw config get gateway.auth.token` (run on the VPS)

Optional (only if you need non-Studio clients to reach the gateway):
- Expose the gateway too (example: 8443):
  - `tailscale serve --yes --bg --https 8443 http://127.0.0.1:18789`
  - Upstream URL: `wss://<your-vps>.ts.net:8443`

##### C) Studio on a VPS, Gateway somewhere else

In this topology, Studio must be able to reach the gateway from the VPS network.

In Studio, set:
- Upstream URL: `ws://<gateway-host>:18789` (plain)
- Or `wss://<gateway-host>...` (TLS)

### Install + run Studio (recommended)
```bash
npx -y openclaw-studio@latest
cd openclaw-studio
npm run dev
```

Open http://localhost:3000 and set:
- Token: `openclaw config get gateway.auth.token`
- Gateway URL: `ws://localhost:18789` (gateway runs on the same machine as Studio)
- Gateway URL: `wss://gateway-host.your-tailnet.ts.net` (remote gateway via Tailscale Serve)
- Gateway URL: `ws://gateway-host:18789` (remote gateway reachable from the Studio host)

Notes:
- If the gateway rejects insecure origins (for example `INVALID_REQUEST ... control ui requires HTTPS or localhost (secure context)`), use `ws://localhost:...` for local gateways or `wss://...` for remote gateways.
- When Studio is on a VPS, `ws://localhost:18789` connects to the VPS-local gateway even if you're browsing Studio from a phone/tablet.

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

## Cron jobs in Agent Settings

- Open an agent and go to **Settings -> Cron jobs**.
- If no jobs exist, use the empty-state **Create** button.
- If jobs already exist, use the header **Create** button.
- The modal is agent-scoped and walks through template selection, task text, schedule, and review.
- Submitting creates the job via gateway `cron.add` and refreshes that same agent's cron list.

## Agent creation workflow

- Click **New Agent** in the fleet sidebar.
- Pick a **Preset bundle** (for example Research Analyst, PR Engineer, Autonomous Engineer, Growth Operator, Coordinator, or Blank).
- Each preset card shows capability chips and risk level (`Exec`, `Internet`, `File tools`, `Sandbox`, `Heartbeat`, plus caveats when relevant).
- Optionally override the **Control level** (Conservative, Balanced, or Autopilot).
- Add optional customization (agent name, first task, notes, and advanced control toggles).
- Review the behavior summary, then create.
- Studio compiles this setup into per-agent artifacts only:
  - per-agent sandbox/tool overrides in `agents.list[]`
  - per-agent exec approval policy in `exec-approvals.json`
  - core agent files (`AGENTS.md`, `SOUL.md`, `IDENTITY.md`, `USER.md`, `TOOLS.md`, `HEARTBEAT.md`, `MEMORY.md`)
  - additive tool policy (`tools.alsoAllow`) so preset selections do not remove base profile tools
- If setup fails after `agents.create`, Studio keeps the created agent, stores a pending setup in tab-scoped session storage keyed by gateway URL, and shows `Retry setup` / `Discard pending setup` in chat.
- Auto-retry is deduplicated across reconnect and restart flows, so one pending setup is applied at most once at a time per agent.
- Studio does not modify global defaults during creation.

## Exec approvals in chat

- When a run requires exec approval, chat shows an **Exec approval required** card with:
  - command preview
  - host and cwd
  - expiration timestamp
- Resolve directly in chat with:
  - **Allow once**
  - **Always allow**
  - **Deny**
- The fleet row displays **Needs approval** while approvals are pending for that agent.
- Expired approvals are pruned automatically, so stale cards and stale **Needs approval** badges clear without a manual resolve event.

## Troubleshooting

### Identify which side is broken

- If the Studio page does not load: Browser->Studio (HTTP) problem.
- If the Studio page loads but “Connect” fails: likely Studio->Gateway (upstream) problem.

### Proxy error codes

Studio’s WS bridge can surface upstream problems as specific codes:

- `studio.gateway_url_missing`: upstream URL not configured on the Studio host.
- `studio.gateway_token_missing`: upstream token not configured on the Studio host.
- `studio.gateway_url_invalid`: upstream URL is malformed (must be `ws://...` or `wss://...`).
- `studio.settings_load_failed`: Studio host failed to read settings from disk.
- `studio.upstream_error`: Studio could not establish the upstream WebSocket.
- `studio.upstream_closed`: the upstream gateway closed the connection.

### Common symptoms

- TLS errors like `EPROTO` / “wrong version number”
  - Usually: you used `wss://...` to an endpoint that is only serving plain HTTP/WS.
  - Fix: use `ws://...` for plain endpoints, or put the gateway behind HTTPS (for example Tailscale Serve) and use `wss://...`.
- Assets 404 / blank page when reverse-proxying under `/studio`
  - Studio is not configured with a Next.js `basePath` by default.
  - Fix: serve it at `/`, or configure `basePath` in `next.config.ts` and rebuild.
- 401 “Studio access token required”
  - `STUDIO_ACCESS_TOKEN` is enabled on the Studio server.
  - Fix: open `/?access_token=...` once to set the cookie, then reload.

## Architecture

See `ARCHITECTURE.md` for details on modules and data flow.
