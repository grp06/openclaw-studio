# openclaw-studio

![Read Me Image](readme-image.png)

When you run multiple agents, you need a place to see what's happening.

OpenClaw Studio is that place. It's the visual interface for the OpenClaw ecosystem—designed for people who coordinate agents across workspaces, track long-running tasks, and need to stay oriented when the work gets complex.

The terminal is good for single commands. But agents don't work in single commands. They work in threads. They share context. They produce files that evolve. They run in parallel, and you need to know what's running where.

OpenClaw Studio solves this. It's a local-first Next.js app that connects to your OpenClaw gateway, streams everything live, and keeps workspace state on disk. The interface is simple enough to feel obvious, powerful enough to handle real work.

## What it does

- Shows you every agent and workspace at a glance
- Keeps workspace files (AGENTS.md, MEMORY.md, etc.) right where you need them
- Streams tool output in real time
- Provisions Discord channels when you need them
- Stores everything locally—no external database

This is where multi-agent work happens.

## Requirements

- Node.js (LTS recommended)
- OpenClaw installed with gateway running
- git in PATH
- macOS or Linux; Windows via WSL2

## Quick start
```bash
git clone https://github.com/grp06/openclaw-studio.git
cd openclaw-studio
npm install
npm run dev
```

Open http://localhost:3000

The UI reads config from `~/.openclaw` by default (falls back to `~/.moltbot` or `~/.clawdbot` if you're migrating).
Only create a `.env` if you need to override those defaults:
```bash
cp .env.example .env
```

## Configuration

Your gateway config lives in `openclaw.json` in your state directory. Defaults:
- State dir: `~/.openclaw`
- Config: `~/.openclaw/openclaw.json`
- Gateway URL: `ws://127.0.0.1:18789`

Optional overrides:
- `OPENCLAW_STATE_DIR`
- `OPENCLAW_CONFIG_PATH`
- `NEXT_PUBLIC_GATEWAY_URL`
- `CLAWDBOT_DEFAULT_AGENT_ID`

To use a dedicated state dir during development:
```bash
OPENCLAW_STATE_DIR=~/openclaw-dev npm run dev
```

## Windows (WSL2)

Run both OpenClaw Studio and OpenClaw inside the same WSL2 distro. Use the WSL shell for Node, the gateway, and the UI. Access it from Windows at http://localhost:3000.

## Scripts

- `npm run dev`
- `npm run build`
- `npm run start`
- `npm run lint`
- `npm run typecheck`
- `npm run test`
- `npm run e2e` (requires `npx playwright install`)

## Troubleshooting

- **Missing config**: Run `openclaw onboard` or set `OPENCLAW_CONFIG_PATH`
- **Gateway unreachable**: Confirm the gateway is running and `NEXT_PUBLIC_GATEWAY_URL` matches
- **Auth errors**: Check `gateway.auth.token` in `openclaw.json`

## Architecture

See `ARCHITECTURE.md` for details on modules and data flow.
