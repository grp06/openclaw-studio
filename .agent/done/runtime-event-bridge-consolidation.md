# Consolidate Runtime Gateway Event Handling into One Event Bridge

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This plan is governed by `.agent/PLANS.md` and must be maintained in accordance with that file.

## Purpose / Big Picture

After this refactor, OpenClaw Studio will process gateway runtime events through one explicit event bridge path instead of three independent `client.onEvent` handlers in `src/app/page.tsx`. The user-visible behavior should remain the same (streaming text, thinking traces, tool lines, run lifecycle updates, history fallback), but the implementation will have a single, testable runtime-event core.

Today, event behavior is split across multiple hooks in one very large page module, which increases divergence risk for run cleanup and status transitions. Consolidating into one bridge reduces cognitive load and bug surface for any future protocol updates.

## Progress

- [x] (2026-02-04 02:18Z) Completed fresh deep-repo analysis and selected a single consolidation target with highest payoff/low-to-moderate blast radius. [bd-2j3]
- [x] (2026-02-04 02:18Z) Created Beads milestone chain `bd-2j3 -> bd-26b -> bd-c8o` for execution ordering.
- [x] (2026-02-04 18:22Z) Milestone 1 complete: added pure runtime bridge helpers and unit tests; verified red->green path for `tests/unit/runtimeEventBridge.test.ts`. [bd-2j3]
- [x] (2026-02-04 18:24Z) Milestone 2 complete: consolidated runtime chat+agent handling into one listener path in `src/app/page.tsx` backed by bridge helpers and shared run tracking cleanup. [bd-26b]
- [x] (2026-02-04 18:26Z) Milestone 3 complete: passed `npm run typecheck`, `npm run test`, and `npm run e2e`; synced `ARCHITECTURE.md` runtime-event wording. [bd-c8o]

## Surprises & Discoveries

- Observation: Runtime event handling is spread across three `client.onEvent` subscriptions in one file.
  Evidence: `src/app/page.tsx` contains listeners beginning around lines 982, 1337, and 1525.

- Observation: Chat and agent handlers both mutate overlapping run lifecycle state (`runId`, `streamText`, `thinkingTrace`, tool line de-dup maps).
  Evidence: repeated cleanup and patch logic across chat final/aborted/error branches and agent lifecycle end/error branches in `src/app/page.tsx`.

- Observation: The page file has very high orchestration density.
  Evidence: `src/app/page.tsx` is ~1903 lines and includes connection flow, state persistence, message sending, runtime event processing, and inspect actions.

- Observation: Existing runtime dedupe/cleanup behavior can be preserved while still collapsing listeners.
  Evidence: chat and agent listeners now execute under one `client.onEvent` path in `src/app/page.tsx`, while shared helper behavior (`mergeRuntimeStream`, `dedupeRunLines`, lifecycle transitions, stream publish guards) lives in `src/features/agents/state/runtimeEventBridge.ts`.

## Decision Log

- Decision: Prioritize runtime-event consolidation over broader page decomposition.
  Rationale: It targets the highest-risk duplicated logic with clearer verification than full page extraction.
  Date/Author: 2026-02-04 / Codex

- Decision: Build a pure event bridge helper layer first, then wire it into page orchestration.
  Rationale: Test-first pure helpers reduce migration risk and preserve behavior parity.
  Date/Author: 2026-02-04 / Codex

- Decision: Preserve existing UX behavior and avoid protocol-level changes.
  Rationale: This is a structural refactor; behavior changes would increase blast radius and validation cost.
  Date/Author: 2026-02-04 / Codex

## Outcomes & Retrospective

Completed.

- Added `src/features/agents/state/runtimeEventBridge.ts` with pure helper contracts for stream merge, tool-line dedupe, lifecycle transitions, and stream publish gating.
- Added `tests/unit/runtimeEventBridge.test.ts` and verified expected failing import before implementation, then passing assertions after implementation.
- Consolidated runtime `chat` and `agent` event handling into one listener path in `src/app/page.tsx`.
- Replaced duplicated line-level dedupe checks with shared `appendUniqueToolLines` + `clearRunTracking` helper callbacks in page runtime orchestration.
- Synced `ARCHITECTURE.md` to document the runtime bridge ownership.

## Context and Orientation

`src/app/page.tsx` currently owns runtime event behavior end-to-end. It subscribes to gateway frames and applies agent store updates for chat deltas/finals, tool output lines, lifecycle status transitions, and fallback history fetches.

The event logic is split:

- One listener for heartbeat/presence summary refresh scheduling.
- One listener for `chat` events.
- One listener for `agent` events.

These listeners share mutable refs (`chatRunSeenRef`, `assistantStreamByRunRef`, `toolLinesSeenRef`) and manipulate the same store fields (`runId`, `status`, `streamText`, `thinkingTrace`, `lastResult`, `sessionCreated`). This coupling is implicit and hard to reason about.

