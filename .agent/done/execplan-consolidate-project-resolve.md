# Consolidate project resolution helpers into one server module

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This plan must be maintained in accordance with `.agent/PLANS.md`.

## Purpose / Big Picture

The project and tile resolution helpers are split across `src/lib/projects/resolve.ts` (pure lookup) and `src/app/api/projects/resolveResponse.ts` (NextResponse wrappers + store loading). The pure module is only used by the response module and unit tests, which means we carry two files and two concepts for a single concern. After this change, there will be one server-only module that exports both the pure resolvers and the NextResponse helpers, with the same error behavior. A user should see no behavior change in the UI, but the codebase will have fewer files and fewer layers to learn.

## Progress

- [x] (2026-01-30 02:58Z) Drafted ExecPlan and recorded scope, constraints, and acceptance criteria.
- [x] (2026-01-30 03:02Z) Implemented consolidated resolve module and updated imports/tests.
- [x] (2026-01-30 03:02Z) Validated with existing unit tests and recorded outcomes.

## Surprises & Discoveries

None yet.

## Decision Log

- Decision: Consolidate `resolveProject`/`resolveProjectTile` and the API response helpers into a single server-only module at `src/lib/projects/resolve.server.ts`, then delete the two older files.
  Rationale: `src/lib/projects/resolve.ts` is only used by `src/app/api/projects/resolveResponse.ts` and unit tests, so a server-only module removes a redundant layer and reduces file count while keeping behavior identical.
  Date/Author: 2026-01-30 (Codex)

## Outcomes & Retrospective

2026-01-30: Consolidated resolve helpers into `src/lib/projects/resolve.server.ts`, removed redundant modules, updated API routes/tests, and verified resolve unit tests pass.

## Context and Orientation

Project/tile resolution happens in two places today. The pure lookup functions live in `src/lib/projects/resolve.ts`. The API-layer wrappers that translate lookup failures into `NextResponse` errors and load the store live in `src/app/api/projects/resolveResponse.ts`. All project-related API routes import from `src/app/api/projects/resolveResponse.ts`, and unit tests cover both the pure functions (`tests/unit/projectResolve.test.ts`) and the API helpers (`tests/unit/projectApiResolve.test.ts`). The goal is to collapse the two resolve modules into one server-only module while keeping the exported function behavior the same and updating import paths accordingly.

## Plan of Work

Create a new server-only module at `src/lib/projects/resolve.server.ts` that contains the full set of resolve helpers currently split across `src/lib/projects/resolve.ts` and `src/app/api/projects/resolveResponse.ts`. The exported surface should include `resolveProject`, `resolveProjectTile`, `resolveProjectOrResponse`, `resolveProjectTileOrResponse`, `resolveProjectFromParams`, and `resolveProjectTileFromParams`, preserving the exact error messages and status codes used today. Update all API route imports to use `@/lib/projects/resolve.server` and update unit tests to import from the new module. Remove the old `src/lib/projects/resolve.ts` and `src/app/api/projects/resolveResponse.ts` files once all references are updated.

## Concrete Steps

First, locate all imports of the old modules so nothing is missed. From the repository root, run:

    rg "resolveResponse|projects/resolve" -n src tests

Next, create `src/lib/projects/resolve.server.ts` and move the logic from `src/lib/projects/resolve.ts` and `src/app/api/projects/resolveResponse.ts` into it, keeping the same function bodies and exports. Ensure the module continues to import `loadStore` from `src/app/api/projects/store.ts` and `NextResponse` from `next/server` because those behaviors are part of the existing API helper contract.

Update all API route files under `src/app/api/projects/**/route.ts` to import resolve helpers from `@/lib/projects/resolve.server` instead of `@/app/api/projects/resolveResponse`. Update unit tests in `tests/unit/projectResolve.test.ts` and `tests/unit/projectApiResolve.test.ts` to import from the new module path. Remove the old files once no references remain.

## Validation and Acceptance

Acceptance means that the API routes still return the same status codes and error messages for missing or unknown project/tile ids, and all existing unit tests that cover resolve behavior pass without modification to their expectations.

Milestone 1: Consolidate resolve helpers into a single server-only module.

Tests to write: none. Existing tests already cover the behavior, so the focus is to keep expectations unchanged.

Implementation: move and merge the resolve helper functions into `src/lib/projects/resolve.server.ts`, update imports in API routes and tests, and delete the old modules.

Verification: run `npm run test -- tests/unit/projectResolve.test.ts tests/unit/projectApiResolve.test.ts` from the repository root and confirm both suites pass without changes to expectations. If the repo test runner does not accept positional test paths, run `npx vitest tests/unit/projectResolve.test.ts tests/unit/projectApiResolve.test.ts` instead.

Commit: after tests pass, commit with message `Milestone 1: Consolidate project resolve helpers`.

## Idempotence and Recovery

These changes are safe to apply multiple times because they only move code and update imports. If any step fails, revert by restoring the deleted files and resetting imports to the previous paths, then retry the move. No directories are removed in this plan.

## Artifacts and Notes

Expected file changes include removing `src/lib/projects/resolve.ts` and `src/app/api/projects/resolveResponse.ts`, adding `src/lib/projects/resolve.server.ts`, and updating imports in project API routes and unit tests. A successful test run should report passing results for both resolve-related suites.

## Interfaces and Dependencies

The consolidated module at `src/lib/projects/resolve.server.ts` must export the following signatures, unchanged in behavior:

    resolveProject(store: ProjectsStore, projectId: string) => ResolveProjectResult
    resolveProjectTile(store: ProjectsStore, projectId: string, tileId: string) => ResolveProjectTileResult
    resolveProjectOrResponse(store: ProjectsStore, projectId: string) => ProjectResolveResponse
    resolveProjectTileOrResponse(store: ProjectsStore, projectId: string, tileId: string) => ProjectTileResolveResponse
    resolveProjectFromParams(params: Promise<{ projectId: string }>) => Promise<ProjectResolveWithStoreResponse>
    resolveProjectTileFromParams(params: Promise<{ projectId: string; tileId: string }>) => Promise<ProjectTileResolveWithStoreResponse>

The module depends on `next/server` for `NextResponse`, `src/app/api/projects/store.ts` for `loadStore`, and `src/lib/projects/types.ts` for shared types. Keep these imports unchanged in behavior to avoid client-side bundling issues.

Plan update (2026-01-30 03:02Z): Marked implementation and validation complete after code changes and passing tests.
