# Separate Fleet Hydration I/O From Pure Derivation

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This document must be maintained in accordance with `/Users/georgepickett/.codex/worktrees/59fe/openclaw-studio/.agent/PLANS.md`.

## Purpose / Big Picture

Today, `hydrateAgentFleetFromGateway()` mixes two concerns: (1) calling the OpenClaw Gateway and Studio settings APIs (network + filesystem-backed I/O) and (2) deciding what the UI should show (derived agent seeds, exec policy resolution, and initial summary selection). After this change, the “what should the UI show” logic will live in a pure function that can be tested with plain data fixtures, while the I/O function becomes a thin snapshot loader that delegates all decisions to the pure derivation.

This matters because it makes the most central “load the world” flow easier to test, easier to change safely, and less likely to regress when gateway response shapes evolve.

## Progress

- [x] (2026-02-13 01:56Z) Install dependencies (`npm ci`) and confirm baseline unit tests pass.
- [x] (2026-02-13 02:00Z) Milestone 1: Introduce pure fleet-hydration derivation function with unit tests.
- [x] (2026-02-13 02:01Z) Milestone 2: Refactor `hydrateAgentFleetFromGateway()` to load snapshots then call the pure derivation, with no behavior changes.
- [x] (2026-02-13 02:24Z) Milestone 3: Tighten types and verify unit tests, typecheck, and e2e pass in a hermetic e2e environment.

## Surprises & Discoveries

- `npm test` failed initially because dependencies were not installed (Vitest not found). `npm ci` was required before any verification.
- Playwright e2e tests were not hermetic: the custom WS proxy reads upstream gateway settings from the Studio host filesystem, so tests could accidentally connect to a real local gateway on developer machines.
- Several e2e tests were stubbing `/api/studio` responses using an older settings shape (they returned `sessions: {}`), but the current client code expects `avatars: {}` to always exist.
- The disconnected startup path renders `GatewayConnectScreen` (not the main fleet layout), so e2e tests that asserted `fleet-sidebar`/`focused-agent-panel` visibility needed to be updated to assert connect-screen behavior instead.

## Decision Log

- Decision: Split fleet hydration into “snapshot loading” and “pure derivation” instead of partially extracting helpers inside the existing function.
  Rationale: This creates an explicit test seam, reduces mocking, and keeps I/O logic localized.
  Date/Author: 2026-02-13 / Codex

## Outcomes & Retrospective

- Extracted a pure, unit-testable fleet hydration derivation (`deriveHydrateAgentFleetResult`) and refactored the I/O hydration function to delegate derivation while preserving behavior.
- Added unit tests for the new pure derivation seam, and tightened them to satisfy `tsc --noEmit`.
- Made e2e tests hermetic by ensuring the Playwright web server runs with an isolated `OPENCLAW_STATE_DIR`, avoiding accidental real-gateway connections on developer machines.
- Updated e2e `/api/studio` fixtures to match the current Studio settings schema (`avatars`) and adjusted expectations to match the disconnected connect screen.

## Context and Orientation

OpenClaw Studio is a Next.js App Router UI that talks to an upstream OpenClaw Gateway over WebSocket RPC. The “fleet hydration” flow is the code path that loads the agent list, per-agent session metadata, exec approvals, and summary previews so the UI can render the fleet sidebar and focused agent panel.

Relevant files:

- `/Users/georgepickett/.codex/worktrees/59fe/openclaw-studio/src/features/agents/operations/agentFleetHydration.ts` exports `hydrateAgentFleetFromGateway()`. This currently performs many gateway calls and derives the `HydrateAgentFleetResult` that seeds the agent store.
- `/Users/georgepickett/.codex/worktrees/59fe/openclaw-studio/src/app/page.tsx` calls `hydrateAgentFleetFromGateway()` inside `loadAgents()` to populate UI state.
- `/Users/georgepickett/.codex/worktrees/59fe/openclaw-studio/tests/unit/agentFleetHydration.test.ts` is the primary unit test that stubs the gateway client and asserts the returned seeds and suggested selected agent.

Terms used in this plan:

- “I/O”: any network call (gateway RPC like `agents.list`) or filesystem-backed API call (Studio settings load via `/api/studio`).
- “Derivation” (pure logic): code that takes already-loaded data and computes UI state without performing I/O.
- “Seed”: the per-agent initial state payload (`AgentStoreSeed`) used to initialize the in-memory agent store.

Non-goals:

- No changes to user-visible behavior, UI rendering, gateway protocol usage, or settings file formats.
- No change in which gateway methods are called during hydration (aside from harmless reordering that does not affect behavior).

## Plan of Work

