# Architecture

## High-level overview & goals
OpenClaw Studio is a local-first, single-user Next.js App Router UI for managing OpenClaw agents on a canvas. It provides:
- A canvas-based workspace UI for multiple agent tiles.
- Local persistence for projects/tiles via a JSON store on disk.
- Integration with the OpenClaw runtime via a WebSocket gateway.
- Optional Discord channel provisioning for agents.

Primary goals:
- **Local-first**: zero external DB, fast startup, filesystem-backed state.
- **Clear boundaries**: client UI vs server routes vs external gateway/config.
- **Predictable state**: single source of truth for project/tile state.
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
- **Canvas UI** (`src/features/canvas`): React Flow canvas, tiles, editor UI, local in-memory state + actions. Agent tiles render a status-first summary and latest-update preview driven by gateway events + summary snapshots (`src/features/canvas/state/summary.ts`). Full transcripts load only on explicit “Load history” actions.
- **Projects** (`src/lib/projects`, `src/app/api/projects`): project/tile models, store persistence, shared store normalization and mutation helpers in `src/app/api/projects/store.ts`, worktree provisioning (`src/lib/projects/worktrees.server.ts`), workspace files, heartbeat settings, shared project/tile resolution plus API response helpers in `src/lib/projects/resolve.server.ts` (including param-based helpers that load the store), shared sessionKey helpers in `src/lib/projects/sessionKey.ts`, shared workspace file helpers in `src/lib/projects/workspaceFiles.ts`, server-side workspace file read/write helpers in `src/lib/projects/workspaceFiles.server.ts`, studio state-dir helper in `src/lib/projects/agentWorkspace.ts`, server-side filesystem helpers (`src/lib/projects/fs.server.ts`) for explicit cleanup operations. Workspace create/open is handled by `POST /api/projects` in `src/app/api/projects/route.ts` using name-or-path payloads, with a single client entry point in `src/lib/projects/client.ts`. Tiles store a worktree-backed `workspacePath` and support archive/restore with `archivedAt`. Archived tiles are hard-deleted via `POST /api/projects/cleanup` after previewing via `GET /api/projects/cleanup`, which removes worktrees, agent state, and agent config entries.
- **Gateway** (`src/lib/gateway`): WebSocket client for agent runtime (frames, connect, request/response). The OpenClaw control UI client is vendored in `src/lib/gateway/openclaw/GatewayBrowserClient.ts` with a sync script at `scripts/sync-openclaw-gateway-client.ts`.
- **OpenClaw config + paths** (`src/lib/clawdbot`): read/write openclaw.json (with legacy fallback), shared agent list helpers (used by heartbeat routes), shared config update helper for routes, heartbeat defaults, consolidated state/config/.env path resolution with `OPENCLAW_*` env overrides (`src/lib/clawdbot/paths.ts`).
- **Discord integration** (`src/lib/discord`, API route): channel provisioning and config binding.
- **Shared utilities** (`src/lib/*`): env, ids, names, avatars, text parsing, logging, filesystem helpers.

## Directory layout (top-level)
- `src/app`: Next.js App Router pages, layouts, global styles, and API routes.
- `src/features`: feature-first UI modules (currently canvas).
- `src/lib`: domain utilities, adapters, API clients, and shared logic.
- `src/components`: shared UI components (minimal use today).
- `src/styles`: shared styling assets.
- `public`: static assets.
- `tests`, `playwright.config.ts`, `vitest.config.ts`: automated testing.

## Data flow & key boundaries
### 1) Project + tile state
- **Source of truth**: JSON store on disk at `~/.openclaw/openclaw-studio/projects.json` (legacy fallback to `~/.moltbot` or `~/.clawdbot`).
- **Server boundary**: `src/app/api/projects/*` handles validation, persistence, and side effects.
- **Client boundary**: `AgentCanvasProvider` loads store on startup, caches in memory, and persists via API.

Flow:
1. UI dispatches action.
2. Client calls `lib/projects/client`.
3. API route mutates store + writes files/config; workspace create/open both use `POST /api/projects`. Tile creation provisions a per-agent git worktree and writes workspace files inside that worktree. Archive operations set `archivedAt` without deleting files.
4. API returns updated store.
5. Client hydrates store into runtime state.

### 2) Agent runtime (gateway)
- **Client-side only**: `GatewayClient` uses WebSocket to connect to the local OpenClaw gateway and wraps the vendored `GatewayBrowserClient`.
- **API is not in the middle**: UI speaks directly to the gateway for streaming and agent events.

Flow:
1. UI loads gateway URL/token from `/api/gateway`.
2. `GatewayClient` connects + sends `connect` request.
3. UI requests `models.list` to populate the model selector (backed by `~/.openclaw/openclaw.json` via the gateway, with legacy fallback).
4. UI sends requests (frames) and receives event streams.
5. Canvas store updates tile output/state.

### 3) Workspace files + heartbeat
- **Workspace files**: `AGENTS.md`, `SOUL.md`, `IDENTITY.md`, `USER.md`, `TOOLS.md`, `HEARTBEAT.md`, `MEMORY.md`.
- **Heartbeat**: stored in `openclaw.json` agent list entries (legacy config supported).

