# Consolidate `/api/studio` Persistence into One Client Settings Coordinator

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This plan is governed by `.agent/PLANS.md` and must be maintained in accordance with that file.

## Purpose / Big Picture

OpenClaw Studio currently persists gateway connection settings and focused UI preferences through two separate debounced client flows that both write to `/api/studio`. One flow lives in `src/lib/gateway/useGatewayConnection.ts` and another in `src/app/page.tsx`. After this refactor, Studio will have one shared client settings coordinator for `/api/studio` reads and writes. Gateway URL/token, focused filter/selection, and session ID persistence will all go through the same scheduling and flush logic.

This reduces conceptual surface area (one persistence path instead of two), lowers race-risk between independent timers, and directly targets the currently failing persistence behavior covered by `tests/e2e/fleet-sidebar.spec.ts` (`focused_preferences_persist_across_reload`).

## Progress

- [x] (2026-02-04 01:40Z) Completed refactor analysis, selected the single best consolidation target, and created dependent Beads milestones. [bd-2ly]
- [x] (2026-02-04 01:48Z) Implemented shared coordinator module and studio client singleton wiring for `/api/studio` load/schedule/apply/flush flows. [bd-2ly]
- [x] (2026-02-04 01:50Z) Migrated gateway and focused/session persistence call sites to the shared coordinator; removed duplicate debounce timers/raw fetch orchestration. [bd-35d]
- [x] (2026-02-04 01:53Z) Added coordinator unit coverage, hardened e2e fixtures, and passed full validation (`typecheck`, `test`, `e2e`). [bd-y8t]

## Surprises & Discoveries

- Observation: `/api/studio` is written from two independent debounced effects with different delays.
  Evidence: `src/lib/gateway/useGatewayConnection.ts:133-148` debounces gateway patch writes (400ms), while `src/app/page.tsx:802-828` debounces focused preference writes (300ms).

- Observation: The same settings endpoint is read through two separate code paths with different error and parsing behavior.
  Evidence: `src/lib/gateway/useGatewayConnection.ts:47-79` uses raw `fetch` and inline parsing, while `src/app/page.tsx:747-791` uses `fetchStudioSettings` from `src/lib/studio/client.ts`.

- Observation: Persistence reliability is already exposed by e2e coverage.
  Evidence: `tests/e2e/fleet-sidebar.spec.ts:106-123` (`focused_preferences_persist_across_reload`) currently fails in local validation when reload occurs after the debounce window.

- Observation: E2E `/api/studio` fixtures were missing `sessions`, which caused `resolveStudioSessionId` reads to throw inside focused-preference load logic and masked persistence behavior.
  Evidence: Mock payloads in `tests/e2e/*.spec.ts` used `{ version, gateway, focused }` only; adding `sessions: {}` made the reload persistence flow deterministic.

- Observation: The initial focused preference race was not just debounce timing; hydration vs user interaction ordering could overwrite local selection before persistence.
  Evidence: Before the fix, the first persisted focused payload remained `filter: "all"` after clicking `Running` during initial hydration; adding a user-interaction guard prevented hydration overwrite.

## Decision Log

- Decision: Prioritize settings-persistence consolidation over broader `src/app/page.tsx` decomposition.
  Rationale: This touches fewer files, removes duplicate abstractions immediately, and addresses an existing behavior risk with clear validation.
  Date/Author: 2026-02-04 / Codex

- Decision: Keep server contract unchanged (`PUT /api/studio` patch semantics) and consolidate only client-side coordination.
  Rationale: Lower blast radius; no API migration required.
  Date/Author: 2026-02-04 / Codex

- Decision: Introduce explicit `flush` support to persist pending writes before reload/unmount-sensitive transitions.
  Rationale: Debounce-only writes are vulnerable to lost updates when navigation or reload happens near the debounce boundary.
  Date/Author: 2026-02-04 / Codex

- Decision: Keep coordinator errors observable via console logging rather than swallowing async failures in debounced writes.
  Rationale: Silent catch paths violate repository guidance and hide persistence failures.
  Date/Author: 2026-02-04 / Codex

