# Support OpenClaw naming compatibility in the agent UI

This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision Log, and Outcomes & Retrospective must be kept up to date as work proceeds.

The repository provides planning rules in `.agent/PLANS.md`. This document must be maintained in accordance with that file.

## Purpose / Big Picture

Users will be able to run the UI against an OpenClaw install that has migrated state/config to `~/.openclaw` while still supporting existing `~/.clawdbot` and `~/.moltbot` layouts. The UI should resolve the same config file the OpenClaw CLI and doctor use, and should not break when the doctor migrates paths. This change is compatibility-only: no new features or behavior outside naming/path resolution and updated docs/messaging. Success is visible when the UI loads gateway config from the correct path across all three directory names, and unit tests cover the path resolution rules.

## Progress

- [x] (2026-01-30 19:10Z) Reviewed the OpenClaw changelog and path resolution logic in `/Users/georgepickett/clawdbot` for rename and migration details.
- [x] (2026-01-30 19:10Z) Audited current UI path/config resolution and docs references to `.clawdbot` and `.moltbot`.
- [x] (2026-01-30 19:22Z) Updated path/config resolution and tests to include `.openclaw` plus OpenClaw env overrides, with legacy fallback preserved.
- [x] (2026-01-30 19:24Z) Updated user-facing strings, client identifiers, docs, and `.env.example` to reflect OpenClaw naming while preserving legacy compatibility.
- [x] (2026-01-30 19:24Z) Verified tests: `npm run test -- tests/unit/projectFs.test.ts`, `npm run test -- tests/unit/clawdbotConfig.test.ts`, and `npm run test`.

## Surprises & Discoveries

OpenClaw 2026.1.29 release notes explicitly call out the rebrand to `openclaw` and automatic legacy state/config migrations, and the codebase now resolves state/config by preferring `~/.openclaw` while falling back to legacy names. Evidence: `/Users/georgepickett/clawdbot/CHANGELOG.md` and `/Users/georgepickett/clawdbot/src/config/paths.ts` plus doctor migration behavior in `/Users/georgepickett/clawdbot/src/commands/doctor-config-flow.ts`.
No additional surprises surfaced while implementing the UI changes.

## Decision Log

- Decision: Mirror OpenClaw’s state/config resolution order and legacy filename list in the UI’s path helpers so the UI and CLI always select the same config file.
  Rationale: The CLI’s doctor migrates legacy paths and the UI must follow that behavior to stay compatible after upgrades.
  Date/Author: 2026-01-30 (assistant).
- Decision: Keep the `src/lib/clawdbot` module name for now but update its behavior and messages to OpenClaw naming; avoid broad renames until a dedicated refactor is requested.
  Rationale: Minimizes churn while achieving compatibility and reducing risk.
  Date/Author: 2026-01-30 (assistant).
- Decision: Include `.moldbot` and legacy config filenames as fallbacks to mirror OpenClaw’s compatibility list even if they are uncommon in the UI install base.
  Rationale: Aligns the UI with OpenClaw’s official legacy migration coverage and avoids edge-case breakage for older installs.
  Date/Author: 2026-01-30 (assistant).

## Outcomes & Retrospective

The UI now prefers `~/.openclaw` and `openclaw.json` while honoring legacy `.moltbot`/`.clawdbot` paths and env overrides. User-facing messages and docs reflect OpenClaw naming, and the gateway client ID matches `openclaw-control-ui`. All unit tests pass after the updates. No functional behavior beyond naming and resolution order changed.

## Context and Orientation

This UI resolves the gateway config and state directory through `src/lib/clawdbot/paths.ts` and `src/lib/clawdbot/config.ts`, then uses those values throughout API routes and server helpers. The agent canvas store lives under the resolved state directory in `agent-canvas/`, and Discord provisioning reads `.env` from the resolved state directory. User-facing documentation in `README.md`, `CONTRIBUTING.md`, and `ARCHITECTURE.md` still refers to Moltbot and the legacy directories.

OpenClaw’s current behavior (from the local OpenClaw repo) is to prefer `~/.openclaw` and `openclaw.json`, but to fall back to legacy directories (`~/.clawdbot`, `~/.moltbot`) and legacy filenames (`clawdbot.json`, `moltbot.json`) if the new path does not exist. The `openclaw doctor` command auto-migrates legacy state/config into `~/.openclaw` if the new paths are missing. The UI must adopt equivalent path resolution so the same config is read before and after a doctor migration.

Definitions used in this plan:
A “state directory” is the root folder that holds the gateway’s mutable files, including config, sessions, and the UI’s `agent-canvas` store. A “config file” is the JSON config file in that state directory used to resolve the gateway URL and settings.

## Plan of Work

Milestone 1 will align path resolution and config selection with OpenClaw’s naming conventions, covering `.openclaw`, `.moltbot`, and `.clawdbot` plus the correct environment variables. This includes updating `src/lib/clawdbot/paths.ts` and `src/lib/clawdbot/config.ts`, and updating unit tests in `tests/unit/projectFs.test.ts` and `tests/unit/clawdbotConfig.test.ts` to assert the new precedence and fallback rules. The milestone is complete when the tests validate that `OPENCLAW_STATE_DIR` and `OPENCLAW_CONFIG_PATH` override defaults, and when `.openclaw` is preferred when present.

