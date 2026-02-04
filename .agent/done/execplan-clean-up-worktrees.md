# Add archived worktree cleanup

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This plan follows `/Users/georgepickett/clawdbot-agent-ui/.agent/PLANS.md` and must be maintained in accordance with it.

## Purpose / Big Picture

Users can archive agent tiles today, but the underlying git worktrees and agent state directories remain on disk. After this change, users will be able to preview and then permanently clean up all archived agent worktrees and agent state from the UI. The cleanup will be explicit and confirmable, and it will leave the project store and OpenClaw config consistent. You can see it working by archiving a tile, clicking “Clean archived agents,” confirming the prompt, and verifying that the tile disappears from the store and its worktree directory and agent state directory are gone.

## Progress

- [x] (2026-01-30 00:00Z) Drafted ExecPlan for archived worktree cleanup.
- [x] (2026-01-30 23:07Z) Added server-side cleanup preview + deletion flow with validation, warnings, and git worktree handling.
- [x] (2026-01-30 23:07Z) Added client helpers + UI flow to preview and trigger cleanup from the Workspaces menu.
- [x] (2026-01-30 23:07Z) Added tests for cleanup selection, batch removal, and client calls; verified with vitest.

## Surprises & Discoveries

- Observation: `vitest` in this repo does not accept the `--runInBand` flag.
  Evidence: `CACError: Unknown option --runInBand` when running `npm test -- --runInBand ...`.

## Decision Log

- Decision: Implement a dedicated cleanup endpoint at `/api/projects/cleanup` with GET preview and POST execution, plus a UI action to confirm and trigger cleanup.
  Rationale: Keeps archive as a safe soft delete while providing a clear, explicit hard delete workflow and a single place to enforce validation and warnings.
  Date/Author: 2026-01-30 (assistant).
- Decision: Treat cleanup requests with an empty `tileIds` array as invalid input.
  Rationale: Fails fast on malformed requests and avoids no-op cleanup calls that could mislead users.
  Date/Author: 2026-01-30 (assistant).
- Decision: Validate that `tileIds` is an array before attempting cleanup.
  Rationale: Prevents runtime errors and returns a clear 400 when the payload is malformed.
  Date/Author: 2026-01-30 (assistant).

## Outcomes & Retrospective

- Delivered cleanup preview + execution endpoint, UI action, and unit tests to prevent archived worktree buildup. The workflow now previews archived agents, confirms deletion, removes worktrees and agent state, prunes git metadata, and updates the store and config. Tests cover selection logic, batch removal, and client request shapes.

## Context and Orientation

OpenClaw Studio stores projects and tiles in `src/app/api/projects/store.ts`, persisted to `~/.openclaw/agent-canvas/projects.json`. Archiving a tile is implemented by setting `archivedAt` in the store via `src/app/api/projects/[projectId]/tiles/[tileId]/route.ts` and is invoked from the UI in `src/app/page.tsx` and state helpers in `src/features/canvas/state/store.tsx`. Each tile has a git worktree at a path like `~/.openclaw/agent-canvas/worktrees/<projectId>/<agentId>` that is created in `src/lib/projects/worktrees.server.ts`, and each agent has state under `~/.openclaw/agents/<agentId>` resolved in `src/lib/projects/fs.server.ts`. Agent entries are also written to the OpenClaw config (`openclaw.json`) in `src/lib/clawdbot/config.ts` via `upsertAgentEntry`; `removeAgentEntry` exists but is not yet used by the UI.

A “worktree” is a git feature that creates a second working directory connected to the same repository. In this repo, each agent tile gets its own worktree so it can have independent changes and workspace files. Cleanup must remove both the worktree directory and the agent state directory and also remove the agent entry from `openclaw.json` so the agent list stays accurate.

## Plan of Work

First, introduce a cleanup API at `src/app/api/projects/cleanup/route.ts` that supports a preview (GET) and an execution (POST). The preview will gather all archived tiles, return their identifiers and filesystem existence flags, and mark any dirty worktrees so the UI can warn the user. The POST will validate the requested tiles are archived, refuse to proceed if any worktree has uncommitted changes, delete worktrees and agent state directories, remove agent entries from the OpenClaw config, remove the tiles from the store, run `git worktree prune` for affected repos, and return the updated store plus warnings for any missing paths.

Second, add client helpers in `src/lib/projects/client.ts` and types in `src/lib/projects/types.ts` for preview and cleanup results. Wire these into `src/features/canvas/state/store.tsx` or directly in `src/app/page.tsx` to add a “Clean archived agents” action in the header. The UI flow should call preview first, show a confirmation prompt that includes the count of archived tiles to be removed, then call cleanup and update state with the returned store. Warnings should be surfaced via `window.alert` like existing archive flows.