- Decision: Update e2e `/api/studio` fixtures to full `StudioSettings` shape (`sessions` included) instead of loosening runtime code around missing fixture fields.
  Rationale: Keeps runtime code strict and aligns tests with real API contracts.
  Date/Author: 2026-02-04 / Codex

## Outcomes & Retrospective

Implemented as planned. Studio now has one client settings persistence path coordinated through `src/lib/studio/coordinator.ts` and exposed via `getStudioSettingsCoordinator()` in `src/lib/studio/client.ts`. Both `src/lib/gateway/useGatewayConnection.ts` and `src/app/page.tsx` were migrated off duplicated timers/raw fetch writes to shared scheduling and immediate patch APIs. New unit coverage (`tests/unit/studioSettingsCoordinator.test.ts`) validates coalescing, flush, and disposal behavior. E2E fixture contracts were corrected to include `sessions`, and full validation passed: `npm run typecheck`, `npm run test` (72 tests), and `npm run e2e` (8 tests).

## Context and Orientation

Studio settings are modeled in `src/lib/studio/settings.ts` and stored server-side in `src/app/api/studio/route.ts` via `src/lib/studio/settings.server.ts`. Client code currently duplicates persistence orchestration:

- `src/lib/gateway/useGatewayConnection.ts`
  - Loads `/api/studio` directly with raw `fetch`.
  - Saves gateway URL/token through an internal 400ms debounce timer.
- `src/app/page.tsx`
  - Loads focused preferences via `fetchStudioSettings()`.
  - Saves focused state through a separate 300ms debounce timer.
  - Updates studio session ID directly via `updateStudioSettings()` during agent load.

A shared client helper exists (`src/lib/studio/client.ts`) but it is a thin transport wrapper and does not centralize scheduling, coalescing, or flush behavior.

This split means a future settings-schema change or persistence bug requires touching multiple locations, increasing shotgun-surgery risk.

## Plan of Work

Milestone 1 adds a shared coordinator in `src/lib/studio` that is responsible for loading settings, scheduling/coalescing patch writes, immediate patch writes when required, and explicit flush/dispose behavior. The coordinator will be framework-agnostic and typed to `StudioSettingsPatch`.

Milestone 2 migrates existing call sites in `src/lib/gateway/useGatewayConnection.ts` and `src/app/page.tsx` to the coordinator. This removes independent debounce timers and direct raw `fetch` logic from those files while preserving current UI behavior.

Milestone 3 adds regression coverage around coordinator behavior and focused preference persistence, then validates with `npm run typecheck`, `npm run test`, and `npm run e2e`.

## Concrete Steps

Run commands from `/Users/georgepickett/openclaw-studio`.

1. Inspect the current settings write paths and debounce timing.

    rg -n "saveTimerRef|focusedSaveTimerRef|/api/studio|updateStudioSettings|fetchStudioSettings" src/lib/gateway/useGatewayConnection.ts src/app/page.tsx src/lib/studio/client.ts

2. Add a coordinator module, for example `src/lib/studio/coordinator.ts`, with a small API such as:

    - `loadSettings(): Promise<StudioSettings | null>`
    - `schedulePatch(patch: StudioSettingsPatch): void`
    - `applyPatchNow(patch: StudioSettingsPatch): Promise<void>`
    - `flushPending(): Promise<void>`
    - `dispose(): void`

   The implementation should coalesce queued patches and preserve existing patch semantics (`gateway`, `focused`, `sessions`).

3. Update `src/lib/studio/client.ts` to expose coordinator creation (or a browser singleton) and keep transport helpers (`fetchStudioSettings`, `updateStudioSettings`) as low-level primitives.

4. Refactor `src/lib/gateway/useGatewayConnection.ts`:

    - Replace raw `/api/studio` fetch + save timer with coordinator calls.
    - Keep gateway connection logic unchanged.
    - Ensure pending gateway settings writes are flushed/disposed appropriately on cleanup.

