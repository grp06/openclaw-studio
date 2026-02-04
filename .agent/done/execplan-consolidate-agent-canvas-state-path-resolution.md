# Consolidate agent-canvas state path resolution

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This repository does not include PLANS.md. The source of truth for this plan is `.agent/PLANS.md` from the repository root; this document must be maintained in accordance with `.agent/PLANS.md`.

## Purpose / Big Picture

The agent-canvas state directory is currently hard-coded in multiple places, which ignores the unified state-dir resolution logic and risks path drift. After this change, both projects store persistence and agent workspace paths will derive from a single helper that respects `MOLTBOT_STATE_DIR`/`CLAWDBOT_STATE_DIR` and the `~/.moltbot` fallback. A user who overrides the state dir will see projects.json and agent workspaces created in the same resolved location.

## Progress

- [x] (2026-01-29 04:31Z) Add shared agent-canvas path helpers in `src/lib/projects/agentWorkspace.ts` and unit tests to pin behavior.
- [x] (2026-01-29 04:31Z) Update `src/app/api/projects/store.ts` and any workspace path callers to use the shared helper.
- [x] (2026-01-29 04:31Z) Verify tests and typecheck after refactor.

## Surprises & Discoveries

None yet.

## Decision Log

- Decision: Centralize the agent-canvas root path in `src/lib/projects/agentWorkspace.ts` and derive it from `resolveStateDir`.
  Rationale: This keeps path logic close to workspace utilities and avoids scattering state-dir computation across API modules.
  Date/Author: 2026-01-29, Codex.

## Outcomes & Retrospective

Agent-canvas paths now derive from `resolveStateDir` through `resolveAgentCanvasDir`, and both the projects store and workspace roots use the shared helper. Unit tests validate env overrides and `.moltbot` fallback, and `npm test -- tests/unit/projectFs.test.ts` plus `npm run typecheck` pass.

## Context and Orientation

Projects store persistence uses `src/app/api/projects/store.ts`, which currently builds `STORE_DIR` from `os.homedir()` with a hard-coded `~/.clawdbot/agent-canvas` path. Agent workspace paths are defined in `src/lib/projects/agentWorkspace.ts`, also hard-coded to `~/.clawdbot/agent-canvas`. Meanwhile `src/lib/clawdbot/paths.ts` already resolves the canonical state directory, including env overrides and `~/.moltbot` fallback. Consolidating the agent-canvas root into a helper that uses `resolveStateDir` will align the store and workspace paths with the configured state directory.

## Plan of Work

First, add a helper in `src/lib/projects/agentWorkspace.ts` that resolves the agent-canvas base directory using `resolveStateDir`. Then, update `resolveProjectAgentsRoot` to build from that base, and update `src/app/api/projects/store.ts` to use the same helper for `STORE_DIR`. Add unit tests that assert the helper respects env overrides and `~/.moltbot` preference. Finally, run the targeted unit test and typecheck.

## Concrete Steps

From the repository root `/Users/georgepickett/clawdbot-agent-ui`:

1. Add a helper in `src/lib/projects/agentWorkspace.ts`:

   - Export `resolveAgentCanvasDir(env?: NodeJS.ProcessEnv, homedir?: () => string): string`.
   - It should call `resolveStateDir(env, homedir)` from `src/lib/clawdbot/paths.ts` and append `agent-canvas`.
   - Update `resolveProjectAgentsRoot` to use `resolveAgentCanvasDir()`.

2. Update store path usage:

   - In `src/app/api/projects/store.ts`, replace the hard-coded `STORE_DIR` with `resolveAgentCanvasDir()`.

3. Add unit tests in `tests/unit/projectFs.test.ts`:

   - Assert `resolveAgentCanvasDir` uses the `MOLTBOT_STATE_DIR` or `CLAWDBOT_STATE_DIR` override when provided (using a stubbed homedir).
   - Assert `resolveAgentCanvasDir` prefers `.moltbot` when `.clawdbot` is absent (using a temp homedir with directories created).

4. Run tests and typecheck:

   npm test -- tests/unit/projectFs.test.ts
   npm run typecheck

## Validation and Acceptance

Acceptance means the agent-canvas root is derived from `resolveStateDir`, both the projects store and workspace paths use the shared helper, and unit tests validate override and `.moltbot` fallback behavior. The focused unit test and typecheck must pass.

Verification workflow by milestone:

Milestone 1: Shared helper + tests.
- Tests to write: Extend `tests/unit/projectFs.test.ts` with `resolveAgentCanvasDir` coverage for env overrides and `.moltbot` fallback. Run `npm test -- tests/unit/projectFs.test.ts` and confirm the new tests fail before the helper exists.
- Implementation: Add `resolveAgentCanvasDir` to `src/lib/projects/agentWorkspace.ts` and update `resolveProjectAgentsRoot` to use it.
- Verification: Re-run `npm test -- tests/unit/projectFs.test.ts` and confirm all tests pass.
- Commit: `git commit -am "Milestone 1: add agent-canvas path helper"`.

Milestone 2: Store path integration.
- Tests to write: No new tests beyond Milestone 1.
- Implementation: Update `src/app/api/projects/store.ts` to use `resolveAgentCanvasDir()` for `STORE_DIR`.
- Verification: Run `npm test -- tests/unit/projectFs.test.ts` and `npm run typecheck`.
- Commit: `git commit -am "Milestone 2: use shared agent-canvas path"`.

## Idempotence and Recovery

These steps are safe to rerun. If a refactor introduces unexpected behavior, restore the previous hard-coded `STORE_DIR` and re-run the unit tests to isolate changes. The helper is pure and does not touch the filesystem beyond the `resolveStateDir` checks, so rollback is limited to the path helper and import changes.

## Artifacts and Notes

Expected unit test transcript example:

    $ npm test -- tests/unit/projectFs.test.ts
    ✓ tests/unit/projectFs.test.ts (5)

## Interfaces and Dependencies

`src/lib/projects/agentWorkspace.ts` should export:

- `resolveAgentCanvasDir(env?: NodeJS.ProcessEnv, homedir?: () => string): string`

This helper must be pure and should only compose `resolveStateDir` with the `agent-canvas` suffix.

Plan update (2026-01-29 04:31Z): Marked milestones complete and recorded test/typecheck results after refactor.
