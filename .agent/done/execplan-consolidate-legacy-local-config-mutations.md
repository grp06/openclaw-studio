# Consolidate Legacy Local Agent Config Mutations

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This plan is governed by `.agent/PLANS.md` and must be maintained in accordance with that file.

## Purpose / Big Picture

After this change, OpenClaw Studio will expose one clear runtime ownership model for agent mutations: gateway-backed config updates for rename/delete/heartbeat, with local `openclaw.json` mutation limited to optional Discord provisioning only. A new contributor will no longer see stale local mutation helpers and default-workspace resolver code that imply the app still mutates local agent config for normal runtime flows.

The behavior after implementation is visible in two ways. First, the runtime app behavior stays the same for focused chat, inspect, and gateway-backed edits. Second, the repository surface is smaller and clearer: no unused local mutation helper APIs, no orphaned default-agent resolver module, and Discord provisioning reuses shared list helpers instead of ad-hoc list mutation logic.

## Progress

- [x] (2026-02-04 02:03Z) Completed repository analysis, identified duplication/dead-code evidence, and selected a single consolidation target. [bd-15h]
- [x] (2026-02-04 02:03Z) Created milestone Beads issues and dependency chain (`bd-15h` -> `bd-1t5` -> `bd-151`).
- [x] (2026-02-04 02:06Z) Milestone 1 implemented: removed dead local mutation/default-agent surfaces and updated tests with fail-before/pass-after proof. [bd-15h]
- [x] (2026-02-04 02:07Z) Milestone 2 implemented: consolidated Discord agent list writes to shared config helpers and validated with targeted unit tests. [bd-1t5]
- [x] (2026-02-04 02:08Z) Milestone 3 implemented: full validation passed and architecture wording confirmed already aligned (no doc edits required). [bd-151]

## Surprises & Discoveries

- Observation: `src/lib/clawdbot/resolveDefaultAgent.ts` is not used by runtime code.
  Evidence: `rg -n "from \"@/lib/clawdbot/resolveDefaultAgent\"" src tests` returns only `tests/unit/messageHelpers.test.ts`.

- Observation: local config mutation exports in `src/lib/clawdbot/config.ts` are effectively test-only.
  Evidence: `rg -n "updateClawdbotConfig|renameAgentEntry|removeAgentEntry|upsertAgentEntry" src tests` returns declarations and unit tests, but no runtime call sites.

- Observation: agent-list mutation logic exists in two local-config places despite gateway-first runtime ownership.
  Evidence: `src/lib/clawdbot/config.ts` defines list helpers, while `src/lib/discord/discordChannel.ts` has separate inline `ensureAgentConfig` list mutation logic.

- Observation: `tests/unit/clawdbotConfig.test.ts` can enforce removal of a legacy export with a runtime module-shape assertion.
  Evidence: test `does not expose legacy mutation wrapper` failed before removing `updateClawdbotConfig` and passed after the export deletion.

- Observation: Discord local config writes can reuse existing `readAgentList`/`writeAgentList` without changing call-site behavior.
  Evidence: `ensureAgentConfig` switched to shared helpers and targeted unit suites remained green.

- Observation: Architecture text did not require edits after the consolidation.
  Evidence: `ARCHITECTURE.md` already described local config writes as optional Discord/local-helper behavior and did not reference removed legacy mutation wrappers.

## Decision Log

- Decision: Prioritize consolidation of legacy local-config mutation surfaces over `src/app/page.tsx` decomposition.
  Rationale: This has a much smaller blast radius and directly removes a misleading abstraction layer that conflicts with the current gateway-first architecture.
  Date/Author: 2026-02-04 / Codex

- Decision: Keep Discord provisioning as the only local `openclaw.json` write path.
  Rationale: Discord channel provisioning is explicitly local-gateway-only and still needs local config writes; removing those writes would change product behavior.
  Date/Author: 2026-02-04 / Codex

- Decision: Treat this as a consolidation-and-clarity refactor, not a behavior change.
  Rationale: The goal is reducing concepts and bug surface while preserving runtime behavior.
  Date/Author: 2026-02-04 / Codex

## Outcomes & Retrospective

Completed all three milestones with two code commits and one validation-only closure step. The repository now has a clearer gateway-first mutation boundary: legacy local mutation exports and legacy default-agent resolver code were removed, Discord local list mutation logic was consolidated onto shared helpers, and runtime behavior remained unchanged across validation.

Validation evidence:
- `npm run typecheck` passed.
- `npm run test` passed with 20 test files and 66 tests.
- `rg -n "updateClawdbotConfig|renameAgentEntry|removeAgentEntry|resolveDefaultAgent" src` returned no matches.

## Context and Orientation

OpenClaw Studio is now gateway-first in runtime behavior. Agent rename/delete/heartbeat updates go through gateway calls in `src/lib/gateway/agentConfig.ts` and are driven from `src/app/page.tsx` and `src/features/agents/components/AgentInspectPanel.tsx`.

Local config and path helpers live under `src/lib/clawdbot`. The file `src/lib/clawdbot/config.ts` still exports broad local mutation helpers (`upsertAgentEntry`, `renameAgentEntry`, `removeAgentEntry`, `updateClawdbotConfig`) that were useful in earlier local-workspace architecture, but they are no longer used by runtime code. The file `src/lib/clawdbot/resolveDefaultAgent.ts` similarly represents legacy default-agent/workspace behavior and is only referenced by unit tests.

Discord provisioning in `src/lib/discord/discordChannel.ts` is a legitimate local-config flow (it can update bindings and channel config in local `openclaw.json` for local gateways), but it currently performs agent-list mutation inline instead of reusing shared list helpers already available in `src/lib/clawdbot/config.ts`.

