# Harden Guided Agent Creation and Approval Reliability Before Merge

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This repository does not include a root `PLANS.md`, so this plan follows `/Users/georgepickett/.codex/worktrees/3ffe/openclaw-studio/.agent/PLANS.md` and must be maintained in accordance with that file.

## Purpose / Big Picture

After this change, guided agent creation will be safe to ship because it will no longer accidentally remove core tools, it will recover cleanly from setup failures without encouraging duplicate agent creation, and approval prompts will self-clean when they expire. A user should be able to create a conservative guided agent, run a task, approve or deny actions in chat, and trust that stale prompts and stale “Needs approval” badges disappear automatically.

This plan focuses on hardening and merge-risk reduction for the already-implemented guided-create and in-chat approvals feature. The result is robust behavior under failure and reconnect paths, not just happy-path behavior.

## Progress

- [x] (2026-02-12 11:15Z) Captured hardening scope from review findings and product constraints.
- [ ] Milestone 1: Convert guided tool policy output from restrictive allowlist behavior to additive behavior and validate gateway config writes.
- [ ] Milestone 2: Add deterministic expiry pruning for pending exec approvals so stale approval cards cannot persist.
- [ ] Milestone 3: Add durable pending guided-setup recovery (including reload/timeout) and prevent duplicate-agent retries after partial failures.
- [ ] Milestone 4: Run full validation, update docs, and create a final pre-merge risk summary.

## Surprises & Discoveries

- Observation: In OpenClaw, a non-empty `tools.allow` is restrictive, not additive.
  Evidence: `/Users/georgepickett/openclaw/src/agents/pi-tools.policy.ts` allows everything only when allowlist is empty; otherwise entries must match.

- Observation: Approval timeout does not emit `exec.approval.resolved` automatically.
  Evidence: `/Users/georgepickett/openclaw/src/gateway/exec-approval-manager.ts` resolves timeout internally (`resolve(null)`), while `/Users/georgepickett/openclaw/src/gateway/server-methods/exec-approval.ts` only broadcasts `exec.approval.resolved` on explicit operator resolve.

- Observation: Current Studio approval state is event-only and has no expiry pruning logic.
  Evidence: `/Users/georgepickett/.codex/worktrees/3ffe/openclaw-studio/src/app/page.tsx` removes approvals only on explicit resolved events.

## Decision Log

- Decision: Guided creation will treat “additional tool allow entries” as additive (`tools.alsoAllow`) and will not emit `tools.allow` by default.
  Rationale: This preserves expected base profile tools and removes the highest-risk behavior regression from guided create.
  Date/Author: 2026-02-12 / Codex

- Decision: Pending guided setups will be persisted in `sessionStorage` (tab-scoped, reload-safe) with explicit retry/discard actions.
  Rationale: This is robust enough for timeout/reload recovery without introducing cross-device or long-lived persistence risk.
  Date/Author: 2026-02-12 / Codex

- Decision: Local “agent created, setup failed” will be treated as partial success, not full failure.
  Rationale: Prevents a misleading error path that encourages duplicate-agent creation on retry.
  Date/Author: 2026-02-12 / Codex

- Decision: Approval cards will be pruned by expiration time with a small grace window and will update `awaitingUserInput` immediately.
  Rationale: Removes stale prompts and stale fleet badges even when no resolved event arrives.
  Date/Author: 2026-02-12 / Codex

## Outcomes & Retrospective

Pending implementation.

## Context and Orientation

The current guided flow is orchestrated in `/Users/georgepickett/.codex/worktrees/3ffe/openclaw-studio/src/app/page.tsx`. Creation starts in `handleCreateAgentSubmit`, compiles guided draft data with `compileGuidedAgentCreation` in `/Users/georgepickett/.codex/worktrees/3ffe/openclaw-studio/src/features/agents/creation/compiler.ts`, creates an agent, and then applies setup via `applyGuidedAgentSetup` in `/Users/georgepickett/.codex/worktrees/3ffe/openclaw-studio/src/features/agents/operations/createAgentOperation.ts`.

Per-agent config overrides are written by `updateGatewayAgentOverrides` in `/Users/georgepickett/.codex/worktrees/3ffe/openclaw-studio/src/lib/gateway/agentConfig.ts`. Agent files are written through `/Users/georgepickett/.codex/worktrees/3ffe/openclaw-studio/src/lib/gateway/agentFiles.ts`. Per-agent exec approvals policy is written through `/Users/georgepickett/.codex/worktrees/3ffe/openclaw-studio/src/lib/gateway/execApprovals.ts`.

Approval cards are rendered in `/Users/georgepickett/.codex/worktrees/3ffe/openclaw-studio/src/features/agents/components/AgentChatPanel.tsx`, while approval events are parsed by `/Users/georgepickett/.codex/worktrees/3ffe/openclaw-studio/src/features/agents/approvals/execApprovalEvents.ts` and stored in page-level state.

The key risk points are:

1. Guided compiler currently emits `tools.allow`, which can unintentionally remove core tools.
2. Approval records are not pruned by expiry, so timeout-only approvals can linger forever.
3. Guided setup failures after agent creation are surfaced as full create failures, which can lead to duplicate creation retries.
4. Remote timeout/reload can lose in-memory pending setup data.

## Plan of Work

Milestone 1 will fix tool policy semantics at the source of guided output. The compiler will emit additive tool entries and explicit deny entries only when needed. The gateway config writer will support `alsoAllow` and fail fast when both `allow` and `alsoAllow` are passed in the same scope.

Milestone 2 will isolate approval queue behavior into testable helper logic and add expiry-driven pruning. This will ensure stale approvals and stale fleet badges cannot persist after timeout.

Milestone 3 will add a durable pending-setup store and recovery UI. Guided setup payloads for newly created agents will be persisted in session storage, retried automatically after reconnect when possible, and always recoverable manually with clear retry/discard controls. Local partial failures will become explicit “created with pending setup” states.

Milestone 4 will run targeted and broader validation and update docs to document the new reliability semantics before merge.

## Concrete Steps

Working directory for all commands in this plan:

    /Users/georgepickett/.codex/worktrees/3ffe/openclaw-studio

Milestone 1 commands:

    npx vitest run tests/unit/agentCreationCompiler.test.ts tests/unit/createAgentOperation.test.ts

    (Add/extend tests for `alsoAllow` behavior, then re-run)

    npx vitest run tests/unit/agentCreationCompiler.test.ts tests/unit/createAgentOperation.test.ts tests/unit/gatewayAgentOverrides.test.ts

Milestone 2 commands:

    npx vitest run tests/unit/execApprovalEvents.test.ts tests/unit/agentChatPanel-approvals.test.ts

    (Add/extend tests for expiry pruning and badge clearing, then re-run)

    npx vitest run tests/unit/execApprovalEvents.test.ts tests/unit/agentChatPanel-approvals.test.ts tests/unit/pendingExecApprovalsStore.test.ts

Milestone 3 commands:

    npx vitest run tests/unit/createAgentOperation.test.ts tests/unit/agentCreateModal.test.ts

    (Add/extend tests for partial-failure recovery + sessionStorage persistence, then re-run)

    npx vitest run tests/unit/createAgentOperation.test.ts tests/unit/agentCreateModal.test.ts tests/unit/pendingGuidedSetupStore.test.ts tests/unit/guidedSetupRecovery.test.tsx

Milestone 4 commands:

    npm run typecheck

    npx vitest run tests/unit/agentCreationCompiler.test.ts tests/unit/createAgentOperation.test.ts tests/unit/execApprovalEvents.test.ts tests/unit/agentChatPanel-approvals.test.ts tests/unit/gatewayExecApprovals.test.ts tests/unit/fleetSidebar-create.test.ts tests/unit/agentFilesBootstrap.test.ts

    npm run lint

Expected lint note (already known pre-existing baseline): CommonJS `require()` and legacy `any` issues in existing server/scripts/tests may fail independent of this feature; do not treat those baseline failures as regressions unless new violations are introduced in touched files.

## Validation and Acceptance

### Milestone 1: Guided tool-policy safety

1. Tests to write first:

Write or extend `/Users/georgepickett/.codex/worktrees/3ffe/openclaw-studio/tests/unit/agentCreationCompiler.test.ts` with assertions that guided compile output uses `agentOverrides.tools.alsoAllow` (not `allow`) for additive entries and that `group:runtime` handling does not narrow unrelated tools by default.

Write `/Users/georgepickett/.codex/worktrees/3ffe/openclaw-studio/tests/unit/gatewayAgentOverrides.test.ts` to assert `updateGatewayAgentOverrides` writes `alsoAllow` correctly and throws an actionable error when both `allow` and `alsoAllow` are passed.

2. Implementation:

Update `/Users/georgepickett/.codex/worktrees/3ffe/openclaw-studio/src/features/agents/creation/types.ts`, `/Users/georgepickett/.codex/worktrees/3ffe/openclaw-studio/src/features/agents/creation/compiler.ts`, and `/Users/georgepickett/.codex/worktrees/3ffe/openclaw-studio/src/lib/gateway/agentConfig.ts` to support additive tool policy safely.

3. Verification:

Run the Milestone 1 test commands and confirm all tests pass.

4. Commit:

Commit with message:

    Milestone 1: make guided tool policy additive and safe

### Milestone 2: Approval expiry reliability

1. Tests to write first:

Add `/Users/georgepickett/.codex/worktrees/3ffe/openclaw-studio/tests/unit/pendingExecApprovalsStore.test.ts` covering upsert, resolve-state mutation, expiry pruning, and idempotent removal.

Extend `/Users/georgepickett/.codex/worktrees/3ffe/openclaw-studio/tests/unit/agentChatPanel-approvals.test.ts` (or add a focused state test) to prove expired approvals are removed and `awaitingUserInput` drops to false.

2. Implementation:

