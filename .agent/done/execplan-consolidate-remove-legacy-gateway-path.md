# Consolidate Gateway Settings by Removing the Unused Legacy `/api/gateway` Path

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This plan is governed by `.agent/PLANS.md` and must be maintained in accordance with that file.

## Purpose / Big Picture

OpenClaw Studio currently has one active gateway-settings path (`/api/studio`) plus one legacy, unused path (`/api/gateway`) that reads `openclaw.json`. Keeping both concepts in the codebase increases cognitive load and invites drift about which source of truth is authoritative. After this change, Studio will have exactly one gateway-settings flow, centered on `src/lib/studio/settings.ts` and `src/app/api/studio/route.ts`, with the unused legacy route and helper removed.

A user should see no behavior change in the UI. The improvement is structural clarity: fewer concepts to learn, less dead code, and lower risk of future regressions caused by editing the wrong gateway-settings path.

## Progress

- [x] (2026-02-04 01:32Z) Authored this ExecPlan and created Beads milestone issues. [bd-3ve]
- [x] (2026-02-04 01:33Z) Removed `src/app/api/gateway/route.ts` and `src/lib/clawdbot/gateway.ts`; verified no stale `/api/gateway` usage except `/api/gateway/tools` and no remaining `resolveGatewayConfig` references. [bd-3ve]
- [x] (2026-02-04 01:34Z) Ran validation (`npm run build`, `npm run typecheck`, `npm run test`, `npm run e2e`, targeted e2e re-run) and confirmed only one unrelated e2e failure remains. [bd-2jf]

## Surprises & Discoveries

- Observation: The legacy endpoint `src/app/api/gateway/route.ts` has no runtime/test callers in this repository.
  Evidence: `rg -n "/api/gateway" src tests` only returns `src/lib/gateway/tools.ts` for `/api/gateway/tools`, plus the legacy route file itself.

- Observation: The legacy resolver `src/lib/clawdbot/gateway.ts` is only referenced by the legacy route.
  Evidence: `rg -n "resolveGatewayConfig\(" src tests` returns only `src/lib/clawdbot/gateway.ts` and `src/app/api/gateway/route.ts`.

- Observation: `npm run typecheck` initially failed after deleting the route because stale generated Next validator types still referenced `src/app/api/gateway/route.js`.
  Evidence: TypeScript error from `.next/types/validator.ts(71,39): Cannot find module '../../src/app/api/gateway/route.js'`.

- Observation: One e2e test fails consistently and is unrelated to the removed legacy route.
  Evidence: `tests/e2e/fleet-sidebar.spec.ts:106` (`focused_preferences_persist_across_reload`) fails before/after targeted rerun on persisted filter assertion (`aria-pressed` expected `true`, received `false`).

## Decision Log

- Decision: Choose dead-path removal over larger event-pipeline refactors for this cycle.
  Rationale: This has the best blast-radius-to-payoff ratio: two files removed, one conceptual path eliminated, near-zero behavior risk, and straightforward rollback.
  Date/Author: 2026-02-04 / Codex

- Decision: Keep `src/lib/clawdbot/config.ts` intact for Discord and config-backed helpers.
  Rationale: Only the gateway URL/token resolver path is dead; other config utilities are still used.
  Date/Author: 2026-02-04 / Codex

- Decision: Regenerate Next artifacts with `npm run build` instead of manually deleting `.next` directories.
  Rationale: Repo guidance forbids directory removal without user confirmation; build safely refreshes generated validator references.
  Date/Author: 2026-02-04 / Codex

- Decision: Treat `focused_preferences_persist_across_reload` e2e failure as out of scope for this refactor and document it explicitly.
  Rationale: The failure concerns focused preference persistence and does not involve deleted route/resolver code paths.
  Date/Author: 2026-02-04 / Codex

## Outcomes & Retrospective

Implemented as planned: removed the dead legacy gateway settings endpoint and its only resolver dependency, leaving `/api/studio` as the sole gateway settings flow and preserving `/api/gateway/tools` for tools proxying. Validation passed for build, typecheck, and unit tests. One e2e test (`focused_preferences_persist_across_reload`) remains failing and appears unrelated to this refactor. Net result: reduced conceptual surface area with low blast radius and no behavior changes in the modified paths.

## Context and Orientation

The active gateway settings flow is:

- `src/lib/gateway/useGatewayConnection.ts` loads/saves `/api/studio` for URL/token.
- `src/app/page.tsx` reads/writes focused/session preferences via `fetchStudioSettings` and `updateStudioSettings`.
- `src/app/api/gateway/tools/route.ts` reads gateway URL/token from `loadStudioSettings()` before proxying `/tools/invoke`.

