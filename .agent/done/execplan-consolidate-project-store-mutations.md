# Consolidate projects store mutations in API routes

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This plan must be maintained in accordance with `.agent/PLANS.md` in this repository.

## Purpose / Big Picture

Project and tile API routes currently reimplement the same store mutation logic (mapping projects, setting `version: 2`, updating `updatedAt` timestamps). The behavior is consistent today, but it is scattered across multiple route files. After this change, there will be a single shared set of store mutation helpers in `src/app/api/projects/store.ts` that all project and tile routes reuse. This reduces the cognitive load for future changes to the store shape, while keeping external behavior identical.

## Progress

- [x] (2026-01-29 21:04Z) Add shared store mutation helpers with unit tests that define their behavior. Tests: `npm test -- --run tests/unit/projectsStore.test.ts`.
- [x] (2026-01-29 21:05Z) Update project and tile API routes to use the shared helpers; re-run tests. Tests: `npm test -- --run tests/unit/projectResolve.test.ts`.

## Surprises & Discoveries

- None yet.

## Decision Log

- Decision: Centralize project/tile store mutation helpers in `src/app/api/projects/store.ts` and reuse them across API routes.
  Rationale: This file already owns store persistence and normalization, so keeping pure mutation helpers alongside it minimizes blast radius and avoids new modules.
  Date/Author: 2026-01-29 / Codex

## Outcomes & Retrospective

- Centralized project/tile store mutations into `src/app/api/projects/store.ts`, updated all project and tile routes to use the helpers, and added unit coverage to lock in deterministic `updatedAt` behavior. Store behavior remains unchanged with fewer duplicated code paths.

Plan update note: Marked milestones complete with test evidence and recorded the outcome after implementation.

## Context and Orientation

`src/app/api/projects/store.ts` currently owns store persistence (load/save) and normalization. Project and tile API routes perform their own store mutations by mapping `store.projects` and setting `version: 2` and `updatedAt` timestamps. The most duplicated patterns live in:

- `src/app/api/projects/route.ts` (create workspace)
- `src/app/api/projects/open/route.ts` (open workspace)
- `src/app/api/projects/[projectId]/route.ts` (delete workspace)
- `src/app/api/projects/[projectId]/tiles/route.ts` (create tile)
- `src/app/api/projects/[projectId]/tiles/[tileId]/route.ts` (delete/rename tile)

The goal is to create pure helper functions for these mutations in `src/app/api/projects/store.ts` and use them in the routes to avoid repeated mapping logic.

## Plan of Work

First, add new helper functions to `src/app/api/projects/store.ts` for creating and mutating projects and tiles. Keep them pure and deterministic by optionally accepting a `now` argument (defaulting to `Date.now()`) so tests can set timestamps without mocking time. Next, add unit tests in `tests/unit/projectsStore.test.ts` that cover each helper’s core behavior (adding/removing projects, adding/removing/updating tiles, and updating `updatedAt`). Then update the API routes to use these helpers instead of manual project list mapping. Finally, run the unit tests to confirm behavior is unchanged.

## Concrete Steps

Run these commands from the repository root (`/Users/georgepickett/clawdbot-agent-ui`).

1) Inspect the existing store mutations to confirm duplicated patterns.

    rg -n "updatedAt: Date\.now\(\)|version: 2" src/app/api/projects -g '*.ts'

2) Add helper functions to `src/app/api/projects/store.ts`.

3) Extend `tests/unit/projectsStore.test.ts` with new tests for the helpers.

4) Update the route handlers in `src/app/api/projects/route.ts`, `src/app/api/projects/open/route.ts`, `src/app/api/projects/[projectId]/route.ts`, `src/app/api/projects/[projectId]/tiles/route.ts`, and `src/app/api/projects/[projectId]/tiles/[tileId]/route.ts` to use the new helpers.