Add a dedicated approval-state helper module (for example `/Users/georgepickett/.codex/worktrees/3ffe/openclaw-studio/src/features/agents/approvals/pendingStore.ts`) and wire it into `/Users/georgepickett/.codex/worktrees/3ffe/openclaw-studio/src/app/page.tsx` with expiry scheduling/pruning.

3. Verification:

Run Milestone 2 tests and confirm no stale pending approvals remain after expiry windows.

4. Commit:

Commit with message:

    Milestone 2: prune expired exec approvals and clear stale badges

### Milestone 3: Guided setup recovery and duplicate prevention

1. Tests to write first:

Add `/Users/georgepickett/.codex/worktrees/3ffe/openclaw-studio/tests/unit/pendingGuidedSetupStore.test.ts` for sessionStorage load/save/remove with malformed-data handling and TTL-safe parsing.

Add `/Users/georgepickett/.codex/worktrees/3ffe/openclaw-studio/tests/unit/guidedSetupRecovery.test.tsx` (or equivalent integration-style unit test) to verify:

- local create + setup failure becomes a recoverable pending setup state bound to the created agent;
- remote timeout/reload can recover pending setup from storage;
- retry applies setup to existing agent instead of creating a new one.

2. Implementation:

Create storage helper module (for example `/Users/georgepickett/.codex/worktrees/3ffe/openclaw-studio/src/features/agents/creation/pendingSetupStore.ts`) and integrate in `/Users/georgepickett/.codex/worktrees/3ffe/openclaw-studio/src/app/page.tsx`.

Add recoverable UI controls near the focused chat panel (or equivalent visible location) for `Retry setup` and `Discard pending setup` for the affected agent.

3. Verification:

Run Milestone 3 tests and manual smoke path:

- simulate setup failure after `agents.create`;
- confirm the agent exists and UI offers retry/discard;
- retry setup and confirm pending state clears without creating another agent.

4. Commit:

Commit with message:

    Milestone 3: add durable guided setup recovery and retry controls

### Milestone 4: Final validation and docs

1. Tests to write first:

No new tests required; this milestone validates integrated behavior and docs.

2. Implementation:

Update `/Users/georgepickett/.codex/worktrees/3ffe/openclaw-studio/README.md` and `/Users/georgepickett/.codex/worktrees/3ffe/openclaw-studio/ARCHITECTURE.md` with the new reliability semantics (additive tool policy, approval expiry pruning, and guided setup recovery).

3. Verification:

Run `npm run typecheck`, targeted `vitest` suite, and `npm run lint`; capture baseline-vs-new failures clearly.

4. Commit:

Commit with message:

    Milestone 4: validate and document guided-create hardening

Final acceptance criteria:

- Guided-created agents do not lose core profile tools due to unintended restrictive allowlists.
- Approval cards disappear when expired, and fleet “Needs approval” badges clear accordingly.
- Partial guided-setup failures after creation are recoverable without creating duplicate agents.
- Remote timeout/reload can resume pending setup from session-scoped persisted state.

## Idempotence and Recovery

All changes are additive and test-first. Re-running any milestone is safe because test files and helpers are deterministic. Session-storage-backed pending setup entries must include explicit versioning and strict parser guards so malformed old entries are ignored rather than crashing startup.

If a guided setup apply fails repeatedly, `Discard pending setup` must always return the app to a clean operational state without deleting the agent. Recovery actions operate on existing agent IDs only; they must never call `agents.create`.

## Artifacts and Notes

Use concise evidence snippets in PR notes while implementing:

    - Compiler output before/after for `agentOverrides.tools`
    - Approval expiry pruning test output
    - Recovery flow transcript showing one created agent ID reused during retry

Capture final command results in `Outcomes & Retrospective` once implementation is complete.

## Interfaces and Dependencies

Define or extend these interfaces by the end of implementation:

- In `/Users/georgepickett/.codex/worktrees/3ffe/openclaw-studio/src/lib/gateway/agentConfig.ts`:
  - `GatewayAgentToolsOverrides` includes optional `alsoAllow?: string[]`.
  - `updateGatewayAgentOverrides(...)` normalizes `alsoAllow` and throws when both `allow` and `alsoAllow` are present.

- In `/Users/georgepickett/.codex/worktrees/3ffe/openclaw-studio/src/features/agents/creation/types.ts` and `/Users/georgepickett/.codex/worktrees/3ffe/openclaw-studio/src/features/agents/creation/compiler.ts`:
  - guided compile result emits additive tool policy semantics aligned with OpenClaw tool filtering behavior.

- In `/Users/georgepickett/.codex/worktrees/3ffe/openclaw-studio/src/features/agents/approvals/`:
  - introduce a pure pending-approvals helper API for upsert/update/remove/prune operations.

- In `/Users/georgepickett/.codex/worktrees/3ffe/openclaw-studio/src/features/agents/creation/`:
  - introduce a versioned pending-setup storage helper with `load`, `save/upsert`, `remove`, and safe parse behavior.

Plan revision note: Initial hardening plan created on 2026-02-12 to address post-implementation reliability findings before merge.