5. Refactor `src/app/page.tsx` focused/session persistence flow:

    - Replace focused save timer writes with coordinator scheduling.
    - Route session ID persistence (`updateStudioSettings` at agent load) through the same coordinator path.
    - Keep existing focus/filter UX behavior unchanged.

6. Add tests:

    - Unit: `tests/unit/studioSettingsCoordinator.test.ts` for coalescing, debounce, and flush behavior.
    - E2E: update/verify `tests/e2e/fleet-sidebar.spec.ts` persistence case remains deterministic under the new coordinator behavior.

7. Run verification and Beads status transitions.

    br update bd-2ly --status in_progress
    br ready --json
    npm run typecheck
    npm run test
    npm run e2e
    br close bd-2ly --reason "Coordinator added"

    br update bd-35d --status in_progress
    br close bd-35d --reason "Call sites migrated and duplicate timers removed"

    br update bd-y8t --status in_progress
    br close bd-y8t --reason "Persistence tests and validation complete"
    br sync --flush-only

## Validation and Acceptance

Acceptance is complete when all conditions are true:

1. There is exactly one client-side persistence orchestration path for `/api/studio` writes (no independent debounce timers in both `useGatewayConnection` and `page.tsx`).
2. Gateway URL/token and focused/session patches all use the shared coordinator semantics.
3. `tests/e2e/fleet-sidebar.spec.ts` `focused_preferences_persist_across_reload` passes consistently.
4. `npm run typecheck` and `npm run test` pass.
5. `npm run e2e` passes, or any remaining failures are demonstrated unrelated to settings persistence.

Milestone verification workflow:

1. Tests to write first:
   - `tests/unit/studioSettingsCoordinator.test.ts`
     - `coalesces multiple scheduled patches into one PUT payload`
     - `flushPending persists queued patch immediately`
     - `dispose clears timers without extra writes`
   - `tests/e2e/fleet-sidebar.spec.ts`
     - verify focused filter remains selected after reload without fragile timeout assumptions.
2. Implementation:
   - Add coordinator module and wire both call sites.
3. Verification:
   - `npm run typecheck`
   - `npm run test`
   - `npm run e2e`
4. Commit:
   - Milestone 1: `Milestone 1: add shared studio settings coordinator`
   - Milestone 2: `Milestone 2: migrate settings call sites to coordinator`
   - Milestone 3: `Milestone 3: add persistence regression coverage`

## Idempotence and Recovery

The refactor is safe to iterate because it preserves server-side settings merge behavior and changes only client orchestration. If a migration step regresses persistence, restore call-site usage incrementally: first `useGatewayConnection`, then `page.tsx`, while keeping the coordinator tests in place. Avoid destructive filesystem operations; this work is code-only.

## Artifacts and Notes

Capture these artifacts in implementation PR notes:

- Before/after snippets showing removal of `saveTimerRef` in `src/lib/gateway/useGatewayConnection.ts` and `focusedSaveTimerRef` in `src/app/page.tsx`.
- Coordinator unit test output proving flush/coalescing behavior.
- E2E output for `focused_preferences_persist_across_reload`.

## Interfaces and Dependencies

Files expected to be affected:

- `src/lib/studio/client.ts`
- `src/lib/studio/settings.ts` (only if patch merge helpers are required client-side)
- `src/lib/studio/coordinator.ts` (new)
- `src/lib/gateway/useGatewayConnection.ts`
- `src/app/page.tsx`
- `tests/unit/studioSettingsCoordinator.test.ts` (new)
- `tests/e2e/fleet-sidebar.spec.ts`

No new external dependencies are expected. Use existing `fetchJson` and studio patch types.

Plan update note (2026-02-04): Initial version created from post-implementation repo analysis, selecting a single high-payoff consolidation refactor around duplicated studio settings persistence logic.
Plan update note (2026-02-04): Marked all milestones complete with implementation evidence, including coordinator migration details, fixture contract correction (`sessions`), and full validation results.
