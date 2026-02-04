# Architecture

## High-level overview & goals
OpenClaw Studio is a gateway-first, single-user Next.js App Router UI for managing OpenClaw agents. It provides:
- A focused UI with fleet list, primary agent panel, and inspect sidebar.
- Local persistence for gateway connection + focused-view preferences via a JSON settings file.
- Direct integration with the OpenClaw runtime via a WebSocket gateway.
- Gateway-backed edits for agent config and agent files.
- Optional Discord channel provisioning for local gateways.

Primary goals:
- **Gateway-first**: agents, sessions, and config live in the gateway; Studio stores only UI settings.
- **Remote-friendly**: tailnet/remote gateways are first-class.
- **Clear boundaries**: client UI vs server routes vs external gateway/config.
- **Predictable state**: gateway is source of truth; local settings only for focused preferences + connection.
- **Maintainability**: feature-focused modules, minimal abstractions.

Non-goals:
- Multi-tenant or multi-user concurrency.
- Server-side rendering of data from external services.

## Architectural style
**Layered + vertical slice (feature-first)** within Next.js App Router:
- UI components + feature state in `src/features`.
- Shared utilities and adapters in `src/lib`.
- Server-side route handlers under `src/app/api`.

This keeps feature cohesion high while preserving a clear client/server boundary.

## Main modules / bounded contexts
- **Focused agent UI** (`src/features/agents`): focused agent panel, fleet sidebar, inspect panel, and local in-memory state + actions. Agents render a status-first summary and latest-update preview driven by gateway events. Runtime chat/agent event translation and summary patch derivation are centralized through bridge helpers (`src/features/agents/state/runtimeEventBridge.ts`) and consumed from a single runtime listener path in `src/app/page.tsx`. Full transcripts load only on explicit “Load history” actions.
- **Studio settings** (`src/lib/studio`, `src/app/api/studio`): local settings store for gateway URL/token and focused preferences (`src/lib/studio/settings.ts`, `src/lib/studio/settings.server.ts`, `src/app/api/studio/route.ts`). `src/lib/studio/coordinator.ts` now owns both the `/api/studio` transport helpers and shared client-side load/patch scheduling for gateway, focused, and studio-session settings.
- **Gateway** (`src/lib/gateway`): WebSocket client for agent runtime (frames, connect, request/response). The OpenClaw control UI client is vendored in `src/lib/gateway/openclaw/GatewayBrowserClient.ts` with a sync script at `scripts/sync-openclaw-gateway-client.ts`.
- **Gateway-backed config + agent-file edits** (`src/lib/gateway/agentConfig.ts`, `src/lib/gateway/tools.ts`, `src/app/api/gateway/tools/route.ts`): agent rename/heartbeat via `config.get` + `config.patch`, agent file read/write via `/tools/invoke` proxy.
- **Local OpenClaw config + paths** (`src/lib/clawdbot`): state/config/.env path resolution with `OPENCLAW_*` env overrides (`src/lib/clawdbot/paths.ts`). Local config access is used for optional Discord provisioning and local path/config helpers; shared local config list helpers live in `src/lib/clawdbot/config.ts` and are reused by Discord provisioning. Gateway URL/token in Studio are sourced from studio settings.
- **Shared agent config-list helpers** (`src/lib/agents/configList.ts`): pure `agents.list` read/write/upsert helpers reused by both gateway config patching (`src/lib/gateway/agentConfig.ts`) and local config access (`src/lib/clawdbot/config.ts`) to keep list-shape semantics aligned.
- **Discord integration** (`src/lib/discord`, API route): channel provisioning and config binding (local gateway only).
- **Shared utilities** (`src/lib/*`): env, ids, names, avatars, text parsing, logging, filesystem helpers.

## Directory layout (top-level)
- `src/app`: Next.js App Router pages, layouts, global styles, and API routes.
- `src/features`: feature-first UI modules (currently focused agent-management components under `features/agents`).
- `src/lib`: domain utilities, adapters, API clients, and shared logic.
- `src/components`: shared UI components (minimal use today).
- `src/styles`: shared styling assets.
- `public`: static assets.
- `tests`, `playwright.config.ts`, `vitest.config.ts`: automated testing.

## Data flow & key boundaries
### 1) Studio settings + focused preferences
- **Source of truth**: JSON settings file at `~/.openclaw/openclaw-studio/settings.json` (resolved via `resolveStateDir`, with legacy fallbacks in `src/lib/clawdbot/paths.ts`). Settings store the gateway URL/token plus per-gateway focused preferences and studio session ids.
- **Server boundary**: `src/app/api/studio/route.ts` loads/saves settings via `src/lib/studio/settings.server.ts`.
- **Client boundary**: `useGatewayConnection` and focused/session flows in `src/app/page.tsx` use a shared `StudioSettingsCoordinator` to load settings, coalesce debounced `/api/studio` patch writes, and force immediate session-id writes when bootstrapping a new studio session.

