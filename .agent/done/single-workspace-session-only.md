# Simplify Studio to a Single Workspace + Session-Only Agents

This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision Log, and Outcomes & Retrospective must be kept up to date as work proceeds.

This plan follows /Users/georgepickett/openclaw-studio/.agent/PLANS.md and must be maintained in accordance with it.

## Purpose / Big Picture

After this change, OpenClaw Studio always operates inside one workspace path instead of creating or switching workspaces. Creating a new “agent” in the UI becomes creating a new session under a single default backend agent, so newcomers no longer have to reason about worktrees or multiple workspace folders. The visible proof is that the header no longer shows workspace selectors or “create/open workspace” flows, and new tiles still open independent sessions while all tiles point at the same configured workspace path.

## Progress

- [x] (2026-01-31 02:50Z) Design the single-workspace configuration flow, store migration, and UI changes that remove workspace creation/selection.
- [x] Implement session-only tiles (single backend agent id, unique session keys), remove worktree provisioning/cleanup, and update workspace-file routes to use the shared workspace path.
- [x] Update tests, docs, and migration notes; verify behavior with Playwright and manual sanity checks.

## Surprises & Discoveries

- Observation: None during implementation.
  Evidence: N/A

## Decision Log

- Decision: Use a single backend agent id (the default agent from openclaw.json) for all Studio tiles, and generate unique session keys per tile using the “agent:<defaultId>:studio:<sessionId>” format.
  Rationale: This matches the stated goal of “new agent = new session under the one main agent” while keeping session separation in the gateway.
  Date/Author: 2026-01-31 / Codex

- Decision: Introduce an explicit Studio workspace setting (stored under the OpenClaw Studio state dir) and remove “create/open workspace” UI flows.
  Rationale: Keeps the UI simple while still allowing advanced users to point Studio at a specific path.
  Date/Author: 2026-01-31 / Codex

## Outcomes & Retrospective

- Studio now uses a single workspace path configured via Workspace Settings; legacy projects are preserved in a separate file.
- Tile creation uses a single default agent id with unique session keys; no worktrees are created or deleted.
- UI and docs updated; tests added/updated and verified (`npm run test -- sessionKey`, `npm run e2e -- tests/e2e/workspace-settings.spec.ts`).

## Context and Orientation

OpenClaw Studio currently treats “workspaces” as projects and stores them in a local JSON file at the Studio state dir (see /Users/georgepickett/openclaw-studio/src/app/api/projects/store.ts). Each tile has its own git worktree under the state dir, and the UI can create/open multiple workspaces (see /Users/georgepickett/openclaw-studio/src/app/page.tsx and /Users/georgepickett/openclaw-studio/src/features/canvas/components/HeaderBar.tsx). Worktrees are provisioned in /Users/georgepickett/openclaw-studio/src/lib/projects/worktrees.server.ts and removed in /Users/georgepickett/openclaw-studio/src/app/api/projects/cleanup/route.ts.

A “workspace” in this plan means the single directory that Studio points agents at (a repo or a plain folder). A “worktree” is a git feature that creates a separate checkout for each agent; we are removing this entirely. A “session” is a gateway conversation key; in OpenClaw it is encoded in a sessionKey like agent:<agentId>:<rest>. By using a single agentId and unique sessionKey per tile, we get multiple sessions with one agent configuration and one workspace directory.

The OpenClaw backend resolves agent workspaces from openclaw.json (see /Users/georgepickett/clawdbot/src/agents/agent-scope.ts). The default workspace lives in agents.defaults.workspace, and a default agent id is chosen from agents.list (default=true or first entry). This plan uses those same rules in Studio.

## Plan of Work

First, introduce a Studio workspace setting that is stored under the OpenClaw Studio state directory (the same place as projects.json today). Add a small server-side helper to load/save this setting and to resolve the default agent id + workspace path from openclaw.json. Then update the UI so it shows a single workspace label and an “Advanced” settings modal to set the workspace path. Remove the workspace dropdown and the create/open workspace forms. Update the empty-state text so it instructs users to set a workspace path instead of creating one.

Second, remove worktree provisioning and cleanup. When a tile is created, it should no longer create a git worktree. Instead, it should generate a unique session key and store the shared workspace path on the tile. Update buildAgentInstruction to describe the workspace path without mentioning worktrees. Update workspace files routes and Discord provisioning to point at the shared workspace path. Remove cleanup code that deletes worktrees and adjust archived cleanup to only remove agent state if it is safe.