The refactor introduces a dedicated runtime-event bridge module under `src/features/agents/state` that expresses event-to-patch behavior as pure functions where possible. `page.tsx` remains orchestrator but delegates event translation and cleanup decisions to that bridge.

## Plan of Work

Milestone 1 creates pure bridge helpers (new module) and unit tests that lock down the behavior of chat and agent event handling primitives. Tests must cover final/aborted/error cleanup, tool line extraction/de-dup application behavior, and lifecycle transitions.

Milestone 2 rewires `src/app/page.tsx` to use one runtime event bridge integration path instead of independent event handlers. Keep the summary refresh listener if required by concerns separation, but runtime chat+agent mutation flow should be centralized through the bridge API.

Milestone 3 runs full validation (`typecheck`, unit tests, e2e) and updates `ARCHITECTURE.md` runtime-event wording if needed to reflect single bridge ownership.

## Concrete Steps

Run from repo root:

    cd /Users/georgepickett/openclaw-studio

Confirm current event split:

    rg -n "client\.onEvent\(\(event: EventFrame\) =>" src/app/page.tsx

Milestone 1 test-first:

    # add tests/unit/runtimeEventBridge.test.ts first
    npm run test -- tests/unit/runtimeEventBridge.test.ts
    # confirm expected failure before implementation

    # add src/features/agents/state/runtimeEventBridge.ts
    npm run test -- tests/unit/runtimeEventBridge.test.ts
    # confirm pass after helper implementation

Milestone 2 migration:

    # update src/app/page.tsx to use bridge helpers
    npm run test -- tests/unit/runtimeEventBridge.test.ts tests/unit/agentStore.test.ts tests/unit/agentSummary.test.ts

Milestone 3 full validation:

    npm run typecheck
    npm run test
    npm run e2e

If architecture wording needs adjustment:

    # update ARCHITECTURE.md runtime event flow description only

Beads workflow:

    br ready --json
    br update bd-2j3 --status in_progress
    # complete + commit
    br close bd-2j3 --reason "Tests pass, committed"

    br update bd-26b --status in_progress
    # complete + commit
    br close bd-26b --reason "Tests pass, committed"

    br update bd-c8o --status in_progress
    # complete + commit
    br close bd-c8o --reason "Tests pass, committed"
    br sync --flush-only

## Validation and Acceptance

Acceptance is complete when all conditions are true:

1. Runtime chat/agent event mutation logic is centralized behind a single bridge helper surface (no duplicated branch stacks across multiple listeners).
2. Run lifecycle cleanup (`runId` maps, stream/thinking reset, tool-line cleanup) follows one consistent implementation path.
3. Existing behavior remains intact for chat streaming, tool output rendering, heartbeat/cron latest-update behavior, and fallback history loading.
4. `npm run typecheck`, `npm run test`, and `npm run e2e` pass.

Milestone verification workflow:

Milestone 1 (`bd-2j3`) writes `tests/unit/runtimeEventBridge.test.ts` first and asserts explicit event transitions and cleanup outputs. Confirm failure first, implement `src/features/agents/state/runtimeEventBridge.ts`, rerun and pass. Commit with message `Milestone 1: add runtime event bridge helpers`.

Milestone 2 (`bd-26b`) migrates `src/app/page.tsx` to consume bridge helpers and removes duplicated runtime event branches. Run targeted tests for bridge/store/summary behavior. Commit with message `Milestone 2: route page runtime listeners through event bridge`.

Milestone 3 (`bd-c8o`) runs full validation and applies architecture sync if required. Commit with message `Milestone 3: validate runtime event bridge consolidation`.

## Idempotence and Recovery

This is a code-only refactor and is safe to rerun. If migration breaks behavior, revert to the previous milestone commit and reapply incrementally. Avoid destructive filesystem operations. Keep event behavior parity checks in tests before advancing milestones.

## Artifacts and Notes

Capture these artifacts during implementation:

    rg -n "client\.onEvent\(\(event: EventFrame\) =>" src/app/page.tsx
    # expected final: runtime chat/agent flow consolidated (single bridge path)

    npm run test -- tests/unit/runtimeEventBridge.test.ts
    npm run test -- tests/unit/agentStore.test.ts tests/unit/agentSummary.test.ts
    npm run typecheck && npm run test && npm run e2e

## Interfaces and Dependencies

Define bridge helpers in `src/features/agents/state/runtimeEventBridge.ts` with explicit pure interfaces for event-to-patch translation and cleanup instructions. The module should be framework-agnostic (no React hooks inside pure helpers).

`src/app/page.tsx` should remain responsible for side effects (history fetches, cron fetches, dispatch timing), but delegate branch-heavy event mutation decisions to bridge helpers.

No new external dependencies are required.

Plan update note (2026-02-04): Created this plan after identifying high coupling and duplicated lifecycle logic across three runtime event listeners in `src/app/page.tsx`; selected event-bridge consolidation as the highest-value structural refactor.