Milestone 1 creates a new pure function that derives `HydrateAgentFleetResult` from a snapshot object. It must be testable without mocking `client.call()` by passing in plain objects and maps. Write unit tests for this derivation first.

Milestone 2 refactors `hydrateAgentFleetFromGateway()` to become: fetch snapshots (I/O), then call the pure derivation. Keep exports and call sites stable; `src/app/page.tsx` should not need to change.

Milestone 3 runs the full unit test suite and a minimal e2e smoke to ensure nothing regressed, and does any small type tightening needed to keep the new seam maintainable.

## Concrete Steps

All commands are run from `/Users/georgepickett/.codex/worktrees/59fe/openclaw-studio`.

1. Run unit tests to establish a clean baseline:

   npm test

2. Implement Milestone 1 tests-first, running focused tests as you go:

   npm test -- tests/unit/agentFleetHydration.test.ts

3. After each milestone, run the full unit suite:

   npm test

4. At the end, run typecheck and a minimal e2e smoke:

   npm run typecheck
   npm run e2e -- --project=chromium

## Validation and Acceptance

Milestone 1 acceptance:

1. Tests to write:
   - Add a new unit test file `/Users/georgepickett/.codex/worktrees/59fe/openclaw-studio/tests/unit/agentFleetHydrationDerivation.test.ts`.
   - Include at least two tests:
     - `derives_seeds_and_sync_sets_from_snapshots`:
       - Given an `agents.list` result, per-agent `sessions.list` main session entries, a config snapshot with a default model, a settings object with a persisted avatar seed, and an exec approvals snapshot, it returns seeds that match the current behavior (model resolution, exec host/security/ask resolution, avatar seed preference).
     - `derives_summary_patches_and_suggested_agent_when_preview_present`:
       - Given `status` and `sessions.preview` snapshot inputs, it returns non-empty `summaryPatches` and chooses the latest assistant agent as `suggestedSelectedAgentId`.
   - Run `npm test -- tests/unit/agentFleetHydrationDerivation.test.ts` and confirm it fails before implementation.

2. Implementation:
   - Add a new module (path chosen during implementation; prefer colocated with existing flow) that exports:
     - a snapshot input type (plain data, no client)
     - a pure `deriveHydrateAgentFleetResult(snapshot): HydrateAgentFleetResult` function
   - Ensure it reuses existing helper functions where possible (for example `buildAgentMainSessionKey`, `resolveAgentAvatarSeed`, `resolveConfiguredModelKey`, `buildSummarySnapshotPatches`) to avoid behavior drift.

3. Verification:
   - Run `npm test -- tests/unit/agentFleetHydrationDerivation.test.ts` and expect all tests to pass.

4. Commit:
   - Commit with message `Milestone 1: Extract pure fleet hydration derivation`.

Milestone 2 acceptance:

1. Tests to write:
   - Update `/Users/georgepickett/.codex/worktrees/59fe/openclaw-studio/tests/unit/agentFleetHydration.test.ts` only if necessary to account for harmless call ordering or new helper boundaries, but preserve behavioral assertions.
   - If updating tests, ensure changes still prove behavior is unchanged (seed fields and suggested selected agent).

2. Implementation:
   - Refactor `/Users/georgepickett/.codex/worktrees/59fe/openclaw-studio/src/features/agents/operations/agentFleetHydration.ts` so `hydrateAgentFleetFromGateway()`:
     - Loads its gateway/settings snapshots (I/O) using the existing gateway calls and error-handling semantics.
     - Delegates all derived decisions to the pure derivation function from Milestone 1.
   - Keep the function signature and return type unchanged.

3. Verification:
   - Run `npm test -- tests/unit/agentFleetHydration.test.ts` and `npm test`.

4. Commit:
   - Commit with message `Milestone 2: Refactor fleet hydration to snapshot + derive`.

Milestone 3 acceptance:

1. Implementation:
   - Tighten any types introduced by the seam so that future changes don’t regress to `any`/`unknown` where avoidable.
   - Avoid adding new comments unless required for comprehension of non-obvious logic.

2. Verification:
   - Run `npm test`.
   - Run `npm run typecheck`.
   - Run `npm run e2e -- --project=chromium`.

3. Commit:
   - Commit with message `Milestone 3: Verify hydration refactor and tighten types`.

## Idempotence and Recovery

This change is code-only and safe to retry. If a milestone fails, revert to the last green commit and proceed by reapplying smaller refactors until tests pass.

## Artifacts and Notes

Expected baseline commands:

  npm test
  npm run typecheck

## Interfaces and Dependencies

The pure derivation function introduced in Milestone 1 must not call `client.call()` or any other I/O. Its input must be explicit (config snapshot, settings, exec approvals snapshot, agents list result, sessions list entries, and optional summary snapshots).
