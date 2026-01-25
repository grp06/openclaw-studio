# True Multi-Agent Projects (Local Folders + Git Init + Per-Tile Agent IDs)

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

Maintain this document in accordance with `.agent/PLANS.md`.

## Purpose / Big Picture

After this change, the web UI can create a “project” by name and the server will create a real folder in your home directory (for example `~/example-project`), initialize it as a Git repository, and create a basic `.gitignore` that prevents committing `.env` files.

Inside a project, the UI can create multiple “agent tiles”. Each tile will be a true, isolated Clawdbot agent by using a unique `agentId` in the session key (for example `agent:proj-example-project-coder-a1b2c3:main`). This gives each tile its own Clawdbot state directory subtree (`~/.clawdbot/agents/<agentId>/...`) and its own default workspace (`~/clawd-<agentId>`), so sessions, auth profiles, and transcripts do not collide between tiles.

You can see it working by:

1. Starting the Clawdbot gateway and this Next.js dev server.
2. Creating a project named `example-project` in the UI.
3. Verifying the folder `~/example-project` exists, contains a `.git/` directory, and `.gitignore` contains `.env`.
4. Creating two tiles in that project (for example “Coder” and “Research” roles) and sending each a message.
5. Verifying transcripts land in different directories:
   - `~/.clawdbot/agents/<agentId1>/sessions/*.jsonl`
   - `~/.clawdbot/agents/<agentId2>/sessions/*.jsonl`

## Progress

- [x] (2026-01-25 18:30Z) Read `.agent/PLANS.md` and audited current app structure (projects store, tiles, gateway client).
- [x] (2026-01-25 18:55Z) Implemented project creation side effects (slugify, mkdir, `git init`, `.gitignore`) and updated the UI to accept only a project name.
- [x] (2026-01-25 18:55Z) Implemented per-tile `agentId`/`role` storage with a v1→v2 store migration and v2 session key derivation.
- [x] (2026-01-25 19:31Z) Added server-side tile creation endpoint with workspace bootstrap + auth profile copy and optional tile deletion endpoint.
- [x] (2026-01-25 19:31Z) Wired UI tile creation/deletion to server endpoints and updated client API helpers.
- [ ] (2026-01-25 19:38Z) Validate end-to-end (completed: `npm run lint`, `npm run build`; remaining: manual project/tile creation + gateway transcript verification).

## Surprises & Discoveries

- Observation: (none yet)
  Evidence: (none yet)

## Decision Log

- Decision: Do not patch Clawdbot’s `clawdbot.json` to add `agents.list` entries for every tile.
  Rationale: The gateway’s `config.patch`/`config.apply` schedules a restart, which is too disruptive for a UI that creates tiles frequently. For WebChat (`chat.send`) the gateway resolves `agentId` directly from the `sessionKey` prefix; using `agent:<agentId>:...` is sufficient to get isolated `agentDir` + session transcripts without touching config.
  Date/Author: 2026-01-25 / Codex

- Decision: Never delete project folders or agent directories from disk as part of “delete” actions.
  Rationale: Directory deletion is destructive and explicitly discouraged by the repo’s agent guidelines; the UI should only remove entries from its own store and leave cleanup as a separate, explicit operation.
  Date/Author: 2026-01-25 / Codex

- Decision: Generate client-side tile `agentId`s as `proj-<projectId>-<tileIdPrefix>` until server-side tile provisioning lands.
  Rationale: The UI still creates tiles locally during Milestone 2; this keeps per-tile session keys unique without blocking on the new tile endpoint.
  Date/Author: 2026-01-25 / Codex

## Outcomes & Retrospective

(Fill in once milestones land.)

## Context and Orientation

This repository is a local-only Next.js app that talks directly to a running Clawdbot Gateway over a WebSocket.

Key concepts (define these because names are overloaded):

- “Project”: In this app, a project is a record in a JSON store plus a real folder on disk in your home directory. After this change, creating a project also creates `~/<project-slug>` and initializes a Git repo there.
- “Tile”: A draggable UI panel representing an interactive chat session. Today, tiles are “agents” only in the UI sense; they all use `agent:main:...` session keys.
- “Agent” (Clawdbot agent): In Clawdbot, the agent is encoded in the session key prefix: `agent:<agentId>:<rest>`. The `<agentId>` is used to choose the agent’s state directory (`~/.clawdbot/agents/<agentId>/agent`) and session transcript directory (`~/.clawdbot/agents/<agentId>/sessions`). When we say “true multi-agent” in this plan, we mean “each tile uses a different `<agentId>` so Clawdbot’s state and transcripts are isolated per tile”.
- “Gateway”: The Clawdbot process that exposes a WebSocket RPC interface. This UI uses it via `src/lib/gateway/GatewayClient.ts` and calls methods like `chat.send` and `sessions.patch`.

