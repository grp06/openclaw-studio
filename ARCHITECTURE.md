# Architecture

## High-level overview & goals
OpenClaw Studio is a gateway-first, single-user Next.js App Router UI for managing OpenClaw agents. It provides:
- A focused UI with fleet list, primary agent panel, and inspect sidebar.
- Local persistence for gateway connection + focused-view preferences via a JSON settings file.
- A same-origin WebSocket bridge (`/api/gateway/ws`) from browser to the upstream OpenClaw gateway.
- Gateway-backed edits for agent config and agent files.

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
- **Focused agent UI** (`src/features/agents`): focused agent panel, fleet sidebar, inspect panel, and local in-memory state + actions. The fleet sidebar keeps the same **New Agent** entry point, which now opens `AgentCreateModal` as a compact preset flow: preset bundle (with capability chips + risk label) -> control level override -> optional customization -> review. Creation compiles this intent into per-agent setup (files + per-agent overrides + per-agent exec approvals) and applies it with restart-safe orchestration in `src/app/page.tsx`, workflow policy in `src/features/agents/operations/guidedCreateWorkflow.ts`, and setup adapters in `src/features/agents/operations/createAgentOperation.ts`. Pending guided setups are persisted in tab-scoped session storage scoped by normalized gateway URL (helpers in `src/features/agents/creation/pendingGuidedSetupSessionStorageLifecycle.ts`) and surfaced in the focused chat area with `Retry setup` / `Discard pending setup`; reconnect flows perform a one-shot auto-retry when the target agent is present. Retry orchestration is centralized so reconnect auto-retry, manual retry, and restart-complete apply paths share one in-flight guard and avoid duplicate concurrent applies for the same agent. Agents render a status-first summary and latest-update preview driven by gateway events. Per-agent runtime controls (`model`, `thinking`) live in the chat header (`AgentChatPanel`), active runs can be stopped from the chat composer via `chat.abort`, and pending exec approvals render in-chat action cards (`Allow once`, `Always allow`, `Deny`) while fleet rows show `Needs approval`. Settings sidebar actions remain focused on rename, display toggles, new session, cron list/run/delete/create, and delete (`AgentSettingsPanel`). Cron creation continues to use a guided modal scoped to the selected settings agent. Gateway event classification (`presence`/`heartbeat` summary refresh and `chat`/`agent` runtime streams) is centralized in bridge helpers (`src/features/agents/state/runtimeEventBridge.ts`), while runtime flow decisions are emitted from pure policy helpers (`src/features/agents/state/runtimeEventPolicy.ts`) and executed by `src/features/agents/state/gatewayRuntimeEventHandler.ts`; both are consumed from one gateway subscription path in `src/app/page.tsx`, where exec approval events are handled in parallel. Higher-level orchestration is factored into operations under `src/features/agents/operations/` (fleet hydration snapshots in `agentFleetHydration.ts`, pure fleet hydration derivation in `agentFleetHydrationDerivation.ts`, chat send in `chatSendOperation.ts`, cron create in `cronCreateOperation.ts`, guided create/retry policy in `guidedCreateWorkflow.ts`, setup adapters in `createAgentOperation.ts`, config mutation policy in `configMutationWorkflow.ts`, mutation lifecycle controller policy in `agentMutationLifecycleController.ts`, pending setup lifecycle policy in `pendingSetupLifecycleWorkflow.ts`, pending guided setup retry operation in `pendingGuidedSetupRetryOperation.ts`, pending guided setup auto-retry operation in `pendingGuidedSetupAutoRetryOperation.ts`, latest-update policy in `latestUpdateWorkflow.ts`, fleet summary/reconcile policy in `fleetLifecycleWorkflow.ts`, reconcile operation adapter in `agentReconcileOperation.ts`, history request/disposition policy in `historyLifecycleWorkflow.ts`, history sync operation adapter in `historySyncOperation.ts`, approval lifecycle policy in `src/features/agents/approvals/execApprovalLifecycleWorkflow.ts`, manual exec approval resolve operation in `src/features/agents/approvals/execApprovalResolveOperation.ts`, and execution primitives in `useConfigMutationQueue.ts` and `useGatewayRestartBlock.ts`). Rename/delete post-run UI side effects are emitted as typed mutation commands from `agentMutationLifecycleController.ts` and executed in `src/app/page.tsx`. Session setting mutations (model/thinking) are centralized in `src/features/agents/state/sessionSettingsMutations.ts` so optimistic state updates and sync/error behavior stay aligned. Transcript ownership is split intentionally: optimistic send appends local user transcript entries while canonical timestamps and final ordering come from `chat.history` sync via the history workflow boundary (`historyLifecycleWorkflow.ts`) and operation adapter (`historySyncOperation.ts`); replayed terminal chat events and late deltas from recently closed runs are ignored in `gatewayRuntimeEventHandler`, which requests recovery history only through the `requestHistoryRefresh` boundary command. Studio fetches a capped amount of chat history by default (currently 200 messages) and exposes a “Load more” affordance when the transcript may be truncated. Disconnected startup now uses a status-first `GatewayConnectScreen` with a local command copy affordance and a collapsible remote form.
- **Studio settings** (`src/lib/studio`, `src/app/api/studio`): local settings store for gateway URL/token and focused preferences (`src/lib/studio/settings.ts`, `src/app/api/studio/route.ts`). `src/lib/studio/coordinator.ts` now owns both the `/api/studio` transport helpers and shared client-side load/patch scheduling for gateway and focused settings.
- **Gateway** (`src/lib/gateway`): WebSocket client for agent runtime (frames, connect, request/response). Session settings sync transport (`sessions.patch`) is centralized in `src/lib/gateway/GatewayClient.ts`. Connect failures from the Studio WS proxy are preserved as `GatewayResponseError` codes (parsed from `connect failed: <CODE> ...`) so `useGatewayConnection` can gate auto-retry via `resolveGatewayAutoRetryDelayMs`. The OpenClaw control UI client is vendored in `src/lib/gateway/openclaw/GatewayBrowserClient.ts` with a sync script at `scripts/sync-openclaw-gateway-client.ts`.
- **Studio gateway proxy server** (`server/index.js`, `server/gateway-proxy.js`, `server/studio-settings.js`): custom Next server that terminates browser WS at `/api/gateway/ws`, loads upstream gateway URL/token server-side, injects auth token when needed, and forwards frames to the upstream gateway.
- **Gateway SSH helpers** (`src/lib/ssh/gateway-host.ts`): shared SSH target resolution and JSON-over-SSH execution for server routes. `runSshJson` centralizes `ssh -o BatchMode=yes` invocation, JSON parsing, and actionable error extraction; callers with large payloads (for example base64 media reads) can opt into a higher `maxBuffer` rather than duplicating `spawnSync` calls.
- **Gateway-backed config + agent-file edits** (`src/lib/gateway/agentConfig.ts`, `src/lib/gateway/agentFiles.ts`, `src/lib/gateway/execApprovals.ts`, `src/features/agents/components/AgentInspectPanels.tsx`): agent create/rename/heartbeat/delete and per-agent overrides via `config.get` + `config.patch`, agent file read/write via `agents.files.get` and `agents.files.set`, and per-agent exec approvals via `exec.approvals.get` + `exec.approvals.set`.
- **Heartbeat helpers** (`src/lib/gateway/agentConfig.ts`): resolves per-agent heartbeat state (enabled + schedule) by combining gateway config (`config.get`) and status (`status`) for the settings panel, triggers `wake` for “run now”, and owns the heartbeat type shapes and gateway config mutation helpers.
- **Session lifecycle actions** (`src/features/agents/state/store.tsx`, `src/app/page.tsx`): per-agent “New session” calls gateway `sessions.reset` on the current session key and resets local runtime transcript state.
- **Local OpenClaw config + paths** (`src/lib/clawdbot`): state/config path resolution with `OPENCLAW_*` env overrides (`src/lib/clawdbot/paths.ts`). Gateway URL/token in Studio are sourced from studio settings.
- **Shared agent config-list helpers** (`src/lib/gateway/agentConfig.ts`): pure `agents.list` read/write/upsert helpers used by gateway config patching to keep list-shape semantics aligned.
- **Shared utilities** (`src/lib/*`): env, ids, names, avatars, message parsing/normalization (including tool-line formatting) in `src/lib/text/message-extract.ts`, cron types + selector helpers + gateway call helpers in `src/lib/cron/types.ts`, logging, filesystem helpers.

