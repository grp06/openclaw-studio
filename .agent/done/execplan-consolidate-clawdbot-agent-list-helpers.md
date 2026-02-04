# Consolidate Clawdbot agent list helpers

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This plan must be maintained in accordance with `.agent/PLANS.md` in this repository.

## Purpose / Big Picture

Heartbeat settings are read and written through the Clawdbot agent list in `moltbot.json`. Today the heartbeat route reimplements the agent list read/write helpers that already exist in `src/lib/clawdbot/config.ts`, which means a future change to agent list shape must be made in multiple places. After this change, there will be a single shared implementation for agent list access, and the heartbeat route will reuse it without duplicating logic. The observable behavior should remain identical, but the code surface area shrinks and future edits are safer.

## Progress

- [x] (2026-01-29 21:00Z) Add shared exports for agent list helpers and tests that define their behavior. Tests: `npm test -- --run tests/unit/clawdbotConfig.test.ts`.
- [x] (2026-01-29 21:02Z) Update heartbeat route to use shared helpers and remove local duplicates; re-run tests. Tests: `npm test -- --run tests/unit/projectResolve.test.ts`.

## Surprises & Discoveries

- None yet.

## Decision Log

- Decision: Consolidate agent list helpers in `src/lib/clawdbot/config.ts` and reuse them in the heartbeat API route.
  Rationale: It removes duplicate parsing and list mutation logic with minimal blast radius, and keeps the Clawdbot config shape centralized.
  Date/Author: 2026-01-29 / Codex

## Outcomes & Retrospective

- Consolidated agent list helpers into `src/lib/clawdbot/config.ts`, added unit coverage, and removed duplicate helpers from the heartbeat route. Behavior remains unchanged while reducing duplicated logic.

Plan update note: Marked milestones complete with test evidence and recorded the outcome after finishing the implementation.

## Context and Orientation

`src/lib/clawdbot/config.ts` owns parsing and updating `moltbot.json`, including agent list mutation via `upsertAgentEntry`, `renameAgentEntry`, and `removeAgentEntry`. That file already defines internal `readAgentList` and `writeAgentList` helpers. The heartbeat API route at `src/app/api/projects/[projectId]/tiles/[tileId]/heartbeat/route.ts` repeats similar `readAgentList` and `writeAgentList` implementations to access the agent list and store per-agent heartbeat overrides. The goal is to export the shared helpers from `config.ts` (and make their types flexible enough to carry heartbeat data) so the heartbeat route can import them and delete its local duplicates.

## Plan of Work

Start by adding unit tests that capture how agent list helpers behave, including preservation of extra fields like `heartbeat`. Export `readAgentList` and `writeAgentList` from `src/lib/clawdbot/config.ts`, and adjust the `AgentEntry` type to allow extra fields beyond `id`, `name`, and `workspace` (for example, by intersecting with `Record<string, unknown>`). Update existing config helpers in the same file to use the exported type without changing behavior. Next, update `src/app/api/projects/[projectId]/tiles/[tileId]/heartbeat/route.ts` to import the shared helpers and type, remove the local helper implementations, and keep the rest of the logic intact. Finally, run the new unit test and the existing unit suite to confirm no behavior regressions.

## Concrete Steps

Run these commands from the repository root (`/Users/georgepickett/clawdbot-agent-ui`).

1) Inspect the existing agent list helpers and the heartbeat route.

    rg -n "readAgentList|writeAgentList" src/lib/clawdbot/config.ts src/app/api/projects/\[projectId\]/tiles/\[tileId\]/heartbeat/route.ts

2) Add a new unit test file at `tests/unit/clawdbotConfig.test.ts` that exercises the exported helpers. Follow existing Vitest patterns in `tests/unit/projectResolve.test.ts`.

3) Update `src/lib/clawdbot/config.ts` to export `AgentEntry`, `readAgentList`, and `writeAgentList`, and ensure `AgentEntry` allows extra keys (like `heartbeat`) without losing them when writing back.

4) Update `src/app/api/projects/[projectId]/tiles/[tileId]/heartbeat/route.ts` to import and use the shared helpers, removing the local implementations.

5) Run unit tests and confirm they pass.

    npm test -- --run tests/unit/clawdbotConfig.test.ts
    npm test -- --run tests/unit/projectResolve.test.ts

## Validation and Acceptance

Acceptance is met when all of the following are true:

1) The heartbeat API route no longer defines its own `readAgentList` or `writeAgentList` helpers and instead imports them from `src/lib/clawdbot/config.ts`.
2) The unit tests in `tests/unit/clawdbotConfig.test.ts` pass and show that extra fields (such as `heartbeat`) survive a read/write round trip.
3) Existing unit tests continue to pass without modification, demonstrating no behavior regressions.

For each milestone, use this verification workflow:

Milestone 1: Export agent list helpers and tests.

- Tests to write: In `tests/unit/clawdbotConfig.test.ts`, add a `describe("clawdbot config agent list helpers")` block with at least two tests.
  - `it("reads an empty list when agents.list is missing")` should assert that `readAgentList({})` returns an empty array.
  - `it("preserves extra fields like heartbeat when writing list")` should create a config object with `agents.list` containing an entry with a `heartbeat` field, call `writeAgentList`, and assert that `readAgentList` returns the entry including `heartbeat`.
- Implementation: Export `AgentEntry`, `readAgentList`, and `writeAgentList` from `src/lib/clawdbot/config.ts`. Update the `AgentEntry` type to permit extra fields, and keep existing helpers (`upsertAgentEntry`, `renameAgentEntry`, `removeAgentEntry`) using the same functions.
- Verification: Run `npm test -- --run tests/unit/clawdbotConfig.test.ts` and confirm it passes.
- Commit: Commit with message `Milestone 1: export Clawdbot agent list helpers`.

Milestone 2: Reuse shared helpers in the heartbeat route.

- Tests to write: No new tests required if milestone 1 tests already cover helper behavior, but run an existing unit test to ensure no regressions.
- Implementation: In `src/app/api/projects/[projectId]/tiles/[tileId]/heartbeat/route.ts`, remove the local `readAgentList` and `writeAgentList` functions and import the shared helpers (and `AgentEntry` type if needed) from `src/lib/clawdbot/config.ts`.
- Verification: Run `npm test -- --run tests/unit/projectResolve.test.ts` (or the full unit suite if desired) and ensure it passes.
- Commit: Commit with message `Milestone 2: reuse shared agent list helpers in heartbeat route`.

## Idempotence and Recovery

These changes are safe to re-run. If a step fails, revert the most recent file edits and re-apply them. The only functional changes are refactoring helpers; no migrations or runtime state changes are required.

## Artifacts and Notes

If you need a quick before/after check, the heartbeat route should no longer contain any `readAgentList` or `writeAgentList` function bodies after the refactor, and `src/lib/clawdbot/config.ts` should contain exported versions of those helpers.

## Interfaces and Dependencies

The shared helpers must exist in `src/lib/clawdbot/config.ts` with these signatures:

    export type AgentEntry = Record<string, unknown> & {
      id: string;
      name?: string;
      workspace?: string;
    };

    export const readAgentList: (config: Record<string, unknown>) => AgentEntry[];
    export const writeAgentList: (config: Record<string, unknown>, list: AgentEntry[]) => void;

Keep existing exports (`loadClawdbotConfig`, `saveClawdbotConfig`, `upsertAgentEntry`, `renameAgentEntry`, `removeAgentEntry`) working as before.
