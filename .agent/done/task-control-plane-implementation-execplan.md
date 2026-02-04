# Implement Task Control Plane (Local-Only Beads)

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This plan follows `/.agent/PLANS.md` from the repository root and must be maintained in accordance with that file.

## Purpose / Big Picture

After this work, contributors and agents can run a deterministic Beads workflow across local sessions and hosts without accidentally committing Beads artifacts. The repository will expose a clear task control plane: scope model (`repo:*`, `ops:*`), claim/close semantics, import/flush lifecycle, and a concrete path toward a read-only control center view. Success is visible through updated documentation, validated command flows, and explicit policy checks that prevent `.beads/` from entering git history.

## Progress

- [x] (2026-02-04 00:00Z) Captured control-plane architecture in `.agent/done/task-control-plane-spec.md`.
- [ ] Align operator docs and agent policy docs to the local-only Beads model and atomic claim commands.
- [ ] Add a scriptable read-model prototype that aggregates `br --json` outputs for ready/claimed/blocked views.
- [ ] Validate end-to-end lifecycle in a dry-run session log and document acceptance evidence.

## Surprises & Discoveries

- Observation: Existing docs implied Beads artifacts could be committed, which conflicts with this repository policy.
  Evidence: Prior wording in `CONTRIBUTING.md` referenced a portable committed `.beads/issues.jsonl` artifact.

## Decision Log

- Decision: Treat `.beads/` as local-only operational state for this repository.
  Rationale: Keeps open-source history clean, avoids leaking local operational metadata, and matches existing `.gitignore` policy.
  Date/Author: 2026-02-04 / Codex

- Decision: Standardize claim flow on `br update <id> --claim --json`.
  Rationale: Atomic claim semantics reduce race conditions across concurrent agent sessions.
  Date/Author: 2026-02-04 / Codex

## Outcomes & Retrospective

This plan establishes a practical sequence for moving from policy-only docs to a usable control-plane prototype. The largest risk is divergence between documented lifecycle and real command behavior on different hosts; the validation milestone explicitly mitigates this by exercising import, claim, close, and flush behavior with observed output.

## Context and Orientation

This repository already contains policy and planning docs under `.agent/` and contributor guidance in `CONTRIBUTING.md`. Beads is the local issue tracker CLI (`br`) used by agents to select, claim, and close tasks. A control plane here means a consistent set of rules and read models that make the task lifecycle observable and predictable.

Relevant files:
- `.agent/PLANS.md`: authoritative requirements for ExecPlans.
- `.agent/done/task-control-plane-spec.md`: architecture-level design and phased rollout.
- `CONTRIBUTING.md`: operator-facing workflow and PR expectations.
- `.gitignore`: enforces ignored `.beads/` behavior.

## Plan of Work

Milestone 1 updates policy-facing docs so all agent and contributor entry points consistently describe local-only Beads state, required JSON command usage, and claim/close semantics. Milestone 2 adds a small control-center read-model prototype script that consumes `br --json` outputs and produces a normalized summary (`ready`, `claimed`, `blocked`, `coverage`). Milestone 3 validates the lifecycle by running a reproducible session transcript across one scope and confirming that no `.beads/` files are staged.

Implementation detail for the read model: add a script under `scripts/` that shells out to `br ready --json`, `br list --json`, and `br blocked --json` (or equivalent), then merges output into a single JSON report for future UI ingestion.

## Concrete Steps

Run from repository root `/Users/georgepickett/openclaw-studio`.

1. Policy alignment
   - Edit docs to ensure local-only wording and claim semantics are consistent.
   - Confirm no text suggests committing `.beads/` artifacts.

2. Read-model prototype
   - Create `scripts/task-control-plane-read-model.ts` (or `.js` if repo tooling prefers plain Node).
   - Implement command runner + JSON parse + deterministic merge logic.
   - Write `scripts/task-control-plane-read-model.test.ts` with fixtures covering empty, mixed, and blocked states.

3. Lifecycle validation
   - Run:
       br where --json
       br sync --import-only
       br ready --json
       br update <id> --claim --json
       br close <id> --reason "Tests pass, committed" --json
       br sync --flush-only
   - Capture outputs in this ExecPlan `Artifacts and Notes` section.

4. Policy safety check
   - Run `git status --short` and confirm `.beads/` is not staged.

## Validation and Acceptance

Acceptance requires all of the following:

1. Documentation acceptance
   - `rg -n "local-only|--claim --json|Never stage or commit \.beads" .agent/PLANS.md CONTRIBUTING.md`
   - Expected: all policy phrases are present and no contradictory phrasing remains.

2. Test-first read-model acceptance
   - Write failing tests in `scripts/task-control-plane-read-model.test.ts` for:
     - `buildReadModel_returnsEmptyBucketsWhenNoIssues`
     - `buildReadModel_partitionsReadyClaimedBlocked`
     - `buildReadModel_flagsMissingExecPlanLinks`
   - Run targeted test command and confirm failure before implementation.
   - Implement read-model script and rerun tests until all pass.

3. Session lifecycle acceptance
   - Run control-plane command sequence and confirm successful JSON responses for ready/claim/close/flush.
   - Confirm `git status --short` contains no `.beads/` paths.

## Idempotence and Recovery

Doc edits are idempotent: rerunning replacements should preserve final wording. Read-model generation is safe to rerun because it reads Beads state and emits derived output only. If command parsing fails due to malformed local Beads data, recover by running `br sync --import-only` and `br sync --status --json`, then retry. If a task is claimed accidentally, return it to open state before ending the session.

## Artifacts and Notes

Expected evidence snippets to retain during implementation:

- Policy check output:
    rg -n "local-only|Never stage or commit \.beads" .agent/PLANS.md CONTRIBUTING.md

- Read-model test run:
    npm test -- scripts/task-control-plane-read-model.test.ts

- Lifecycle transcript:
    br ready --json
    br update <id> --claim --json
    br close <id> --reason "Tests pass, committed" --json
    br sync --flush-only

## Interfaces and Dependencies

The read-model script should expose:

- `type ControlPlaneReadModel = { ready: Issue[]; claimed: Issue[]; blocked: Issue[]; coverage: ExecPlanCoverage[] }`
- `async function loadControlPlaneReadModel(scope: string): Promise<ControlPlaneReadModel>`
- `function mapExecPlanCoverage(issues: Issue[]): ExecPlanCoverage[]`

Dependencies:
- Beads CLI (`br`) installed and available in PATH.
- Existing Node/TypeScript test runner used by the repository.
- JSON parser only; no direct SQLite driver dependency.

Revision Note (2026-02-04): Created initial implementation ExecPlan to operationalize the task control plane spec with explicit milestones, validation, and local-only Beads safety constraints.