Current code layout (important files you must read before editing):

- Project store (server side):
  - `app/api/projects/store.ts` writes `~/.clawdbot/agent-canvas/projects.json`
  - `app/api/projects/route.ts` implements `GET/POST/PUT /api/projects`
  - `app/api/projects/[projectId]/route.ts` implements `DELETE /api/projects/:projectId`
- Client-side state:
  - `src/state/store.tsx` holds `ProjectsStore` in React state and persists it back to the server via `PUT /api/projects`
- UI + gateway wiring:
  - `app/page.tsx` sends chat via `client.call("chat.send", { sessionKey, ... })`
  - `src/lib/gateway/GatewayClient.ts` is the WebSocket RPC client

Important current behavior that must change:

- Tile session keys are currently hard-coded under the main agent:
  - `src/state/store.tsx` builds keys as `agent:main:proj-${projectId}-${tileId}`
  - This causes all tiles to share the same agentId (“main”), which is not true multi-agent isolation.

## Milestones

### Milestone 1: Projects create real folders and Git repos

At the end of this milestone, creating a project from the UI (by name) will create a new directory in `~/` (based on a slugified name), run `git init` inside it, and ensure `.gitignore` ignores `.env` files. The project record stored in `projects.json` will point at that directory via `repoPath`.

Define “slugified name” for this repo so it is deterministic and testable:

- Trim whitespace.
- Lowercase.
- Replace any run of characters that are not `a-z` or `0-9` with a single `-`.
- Trim leading/trailing `-`.
- If the result is empty, reject the request with HTTP 400 (“Project name produced an empty folder name”).

Define collision behavior explicitly so the endpoint is safe to retry and safe around existing folders:

- Preferred: if `~/<slug>` already exists, choose the first available suffix `~/<slug>-2`, `~/<slug>-3`, etc, and return a warning in the response that indicates the final path chosen.
- Never delete or overwrite existing directories as part of “create project”.

Define the exact `.gitignore` rules this milestone must guarantee (append missing lines if the file exists; do not remove user lines):

    .env
    .env.*
    !.env.example

You can prove it works by creating a project named `example-project` and running `ls -la ~/example-project` to see `.git/` and `.gitignore`, and `cat ~/example-project/.gitignore` to confirm `.env` is present.

### Milestone 2: Persisted tile schema supports per-tile agent IDs

At the end of this milestone, the persisted store schema moves from `ProjectsStore.version = 1` to `version = 2`. Each tile now has a required `agentId` and `role`, and the `sessionKey` becomes a derived value that always uses the agent id prefix form `agent:<agentId>:main`.

Migration rules from v1 must be written down and implemented exactly:

- If the stored file is missing or has `version: 1`, treat it as v1.
- For each v1 tile:
  - Set `tile.agentId` by parsing `tile.sessionKey`:
    - If `tile.sessionKey` matches `agent:<something>:<rest>`, then `agentId = <something>`.
    - Otherwise set `agentId = "main"`.
  - Set `tile.role = "coding"` (legacy default).
  - Keep `tile.sessionKey` as-is for legacy tiles so existing sessions/transcripts still match.
- For any new tile created under v2 rules:
  - Always set `tile.sessionKey = agent:<tile.agentId>:main`.

You can prove it works by loading an existing v1 store and seeing it automatically hydrate tiles with `agentId = "main"` (legacy) while new tiles get unique `agentId`s.

### Milestone 3: Creating a tile provisions a real Clawdbot agent workspace and auth copy

At the end of this milestone, creating a tile is no longer a client-only operation. The client will call a new server endpoint, and the server will both update the `projects.json` store and run filesystem side effects that make the new tile usable as an independent Clawdbot agent.

Add a new API route:

- `POST /api/projects/:projectId/tiles`

Request JSON:

    { "name": "Coder", "role": "coding" }

Response JSON:

    { "store": <ProjectsStore>, "tile": <ProjectTile>, "warnings": ["..."] }

Server-side behavior for `POST /api/projects/:projectId/tiles`:

- Load the current store via `loadStore()` and find the project by id.
- Generate:
  - `tile.id = crypto.randomUUID()`
  - `tile.agentId` using a deterministic, safe id generator (specified in the Interfaces section) based on:
    - project folder slug (from `project.repoPath` basename)
    - role
    - a short random suffix (for uniqueness)
