# Inline `configList` Helpers Into `agentConfig` (Delete `src/lib/agents/configList.ts`)

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This plan must be maintained in accordance with `.agent/PLANS.md` in this repository.

## Purpose / Big Picture

OpenClaw Studio mutates the gateway config (create/rename/delete agents and update heartbeat settings) through `src/lib/gateway/agentConfig.ts`. Today, that file depends on a tiny helper module, `src/lib/agents/configList.ts`, which exists only to parse and mutate `config.agents.list`.

`src/lib/agents/configList.ts` is not used anywhere else in production code. Keeping it as a separate file creates an extra concept and an extra place to search when debugging gateway config mutations.

After this change, `src/lib/gateway/agentConfig.ts` directly owns the `config.agents.list` parsing/upsert/write helpers (as exported functions in the same module), `src/lib/agents/configList.ts` is deleted, and the dedicated `tests/unit/configList.test.ts` coverage is consolidated into the existing gateway config/heartbeat helper test file.

You can see it working by running unit tests and the normal build gates; there should be no UI behavior changes.

## Progress

- [x] (2026-02-06 20:29Z) Characterize current `configList` usage (prove single-caller) and capture evidence in this plan.
- [x] (2026-02-06 20:31Z) Move the `config.agents.list` helpers into `src/lib/gateway/agentConfig.ts` and update tests to import from the new location.
- [x] (2026-02-06 20:31Z) Delete `src/lib/agents/configList.ts` and `tests/unit/configList.test.ts`, update docs, and ensure there are no remaining references.
- [x] (2026-02-06 20:32Z) Run lint/test/typecheck/build, commit, and archive this ExecPlan to `.agent/done/`.

## Surprises & Discoveries

- (none yet)

## Decision Log

- Decision: Consolidate `config.agents.list` helpers into `src/lib/gateway/agentConfig.ts` and delete `src/lib/agents/configList.ts`.
  Rationale: The helper module is single-caller in production code, and its existence adds an extra file-level concept without reuse. Co-locating the helpers with the gateway config mutation code reduces cognitive load and reduces duplication (both files currently define their own `isRecord` helper).
  Date/Author: 2026-02-06 / Codex

## Outcomes & Retrospective

- Consolidated `agents.list` config helpers into `src/lib/gateway/agentConfig.ts` (now exports `ConfigAgentEntry`, `readConfigAgentList`, `writeConfigAgentList`, `upsertConfigAgentEntry`).
- Deleted `src/lib/agents/configList.ts` and consolidated its test coverage into `tests/unit/heartbeatAgentConfig.test.ts` (deleted `tests/unit/configList.test.ts`).
- Updated `ARCHITECTURE.md` so it points at the new location.
- Gates pass: `npm run lint`, `npm run test`, `npm run typecheck`, `npm run build`.
- Refactor commit: ebec504

## Context and Orientation

OpenClaw Studio talks to an OpenClaw Gateway over WebSocket. Mutations to gateway config (create/rename/delete agents, heartbeat overrides) are done via `config.get` + `config.patch`.

Relevant files:

- `src/lib/gateway/agentConfig.ts`: the single module that performs gateway config reads and writes and also resolves heartbeat settings (defaults + per-agent override).
- `src/lib/agents/configList.ts`: pure helper functions that:
  - read `config.agents.list` as a list of objects with `id`
  - immutably write `agents.list` back into a config record
  - upsert an agent entry by id
- `src/app/page.tsx`: imports gateway config helpers like `createGatewayAgent`, `renameGatewayAgent`, etc.
- `tests/unit/heartbeatAgentConfig.test.ts`: tests `resolveHeartbeatSettings` and `listHeartbeatsForAgent` from `src/lib/gateway/agentConfig.ts`.
- `tests/unit/configList.test.ts`: tests `readConfigAgentList`, `writeConfigAgentList`, and `upsertConfigAgentEntry`.
- `ARCHITECTURE.md`: documents where the `agents.list` helper layer lives.

## Plan of Work

### Milestone 0: Evidence Capture

From repo root, capture evidence that `src/lib/agents/configList.ts` is a single-caller helper in production code:

  rg -n "@/lib/agents/configList" src tests

Record the output in `Artifacts and Notes`.

### Milestone 1: Consolidate Helpers Into `agentConfig.ts` (Test-First)

Goal: move the `config.agents.list` helper functions into `src/lib/gateway/agentConfig.ts` while preserving behavior exactly (the existing unit tests define the expected behavior).

