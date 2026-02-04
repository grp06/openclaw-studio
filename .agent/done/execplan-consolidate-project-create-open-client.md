# Consolidate project create/open client API into one function

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This plan must be maintained in accordance with `.agent/PLANS.md`.

## Purpose / Big Picture

Creating a workspace by name and opening a workspace by path both call the same POST `/api/projects` endpoint and return the same response shape. Today that flow is split into separate client functions (`createProject`, `openProject`) and separate type aliases (`ProjectCreatePayload`, `ProjectCreateResult`). This creates extra concepts without adding behavior. After this change, there will be a single client entry point for create/open that accepts the existing `ProjectCreateOrOpenPayload`, and the store/UI will call it for either case. The UI behavior and server API remain unchanged, but the client surface area is smaller and easier to learn.

## Progress

- [x] (2026-01-30 03:05Z) Drafted ExecPlan and recorded scope, constraints, and acceptance criteria.
- [x] (2026-01-30 03:08Z) Updated types, client API, and store/UI callers to use a single create/open function.
- [x] (2026-01-30 03:08Z) Added unit tests and verified behavior.

## Surprises & Discoveries

None yet.

## Decision Log

- Decision: Replace separate `createProject`/`openProject` client functions and `ProjectCreatePayload`/`ProjectCreateResult` aliases with a single `createOrOpenProject` that accepts `ProjectCreateOrOpenPayload`.
  Rationale: Both actions hit the same API path with the same response type, so a single function reduces concepts and keeps behavior identical.
  Date/Author: 2026-01-30 (Codex)

## Outcomes & Retrospective

2026-01-30: Replaced separate create/open client APIs with `createOrOpenProject`, updated UI/store callers, removed redundant types, and verified client tests pass.

## Context and Orientation

The workspace create/open workflow lives on the client side in `src/lib/projects/client.ts`, which currently exports `createProject` (name payload) and `openProject` (path payload). Those types are defined in `src/lib/projects/types.ts` as `ProjectCreatePayload` and `ProjectCreateResult`, even though the API route `src/app/api/projects/route.ts` uses a single `ProjectCreateOrOpenPayload` and `ProjectCreateOrOpenResult`. The canvas store in `src/features/canvas/state/store.tsx` calls the two client functions separately, and the main UI in `src/app/page.tsx` calls the store functions for create/open. The goal is to reduce client API surface area without changing API behavior.

## Plan of Work

First, consolidate the types in `src/lib/projects/types.ts` by removing `ProjectCreatePayload` and `ProjectCreateResult` and using `ProjectCreateOrOpenPayload` and `ProjectCreateOrOpenResult` everywhere. Next, update `src/lib/projects/client.ts` to export a single `createOrOpenProject` function that accepts `ProjectCreateOrOpenPayload` and returns `ProjectCreateOrOpenResult`, and remove the old `createProject` and `openProject` exports. Then update `src/features/canvas/state/store.tsx` to expose one `createOrOpenProject` store action (or equivalent) and update `src/app/page.tsx` call sites to pass either `{ name }` or `{ path }` based on user input. Finally, add unit tests in `tests/unit/projectsClient.test.ts` to assert that `createOrOpenProject` POSTs to `/api/projects` with either payload shape, and run the relevant tests to validate behavior.

## Concrete Steps

1) Locate all client uses of `createProject` and `openProject` to update call sites:

    rg "createProject\(|openProject\(" -n src tests

2) Update `src/lib/projects/types.ts`:
   - Remove `ProjectCreatePayload` and `ProjectCreateResult` exports.
   - Ensure callers use `ProjectCreateOrOpenPayload` and `ProjectCreateOrOpenResult` instead.

3) Update `src/lib/projects/client.ts`:
   - Replace `createProject` and `openProject` with `createOrOpenProject` that accepts `ProjectCreateOrOpenPayload`.
   - Ensure it still POSTs to `/api/projects` and returns `ProjectCreateOrOpenResult`.

4) Update `src/features/canvas/state/store.tsx`:
   - Replace store actions `createProject` and `openProject` with a single action that accepts a `ProjectCreateOrOpenPayload` and updates state with the returned store.
   - Update the `StoreContextValue` type accordingly.

5) Update `src/app/page.tsx`:
   - Replace calls to `createProject` and `openProject` with the new store action, passing `{ name }` or `{ path }` depending on the user action.

6) Update `tests/unit/projectsClient.test.ts`:
   - Add a test that `createOrOpenProject({ name: "Demo" })` calls `fetchJson` with the POST payload `{ name: "Demo" }`.
   - Add a test that `createOrOpenProject({ path: "/tmp/demo" })` calls `fetchJson` with the POST payload `{ path: "/tmp/demo" }`.

## Validation and Acceptance

Acceptance means there is a single client entry point for create/open and no remaining imports of `createProject` or `openProject`. The UI should still create and open workspaces successfully because the payloads and API endpoint are unchanged. Unit tests should confirm the client POSTs the correct payload shapes.

Milestone 1: Consolidate client create/open API and update callers.

Tests to write:
- In `tests/unit/projectsClient.test.ts`, add:
  - `createOrOpenProject posts name payload` asserting `fetchJson` called with `/api/projects`, `POST`, and `body: JSON.stringify({ name: "Demo" })`.
  - `createOrOpenProject posts path payload` asserting the same call with `{ path: "/tmp/demo" }`.

Implementation:
- Update `src/lib/projects/types.ts`, `src/lib/projects/client.ts`, `src/features/canvas/state/store.tsx`, and `src/app/page.tsx` to use a single `createOrOpenProject` function and payload type.

Verification:
- Run `npm run test -- tests/unit/projectsClient.test.ts` from the repo root and confirm all tests pass. If positional paths are unsupported, run `npx vitest tests/unit/projectsClient.test.ts`.

Commit:
- After tests pass, commit with message `Milestone 1: Consolidate project create/open client API`.

## Idempotence and Recovery

These edits are safe to repeat because they only replace function/type exports and update imports. If a step fails, restore the removed exports and revert call sites to the previous function names, then retry the consolidation. No directories are removed.

## Artifacts and Notes

Expected file changes include removing `ProjectCreatePayload` and `ProjectCreateResult` from `src/lib/projects/types.ts`, adding `createOrOpenProject` in `src/lib/projects/client.ts`, updating store/UI callers, and expanding `tests/unit/projectsClient.test.ts` with the new assertions.

## Interfaces and Dependencies

The consolidated client API should expose this signature in `src/lib/projects/client.ts`:

    createOrOpenProject(payload: ProjectCreateOrOpenPayload) => Promise<ProjectCreateOrOpenResult>

The store should expose a single action that accepts the same payload type and returns `{ warnings: string[] } | null` after updating local state. The API endpoint remains `/api/projects` (POST) and is already handled by `src/app/api/projects/route.ts`.

Plan update (2026-01-30 03:08Z): Marked implementation and validation complete after code changes and passing tests.