## Directory layout (top-level)
- `src/app`: Next.js App Router pages, layouts, global styles, and API routes.
- `src/features`: feature-first UI modules (currently focused agent-management components under `features/agents`).
- `src/lib`: domain utilities, adapters, API clients, and shared logic.
- `src/components`: shared UI components (minimal use today).
- `src/styles`: shared styling assets.
- `server`: custom Node server and WS proxy for gateway bridging + access gate.
- `public`: static assets.
- `tests`, `playwright.config.ts`, `vitest.config.ts`: automated testing.

## Data flow & key boundaries
### 1) Studio settings + focused preferences
- **Source of truth**: JSON settings file at `~/.openclaw/openclaw-studio/settings.json` (resolved via `resolveStateDir`, with legacy fallbacks in `src/lib/clawdbot/paths.ts`). Settings store the gateway URL/token plus per-gateway focused preferences.
- **Server boundary**: `src/app/api/studio/route.ts` loads/saves settings by reading and writing `openclaw-studio/settings.json` under the resolved state dir.
- **Client boundary**: `useGatewayConnection` and focused/session flows in `src/app/page.tsx` use a shared `StudioSettingsCoordinator` to load settings and coalesce debounced `/api/studio` patch writes.

Flow:
1. UI loads settings from `/api/studio`.
2. Gateway URL/token seed the connection panel and auto-connect.
3. Focused filter + selected agent are loaded for the current gateway.
4. UI schedules focused and gateway patches through the coordinator; both paths converge on `/api/studio`.