5) Run tests to confirm no regressions.

    npm test -- --run tests/unit/projectsStore.test.ts
    npm test -- --run tests/unit/projectResolve.test.ts

## Validation and Acceptance

Acceptance is met when all of the following are true:

1) Project and tile API routes no longer build new stores with inline `map`/`filter` mutations for standard operations, and instead call helpers from `src/app/api/projects/store.ts`.
2) Unit tests for the new helpers pass and demonstrate deterministic `updatedAt` changes.
3) Existing unit tests continue to pass without modification.

For each milestone, use this verification workflow:

Milestone 1: Shared store mutation helpers and tests.

- Tests to write: Extend `tests/unit/projectsStore.test.ts` with a new `describe("store mutations")` block and add tests:
  - `it("adds a project and sets it active")`: Create a base store, call `appendProjectToStore(store, project)`, and assert `activeProjectId` equals the new project id and the project is appended.
  - `it("removes a project and normalizes active selection")`: Create a store with two projects, call `removeProjectFromStore`, and assert the removed project is absent and `activeProjectId` points to the remaining project (or null if none).
  - `it("adds a tile and updates updatedAt")`: Create a store with one project, call `addTileToProject(store, projectId, tile, now)`, and assert the tile count increases and `updatedAt` equals the provided `now`.
  - `it("updates a tile and updates updatedAt")`: Call `updateTileInProject(store, projectId, tileId, patch, now)` and assert tile fields are updated and `updatedAt` equals `now`.
  - `it("removes a tile and reports removal")`: Call `removeTileFromProject(store, projectId, tileId, now)` and assert `removed` is true, tile is removed, and `updatedAt` equals `now`.
- Implementation: Add helper exports in `src/app/api/projects/store.ts` with signatures:

      export const appendProjectToStore: (store: ProjectsStore, project: Project) => ProjectsStore;
      export const removeProjectFromStore: (store: ProjectsStore, projectId: string) => { store: ProjectsStore; removed: boolean };
      export const addTileToProject: (store: ProjectsStore, projectId: string, tile: ProjectTile, now?: number) => ProjectsStore;
      export const updateTileInProject: (store: ProjectsStore, projectId: string, tileId: string, patch: Partial<ProjectTile>, now?: number) => ProjectsStore;
      export const removeTileFromProject: (store: ProjectsStore, projectId: string, tileId: string, now?: number) => { store: ProjectsStore; removed: boolean };

  Keep `normalizeProjectsStore`, `loadStore`, and `saveStore` behavior unchanged.
- Verification: Run `npm test -- --run tests/unit/projectsStore.test.ts` and confirm all tests pass.
- Commit: Commit with message `Milestone 1: add project store mutation helpers`.

Milestone 2: Update API routes to use the helpers.

- Tests to write: No new tests required beyond milestone 1; rely on existing unit tests.
- Implementation: Replace inline `store.projects.map`/`filter` mutations in the routes listed above with calls to the new helpers. Preserve existing validation and error handling logic. If a route previously checked whether a tile or project was actually removed, use the helper’s `removed` boolean to keep the same behavior.
- Verification: Run `npm test -- --run tests/unit/projectResolve.test.ts` and confirm it passes.
- Commit: Commit with message `Milestone 2: use shared store mutation helpers in project routes`.

## Idempotence and Recovery

These changes are safe to re-run. The helpers are pure, and route behavior should remain identical. If a step fails, revert the last edits and re-apply. No migrations or data loss are involved.

## Artifacts and Notes

After the refactor, searching for `updatedAt: Date.now()` in the API route files should yield only the helper implementations in `src/app/api/projects/store.ts` (if any), not route-specific copies.

## Interfaces and Dependencies

The helper functions live in `src/app/api/projects/store.ts` and must be pure (no filesystem access). They should rely only on the `ProjectsStore`, `Project`, and `ProjectTile` types from `src/lib/projects/types` and the existing `normalizeProjectsStore` behavior in the same module.