Milestone 2 will update user-facing strings and identifiers to match OpenClaw naming, then update documentation to reflect the new compatibility story. This includes updating `src/lib/discord/discordChannel.ts` error text to refer to the active config path instead of legacy filenames, updating the Gateway client ID in `src/lib/gateway/GatewayClient.ts` to the OpenClaw control UI identifier, and revising `README.md`, `CONTRIBUTING.md`, and `ARCHITECTURE.md` to describe `.openclaw` as the default with legacy fallback. The milestone is complete when the docs match the behavior and tests still pass.

## Concrete Steps

Work from the repo root `/Users/georgepickett/clawdbot-agent-ui`.

Run targeted tests while iterating:
  npm run test -- tests/unit/projectFs.test.ts
  npm run test -- tests/unit/clawdbotConfig.test.ts

After updates, run the full unit suite:
  npm run test

Expected output for targeted tests is the normal Vitest summary with all tests passing, for example:
  ✓ tests/unit/projectFs.test.ts (…)
  ✓ tests/unit/clawdbotConfig.test.ts (…)

## Validation and Acceptance

After Milestone 1, the UI must resolve config and state paths the same way as OpenClaw. This is validated by tests that fail before the change and pass after.

Milestone 1 verification workflow:
1. Tests to write: In `tests/unit/projectFs.test.ts`, add assertions that `resolveStateDir` prefers `~/.openclaw` when it exists, and that it uses `OPENCLAW_STATE_DIR` when set. In `tests/unit/clawdbotConfig.test.ts`, add a case that uses `OPENCLAW_CONFIG_PATH` to load a config file. These tests should fail before the implementation because the path helpers ignore OpenClaw env vars and the `.openclaw` directory.
2. Implementation: Update `src/lib/clawdbot/paths.ts` to add `OPENCLAW_STATE_DIR` and `OPENCLAW_CONFIG_PATH` support, include `.openclaw` and `openclaw.json` as the default new names, and keep legacy fallbacks for `.clawdbot` and `.moltbot` with their legacy filenames. Update `src/lib/clawdbot/config.ts` to use the new canonical filename when building fallback paths, and to report errors without hard-coding legacy names.
3. Verification: Run `npm run test -- tests/unit/projectFs.test.ts` and `npm run test -- tests/unit/clawdbotConfig.test.ts` and confirm all tests pass.
4. Commit: Commit with a message like “Milestone 1: Align OpenClaw path resolution”.

After Milestone 2, user-facing strings and docs must reflect OpenClaw naming and compatibility, without changing runtime behavior beyond identifier updates.

Milestone 2 verification workflow:
1. Tests to write: Update any tests that assert legacy-only error messages (for example, the warning string in `tests/unit/clawdbotConfig.test.ts`) to assert the new wording that no longer hard-codes `clawdbot.json` or `~/.clawdbot`.
2. Implementation: Update `src/lib/discord/discordChannel.ts` error strings to refer to the resolved config path and `.env` path instead of legacy names. Update the gateway client ID in `src/lib/gateway/GatewayClient.ts` to `openclaw-control-ui`. Update `README.md`, `CONTRIBUTING.md`, and `ARCHITECTURE.md` to describe OpenClaw as the current name and to state that `~/.openclaw` / `openclaw.json` are defaults with legacy fallback to `.moltbot` and `.clawdbot`.
3. Verification: Run `npm run test` and confirm all tests pass.
4. Commit: Commit with a message like “Milestone 2: Update OpenClaw naming and docs”.

Acceptance criteria:
The UI resolves `~/.openclaw/openclaw.json` when present, still works with legacy `~/.moltbot/moltbot.json` or `~/.clawdbot/clawdbot.json`, honors `OPENCLAW_STATE_DIR` and `OPENCLAW_CONFIG_PATH`, and the docs state these defaults clearly. All existing unit tests pass after updates.

## Idempotence and Recovery

These changes are safe to re-run. Path resolution updates only affect lookup order and environment variable handling. Tests create temporary directories and must continue cleaning them in `afterEach` to avoid residue. If a change breaks tests, revert the last edit and re-run the targeted tests before proceeding.

## Artifacts and Notes

Reference defaults for compatibility:
  Default state dir: ~/.openclaw
  Legacy state dirs: ~/.moltbot, ~/.clawdbot
  Default config: ~/.openclaw/openclaw.json
  Legacy configs: ~/.moltbot/moltbot.json, ~/.clawdbot/clawdbot.json

## Interfaces and Dependencies

The following functions must retain their signatures but change their internal resolution rules:
- `resolveStateDir(env?: NodeJS.ProcessEnv, homedir?: () => string): string` in `src/lib/clawdbot/paths.ts`, now honoring `OPENCLAW_STATE_DIR` and preferring `.openclaw` when it exists.
- `resolveConfigPathCandidates(env?: NodeJS.ProcessEnv, homedir?: () => string): string[]` in `src/lib/clawdbot/paths.ts`, now returning candidates in an order that includes `OPENCLAW_CONFIG_PATH`, `openclaw.json`, and legacy filenames.
- `loadClawdbotConfig(): { config: Record<string, unknown>; configPath: string }` in `src/lib/clawdbot/config.ts`, now using the updated candidates and canonical filename without hard-coded Moltbot naming.

External dependency expectations:
The OpenClaw gateway identifies the control UI client as `openclaw-control-ui`. The UI must send this identifier during the connect handshake to remain consistent with the gateway’s known client IDs.

Plan updated on 2026-01-30 to record completed milestones, decisions, and test verification after implementation.
