# Remove Client Env Wrapper and Drop `zod` Dependency

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This repository’s ExecPlan requirements live at `.agent/PLANS.md` and this document must be maintained in accordance with it.

## Purpose / Big Picture

OpenClaw Studio’s client-side gateway connection hook (`src/lib/gateway/useGatewayConnection.ts`) uses a small environment wrapper module (`src/lib/env.ts`) to read `NEXT_PUBLIC_GATEWAY_URL`. That wrapper pulls in `zod` to parse `process.env`, but `zod` is otherwise unused in the repository.

After this change:

1. The gateway connection hook reads `process.env.NEXT_PUBLIC_GATEWAY_URL` directly (keeping the same fallback default URL).
2. The unused `src/lib/env.ts` file is deleted.
3. The unused `zod` dependency is removed from `package.json` and `package-lock.json`.
4. A unit test proves the default gateway URL behavior remains correct, without making real network connections.

From a user’s perspective, nothing about the UI flow changes: the connection panel still defaults to the same gateway URL (or the `NEXT_PUBLIC_GATEWAY_URL` override). The observable difference is reduced dependency surface area and less client bundle overhead from an unnecessary runtime schema parse.

## Candidate Refactors Considered (Ranked)

I considered several consolidation refactors and chose the one with the best payoff-to-risk ratio.

1. Remove `src/lib/env.ts` and read `process.env.NEXT_PUBLIC_GATEWAY_URL` directly in `src/lib/gateway/useGatewayConnection.ts`, then remove the unused `zod` dependency.
   Payoff: removes a file-level concept (“env wrapper”) and an entire dependency (`zod`) that is otherwise unused.
   Blast radius: small (one import site plus dependency housekeeping).
   Validation: straightforward with a new unit test plus existing `typecheck`/`lint`/`test`.

2. Inline `cn()` into its only caller (`src/features/agents/components/EmptyStatePanel.tsx`) and delete `src/lib/utils.ts`.
   Payoff: removes a generic “utils” module that only exists for one component helper.
   Blast radius: tiny.
   Why not chosen: lower overall payoff than deleting `env.ts` + dropping `zod` (which removes both a module and a dependency).

3. Remove `src/lib/http.ts` by inlining `fetchJson` into its call sites.
   Payoff: removes a small wrapper, but at the cost of duplicating logic or relocating it into a less-neutral module.
   Why not chosen: higher cognitive risk (duplicate error handling) for a small surface-area win.

## Progress

- [x] Milestone 1: Add a unit test that asserts `useGatewayConnection` defaults to `NEXT_PUBLIC_GATEWAY_URL` when set, otherwise falls back to `ws://127.0.0.1:18789`. (2026-02-06 04:42:58Z)
- [x] Milestone 2: Inline env access into `useGatewayConnection`, delete `src/lib/env.ts`, remove `zod` from dependencies, and run the full verification suite. (2026-02-06 04:44:17Z)

## Surprises & Discoveries

- None.

## Decision Log

- Decision: Delete `src/lib/env.ts` and read `NEXT_PUBLIC_GATEWAY_URL` directly in the one client module that uses it.
  Rationale: The env wrapper is a single-use module whose only purpose is extracting a single `NEXT_PUBLIC_*` value, and it pulls in `zod` which is otherwise unused. Removing both reduces concepts a new contributor must learn and removes an unnecessary dependency from the install/build surface.
  Date/Author: 2026-02-06 / Codex

## Outcomes & Retrospective

- `src/lib/env.ts` was removed and the `NEXT_PUBLIC_GATEWAY_URL` lookup is now in `src/lib/gateway/useGatewayConnection.ts`.
- `zod` is no longer a direct dependency.
- Added a unit test that proves the default gateway URL behavior is stable.

## Context and Orientation

Gateway connectivity in the UI is managed by a client hook:

1. `src/app/page.tsx` renders the main UI and calls `useGatewayConnection()` to get a `GatewayClient`, status, gateway URL/token state, and connect/disconnect helpers.
2. `src/lib/gateway/useGatewayConnection.ts` owns:
   - Choosing the initial gateway URL (`DEFAULT_GATEWAY_URL`).
   - Loading persisted gateway URL/token via `src/lib/studio/coordinator.ts`.
   - Auto-connecting once settings have loaded.
   - Scheduling persisted settings updates (debounced) when gateway URL/token changes.

Today, `DEFAULT_GATEWAY_URL` is derived from `env.NEXT_PUBLIC_GATEWAY_URL`, where `env` is exported from `src/lib/env.ts`. That file:

1. Imports `zod`.
2. Defines a schema.
3. Parses `process.env` and exports the parsed object.