### 2) Agent runtime (gateway)
- **Client-side boundary**: `GatewayClient` connects to Studio-origin `/api/gateway/ws` via `resolveStudioProxyGatewayUrl()` and wraps the vendored `GatewayBrowserClient`.
- **Server-side boundary**: custom server proxy (`server/gateway-proxy.js`) is in the middle for upstream URL/token resolution and connect-frame token injection.

Flow:
1. UI loads gateway URL/token from `/api/studio` (defaulting to `NEXT_PUBLIC_GATEWAY_URL`, or `ws://localhost:18789` when that env var is unset).
2. Browser opens WS to Studio `/api/gateway/ws` (`ws://` on `http`, `wss://` on `https`).
3. Proxy loads upstream URL/token from Studio settings on the server and opens upstream WS.
4. Proxy forwards `connect` and subsequent frames; it injects auth token server-side if the connect frame has none.
5. If upstream connect fails, the proxy closes the Studio-origin WS with a `connect failed: <CODE> ...` reason; `GatewayClient.connect()` parses this into `GatewayResponseError`, and `useGatewayConnection` decides whether/when to auto-retry based on `connectErrorCode` (through `resolveGatewayAutoRetryDelayMs`).
6. UI requests `agents.list` and builds session keys via `buildAgentMainSessionKey(agentId, mainKey)`.
7. A single gateway listener in `src/app/page.tsx` classifies `presence`/`heartbeat`/`chat`/`agent` events through `classifyGatewayEventKind` in `src/features/agents/state/runtimeEventBridge.ts`, then routes runtime payloads through `src/features/agents/state/runtimeEventPolicy.ts` and executes intents via `src/features/agents/state/gatewayRuntimeEventHandler.ts`; it also independently tracks `exec.approval.requested` / `exec.approval.resolved` for in-chat approval cards.
8. Agent store updates agent output/state.
9. Pending approval queues are pruned by expiry timestamp (with a short grace window), so stale cards and stale `awaitingUserInput` badges self-clear even when no resolved event arrives.

### 3) Agent create + per-agent setup
- **Agent files**: `AGENTS.md`, `SOUL.md`, `IDENTITY.md`, `USER.md`, `TOOLS.md`, `HEARTBEAT.md`, `MEMORY.md`.
- **Create + heartbeat + rename + guided per-agent overrides**: stored in gateway config and updated via `config.get` + `config.patch`.
- **Exec approvals policy**: stored in exec approvals file and updated via `exec.approvals.get` + `exec.approvals.set`.

