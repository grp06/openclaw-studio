# Task Control Plane Spec

## Purpose
Define a practical, local-first control plane for agent task tracking with Beads so multiple sessions and hosts can coordinate work without requiring a hosted service.

## Scope Model
Use explicit Beads scopes to prevent task mixing.

- `repo:<org>/<repo>`: implementation tasks tied to one repository and branch lifecycle.
- `ops:<name>`: operational tasks (machine setup, infra maintenance, personal runbooks) outside repo code changes.

Rules:
- Every task is created in exactly one scope.
- Cross-scope dependencies are allowed only as references in descriptions, not hard dependency edges.
- Session preflight must confirm current scope before claiming work.

## Storage and Replication Model
The system is local-first.

- Source of truth on each host: local Beads SQLite state.
- Replication artifact: JSONL sync payload (`br sync --flush-only` output/state).
- Import path: `br sync --import-only` at session start.
- Export path: `br sync --flush-only` at session end.

Policy:
- In `openclaw-studio`, `.beads/` is local-only and ignored by git.
- No manual edits to `issues.jsonl` except merge-conflict resolution workflows.

## Agent Lifecycle Semantics
Standard lifecycle:

1. Discover work with `br ready --json`.
2. Claim atomically with `br update <id> --claim --json`.
3. Implement and validate.
4. Create follow-up tasks when needed and link lineage.
5. Close with `br close <id> --reason "Tests pass, committed" --json`.
6. Persist local state with `br sync --flush-only`.

Claim/close semantics:
- A claimed task has one active owner at a time.
- Closing requires evidence in commit/test notes.
- If work is abandoned, unclaim or return to open state before session end.

## Control Center Read Model (Future UI)
The future UI should be read-only first, backed by Beads JSON output.

Required read slices:
- Ready queue: unblocked tasks sorted by priority and dependency readiness.
- Claimed-by-me: active tasks with age and last update time.
- Blocked graph: tasks blocked by unresolved dependencies.
- ExecPlan coverage: milestone tasks mapped to plan documents and progress entries.

Read model contract:
- Pull only from `br ... --json` commands.
- Avoid direct SQLite coupling in UI.
- Cache snapshots per refresh cycle; do not mutate task state from read views in phase 1.

## Phased Rollout
Phase 1: Policy + docs
- Enforce local-only `.beads/` guidance.
- Standardize command semantics (`--json`, `--claim`).

Phase 2: Seeding automation
- Generate milestone issues from ExecPlans.
- Validate dependency chains and missing IDs in plan progress sections.

Phase 3: Read-only control center
- Add UI/API aggregation for ready, claimed, blocked, and plan coverage views.

Phase 4: Guarded write actions
- Optional claim/close actions from control center with explicit confirmations.

## Non-Goals
- No hosted multi-tenant Beads backend in this plan.
- No real-time distributed locking across hosts.
- No automatic git staging/commit integration for `.beads/` artifacts.
