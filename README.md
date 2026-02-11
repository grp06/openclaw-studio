![Home screen](home-screen.png)

# OpenClaw Studio

[![Discord](https://img.shields.io/badge/Discord-Join-5865F2?logo=discord&logoColor=white)](https://discord.gg/VEpdKJ9e)

OpenClaw Studio is a Next.js dashboard for managing OpenClaw agents via the OpenClaw Gateway (WebSocket).

## How Studio Connects (Read This If You Use A Phone / Remote Host)

There are **two separate connections** involved:

1. **Your browser -> Studio** (HTTP) at `http://<studio-host>:3000`
2. **Your browser -> OpenClaw Gateway** (WebSocket) at the configured **Gateway URL**

Important consequences:
- The Gateway connection is made **from the browser**, not from the machine running `next dev`.
- `ws://127.0.0.1:18789` / `ws://localhost:18789` means “connect to a gateway on the same device as the browser”.
  - If you open Studio on your phone, `127.0.0.1` is your phone, not your laptop/server.
- Studio **persists** the Gateway URL/token under `~/.openclaw/openclaw-studio/settings.json`. Once set in the UI, this will be used on future runs and will override the default `NEXT_PUBLIC_GATEWAY_URL`.
- If Studio is served over `https://`, the Gateway URL must be `wss://...` (browsers block `ws://` from `https://` pages).

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

### Tailnet access via Tailscale Serve (recommended)

Most people keep the gateway bound to loopback and use Tailscale Serve on the gateway host.

On the gateway host:
```bash
openclaw config set gateway.tailscale.mode serve
openclaw config set gateway.auth.mode token
```

Restart your gateway. Then:
```bash
tailscale serve status
```

Take the HTTPS URL from `tailscale serve status` and convert it to a WebSocket URL for Studio:
- `https://gateway-host.your-tailnet.ts.net` -> `wss://gateway-host.your-tailnet.ts.net`

### Install + run Studio (recommended)
```bash
npx -y openclaw-studio
cd openclaw-studio
npm run dev
```

Open http://localhost:3000 and set:
- Token: `openclaw config get gateway.auth.token`
- Gateway URL: `wss://gateway-host.your-tailnet.ts.net` (tailnet via `tailscale serve`)
- Gateway URL: `ws://127.0.0.1:18789` (local gateway)
- Gateway URL: `ws://your-host:18789` (direct remote port, no `tailscale serve`)

Notes:
- If Studio is served over `https://`, the gateway URL must be `wss://...` (browsers block `ws://` from `https://` pages).
- If you browse Studio from another device (phone/tablet), do not use `ws://127.0.0.1:18789` unless the gateway is running on that device. Use a reachable host (LAN IP/DNS), `wss://...` via Tailscale Serve, or an SSH tunnel.

### SSH tunneling (alternative)

If you prefer SSH tunneling to a remote host:
```bash
ssh -L 18789:127.0.0.1:18789 user@your-host
```
Then connect Studio to `ws://127.0.0.1:18789`.

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
- Default gateway URL: `ws://127.0.0.1:18789` (override via Studio Settings or `NEXT_PUBLIC_GATEWAY_URL`)

## Cron jobs in Agent Settings

- Open an agent and go to **Settings -> Cron jobs**.
- If no jobs exist, use the empty-state **Create** button.
- If jobs already exist, use the header **Create** button.
- The modal is agent-scoped and walks through template selection, task text, schedule, and review.
- Submitting creates the job via gateway `cron.add` and refreshes that same agent's cron list.

## Troubleshooting

- **Missing config**: Run `openclaw onboard` or set `OPENCLAW_CONFIG_PATH`
- **Gateway unreachable**: Confirm the gateway is running and `NEXT_PUBLIC_GATEWAY_URL` matches
- **Auth errors**: Studio currently prompts for a token. Check `gateway.auth.mode` is `token` and `gateway.auth.token` is set in `openclaw.json` (or run `openclaw config get gateway.auth.token`).
- **UI loads but no agents show up** (common when browsing from a phone):
  - Check the Gateway URL shown in Studio. If it is `ws://127.0.0.1:18789`, that will only work when browsing Studio on the same machine running the gateway (or via an SSH tunnel).
  - If you set a Gateway URL once, it is persisted in `~/.openclaw/openclaw-studio/settings.json`. Update it in the UI (or delete/reset the file) if you moved hosts.
- **Still stuck**: Run `npx -y openclaw-studio@latest doctor --check` (and `--fix --force-settings` to safely rewrite Studio settings).

## Architecture

See `ARCHITECTURE.md` for details on modules and data flow.