Third, migrate existing stored data to the new model. When loading the store, select a single workspace (prefer an explicit Studio setting; otherwise use the active project’s repoPath). Map existing tiles to the new sessionKey format and to the shared workspace path. Preserve legacy worktree directories but do not delete them automatically; document a safe manual cleanup path. Update README.md and ARCHITECTURE.md to reflect the new mental model, and adjust Playwright tests to the new UI and session behavior.

## Concrete Steps

1) Add Studio workspace settings storage and resolution.
   - Create a server-side helper in /Users/georgepickett/openclaw-studio/src/lib/studio/workspaceSettings.server.ts that reads/writes a JSON file under the Studio state dir (for example <stateDir>/openclaw-studio/settings.json). Include fields: workspacePath (string), workspaceName (string, optional), and updatedAt.
   - Add a helper in /Users/georgepickett/openclaw-studio/src/lib/clawdbot/resolveDefaultAgent.ts that reads openclaw.json and resolves the default agent id and its configured workspace path using the same rule as OpenClaw (default=true, else first entry, else “main”).
   - Implement a new API route /Users/georgepickett/openclaw-studio/src/app/api/workspace/route.ts:
     - GET returns the resolved workspacePath, workspaceName, defaultAgentId, and warnings.
     - PUT accepts { workspacePath, workspaceName? } and validates path exists and is a directory; warn (do not error) if the path lacks a .git folder.

2) Update the store loader to enforce a single workspace.
   - In /Users/georgepickett/openclaw-studio/src/app/api/projects/store.ts, add a migration that selects a single “active” project based on the Studio workspace setting or the previous activeProjectId.
   - Normalize the store so only one project is active and exposed to the UI. Preserve other projects in a “legacyProjects” field saved to a separate legacy JSON file (for example <stateDir>/openclaw-studio/legacy-projects.json) instead of deleting them.
   - Set each tile’s workspacePath to the resolved workspacePath. If the resolved workspacePath is empty, keep tiles but mark the store as “needs workspace” so the UI can show a blocking banner.

3) Switch tiles to session-only behavior and remove worktrees.
   - Remove or retire /Users/georgepickett/openclaw-studio/src/lib/projects/worktrees.server.ts and any calls to ensureAgentWorktree, ensureWorktreeIgnores, resolveAgentWorktreeDir, and isWorktreeDirty.
   - In /Users/georgepickett/openclaw-studio/src/app/api/projects/[projectId]/tiles/route.ts, stop creating worktrees. Instead:
     - Resolve the shared workspacePath from the new workspace settings helper.
     - Use the default agent id (from config helper) for the tile’s agentId.
     - Generate a unique sessionKey per tile with the format agent:<defaultAgentId>:studio:<tileId> (or a separate sessionId field stored on the tile).
   - In /Users/georgepickett/openclaw-studio/src/lib/projects/message.ts, remove the “git worktree” wording and only mention the workspace path.
   - Update /Users/georgepickett/openclaw-studio/src/app/api/projects/[projectId]/tiles/[tileId]/workspace-files/route.ts and /Users/georgepickett/openclaw-studio/src/app/api/projects/[projectId]/discord/route.ts to use the shared workspacePath rather than a worktree path.
   - Update /Users/georgepickett/openclaw-studio/src/app/api/projects/cleanup/route.ts to remove git worktree removal. It should only remove agent state directories for archived tiles when the agentId is not the default agent id (never delete the default agent’s state directory).

4) Simplify UI to single workspace.
   - In /Users/georgepickett/openclaw-studio/src/features/canvas/components/HeaderBar.tsx, replace the workspace dropdown and Workspaces menu with a read-only workspace label and a “Workspace Settings” button.
   - In /Users/georgepickett/openclaw-studio/src/app/page.tsx, remove the Create/Open workspace forms and the “Create a workspace” empty state. Replace them with a single call to action that opens the workspace settings modal when no workspacePath is configured.
   - Add a small modal/panel component (for example /Users/georgepickett/openclaw-studio/src/features/canvas/components/WorkspaceSettingsPanel.tsx) that loads GET /api/workspace and submits PUT /api/workspace, then refreshes the projects store on success.

5) Update tests and documentation.
   - Update Playwright tests in /Users/georgepickett/openclaw-studio/tests/e2e to expect the new empty state and header (no “Create workspace” or workspace dropdown).
   - Add a new Playwright test that opens the workspace settings panel, submits a workspace path, and verifies tiles render afterward.
   - Update /Users/georgepickett/openclaw-studio/README.md and /Users/georgepickett/openclaw-studio/ARCHITECTURE.md to describe the single workspace model, session-only tiles, and the new settings flow.

