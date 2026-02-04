# Centralize agent sessionKey helpers

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This plan must be maintained in accordance with `.agent/PLANS.md` in this repository.

## Purpose / Big Picture

The `agent:<agentId>:main` sessionKey format is currently duplicated in both client and server code, and the migration parser in the store uses a local regex with a hard-coded fallback. Consolidating build/parse logic into a single helper reduces the chance of format drift and makes future changes safer. After this change, both the API routes and the client store use shared sessionKey helpers, with behavior preserved.

## Progress

- [x] (2026-01-29 21:34Z) Add shared sessionKey build/parse helpers with unit tests. Tests: `npm test -- --run tests/unit/sessionKey.test.ts`.
- [x] (2026-01-29 21:34Z) Update client/server call sites to use helpers; re-run tests. Tests: `npm test -- --run tests/unit/projectResolve.test.ts`.

## Surprises & Discoveries

- None yet.

## Decision Log

- Decision: Centralize sessionKey build/parse helpers in `src/lib/projects/sessionKey.ts` and reuse them in client/store migration and API routes.
  Rationale: The same `agent:<id>:main` format appears in three files; a shared helper reduces duplication with minimal blast radius.
  Date/Author: 2026-01-29 / Codex

## Outcomes & Retrospective

- Centralized sessionKey build/parse logic in `src/lib/projects/sessionKey.ts`, updated client store, tile creation, and store migration parsing to use the helpers, and added unit coverage for format/fallback behavior. Behavior remains unchanged with less duplication.

Plan update note: Marked milestones complete with test evidence and recorded the outcome after implementation.

## Context and Orientation

The sessionKey format is currently embedded in multiple places:

- `src/features/canvas/state/store.tsx` builds `agent:${agentId}:main` in `buildSessionKey`.
- `src/app/api/projects/[projectId]/tiles/route.ts` constructs the sessionKey string directly.
- `src/app/api/projects/store.ts` contains `parseAgentId` which uses a regex to extract the agentId and falls back to `"main"`.

The goal is to create a shared helper module in `src/lib/projects/sessionKey.ts` and use it in all three places, preserving current behavior and fallback semantics.

## Plan of Work

Create `src/lib/projects/sessionKey.ts` with `buildSessionKey(agentId)` and `parseAgentIdFromSessionKey(sessionKey, fallback = "main")`. Add unit tests to lock in exact behavior. Then update the client store, the tile create route, and the store migration parser to use the helpers. Finally, run unit tests to confirm no regressions.

## Concrete Steps

From the repository root (`/Users/georgepickett/clawdbot-agent-ui`):

1) Inspect current sessionKey usage and parsing.

    rg -n "sessionKey|agent:.*:main|parseAgentId" src

2) Add `src/lib/projects/sessionKey.ts` with build/parse helpers.

3) Add `tests/unit/sessionKey.test.ts` to cover the helpers.

4) Update:
   - `src/features/canvas/state/store.tsx` to use `buildSessionKey`.
   - `src/app/api/projects/[projectId]/tiles/route.ts` to use `buildSessionKey`.
   - `src/app/api/projects/store.ts` to use `parseAgentIdFromSessionKey`.

5) Run tests.

    npm test -- --run tests/unit/sessionKey.test.ts
    npm test -- --run tests/unit/projectResolve.test.ts

## Validation and Acceptance

Acceptance is met when all of the following are true:

1) No code path directly constructs `agent:${agentId}:main` in the files listed above; they use `buildSessionKey`.
2) Store migration parsing uses `parseAgentIdFromSessionKey` with the same fallback behavior as before.
3) The new unit tests pass and confirm build/parse behavior.
4) Existing unit tests continue to pass.

Milestone 1: Helpers and tests.

- Tests to write: Create `tests/unit/sessionKey.test.ts` with at least three tests:
  - `it("buildSessionKey formats agent session key")` expects `buildSessionKey("agent-1")` to return `"agent:agent-1:main"`.
  - `it("parseAgentIdFromSessionKey extracts agent id")` expects parsing `"agent:agent-1:main"` to return `"agent-1"`.
  - `it("parseAgentIdFromSessionKey falls back when missing")` expects parsing `""` to return the provided fallback (default `"main"`).
- Implementation: Add `src/lib/projects/sessionKey.ts` exporting:

      export const buildSessionKey: (agentId: string) => string;
      export const parseAgentIdFromSessionKey: (sessionKey: string, fallback?: string) => string;

- Verification: Run `npm test -- --run tests/unit/sessionKey.test.ts` and confirm all tests pass.
- Commit: Commit with message `Milestone 1: add sessionKey helpers`.

Milestone 2: Replace call sites.

- Tests to write: No new tests required beyond milestone 1.
- Implementation: Update the three call sites listed above to use the helpers. Preserve behavior and defaults.
- Verification: Run `npm test -- --run tests/unit/projectResolve.test.ts` and confirm it passes.
- Commit: Commit with message `Milestone 2: reuse sessionKey helpers in project flows`.

## Idempotence and Recovery

The helpers are pure string utilities; changes are safe to re-run. If a step fails, revert the last edits and re-apply. No migrations or runtime data changes are required.

## Artifacts and Notes

After the refactor, searching for the literal string pattern `agent:${agentId}:main` in the files above should only show it inside `buildSessionKey`.

## Interfaces and Dependencies

`src/lib/projects/sessionKey.ts` must be a pure module with no Node-only dependencies so it can be used by both client and server code.
