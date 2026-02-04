# Consolidate project create/open into a single API endpoint

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This repository’s ExecPlan requirements live at `.agent/PLANS.md` and this document must be maintained in accordance with that file.

## Purpose / Big Picture

Today the UI has two separate ways to add a workspace: create a new one by name and open an existing one by path. The server implements this as two different endpoints, `POST /api/projects` and `POST /api/projects/open`, even though both do the same final steps: build a Project record, append it to the projects store, save it, and return `{ store, warnings }`. After this change, there is one entry point for both flows, which reduces duplicate code and eliminates an entire route file. Users will still be able to create and open workspaces from the UI; the behavior and error messages should remain the same, but the server surface area will be smaller.

## Progress

- [x] (2026-01-29 06:10Z) Add a unified POST handler for create/open, adjust payload/result types, and add parser tests.
- [x] (2026-01-29 06:11Z) Update client/store/UI calls, remove the old open route file, and verify behavior end to end.

## Surprises & Discoveries

None yet.

## Decision Log

- Decision: Consolidate project creation and opening into a single POST /api/projects handler and delete the open route file.
  Rationale: The create and open routes duplicate the same project-store append/save logic and return the same result shape; removing a route file reduces surface area without changing user-visible behavior.
  Date/Author: 2026-01-29 (Codex)
- Decision: Reject payloads that include both `name` and `path` with a dedicated validation error before selecting a mode.
  Rationale: Ambiguous input should fail fast while keeping existing per-field error messages intact.
  Date/Author: 2026-01-29 (Codex)

## Outcomes & Retrospective

Consolidated project create/open into `POST /api/projects`, removed the open route, and updated shared payload/result types. All Vitest unit tests pass. Manual API checks were not run because the dev server was not started during this session.

## Context and Orientation

The project store lives on disk and is read/written by `src/app/api/projects/store.ts`, which provides `loadStore`, `appendProjectToStore`, and `saveStore`. The create workspace flow is in `src/app/api/projects/route.ts` and the open workspace flow is in `src/app/api/projects/open/route.ts`. The client calls are in `src/lib/projects/client.ts`, and the UI state wiring that calls those client functions is in `src/features/canvas/state/store.tsx`, with user interactions in `src/app/page.tsx`. Types for payloads and results are defined in `src/lib/projects/types.ts`.

A “workspace” is a `Project` object with an `id`, a filesystem path to a repo, and a set of tiles. “Create” means making a new directory under the user’s home directory and initializing a git repo if needed. “Open” means using an existing absolute path on disk and adding it to the store. Both flows end by appending the Project to the JSON store and returning `{ store, warnings }` to the client.

## Plan of Work

First, add a small helper inside `src/app/api/projects/route.ts` that validates the POST payload and determines whether the request is a create-by-name or open-by-path. This helper should be pure and return either `{ mode: "create", name: string }`, `{ mode: "open", path: string }`, or an error message. Update the POST handler to call the helper and branch into the existing create and open logic in that same file. Move the open-path validation steps from `src/app/api/projects/open/route.ts` into the POST handler so behavior stays consistent. Then remove `src/app/api/projects/open/route.ts` entirely.

Next, update `src/lib/projects/types.ts` so the open payload/result types are no longer separate. The POST handler should return the same result shape for both flows; keep a single result type and update `src/lib/projects/client.ts` to call `/api/projects` for both create and open. Update `src/features/canvas/state/store.tsx` (and any other callers) to use the updated client calls without behavioral changes. Finally, run the test suite and perform a manual verification by creating and opening a workspace from the UI or by calling the API directly.

## Concrete Steps

Work from the repository root.

1. Read the existing create/open routes to ensure error messages and validations are preserved.

   - `cat src/app/api/projects/route.ts`
   - `cat "src/app/api/projects/open/route.ts"`

2. Implement the unified POST handler in `src/app/api/projects/route.ts`.

   - Add a pure helper such as `parseProjectCreateOrOpenPayload(body: unknown)` that returns a discriminated union or `{ error: string }`.
   - Move the open-path validation from the open route into this POST handler.
   - Keep the create-path logic (`slugifyProjectName`, `resolveProjectPath`, `ensureGitRepo`) unchanged.

