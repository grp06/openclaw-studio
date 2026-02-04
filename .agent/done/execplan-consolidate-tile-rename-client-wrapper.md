# Consolidate project tile rename/update client wrappers

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This repository’s ExecPlan requirements live at `.agent/PLANS.md` and this document must be maintained in accordance with that file.

## Purpose / Big Picture

The UI currently exposes two client wrappers for the same project tile PATCH endpoint: `renameProjectTile` and `updateProjectTile`. They call the exact same URL with the same HTTP method and differ only in payload shape, while the server accepts a unified `ProjectTileUpdatePayload`. Consolidating these wrappers removes redundant types and reduces API surface area without changing any behavior. Users will still rename tiles and update avatars exactly as before; the change only simplifies the client and state layer.

## Progress

- [x] (2026-01-29 06:24Z) Remove the duplicate rename wrapper/types and add a unit test that asserts the unified client wrapper sends the expected PATCH request.
- [x] (2026-01-29 06:26Z) Update the canvas store to use the unified wrapper for rename, then run full tests and typecheck.

## Surprises & Discoveries

None yet.

## Decision Log

- Decision: Remove `renameProjectTile` and its payload/result types, and use `updateProjectTile` for all tile PATCH operations.
  Rationale: Both client wrappers hit the same endpoint and the server already accepts a unified payload; consolidation reduces surface area with minimal risk.
  Date/Author: 2026-01-29 (Codex)

## Outcomes & Retrospective

Removed redundant rename payload/types and wrapper, updated the canvas store to use `updateProjectTile`, and added a client test for the PATCH request. Full test suite, build, and typecheck pass.

## Context and Orientation

Client API wrappers live in `src/lib/projects/client.ts`. The server endpoint for tile updates is `PATCH /api/projects/:projectId/tiles/:tileId`, implemented in `src/app/api/projects/[projectId]/tiles/[tileId]/route.ts`, and it already accepts a `ProjectTileUpdatePayload` (`src/lib/projects/types.ts`) that includes optional `name` and `avatarSeed`. The UI state layer is `src/features/canvas/state/store.tsx`, which currently exposes `renameTile` and `updateTile` methods that call the two different wrappers. The duplication is entirely on the client side.

## Plan of Work

First, remove the redundant rename payload/result types from `src/lib/projects/types.ts` and delete the `renameProjectTile` wrapper from `src/lib/projects/client.ts`. Update any imports so only `updateProjectTile` remains for tile PATCH operations.

Second, update `src/features/canvas/state/store.tsx` so the `renameTile` action calls `updateProjectTile` with `{ name }` instead of `renameProjectTile`. Keep the local optimistic update and error rollback behavior unchanged.

Finally, add a unit test that validates the unified wrapper sends the expected PATCH request. Mock `fetchJson` from `src/lib/http` and assert that calling `updateProjectTile` with a name produces the same endpoint and request shape previously used by the rename wrapper. Run the focused unit test, then run the full unit suite and typecheck.

## Concrete Steps

Work from the repository root.

1. Update client types and wrappers:
   - Remove `ProjectTileRenamePayload` and `ProjectTileRenameResult` from `src/lib/projects/types.ts`.
   - Delete `renameProjectTile` from `src/lib/projects/client.ts` and remove its imports.

2. Update the canvas store to use the unified wrapper:
   - In `src/features/canvas/state/store.tsx`, replace `apiRenameProjectTile` usage with `apiUpdateProjectTile` in `renameTile`.
   - Keep the optimistic UI update and rollback logic intact.

3. Add/extend unit tests:
   - Create `tests/unit/projectsClient.test.ts` (or extend an existing client test file if one exists).
   - Mock `fetchJson` and assert that `updateProjectTile("project", "tile", { name: "New" })` calls `fetchJson` with the PATCH URL and body `{"name":"New"}`.
   - Run `npm test -- tests/unit/projectsClient.test.ts`.

4. Run validation commands:
   - `npm test`
   - `npm run typecheck`

## Validation and Acceptance

The change is accepted when all of the following are true:

1. There is only one client wrapper for tile PATCH operations (`updateProjectTile`).
2. `renameTile` in the canvas store uses `updateProjectTile` and behaves the same as before.
3. The new/updated unit test for `updateProjectTile` passes and verifies the expected request shape.
4. `npm test` and `npm run typecheck` pass.

Verification workflow for each milestone:

Milestone 1 (types + wrapper + test):
- Tests to write: Add `tests/unit/projectsClient.test.ts` with a test that mocks `fetchJson`, calls `updateProjectTile` with `{ name: "New" }`, and asserts the PATCH URL and payload. Run `npm test -- tests/unit/projectsClient.test.ts` and confirm it fails before implementation and passes after.
- Implementation: Remove rename payload/result types from `src/lib/projects/types.ts`, delete `renameProjectTile` from `src/lib/projects/client.ts`, and update test imports accordingly.
- Verification: Re-run the focused test and confirm it passes.
- Commit: Commit with message "Milestone 1: consolidate tile rename client types".

Milestone 2 (store update + full verification):
- Tests to write: No new tests beyond Milestone 1 unless regressions appear.
- Implementation: Update `src/features/canvas/state/store.tsx` to call `updateProjectTile` from `renameTile` and remove unused imports.
- Verification: Run `npm test` and `npm run typecheck`.
- Commit: Commit with message "Milestone 2: use updateProjectTile for rename in canvas store".

## Idempotence and Recovery

These changes are safe to apply incrementally. If the store update causes issues, revert `src/features/canvas/state/store.tsx` to its previous import and wrapper usage while keeping the client consolidation intact. Keep commits per milestone for easy rollback.

## Artifacts and Notes

Include short evidence snippets in commit logs such as:

    npm test -- tests/unit/projectsClient.test.ts
    PASS  tests/unit/projectsClient.test.ts

## Interfaces and Dependencies

No new dependencies are required. The unified client function signature remains:

    export const updateProjectTile = (
      projectId: string,
      tileId: string,
      payload: ProjectTileUpdatePayload
    ) => Promise<ProjectTileUpdateResult>;

`ProjectTileUpdatePayload` already covers both `name` and `avatarSeed`, so no server-side changes are needed.

Change note: Initial ExecPlan written for consolidating the tile rename/update client wrappers; no implementation has begun yet.
Change note: Marked Milestone 1 complete after consolidating types/wrapper and adding a client test.
Change note: Marked Milestone 2 complete after updating the store and running full tests and typecheck.
