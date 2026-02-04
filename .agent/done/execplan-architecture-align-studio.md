# Align Studio Architecture with Gateway, Worktrees, and Event-Driven Status

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This plan is governed by `.agent/PLANS.md` in the repository root and must be maintained in accordance with that file.

## Purpose / Big Picture

After this change, OpenClaw Studio behaves like a control room rather than a chat wall. Agents run in isolated Git worktrees, the dashboard shows live status updates driven by gateway events plus summaries, and chat history is fetched only when you drill into a specific agent. Upgrades to the OpenClaw gateway protocol and client behaviors should be pulled in from the main `~/clawdbot` repo with minimal friction, so Studio does not drift as the core product evolves. You can see the result by creating a workspace, spawning two agents, observing live status updates without opening transcripts, and confirming that each agent operates in its own worktree while the UI only loads history on demand.

## Progress

- [x] (2026-01-30 20:00Z) Define and implement a shared gateway client layer that matches OpenClaw’s control UI behavior and protocol shapes.
- [x] (2026-01-30 21:00Z) Implement per-agent Git worktrees, align workspace paths, and update agent instructions accordingly.
- [x] (2026-01-30 22:00Z) Replace history polling with event-driven summaries plus on-demand history loading.
- [x] (2026-01-30 21:30Z) Replace destructive deletion with archive-first workflows for tiles and projects.

## Surprises & Discoveries

- Observation: The upstream gateway client depends on UI-side helpers (device identity/auth and UUID) plus @noble/ed25519.
  Evidence: The vendored client required adding local copies of `device-auth`, `device-identity`, `device-auth-payload`, and the `@noble/ed25519` dependency.

## Decision Log

- Decision: Reuse the OpenClaw control UI gateway client behavior rather than maintaining a separate WebSocket client in Studio.
  Rationale: The upstream client already handles reconnect and protocol details (connect challenge, state versions). Reusing it reduces drift and makes upgrades effectively free as long as the sync path is maintained.
  Date/Author: 2026-01-30 (assistant)

- Decision: Each agent runs in its own Git worktree created from the project repository, with its workspace directory set to that worktree path.
  Rationale: Worktrees isolate file edits and Git state per agent while still sharing a single repository, reducing conflicts and making “parallelism” safe and understandable.
  Date/Author: 2026-01-30 (assistant)

- Decision: The agent instruction message should name the worktree path as the primary workspace, and explicitly note that it is a worktree of the project repo.
  Rationale: The agent’s configured workspace path and the message instruction must agree to avoid “wrong directory” errors.
  Date/Author: 2026-01-30 (assistant)

- Decision: Delete actions in Studio will become archive actions that remove tiles/projects from the active view but keep worktrees and state on disk.
  Rationale: Archive-first preserves user data and aligns with the “control room” mental model. Destructive cleanup will be a separate, explicit operation later.
  Date/Author: 2026-01-30 (assistant)

- Decision: Persist each tile’s worktree path in the project store and use it to build agent instructions client-side.
  Rationale: The browser cannot resolve the OpenClaw state directory, so the worktree path must be supplied by the server to keep instructions accurate.
  Date/Author: 2026-01-30 (assistant)

- Decision: Drive tile previews from summary fields seeded by `status` + `sessions.preview`, and only load transcripts when explicitly requested.
  Rationale: This keeps the dashboard lightweight while still showing recent activity without pulling full histories.
  Date/Author: 2026-01-30 (assistant)

## Outcomes & Retrospective

Archive-first flows ship end-to-end: API routes mark archivedAt, UI labels/toggles updated, and tests cover archive mutations + filters.

## Context and Orientation

This repo is a Next.js App Router UI that stores projects and tiles in a local JSON file and connects directly to an OpenClaw gateway over WebSocket. The store is written by `src/app/api/projects/store.ts` to a file under the state directory (resolved in `src/lib/clawdbot/paths.ts`). Agent tiles are rendered and managed by `src/features/canvas/components/AgentTile.tsx` and state is held in `src/features/canvas/state/store.tsx`. The gateway connection is currently implemented by `src/lib/gateway/GatewayClient.ts` and used by `src/lib/gateway/useGatewayConnection.ts` and `src/app/page.tsx` to send `chat.send`, `chat.history`, and `sessions.patch` requests. Tile creation is handled by `src/app/api/projects/[projectId]/tiles/route.ts` and currently provisions workspace files under `resolveAgentWorkspaceDir` from `src/lib/projects/agentWorkspace.ts`, then writes an agent entry into the OpenClaw config via `src/lib/clawdbot/config.ts`.

