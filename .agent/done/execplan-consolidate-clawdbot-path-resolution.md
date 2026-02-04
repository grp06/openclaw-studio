# Consolidate Clawdbot Path Resolution

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This repository does not include PLANS.md. The source of truth for this plan is `.agent/PLANS.md` from the repository root; this document must be maintained in accordance with `.agent/PLANS.md`.

## Purpose / Big Picture

The UI currently resolves Clawdbot state paths in multiple places with subtly different rules, which can point at different state directories depending on which code path runs. After this change, all state-dir, config-path, and `.env` path resolution will flow through a single module so the UI is consistent and aligned with backend defaults. A user who sets `MOLTBOT_STATE_DIR` or relies on `.moltbot` will see the UI read and write the same locations across project creation, agent cleanup, gateway config, and Discord provisioning.

## Progress

- [x] (2026-01-29 04:15Z) Add consolidated path helpers in `src/lib/clawdbot/paths.ts` and update `src/lib/clawdbot/config.ts` to use them.
- [x] (2026-01-29 04:15Z) Update server-side filesystem helpers and Discord provisioning to use the consolidated helpers and remove local path resolution duplicates.
- [x] (2026-01-29 04:15Z) Update unit tests for path resolution and run targeted test coverage for the changed modules.

## Surprises & Discoveries

- Observation: Typecheck surfaced a missing import for `resolveAgentWorkspaceDir` in the tile route and stricter `ProcessEnv` typing in tests after refactoring.
  Evidence: `tsc --noEmit` reported `Cannot find name 'resolveAgentWorkspaceDir'` in `src/app/api/projects/[projectId]/tiles/[tileId]/route.ts` and a `ProcessEnv` conversion error in `tests/unit/projectFs.test.ts`.

## Decision Log

- Decision: Align UI state-dir resolution with backend behavior by preferring `~/.moltbot` when the legacy `~/.clawdbot` directory is absent, while still honoring `MOLTBOT_STATE_DIR` and `CLAWDBOT_STATE_DIR` overrides.
  Rationale: The backend already uses this precedence; matching it removes a class of mismatched-path bugs without increasing surface area.
  Date/Author: 2026-01-29, Codex.
- Decision: Preserve absolute-path validation for opening projects by only expanding `~` or accepting absolute paths before resolving.
  Rationale: Avoids changing behavior to accept relative paths after switching to `resolveUserPath` (which always resolves to absolute).
  Date/Author: 2026-01-29, Codex.

## Outcomes & Retrospective

Consolidated Clawdbot path resolution into `src/lib/clawdbot/paths.ts`, updated all call sites to use the shared helpers, and aligned state-dir precedence with the backend. Unit tests cover user-path expansion, env overrides, and `.moltbot` preference, and both `npm test -- tests/unit/projectFs.test.ts` and `npm run typecheck` pass. No remaining gaps identified in this scope.

## Context and Orientation

State and config path resolution is currently duplicated across several files. `src/lib/clawdbot/config.ts` defines its own `resolveUserPath` and config candidate logic. `src/lib/projects/fs.server.ts` defines `resolveHomePath` and `resolveClawdbotStateDir` with different environment precedence. `src/lib/discord/discordChannel.ts` hard-codes `~/.clawdbot/.env`. API routes like `src/app/api/projects/[projectId]/tiles/route.ts` rely on the projects helper for state-dir pathing. The tests in `tests/unit/projectFs.test.ts` exercise `resolveHomePath` and `resolveClawdbotStateDir`. Consolidating these into a single `src/lib/clawdbot/paths.ts` will remove duplicate logic, reduce the chance of inconsistent behavior across paths, and simplify future changes.

## Plan of Work

First, create a new module `src/lib/clawdbot/paths.ts` that owns user-path expansion, state-dir resolution, config-path candidate resolution, and `.env` path resolution. The module should accept optional `env` and `homedir` parameters so unit tests can be deterministic without writing to the real home directory. Then update `src/lib/clawdbot/config.ts` to import these helpers and remove its local path-resolution functions. Next, update `src/lib/projects/fs.server.ts`, `src/app/api/projects/[projectId]/tiles/route.ts`, and `src/lib/discord/discordChannel.ts` to use the new helpers directly so there is a single source of truth. Finally, update unit tests to cover the new module behavior (including `.moltbot` preference when the legacy state directory is missing) and ensure existing tests still pass.

## Concrete Steps

From the repository root `/Users/georgepickett/clawdbot-agent-ui`:

1. Inspect current path resolution call sites to ensure no missed imports.

   rg "resolveClawdbotStateDir|resolveHomePath|\.clawdbot" -n src

