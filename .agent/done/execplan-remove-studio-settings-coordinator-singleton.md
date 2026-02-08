# Consolidate Studio Settings Coordination By Removing The Global Singleton

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This repository has an ExecPlan format and requirements documented at `.agent/PLANS.md` (from the repository root). This document must be maintained in accordance with `.agent/PLANS.md`.

## Purpose / Big Picture

OpenClaw Studio persists user settings (gateway URL/token, focused filter, avatar seeds) through a client-side debounced coordinator that writes to `/api/studio`. Today, that coordinator is hidden behind a global singleton getter and is “owned” by two different call sites (`src/app/page.tsx` and `src/lib/gateway/useGatewayConnection.ts`).

After this change, the Studio settings coordinator will have a single explicit owner (the app page), and other code will receive it as a dependency. This reduces hidden shared state, removes ambiguous lifecycle/cleanup responsibility, and makes unit tests simpler because they no longer need to module-mock a singleton.

## Progress

- [x] (2026-02-08) Remove the global `getStudioSettingsCoordinator` singleton and replace it with an explicit factory for creating coordinators.
- [x] (2026-02-08) Update `src/lib/gateway/useGatewayConnection.ts` to accept a coordinator dependency instead of importing a singleton.
- [x] (2026-02-08) Update `src/app/page.tsx` to own a single coordinator instance and pass it to the gateway connection hook; ensure focused filter and avatar persistence still use the same instance.
- [x] (2026-02-08) Update unit tests that currently mock the singleton (`tests/unit/useGatewayConnection.test.ts`) and ensure all tests pass.
- [x] (2026-02-08) Run `npm run typecheck`, `npm run lint`, `npm run test`, and (optional) `npm run e2e` to validate behavior.

## Surprises & Discoveries

- None yet.

## Decision Log

- Decision: Make the Studio settings coordinator an explicit dependency owned by `src/app/page.tsx`, and pass it into `useGatewayConnection` rather than using a module-level singleton.
  Rationale: Both `src/app/page.tsx` and `src/lib/gateway/useGatewayConnection.ts` currently call `getStudioSettingsCoordinator()`, which hides that they share a single instance. This creates ambiguous ownership and cleanup (both places call `flushPending()` on unmount) and forces tests to module-mock the singleton rather than passing a stub.
  Date/Author: 2026-02-08 / Codex

## Outcomes & Retrospective

- Not started yet.

## Context and Orientation

Studio settings are defined and normalized in `src/lib/studio/settings.ts`. These settings include:

1. `gateway` connection settings (URL + token).
2. `focused` preferences (per-gateway filter, selected agent, mode).
3. `avatars` seeds (per-gateway, per-agent).

Studio settings persistence lives behind `/api/studio` implemented in `src/app/api/studio/route.ts`, which reads/writes a JSON file via `src/lib/studio/settings-store.ts`.

On the client, settings are loaded and updated using `StudioSettingsCoordinator` in `src/lib/studio/coordinator.ts`. This coordinator debounces and coalesces multiple patches into fewer PUT requests. A module-level singleton getter `getStudioSettingsCoordinator()` currently returns a shared instance.

Two separate parts of the UI currently import and use that singleton:

1. `src/lib/gateway/useGatewayConnection.ts` loads and persists the gateway URL/token using a coordinator it obtains from `getStudioSettingsCoordinator()`.
2. `src/app/page.tsx` loads and persists focused preferences and avatar seeds using a coordinator it obtains from `getStudioSettingsCoordinator()`.

Because both call sites obtain the coordinator via a singleton, the code hides the fact that there is shared mutable state and shared lifecycle. This makes the ownership boundary unclear, and it makes unit tests (notably `tests/unit/useGatewayConnection.test.ts`) depend on module-mocking the singleton rather than passing a simple stub.

## Plan of Work

### Milestone 1: Replace The Singleton With An Explicit Factory

At the end of this milestone, there is no module-level singleton coordinator. Instead, the `src/lib/studio/coordinator.ts` module exposes a factory for creating a new coordinator with the default `/api/studio` transport, and call sites explicitly create/own the instance they use.

1. In `src/lib/studio/coordinator.ts`, remove:

   - The module-level `studioSettingsCoordinator` variable.
   - `getStudioSettingsCoordinator()`.
   - `resetStudioSettingsCoordinator()` (it is only meaningful with a singleton).

2. In `src/lib/studio/coordinator.ts`, add:

   - `createStudioSettingsCoordinator(options?: { debounceMs?: number })` that returns `new StudioSettingsCoordinator({ fetchSettings: fetchStudioSettings, updateSettings: updateStudioSettings }, debounceMs ?? 350)`.

   Keep `fetchStudioSettings` and `updateStudioSettings` as-is so the default transport is still available in one place.

3. Run unit tests that cover the coordinator behavior:

   - Command (repo root): `npm run test -- tests/unit/studioSettingsCoordinator.test.ts`
   - Expected: all tests pass.

Verification notes: `tests/unit/studioSettingsCoordinator.test.ts` constructs `StudioSettingsCoordinator` directly, so it should continue to pass. The goal of this milestone is primarily to remove the singleton surface area and provide a clear replacement entry point.

Commit after verification with message: `Milestone 1: Remove studio settings coordinator singleton`.

### Milestone 2: Make `useGatewayConnection` Accept The Coordinator As A Dependency

