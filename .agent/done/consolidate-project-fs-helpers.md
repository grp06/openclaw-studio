# Consolidate project filesystem helpers for API routes

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This repository includes `.agent/PLANS.md`, and this ExecPlan must be maintained in accordance with its requirements.

## Purpose / Big Picture

Users should see the exact same behavior when creating, opening, and deleting workspaces or tiles, but the implementation should be safer to maintain. Today several API routes reimplement the same home-path expansion and agent artifact deletion logic, which increases the risk of future drift and inconsistent behavior. After this change, those routes share a single server-only helper module for path resolution and cleanup, so edits to filesystem behavior are made once and apply everywhere.

## Progress

- [x] (2026-01-29 03:42Z) Add a shared server-only filesystem helper module plus focused unit tests for path resolution and deletion helpers.
- [x] (2026-01-29 03:43Z) Replace per-route helper copies with shared imports and confirm all tests pass.

## Surprises & Discoveries

None yet.

## Decision Log

- Decision: Consolidate home-path resolution and agent artifact deletion into a new server-only helper in `src/lib/projects/fs.server.ts`, used by API routes that currently inline those helpers.
  Rationale: This removes duplicated, potentially dangerous filesystem logic across multiple routes while keeping the blast radius small and validation straightforward.
  Date/Author: 2026-01-29 / Codex

## Outcomes & Retrospective

Consolidated duplicated filesystem helpers into `src/lib/projects/fs.server.ts`, updated the four API routes to use shared helpers, and added unit tests for path resolution and deletion behavior. All unit tests passed with `npm test`.

## Context and Orientation

The API routes under `src/app/api/projects` implement workspace and tile actions. Several of these routes duplicate low-level filesystem helpers:

- `src/app/api/projects/open/route.ts` expands `~` in user-provided workspace paths.
- `src/app/api/projects/[projectId]/route.ts` and `src/app/api/projects/[projectId]/tiles/[tileId]/route.ts` both implement `resolveHomePath`, `deleteDirIfExists`, and `deleteAgentArtifacts` to remove agent workspace/state.
- `src/app/api/projects/[projectId]/tiles/route.ts` also re-implements `resolveHomePath` for copying auth profiles.

The shared workspace path logic already lives in `src/lib/projects/agentWorkspace.ts` via `resolveAgentWorkspaceDir`. We will introduce a new server-only helper module that centralizes home-path expansion and deletion helpers, then update the routes to use it.

## Plan of Work

First, create `src/lib/projects/fs.server.ts` to host shared filesystem utilities. This module should export `resolveHomePath`, `resolveClawdbotStateDir`, `resolveAgentStateDir`, `deleteDirIfExists`, and `deleteAgentArtifacts`. `deleteAgentArtifacts` should use `resolveAgentWorkspaceDir` and `resolveAgentStateDir` so the path logic is centralized. The module must be server-only and use Node built-ins directly, similar to `workspaceFiles.server.ts`.

Second, write unit tests in `tests/unit/projectFs.test.ts` that validate the pure path-resolution helpers and the deletion helper on a temporary directory. The tests should avoid touching real user agent directories. Use a temporary directory and pass it directly to `deleteDirIfExists`. For `resolveHomePath`, validate `~`, `~/subdir`, and absolute paths without `~`. For `resolveClawdbotStateDir`, set and restore `process.env.CLAWDBOT_STATE_DIR` around the test and assert the resolved path expands `~`.

Third, update these API routes to import from the new module and remove their local helper implementations:

- `src/app/api/projects/open/route.ts` should import `resolveHomePath`.
- `src/app/api/projects/[projectId]/route.ts` should import `deleteAgentArtifacts` (and no longer define `resolveHomePath`, `deleteDirIfExists`, or `deleteAgentArtifacts`).
- `src/app/api/projects/[projectId]/tiles/[tileId]/route.ts` should import `deleteAgentArtifacts` and remove the duplicate helpers.
- `src/app/api/projects/[projectId]/tiles/route.ts` should import `resolveClawdbotStateDir` (or `resolveHomePath`) for auth profile copying, and remove its local `resolveHomePath` implementation.

