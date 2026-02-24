# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

OpenClaw Studio is a Next.js App Router web dashboard for OpenClaw. It provides a focused UI for managing agents, chatting with them, handling exec approvals, and configuring cron jobs. The app uses a **gateway-first architecture** where the OpenClaw Gateway is the source of truth for agents and runtime state, while Studio only persists local UI preferences and connection settings.

**Important**: This is the frontend for OpenClaw. The OpenClaw source code lives at `~/openclaw`. Do not modify OpenClaw source code when making Studio changes. When understanding implementation context, you may need to search through OpenClaw's source, but apply solutions to this app only.

## Repository Context

This is a **personal fork** maintained at `tekram/openclaw-studio`, forked from the upstream open-source project at `grp06/openclaw-studio`.

**Development approach:**
- Develop and test features in personal fork branches
- Contribute valuable features back to upstream via pull requests
- Maintain fork-specific customizations separately when needed
- Follow upstream's contribution guidelines and code style

**Workflow:**
1. Create feature branches in personal fork (e.g., `feat/session-tracking`)
2. Develop and test changes locally
3. Commit and push to personal fork
4. Create PR from `tekram:branch` → `grp06:main` for upstream contribution
5. Keep fork synced with upstream main branch

**Git remotes:**
- `origin`: `https://github.com/tekram/openclaw-studio.git` (personal fork)
- Upstream should be: `https://github.com/grp06/openclaw-studio.git`

When implementing features, consider whether they should be:
- **Contributed upstream**: Generally useful features that benefit the community
- **Fork-only**: Personal customizations or experimental features

## Development Commands

```bash
# Development
npm run dev              # Start dev server with custom Node server + WS proxy
npm run dev:turbo        # Same as dev (alias)

# Building & Production
npm run build            # Build Next.js production bundle
npm start                # Start production server with custom Node server + WS proxy

# Code Quality
npm run lint             # Run ESLint
npm run typecheck        # Run TypeScript compiler checks (no emit)

# Testing
npm run test             # Run unit tests with Vitest
npm run e2e              # Run end-to-end tests with Playwright
npm run pw:open:max      # Open Playwright UI maximized

# Utilities
npm run cleanup:ux-artifacts        # Clean up UX artifacts
npm run sync:gateway-client         # Sync vendored OpenClaw gateway client
npm run migrate:architecture        # Run architecture migration script
npm run studio:setup                # Run Studio setup script
npm run smoke:dev-server            # Smoke test dev server
```

## Architecture Overview

### Core Design Principles

1. **Gateway-first**: Agents, sessions, and config live in the OpenClaw Gateway. Studio stores only UI settings (gateway URL/token, focused agent, filter preferences).

2. **WebSocket Proxy Pattern**: Browser connects to Studio's `/api/gateway/ws`, which proxies to the upstream OpenClaw Gateway with server-side token injection.

3. **Feature-first Organization**: Related UI components, state, and operations are grouped in `src/features/agents` for cohesion.

4. **Operations Pattern**: Complex workflows are extracted into operation modules under `src/features/agents/operations/` for testability and separation from React components.

5. **Settings Persistence**: Studio settings stored at `~/.openclaw/openclaw-studio/settings.json` (resolved via `resolveStateDir` with legacy fallbacks).

### Directory Structure

```
src/
├── app/                    # Next.js App Router pages, layouts, API routes
│   ├── api/                # Server-side API routes
│   │   ├── gateway/        # Gateway proxy endpoints
│   │   ├── studio/         # Studio settings endpoint
│   │   └── path-suggestions/ # Path autocomplete
│   └── page.tsx            # Main page with fleet/chat/inspect layout
├── features/
│   └── agents/             # Agent management feature module
│       ├── components/     # UI components (chat, fleet, inspect, create)
│       ├── state/          # Client state, runtime event handling, mutations
│       ├── operations/     # Workflow operations (hydration, reconcile, cron, etc.)
│       └── approvals/      # Exec approval lifecycle and store
├── lib/                    # Shared utilities and domain logic
│   ├── gateway/            # Gateway client, config, agent files, exec approvals
│   ├── studio/             # Studio settings store and coordinator
│   ├── ssh/                # SSH helpers for gateway-host operations
│   ├── cron/               # Cron types and helpers
│   ├── clawdbot/           # OpenClaw config/state path resolution
│   └── text/               # Message parsing and normalization
├── components/             # Shared UI components
└── styles/                 # Global styles

server/                     # Custom Node server for WebSocket proxy
├── index.js                # Main server entry point
├── gateway-proxy.js        # WebSocket proxy to upstream gateway
├── studio-settings.js      # Server-side settings loader
└── access-gate.js          # Optional access token gate

docs/                       # Additional documentation
├── ui-guide.md             # UI workflows guide
├── pi-chat-streaming.md    # Chat streaming architecture
└── permissions-sandboxing.md # Permissions and sandboxing details
```

### Data Flow