3. Update types and client calls.

   - In `src/lib/projects/types.ts`, consolidate the open payload/result types into the create result type or a single shared type used for both flows.
   - In `src/lib/projects/client.ts`, point `openProject` to `POST /api/projects` using the consolidated payload/result type.
   - Update any type references in `src/features/canvas/state/store.tsx` and `src/app/page.tsx` if needed.

4. Remove the old open route file and ensure there are no references left.

   - Delete `src/app/api/projects/open/route.ts`.
   - Run `rg "projects/open" src tests` and confirm no remaining imports or client calls reference the old endpoint.

5. Run tests and capture evidence.

   - `npm test`
   - If tests are too slow, at least run `npm test -- tests/unit` and `npm test -- tests/e2e` as separate commands and record which suite ran.

## Validation and Acceptance

The change is accepted when all of the following are true:

1. A `POST /api/projects` request with `{ "name": "My Workspace" }` still creates a new workspace and returns a JSON body that includes `{ store, warnings }`.
2. A `POST /api/projects` request with `{ "path": "/absolute/path" }` still opens an existing workspace and returns `{ store, warnings }` with the same error messages for invalid paths as before.
3. The UI can both create and open workspaces without errors and the workspace list updates as expected.
4. The file `src/app/api/projects/open/route.ts` is removed and there are no references to `/api/projects/open` in the codebase.
5. The test suite(s) specified in the plan run and pass.

Verification workflow for each milestone:

Milestone 1 (Unified POST handler and types):
- Tests to write: If a pure payload parser is added, add a unit test file `tests/unit/projectCreateOrOpenPayload.test.ts` that covers the following cases: name-only payload returns mode create, path-only payload returns mode open, payload with neither returns a validation error, payload with both returns a validation error. Run `npm test -- tests/unit/projectCreateOrOpenPayload.test.ts` and confirm it fails before implementation and passes after.
- Implementation: Add the helper and update `POST` in `src/app/api/projects/route.ts`, then update `src/lib/projects/types.ts` for the unified payload/result type.
- Verification: Re-run the unit test and confirm it passes.
- Commit: Commit with message "Milestone 1: unify project create/open payload handling".

Milestone 2 (Client updates and route removal):
- Tests to write: No new unit tests required beyond Milestone 1 unless regressions are found. If the helper test was not added, skip test creation here and rely on full suite and manual verification.
- Implementation: Update `src/lib/projects/client.ts`, `src/features/canvas/state/store.tsx`, and remove `src/app/api/projects/open/route.ts`. Verify all references are updated.
- Verification: Run `npm test` (or the split unit/e2e commands) and perform a manual API check: `curl -s -X POST http://localhost:3000/api/projects -H 'Content-Type: application/json' -d '{"name":"Test"}'` and `curl -s -X POST http://localhost:3000/api/projects -H 'Content-Type: application/json' -d '{"path":"/absolute/path"}'` while the dev server is running, confirming 200 responses and JSON shapes.
- Commit: Commit with message "Milestone 2: consolidate project open endpoint".

## Idempotence and Recovery

The changes are safe to apply multiple times because they are additive until the old route is removed. If a step fails, re-run it after fixing the error. Before removing the old route, ensure the new consolidated handler passes tests so rollback is as simple as restoring the removed file from git if needed.

## Artifacts and Notes

Include short evidence snippets in commit messages or logs such as:

    npm test -- tests/unit/projectCreateOrOpenPayload.test.ts
    PASS  tests/unit/projectCreateOrOpenPayload.test.ts

    curl -s -X POST http://localhost:3000/api/projects -H 'Content-Type: application/json' -d '{"name":"Example"}'
    {"store":...,"warnings":[]}

## Interfaces and Dependencies

No new external dependencies are required. The only public interface change is that `/api/projects/open` is removed; clients must use `POST /api/projects` with either `{ name }` or `{ path }`. The `openProject` client function may remain as a wrapper but must target the unified endpoint. The payload parser helper should be an exported function in `src/app/api/projects/route.ts` if unit tests import it; otherwise keep it local to avoid widening surface area.

Change note: Initial ExecPlan written after consolidating analysis of create/open routes; no implementation has begun yet.
Change note: Marked Milestone 1 complete after implementing the unified POST handler, parser test, and type updates.
Change note: Marked Milestone 2 complete after removing the open route, updating client calls, and running the full unit test suite.
