# Consolidate agent artifact cleanup across project/tile deletes

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This plan must be maintained in accordance with `.agent/PLANS.md` in this repository.

## Purpose / Big Picture

Project and tile delete routes both perform agent cleanup: they warn on missing `agentId`, delete agent workspace/state directories, and then remove agent entries from `moltbot.json`. The filesystem cleanup portion is duplicated across routes. After this change, a shared helper in `src/lib/projects/fs.server.ts` will encapsulate the agent-id validation and artifact deletion, and routes will reuse it. Behavior stays identical while reducing repeated logic.

## Progress

- [x] (2026-01-29 21:38Z) Add shared agent cleanup helper with unit tests. Tests: `npm test -- --run tests/unit/projectFs.test.ts`.
- [x] (2026-01-29 21:38Z) Update project/tile delete routes to use the helper; re-run tests. Tests: `npm test -- --run tests/unit/projectResolve.test.ts`.

## Surprises & Discoveries

- None yet.

## Decision Log

- Decision: Add `collectAgentIdsAndDeleteArtifacts` to `src/lib/projects/fs.server.ts` and reuse it in project/tile delete routes.
  Rationale: The cleanup logic already lives in `fs.server.ts`, and both routes share the same missing-agent warning and deletion steps, so a shared helper reduces duplication with minimal risk.
  Date/Author: 2026-01-29 / Codex

## Outcomes & Retrospective

- Centralized agent artifact cleanup into `collectAgentIdsAndDeleteArtifacts`, updated project/tile delete routes to use it, and added unit coverage for cleanup and warnings. Behavior remains unchanged with less duplicated cleanup logic.

Plan update note: Marked milestones complete with test evidence and recorded the outcome after implementation.

## Context and Orientation

Agent cleanup logic is currently duplicated in:

- `src/app/api/projects/[projectId]/route.ts` (project delete): loops tiles, warns on missing `agentId`, deletes artifacts with `deleteAgentArtifacts`, then removes agent entries from config.
- `src/app/api/projects/[projectId]/tiles/[tileId]/route.ts` (tile delete): warns on missing `agentId`, deletes artifacts with `deleteAgentArtifacts`, then removes a single agent entry from config.

The goal is to centralize the repeated warning + `deleteAgentArtifacts` loop in a shared helper within `src/lib/projects/fs.server.ts`, which already owns filesystem cleanup helpers.

## Plan of Work

Add a new helper to `src/lib/projects/fs.server.ts` named `collectAgentIdsAndDeleteArtifacts(projectId, tiles, warnings)` that accepts a list of `ProjectTile` and returns the list of valid agent IDs. The helper should push the same warning message as today when a tile is missing an `agentId`, and should call `deleteAgentArtifacts` for each valid agent ID. Then update the project and tile delete routes to use the helper and feed the returned agent IDs into the existing config update logic. Add unit tests in `tests/unit/projectFs.test.ts` that validate directory deletion and warning behavior using a temp state directory.

## Concrete Steps

From the repository root (`/Users/georgepickett/clawdbot-agent-ui`):

1) Inspect current cleanup duplication.

    rg -n "deleteAgentArtifacts|Missing agentId" src/app/api/projects/\[projectId\] -g '*.ts'

2) Add `collectAgentIdsAndDeleteArtifacts` to `src/lib/projects/fs.server.ts`.

3) Extend `tests/unit/projectFs.test.ts` with tests for the new helper.

4) Update delete routes:
   - `src/app/api/projects/[projectId]/route.ts`
   - `src/app/api/projects/[projectId]/tiles/[tileId]/route.ts`

5) Run tests.

    npm test -- --run tests/unit/projectFs.test.ts
    npm test -- --run tests/unit/projectResolve.test.ts

## Validation and Acceptance

Acceptance is met when:

1) Both delete routes use `collectAgentIdsAndDeleteArtifacts` and no longer inline the missing-agent warning and artifact deletion loop.
2) Unit tests verify that the helper deletes both workspace and state directories for valid agent IDs and emits the missing-agent warning.
3) Existing unit tests continue to pass.

Milestone 1: Shared helper + tests.

- Tests to write: In `tests/unit/projectFs.test.ts`, add a new `describe("collectAgentIdsAndDeleteArtifacts")` block with at least two tests:
  - `it("deletes agent artifacts and returns ids")` should create a temp state dir, set `MOLTBOT_STATE_DIR`, create both workspace and state directories for a tile, call the helper, assert the directories are removed, and that the returned list contains the agent ID with no warnings.
  - `it("warns when agentId is missing")` should pass a tile with empty `agentId` and assert the warning string is appended and no IDs are returned.
- Implementation: Add to `src/lib/projects/fs.server.ts`:

      export const collectAgentIdsAndDeleteArtifacts = (
        projectId: string,
        tiles: ProjectTile[],
        warnings: string[]
      ): string[] => {
        const agentIds: string[] = [];
        for (const tile of tiles) {
          if (!tile.agentId?.trim()) {
            warnings.push(`Missing agentId for tile ${tile.id}; skipped agent cleanup.`);
            continue;
          }
          deleteAgentArtifacts(projectId, tile.agentId, warnings);
          agentIds.push(tile.agentId);
        }
        return agentIds;
      };

- Verification: Run `npm test -- --run tests/unit/projectFs.test.ts` and confirm all tests pass.
- Commit: Commit with message `Milestone 1: add agent cleanup helper`.

Milestone 2: Route updates.

- Tests to write: No new tests required beyond milestone 1.
- Implementation: Replace the inline cleanup loop in both delete routes with `collectAgentIdsAndDeleteArtifacts`, then pass the returned IDs into the existing `updateClawdbotConfig` removal logic (project delete) or a single `removeAgentEntry` call (tile delete). Preserve warning order and behavior.
- Verification: Run `npm test -- --run tests/unit/projectResolve.test.ts` and confirm it passes.
- Commit: Commit with message `Milestone 2: reuse agent cleanup helper in delete routes`.

## Idempotence and Recovery

The helper is deterministic and uses existing filesystem cleanup logic. Changes are safe to re-run. If a step fails, revert the last edits and re-apply. No migrations or data loss are involved.

## Artifacts and Notes

After refactoring, searching the delete routes for `Missing agentId for tile` should show only helper usage, not inline loops.

## Interfaces and Dependencies

`collectAgentIdsAndDeleteArtifacts` lives in `src/lib/projects/fs.server.ts` and depends on existing `deleteAgentArtifacts` plus the `ProjectTile` type from `src/lib/projects/types`. It should not introduce new external dependencies.