Evidence that this is thin/unused surface area:

1. `src/lib/env.ts` is only imported by `src/lib/gateway/useGatewayConnection.ts` (search: `rg -n "@/lib/env" src tests`).
2. `zod` is only imported by `src/lib/env.ts` (search: `rg -n "from \\\"zod\\\"" src tests`).

## Plan of Work

### Milestone 1: Add a Unit Test Guarding Default Gateway URL Behavior

At the end of this milestone, we have a test that proves the default URL logic is correct and that we can render the hook in tests without making a real WebSocket connection.

1. Create a new test file at `tests/unit/useGatewayConnection.test.ts`.
2. In that test file, mock:
   - The gateway client module, so `GatewayClient.connect()` is a harmless stub and does not instantiate a real WebSocket client.
   - The studio settings coordinator module, so `loadSettings()` returns `null` and persistence calls are no-ops.
3. Add two test cases:
   - `defaults_to_env_url_when_set`: set `process.env.NEXT_PUBLIC_GATEWAY_URL = "ws://example.test:1234"`, render a tiny component that calls `useGatewayConnection()` and prints `gatewayUrl`, and assert it shows the env value.
   - `falls_back_to_local_default_when_env_unset`: delete `process.env.NEXT_PUBLIC_GATEWAY_URL`, render again, and assert it shows `ws://127.0.0.1:18789`.

Verification steps:

1. From repo root, run `npm test` and confirm the new test passes.
2. Commit the milestone after tests pass with message: `Milestone 1: Add useGatewayConnection default URL test`.

### Milestone 2: Remove `src/lib/env.ts` and Drop `zod`

At the end of this milestone, the hook reads the `NEXT_PUBLIC_GATEWAY_URL` directly, `src/lib/env.ts` no longer exists, and `zod` is no longer a dependency.

1. Edit `src/lib/gateway/useGatewayConnection.ts`:
   - Remove `import { env } from "@/lib/env";`.
   - Replace `const DEFAULT_GATEWAY_URL = env.NEXT_PUBLIC_GATEWAY_URL ?? "ws://127.0.0.1:18789";` with `const DEFAULT_GATEWAY_URL = process.env.NEXT_PUBLIC_GATEWAY_URL ?? "ws://127.0.0.1:18789";`.
   - Keep the rest of the file unchanged.

2. Delete `src/lib/env.ts`.

3. Remove the `zod` dependency:
   - Remove `zod` from `package.json` dependencies.
   - Run `npm install` to update `package-lock.json`.

Verification steps:

1. From repo root, confirm the old imports are gone:
   - `rg -n "@/lib/env" src tests` should return no results.
   - `rg -n "zod" src tests` should return no results.
2. Run:
   - `npm run typecheck`
   - `npm run lint`
   - `npm test` (the Milestone 1 test must still pass)
3. Commit the milestone after all checks pass with message: `Milestone 2: Remove env wrapper and drop zod`.

## Concrete Steps

From repo root:

1. Add the test:
   - Create `tests/unit/useGatewayConnection.test.ts` as described above.
   - Run `npm test`.
2. Remove the wrapper + dependency:
   - Edit `src/lib/gateway/useGatewayConnection.ts`.
   - Delete `src/lib/env.ts`.
   - Edit `package.json` to remove `zod`.
   - Run `npm install`.
   - Run `npm run typecheck && npm run lint && npm test`.
3. Commit the changes.

## Validation and Acceptance

This work is accepted when all of the following are true:

1. `src/lib/env.ts` does not exist.
2. `package.json` no longer lists `zod` and the lockfile is consistent with that change.
3. `rg -n "@/lib/env" src tests` returns no results.
4. `npm run typecheck`, `npm run lint`, and `npm test` all pass.
5. The new unit test file proves:
   - When `NEXT_PUBLIC_GATEWAY_URL` is set, `useGatewayConnection().gatewayUrl` uses it.
   - When it is unset, the default is `ws://127.0.0.1:18789`.

## Idempotence and Recovery

This plan is safe to retry.

If a step is partially applied (for example, `zod` removed from `package.json` but the lockfile is stale), re-run `npm install` and then re-run `npm test`.

Rollback plan:

1. Restore `src/lib/env.ts` from git history.
2. Re-add `zod` to `package.json` and run `npm install`.
3. Revert `src/lib/gateway/useGatewayConnection.ts` to import `env` again.
4. Run `npm test` to confirm the rollback is healthy.

## Artifacts and Notes

Key evidence commands used during planning (expected to be run from repo root):

  rg -n "@/lib/env" src tests
  rg -n "from \"zod\"" src tests
