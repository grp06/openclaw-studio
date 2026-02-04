# Consolidate default workspace path resolution

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

PLANS.md is checked into this repo at `.agent/PLANS.md`. This ExecPlan must be maintained in accordance with that file.

## Purpose / Big Picture

Right now, default workspace paths are resolved in two different ways, with different legacy directory precedence. This change makes the default workspace path resolution follow the single source of truth in `src/lib/clawdbot/paths.ts`, so the same state directory logic is used everywhere. After the change, fallback workspace paths are predictable, consistent with the state dir, and validated by tests.

## Progress

- [x] (2026-02-01 00:00Z) Drafted ExecPlan for consolidating default workspace path resolution.
- [x] (2026-02-01 01:39Z) Added tests that pin the default workspace path fallback to the state directory.
- [x] (2026-02-01 01:40Z) Refactored `resolveDefaultWorkspacePath` to use the unified state-dir logic and removed duplicated helpers.

## Surprises & Discoveries

- Observation: The new fallback workspace path test passed before the refactor, indicating the existing behavior already honors `OPENCLAW_STATE_DIR` and profile suffixing.
  Evidence: `npm run test -- tests/unit/messageHelpers.test.ts` passed (6 tests).

## Decision Log

- Decision: Centralize default workspace path fallback on `resolveStateDir` from `src/lib/clawdbot/paths.ts` and remove the custom root resolver in `src/lib/clawdbot/resolveDefaultAgent.ts`.
  Rationale: This removes duplicate environment/legacy resolution logic and ensures consistent precedence across the codebase.
  Date/Author: 2026-02-01 / Codex
- Decision: Proceed with the refactor even though the new test already passes, because duplication remains and future drift risk is high.
  Rationale: The duplicate resolver still diverges in legacy precedence and should be removed for consistency.
  Date/Author: 2026-02-01 / Codex

## Outcomes & Retrospective

- Completed. Default workspace fallback now uses the same state-dir resolution everywhere, with tests covering the fallback. `npm run test` passes (100 tests).

## Context and Orientation

The default workspace path is resolved in `src/lib/clawdbot/resolveDefaultAgent.ts`. It currently computes a default workspace root using its own environment and legacy-directory logic, even though the canonical state directory logic already exists in `src/lib/clawdbot/paths.ts`. The config loader in `src/lib/clawdbot/config.ts` also uses `resolveStateDir` from `src/lib/clawdbot/paths.ts`. Tests for default agent/workspace helpers live in `tests/unit/messageHelpers.test.ts` and use Vitest.

The goal is to make the fallback path for `resolveDefaultWorkspacePath` use the same state-dir resolution as everything else. This keeps the code consistent and reduces duplication.

## Plan of Work

Milestone 1 focuses on tests that lock down the desired behavior: when no workspace is configured in the agent list or defaults, the fallback path should be derived from the resolved state directory and the optional `OPENCLAW_PROFILE` suffix. This will be added to `tests/unit/messageHelpers.test.ts` with environment setup and cleanup so the test is deterministic.

Milestone 2 updates `src/lib/clawdbot/resolveDefaultAgent.ts` to remove the local `resolveDefaultWorkspaceRoot` helper, derive the workspace root from `resolveStateDir`, and reuse the existing `readAgentList` helper from `src/lib/clawdbot/config.ts`. This consolidates path resolution logic and reduces duplication. The milestone includes updating imports and ensuring all tests pass.

## Concrete Steps

1. From the repo root, open `tests/unit/messageHelpers.test.ts` and add a new test for fallback workspace resolution.
2. Create a temporary directory under `os.tmpdir()` during the test, set `process.env.OPENCLAW_STATE_DIR` to that directory, and optionally set `process.env.OPENCLAW_PROFILE` to a non-default value like `"dev"`.
3. Assert that `resolveDefaultWorkspacePath({}, "main")` returns `<tempDir>/workspace-dev` when the profile is set, and `<tempDir>/workspace` when it is not. Ensure environment variables are restored after each test.
4. Open `src/lib/clawdbot/resolveDefaultAgent.ts` and remove the local `readAgentList` helper. Import `readAgentList` from `src/lib/clawdbot/config.ts` instead.
5. Remove `resolveDefaultWorkspaceRoot` and update `resolveDefaultWorkspaceDir` to call `resolveStateDir` from `src/lib/clawdbot/paths.ts` and append the profile suffix there.
6. Run the unit tests to verify behavior and ensure no regressions.

## Validation and Acceptance

Acceptance criteria are met when:

- `resolveDefaultWorkspacePath` uses the same state directory logic as `resolveStateDir` when no workspace is configured in `config.agents.list` or `config.agents.defaults`.
- The new test in `tests/unit/messageHelpers.test.ts` fails before the refactor and passes after it.
- All existing unit tests pass.

Milestone 1 verification workflow:
1. Tests to write: In `tests/unit/messageHelpers.test.ts`, add `it("falls back to state-dir workspace path", ...)` that sets `OPENCLAW_STATE_DIR` (and optionally `OPENCLAW_PROFILE`), then asserts the resolved path matches `<tempDir>/workspace` or `<tempDir>/workspace-<profile>`.
2. Implementation: Only add the test and the environment setup/cleanup.
3. Verification: Run `npm run test -- tests/unit/messageHelpers.test.ts` from the repo root and confirm the new test fails because the fallback is still using the old root resolver.
4. Commit: After the failure is confirmed, commit the test with message `Milestone 1: Add fallback workspace path test`.

Milestone 2 verification workflow:
1. Tests to write: None new.
2. Implementation: Update `src/lib/clawdbot/resolveDefaultAgent.ts` to use `readAgentList` from `src/lib/clawdbot/config.ts` and to derive the fallback workspace path from `resolveStateDir` in `src/lib/clawdbot/paths.ts`.
3. Verification: Run `npm run test` and confirm all tests pass.
4. Commit: Commit with message `Milestone 2: Consolidate default workspace path resolution`.

## Idempotence and Recovery

These changes are safe to repeat. If a test setup accidentally leaves environment variables set, rerun the tests after restoring them to the previous values, as described in the test teardown. If the refactor causes unexpected test failures, revert the changes in `src/lib/clawdbot/resolveDefaultAgent.ts` and re-run the unit tests to confirm recovery.

## Artifacts and Notes

Expected test run excerpt after milestone 2:

    $ npm run test
    ...
    ✓ tests/unit/messageHelpers.test.ts
    ...

## Interfaces and Dependencies

The refactor relies on existing helpers only. `resolveDefaultWorkspacePath` in `src/lib/clawdbot/resolveDefaultAgent.ts` should use `readAgentList` from `src/lib/clawdbot/config.ts` and `resolveStateDir` from `src/lib/clawdbot/paths.ts`. No new external libraries are required.
