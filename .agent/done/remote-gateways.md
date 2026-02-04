# Workspace Overhaul (Gateway-First Studio)

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

The repo’s ExecPlan rules live at `.agent/PLANS.md` and this plan must be maintained in accordance with that file.

## Purpose / Big Picture

After this change, OpenClaw Studio will boot, connect to a local or remote OpenClaw Gateway, and immediately render one tile per configured agent without requiring any project or workspace setup. The connection settings (gateway URL + token) and the canvas layout will persist locally. Each tile sends messages to the agent’s main session by default, preserving that agent’s workspace memory, while still allowing manual session resets. The UI will let users rename agents and edit standard workspace files (AGENTS.md, SOUL.md, IDENTITY.md, USER.md, TOOLS.md, HEARTBEAT.md, MEMORY.md) through the gateway, so remote gateways are fully supported.

## Progress

- [x] (2026-02-02 23:12Z) Create studio settings store and persist gateway connection + per-gateway layout; add tests. [bd-xaz]
- [x] (2026-02-03 16:05Z) Replace projects/workspaces with gateway agent tiles, update canvas store + UI, and adjust tests. [bd-17p]
- [x] (2026-02-03 16:05Z) Switch agent rename/heartbeat/workspace files to gateway-backed operations; remove obsolete project APIs; update tests. [bd-nds]

## Surprises & Discoveries

No discoveries yet.

## Decision Log

- Decision: Use gateway `config.get` + `config.patch` to rename agents and edit heartbeat settings instead of writing local `openclaw.json` directly.
  Rationale: This keeps remote gateways first-class and uses the gateway as the source of truth.
  Date/Author: 2026-02-02 / Codex

- Decision: Read/write workspace files via the gateway HTTP `/tools/invoke` endpoint using `read`/`write` tools with workspace-relative paths.
  Rationale: It avoids model turns, works for remote gateways, and respects tool policy.
  Date/Author: 2026-02-02 / Codex

- Decision: Persist canvas layout per gateway URL in a local Studio settings file rather than in project stores.
  Rationale: Layout should follow the gateway’s agent set and remain local to the UI client.
  Date/Author: 2026-02-02 / Codex

## Outcomes & Retrospective

Not started yet.

## Context and Orientation

OpenClaw Studio is a Next.js App Router UI that currently stores “projects” and “tiles” in a local JSON store. Each tile is tied to a session key under a synthetic `agent:<id>:studio:<tileId>` namespace and can read workspace files from a local filesystem path. This architecture blocks remote gateway usage and forces local workspace management.

Key files and current responsibilities:

`src/app/page.tsx` orchestrates the canvas page, wires the gateway WebSocket client, and maps events to tiles. It currently assumes a single active project and reads `workspacePath` from a local store.

`src/features/canvas/state/store.tsx` is the canvas state store and reducer. It loads projects via `src/lib/projects/client.ts` and persists them via `src/app/api/projects/*` routes.

`src/lib/projects/*` contains project types, session key helpers, workspace file helpers, and client APIs.

`src/app/api/projects/*` and `src/app/api/workspace` perform filesystem and config writes on the local machine.

`src/lib/clawdbot/config.ts` reads and writes `openclaw.json` directly from disk, which is invalid for remote gateways.

For this overhaul, “Gateway” means the OpenClaw gateway process that owns the agents, sessions, and configuration. An “agent” is a gateway-configured assistant identified by a stable `agentId`. A “session key” is the gateway’s identifier for a chat history, typically `agent:<agentId>:<mainKey>` for the main direct chat session.

## Plan of Work

Start by introducing a new local Studio settings store that persists gateway URL/token and per-gateway layout. This store replaces the current projects store and becomes the only local persistence. Update the gateway connection hook and ConnectionPanel to load and save these settings, and add unit tests that verify normalization and URL conversion.

Next, remove project/workspace concepts from the canvas store and replace them with agent tiles derived from `agents.list`. Compute the main session key for each agent using the `mainKey` returned by `agents.list`, and keep layout overrides from the settings store. Update the canvas UI, header, and tile actions to operate on agents only, remove workspace settings UI, and adjust or delete tests that assume projects.

Finally, replace local config and filesystem calls with gateway-backed operations. Use `config.get` + `config.patch` to rename agents and update heartbeat overrides, and add a server-side proxy that calls the gateway’s `/tools/invoke` endpoint so workspace files can be read and written with the `read` and `write` tools. Update the inspect panel to use the new endpoints, remove obsolete project APIs, and adjust tests to cover the new gateway-backed helpers.

## Concrete Steps

Work in the repo root at `/Users/georgepickett/openclaw-studio`.

Before each milestone, pick the next Beads issue with:

    br ready --json

Update the issue status with `br update <id> --status in_progress` once you begin. After tests pass, close it with `br close <id> --reason "Tests pass, committed"` and run `br sync --flush-only` before committing.

Use `pnpm test` to run the unit suite. When running a smaller subset, use `pnpm test -- <path>` to keep the feedback loop tight.

