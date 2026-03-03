# Control Plane Cutover Audit

Date: 2026-03-02
Status: fresh-eyes first-principles inventory (pass 2)

## Objective

Identify every remaining legacy path where browser code is still coupled to gateway protocol or gateway transport semantics, so we can remove those connections in one final cutover.

## First-Principles Boundary

Target boundary:
- Browser: Studio domain APIs only (`/api/runtime/*`, `/api/intents/*`, SSE stream).
- Server: sole owner of upstream OpenClaw gateway WebSocket and method contracts.

A path is legacy if any browser-executed module does one of:
1. opens (or auto-opens) gateway transport (`/api/gateway/ws`), or
2. issues gateway RPC semantics (`client.call("...")`), directly or through gateway helper wrappers.

## Re-scan Method

Commands used:

```bash
rg -n "GatewayClient|GatewayBrowserClient|useGatewayConnection|resolveStudioProxyGatewayUrl|/api/gateway/ws" src server scripts docs README.md ARCHITECTURE.md tests
rg -n "client\.call\(" src --glob '!**/*.test.*'
rg -n "new WebSocket\(|WebSocket\(" src server --glob '!**/*.test.*'
rg -n "/api/gateway/" src --glob '!**/*.test.*'
```

Current measured footprint:
- `29` non-test `src` files import from `@/lib/gateway/GatewayClient`.
- `23` non-test `client.call(...)` call-sites remain in `src`.
- `8` non-test files currently contain direct `client.call(...)` executions.
- `41` test files still reference legacy gateway client/proxy surfaces.

## A) Hard Blockers: Browser Transport Still Exists

These files keep the browser->gateway WS architecture alive:

- `src/app/page.tsx:230`
  - App root still calls `useGatewayConnection(...)`.
- `src/lib/gateway/GatewayClient.ts:573`
  - `connect(...)` uses `resolveStudioProxyGatewayUrl()`.
- `src/lib/gateway/GatewayClient.ts:590-596`
  - auto-connect effect still runs after settings load.
- `src/lib/gateway/proxy-url.ts:1-5`
  - browser WS URL builder for `/api/gateway/ws`.
- `src/lib/gateway/openclaw/GatewayBrowserClient.ts:421`
  - browser `new WebSocket(...)`.
- `server/index.js:55-66`
  - `/api/gateway/ws` upgrade wiring.
- `server/gateway-proxy.js:88-293`
  - bridge from browser WS to upstream gateway WS.

Important drift from architecture intent:
- `useGatewayConnection` currently has no domain-mode suppression guard around auto-connect/retry paths; `domainApiModeEnabled` is loaded and returned, but not used to prevent transport startup in this file.

## B) Active Browser Gateway RPC Paths (Not Just Types)

### 1) Settings: config/models via browser RPC

- `src/features/agents/operations/useGatewayConfigSyncController.ts:68` `config.get`
- `src/features/agents/operations/useGatewayConfigSyncController.ts:138` `config.get`
- `src/features/agents/operations/useGatewayConfigSyncController.ts:149-151` `models.list`

### 2) Settings: skills + cron via browser RPC helpers

- `src/features/agents/operations/useAgentSettingsMutationController.ts:163` `skills.status`
- `src/features/agents/operations/useAgentSettingsMutationController.ts:232` `cron.list`
- `src/features/agents/operations/useAgentSettingsMutationController.ts:531` `cron.run`
- `src/features/agents/operations/useAgentSettingsMutationController.ts:562` `cron.remove`
- `src/features/agents/operations/useAgentSettingsMutationController.ts:730-734` skills allowlist write
- `src/features/agents/operations/useAgentSettingsMutationController.ts:776-779` skills allowlist read
- `src/features/agents/operations/useAgentSettingsMutationController.ts:817-822` skills allowlist write
- `src/features/agents/operations/useAgentSettingsMutationController.ts:913-917` `skills.install`
- `src/features/agents/operations/useAgentSettingsMutationController.ts:1003-1006` `skills.update`
- `src/features/agents/operations/useAgentSettingsMutationController.ts:1026-1029` `skills.update`

### 3) Personality files via browser RPC

- `src/features/agents/components/AgentInspectPanels.tsx:1251` `readGatewayAgentFile(...)`
- `src/features/agents/components/AgentInspectPanels.tsx:1293` `writeGatewayAgentFile(...)`
- `src/lib/gateway/agentFiles.ts:22` `agents.files.get`
- `src/lib/gateway/agentFiles.ts:41` `agents.files.set`

### 4) Latest-update enrichment via browser RPC

- `src/app/page.tsx:456-457` wires `client.call(...)` and cron list helper into latest-update op.
- `src/features/agents/operations/specialLatestUpdateOperation.ts:88-93` `sessions.list`
- `src/features/agents/operations/specialLatestUpdateOperation.ts:108-111` `chat.history`

## C) Legacy Fallback Branches Still Present in Runtime Paths

These are mode-gated but keep legacy behavior implemented and reachable:

- `src/features/agents/operations/runtimeWriteTransport.ts:97-271`
  - fallback `client.call(...)` branches for `chat.send`, `chat.abort`, `sessions.reset`, `exec.approval.resolve`, `agent.wait`, plus legacy create/rename/delete helpers.
- `src/features/agents/operations/studioBootstrapOperation.ts:48-55`
  - non-domain fleet hydration via gateway.
- `src/features/agents/operations/agentFleetHydration.ts:78-153`
  - gateway reads: `config.get`, `exec.approvals.get`, `agents.list`, `sessions.list`, `status`, `sessions.preview`.
