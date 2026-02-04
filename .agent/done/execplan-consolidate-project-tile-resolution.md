# Consolidate API project and tile resolution

This ExecPlan is a living document. The sections Progress, Surprises and Discoveries, Decision Log, and Outcomes and Retrospective must be kept up to date as work proceeds.

The plan follows the requirements in .agent/PLANS.md from the repository root. This document must be maintained in accordance with that file.

## Purpose / Big Picture

The API routes for projects and tiles repeat the same validation and lookup logic in multiple files. This refactor consolidates that logic into a single shared helper so new changes to project or tile resolution only happen once. After this change, the API routes should behave exactly as before, but the code will be smaller, easier to scan, and less error prone when future changes touch project or tile identity rules.

## Progress

- [x] (2026-01-29 03:52Z) Add shared project and tile resolution helpers with tests.
- [x] (2026-01-29 03:55Z) Update API routes to use the shared helpers and run unit tests.

## Surprises & Discoveries

None yet.

## Decision Log

- Decision: Centralize project and tile lookup into a new helper in src/lib/projects/resolve.ts and keep API routes thin by mapping helper errors to NextResponse.
  Rationale: This preserves existing behavior while enabling fast unit tests without touching the filesystem or NextResponse.
  Date/Author: 2026-01-29 / Codex

## Outcomes & Retrospective

Completed consolidation of project/tile resolution into src/lib/projects/resolve.ts, added unit coverage, and refactored API routes to use the shared helper. All unit tests pass and API behavior should be unchanged. No follow-up work identified.

## Context and Orientation

The project store is persisted by src/app/api/projects/store.ts and read by API route handlers under src/app/api/projects. Several routes repeat the same string trimming, store lookup, and not found checks for projectId and tileId. Examples include src/app/api/projects/[projectId]/tiles/[tileId]/workspace-files/route.ts and src/app/api/projects/[projectId]/tiles/[tileId]/heartbeat/route.ts, which each define a resolveTile function with identical behavior. Similar lookup blocks appear in src/app/api/projects/[projectId]/tiles/[tileId]/route.ts, src/app/api/projects/[projectId]/tiles/route.ts, src/app/api/projects/[projectId]/discord/route.ts, and src/app/api/projects/[projectId]/route.ts. The goal is to extract a single, testable helper that accepts a ProjectsStore and raw ids, normalizes them, and returns either a resolved project or tile or an error descriptor, so each route can use one shared source of truth.

## Plan of Work

Create a new helper module at src/lib/projects/resolve.ts that exposes two pure functions: resolveProject and resolveProjectTile. Each function should accept a ProjectsStore and raw id strings, trim the ids, validate that they are present, then locate the project or tile within the store. On success, return the normalized ids and the matched project or tile. On failure, return a structured error containing the HTTP status and error message currently used by the API routes. Because these functions are pure, add a unit test file under tests/unit that exercises success and error cases for both functions.

Next, update the API routes under src/app/api/projects to call loadStore once, then use the new helper functions for project and tile resolution. Preserve the current error messages and status codes by mapping helper errors to NextResponse.json with the same payload shape. Remove the duplicated resolveTile functions and inline lookup blocks after the helper is integrated. Ensure no behavior changes in the response payloads other than the internal refactor.

## Concrete Steps

Work from the repository root.

Add src/lib/projects/resolve.ts and define the helper functions with type signatures that are stable for API callers. Write a new unit test at tests/unit/projectResolve.test.ts that builds a small in-memory ProjectsStore, then asserts that resolveProject returns a 400 error for empty ids, a 404 error for unknown ids, and a successful result for a valid id. Do the same for resolveProjectTile, including a case where the tile id is missing or unknown.

Update the API route files to call loadStore and then use resolveProject or resolveProjectTile. Replace the duplicated trimming and lookup blocks with the helper result. When an error is returned, respond with NextResponse.json({ error: message }, { status }) using the helper values. Keep the rest of each route unchanged.

Run the unit tests with the project test command to confirm the new tests fail before the implementation and pass after. The command should be run from the repository root as:

    npm test

## Validation and Acceptance

Acceptance means that the API route error messages and status codes for missing or unknown projectId and tileId are unchanged, all updated routes rely on the shared helper, and the unit test suite passes.

Milestone 1 verification should follow this pattern: write tests in tests/unit/projectResolve.test.ts that assert the exact error status and message pairs for invalid input and that valid input returns the correct project or tile. Run npm test and confirm the new tests fail before implementation. Then implement src/lib/projects/resolve.ts to make the tests pass. Re-run npm test and confirm all unit tests pass. Commit the changes with the message "Milestone 1: Add project and tile resolution helpers".

Milestone 2 verification should follow this pattern: update the API route files listed in Context and Orientation to use resolveProject or resolveProjectTile and remove duplicated lookup logic. Run npm test again to ensure the full unit suite still passes. Commit the changes with the message "Milestone 2: Use shared project and tile resolution in API routes".

## Idempotence and Recovery

The helper and test additions are additive and can be re-run without side effects. If a route update causes a behavior regression, revert the affected route file to the previous lookup block while keeping the new helper and tests to localize the problem. Because no data migrations occur, rollback is safe by restoring previous route code.

## Artifacts and Notes

Expected test output after Milestone 1 and Milestone 2 should include vitest reporting all unit tests passing, with the new projectResolve test file listed in the run summary. For example:

    PASS  tests/unit/projectResolve.test.ts

## Interfaces and Dependencies

In src/lib/projects/resolve.ts, define two functions with stable shapes that are used by the API routes:

    export type ResolveError = { status: number; message: string };
    export type ResolveProjectResult =
      | { ok: true; projectId: string; project: Project }
      | { ok: false; error: ResolveError };
    export type ResolveProjectTileResult =
      | { ok: true; projectId: string; tileId: string; project: Project; tile: ProjectTile }
      | { ok: false; error: ResolveError };

    export const resolveProject = (store: ProjectsStore, projectId: string): ResolveProjectResult => { ... };
    export const resolveProjectTile = (
      store: ProjectsStore,
      projectId: string,
      tileId: string
    ): ResolveProjectTileResult => { ... };

These functions must not touch the filesystem and must not import NextResponse. They should only depend on ProjectsStore, Project, and ProjectTile types from src/lib/projects/types.

## Plan Update Notes

Updated progress, outcomes, and verification notes after completing both milestones and running the unit test suite to confirm behavior.