In the upstream OpenClaw repo at `~/clawdbot`, the gateway protocol, events, and control UI client are defined under `src/gateway/*` and `ui/src/ui/gateway.ts`. Gateway methods are enumerated in `~/clawdbot/src/gateway/server-methods-list.ts`, and the snapshot/state version shape is in `~/clawdbot/src/gateway/server/health-state.ts` and `~/clawdbot/src/gateway/protocol/schema/snapshot.ts`.

A “worktree” is a Git feature that allows multiple working directories for a single repository, each checked out to a branch or commit. In this plan, each agent gets its own worktree directory so its file edits and Git status do not interfere with other agents.

## Plan of Work

First, align the gateway client and event frame shapes with the OpenClaw control UI by reusing the upstream client logic and types. Replace the current `GatewayClient` with a wrapper around a locally vendored `GatewayBrowserClient` that is copied from `~/clawdbot/ui/src/ui/gateway.ts`. Add a dedicated sync script under `scripts/` that reads the upstream file and overwrites the vendored copy so upgrades are pulled in with one command, and update `EventFrame.stateVersion` to match the upstream `{ presence, health }` shape. Add a thin adapter so Studio’s hooks and state management remain stable while the underlying client changes.

Next, implement per-agent Git worktrees and make them the authoritative workspace path for each agent tile. This requires a worktree resolver that maps `(projectId, agentId)` to a stable worktree path under the Studio state directory and a provisioning step on tile creation that runs `git worktree add` to create the directory. Use a branch naming scheme of `agent/<agentId>` so each agent has an isolated branch by default. Workspace files (AGENTS.md, SOUL.md, IDENTITY.md, USER.md, TOOLS.md, HEARTBEAT.md, MEMORY.md, plus the `memory/` directory) should be created in the worktree, and the worktree should ignore them locally using `.git/info/exclude` so they are not committed. Update the agent instruction message to point to the worktree path and describe it as a worktree of the project repo to keep the mental model explicit.

Then, replace the current chat history polling with event-driven summaries. On gateway connect, load a summary snapshot using `status` and `sessions.preview` to seed each tile’s last activity and preview text. Keep transcript loading as an on-demand action (for example, when a user expands the transcript or explicitly requests history). Add an event bridge that listens to gateway `chat`, `agent`, `heartbeat`, and `presence` events and updates per-tile summary fields in state. The dashboard view should be driven by these summaries, not by full history.

Finally, remove destructive deletes. Replace tile and project delete endpoints with archive actions that mark items as archived in the store while leaving state and worktrees on disk. Update the UI labels to “Archive” and add a simple archived filter toggle so the operator can restore or view archived items without touching disk. Keep a separate, explicit “purge” task out of scope for this plan.

## Concrete Steps

Work from the Studio repo root.

    cd /Users/georgepickett/clawdbot-agent-ui

If any gateway protocol shape or event naming is unclear, confirm it in the upstream repo before changing Studio code.

    rg -n "GatewayBrowserClient|EventFrame|stateVersion|GATEWAY_EVENTS" ~/clawdbot

Milestone 1 work involves adding a shared gateway client layer and updating Studio to use it. Create a vendored copy of the upstream client at `src/lib/gateway/openclaw/GatewayBrowserClient.ts`, and create a sync script at `scripts/sync-openclaw-gateway-client.ts` that overwrites that file from `~/clawdbot/ui/src/ui/gateway.ts`. Add a package script `sync:gateway-client` that runs the sync script. The goal is to reduce drift; upgrades happen by pulling `~/clawdbot` and re-running the sync script.

Milestone 2 work involves adding a worktree resolver and provisioning logic. Use `git worktree add` against the project repo path to create a worktree directory for each agent and ensure `.git/info/exclude` ignores agent workspace files.

Milestone 3 work involves adding a summary state layer and event bridge, and removing the history polling loop from `src/app/page.tsx` in favor of event-driven updates plus on-demand history loading.

Milestone 4 work involves updating store mutation helpers and routes to archive instead of delete, and wiring UI toggles and labels accordingly.

## Validation and Acceptance

Each milestone must be independently verifiable with tests or concrete commands.

Milestone 1 verification workflow must include a unit test that proves Studio can parse a gateway `event` frame with a `stateVersion` object shaped like `{ presence, health }`, and that the new gateway client adapter passes `connect.challenge` flows correctly. The tests should be written first and should fail with the old client. After implementation, run `npm test` and confirm those tests pass. Manually run the dev server and verify the gateway connects, including disconnect/reconnect behavior.

    npm test
    npm run dev

