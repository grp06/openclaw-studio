# moltbot-agent-ui

![Read Me Image](readme-image.png)

Agent Canvas UI for Moltbot — a visual command center for multi-agent orchestration.

The terminal is great for running a command. It’s not great at being a *home* for a team of agents: multiple threads of work, long-running tasks, shared context, files that evolve, and the constant question of “what’s running where?” This project is built on the belief that the future of multi-agent orchestration won’t live exclusively in the terminal — it needs a UI that makes complex work feel obvious.

`moltbot-agent-ui` is a local-first Next.js app that connects to the Moltbot gateway, streams tool output live, and keeps workspace state on disk. The goal is simple: make multi-agent work friendly and fun to use, while staying ultra powerful when you need to go deep.

If you’re building or running agent workflows, this is the place to:
- See work happening across agents at a glance
- Keep context and artifacts (AGENTS.md, MEMORY.md, etc.) close to the work
- Drive real projects forward without losing the plot

## Features
- Multi-agent canvas for managing local workspaces
- Live gateway connection for streaming tool output
- Workspace file editor (AGENTS.md, MEMORY.md, etc.)
- Optional Discord channel provisioning
- Local JSON store (no external DB)

## Requirements
- Node.js (LTS recommended)
- Moltbot installed and gateway running
- git in PATH (used when creating workspaces)
- macOS or Linux; Windows supported via WSL2

## Quick start (from source)
```bash
git clone https://github.com/grp06/moltbot-agent-ui.git
cd moltbot-agent-ui
npm install
npm run dev
```
Open http://localhost:3000

Env overrides are optional. By default the UI reads config from `~/.clawdbot` or `~/.moltbot`.
Only create a `.env` if you need to override those defaults:
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
Run the UI and Moltbot inside the same WSL2 distro. Use the WSL shell to install Node, run the gateway, and start this UI. Access the UI in a Windows browser at http://localhost:3000.

## Scripts
- `npm run dev`
- `npm run build`
- `npm run start`
- `npm run lint`
- `npm run typecheck`
- `npm run test`
- `npm run e2e` (requires `npx playwright install`)

## Troubleshooting
- **Missing config**: run the Moltbot onboarding (`moltbot onboard`) or set `MOLTBOT_CONFIG_PATH`.
- **Gateway not reachable**: confirm the gateway is running and `NEXT_PUBLIC_GATEWAY_URL` matches the host/port.
- **Auth errors**: check `gateway.auth.token` in your `moltbot.json`.

## Architecture
See `ARCHITECTURE.md` for a deeper walkthrough of modules and data flow.