Flow:
1. UI requests workspace files/heartbeat via API.
2. API reads/writes filesystem + config. Workspace files live inside each agent’s worktree and are ignored via `.git/info/exclude`.
3. UI reflects persisted state.

### 4) Discord provisioning
- API route calls `createDiscordChannelForAgent`.
- Uses DISCORD_BOT_TOKEN from the resolved state-dir `.env` file.
- Updates `openclaw.json` bindings and channel config.

## Cross-cutting concerns
- **Configuration**: `src/lib/env` validates env via zod; `lib/clawdbot/paths.ts` resolves config path and state dirs, honoring `OPENCLAW_STATE_DIR`/`OPENCLAW_CONFIG_PATH` and legacy fallbacks.
- **Logging**: `src/lib/logger` (console wrappers) used in API routes and gateway client.
- **Error handling**:
  - API routes return JSON `{ error }` with appropriate status.
  - `fetchJson` throws when `!res.ok`, surfaces errors to UI state.
- **Filesystem helpers**: `src/lib/projects/worktrees.server.ts` provisions per-agent worktrees; `src/lib/projects/fs.server.ts` handles explicit cleanup operations; state/config path expansion lives in `src/lib/clawdbot/paths.ts`.
- **Projects store normalization**: `src/app/api/projects/store.ts` provides `normalizeProjectsStore` to keep active project selection consistent and to backfill `workspacePath` + `archivedAt`.
- **Tracing**: `src/instrumentation.ts` registers `@vercel/otel` for telemetry.
- **Validation**: request payload validation in API routes; shared project/tile resolution in `src/lib/projects/resolve.server.ts`; typed payloads in `lib/projects/types`.

## Major design decisions & trade-offs
- **Local JSON store over DB**: faster iteration, local-first; trade-off is no concurrency or multi-user support.
- **WebSocket gateway direct to client**: lowest latency for streaming; trade-off is tighter coupling to the gateway protocol in the UI.
- **Vendored gateway client + sync script**: reduces drift from upstream OpenClaw UI; trade-off is maintaining a sync path and local copies of upstream helpers.
- **Feature-first organization**: increases cohesion in UI; trade-off is more discipline to keep shared logic in `lib`.
- **Node runtime for API routes**: required for filesystem access; trade-off is Node-only server runtime.
- **Per-agent worktrees**: isolates agent file edits and git state; trade-off is additional worktree management and disk usage.
- **Event-driven summaries + on-demand history**: keeps the dashboard lightweight; trade-off is history not being available until requested.
- **Archive-first deletes**: preserves local state and worktrees by default; trade-off is explicit cleanup as a separate operation, now handled by `GET/POST /api/projects/cleanup`.

## Mermaid diagrams
### C4 Level 1 (System Context)
```mermaid
C4Context
  title OpenClaw Studio - System Context
  Person(user, "User", "Operates agent canvas locally")
  System(ui, "OpenClaw Studio", "Next.js App Router UI")
  System_Ext(gateway, "OpenClaw Gateway", "WebSocket runtime")
  System_Ext(fs, "Local Filesystem", "projects.json, workspace files, openclaw.json")
  System_Ext(discord, "Discord API", "Optional channel provisioning")

  Rel(user, ui, "Uses")
  Rel(ui, gateway, "WebSocket frames")
  Rel(ui, fs, "HTTP to API routes -> fs read/write")
  Rel(ui, discord, "HTTP via API route")
```

### C4 Level 2 (Containers/Components)
```mermaid
C4Container
  title OpenClaw Studio - Containers
  Person(user, "User")

  Container_Boundary(app, "Next.js App") {
    Container(client, "Client UI", "React", "Canvas UI, state, gateway client")
    Container(api, "API Routes", "Next.js route handlers", "Projects, tiles, workspace, heartbeat, gateway config")
  }

  Container_Ext(gateway, "Gateway", "WebSocket", "Agent runtime")
  Container_Ext(fs, "Filesystem", "Local", "projects.json, workspace files, openclaw.json")
  Container_Ext(discord, "Discord API", "REST", "Channel provisioning")

  Rel(user, client, "Uses")
  Rel(client, api, "HTTP JSON")
  Rel(client, gateway, "WebSocket")
  Rel(api, fs, "Read/Write")
  Rel(api, discord, "REST")
```

## Explicit forbidden patterns
- Do not read/write local files directly from client components.
- Do not bypass `lib/projects/client` for API calls from UI.
- Do not introduce a new persistence layer without a clear migration path from `projects.json`.
- Do not store gateway tokens or secrets in client-side persistent storage.
- Do not add new global mutable state outside `AgentCanvasProvider` for canvas data.
- Do not silently swallow errors in API routes; always return actionable errors.
- Do not add heavy abstractions or frameworks unless there is clear evidence of need.

## Future-proofing notes
- If multi-user support becomes a goal, replace the JSON store with a DB-backed service and introduce authentication at the API boundary.
- If gateway protocol evolves, isolate changes within `src/lib/gateway` and keep UI call sites stable.