## Validation and Acceptance

Acceptance criteria are behavioral and visible:

- The header no longer shows a workspace selector or “Workspaces” menu; it shows a single workspace label and a settings button.
- The empty state asks the user to set a workspace path, not to create or open a workspace.
- Creating a new tile creates a unique session (distinct sessionKey) but does not create a git worktree directory.
- All tiles use the same workspace path in agent instructions and workspace file editing.
- Archived cleanup no longer runs git worktree commands and does not delete the default agent’s workspace or state.

Milestone verification workflow:

Milestone 1: Single workspace settings + UI
1. Tests to write: Add a Playwright test (for example tests/e2e/workspace-settings.spec.ts) that stubs GET /api/workspace with no path and verifies the empty state CTA. Then stub PUT /api/workspace success and verify the UI reloads the store with a single workspace label in the header. Run the test and confirm it fails before the UI change.
2. Implementation: Add the workspace settings helper and API route, update HeaderBar and page.tsx to use it, and remove create/open workspace UI.
3. Verification: Run `npm run e2e -- tests/e2e/workspace-settings.spec.ts` in /Users/georgepickett/openclaw-studio and confirm it passes.
4. Commit: Commit with message “Milestone 1: Add single-workspace settings flow”.

Milestone 2: Session-only tiles and no worktrees
1. Tests to write: Add a Playwright test that creates a tile (mocking /api/projects and /api/projects/[project]/tiles) and asserts that the sessionKey uses the “agent:<default>:studio:” prefix and that no worktree-related warnings appear in responses. Confirm it fails before implementation.
2. Implementation: Remove worktree provisioning, update tile creation/session key logic, update workspace file routes and cleanup logic, and update buildAgentInstruction messaging.
3. Verification: Run `npm run e2e -- tests/e2e/session-tiles.spec.ts` and ensure it passes. Optionally run `npm run test` if a unit test was added for session key generation.
4. Commit: Commit with message “Milestone 2: Switch tiles to session-only workspace”.

Milestone 3: Docs + migration polish
1. Tests to write: Update tests/e2e/canvas-smoke.spec.ts to assert the new empty-state text and confirm it fails before doc/UI updates. If a store migration test is added in vitest, make it fail first with the old behavior.
2. Implementation: Update README.md and ARCHITECTURE.md, finalize store migration notes, and ensure UI text and tooltips mention “workspace” singular.
3. Verification: Run `npm run e2e -- tests/e2e/canvas-smoke.spec.ts` and confirm it passes.
4. Commit: Commit with message “Milestone 3: Update docs and migration text”.

## Idempotence and Recovery

The changes are safe to re-run because settings and store migrations are deterministic. The plan explicitly avoids deleting existing worktree directories; legacy worktrees are preserved. If the workspace path is invalid, the UI should surface a clear error and keep the previous valid setting. If a migration step fails, restore by deleting <stateDir>/openclaw-studio/settings.json and reloading; the store will re-derive from existing data.

## Artifacts and Notes

Expected GET /api/workspace response example (for local validation):

  {
    "workspacePath": "/Users/you/projects/openclaw-studio",
    "workspaceName": "openclaw-studio",
    "defaultAgentId": "main",
    "warnings": []
  }

Expected session key example for a tile id of "tile-123":

  agent:main:studio:tile-123

## Interfaces and Dependencies

- New server helper: src/lib/studio/workspaceSettings.server.ts
  - loadWorkspaceSettings(): { workspacePath?: string; workspaceName?: string; updatedAt?: number }
  - saveWorkspaceSettings(settings): void
  - resolveWorkspaceSelection(): { workspacePath: string | null; workspaceName: string | null; warnings: string[] }

- New config helper: src/lib/clawdbot/resolveDefaultAgent.ts
  - resolveDefaultAgentId(config): string
  - resolveDefaultWorkspacePath(config, defaultAgentId): string | null

- New API route: src/app/api/workspace/route.ts
  - GET returns { workspacePath, workspaceName, defaultAgentId, warnings }
  - PUT accepts { workspacePath, workspaceName? } and returns the same shape

- Session key builder: src/lib/projects/sessionKey.ts
  - buildSessionKey(agentId: string, sessionId: string): string
  - parseAgentIdFromSessionKey remains valid but should not be used to imply uniqueness

When the plan is revised, add a brief note at the end of this file explaining what changed and why.