Flow:
1. `AgentCreateModal` captures preset-bundle selection, optional control-level override, and customization input (`src/features/agents/components/AgentCreateModal.tsx`).
2. Creation input is compiled into concrete artifacts (`src/features/agents/creation/compiler.ts`): agent files, per-agent overrides, and per-agent exec approvals policy. Tool additions use additive `tools.alsoAllow` semantics so selected profile defaults remain available.
3. Local gateways apply setup immediately after `agents.create`; remote gateways persist a pending setup payload and apply it after restart in `useGatewayRestartBlock`.
4. If setup apply fails after agent creation, Studio keeps the created agent, preserves pending setup state in gateway-scoped session storage, shows retry/discard controls in chat, and retries once automatically after reconnect when the agent exists.
5. Retry apply paths (manual retry, reconnect auto-retry, restart-complete apply) share one in-flight guard to prevent duplicate concurrent setup writes per agent.
6. Agent file writes call `agents.files.set` through `writeGatewayAgentFiles` (`src/lib/gateway/agentFiles.ts`), and per-agent approvals policy writes call `upsertGatewayAgentExecApprovals` (`src/lib/gateway/execApprovals.ts`).
7. UI reflects persisted state returned by the gateway.

### 4) Cron summaries + settings controls
- **Cron**: the UI calls gateway cron methods directly (`cron.list`, `cron.add`, `cron.run`, `cron.remove`) for latest-update previews and agent settings controls.
- **Create flow**: `AgentSettingsPanel` collects a `CronCreateDraft` in a modal wizard, `buildCronJobCreateInput` maps it to a gateway-safe payload (`src/lib/cron/createPayloadBuilder.ts`), and `performCronCreateFlow` executes create + scoped refresh (`src/features/agents/operations/cronCreateOperation.ts`).

### 5) Session settings synchronization
- **UI boundary**: `AgentChatPanel` emits model/thinking callbacks from the agent header; `src/app/page.tsx` delegates both through one mutation helper.
- **Mutation boundary**: `applySessionSettingMutation` in `src/features/agents/state/sessionSettingsMutations.ts` owns optimistic store updates, `sessionCreated` guard logic, sync success updates, and user-facing failure lines.
- **Transport boundary**: `syncGatewaySessionSettings` in `src/lib/gateway/GatewayClient.ts` is the only client-side builder/invoker for `sessions.patch` payloads.

## Cross-cutting concerns
- **Configuration**: environment variables are read directly from `process.env`. The browser uses `NEXT_PUBLIC_GATEWAY_URL` only as a default upstream URL when Studio settings are missing; the Studio server persists upstream URL/token in `<state dir>/openclaw-studio/settings.json` and the WS proxy loads them via `server/studio-settings.js`. State/config path resolution lives in `lib/clawdbot/paths.ts`, honoring `OPENCLAW_STATE_DIR`/`OPENCLAW_CONFIG_PATH` with legacy fallbacks. When Studio token is missing, settings loaders can fall back to token/port from `<state dir>/openclaw.json`. Loopback-IP gateway URLs are normalized to `localhost` in Studio settings, and the WS proxy rewrites loopback upstream origins to `localhost` for control-UI secure-context compatibility. The optional Studio access gate is enabled by `STUDIO_ACCESS_TOKEN` (`server/access-gate.js`).
- **Testing**: Playwright e2e runs Studio with an isolated `OPENCLAW_STATE_DIR` so the Studio WS proxy does not read real upstream gateway settings from the developer machine.
- **Logging**: API routes and the gateway client use built-in `console.*` logging.
- **Error handling**:
  - API routes return JSON `{ error }` with appropriate status.
  - `fetchJson` throws when `!res.ok`, surfaces errors to UI state.
  - `StudioSettingsCoordinator` logs failed async persistence writes (debounced flush or queued patch failures) so settings-save errors are observable.
  - Gateway connect failures with `INVALID_REQUEST: invalid config` surface a doctor hint in Studio (`npx openclaw doctor --fix` / `pnpm openclaw doctor --fix`).
  - Gateway connect failures that close with `connect failed: <CODE> ...` are preserved as `GatewayResponseError` codes so auto-retry gating can be code-driven (instead of message-driven).
  - Gateway browser client truncates close reasons to WebSocket protocol limits (123 UTF-8 bytes) to avoid client-side close exceptions on long error messages.