#### 1. Studio Settings Flow
- Source of truth: `~/.openclaw/openclaw-studio/settings.json`
- Loaded/saved via `/api/studio` route
- Contains: gateway URL/token, focused agent, filter preferences
- Client uses `StudioSettingsCoordinator` for debounced writes

#### 2. Gateway Connection Flow
1. Browser connects to `ws(s)://<studio-host>:3000/api/gateway/ws`
2. Studio proxy (`server/gateway-proxy.js`) loads upstream URL/token server-side
3. Proxy forwards frames to upstream gateway with token injection
4. If connection fails, proxy sends structured error with code (e.g., `studio.gateway_url_missing`)
5. Client's `useGatewayConnection` decides auto-retry based on error code

#### 3. Agent Runtime Flow
1. Gateway connection established via `GatewayClient`
2. UI requests `agents.list` to build fleet
3. Single gateway listener in `src/app/page.tsx` classifies events:
   - `presence`/`heartbeat` → summary refresh
   - `chat`/`agent` → runtime streams
   - `exec.approval.requested`/`.resolved` → approval cards
4. Runtime events routed through `runtimeEventPolicy.ts` (pure decisions) → `gatewayRuntimeEventHandler.ts` (side effects)
5. Agent store updates state

#### 4. Agent Creation Flow
1. `AgentCreateModal` captures name + optional avatar
2. `runCreateAgentMutationLifecycle` enqueues mutation with guardrails
3. `createGatewayAgent` calls `config.get` to derive workspace, then `agents.create`
4. Studio reloads fleet and focuses new agent chat
5. Post-creation settings (permissions, runtime) done via settings panel

#### 5. Session Settings Synchronization
- UI callbacks from `AgentChatPanel` (model/thinking changes)
- `applySessionSettingMutation` handles optimistic updates + sync
- `syncGatewaySessionSettings` sends `sessions.patch` to gateway

### Key Modules

#### Gateway Client (`src/lib/gateway/`)
- `GatewayClient.ts` - WebSocket client, wraps vendored `GatewayBrowserClient`
- `agentConfig.ts` - Agent create/rename/heartbeat operations via `config.patch`
- `agentFiles.ts` - Agent file read/write via `agents.files.get/set`
- `execApprovals.ts` - Exec approval management via `exec.approvals.get/set`
- `openclaw/GatewayBrowserClient.ts` - Vendored OpenClaw UI gateway client

#### Studio Settings (`src/lib/studio/`)
- `settings.ts` - Settings types and validation
- `settings-store.ts` - Settings file I/O
- `coordinator.ts` - Client-side load/patch/flush coordinator (debounced writes)

#### Agent Operations (`src/features/agents/operations/`)
- `agentFleetHydration.ts` - Fleet hydration I/O (loads snapshots)
- `agentFleetHydrationDerivation.ts` - Pure derivation (seeds, exec policy, summaries)
- `chatSendOperation.ts` - Chat send workflow
- `cronCreateOperation.ts` - Cron creation workflow
- `mutationLifecycleWorkflow.ts` - Agent create/rename/delete lifecycle
- `fleetLifecycleWorkflow.ts` - Fleet summary/reconcile policy
- `historyLifecycleWorkflow.ts` - History request/disposition policy
- `agentReconcileOperation.ts` - Agent reconciliation adapter

#### Runtime Event Handling (`src/features/agents/state/`)
- `runtimeEventBridge.ts` - Event classification (`presence`/`heartbeat`/`chat`/`agent`)
- `runtimeEventPolicy.ts` - Pure policy decisions (side-effect-free)
- `gatewayRuntimeEventHandler.ts` - Intent execution (side effects)
- `sessionSettingsMutations.ts` - Centralized session setting mutations

#### Exec Approvals (`src/features/agents/approvals/`)
- `execApprovalLifecycleWorkflow.ts` - Approval lifecycle policy
- `execApprovalResolveOperation.ts` - Manual approval resolution
- `pendingStore.ts` - Pending approval queue with expiry pruning

## Important Patterns and Conventions

### DO: Follow These Patterns

1. **Gateway as Source of Truth**
   - Agent records map 1:1 to `agents.list` entries
   - Use `config.patch` for agent create/rename/heartbeat/delete
   - Use `agents.files.get/set` for agent file edits
   - Use `exec.approvals.set` for exec approval policy

2. **Feature-First Organization**
   - Keep related UI components, state, and operations together in `src/features/`
   - Shared logic goes in `src/lib/`

3. **Operations for Workflows**
   - Extract complex workflows into testable operation modules
   - Keep `page.tsx` as wiring, not business logic

4. **Structured Error Handling**
   - API routes return JSON `{ error }` with appropriate status
   - Gateway connect failures preserve error codes (`GatewayResponseError`)
   - Use `resolveGatewayAutoRetryDelayMs` for retry gating

5. **Pure Derivations**
   - Separate I/O (hydration) from pure derivation logic
   - Makes code independently testable without mocks

### DON'T: Forbidden Patterns