- Set `tile.sessionKey = agent:<tile.agentId>:main`.
- Add the tile to the project, save the store, and then run side effects:
  - Create the agent workspace folder at `~/clawd-<agentId>` (create directories if missing).
  - Attempt to create a symlink inside that workspace: `~/clawd-<agentId>/repo -> <project.repoPath>`.
    - If the symlink already exists, do nothing.
    - If the symlink creation fails, do not create an alternate symlink/fallback; the bootstrap files below already contain the absolute repo path.
  - Create these bootstrap files in the workspace if they do not exist:

        BOOTSTRAP.md
        AGENTS.md
        SOUL.md

    The minimum required content (write exactly this structure; customize role + repo path dynamically):

        # BOOTSTRAP.md

        Project repo: <absolute repo path>
        Role: <coding|research|marketing>

        You are operating inside this project. Prefer working in ./repo (symlink) when it exists.
        If ./repo does not exist, operate directly in: <absolute repo path>

        First action: run "ls" in the repo to confirm access.

- Copy auth profiles from the default agent into the new agent if the new agent has no auth file yet:
  - Resolve `stateDir = process.env.CLAWDBOT_STATE_DIR ?? "~/.clawdbot"`.
  - Resolve `sourceAgentId = process.env.CLAWDBOT_DEFAULT_AGENT_ID ?? "main"`.
  - Source: `<stateDir>/agents/<sourceAgentId>/agent/auth-profiles.json`
  - Destination: `<stateDir>/agents/<agentId>/agent/auth-profiles.json`
  - Never overwrite an existing destination file.
  - If the source does not exist, return a warning like: `No auth profiles found at <source>; agent may need login`.

You can prove it works by creating a tile and checking that `~/clawd-<agentId>/BOOTSTRAP.md` exists and `~/.clawdbot/agents/<agentId>/agent/auth-profiles.json` exists (assuming the source exists).

### Milestone 4: Chat uses per-tile session keys and produces isolated transcripts

At the end of this milestone, sending a message from a tile uses that tile’s per-tile session key (`agent:<agentId>:main`). This must result in distinct transcript files under each agent’s session directory.

You can prove it works by sending one message in two different tiles and then checking:

    ls ~/.clawdbot/agents/<agentId1>/sessions
    ls ~/.clawdbot/agents/<agentId2>/sessions

Both should contain JSONL transcript files and the files should differ.

## Plan of Work

Implement this as a sequence of small, verifiable changes. Avoid modifying the Clawdbot repo; all changes are contained within this repository.

First, make project creation authoritative on the server: update `app/api/projects/route.ts` `POST` so it accepts a project name and performs filesystem creation (`~/<slug>`, `git init`, `.gitignore`). Update the UI form in `app/page.tsx` so the user provides only a project name; do not ask for a repo path in the UI anymore, since the server determines it.

Second, introduce a v2 store schema that supports per-tile `agentId` and `role`. Implement the migration in `app/api/projects/store.ts` inside `loadStore()`. Stop silently resetting the store on parse errors; instead, throw an error that returns HTTP 500 with a message pointing at the store path so the user can fix or delete it intentionally.

Third, add a dedicated server endpoint for creating tiles so you can run filesystem side effects at creation time. Implement:

- `app/api/projects/[projectId]/tiles/route.ts` with `POST` as defined in Milestone 3.
- Optionally (recommended), implement `DELETE app/api/projects/[projectId]/tiles/[tileId]/route.ts` so tile deletion can also be server-authoritative (while still not deleting directories on disk).

This endpoint will generate the tile id, compute a safe `agentId`, create the workspace and bootstrap files, and copy auth profiles if possible. It must return the updated store (and the created tile) so the client can update state without racing the debounced `PUT /api/projects` persistence.

Fourth, update the client to use the per-tile `sessionKey` derived from `agentId` when calling `chat.send` and `sessions.patch`, and update the lookup helpers that match incoming `chat` events by `sessionKey`.

This requires edits in:

- `src/state/store.tsx` to remove client-only `createTile()` and replace it with a function that calls the new tile endpoint and dispatches `loadStore` with the returned store.
- `app/page.tsx` to ensure any “new agent” action calls the updated store function, and that any message send uses the tile’s current `sessionKey`.

Finally, validate with a hands-on scenario and run `npm run lint` and `npm run build`.

## Concrete Steps

All commands in this section are run from the repository root unless otherwise stated.

1. Install deps:

    npm install

2. Start the Clawdbot gateway in a separate terminal (this plan assumes it is already installed and configured on your machine):

    clawdbot gateway run --bind loopback --port 18789 --force

3. Start the Next.js app:

    npm run dev

4. Open the UI:

    http://localhost:3000

5. Connect to the gateway (Connection panel):

    Gateway URL: ws://127.0.0.1:18789
    Token: (enter if your gateway requires it)

6. Create a project named `example-project` and verify on disk:

    ls -la ~/example-project
    cat ~/example-project/.gitignore

7. Create two tiles (roles: “coding” and “research”), send one message from each, and verify on disk:

    ls ~/.clawdbot/agents
    ls ~/.clawdbot/agents/<agentId1>/sessions
    ls ~/.clawdbot/agents/<agentId2>/sessions