This plan removes dead surfaces and consolidates the remaining local write logic to one explicit boundary so future contributors do not accidentally reintroduce local config mutation into runtime agent-management flows.

## Plan of Work

Milestone 1 removes dead legacy surfaces and updates tests that currently keep those surfaces alive. Remove `src/lib/clawdbot/resolveDefaultAgent.ts` and stop asserting its behavior in `tests/unit/messageHelpers.test.ts`. In `src/lib/clawdbot/config.ts`, remove unused mutation exports that are not called by application code. Rewrite `tests/unit/clawdbotConfig.test.ts` so it validates only helpers that remain intentionally supported.

Milestone 2 consolidates Discord-side local config writes onto shared list helpers to remove duplicate list mutation logic. Update `src/lib/discord/discordChannel.ts` so `ensureAgentConfig` uses `readAgentList` and `writeAgentList` from `src/lib/clawdbot/config.ts` rather than reimplementing list handling.

Milestone 3 validates behavior and aligns architecture text only if wording is now stale. Run full typecheck and test suites; run targeted grep checks to prove removed surfaces are gone from runtime call sites. If `ARCHITECTURE.md` still implies broader local mutation paths, update only the affected sentence(s).

## Concrete Steps

Work from repo root:

    cd /Users/georgepickett/openclaw-studio

Inspect and confirm dead/duplicate surfaces before edits:

    rg -n "updateClawdbotConfig|renameAgentEntry|removeAgentEntry|upsertAgentEntry|resolveDefaultAgent" src tests
    rg -n "from \"@/lib/clawdbot/resolveDefaultAgent\"" src tests

Implement Milestone 1 edits:

    # edit src/lib/clawdbot/config.ts
    # delete src/lib/clawdbot/resolveDefaultAgent.ts
    # edit tests/unit/clawdbotConfig.test.ts
    # edit tests/unit/messageHelpers.test.ts

Implement Milestone 2 edits:

    # edit src/lib/discord/discordChannel.ts
    # reuse readAgentList/writeAgentList from src/lib/clawdbot/config.ts

Run targeted checks while iterating:

    npm run test -- tests/unit/clawdbotConfig.test.ts tests/unit/messageHelpers.test.ts

Run full validation for Milestone 3:

    npm run typecheck
    npm run test
    rg -n "updateClawdbotConfig|renameAgentEntry|removeAgentEntry|resolveDefaultAgent" src

If Beads state is updated during implementation, flush before commits:

    br sync --flush-only

## Validation and Acceptance

Acceptance is complete when all of the following are true:

1. Runtime source files under `src/app` and `src/features` do not reference removed legacy local mutation APIs (`updateClawdbotConfig`, `renameAgentEntry`, `removeAgentEntry`, `resolveDefaultAgent*`).
2. Discord provisioning still compiles and preserves current behavior for ensuring local config entries/bindings.
3. `npm run typecheck` passes.
4. `npm run test` passes.

Milestone verification workflow:

Milestone 1 (`bd-15h`) is complete when legacy local mutation/default-agent surfaces are removed and tests are updated. Write/adjust tests first so they express the new contract (no legacy helper expectations), run the targeted unit tests to observe failure before implementation, implement, then rerun until green. Commit with a message like `Milestone 1: remove dead local config mutation APIs`.

Milestone 2 (`bd-1t5`) is complete when Discord local config mutation logic reuses shared helper(s) and no duplicate agent-list mutation path remains in `discordChannel.ts`. Add or update a focused unit test around the helper behavior if needed, run targeted unit tests, implement, and rerun until green. Commit with a message like `Milestone 2: consolidate discord local config list mutations`.

Milestone 3 (`bd-151`) is complete when full validation passes and documentation is aligned if needed. Run `npm run typecheck`, `npm run test`, and grep checks proving removed runtime references. Commit with a message like `Milestone 3: finalize local config mutation consolidation`.

## Idempotence and Recovery

This refactor is code-only and safe to repeat. If a step fails mid-way, restore the working tree with normal git workflows and re-run the same milestone. Because behavior is preserved, rollback is straightforward by reverting the milestone commit. Avoid destructive filesystem operations; do not remove directories.

## Artifacts and Notes

Capture these artifacts in commit/PR notes during implementation:

    rg -n "updateClawdbotConfig|renameAgentEntry|removeAgentEntry|resolveDefaultAgent" src
    # expected: no runtime matches for removed APIs

    npm run test -- tests/unit/clawdbotConfig.test.ts tests/unit/messageHelpers.test.ts
    # expected: passing tests with updated contracts

    npm run typecheck && npm run test
    # expected: full suite passes

## Interfaces and Dependencies

After Milestone 1, `src/lib/clawdbot/config.ts` should expose only helpers that remain part of the intended local-config boundary (for example: loading/saving config and list normalization helpers used by Discord and tests). Removed exports should not be replaced by new generic mutation wrappers.

`src/lib/discord/discordChannel.ts` should depend on `src/lib/clawdbot/config.ts` for shared agent-list read/write semantics rather than mutating `agents.list` shape ad hoc. Keep function behavior and error messages stable unless a test explicitly updates expected output.

No new external dependencies are required.

Plan update note (2026-02-04): Created this plan after deep repository analysis and selected one high-payoff, low-blast consolidation refactor: remove stale local mutation surfaces and isolate remaining local config writes to explicit Discord-only flow.
Plan update note (2026-02-04): Marked all milestones complete after implementing consolidation changes, running full validation, and confirming architecture docs already reflected the post-refactor boundaries.