Flow:
1. UI loads settings from `/api/studio`.
2. Gateway URL/token seed the connection panel and auto-connect.
3. Focused filter + selected agent + studio session id are loaded for the current gateway.
4. UI schedules focused and gateway patches through the coordinator, while studio-session bootstrap uses an immediate coordinator patch; both paths converge on `/api/studio`.

### 2) Agent runtime (gateway)
- **Client-side only**: `GatewayClient` uses WebSocket to connect to the gateway and wraps the vendored `GatewayBrowserClient`.
- **API is not in the middle**: UI speaks directly to the gateway for streaming and agent events.

Flow:
1. UI loads gateway URL/token from `/api/studio` (defaulting to `NEXT_PUBLIC_GATEWAY_URL` if unset).
2. `GatewayClient` connects + sends `connect` request.
3. UI requests `agents.list` and builds session keys via `buildAgentMainSessionKey(agentId, mainKey)`.
4. UI sends requests (frames) and receives event streams.
5. A single runtime listener in `src/app/page.tsx` handles chat + agent frames and delegates lifecycle/stream/tool dedupe decisions to `src/features/agents/state/runtimeEventBridge.ts`.
6. Agent store updates agent output/state.

### 3) Agent config + agent files
- **Agent files**: `AGENTS.md`, `SOUL.md`, `IDENTITY.md`, `USER.md`, `TOOLS.md`, `HEARTBEAT.md`, `MEMORY.md`.
- **Heartbeat + rename**: stored in the gateway config and updated via `config.get` + `config.patch`.
 - **Tool policy**: the gateway build must expose coding tools on `/tools/invoke`, and any tool allowlists must permit `read`/`write`/`edit`/`apply_patch` for the target agent (otherwise `/tools/invoke` returns 404).

Flow:
1. UI requests heartbeat data via gateway `config.get` (client WS) and applies overrides via `config.patch` (`src/lib/gateway/agentConfig.ts`).
2. Agent file edits call `/api/gateway/tools`, which proxies to the gateway `/tools/invoke` endpoint with `read`/`write` and a session key.
3. UI reflects persisted state returned by the gateway.

### 4) Cron summaries + Discord provisioning
- **Cron**: `GET /api/cron` reads `~/.openclaw/cron/jobs.json` (local state dir) to display scheduled jobs.
- **Discord**: API route calls `createDiscordChannelForAgent`, uses `DISCORD_BOT_TOKEN` from the resolved state-dir `.env`, and updates local `openclaw.json` bindings.

## Cross-cutting concerns
- **Configuration**: `src/lib/env` validates env via zod; `lib/clawdbot/paths.ts` resolves config path and state dirs, honoring `OPENCLAW_STATE_DIR`/`OPENCLAW_CONFIG_PATH` and legacy fallbacks. Studio settings live under `<state dir>/openclaw-studio/settings.json`.
- **Logging**: `src/lib/logger` (console wrappers) used in API routes and gateway client.
- **Error handling**:
  - API routes return JSON `{ error }` with appropriate status.
  - `fetchJson` throws when `!res.ok`, surfaces errors to UI state.
  - `StudioSettingsCoordinator` logs failed async persistence writes (debounced flush or queued patch failures) so settings-save errors are observable.
- **Filesystem helpers**: server-only utilities live in `src/lib/fs.server.ts` (safe directory/file creation, home-scoped path autocomplete). These are used for local settings, cron summaries, and path suggestions, not for agent file edits.
- **Tracing**: `src/instrumentation.ts` registers `@vercel/otel` for telemetry.
- **Validation**: request payload validation in API routes and typed client/server helpers in `src/lib/*`.