## Validation and Acceptance

Milestone 1 verification workflow: First, write new unit tests in a dedicated file such as `tests/unit/studioSettings.test.ts` that assert settings normalization, per-gateway layout lookups, and ws/wss to http/https conversion. Run `pnpm test -- tests/unit/studioSettings.test.ts` and confirm failures are meaningful. Second, implement the settings store in `src/lib/studio/settings.server.ts` (or a similar location) along with a small client helper in `src/lib/studio/settings.ts` and an API route like `src/app/api/studio/route.ts` that loads/saves the settings. Third, update `src/lib/gateway/useGatewayConnection.ts` to read settings on load and persist changes via the API, then rerun the tests and confirm they pass. Fourth, commit with a message like “Milestone 1: persist gateway settings + layout”.

Milestone 2 verification workflow: First, write unit tests to cover the new agent-centric store, for example in `tests/unit/agentStore.test.ts`, asserting that agent tiles are created from `agents.list`, layouts apply to known agents, and session keys are built from `mainKey`. Run `pnpm test -- tests/unit/agentStore.test.ts` to see the new tests fail. Second, refactor `src/features/canvas/state/store.tsx` and `src/app/page.tsx` so the UI loads agents from the gateway and no longer depends on projects or workspace settings, and update components like `HeaderBar`, `AgentTile`, and `AgentInspectPanel` to accept agent-only props. Third, rerun the tests and ensure they pass. Fourth, commit with a message like “Milestone 2: gateway agents replace projects”.

Milestone 3 verification workflow: First, write unit tests that cover the new config patch helper and tool-proxy URL building, for example in `tests/unit/gatewayConfigPatch.test.ts` and `tests/unit/toolsInvokeUrl.test.ts`. Run those tests and confirm they fail before implementation. Second, implement gateway-backed operations: create a server API route (for example `src/app/api/gateway/tools/route.ts`) that calls the gateway `/tools/invoke` endpoint using stored settings; add helpers to build and apply config patches for agent rename and heartbeat updates; and wire `AgentInspectPanel` to call these new helpers. Third, rerun the tests and confirm all new tests pass and that the full `pnpm test` suite is green after removing or rewriting obsolete project tests. Fourth, commit with a message like “Milestone 3: gateway-backed agent config + workspace files”.

## Idempotence and Recovery

All changes should be additive or reversible without deleting user data. The settings store should be created if missing, and re-running the save operation should overwrite the same file safely. If a `config.patch` call fails due to a base hash mismatch, rerun `config.get` to obtain a fresh base hash and retry. If `/tools/invoke` returns a 404 or auth error, verify the gateway URL, token, and tool policy, then retry after updating the settings. Avoid deleting any directories; if a cleanup is needed, add a new, explicit user confirmation step.

## Artifacts and Notes

Example expected output when saving settings via the new API route:

    { "ok": true, "settings": { "version": 1, "gateway": { "url": "wss://gw.example:18789", "token": "***" }, "layouts": { "wss://gw.example:18789": { "agents": { "main": { "position": { "x": 0, "y": 0 }, "size": { "width": 420, "height": 520 } } } } } } }

Example `/tools/invoke` request body to read `AGENTS.md` for an agent session:

    {
      "tool": "read",
      "action": "json",
      "args": { "path": "AGENTS.md" },
      "sessionKey": "agent:main:main"
    }

## Interfaces and Dependencies

Define a new settings type and helpers, for example in `src/lib/studio/settings.server.ts`:

    export type StudioSettings = {
      version: 1;
      gateway: { url: string; token: string } | null;
      layouts: Record<string, { agents: Record<string, { position: { x: number; y: number }; size: { width: number; height: number }; avatarSeed?: string | null }> }>;
    };

    export function loadStudioSettings(): StudioSettings;
    export function saveStudioSettings(next: StudioSettings): void;
    export function normalizeStudioSettings(raw: unknown): StudioSettings;

Add a small helper to convert WS URLs to HTTP for tool proxying, for example in `src/lib/gateway/url.ts`:

    export function toGatewayHttpUrl(wsUrl: string): string;

Define a session key helper, replacing `src/lib/projects/sessionKey.ts`, for example in `src/lib/gateway/sessionKeys.ts`:

    export function buildAgentMainSessionKey(agentId: string, mainKey: string): string;
    export function parseAgentIdFromSessionKey(sessionKey: string): string | null;

For gateway-backed config edits, define a helper such as:

    export async function patchAgentConfig(params: { client: GatewayClient; agentId: string; patch: { name?: string; heartbeat?: Record<string, unknown> | null } }): Promise<void>;

This helper should call `config.get` to obtain `baseHash` and then call `config.patch` with a merge patch that replaces or creates the relevant `agents.list` entry.


Change Log:
- 2026-02-02: Marked Milestone 1 complete after adding studio settings store, API, URL helper, and tests.
- 2026-02-03: Completed milestones 2 and 3 (agent tiles, gateway-backed workspace + config edits, project API removal, tests).