1. Update `tests/unit/heartbeatAgentConfig.test.ts` first:
   - Add a new `describe` block (for example, `describe("gateway config list helpers", ...)`).
   - Port the four tests from `tests/unit/configList.test.ts` into this file.
   - Change the import source to `@/lib/gateway/agentConfig` (import `readConfigAgentList`, `writeConfigAgentList`, `upsertConfigAgentEntry`, and `ConfigAgentEntry` from the gateway module).

2. Run the unit tests and confirm they fail because the helper exports do not exist yet (or because they still come from the old file).

3. Implement the helpers inside `src/lib/gateway/agentConfig.ts`:
   - Copy the code from `src/lib/agents/configList.ts` into `src/lib/gateway/agentConfig.ts`.
   - Reuse the existing `isRecord` helper already defined in `agentConfig.ts` rather than maintaining a second copy.
   - Export the helpers and types from `agentConfig.ts` with the same names currently used by tests:
     - `export type ConfigAgentEntry = Record<string, unknown> & { id: string };`
     - `export const readConfigAgentList = (...) => ...`
     - `export const writeConfigAgentList = (...) => ...`
     - `export const upsertConfigAgentEntry = (...) => ...`
   - Update the rest of `agentConfig.ts` to refer to the local helpers (remove the import from `@/lib/agents/configList`).

4. Re-run `npm run test` and confirm all tests pass.

### Milestone 2: Delete Old Files + Update Docs + Reference Sweep

Goal: remove the now-redundant module and keep documentation accurate.

1. Delete:
   - `src/lib/agents/configList.ts`
   - `tests/unit/configList.test.ts`

2. Update `ARCHITECTURE.md` so it no longer references `src/lib/agents/configList.ts` as the home for config list helpers. Replace it with the new location in `src/lib/gateway/agentConfig.ts`.

3. Confirm no remaining references:

  rg -n "@/lib/agents/configList" src tests

Expect no output.

### Milestone 3: Gates + Commit + Archive

1. Run the standard gates from repo root:

  npm run lint
  npm run test
  npm run typecheck
  npm run build

2. Commit the consolidation with a message like:

  git commit -am "Refactor: inline gateway config list helpers"

3. Archive this ExecPlan:
   - Move `.agent/execplan-pending.md` to `.agent/done/execplan-inline-configlist-into-agentconfig.md`.
   - Commit the doc move:

     git add .agent/done/execplan-inline-configlist-into-agentconfig.md
     git commit -m "Docs: archive execplan for config list consolidation"

## Concrete Steps

From repo root (`/Users/georgepickett/openclaw-studio`):

1. Evidence capture:

     rg -n "@/lib/agents/configList" src tests

2. Update tests first (Milestone 1), then run:

     npm run test

3. Implement helper exports in `src/lib/gateway/agentConfig.ts`, then run:

     npm run test

4. Delete old files and update `ARCHITECTURE.md`, then verify references:

     rg -n "@/lib/agents/configList" src tests

5. Run gates:

     npm run lint
     npm run test
     npm run typecheck
     npm run build

6. Commit + archive per Milestone 3.

## Validation and Acceptance

This work is accepted when:

1. `src/lib/agents/configList.ts` is deleted.
2. `tests/unit/configList.test.ts` is deleted (tests consolidated into `tests/unit/heartbeatAgentConfig.test.ts`).
3. `rg -n "@/lib/agents/configList" src tests` returns no matches.
4. `npm run lint`, `npm run test`, `npm run typecheck`, and `npm run build` all pass.
5. `ARCHITECTURE.md` points to the new home for `agents.list` helper semantics.

## Idempotence and Recovery

This change is safe to retry. If any part fails, a normal `git revert` of the consolidation commit restores the prior module layout.

## Artifacts and Notes

- Paste the output of:

    rg -n "@/lib/agents/configList" src tests

Captured: 2026-02-06 20:29Z

    tests/unit/configList.test.ts:8:} from "@/lib/agents/configList";
    src/lib/gateway/agentConfig.ts:7:} from "@/lib/agents/configList";

## Interfaces and Dependencies

No new dependencies.

The exported helper surface in `src/lib/gateway/agentConfig.ts` must include:

  - `ConfigAgentEntry` type
  - `readConfigAgentList(config: Record<string, unknown> | undefined): ConfigAgentEntry[]`
  - `writeConfigAgentList(config: Record<string, unknown>, list: ConfigAgentEntry[]): Record<string, unknown>`
  - `upsertConfigAgentEntry(list: ConfigAgentEntry[], agentId: string, updater: (entry: ConfigAgentEntry) => ConfigAgentEntry): { list: ConfigAgentEntry[]; entry: ConfigAgentEntry }`
