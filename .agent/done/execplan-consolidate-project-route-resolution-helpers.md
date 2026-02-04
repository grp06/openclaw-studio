# Consolidate project route resolution helpers

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This repository’s ExecPlan requirements live at `.agent/PLANS.md` and this document must be maintained in accordance with that file.

## Purpose / Big Picture

Several project API routes repeat the same three steps: load the projects store, resolve a project or tile from route params, and return a shared error response when the project or tile is missing. This refactor consolidates those steps into two shared helpers so the routes focus on their actual business logic. The behavior and error messages remain unchanged, but the API surface becomes easier to maintain and harder to drift.

## Progress

- [x] (2026-01-29 06:17Z) Add shared helpers for resolving project and tile from params with store loading, and add unit tests for those helpers.
- [x] (2026-01-29 06:19Z) Update all project and tile API routes to use the helpers and verify tests pass.

## Surprises & Discoveries

None yet.

## Decision Log

- Decision: Centralize `loadStore` + `resolveProjectOrResponse`/`resolveProjectTileOrResponse` into two helpers and update routes to use them.
  Rationale: The same resolution pattern appears in multiple routes and creates unnecessary duplication; consolidating it reduces surface area without changing behavior.
  Date/Author: 2026-01-29 (Codex)

## Outcomes & Retrospective

Centralized project/tile param resolution with store loading into shared helpers and updated all project API routes to use them. Unit tests for the helpers and the full Vitest suite pass.

## Context and Orientation

The project API routes live under `src/app/api/projects`. Routes such as `src/app/api/projects/[projectId]/route.ts`, `src/app/api/projects/[projectId]/tiles/route.ts`, and `src/app/api/projects/[projectId]/tiles/[tileId]/workspace-files/route.ts` all repeat the same sequence: await `context.params`, call `loadStore` from `src/app/api/projects/store.ts`, call `resolveProjectOrResponse` or `resolveProjectTileOrResponse` from `src/app/api/projects/resolveResponse.ts`, and early-return the `NextResponse` when resolution fails. The shared resolve helpers themselves live in `src/app/api/projects/resolveResponse.ts` and already wrap error responses, but they require the caller to load the store. The duplication is purely in the route handlers.

## Plan of Work

First, extend `src/app/api/projects/resolveResponse.ts` with two new helpers that accept the `context.params` promise and perform the store load internally. Each helper should return a discriminated union containing `ok: true` along with the resolved project/tile and the loaded store, or `ok: false` with a `NextResponse`. Keep the existing `resolveProjectOrResponse` and `resolveProjectTileOrResponse` exports unchanged so existing unit tests still pass.

Second, update every project/tile route that currently does manual `loadStore` + resolve to use the new helpers. The routes should no longer call `loadStore` directly unless they need a separate read; instead, use the `store` returned by the helper. Ensure that every route keeps the same error responses and status codes as before.

Finally, add unit tests for the new helpers by mocking `loadStore` so tests do not hit the filesystem. Extend `tests/unit/projectApiResolve.test.ts` to cover both the success and not-found cases for each helper, using a fixed in-memory store. Run the focused test first, then the full unit suite.

## Concrete Steps

Work from the repository root.

Read the existing resolve helper file and the routes that use it so that the new helper signatures fit their needs. Then implement the two helpers in `src/app/api/projects/resolveResponse.ts` and update the route handlers in:

- `src/app/api/projects/[projectId]/route.ts`
- `src/app/api/projects/[projectId]/discord/route.ts`
- `src/app/api/projects/[projectId]/tiles/route.ts`
- `src/app/api/projects/[projectId]/tiles/[tileId]/route.ts`
- `src/app/api/projects/[projectId]/tiles/[tileId]/workspace-files/route.ts`
- `src/app/api/projects/[projectId]/tiles/[tileId]/heartbeat/route.ts`

Add tests to `tests/unit/projectApiResolve.test.ts` and run `npm test -- tests/unit/projectApiResolve.test.ts` from the repo root, then run `npm test` after all routes have been updated.

## Validation and Acceptance

The change is accepted when all of the following are true:

1. Routes that previously loaded the store and resolved projects/tiles now call the shared helpers instead, and no route loses its existing error response or status code.
2. `tests/unit/projectApiResolve.test.ts` includes coverage for the new helpers and passes.
3. The full `npm test` suite passes.

Verification workflow for each milestone:

Milestone 1 (helpers + tests):
- Tests to write: Extend `tests/unit/projectApiResolve.test.ts` with two new test blocks for the new helpers. Use `vi.mock("@/app/api/projects/store")` to return a deterministic store, then assert that a valid params object yields `ok: true` with the expected project/tile and store, and that invalid ids yield `ok: false` with a `NextResponse` status of 404 and the expected JSON error.
- Implementation: Add `resolveProjectFromParams` and `resolveProjectTileFromParams` (names can vary but must be consistent) to `src/app/api/projects/resolveResponse.ts`, exporting them so tests can import them.
- Verification: Run `npm test -- tests/unit/projectApiResolve.test.ts` and confirm the new tests fail before implementation and pass afterward.
- Commit: Commit with message "Milestone 1: add param-based project resolve helpers".

Milestone 2 (route updates):
- Tests to write: No new tests beyond Milestone 1 unless a regression appears.
- Implementation: Update each of the listed routes to use the new helpers and remove direct `loadStore` calls where appropriate, using the returned store instead.
- Verification: Run `npm test` and confirm all unit tests pass.
- Commit: Commit with message "Milestone 2: use shared resolve helpers in project routes".

## Idempotence and Recovery

This refactor is safe to apply incrementally. If a route update fails, you can revert that route to the previous pattern without affecting other routes. Keep commits per milestone so rollback is straightforward.

## Artifacts and Notes

Include short evidence snippets in commit logs such as:

    npm test -- tests/unit/projectApiResolve.test.ts
    PASS  tests/unit/projectApiResolve.test.ts

## Interfaces and Dependencies

No new dependencies are required. The new helper function signatures should look like:

    export type ProjectResolveWithStore =
      | { ok: true; store: ProjectsStore; projectId: string; project: Project }
      | { ok: false; response: NextResponse };

    export const resolveProjectFromParams = (
      params: Promise<{ projectId: string }>
    ): Promise<ProjectResolveWithStore> => { ... };

    export type ProjectTileResolveWithStore =
      | { ok: true; store: ProjectsStore; projectId: string; tileId: string; project: Project; tile: ProjectTile }
      | { ok: false; response: NextResponse };

    export const resolveProjectTileFromParams = (
      params: Promise<{ projectId: string; tileId: string }>
    ): Promise<ProjectTileResolveWithStore> => { ... };

Keep existing exports in `src/app/api/projects/resolveResponse.ts` intact to avoid breaking existing callers.

Change note: Initial ExecPlan written for consolidating project/tile route resolution helpers; no implementation has begun yet.
Change note: Marked Milestone 1 complete after adding param-based helpers and tests.
Change note: Marked Milestone 2 complete after updating routes and running the full unit test suite.