- **Filesystem helpers**: server-only filesystem operations live at the API route boundaries. Home-scoped path autocomplete is implemented directly in `src/app/api/path-suggestions/route.ts`. These helpers are used for local settings and path suggestions, not for agent file edits.
- **Remote gateway tools over SSH**: some server routes execute small scripts on the gateway host (for example agent-state operations and remote media reads). Shared helpers in `src/lib/ssh/gateway-host.ts` own SSH invocation and JSON parsing so routes do not hand-roll `spawnSync` error handling.
- **Tracing**: `src/instrumentation.ts` registers `@vercel/otel` for telemetry.
- **Validation**: request payload validation in API routes and typed client/server helpers in `src/lib/*`.

## Major design decisions & trade-offs
- **Local settings file over DB**: fast, local-first persistence for gateway connection + focused preferences; trade-off is no concurrency or multi-user support.
- **Same-origin WS proxy instead of direct browser->gateway WS**: allows server-side token custody/injection and easier local/remote switching; trade-off is one extra hop and custom-server ownership.
- **Gateway-first agent records**: records map 1:1 to `agents.list` entries with main sessions; trade-off is no local-only agent concept.
- **Gateway-backed config + agent-file edits**: create/rename/heartbeat/delete and per-agent overrides via `config.patch`, agent files via `agents.files.get`/`agents.files.set`, and per-agent exec approvals via `exec.approvals.set`; trade-off is reliance on gateway availability.
- **Fleet hydration snapshot/derive split**: `hydrateAgentFleetFromGateway` loads gateway/settings snapshots (I/O) and delegates all derived decisions (seeds, exec policy resolution, summary selection) to a pure derivation helper; trade-off is one extra module and a more explicit snapshot input, but the derivation becomes independently testable.
- **Extract page-level workflows into operations**: keep `src/app/page.tsx` as wiring by moving workflow policy into operation modules (for example reconcile in `src/features/agents/operations/agentReconcileOperation.ts` and manual exec approval resolve in `src/features/agents/approvals/execApprovalResolveOperation.ts`); trade-off is more modules, but the workflows become independently unit testable without React rendering.
- **Structured connect errors + retry policy helper**: `GatewayClient.connect()` preserves gateway connect-failure codes and `useGatewayConnection` gates auto-retry via `resolveGatewayAutoRetryDelayMs`; trade-off is one more helper plus extra state (`connectErrorCode`), but the behavior is less brittle than string matching.
- **Narrow local config mutation boundary**: Studio does not write `openclaw.json` directly today; if a local-only integration is introduced, keep any local writes narrowly scoped to that integration and reuse shared list helpers instead of ad-hoc mutation paths; trade-off is less flexibility for local-only experimentation, but clearer ownership and lower drift risk.
- **Shared `agents.list` helper layer**: gateway and local config paths now consume one pure helper module for list parsing/writing/upsert behavior; trade-off is one more shared dependency, but it reduces semantic drift and duplicate bug surface.
- **Single gateway settings endpoint**: `/api/studio` is the sole Studio gateway URL/token source; trade-off is migration pressure on any older local-config-based callers, but it removes ambiguous ownership and dead paths.
- **Shared client settings coordinator module**: `src/lib/studio/coordinator.ts` now owns `/api/studio` transport plus load/schedule/flush behavior for gateway + focused state; trade-off is introducing a central client singleton, but it removes wrapper indirection and duplicate timers/fetch paths.
- **Single shared JSON-over-SSH helper**: server routes that need to run a gateway-side script over SSH should use `runSshJson` in `src/lib/ssh/gateway-host.ts` (and opt into a larger `maxBuffer` when expecting large payloads) rather than duplicating `spawnSync` + JSON parsing; trade-off is one shared dependency, but it reduces drift risk and keeps error surfacing consistent.
- **Vendored gateway client + sync script**: reduces drift from upstream OpenClaw UI; trade-off is maintaining a sync path and local copies of upstream helpers.
- **Feature-first organization**: increases cohesion in UI; trade-off is more discipline to keep shared logic in `lib`.
- **Node runtime for API routes**: required for filesystem access and tool proxying; trade-off is Node-only server runtime.
- **Event-driven summaries + on-demand history**: keeps the dashboard lightweight; trade-off is history not being available until requested.
- **Runtime policy/executor split for event handling**: one listener path in `src/app/page.tsx` classifies frames through `src/features/agents/state/runtimeEventBridge.ts`, derives side-effect-free decisions in `src/features/agents/state/runtimeEventPolicy.ts`, and executes those intents in `src/features/agents/state/gatewayRuntimeEventHandler.ts`; trade-off is additional intent-shape maintenance, but lower coupling between lifecycle policy and side effects.
- **Single gateway event intake subscription**: one `client.onEvent` path now handles both summary-refresh events (`presence`/`heartbeat`) and runtime stream events (`chat`/`agent`) using bridge classification helpers; trade-off is a larger callback surface, but fewer lifecycle and cleanup divergence points.
- **Shared session-setting mutation path**: model and thinking-level updates now pass through one UI mutation helper plus one gateway sync helper (`src/features/agents/state/sessionSettingsMutations.ts` + `src/lib/gateway/GatewayClient.ts`), reducing divergence between optimistic state and remote patch flows.

