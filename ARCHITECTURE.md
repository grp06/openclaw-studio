# Architecture

## Overview
OpenClaw Studio now uses a single runtime architecture:

1. Browser -> Studio domain APIs (`/api/runtime/*`, `/api/intents/*`)
2. Browser -> Studio SSE stream (`/api/runtime/stream`)
3. Studio server -> OpenClaw Gateway (server-owned WebSocket adapter)

The browser no longer opens a direct gateway transport and no `/api/gateway/ws` bridge exists in production runtime.

## Core boundaries

### Browser boundary
- UI state and orchestration live under `src/features/agents` and `src/app/page.tsx`.
- Browser reads and writes only through Studio HTTP routes and SSE.
- Runtime events are consumed from `/api/runtime/stream` and funneled through `gatewayRuntimeEventHandler` and approval ingress workflows.

### Server-owned control plane
- Control plane runtime modules: `src/lib/controlplane/*`
  - `openclaw-adapter.ts`: upstream websocket lifecycle, handshake, request allowlist, reconnect policy.
  - `runtime.ts`: process-local singleton runtime, subscription fanout, gateway call boundary.
  - `projection-store.ts`: SQLite projection + outbox (`runtime.db`).
- Runtime read routes:
  - `/api/runtime/summary`
  - `/api/runtime/fleet`
  - `/api/runtime/agents/[agentId]/history`
  - `/api/runtime/stream`
  - `/api/runtime/config`, `/api/runtime/models`, `/api/runtime/sessions`, `/api/runtime/chat-history`, `/api/runtime/cron`, `/api/runtime/skills/status`, `/api/runtime/agent-file`, `/api/runtime/agent-state`, `/api/runtime/media`
- Intent routes:
  - `/api/intents/chat-send`, `/api/intents/chat-abort`, `/api/intents/sessions-reset`
  - `/api/intents/agent-create`, `/api/intents/agent-rename`, `/api/intents/agent-delete`, `/api/intents/agent-wait`
  - `/api/intents/agent-permissions-update`, `/api/intents/exec-approval-resolve`, `/api/intents/exec-approvals-set`
  - `/api/intents/session-settings-sync`
  - `/api/intents/cron-add`, `/api/intents/cron-run`, `/api/intents/cron-remove`, `/api/intents/cron-remove-agent`, `/api/intents/cron-restore`
  - `/api/intents/skills-install`, `/api/intents/skills-update`, `/api/intents/skills-remove`, `/api/intents/agent-skills-allowlist`, `/api/intents/agent-file-set`

### Settings boundary
- Studio settings route: `src/app/api/studio/route.ts`
- Persisted file: `~/.openclaw/openclaw-studio/settings.json`
- Gateway token is server-custodied and redacted from API responses.
- Gateway URL/token changes trigger deterministic control-plane reconnect via `runtime.reconnectForGatewaySettingsChange()`.

## Runtime durability model
- SQLite DB path: `${resolveStateDir()}/openclaw-studio/runtime.db`
- Projection store responsibilities:
  - apply domain events idempotently
  - persist ordered outbox rows
  - serve replay/history windows
- SSE replay behavior:
  - With `Last-Event-ID`: replay forward from that id.
  - Without `Last-Event-ID`: replay recent tail window from outbox head.

## History model
- Route: `/api/runtime/agents/[agentId]/history`
- Query:
  - `limit`
  - `beforeOutboxId` (exclusive cursor)
- Response:
  - `entries`
  - `hasMore`
  - `nextBeforeOutboxId`
- Client side (`useRuntimeSyncController`) ingests fetched outbox rows into the same event pipeline as live SSE and dedupes by outbox id/time key.

## UI orchestration notes
- `src/app/page.tsx` remains top-level wiring:
  - settings load
  - fleet bootstrap
  - stream subscription
  - runtime sync polling/history load-more
  - mutation controller wiring
- `runtimeWriteTransport` is intent-route based for runtime mutations.
- Settings/skills/cron/personality flows use domain clients in `src/lib/controlplane/domain-runtime-client.ts`.

## Removed legacy surfaces
- Browser gateway WS transport and vendored browser gateway client are removed from production runtime.
- Server gateway WS proxy bridge (`server/gateway-proxy.js`) is removed.
- Legacy `/api/gateway/*` route namespace was re-homed to `/api/runtime/*` and `/api/intents/*`.

## Error semantics
- Gateway unavailable: deterministic `GATEWAY_UNAVAILABLE` shape from intent/runtime bootstrap helpers.
- Startup/read degradation: runtime read routes can return projection/probe-backed degraded responses with freshness metadata.
- Config/approvals conflict paths keep explicit conflict handling (base-hash retry where supported).

## Guardrails
- Do not reintroduce browser direct gateway transport.
- Do not add new `/api/gateway/*` routes.
- Keep gateway method allowlist explicit in `openclaw-adapter.ts`.
- Keep settings token redaction server-side.
- Keep migrations additive for `runtime.db`.