1. **Never** read/write local files directly from client components
2. **Never** reintroduce local projects/workspaces as source of truth for agents
3. **Never** write agent data directly to `openclaw.json`; use gateway `config.patch`
4. **Never** read/write agent files on local filesystem; use gateway tools proxy
5. **Never** add parallel gateway settings endpoints; `/api/studio` is the only path
6. **Never** store gateway tokens in client-side persistent storage
7. **Never** add global mutable state outside `AgentStoreProvider` for agent UI data
8. **Never** silently swallow errors in API routes; always return actionable errors
9. **Never** add heavy abstractions or frameworks without clear evidence of need

## Testing

### Unit Tests (Vitest)
```bash
npm run test
```
- Located in `tests/unit/**/*.test.ts`
- Uses jsdom environment
- Setup file: `tests/setup.ts`
- Import alias: `@/` → `./src/`

### E2E Tests (Playwright)
```bash
npm run e2e                # Run tests
npm run pw:open:max        # Open Playwright UI
```
- Located in `tests/e2e/`
- Base URL: `http://127.0.0.1:3000`
- Uses isolated `OPENCLAW_STATE_DIR` for test fixtures
- Web server auto-starts on port 3000

## Environment Variables

Create a `.env.local` file (never commit!) or use system env vars:

```bash
# OpenClaw state/config paths (default: ~/.openclaw)
OPENCLAW_STATE_DIR=/path/to/.openclaw
OPENCLAW_CONFIG_PATH=/path/to/.openclaw/openclaw.json

# Default gateway URL when Studio settings are missing (default: ws://127.0.0.1:18789)
NEXT_PUBLIC_GATEWAY_URL=ws://127.0.0.1:18789

# Optional: SSH target for gateway-host operations
OPENCLAW_GATEWAY_SSH_TARGET=user@gateway-host
OPENCLAW_GATEWAY_SSH_USER=ubuntu

# Optional: default agent to copy auth profiles from
CLAWDBOT_DEFAULT_AGENT_ID=main

# Optional: Studio access token (enables access gate)
STUDIO_ACCESS_TOKEN=your-secret-token
```

**Note**: Loopback IPs are normalized to `localhost` in Studio settings. The WS proxy rewrites loopback upstream origins to `localhost` for secure-context compatibility.

## Common Tasks

### Adding a New Agent Operation
1. Create operation module in `src/features/agents/operations/`
2. Export pure workflow logic and adapter functions
3. Wire into `src/app/page.tsx` or relevant component
4. Add unit tests in `tests/unit/`

### Adding a New Gateway Method
1. Check if method exists in vendored `GatewayBrowserClient.ts`
2. If not, sync from upstream: `npm run sync:gateway-client`
3. Add typed wrapper in `src/lib/gateway/` if needed
4. Use from operations or components

### Adding a New API Route
1. Create route handler in `src/app/api/`
2. Use Node runtime for filesystem or SSH operations
3. Return JSON `{ error }` on failure with appropriate status
4. Use `runSshJson` helper for gateway-host SSH operations

### Modifying Settings Schema
1. Update types in `src/lib/studio/settings.ts`
2. Update settings store in `src/lib/studio/settings-store.ts`
3. Update coordinator if load/patch logic changes
4. Consider migration for existing settings files

## WebSocket Proxy Architecture

The custom Node server (`server/index.js`) wraps Next.js to provide:
- WebSocket termination at `/api/gateway/ws`
- Server-side gateway URL/token loading from Studio settings
- Auth token injection in `connect` frames
- Transparent frame forwarding to upstream gateway

**Why**: Allows secure token custody, easier local/remote switching, and single-origin browser connection.

## Troubleshooting

### Gateway Connection Failures
- `studio.gateway_url_missing` - Set gateway URL in Studio settings
- `studio.gateway_token_missing` - Set gateway token in Studio settings
- `studio.upstream_error` / `studio.upstream_closed` - Check upstream gateway
- `EPROTO` / "wrong version number" - Using `wss://` with non-TLS endpoint (use `ws://`)
- `INVALID_REQUEST: invalid config` - Run `npx openclaw doctor --fix`

### Auto-Retry Behavior
Connect failures are gated by `resolveGatewayAutoRetryDelayMs` based on error code:
- Missing URL/token: no auto-retry (needs user input)
- Upstream errors: retry after delay
- Invalid config: no auto-retry (needs `openclaw doctor`)

### Assets 404 Under `/studio`
Studio must be served at `/` unless `basePath` is configured and rebuilt.

## Additional Documentation

- `ARCHITECTURE.md` - Detailed architecture, data flow, design decisions
- `AGENTS.md` - Agent-specific instructions (repo context)
- `docs/ui-guide.md` - UI workflows (agent creation, cron jobs, exec approvals)
- `docs/pi-chat-streaming.md` - Chat streaming architecture
- `docs/permissions-sandboxing.md` - Permissions and sandboxing details

## Path Aliases

TypeScript and build tools resolve `@/` to `./src/`:
```typescript
import { GatewayClient } from '@/lib/gateway/GatewayClient'
```
