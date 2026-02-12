# Harden Guided Setup Scope and Retry Concurrency Before Merge

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This repository uses `/Users/georgepickett/.codex/worktrees/3ffe/openclaw-studio/.agent/PLANS.md` as the source of truth for ExecPlan format and process, and this document must be maintained in accordance with that file.

## Purpose / Big Picture

After this change, pending guided setup recovery in Studio will be safe across multiple gateways, resistant to retry races, and resilient to browser storage failures. A user will be able to switch between gateway URLs in one tab without accidentally applying setup to the wrong agent environment, retry setup without losing unrelated pending entries, and trust that reconnect and restart flows will not trigger duplicate setup application.

The behavior should be directly observable in tests and in the UI: pending setup cards remain scoped to the current gateway, `Retry setup` applies exactly once per agent attempt, and storage edge cases fail safely without crashing startup.

## Progress

- [x] (2026-02-12 19:33Z) Reviewed current implementation and converted review findings into concrete hardening scope.
- [x] (2026-02-12 19:38Z) Milestone 1 complete: added gateway-scoped pending setup persistence, safe storage wrappers, scope-aware page load/persist effects, and passing storage tests.
- [x] (2026-02-12 19:41Z) Milestone 2 complete: added pure retry coordination helpers, unified setup-apply path across auto/manual/restart flows, removed stale-map replacement writes, and passed retry/recovery tests.
- [ ] Milestone 3: Run full verification and update reliability docs for the new behavior.

## Surprises & Discoveries

- Observation: Pending guided setup persistence is currently keyed only by `agentId` and a global sessionStorage key, not by gateway identity.
  Evidence: `/Users/georgepickett/.codex/worktrees/3ffe/openclaw-studio/src/features/agents/creation/pendingSetupStore.ts` stores `{ agentId, setup, savedAtMs }` without gateway scope.

- Observation: Two async code paths can apply pending setup around reconnect time.
  Evidence: Auto-retry effect in `/Users/georgepickett/.codex/worktrees/3ffe/openclaw-studio/src/app/page.tsx` and restart callback in the same file both call setup apply logic.

- Observation: Some async success paths replace whole pending-setup maps from closure snapshots.
  Evidence: `setPendingCreateSetupsByAgentId(applied.pendingSetupsByAgentId)` currently appears in retry/restart flows in `/Users/georgepickett/.codex/worktrees/3ffe/openclaw-studio/src/app/page.tsx`.

- Observation: Scope-aware persistence needs a loaded-scope guard; a plain boolean loaded flag can persist stale entries under a newly selected gateway scope.
  Evidence: During Milestone 1 implementation, `pendingCreateSetupsLoadedScope` replaced boolean gating to avoid cross-scope writes before the new scope load effect runs.

- Observation: Restart-complete and reconnect-auto-retry both target the same pending setup queue, so deduplication must live in shared orchestration logic, not in per-caller conditions.
  Evidence: Milestone 2 introduced shared in-flight guards and a single apply callback used by all retry entry points.

## Decision Log

- Decision: Pending setup storage will be scoped by normalized gateway URL (gateway identity in Studio) and persisted in a versioned schema.
  Rationale: This removes cross-gateway collision risk while preserving the current per-tab session persistence model.
  Date/Author: 2026-02-12 / Codex

- Decision: All setup-apply entry points (manual retry, reconnect auto-retry, restart completion) will use one in-flight guarded apply function.
  Rationale: One orchestration path is the lowest-risk way to prevent duplicate apply calls and inconsistent state transitions.
  Date/Author: 2026-02-12 / Codex

- Decision: Storage get/set/remove operations will be wrapped with explicit logging and safe fallback behavior.
  Rationale: Browser storage can throw; failing safe and logging is more reliable than allowing startup effects to crash.
  Date/Author: 2026-02-12 / Codex

- Decision: Persistence effects will be gated by `pendingCreateSetupsLoadedScope === pendingGuidedSetupGatewayScope`.
  Rationale: This prevents stale in-memory entries from being written to the wrong gateway scope during gateway URL transitions.
  Date/Author: 2026-02-12 / Codex

- Decision: Auto-retry target selection will be deterministic (sorted agent IDs) and filtered by known/attempted/in-flight sets.
  Rationale: Deterministic selection simplifies reasoning, testing, and replayability of retry behavior.
  Date/Author: 2026-02-12 / Codex