Milestone 2 verification workflow must include a unit test that resolves a worktree path deterministically from `(projectId, agentId)` and asserts that the agent instruction message uses that worktree path. The tests should be written first, fail, then pass after implementation. For manual verification, create a workspace, create two tiles, and verify their worktree directories exist and are separate. Confirm that each worktree contains the workspace files and that `.git/info/exclude` contains entries for those files.

    npm test
    npm run dev

Milestone 3 verification workflow must include tests for a new event reducer or bridge that updates per-tile summary fields when receiving `chat` and `agent` events. The tests should simulate events and assert last activity, latest preview text, and status updates. After implementation, run `npm test` and then verify in the UI that tiles update their summaries without opening transcripts. History should only load after an explicit user action (for example, selecting a tile or clicking a “Load history” control).

    npm test
    npm run dev

Milestone 4 verification workflow must include tests for store mutations that mark tiles/projects archived rather than removing them. The tests should confirm archived items are hidden by default but can be shown again via the UI filter. After implementation, run `npm test`, then use the UI to archive a tile and confirm that its worktree and state remain on disk.

    npm test
    npm run dev

## Idempotence and Recovery

All steps must be safe to re-run. Worktree creation should detect existing worktrees and skip creation without error. Archive actions should be reversible by toggling archived flags in the store, and no step should remove directories from disk. If a step fails, revert the most recent code changes and re-run the tests for that milestone before proceeding.

## Artifacts and Notes

Example worktree layout expected after Milestone 2:

    ~/.openclaw/agent-canvas/worktrees/<projectId>/<agentId>/
      .git
      IDENTITY.md
      USER.md
      HEARTBEAT.md
      TOOLS.md
      MEMORY.md
      memory/

Example summary fields expected after Milestone 3:

    Tile status: Running
    Latest update: (from chat delta or last assistant message)
    Last activity: (timestamp from event)

## Interfaces and Dependencies

In `src/lib/gateway/openclaw/GatewayBrowserClient.ts`, vendor the upstream client behavior from `~/clawdbot/ui/src/ui/gateway.ts` with no functional edits beyond import path adjustments. The interface must include methods to connect, disconnect, send requests, and receive events. The `EventFrame` type in `src/lib/gateway/frames.ts` must have `stateVersion?: { presence: number; health: number }` to match the upstream protocol. Add `scripts/sync-openclaw-gateway-client.ts` that rewrites the vendored file from the upstream source and expose it as `npm run sync:gateway-client`.

In `src/lib/projects`, add a worktree helper module that exposes:

    resolveAgentWorktreeDir(projectId: string, agentId: string): string
    ensureAgentWorktree(repoPath: string, worktreeDir: string, branchName: string): { ok: boolean; warnings: string[] }
    ensureWorktreeIgnores(worktreeDir: string, files: string[]): void

Use the branch naming rule `agent/<agentId>` and the worktree root `resolveStateDir()/agent-canvas/worktrees/<projectId>/<agentId>` in `resolveAgentWorktreeDir` so the path is deterministic and does not collide across projects.

In `src/app/page.tsx`, extract the agent instruction text builder into a testable helper (for example `src/lib/projects/message.ts`) with a signature like:

    buildAgentInstruction(params: { worktreePath: string; repoPath: string; message: string }): string

In `src/features/canvas/state`, add summary fields to `AgentTile` such as `lastActivityAt`, `latestPreview`, and `lastUserMessage`. Provide a reducer or bridge that updates these fields from gateway events without requiring full chat history.

In `src/app/api/projects/[projectId]/tiles/route.ts`, update tile creation to provision worktrees and set the agent’s workspace path to the worktree. Do not delete or move directories.

In `src/app/api/projects/[projectId]/tiles/[tileId]/route.ts` and `src/app/api/projects/[projectId]/route.ts`, replace delete behavior with archive behavior by setting `archivedAt` on tiles or projects. Update store types accordingly in `src/lib/projects/types.ts` and `src/app/api/projects/store.ts`.

Plan Change Note: 2026-01-30 — Initial plan drafted to align Studio’s gateway client, worktree model, event-driven summaries, and archive-first delete behavior.

Plan Change Note: 2026-01-30 — Clarified gateway client sync approach with explicit vendored file + sync script.

Plan Change Note: 2026-01-30 — Added explicit worktree branch naming, ignore list, and deterministic worktree root.
