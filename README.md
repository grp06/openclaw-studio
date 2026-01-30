# clawdbot-agent-ui

Agent Canvas UI for Clawdbot/Moltbot. This is a local-first Next.js UI that talks directly to the Clawdbot gateway and stores workspace state on disk.

## Features
- Multi-agent canvas for managing local workspaces
- Live gateway connection for streaming tool output
- Workspace file editor (AGENTS.md, MEMORY.md, etc.)
- Optional Discord channel provisioning
- Local JSON store (no external DB)

## Requirements
- Node.js (LTS recommended)
- Clawdbot/Moltbot installed and gateway running
- git in PATH (used when creating workspaces)
- macOS or Linux; Windows supported via WSL2

## Quick start (from source)
```bash
git clone https://github.com/<your-org>/clawdbot-agent-ui.git
cd clawdbot-agent-ui
npm install
npm run dev
```
Open http://localhost:3000

If you want env overrides, copy the example:
```bash
cp .env.example .env
```

## Configuration
The UI reads gateway config from `moltbot.json` in your state directory. Defaults:
- State dir: `~/.moltbot` (or `~/.clawdbot` if present)
- Config: `~/.moltbot/moltbot.json` (or `~/.clawdbot/moltbot.json`)
- Gateway URL: `ws://127.0.0.1:18789`

Optional env overrides:
- `MOLTBOT_STATE_DIR` / `CLAWDBOT_STATE_DIR`
- `MOLTBOT_CONFIG_PATH` / `CLAWDBOT_CONFIG_PATH`
- `NEXT_PUBLIC_GATEWAY_URL`
- `CLAWDBOT_DEFAULT_AGENT_ID`

To use a dedicated state dir while developing:
```bash
MOLTBOT_STATE_DIR=~/moltbot-dev npm run dev
```

## Windows (WSL2)
Run the UI and Clawdbot inside the same WSL2 distro. Use the WSL shell to install Node, run the gateway, and start this UI. Access the UI in a Windows browser at http://localhost:3000.

## Scripts
- `npm run dev`
- `npm run build`
- `npm run start`
- `npm run lint`
- `npm run typecheck`
- `npm run test`
- `npm run e2e` (requires `npx playwright install`)

## Troubleshooting
- **Missing config**: run the Clawdbot onboarding (`moltbot onboard`) or set `MOLTBOT_CONFIG_PATH`.
- **Gateway not reachable**: confirm the gateway is running and `NEXT_PUBLIC_GATEWAY_URL` matches the host/port.
- **Auth errors**: check `gateway.auth.token` in your `moltbot.json`.

## Architecture
See `ARCHITECTURE.md` for a deeper walkthrough of modules and data flow.