The legacy, unused flow is:

- `src/app/api/gateway/route.ts` reads local config via `loadClawdbotConfig()` and maps to URL/token through `src/lib/clawdbot/gateway.ts`.

No call sites in the current app use `/api/gateway`. Removing this path reduces conceptual surface area and clarifies that Studio settings are the only gateway connection source for the UI.

## Plan of Work

Milestone 1 removes dead code and validates there are no call-site regressions. Delete `src/app/api/gateway/route.ts` and `src/lib/clawdbot/gateway.ts`, then run repository searches to confirm no stale imports or route references remain.

Milestone 2 aligns docs/tests to the single-source model and runs full validation. Update any documentation that still implies dual gateway-setting sources (if found), then run typecheck/unit/e2e checks appropriate to this repo to confirm behavior is unchanged.

## Concrete Steps

Run all commands from repository root: `/Users/georgepickett/openclaw-studio`.

1. Confirm baseline references before editing.

    rg -n "/api/gateway|resolveGatewayConfig|loadClawdbotConfig" src tests README.md ARCHITECTURE.md

2. Remove dead legacy files.

    rm src/app/api/gateway/route.ts
    rm src/lib/clawdbot/gateway.ts

3. Re-scan to ensure no stale references.

    rg -n "/api/gateway|resolveGatewayConfig" src tests README.md ARCHITECTURE.md

4. Run project verification.

    npm run typecheck
    npm run test

5. If this repo’s e2e suite is available in CI/local environment, run smoke coverage.

    npm run e2e

6. Sync Beads state before commit.

    br update bd-3ve --status in_progress
    br close bd-3ve --reason "Legacy route removed; references cleared; verification passed"
    br update bd-2jf --status in_progress
    br close bd-2jf --reason "Docs/validation aligned; all checks passed"
    br sync --flush-only

## Validation and Acceptance

Acceptance is complete when all conditions are true:

1. `src/app/api/gateway/route.ts` and `src/lib/clawdbot/gateway.ts` are deleted.
2. Searching the repo finds no references to `resolveGatewayConfig` and no usage of `/api/gateway` except `/api/gateway/tools`.
3. `npm run typecheck` succeeds.
4. `npm run test` succeeds.
5. If executed, `npm run e2e` passes or any failures are shown to be unrelated to this change.
6. Gateway connection/edit flows in UI still function through `/api/studio` and `/api/gateway/tools`.

Milestone verification workflow:

1. Tests to write: none required for Milestone 1 because behavior is dead-path deletion with no runtime call sites.
2. Implementation: delete files and stale references.
3. Verification: run `rg` checks plus `npm run typecheck`.
4. Commit: `Milestone 1: remove unused legacy gateway settings endpoint`.

1. Tests to write: only if docs/tests reveal hidden dependency; otherwise no new tests.
2. Implementation: align docs/mentions and finalize cleanup.
3. Verification: run `npm run test` (and `npm run e2e` when available).
4. Commit: `Milestone 2: align docs and validation after gateway path consolidation`.

## Idempotence and Recovery

This plan is idempotent. Re-running searches and checks is safe. If an unexpected dependency appears after deletion, restore the removed files from git history and re-run verification before attempting a narrower cleanup. No runtime data migration is involved.

## Artifacts and Notes

Useful verification snippets to capture in PR description:

- `rg` output showing no `resolveGatewayConfig` references.
- `rg` output showing `/api/gateway/tools` remains while `/api/gateway` legacy route is gone.
- `npm run typecheck` and `npm run test` pass summaries.

## Interfaces and Dependencies

No new interfaces are introduced. This refactor removes one obsolete API route and one obsolete resolver module.

The surviving gateway settings interface remains:

- `src/lib/studio/settings.ts` data model (`StudioSettings`, `StudioSettingsPatch`)
- `src/app/api/studio/route.ts` load/save endpoint
- `src/lib/gateway/useGatewayConnection.ts` and `src/lib/studio/client.ts` callers
- `src/app/api/gateway/tools/route.ts` gateway tools proxy using studio settings

Plan update note (2026-02-04): Initial draft created based on repository-level dependency analysis to remove the highest-value low-risk dead gateway settings path.
Plan update note (2026-02-04): Implementation evidence added, including successful build/typecheck/unit validation, generated-types regeneration rationale, and documentation of an unrelated persistent e2e failure.