- Decision: Successful apply paths will always remove pending entries with functional state updates (`current => removePendingGuidedSetup(current, id)`).
  Rationale: Functional updates prevent stale snapshot overwrites during concurrent state transitions.
  Date/Author: 2026-02-12 / Codex

## Outcomes & Retrospective

Pending implementation.

## Context and Orientation

Guided setup creation and recovery is orchestrated in `/Users/georgepickett/.codex/worktrees/3ffe/openclaw-studio/src/app/page.tsx`. That file currently loads pending setup state from session storage, persists it, auto-retries pending setup when agents are loaded, and provides manual retry/discard controls in chat.

Session persistence helper logic currently lives in `/Users/georgepickett/.codex/worktrees/3ffe/openclaw-studio/src/features/agents/creation/pendingSetupStore.ts`. It uses a versioned JSON payload in `window.sessionStorage` but does not include gateway scope and does not guard against storage method exceptions.

Guided setup apply helper logic lives in `/Users/georgepickett/.codex/worktrees/3ffe/openclaw-studio/src/features/agents/creation/recovery.ts` and `/Users/georgepickett/.codex/worktrees/3ffe/openclaw-studio/src/features/agents/operations/createAgentOperation.ts`.

Existing tests relevant to this hardening are:

- `/Users/georgepickett/.codex/worktrees/3ffe/openclaw-studio/tests/unit/pendingGuidedSetupStore.test.ts`
- `/Users/georgepickett/.codex/worktrees/3ffe/openclaw-studio/tests/unit/guidedSetupRecovery.test.ts`

We will add one focused retry-coordination test module for pure logic so duplicate/race protections are provable without rendering the full page.

## Plan of Work

Milestone 1 introduces gateway-scoped pending setup persistence and defensive storage wrappers. The storage schema will be upgraded to include gateway scope, and load/persist calls in `page.tsx` will pass a normalized scope key derived from the current gateway URL. Persist operations will preserve entries for other gateway scopes instead of overwriting them.

Milestone 2 consolidates pending setup apply behavior into one in-flight-guarded orchestration path used by manual retry, auto-retry, and restart completion. State removal after successful apply will use functional updates so concurrent pending entries cannot be clobbered by stale closures.

Milestone 3 runs validation and updates architecture/readme reliability notes so the new guarantees are documented before merge.

## Concrete Steps

Working directory for all commands:

    /Users/georgepickett/.codex/worktrees/3ffe/openclaw-studio

Milestone 1 command sequence:

    npx vitest run tests/unit/pendingGuidedSetupStore.test.ts

Milestone 2 command sequence:

    npx vitest run tests/unit/guidedSetupRecovery.test.ts tests/unit/pendingGuidedSetupRetry.test.ts

Milestone 3 command sequence:

    npm run typecheck
    npx vitest run tests/unit/pendingGuidedSetupStore.test.ts tests/unit/guidedSetupRecovery.test.ts tests/unit/pendingGuidedSetupRetry.test.ts tests/unit/createAgentOperation.test.ts tests/unit/agentCreateModal.test.ts
    npm run lint

Expected lint note: this repository already has pre-existing lint failures in CommonJS server/scripts files and legacy test typing. Those baseline failures are not regressions unless new errors are introduced in touched guided-setup files.

## Validation and Acceptance

### Milestone 1: Gateway-scoped storage and safe storage operations

1. Tests to write first:

Write failing-first tests in `/Users/georgepickett/.codex/worktrees/3ffe/openclaw-studio/tests/unit/pendingGuidedSetupStore.test.ts` that verify:

- loading returns only entries for the requested gateway scope;
- persisting one scope does not delete existing entries for other scopes;
- persisting an empty scope map removes only that scope’s entries;
- storage method exceptions do not throw from load/persist functions and return safe defaults.

2. Implementation:

Update `/Users/georgepickett/.codex/worktrees/3ffe/openclaw-studio/src/features/agents/creation/pendingSetupStore.ts` to:

- include `gatewayScope` in serialized entries;
- normalize scope values consistently;
- preserve non-target scopes on persist;
- wrap `getItem`, `setItem`, and `removeItem` with try/catch and `console.warn` logging.

Update `/Users/georgepickett/.codex/worktrees/3ffe/openclaw-studio/src/app/page.tsx` load/persist effects to pass the normalized gateway scope key and reset local retry-tracking refs when scope changes.

3. Verification:

Run the Milestone 1 command and confirm the updated storage tests pass.

4. Commit:

Commit with message:

    Milestone 1: scope pending guided setup storage by gateway

### Milestone 2: Retry coordination and stale-state-safe updates

