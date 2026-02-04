# Consolidate `agents.list` Helper Logic Across Gateway and Local Config Paths

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This plan is governed by `.agent/PLANS.md` and must be maintained in accordance with that file.

## Purpose / Big Picture

After this change, OpenClaw Studio will have one shared, pure helper surface for reading and writing `agents.list` entries inside config-shaped objects. Today, the same logic exists in both `src/lib/gateway/agentConfig.ts` and `src/lib/clawdbot/config.ts`, which creates drift risk and forces contributors to reason about two nearly-identical implementations.

The user-visible behavior should remain unchanged: rename/delete/heartbeat edits still work through gateway `config.patch`, and Discord provisioning still updates local `openclaw.json` when needed. What changes is the internal shape: one list-helper concept instead of duplicated helper stacks.

## Progress

- [x] (2026-02-04 02:11Z) Completed repository analysis and selected a single consolidation target with evidence from runtime call paths and helper duplication. [bd-l0q]
- [x] (2026-02-04 02:11Z) Created Beads milestone chain `bd-l0q -> bd-102 -> bd-2yb` for implementation sequencing.
- [x] (2026-02-04 02:14Z) Milestone 1 complete: added `src/lib/agents/configList.ts` and unit coverage in `tests/unit/configList.test.ts` with fail-before/pass-after validation. [bd-l0q]
- [x] (2026-02-04 02:15Z) Milestone 2 complete: migrated `src/lib/gateway/agentConfig.ts` and `src/lib/clawdbot/config.ts` to shared list helpers with targeted tests passing. [bd-102]
- [x] (2026-02-04 02:16Z) Milestone 3 complete: full validation passed and `ARCHITECTURE.md` updated to document shared `agents.list` helper ownership. [bd-2yb]

## Surprises & Discoveries

- Observation: `agents.list` helper logic exists in two modules with near-identical behavior but different local implementations.
  Evidence: `src/lib/gateway/agentConfig.ts` defines `readAgentList`/`writeAgentList` at lines 39 and 48, while `src/lib/clawdbot/config.ts` defines exported `readAgentList`/`writeAgentList` at lines 40 and 46.

- Observation: Gateway mutation flows repeat config hydration prelude (`config.get` -> parse config -> read list) across multiple functions.
  Evidence: repeated sequence in `src/lib/gateway/agentConfig.ts` around lines 195-197, 218-220, and 257-259.

- Observation: Local provisioning paths already consume local list helpers and can migrate with low blast radius.
  Evidence: `src/lib/discord/discordChannel.ts` calls `readAgentList` and `writeAgentList` at lines 75 and 78.

- Observation: Milestone 1 test-first workflow surfaced the missing shared module immediately.
  Evidence: `npm run test -- tests/unit/configList.test.ts` failed with unresolved import for `@/lib/agents/configList` before implementation, then passed with 4 tests after adding the module.

- Observation: Gateway-specific duplicate list helper bodies were removable without changing gateway patch behavior.
  Evidence: `tests/unit/gatewayConfigPatch.test.ts` stayed green after replacing local `readAgentList`/`writeAgentList`/`upsertAgentEntry` with imports from `src/lib/agents/configList.ts`.

- Observation: Keeping `src/lib/clawdbot/config.ts` wrappers while delegating behavior to shared helpers preserves local call-site API stability.
  Evidence: `tests/unit/clawdbotConfig.test.ts` remained unchanged and passed while wrapper internals moved to `readConfigAgentList`/`writeConfigAgentList`.

## Decision Log

- Decision: Target helper-layer consolidation (`agents.list` parsing/writing/upsert) rather than large `page.tsx` extraction.
  Rationale: This gives strong payoff with a smaller blast radius, clear tests, and straightforward rollback.
  Date/Author: 2026-02-04 / Codex

- Decision: Introduce a new shared pure module under `src/lib/agents` and migrate both gateway and local config call sites to it.
  Rationale: Avoids importing Node `fs` concerns into gateway/client modules while removing duplicated list-shape logic.
  Date/Author: 2026-02-04 / Codex

- Decision: Keep external behavior unchanged and treat this as structural consolidation only.
  Rationale: Refactor should reduce concepts and bug surface without user-facing regressions.
  Date/Author: 2026-02-04 / Codex

## Outcomes & Retrospective

Completed all milestones with one new shared helper module, one new unit test file, and two migrations of existing config paths. The codebase now has a single semantic source for `agents.list` read/write/upsert behavior while keeping runtime behavior unchanged for gateway patching and Discord provisioning.

Validation summary:
- `npm run typecheck` passed.
- `npm run test` passed with 21 files / 70 tests.
- Structural check confirms gateway no longer defines local `readAgentList`/`writeAgentList` helper bodies, and local wrappers in `src/lib/clawdbot/config.ts` now delegate to the shared module.

## Context and Orientation

OpenClaw Studio has two config domains that both store agent entries under `config.agents.list`:

`src/lib/gateway/agentConfig.ts` handles gateway-backed rename/delete/heartbeat updates. These operations fetch config via `config.get`, mutate agent entries, and submit patches via `config.patch`.

`src/lib/clawdbot/config.ts` handles local config file access used by local-only flows such as Discord provisioning. It exports `readAgentList` and `writeAgentList`, and `src/lib/discord/discordChannel.ts` uses those helpers.

Despite the same conceptual data shape, each domain currently carries its own list parsing/writing implementation. This is a classic duplicate-abstraction smell. If one implementation changes (shape checks, filtering, merge semantics) and the other does not, bugs emerge in one path only.

## Plan of Work

