# PI Chat Streaming

## Current transport model
PI/chat runtime streaming is server-owned control plane only.

- Browser subscribes to `GET /api/runtime/stream` (SSE).
- Studio server maintains the upstream gateway websocket.
- Browser never opens a direct gateway websocket.

## Event flow
1. User sends message via `POST /api/intents/chat-send`.
2. Server forwards intent through control-plane adapter (`chat.send`).
3. Gateway emits runtime events; adapter projects them to outbox.
4. `/api/runtime/stream` emits ordered `gateway.event` frames with monotonic outbox ids.
5. Browser ingests events through existing runtime/approval handlers.

## Replay and resume
- If client reconnects with `Last-Event-ID`, stream replays forward from that id.
- If client connects fresh (no `Last-Event-ID`), stream replays a recent tail window from outbox head.
- Live subscription and replay are sequenced to avoid replay/live gaps and duplicate terminal effects.

## History backfill
- `GET /api/runtime/agents/[agentId]/history?limit=<n>&beforeOutboxId=<id>`
- Returns newest window first and cursor metadata:
  - `hasMore`
  - `nextBeforeOutboxId`
- Browser applies history entries through the same event pipeline as live stream and dedupes outbox ids.

## Freshness/degraded behavior
- Runtime reads expose freshness metadata when gateway is unavailable.
- Projection-backed data can still render while writes fail fast with deterministic gateway-unavailable errors.