2. Add `src/lib/clawdbot/paths.ts` with the new helper functions and move or re-implement the logic from `src/lib/clawdbot/config.ts` and `src/lib/projects/fs.server.ts`.

3. Update `src/lib/clawdbot/config.ts` to import the new helpers and delete its local `resolveUserPath`, `resolveStateDir`, and `resolveConfigPathCandidates` implementations.

4. Update `src/lib/projects/fs.server.ts` to import `resolveStateDir` (and any user-path helper it needs) from `src/lib/clawdbot/paths.ts`. Remove duplicate helpers from this file.

5. Update `src/app/api/projects/[projectId]/tiles/route.ts` to import `resolveStateDir` from `src/lib/clawdbot/paths.ts` (or from `src/lib/projects/fs.server.ts` if it remains re-exported).

6. Update `src/lib/discord/discordChannel.ts` so the `.env` path is derived from the consolidated helper rather than `~/.clawdbot`.

7. Update `tests/unit/projectFs.test.ts` (or a new test file if preferred) to import the consolidated helpers and add tests for:

   - `resolveUserPath` expanding `~` using a stubbed homedir function.
   - `resolveStateDir` honoring `MOLTBOT_STATE_DIR` and `CLAWDBOT_STATE_DIR` overrides.
   - `resolveStateDir` preferring the `.moltbot` directory when `.clawdbot` is absent (using a temporary homedir path with real directories).

8. Run targeted tests:

   npm test -- tests/unit/projectFs.test.ts

If additional tests are added, include them in the command as needed.

## Validation and Acceptance

Acceptance means all call sites use the consolidated helper module, the duplicate path helper functions are removed, and unit tests confirm environment override behavior and `.moltbot` preference when the legacy directory does not exist.

Verification workflow by milestone:

Milestone 1: Consolidated helpers and config integration.
- Tests to write: Update or add tests in `tests/unit/projectFs.test.ts` to assert `resolveUserPath` and `resolveStateDir` behavior with stubbed homedir and env overrides. Run `npm test -- tests/unit/projectFs.test.ts` and confirm these new tests fail before the helper exists.
- Implementation: Create `src/lib/clawdbot/paths.ts` and update `src/lib/clawdbot/config.ts` to use it.
- Verification: Re-run `npm test -- tests/unit/projectFs.test.ts` and confirm all tests pass.
- Commit: `git commit -am "Milestone 1: centralize clawdbot path helpers"`.

Milestone 2: Update server helpers and Discord provisioning.
- Tests to write: Add a test that simulates a temporary homedir with `.moltbot` only and confirms `resolveStateDir` chooses it; if already added in Milestone 1, ensure it still passes.
- Implementation: Update `src/lib/projects/fs.server.ts`, `src/app/api/projects/[projectId]/tiles/route.ts`, and `src/lib/discord/discordChannel.ts` to use the consolidated helpers and remove duplicate path resolution logic.
- Verification: Re-run `npm test -- tests/unit/projectFs.test.ts` and run `npm run typecheck` to ensure no type regressions.
- Commit: `git commit -am "Milestone 2: apply consolidated path helpers"`.

## Idempotence and Recovery

These steps are safe to rerun. If a test fails after refactoring, revert the last file change and re-run the targeted test to isolate the regression. Because the work only changes path resolution helpers and imports, rolling back a single file or commit fully restores the previous behavior.

## Artifacts and Notes

Expected unit test transcript example:

    $ npm test -- tests/unit/projectFs.test.ts
    ✓ tests/unit/projectFs.test.ts (3)

## Interfaces and Dependencies

Define the following functions in `src/lib/clawdbot/paths.ts` and ensure they are imported by other modules instead of local duplicates:

- `resolveUserPath(input: string, homedir?: () => string): string` which expands `~` and returns an absolute path.
- `resolveStateDir(env?: NodeJS.ProcessEnv, homedir?: () => string): string` which respects `MOLTBOT_STATE_DIR` and `CLAWDBOT_STATE_DIR`, otherwise prefers `~/.moltbot` when `~/.clawdbot` is absent and falls back to `~/.clawdbot`.
- `resolveConfigPathCandidates(env?: NodeJS.ProcessEnv, homedir?: () => string): string[]` matching current config candidate behavior.
- `resolveClawdbotEnvPath(env?: NodeJS.ProcessEnv, homedir?: () => string): string` to derive the `.env` path from the resolved state directory.

These helpers should not add new comments and should keep signatures simple for use in both runtime code and unit tests.

Plan update (2026-01-29 04:15Z): Marked milestones complete, recorded test runs and typecheck discoveries, and documented the absolute-path validation decision after implementation.