## Major design decisions & trade-offs
- **Local settings file over DB**: fast, local-first persistence for gateway connection + focused preferences; trade-off is no concurrency or multi-user support.
- **WebSocket gateway direct to client**: lowest latency for streaming; trade-off is tighter coupling to the gateway protocol in the UI.
- **Gateway-first agent records**: records map 1:1 to `agents.list` entries with main sessions; trade-off is no local-only agent concept.
- **Gateway-backed config + agent-file edits**: rename/heartbeat via `config.patch`, agent files via `/tools/invoke`; trade-off is reliance on gateway availability and tool allowlists.
- **Narrow local config mutation boundary**: local `openclaw.json` writes are limited to explicit local-only flows (currently Discord provisioning), and reuse shared list helpers instead of ad-hoc mutation paths; trade-off is less flexibility for local-only experimentation, but clearer ownership and lower drift risk.
- **Shared `agents.list` helper layer**: gateway and local config paths now consume one pure helper module for list parsing/writing/upsert behavior; trade-off is one more shared dependency, but it reduces semantic drift and duplicate bug surface.
- **Single gateway settings endpoint**: `/api/studio` is the sole Studio gateway URL/token source; trade-off is migration pressure on any older local-config-based callers, but it removes ambiguous ownership and dead paths.
- **Shared client settings coordinator module**: `src/lib/studio/coordinator.ts` now owns `/api/studio` transport plus load/schedule/flush behavior for gateway + focused + session state; trade-off is introducing a central client singleton, but it removes wrapper indirection and duplicate timers/fetch paths.
- **Vendored gateway client + sync script**: reduces drift from upstream OpenClaw UI; trade-off is maintaining a sync path and local copies of upstream helpers.
- **Feature-first organization**: increases cohesion in UI; trade-off is more discipline to keep shared logic in `lib`.
- **Node runtime for API routes**: required for filesystem access and tool proxying; trade-off is Node-only server runtime.
- **Event-driven summaries + on-demand history**: keeps the dashboard lightweight; trade-off is history not being available until requested.
- **Single runtime event bridge for chat+agent streams**: one listener path in `src/app/page.tsx` now routes runtime frames through pure bridge helpers (`src/features/agents/state/runtimeEventBridge.ts`), including summary patch extraction that previously lived in a separate module; trade-off is a denser bridge contract, but lower divergence risk across lifecycle cleanup/state transitions.

## Mermaid diagrams
### C4 Level 1 (System Context)
```mermaid
C4Context
  title OpenClaw Studio - System Context
  Person(user, "User", "Operates agents locally")
  System(ui, "OpenClaw Studio", "Next.js App Router UI")
  System_Ext(gateway, "OpenClaw Gateway", "WebSocket runtime")
  System_Ext(fs, "Local Filesystem", "settings.json, cron/jobs.json, optional openclaw.json")
  System_Ext(discord, "Discord API", "Optional channel provisioning")

  Rel(user, ui, "Uses")
  Rel(ui, gateway, "WebSocket frames + HTTP tools")
  Rel(ui, fs, "HTTP to API routes -> fs read/write")
  Rel(ui, discord, "HTTP via API route")
```

### C4 Level 2 (Containers/Components)
```mermaid
C4Container
  title OpenClaw Studio - Containers
  Person(user, "User")

  Container_Boundary(app, "Next.js App") {
    Container(client, "Client UI", "React", "Focused agent-management UI, state, gateway client")
    Container(api, "API Routes", "Next.js route handlers", "Studio settings, gateway tools, cron, Discord")
  }

  Container_Ext(gateway, "Gateway", "WebSocket", "Agent runtime")
  Container_Ext(fs, "Filesystem", "Local", "settings.json, cron/jobs.json, optional openclaw.json")
  Container_Ext(discord, "Discord API", "REST", "Channel provisioning")

  Rel(user, client, "Uses")
  Rel(client, api, "HTTP JSON")
  Rel(client, gateway, "WebSocket")
  Rel(api, fs, "Read/Write")
  Rel(api, discord, "REST")
```

## Explicit forbidden patterns
- Do not read/write local files directly from client components.
- Do not reintroduce local projects/workspaces as a source of truth for agent records.
- Do not write agent rename/heartbeat data directly to `openclaw.json`; use gateway `config.patch`.
- Do not read/write agent files on the local filesystem; use the gateway tools proxy.
- Do not add parallel gateway settings endpoints; `/api/studio` is the only supported Studio gateway URL/token path.
- Do not add new generic local `openclaw.json` mutation wrappers for runtime agent-management flows; keep local writes constrained to explicit local-only integrations (for example, Discord provisioning).
- Do not store gateway tokens or secrets in client-side persistent storage.
- Do not add new global mutable state outside `AgentStoreProvider` for agent UI data.
- Do not silently swallow errors in API routes; always return actionable errors.
- Do not add heavy abstractions or frameworks unless there is clear evidence of need.

## Future-proofing notes
- If multi-user support becomes a goal, replace the settings file with a DB-backed service and introduce authentication at the API boundary.
- If gateway protocol evolves, isolate changes within `src/lib/gateway` and keep UI call sites stable.