At the end of this milestone, `src/lib/gateway/useGatewayConnection.ts` no longer imports `getStudioSettingsCoordinator()` and instead takes a coordinator-like object as an argument. This makes its settings I/O explicit and makes tests straightforward (pass a stub instead of module-mocking a singleton).

1. In `src/lib/gateway/useGatewayConnection.ts`:

   - Remove the import of `getStudioSettingsCoordinator` from `@/lib/studio/coordinator`.
   - Add a parameter to the hook, for example:

     - `export const useGatewayConnection = (settingsCoordinator: { loadSettings: () => Promise<unknown>; schedulePatch: (patch: unknown, debounceMs?: number) => void; flushPending: () => Promise<void> }): GatewayConnectionState => { ... }`

     Prefer a narrowly-scoped type (only the methods used) instead of importing the coordinator class as a value dependency. If you import a type, use `import type` so Next does not treat it as a runtime dependency.

   - Remove the internal `useState(() => getStudioSettingsCoordinator())` and use the passed `settingsCoordinator`.

   - Remove the unmount cleanup that calls `settingsCoordinator.flushPending()` if the page owns flushing; keep `client.disconnect()` cleanup.

2. In `src/app/page.tsx`:

   - Replace `getStudioSettingsCoordinator()` usage with `createStudioSettingsCoordinator()`, created once via `useState`:

     - `const [settingsCoordinator] = useState(() => createStudioSettingsCoordinator());`

   - Pass that instance into the hook:

     - `const connection = useGatewayConnection(settingsCoordinator);`

   - Ensure all other uses (focused preference load/patch, avatar shuffle patch) continue to use that same `settingsCoordinator` instance.

   - Ensure there is exactly one flush-on-unmount for the coordinator (in `src/app/page.tsx`), and avoid double-flush from both the page and the gateway connection hook.

3. Update `tests/unit/useGatewayConnection.test.ts`:

   - Remove the module mock for `@/lib/studio/coordinator`.
   - Provide a stub coordinator object and pass it into the hook when rendering the probe component.
   - Keep the existing `NEXT_PUBLIC_GATEWAY_URL` import-time behavior test approach (reset modules so `DEFAULT_GATEWAY_URL` is re-evaluated).

4. Verification:

   - Command (repo root): `npm run test -- tests/unit/useGatewayConnection.test.ts`
   - Command (repo root): `npm run test`
   - Expected: all tests pass.

Commit after verification with message: `Milestone 2: Pass studio settings coordinator into gateway connection hook`.

### Milestone 3: Full Validation Sweep (Typecheck, Lint, Optional E2E)

1. Typecheck:

   - Command (repo root): `npm run typecheck`
   - Expected: exits 0.

2. Lint:

   - Command (repo root): `npm run lint`
   - Expected: exits 0.

3. Unit tests:

   - Command (repo root): `npm run test`
   - Expected: exits 0.

4. Optional E2E (only if Playwright browsers are installed and a local environment is available):

   - Command (repo root): `npm run e2e`
   - Expected: exits 0.

Commit after verification with message: `Milestone 3: Validate coordinator dependency refactor`.

## Concrete Steps

All commands should be run from the repository root:

  cd /Users/georgepickett/openclaw-studio

Suggested flow for the implementing agent:

1. Edit `src/lib/studio/coordinator.ts` to remove the singleton and add the factory.
2. Run:

   npm run test -- tests/unit/studioSettingsCoordinator.test.ts

3. Edit `src/lib/gateway/useGatewayConnection.ts` to accept a coordinator parameter.
4. Edit `src/app/page.tsx` to create and pass the coordinator, and remove now-invalid imports.
5. Edit `tests/unit/useGatewayConnection.test.ts` to pass a stub coordinator and remove singleton mocks.
6. Run:

   npm run test -- tests/unit/useGatewayConnection.test.ts
   npm run test
   npm run typecheck
   npm run lint

## Validation and Acceptance

Acceptance is satisfied when all of the following are true:

1. `npm run test` passes, including `tests/unit/studioSettingsCoordinator.test.ts` and `tests/unit/useGatewayConnection.test.ts`.
2. `npm run typecheck` passes.
3. `npm run lint` passes.
4. `src/app/page.tsx` owns a single Studio settings coordinator instance used for:

   - Persisting gateway URL/token (via `useGatewayConnection`).
   - Persisting focused filter per gateway URL.
   - Persisting avatar seeds per gateway URL.

5. There is no longer a module-level singleton exported as `getStudioSettingsCoordinator`, and no production code depends on it.

Manual spot-check (optional but useful):

1. Run `npm run dev`.
2. Open `http://localhost:3000`.
3. Change gateway URL/token in the connection UI, reload the page, and confirm the values persist.
4. Change the focused filter, reload the page, and confirm it persists for the same gateway URL.
5. Shuffle an agent avatar, reload the page, and confirm the avatar seed persists for that agent for the same gateway URL.

## Idempotence and Recovery

This refactor is safe to retry because it is purely code changes. If the hook signature change breaks compilation, revert the call sites in `src/app/page.tsx` and the corresponding unit test updates, then re-apply changes in smaller increments.

If test failures occur, prioritize restoring compilation and passing `npm run test` before attempting optional E2E validation.

## Artifacts and Notes

- Key files involved:

  - `src/lib/studio/coordinator.ts`
  - `src/lib/gateway/useGatewayConnection.ts`
  - `src/app/page.tsx`
  - `tests/unit/useGatewayConnection.test.ts`