Expected: both session directories exist and each contains at least one `.jsonl` transcript file after sending messages.

## Validation and Acceptance

Acceptance is user-visible behavior:

- Creating a project named `example-project` results in a new folder at `~/example-project` with:
  - a `.git/` directory (Git repo initialized)
  - a `.gitignore` file containing rules that ignore `.env` files
- Creating two tiles in a project produces two different `agentId`s and their sessions do not collide:
  - after sending messages, transcripts appear under two different directories in `~/.clawdbot/agents/<agentId>/sessions/`
- Existing UI behavior remains functional:
  - The canvas still renders and tiles can be created/moved/resized.
  - `npm run lint` succeeds.
  - `npm run build` succeeds.

## Idempotence and Recovery

- Project creation must be safe to retry:
  - If the target directory already exists, the API should not delete or overwrite existing files; it should return a clear error or create a unique suffixed directory (document which approach you choose in the Decision Log).
  - If `git init` has already been run, do not reinitialize; treat it as success.
  - If `.gitignore` exists, only add missing ignore lines; do not delete user content.

- Tile creation must be safe to retry:
  - Never overwrite an existing `auth-profiles.json` in a destination agent dir.
  - Never overwrite existing workspace bootstrap files; only create missing ones.

If the store becomes invalid JSON, prefer failing with an actionable error rather than silently resetting it (silent reset loses data).

## Artifacts and Notes

When you land the implementation, include a short “evidence bundle” here as indented snippets:

    - Output of: ls -la ~/example-project
    - Contents of: ~/example-project/.gitignore (relevant lines only)
    - Output of: ls ~/.clawdbot/agents/<agentId>/sessions
    - Output of: npm run lint
    - Output of: npm run build

## Interfaces and Dependencies

Avoid new dependencies unless they remove real complexity.

Implement with:

- Next.js App Router route handlers (`app/api/.../route.ts`) using `export const runtime = "nodejs";`
- Node built-ins:
  - `fs` / `fs/promises` for filesystem operations
  - `path` and `os` for path construction
  - `child_process` (`spawnSync` or `execFile`) for running `git init`

New/updated types:

- In `src/lib/projects/types.ts`, update:

    export type ProjectTile = {
      id: string;
      name: string;
      agentId: string;
      role: "coding" | "research" | "marketing";
      sessionKey: string;
      model?: string | null;
      thinkingLevel?: string | null;
      position: { x: number; y: number };
      size: { width: number; height: number };
    };

- In `src/lib/projects/types.ts`, update:

    export type ProjectsStore = {
      version: 2;
      activeProjectId: string | null;
      projects: Project[];
    };

Create helper modules (names are suggestions; keep them small and focused):

- `src/lib/ids/slugify.ts` for turning project names into safe folder names.
- `src/lib/ids/agentId.ts` for generating safe, <=64-char agent IDs.
- `src/lib/fs/git.ts` for `git init` and `.gitignore` management.

Define these helpers precisely so two different implementers produce the same behavior:

- `slugifyProjectName(name: string): string`:
  - Trim whitespace.
  - Lowercase.
  - Replace any run of non-`[a-z0-9]` characters with `-`.
  - Trim leading/trailing `-`.
  - Return the result; if empty, throw an error that the caller converts into HTTP 400.

- `generateAgentId(params: { projectSlug: string; role: "coding" | "research" | "marketing"; seed: string }): string`:
  - Compute `base = "proj-" + projectSlug + "-" + role + "-" + seed`.
  - Normalize:
    - Lowercase.
    - Replace any run of characters not in `[a-z0-9_-]` with `-`.
    - Trim leading/trailing `-`.
    - If empty, fall back to `"proj-unknown-" + role + "-" + seed` (this is the only acceptable fallback; it prevents crashes if projectSlug is weird).
  - Enforce length:
    - If longer than 64 chars, truncate from the left side by trimming `projectSlug` first, keeping the suffix `-" + role + "-" + seed` intact, and ensuring the final string is <= 64.
  - The `seed` should be 6 chars derived from the tile UUID (for example `tileId.replaceAll("-", "").slice(0, 6)`), so collisions are extremely unlikely without needing a registry.

For the Git helper, explicitly specify required operations:

- `ensureGitRepo(dir: string): { warnings: string[] }`:
  - Create `dir` recursively if missing.
  - If `.git/` does not exist, run `git init` in that directory.
  - Ensure `.gitignore` contains these exact lines (append missing):

        .env
        .env.*
        !.env.example

Plan change notes:

- (2026-01-25 18:30Z) Initial ExecPlan drafted based on current code audit.
- (2026-01-25 18:55Z) Updated progress and decision log after implementing Milestones 1–2 changes in code.
- (2026-01-25 19:31Z) Implemented Milestones 3–4 code paths and marked progress accordingly.
