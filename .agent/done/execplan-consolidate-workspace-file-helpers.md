# Consolidate workspace files read/write helpers

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This plan must be maintained in accordance with `.agent/PLANS.md` in this repository.

## Purpose / Big Picture

Workspace files (AGENTS.md, SOUL.md, etc.) are read and written through the workspace-files API route, which currently duplicates filesystem loops for reading and writing each file. After this change, there will be a single shared set of workspace file read/write helpers in `src/lib/projects/workspaceFiles.server.ts` that the API route uses. This keeps behavior identical while reducing duplicated file handling logic.

## Progress

- [x] (2026-01-29 21:10Z) Add shared workspace file read/write helpers with unit tests that define their behavior. Tests: `npm test -- --run tests/unit/workspaceFiles.test.ts`.
- [x] (2026-01-29 21:10Z) Update workspace-files API route to use the shared helpers; re-run tests. Tests: `npm test -- --run tests/unit/projectResolve.test.ts`.

## Surprises & Discoveries

- None yet.

## Decision Log

- Decision: Centralize workspace file read/write helpers in `src/lib/projects/workspaceFiles.server.ts` and reuse them in the workspace-files API route.
  Rationale: The server helper module already owns workspace file provisioning and per-file reads, so adding list-level helpers there minimizes blast radius while removing duplicated filesystem loops.
  Date/Author: 2026-01-29 / Codex

## Outcomes & Retrospective

- Centralized workspace file list read/write logic in `src/lib/projects/workspaceFiles.server.ts`, updated the API route to use the helpers, and added unit coverage for validation behavior. No functional changes to responses or errors.

Plan update note: Marked milestones complete with test evidence and recorded the outcome after implementation.

## Context and Orientation

Workspace file constants and validation live in `src/lib/projects/workspaceFiles.ts`. Server-side helpers for provisioning and reading individual files live in `src/lib/projects/workspaceFiles.server.ts`. The API route at `src/app/api/projects/[projectId]/tiles/[tileId]/workspace-files/route.ts` currently reads all workspace files via `WORKSPACE_FILE_NAMES.map(readWorkspaceFile)` in both GET and PUT, and writes files with an inline `fs.writeFileSync` loop after validating file names and content. The goal is to add list-level helpers in the server module, reuse them in the API route, and keep existing validation errors and responses unchanged.

## Plan of Work

Add `readWorkspaceFiles` and `writeWorkspaceFiles` helpers to `src/lib/projects/workspaceFiles.server.ts`. `readWorkspaceFiles` should return the same list shape as the API route currently returns, and `writeWorkspaceFiles` should validate each entry’s name and content (matching the current error messages), write the files, and return the updated list. Extend `tests/unit/workspaceFiles.test.ts` to cover the new helpers and their validation behavior using temporary directories. Then update the workspace-files API route to call the new helpers and remove the duplicated read/write loops. Finally, run the unit tests to confirm behavior is unchanged.

## Concrete Steps

Run these commands from the repository root (`/Users/georgepickett/clawdbot-agent-ui`). First, inspect the existing workspace file route and server helpers to confirm the duplicated loops.

    rg -n "readWorkspaceFile|WORKSPACE_FILE_NAMES|writeFileSync" src/app/api/projects/\[projectId\]/tiles/\[tileId\]/workspace-files/route.ts src/lib/projects/workspaceFiles.server.ts

Then add the new helpers in `src/lib/projects/workspaceFiles.server.ts` and extend `tests/unit/workspaceFiles.test.ts`. Update the route to use the helpers and remove the inline loops. Finally, run the unit tests.

    npm test -- --run tests/unit/workspaceFiles.test.ts
    npm test -- --run tests/unit/projectResolve.test.ts

## Validation and Acceptance

Acceptance is met when the workspace-files API route no longer contains its own list-level read/write loops and instead calls `readWorkspaceFiles` and `writeWorkspaceFiles` from `src/lib/projects/workspaceFiles.server.ts`. The new unit tests must pass and demonstrate that invalid names and invalid content return the same error messages as before, and that valid writes persist and are returned by subsequent reads. Existing unit tests must continue to pass.

For milestone 1, write tests in `tests/unit/workspaceFiles.test.ts` that assert `readWorkspaceFiles` returns entries for every `WORKSPACE_FILE_NAMES` value after provisioning, that `writeWorkspaceFiles` updates content and returns the updated list, and that invalid entries return `{ ok: false, error: "Invalid file name: ..." }` or `{ ok: false, error: "Invalid content for ..." }` exactly as the route currently does. Implement the helpers in `src/lib/projects/workspaceFiles.server.ts` so the tests fail before and pass after, then run `npm test -- --run tests/unit/workspaceFiles.test.ts`. Commit with message `Milestone 1: add workspace file read/write helpers`.

For milestone 2, update `src/app/api/projects/[projectId]/tiles/[tileId]/workspace-files/route.ts` to call the new helpers and remove its duplicated file loops, keeping the same status codes and error messages. Run `npm test -- --run tests/unit/projectResolve.test.ts` to ensure no regressions, then commit with message `Milestone 2: reuse workspace file helpers in API route`.

## Idempotence and Recovery

These changes are safe to re-run. The helpers are pure filesystem operations scoped to the workspace directory, and no migrations or destructive operations are required. If a step fails, revert the last edits and re-apply.

## Artifacts and Notes

After the refactor, searching the workspace-files route for `readWorkspaceFile` or `fs.writeFileSync` should show only helper usage and not inline loops. The server helper module should own both single-file and list-level workspace file operations.

## Interfaces and Dependencies

Define the helpers in `src/lib/projects/workspaceFiles.server.ts` with these shapes, and keep existing exports intact:

    export const readWorkspaceFiles: (workspaceDir: string) => Array<{ name: WorkspaceFileName; content: string; exists: boolean }>;

    export type WorkspaceFilesWriteResult =
      | { ok: true; files: Array<{ name: WorkspaceFileName; content: string; exists: boolean }> }
      | { ok: false; error: string };

    export const writeWorkspaceFiles: (
      workspaceDir: string,
      files: Array<{ name: string; content: unknown }>
    ) => WorkspaceFilesWriteResult;

The API route should translate `ok: false` into a 400 response with the helper’s error string.