1. Tests to write first:

Add `/Users/georgepickett/.codex/worktrees/3ffe/openclaw-studio/tests/unit/pendingGuidedSetupRetry.test.ts` with failing-first tests for pure retry logic that verify:

- selecting auto-retry targets skips unknown, attempted, and in-flight agent IDs;
- in-flight guards prevent duplicate apply starts for the same agent ID;
- selection returns deterministic results for stable ordering.

Extend `/Users/georgepickett/.codex/worktrees/3ffe/openclaw-studio/tests/unit/guidedSetupRecovery.test.ts` with assertions that success paths remove only the applied agent entry (not whole-map replacement semantics).

2. Implementation:

Add a focused helper module at `/Users/georgepickett/.codex/worktrees/3ffe/openclaw-studio/src/features/agents/creation/pendingSetupRetry.ts` for retry selection and in-flight guards.

Refactor `/Users/georgepickett/.codex/worktrees/3ffe/openclaw-studio/src/app/page.tsx` so that:

- auto-retry, restart-complete apply, and manual retry all call one guarded apply function;
- guarded apply reads setup from current state/ref, not stale closures;
- successful apply always uses functional state removal (`current => removePendingGuidedSetup(current, agentId)`);
- auto-retry does not compete with active create-restart blocks.

3. Verification:

Run Milestone 2 tests and confirm duplicate-apply prevention and selection logic behavior.

4. Commit:

Commit with message:

    Milestone 2: unify pending setup retries and prevent state clobber

### Milestone 3: Final validation and docs

1. Tests to write first:

No new tests required in this milestone.

2. Implementation:

Update reliability documentation in:

- `/Users/georgepickett/.codex/worktrees/3ffe/openclaw-studio/README.md`
- `/Users/georgepickett/.codex/worktrees/3ffe/openclaw-studio/ARCHITECTURE.md`

Document that pending guided setup persistence is gateway-scoped and retry orchestration is deduplicated.

3. Verification:

Run Milestone 3 command sequence and record baseline-vs-new lint interpretation.

4. Commit:

Commit with message:

    Milestone 3: validate and document guided setup hardening

Final acceptance criteria:

- Pending guided setup entries do not leak across different gateway URLs in one browser tab.
- Retry success removes only the applied pending entry and cannot erase unrelated pending entries.
- Reconnect auto-retry and restart completion do not perform duplicate setup apply for the same agent at the same time.
- Storage failures degrade safely (no startup crash), with actionable warning logs.

## Idempotence and Recovery

All milestones are additive and safe to re-run. Storage schema updates are versioned and tolerant of malformed inputs. If an apply attempt fails, pending setup state remains recoverable via manual retry/discard, and no new agent is created during recovery paths. Functional state updates ensure retrying a single agent cannot erase other queued pending setups.

## Artifacts and Notes

Keep short verification snippets in commit notes while implementing:

    npx vitest run tests/unit/pendingGuidedSetupStore.test.ts
    npx vitest run tests/unit/guidedSetupRecovery.test.ts tests/unit/pendingGuidedSetupRetry.test.ts
    npm run typecheck

Expected success indicators:

    Test Files  ... passed
    Tests       ... passed

Capture lint output with baseline failures explicitly called out if unchanged.

## Interfaces and Dependencies

The following interfaces and functions must exist after implementation:

In `/Users/georgepickett/.codex/worktrees/3ffe/openclaw-studio/src/features/agents/creation/pendingSetupStore.ts`:

- serialized entry shape includes `gatewayScope: string`;
- `loadPendingGuidedSetupsFromStorage` accepts `gatewayScope`;
- `persistPendingGuidedSetupsToStorage` accepts `gatewayScope` and preserves other scopes;
- storage access wrappers log and recover from storage exceptions.

In `/Users/georgepickett/.codex/worktrees/3ffe/openclaw-studio/src/features/agents/creation/pendingSetupRetry.ts`:

- pure helper(s) for deterministic auto-retry candidate selection;
- pure helper(s) for in-flight duplicate prevention.

In `/Users/georgepickett/.codex/worktrees/3ffe/openclaw-studio/src/app/page.tsx`:

- one shared pending-setup apply function used by all retry entry points;
- functional pending-state removal after successful apply;
- retry orchestration guards that prevent duplicate concurrent applies.

Plan revision note: Created this plan on 2026-02-12 to implement post-review reliability fixes (gateway scope isolation, stale-state safety, deduplicated retries, and safe storage handling) before merge.
