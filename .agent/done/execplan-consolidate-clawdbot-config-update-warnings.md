# Consolidate Clawdbot config update warnings in API routes

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This plan must be maintained in accordance with `.agent/PLANS.md` in this repository.

## Purpose / Big Picture

Several API routes update `moltbot.json` and repeat the same load/mutate/save/try-catch pattern to append the warning string `Agent config not updated: ...`. That boilerplate is scattered across project and tile routes, which makes future changes to warning behavior or config handling repetitive and error-prone. After this change, a single shared helper in `src/lib/clawdbot/config.ts` will perform the load/mutate/save logic and return warnings, and routes will reuse it. Behavior remains identical while reducing duplicated error handling.

## Progress

- [x] (2026-01-29 21:28Z) Add a shared Clawdbot config update helper with unit tests. Tests: `npm test -- --run tests/unit/clawdbotConfig.test.ts`.
- [x] (2026-01-29 21:28Z) Update project/tile API routes to use the helper and re-run tests. Tests: `npm test -- --run tests/unit/projectResolve.test.ts`.

## Surprises & Discoveries

- None yet.

## Decision Log

- Decision: Centralize Clawdbot config update warnings in `src/lib/clawdbot/config.ts` and reuse the helper in routes that modify agent entries.
  Rationale: Four routes duplicate the same try/catch and warning text; a shared helper reduces repetition with minimal behavioral risk.
  Date/Author: 2026-01-29 / Codex

## Outcomes & Retrospective

- Centralized Clawdbot config update warnings in `src/lib/clawdbot/config.ts`, updated project/tile routes to reuse the helper, and added unit coverage for save/skip/error behavior. Warning text and behavior remain unchanged with less boilerplate.

Plan update note: Marked milestones complete with test evidence and recorded the outcome after implementation.

## Context and Orientation

Clawdbot config read/write is handled in `src/lib/clawdbot/config.ts` with helpers like `loadClawdbotConfig`, `saveClawdbotConfig`, `upsertAgentEntry`, and `removeAgentEntry`. Project/tile API routes use those helpers and manually wrap them in try/catch blocks to add warnings on failure. This pattern appears in:

- `src/app/api/projects/[projectId]/route.ts` (project delete)
- `src/app/api/projects/[projectId]/tiles/route.ts` (tile create)
- `src/app/api/projects/[projectId]/tiles/[tileId]/route.ts` (tile delete + tile rename)

The goal is to add a shared helper to `config.ts` that performs the load/mutate/save sequence and returns a standardized warning list so routes no longer duplicate the same try/catch and message formatting.

## Plan of Work

Add a new helper `updateClawdbotConfig` in `src/lib/clawdbot/config.ts` that accepts an updater function, attempts to load config, runs the updater, saves when changed, and returns a `{ warnings: string[] }` object. The warning message must be exactly `Agent config not updated: ${message}` with the same fallback message used today (`Failed to update clawdbot.json.`). Extend `tests/unit/clawdbotConfig.test.ts` with new tests that mock `loadClawdbotConfig` and `saveClawdbotConfig` so the helper can be verified without touching the real filesystem. Then update the routes listed in Context to call the new helper and append its warnings instead of manual try/catch blocks. Finally, run the unit tests.

## Concrete Steps

From the repository root (`/Users/georgepickett/clawdbot-agent-ui`):

1) Inspect the repeated warning handling.

    rg -n "Agent config not updated" src/app/api/projects

2) Add `updateClawdbotConfig` to `src/lib/clawdbot/config.ts`.

3) Extend `tests/unit/clawdbotConfig.test.ts` with helper tests that mock `loadClawdbotConfig` and `saveClawdbotConfig` using Vitest.

4) Update the routes listed in Context to use the helper and remove their duplicate try/catch blocks.

5) Run tests.

    npm test -- --run tests/unit/clawdbotConfig.test.ts
    npm test -- --run tests/unit/projectResolve.test.ts

## Validation and Acceptance

Acceptance is met when all of the following are true:

1) The routes listed in Context no longer contain inline try/catch blocks that push the `Agent config not updated:` warning string; they call the shared helper instead.
2) The new unit tests pass and confirm the helper saves only when changed and produces the correct warning string on errors.
3) Existing unit tests continue to pass without modification.

Milestone 1: Shared helper and tests.

- Tests to write: Extend `tests/unit/clawdbotConfig.test.ts` with a new `describe("updateClawdbotConfig")` block that includes:
  - `it("saves when updater reports changes")` that mocks `loadClawdbotConfig` to return `{ config, configPath }`, mocks `saveClawdbotConfig`, returns `true` from the updater, and asserts `saveClawdbotConfig` is called once with the same path and config and `warnings` is empty.
  - `it("skips save when updater reports no changes")` that returns `false` and asserts `saveClawdbotConfig` was not called and `warnings` is empty.
  - `it("returns warning when load fails")` that mocks `loadClawdbotConfig` to throw and asserts the returned warnings array equals `["Agent config not updated: <message>"]` with the fallback message when the thrown value is not an Error.
- Implementation: Add `updateClawdbotConfig` to `src/lib/clawdbot/config.ts` with signature:

      export const updateClawdbotConfig: (
        updater: (config: Record<string, unknown>) => boolean
      ) => { warnings: string[] };

  The helper should call `loadClawdbotConfig`, call the updater, save only when the updater returns `true`, and return warnings on failure. Keep existing exports intact.
- Verification: Run `npm test -- --run tests/unit/clawdbotConfig.test.ts` and confirm all tests pass.
- Commit: Commit with message `Milestone 1: add Clawdbot config update helper`.

Milestone 2: Route updates.

- Tests to write: No new tests required beyond milestone 1.
- Implementation: Replace try/catch blocks that update config in the routes listed in Context with `updateClawdbotConfig`. Append returned warnings to the existing `warnings` array and keep other logic unchanged. For project deletion, call the helper once with an updater that removes all relevant agent entries and returns whether any removal occurred.
- Verification: Run `npm test -- --run tests/unit/projectResolve.test.ts` and confirm it passes.
- Commit: Commit with message `Milestone 2: reuse config update helper in project routes`.

## Idempotence and Recovery

The helper is pure and routes remain behavior-compatible. These changes are safe to re-run. If a step fails, revert the last edits and re-apply. No migrations or data loss are involved.

## Artifacts and Notes

After the refactor, searching for `Agent config not updated:` in the project API routes should show only helper usage, not inline try/catch blocks.

## Interfaces and Dependencies

`updateClawdbotConfig` must live in `src/lib/clawdbot/config.ts` and rely on the existing `loadClawdbotConfig`/`saveClawdbotConfig` helpers. It should not introduce new dependencies. The routes will import it from `@/lib/clawdbot/config`.