## Mermaid diagrams
### C4 Level 1 (System Context)
```mermaid
C4Context
  title OpenClaw Studio - System Context
  Person(user, "User", "Operates agents locally")
  System(ui, "OpenClaw Studio", "Next.js App Router UI")
  System(proxy, "Studio WS Proxy", "Custom server /api/gateway/ws")
  System_Ext(gateway, "OpenClaw Gateway", "WebSocket runtime")
  System_Ext(fs, "Local Filesystem", "settings.json and other local reads (e.g. path suggestions)")

  Rel(user, ui, "Uses")
  Rel(ui, proxy, "WebSocket frames")
  Rel(proxy, gateway, "WebSocket frames")
  Rel(ui, fs, "HTTP to API routes -> fs read/write")
```

### C4 Level 2 (Containers/Components)
```mermaid
C4Container
  title OpenClaw Studio - Containers
  Person(user, "User")

  Container_Boundary(app, "Next.js App") {
    Container(client, "Client UI", "React", "Focused agent-management UI, state, gateway client")
    Container(api, "API Routes", "Next.js route handlers", "Studio settings, path suggestions, gateway-host state tools")
    Container(proxy, "WS Proxy", "Custom Node server", "Bridges /api/gateway/ws to upstream gateway with token injection")
  }

  Container_Ext(gateway, "Gateway", "WebSocket", "Agent runtime")
  Container_Ext(fs, "Filesystem", "Local", "settings.json and other local reads (e.g. path suggestions)")

  Rel(user, client, "Uses")
  Rel(client, api, "HTTP JSON")
  Rel(client, proxy, "WebSocket /api/gateway/ws")
  Rel(proxy, gateway, "WebSocket")
  Rel(api, fs, "Read/Write")
  Rel(proxy, fs, "Read settings/token")
```

## Explicit forbidden patterns
- Do not read/write local files directly from client components.
- Do not reintroduce local projects/workspaces as a source of truth for agent records.
- Do not write agent rename/heartbeat/override data directly to `openclaw.json`; use gateway `config.patch`.
- Do not read/write agent files on the local filesystem; use the gateway tools proxy.
- Do not add parallel gateway settings endpoints; `/api/studio` is the only supported Studio gateway URL/token path.
- Do not add new generic local `openclaw.json` mutation wrappers for runtime agent-management flows; if a local-only integration is introduced, keep any local writes narrowly scoped and well tested.
- Do not store gateway tokens or secrets in client-side persistent storage.
- Do not add new global mutable state outside `AgentStoreProvider` for agent UI data.
- Do not silently swallow errors in API routes; always return actionable errors.
- Do not add heavy abstractions or frameworks unless there is clear evidence of need.

## Future-proofing notes
- If multi-user support becomes a goal, replace the settings file with a DB-backed service and introduce authentication at the API boundary.
- If gateway protocol evolves, isolate changes within `src/lib/gateway` and keep UI call sites stable.