Milestone 1 creates a shared module, `src/lib/agents/configList.ts`, containing pure helpers for `agents.list` operations on config-shaped objects. This module must not import Node-specific APIs. Add tests in `tests/unit/configList.test.ts` that lock down list parsing, list writes, and upsert behavior.

Milestone 2 migrates `src/lib/gateway/agentConfig.ts` and `src/lib/clawdbot/config.ts` to consume the shared helpers. Remove duplicated local helper implementations from those files. Keep function signatures used by current call sites stable where practical to avoid unnecessary churn in `src/lib/discord/discordChannel.ts` and existing tests.

Milestone 3 runs full validation and updates `ARCHITECTURE.md` only if wording no longer matches the new helper ownership. The update should be small and scoped to helper-boundary statements.

## Concrete Steps

Run from repo root:

    cd /Users/georgepickett/openclaw-studio

Start with baseline evidence:

    rg -n "const readAgentList|const writeAgentList|type AgentEntry" src/lib/gateway/agentConfig.ts src/lib/clawdbot/config.ts

Implement Milestone 1 (test-first):

    # add tests/unit/configList.test.ts first
    npm run test -- tests/unit/configList.test.ts
    # confirm failing tests before implementation

    # add src/lib/agents/configList.ts
    npm run test -- tests/unit/configList.test.ts
    # confirm pass after implementation

Implement Milestone 2:

    # update src/lib/gateway/agentConfig.ts to use shared helpers
    # update src/lib/clawdbot/config.ts to use shared helpers
    # adjust tests if needed (tests/unit/clawdbotConfig.test.ts, tests/unit/gatewayConfigPatch.test.ts)

    npm run test -- tests/unit/configList.test.ts tests/unit/clawdbotConfig.test.ts tests/unit/gatewayConfigPatch.test.ts

Implement Milestone 3 validation:

    npm run typecheck
    npm run test
    rg -n "const readAgentList|const writeAgentList" src/lib/gateway/agentConfig.ts src/lib/clawdbot/config.ts

Beads workflow during implementation:

    br ready --json
    br update bd-l0q --status in_progress
    # complete milestone, commit
    br close bd-l0q --reason "Tests pass, committed"

    br update bd-102 --status in_progress
    # complete milestone, commit
    br close bd-102 --reason "Tests pass, committed"

    br update bd-2yb --status in_progress
    # complete milestone, commit
    br close bd-2yb --reason "Tests pass, committed"
    br sync --flush-only

## Validation and Acceptance

Acceptance is complete when all conditions are true:

1. Shared helper module exists for `agents.list` operations and is covered by unit tests.
2. `src/lib/gateway/agentConfig.ts` and `src/lib/clawdbot/config.ts` no longer each define their own local `readAgentList`/`writeAgentList` stacks.
3. Runtime behavior is unchanged for gateway rename/delete/heartbeat flows and Discord provisioning.
4. `npm run typecheck` and `npm run test` pass.

Milestone verification workflow:

Milestone 1 (`bd-l0q`) writes `tests/unit/configList.test.ts` first with explicit assertions for list extraction, write semantics, and upsert behavior. Run the file and confirm failure, implement `src/lib/agents/configList.ts`, rerun and confirm pass. Commit with message `Milestone 1: add shared agents.list config helpers`.

Milestone 2 (`bd-102`) migrates gateway and local config modules to the shared helper and removes duplicated local helper bodies. Run targeted unit tests for config and gateway patch logic. Commit with message `Milestone 2: migrate config modules to shared agents.list helpers`.

Milestone 3 (`bd-2yb`) runs full `typecheck` and `test`, then applies architecture wording updates only if needed. Commit with message `Milestone 3: validate agents.list helper consolidation`.

## Idempotence and Recovery

This refactor is code-only and safe to rerun. If a migration step fails, revert the working tree to the last milestone commit and rerun from that milestone. No data migrations or destructive filesystem operations are required.

## Artifacts and Notes

Capture this proof in implementation notes:

    npm run test -- tests/unit/configList.test.ts
    npm run test -- tests/unit/clawdbotConfig.test.ts tests/unit/gatewayConfigPatch.test.ts
    npm run typecheck && npm run test

And this structural proof:

    rg -n "const readAgentList|const writeAgentList" src/lib/gateway/agentConfig.ts src/lib/clawdbot/config.ts

Expected final state: helper definitions are centralized in `src/lib/agents/configList.ts`.

## Interfaces and Dependencies

Define the shared helper module in `src/lib/agents/configList.ts` with stable, explicit exports such as:

- `type ConfigAgentEntry = Record<string, unknown> & { id: string }`
- `readConfigAgentList(config: Record<string, unknown> | undefined): ConfigAgentEntry[]`
- `writeConfigAgentList(config: Record<string, unknown>, list: ConfigAgentEntry[]): Record<string, unknown>`
- `upsertConfigAgentEntry(list: ConfigAgentEntry[], agentId: string, updater: (entry: ConfigAgentEntry) => ConfigAgentEntry): { list: ConfigAgentEntry[]; entry: ConfigAgentEntry }`

`src/lib/gateway/agentConfig.ts` and `src/lib/clawdbot/config.ts` should consume these helpers and keep their current public behavior stable.

No new third-party dependencies are needed.

Plan update note (2026-02-04): Created this plan after identifying duplicate `agents.list` helper implementations across gateway and local config modules; selected this as the highest-value low-blast consolidation target.
Plan update note (2026-02-04): Marked all milestones complete after implementing shared helpers, migrating call sites, running full validation, and syncing architecture docs.