- `src/features/agents/operations/useRuntimeSyncController.ts:133-343`
  - non-domain summary/history/reconcile/gap handling via gateway RPC.
- `src/features/agents/operations/agentPermissionsOperation.ts:207-323`
  - legacy config/session/approvals mutation path.

## D) Gateway-Coupled Shared Modules That Must Go in Final Cutover

These wrappers encode gateway methods and keep browser feature code coupled:

- `src/lib/gateway/agentConfig.ts`
  - `config.get`, `config.patch`, `config.set`, `agents.create`, `agents.update`, `agents.delete`, `status`.
- `src/lib/gateway/execApprovals.ts`
  - `exec.approvals.get`, `exec.approvals.set`.
- `src/lib/gateway/agentFiles.ts`
  - `agents.files.get`, `agents.files.set`.
- `src/lib/gateway/gatewayReloadMode.ts`
  - legacy config writes.
- `src/lib/cron/types.ts`
  - `cron.list`, `cron.add`, `cron.run`, `cron.remove`.
- `src/lib/skills/types.ts`
  - `skills.status`, `skills.install`, `skills.update`.

## E) Legacy Namespace Routes (Not WS, but Cleanup Targets)

These are server routes but still under legacy `/api/gateway/*` naming and browser callers:

- Callers:
  - `src/lib/text/media-markdown.ts:17` -> `/api/gateway/media`
  - `src/features/agents/operations/deleteAgentOperation.ts:140,151` -> `/api/gateway/agent-state`
  - `src/lib/skills/remove.ts:23` -> `/api/gateway/skills/remove`
- Routes:
  - `src/app/api/gateway/media/route.ts`
  - `src/app/api/gateway/agent-state/route.ts`
  - `src/app/api/gateway/skills/remove/route.ts`

Note:
- These are not direct browser WS transport, but they should be renamed/re-homed during final legacy cleanup.

## F) Documentation + Test Drag

### Docs still describing legacy browser gateway mode

- `README.md:86`
- `ARCHITECTURE.md` (multiple sections describing `/api/gateway/ws` and `GatewayClient` as active architecture)
- `docs/pi-chat-streaming.md` (legacy browser gateway transport narrative)
- `docs/permissions-sandboxing.md` (GatewayClient references)

### Tests tied to legacy stack

`41` test files currently reference `GatewayClient`, `GatewayBrowserClient`, `/api/gateway/ws`, or `/api/gateway/*` routes.

Representative sets:
- transport/proxy: `tests/unit/gatewayProxy.test.ts`, `tests/unit/gatewayBrowserClient.test.ts`, `tests/unit/useGatewayConnection.test.ts`
- gateway wrappers: `tests/unit/gatewayAgentOverrides.test.ts`, `tests/unit/gatewayExecApprovals.test.ts`, `tests/unit/cronGatewayClient.test.ts`, `tests/unit/skillsGatewayClient.test.ts`
- legacy routes: `tests/unit/gatewayMediaRoute.test.ts`, `tests/unit/agentStateRoute.test.ts`, `tests/unit/skillsRemoveRoute.test.ts`

## Complete Removal Checklist (File Groups)

### 1) Remove browser transport stack
- `src/lib/gateway/GatewayClient.ts`
- `src/lib/gateway/openclaw/GatewayBrowserClient.ts`
- `src/lib/gateway/proxy-url.ts`
- `server/gateway-proxy.js`
- `/api/gateway/ws` wiring in `server/index.js`

### 2) Replace active browser RPC UI surfaces
- `src/features/agents/operations/useGatewayConfigSyncController.ts`
- `src/features/agents/operations/useAgentSettingsMutationController.ts`
- `src/features/agents/components/AgentInspectPanels.tsx`
- `src/features/agents/operations/specialLatestUpdateOperation.ts`
- `src/app/page.tsx` (latest-update gateway wiring + connection hook dependency)

### 3) Remove fallback legacy branches
- `src/features/agents/operations/runtimeWriteTransport.ts`
- `src/features/agents/operations/studioBootstrapOperation.ts`
- `src/features/agents/operations/agentFleetHydration.ts`
- `src/features/agents/operations/useRuntimeSyncController.ts`
- `src/features/agents/operations/agentPermissionsOperation.ts`

### 4) Remove gateway method wrapper modules
- `src/lib/gateway/agentConfig.ts`
- `src/lib/gateway/agentFiles.ts`
- `src/lib/gateway/execApprovals.ts`
- `src/lib/gateway/gatewayReloadMode.ts`
- `src/lib/cron/types.ts` (legacy RPC portions)
- `src/lib/skills/types.ts` (legacy RPC portions)

### 5) Re-home `/api/gateway/*` route namespace
- `src/app/api/gateway/media/route.ts`
- `src/app/api/gateway/agent-state/route.ts`
- `src/app/api/gateway/skills/remove/route.ts`
- update callers in `src/lib/text/media-markdown.ts`, `src/features/agents/operations/deleteAgentOperation.ts`, `src/lib/skills/remove.ts`

## Exit Criteria (Migration Actually Complete)

1. No browser module imports or uses `useGatewayConnection` / `GatewayClient` / `GatewayBrowserClient`.
2. No browser runtime path executes `client.call(...)` for gateway methods.
3. `server/index.js` no longer handles `/api/gateway/ws` upgrades.
4. `server/gateway-proxy.js` is deleted.
5. `/api/gateway/*` routes are removed or fully re-homed.
6. Docs and tests no longer describe legacy browser-gateway mode as a supported operational path.
