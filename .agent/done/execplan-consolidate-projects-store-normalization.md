# Consolidate ProjectsStore normalization

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This repository does not include PLANS.md. The source of truth for this plan is `.agent/PLANS.md` from the repository root; this document must be maintained in accordance with `.agent/PLANS.md`.

## Purpose / Big Picture

ProjectsStore normalization logic is currently duplicated across API routes, which risks divergence and makes updates harder. After this change, the canonical normalization behavior will live in one place, and all routes will call that shared helper. A user will see consistent active workspace selection across create/open/delete flows because all routes use the same normalization rules.

## Progress

- [x] (2026-01-29 04:22Z) Add a shared `normalizeProjectsStore` helper to `src/app/api/projects/store.ts` and cover it with unit tests.
- [x] (2026-01-29 04:22Z) Replace duplicated normalization logic in `src/app/api/projects/route.ts`, `src/app/api/projects/open/route.ts`, and `src/app/api/projects/[projectId]/route.ts` with the shared helper.
- [x] (2026-01-29 04:22Z) Verify tests and typecheck after refactor.

## Surprises & Discoveries

None yet.

## Decision Log

- Decision: Centralize ProjectsStore normalization in the API store module rather than a new lib module.
  Rationale: The helper is server-only today, and colocating it with `loadStore`/`saveStore` minimizes surface area and avoids introducing a new cross-layer dependency.
  Date/Author: 2026-01-29, Codex.

## Outcomes & Retrospective

ProjectsStore normalization now lives in `src/app/api/projects/store.ts` and is reused by all project-related routes. The new unit tests cover empty, valid, invalid, and non-array project lists. `npm test -- tests/unit/projectsStore.test.ts` and `npm run typecheck` both pass.

## Context and Orientation

ProjectsStore normalization appears in multiple API routes. Both `src/app/api/projects/route.ts` and `src/app/api/projects/open/route.ts` define identical `normalizeProjectsStore` functions, while `src/app/api/projects/[projectId]/route.ts` hand-rolls similar active-project fallback logic after deletions. The central store module `src/app/api/projects/store.ts` already defines `defaultStore`, `loadStore`, and `saveStore` but does not provide a shared normalization helper. Consolidating normalization into `src/app/api/projects/store.ts` will remove duplication and ensure all routes produce the same active project selection behavior.

## Plan of Work

First, add `normalizeProjectsStore` to `src/app/api/projects/store.ts` using the existing logic from the routes, and export it. Next, create unit tests that exercise normalization scenarios so the behavior is pinned before refactoring call sites. Then, update `src/app/api/projects/route.ts`, `src/app/api/projects/open/route.ts`, and `src/app/api/projects/[projectId]/route.ts` to import the shared helper and delete their local copies or redundant logic. Finally, run the targeted unit test and `npm run typecheck` to ensure nothing regressed.

## Concrete Steps

From the repository root `/Users/georgepickett/clawdbot-agent-ui`:

1. Add a shared helper in `src/app/api/projects/store.ts`:

   - Export `normalizeProjectsStore(store: ProjectsStore): ProjectsStore`.
   - Reuse the current normalization logic: ensure `projects` is an array, ensure `activeProjectId` is either valid or falls back to the first project, and set `version` to the current store version constant.

2. Create tests in `tests/unit/projectsStore.test.ts` that validate:

   - When `projects` is empty, `activeProjectId` becomes null and `version` is set to 2.
   - When `activeProjectId` is not in the list, the first project id is chosen.
   - When `activeProjectId` exists, it is preserved.
   - When `projects` is missing or non-array (if the helper accepts a partially typed input), it normalizes to an empty list.

3. Replace local normalization:

   - In `src/app/api/projects/route.ts`, remove the local `normalizeProjectsStore` function and import the shared helper from `src/app/api/projects/store.ts`.
   - In `src/app/api/projects/open/route.ts`, remove its local `normalizeProjectsStore` and import the shared helper.
   - In `src/app/api/projects/[projectId]/route.ts`, replace manual active-project fallback logic with a call to `normalizeProjectsStore` on the updated store object.

4. Run tests and typecheck:

   npm test -- tests/unit/projectsStore.test.ts
   npm run typecheck

## Validation and Acceptance

Acceptance means all routes that normalize ProjectsStore call the shared helper, no duplicate normalization helpers remain in route files, and the unit tests verify active-project fallback behavior across empty, valid, and invalid `activeProjectId` scenarios.

Verification workflow by milestone:

Milestone 1: Shared normalization helper + tests.
- Tests to write: Add `tests/unit/projectsStore.test.ts` with the scenarios listed above. Run `npm test -- tests/unit/projectsStore.test.ts` and confirm the tests fail before the helper exists.
- Implementation: Add and export `normalizeProjectsStore` in `src/app/api/projects/store.ts`.
- Verification: Re-run `npm test -- tests/unit/projectsStore.test.ts` and confirm all tests pass.
- Commit: `git commit -am "Milestone 1: add ProjectsStore normalization helper"`.

Milestone 2: Route integration.
- Tests to write: No new tests required beyond the existing unit test from Milestone 1.
- Implementation: Update `src/app/api/projects/route.ts`, `src/app/api/projects/open/route.ts`, and `src/app/api/projects/[projectId]/route.ts` to use the shared helper and delete local duplication.
- Verification: Run `npm test -- tests/unit/projectsStore.test.ts` and `npm run typecheck`.
- Commit: `git commit -am "Milestone 2: use shared ProjectsStore normalization"`.

## Idempotence and Recovery

These steps are safe to rerun. If a refactor introduces unexpected behavior, restore the previous route-local normalization function and re-run the unit test to isolate the change. The helper is pure, so rollback is limited to the route files and the helper module.

## Artifacts and Notes

Expected unit test transcript example:

    $ npm test -- tests/unit/projectsStore.test.ts
    ✓ tests/unit/projectsStore.test.ts (3)

## Interfaces and Dependencies

`src/app/api/projects/store.ts` should export:

- `normalizeProjectsStore(store: ProjectsStore): ProjectsStore`

The helper must be pure and should not access the filesystem. It should use the existing store version constant to set `version` and should only select `activeProjectId` from the provided `projects` list or null when the list is empty.

Plan update (2026-01-29 04:22Z): Marked milestones complete and recorded test/typecheck results after refactoring.
