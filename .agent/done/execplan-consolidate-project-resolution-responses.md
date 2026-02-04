# Consolidate project/tile resolution responses in API routes

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This plan must be maintained in accordance with `.agent/PLANS.md` in this repository.

## Purpose / Big Picture

Project and tile API routes repeatedly resolve workspace/tile IDs and translate resolution errors into `NextResponse` JSON errors. This duplication exists across multiple route handlers and makes error handling more scattered than it needs to be. After this change, a single shared helper will convert resolution errors into the correct `NextResponse`, and routes will reuse it. This keeps behavior identical while reducing repeated response boilerplate.

## Progress

- [x] (2026-01-29 21:16Z) Add shared project/tile resolution response helpers with unit tests. Tests: `npm test -- --run tests/unit/projectApiResolve.test.ts`.
- [x] (2026-01-29 21:16Z) Update project/tile API routes to use the shared helpers; re-run tests. Tests: `npm test -- --run tests/unit/projectResolve.test.ts`.

## Surprises & Discoveries

- None yet.

## Decision Log

- Decision: Centralize `resolveProject`/`resolveProjectTile` error-to-response conversion in a shared helper used by all project/tile API routes.
  Rationale: There are nine call sites with identical error response handling, so a shared helper reduces duplication with minimal behavior risk.
  Date/Author: 2026-01-29 / Codex

## Outcomes & Retrospective

- Centralized project/tile resolution error responses in `src/app/api/projects/resolveResponse.ts`, updated all project/tile routes to reuse the helper responses, and added unit coverage for error status/body matching. Behavior remains unchanged with less boilerplate.

Plan update note: Marked milestones complete with test evidence and recorded the outcome after implementation.

## Context and Orientation

Project/tile resolution lives in `src/lib/projects/resolve.ts` and returns `{ ok: false, error: { status, message } }` on invalid IDs. API routes under `src/app/api/projects/**` all call `resolveProject` or `resolveProjectTile`, then immediately return `NextResponse.json({ error: message }, { status })` when resolution fails. This logic is duplicated in the following routes:

- `src/app/api/projects/[projectId]/route.ts`
- `src/app/api/projects/[projectId]/tiles/route.ts`
- `src/app/api/projects/[projectId]/tiles/[tileId]/route.ts`
- `src/app/api/projects/[projectId]/tiles/[tileId]/workspace-files/route.ts`
- `src/app/api/projects/[projectId]/tiles/[tileId]/heartbeat/route.ts`
- `src/app/api/projects/[projectId]/discord/route.ts`

The goal is to create a shared helper that returns either the resolved project/tile data or a `NextResponse` ready to return, and then use that helper in the routes to replace the duplicated error response code.

## Plan of Work

Create a new helper module under `src/app/api/projects/resolveResponse.ts` that exports `resolveProjectOrResponse` and `resolveProjectTileOrResponse`. Each helper should accept a `ProjectsStore` and the relevant IDs, call the existing resolver, and return either `{ ok: true, ...resolved }` or `{ ok: false, response }` where `response` is `NextResponse.json({ error: message }, { status })`. Add unit tests that exercise both success and error cases to ensure response payloads and status codes match current behavior. Then update each API route to use the helper and remove inline error response boilerplate. Finally, run unit tests.

## Concrete Steps

From the repository root (`/Users/georgepickett/clawdbot-agent-ui`):

1) Inspect the current duplicated resolution handling.

    rg -n "resolveProject\(|resolveProjectTile\(" src/app/api/projects -g '*.ts'

2) Add `src/app/api/projects/resolveResponse.ts` with the shared helpers.

3) Add `tests/unit/projectApiResolve.test.ts` to cover success and error cases for both helpers.

4) Update the routes listed in Context to use the helpers and remove duplicated response construction.

5) Run tests.

    npm test -- --run tests/unit/projectApiResolve.test.ts
    npm test -- --run tests/unit/projectResolve.test.ts

## Validation and Acceptance

Acceptance is met when:

1) All project/tile API routes listed in Context use `resolveProjectOrResponse` or `resolveProjectTileOrResponse` and no longer manually build `NextResponse.json` error responses for resolution failures.
2) The new unit tests pass and confirm status codes and error bodies match existing behavior.
3) Existing unit tests continue to pass without modification.

Milestone 1: Shared helpers and unit tests.

- Tests to write: Create `tests/unit/projectApiResolve.test.ts` with at least four tests:
  - `it("resolveProjectOrResponse returns ok for valid id")` asserts `ok: true` and correct project data.
  - `it("resolveProjectOrResponse returns response for invalid id")` asserts `ok: false`, `response.status === 404`, and `await response.json()` equals `{ error: "Workspace not found." }`.
  - `it("resolveProjectTileOrResponse returns ok for valid ids")` asserts `ok: true` and correct tile data.
  - `it("resolveProjectTileOrResponse returns response for invalid tile")` asserts `ok: false`, `response.status === 404`, and `await response.json()` equals `{ error: "Tile not found." }`.
- Implementation: Add `src/app/api/projects/resolveResponse.ts` exporting:

      export type ProjectResolveResponse =
        | { ok: true; projectId: string; project: Project }
        | { ok: false; response: NextResponse };

      export type ProjectTileResolveResponse =
        | { ok: true; projectId: string; tileId: string; project: Project; tile: ProjectTile }
        | { ok: false; response: NextResponse };

      export const resolveProjectOrResponse: (store: ProjectsStore, projectId: string) => ProjectResolveResponse;
      export const resolveProjectTileOrResponse: (store: ProjectsStore, projectId: string, tileId: string) => ProjectTileResolveResponse;

  Each helper should call the existing resolver and translate error into `NextResponse.json({ error: message }, { status })`.
- Verification: Run `npm test -- --run tests/unit/projectApiResolve.test.ts` and confirm all tests pass.
- Commit: Commit with message `Milestone 1: add project resolution response helpers`.

Milestone 2: Update API routes to use helpers.

- Tests to write: No new tests required beyond milestone 1.
- Implementation: Replace inline resolution error handling in the routes with the new helpers. Keep all other logic intact.
- Verification: Run `npm test -- --run tests/unit/projectResolve.test.ts` and confirm it passes.
- Commit: Commit with message `Milestone 2: use resolution helpers in project routes`.

## Idempotence and Recovery

Changes are safe to re-run. The helpers are pure and routes remain behavior-compatible. If a step fails, revert the last edits and re-apply.

## Artifacts and Notes

After the refactor, the route files should not include any `NextResponse.json({ error: ... }, { status: ... })` blocks that are directly tied to `resolveProject` or `resolveProjectTile` failures.

## Interfaces and Dependencies

The helper module should live at `src/app/api/projects/resolveResponse.ts`, depend on `next/server` for `NextResponse`, and rely on existing resolver functions from `src/lib/projects/resolve.ts`. No other dependencies are required.