Third, add tests for the new selection logic and client helpers. Use vitest in `tests/unit/` to validate the pure selection/validation helper and the client request shapes. This keeps the most error-prone logic verifiable without needing filesystem mutation in unit tests.

Finally, update `ARCHITECTURE.md` with a short note in the Projects / Filesystem helpers section describing the new cleanup endpoint and that it is the only hard-delete path for archived tiles.

## Concrete Steps

1. Inspect the current store, API routes, and cleanup helpers so the changes align with existing patterns.

   Run from `/Users/georgepickett/clawdbot-agent-ui`:

     rg -n "archive|worktree|cleanup" src/app src/lib src/features -S

   Expected: matches in `src/app/api/projects`, `src/lib/projects/worktrees.server.ts`, and the canvas UI.

2. Add cleanup types in `src/lib/projects/types.ts` for preview and execution. Define:

   - `ProjectCleanupPreviewItem` (projectId, projectName, tileId, tileName, agentId, workspacePath, archivedAt, workspaceExists, agentStateExists, worktreeDirty)
   - `ProjectCleanupPreviewResult` (items: ProjectCleanupPreviewItem[])
   - `ProjectCleanupRequest` (tileIds?: string[])
   - `ProjectCleanupResult` (store: ProjectsStore, warnings: string[])

3. Create a pure helper in `src/lib/projects/cleanup.ts` that selects archived tiles and validates tile id input. It should:

   - Accept a `ProjectsStore` and optional `tileIds`.
   - Return `{ candidates: ProjectTile[], errors: string[] }`.
   - Fail if any provided tile id does not exist or is not archived.
   - If no `tileIds` provided, select all archived tiles.

4. Add a server-side helper in `src/lib/projects/worktrees.server.ts` to detect worktree dirtiness. Define `isWorktreeDirty(worktreeDir: string): boolean` that runs `git status --porcelain` in the worktree directory. If git fails, throw an error with the stderr so the API returns a clear error. Do not silently swallow failures.

5. Add a new API route at `src/app/api/projects/cleanup/route.ts`.

   - GET should load the store, select all archived tiles, and return a preview list. For each tile, compute `workspaceExists` via `fs.existsSync(tile.workspacePath)` and `agentStateExists` via `resolveAgentStateDir(agentId)` from `src/lib/projects/fs.server.ts`. If the workspace exists, compute `worktreeDirty` via `isWorktreeDirty`. If it does not exist, `worktreeDirty` should be `false`.
   - POST should parse `ProjectCleanupRequest` and validate it. Use the cleanup selector helper to resolve candidates or return a 400 with the first error.
   - If any candidate has a dirty worktree, return 409 with a message listing the agents and instructing the user to restore the tile and commit or discard changes before cleanup.
   - For each candidate, delete the worktree directory with `git worktree remove` run from the repo path (`project.repoPath`), and delete the agent state dir with `deleteDirIfExists`. If the worktree directory is missing, push a warning and continue. If the agent state dir is missing, push a warning and continue. This makes cleanup idempotent.
   - Remove the agent entry from the OpenClaw config using `updateClawdbotConfig` and `removeAgentEntry` for each agent id.
   - Remove each tile from the store using a new batch helper (see step 6).
   - Run `git worktree prune` once per repo touched (after removals) and include any stderr in warnings if prune fails.
   - Save the updated store and return `{ store, warnings }`.

6. Add a batch helper in `src/app/api/projects/store.ts` to remove multiple tiles by id with a single `now` timestamp. This should keep `updatedAt` in sync and be used by the cleanup route. Add unit tests alongside existing store tests.

7. Update `src/lib/projects/client.ts` with:

   - `fetchProjectCleanupPreview()` -> GET `/api/projects/cleanup`.
   - `runProjectCleanup(payload)` -> POST `/api/projects/cleanup` with JSON body.

8. Wire the UI in `src/app/page.tsx` and `src/features/canvas/components/HeaderBar.tsx`:

   - Add a “Clean Archived Agents” action to the Workspaces menu.
   - Disable the action when there are no archived tiles.
   - On click: call preview, prompt for confirmation including the number of archived tiles (for example, `Type CLEAN ARCHIVED to remove 5 archived agents.`). If confirmed, call cleanup, update store state with the response, and show warnings via `window.alert` if any.

9. Add unit tests:

   - `tests/unit/projectsCleanup.test.ts` to cover `src/lib/projects/cleanup.ts` selection and validation.
   - Extend `tests/unit/projectsClient.test.ts` to assert the new client functions call the expected endpoints.
   - Extend `tests/unit/projectsStore.test.ts` to cover the new batch remove helper.