Keep behavior identical: error messages, warnings, and deletion semantics must not change. Only the helper placement and imports should move.

## Concrete Steps

From the repository root (`/Users/georgepickett/clawdbot-agent-ui`):

1) Inspect current helper duplication for reference.

   rg -n "resolveHomePath|deleteAgentArtifacts|deleteDirIfExists" src/app/api/projects -S

2) Create the helper module and tests.

   - Add `src/lib/projects/fs.server.ts` with the shared helpers.
   - Add `tests/unit/projectFs.test.ts` with vitest coverage for path resolution and deletion of a temp directory.

3) Replace per-route helpers with imports and remove the duplicated definitions.

4) Run unit tests.

   npm test -- tests/unit/projectFs.test.ts

If there are any lint or type issues, run `npm run lint` and `npm run typecheck` and fix them before proceeding.

## Validation and Acceptance

Behavioral acceptance:

- Opening, creating, and deleting workspaces or tiles continues to return the same HTTP responses and warnings as before.
- All routes that previously inlined `resolveHomePath` or `deleteAgentArtifacts` now import them from `src/lib/projects/fs.server.ts`.

Test acceptance, per milestone:

Milestone 1 (helper + tests):

1. Tests to write: In `tests/unit/projectFs.test.ts`, write tests named `resolvesHomePathVariants` and `resolvesClawdbotStateDirFromEnv`, plus `deleteDirIfExistsRemovesDirectory`. The home path test should assert that `resolveHomePath("~")` equals `os.homedir()`, `resolveHomePath("~/foo")` equals `path.join(os.homedir(), "foo")`, and `resolveHomePath("/tmp/x")` returns `/tmp/x` unchanged. The state dir test should set `process.env.CLAWDBOT_STATE_DIR` to `~/state-test` and assert the resolved path is `path.join(os.homedir(), "state-test")`, then restore the env var. The deletion test should create a temp directory via `fs.mkdtempSync`, call `deleteDirIfExists` on it, and assert it no longer exists.
2. Implementation: Add `src/lib/projects/fs.server.ts` with the exported helpers.
3. Verification: Run `npm test -- tests/unit/projectFs.test.ts` and confirm all tests pass.
4. Commit: After tests pass, commit with message `Milestone 1: Add shared project fs helpers and tests`.

Milestone 2 (route updates):

1. Tests to write: No new tests beyond Milestone 1; ensure existing tests still pass.
2. Implementation: Update the four API route files to import and use the shared helpers, removing local duplicates.
3. Verification: Run `npm test` and confirm all tests pass.
4. Commit: After tests pass, commit with message `Milestone 2: Use shared fs helpers in project routes`.

## Idempotence and Recovery

The changes are safe to apply multiple times because they only move logic and adjust imports. If a step fails, revert the file being edited to the last committed state and reapply the change. If any route behavior changes unexpectedly, restore the previous helper implementation from git history and reassess before proceeding.

## Artifacts and Notes

Expected test command output (example):

    $ npm test -- tests/unit/projectFs.test.ts
    ✓ tests/unit/projectFs.test.ts (3)

## Interfaces and Dependencies

Define these exports in `src/lib/projects/fs.server.ts`:

- `resolveHomePath(inputPath: string): string` which expands `~` and `~/` to the OS home directory.
- `resolveClawdbotStateDir(): string` which resolves `process.env.CLAWDBOT_STATE_DIR ?? "~/.clawdbot"` via `resolveHomePath`.
- `resolveAgentStateDir(agentId: string): string` which returns `path.join(resolveClawdbotStateDir(), "agents", agentId)`.
- `deleteDirIfExists(targetPath: string, label: string, warnings: string[]): void` which deletes an existing directory, appending warnings when it does not exist.
- `deleteAgentArtifacts(projectId: string, agentId: string, warnings: string[]): void` which deletes both the agent workspace directory (via `resolveAgentWorkspaceDir`) and the agent state directory (via `resolveAgentStateDir`).

These helpers should use Node built-ins (`fs`, `path`, `os`) and stay server-only like `workspaceFiles.server.ts`.

---

Plan change note: Initial version created from refactor recommendation to consolidate duplicated filesystem helpers in project API routes.