10. Update documentation in `ARCHITECTURE.md` under the “Projects” or “Filesystem helpers” section to describe the new cleanup endpoint and the fact that archives are soft deletes until cleanup.

## Validation and Acceptance

Milestone 1: Server-side cleanup logic and API.

Acceptance: A GET to `/api/projects/cleanup` returns a list of archived tiles with existence flags; a POST with valid archived tiles removes those tiles from the store, deletes their worktrees and agent state directories, removes their agent entries from `openclaw.json`, and prunes worktrees for touched repos; a POST fails with 409 if any candidate worktree has uncommitted changes.

Verification workflow:

1. Tests to write: In `tests/unit/projectsCleanup.test.ts`, add tests `selects_all_archived_tiles` and `rejects_non_archived_tile_ids` that assert correct selection and error messages. In `tests/unit/projectsStore.test.ts`, add a test `removes_multiple_tiles` for the batch helper. These tests should fail before the helper implementations exist.
2. Implementation: Add the cleanup selector helper, batch remove helper, and the `/api/projects/cleanup` route that uses them along with `isWorktreeDirty` and filesystem deletions.
3. Verification: Run `npm test -- tests/unit/projectsCleanup.test.ts tests/unit/projectsStore.test.ts` and confirm all tests pass.
4. Commit: Commit with message `Milestone 1: add archived cleanup API`.

Milestone 2: Client helpers and UI wiring.

Acceptance: The UI exposes a “Clean Archived Agents” action that is disabled when no archived tiles exist; clicking it previews and then cleans archived tiles, updating the store and showing warnings. The client sends correct GET and POST requests to `/api/projects/cleanup`.

Verification workflow:

1. Tests to write: Extend `tests/unit/projectsClient.test.ts` with `fetchProjectCleanupPreview_calls_endpoint` and `runProjectCleanup_posts_payload` tests. Confirm they fail before adding the new client helpers.
2. Implementation: Add the client helpers, update `HeaderBar` props to include the new action, and update `src/app/page.tsx` to call preview and cleanup APIs and update state accordingly.
3. Verification: Run `npm test -- tests/unit/projectsClient.test.ts` and confirm it passes.
4. Commit: Commit with message `Milestone 2: add cleanup UI + client helpers`.

Milestone 3: Documentation update.

Acceptance: `ARCHITECTURE.md` mentions the cleanup endpoint and clarifies that archives are soft deletes until cleanup.

Verification workflow:

1. Tests to write: None.
2. Implementation: Update `ARCHITECTURE.md` with a concise note about cleanup.
3. Verification: Run `rg -n "cleanup" ARCHITECTURE.md` and confirm the new text exists.
4. Commit: Commit with message `Milestone 3: document archived cleanup`.

## Idempotence and Recovery

Cleanup is idempotent: if a worktree or agent state directory is already missing, the API returns a warning and continues. If the cleanup fails due to dirty worktrees, no deletions occur; the user can restore the tile to inspect changes, then re-archive and retry. If a deletion fails midway, rerunning cleanup with the same tile ids will retry the remaining deletions and re-save the store.

## Artifacts and Notes

Expected preview response shape:

  {
    "items": [
      {
        "projectId": "...",
        "projectName": "...",
        "tileId": "...",
        "tileName": "...",
        "agentId": "...",
        "workspacePath": "...",
        "archivedAt": 1700000000000,
        "workspaceExists": true,
        "agentStateExists": true,
        "worktreeDirty": false
      }
    ]
  }

Expected cleanup call (POST body) shape:

  {
    "tileIds": ["tile-id-1", "tile-id-2"]
  }

## Interfaces and Dependencies

- API endpoint: `GET /api/projects/cleanup` returns `ProjectCleanupPreviewResult` and `POST /api/projects/cleanup` accepts `ProjectCleanupRequest` and returns `ProjectCleanupResult`.
- Types: `src/lib/projects/types.ts` must include the cleanup request/response types and preview item shape.
- Helpers: `src/lib/projects/cleanup.ts` provides selection/validation for archived tiles. `src/lib/projects/worktrees.server.ts` provides `isWorktreeDirty` for git status. `src/app/api/projects/store.ts` provides a batch tile removal helper used by cleanup.
- Config: `src/lib/clawdbot/config.ts` `removeAgentEntry` must be invoked through `updateClawdbotConfig` during cleanup.
- External tool: git must be available for `git status --porcelain`, `git worktree remove`, and `git worktree prune`.

Plan update note (2026-01-30 23:07Z): Marked milestones complete, recorded the vitest flag issue, updated validation commands, and documented outcomes after implementation.

Plan update note (2026-01-30 23:09Z): Added payload type validation for `tileIds` and re-ran cleanup/unit tests after the change.
