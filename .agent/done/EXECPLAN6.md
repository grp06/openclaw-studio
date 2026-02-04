# Avatar-first agent tiles with options menu

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This plan must be maintained in accordance with the repository planning guide at `.agent/PLANS.md`.

## Purpose / Big Picture

After this change, creating a new agent shows a compact, avatar-first tile: the agent name appears above a circular avatar, and a single “Send a command” input sits below. The transcript window stays hidden until the first message is sent; then the conversation and thinking traces appear below the avatar. Model and thinking controls move into a small gear options panel, and the running/idle status plus delete action move out of the main view to reduce clutter. A user can start a new agent and immediately see a face and a single input box, and after sending a command they see the transcript panel appear beneath the avatar.

## Progress

- [x] (2026-01-28 00:00Z) Authored initial ExecPlan for avatar-first tiles and options menu.
- [x] (2026-01-28 17:35Z) Milestone 1: Add Multiavatar dependency, avatar helpers, and unit tests.
- [x] (2026-01-28 18:05Z) Milestone 2: Restructure AgentTile layout, add options menu, update default tile sizing, and add e2e coverage.

## Surprises & Discoveries

- Observation: Next dev server (Turbopack) could not resolve the symlinked `@multiavatar/multiavatar` package from `file:../Multiavatar`.
  Evidence: Next dev overlay showed “Module not found: Can't resolve '@multiavatar/multiavatar'” when loading the canvas.

## Decision Log

- Decision: Use Multiavatar seeded by `agentId` and strip the built-in environment circle so the UI owns the circular container.
  Rationale: `agentId` stays stable across renames, and a single UI circle avoids double backgrounds.
  Date/Author: 2026-01-28 / Codex

- Decision: Hide the transcript panel until there is output or streaming text.
  Rationale: This matches the “face + input only” requirement for new agents and avoids a large empty chat window.
  Date/Author: 2026-01-28 / Codex

- Decision: Make model/thinking selectors available in a gear options panel and relocate status and delete actions there.
  Rationale: The user requested an options menu and a rethink of the status/delete placement; there is no backend stop/run toggle today, so status stays read-only.
  Date/Author: 2026-01-28 / Codex

- Decision: Switch to the GitHub-hosted `@multiavatar/multiavatar` package and import from `@multiavatar/multiavatar/esm`.
  Rationale: Eliminates the local file dependency while keeping a resolvable ESM entry for Next/Turbopack.
  Date/Author: 2026-01-28 / Codex

## Outcomes & Retrospective

Implemented avatar-first tiles with a gear options panel, added Multiavatar helper/test coverage, and validated behavior with Playwright. Remaining follow-ups are optional UX tweaks (e.g., options panel behavior) based on user feedback.

## Context and Orientation

The agent canvas UI renders tiles via `src/features/canvas/components/AgentTile.tsx`, which is wrapped by `src/features/canvas/components/AgentTileNode.tsx` and placed on the canvas in `src/features/canvas/components/CanvasFlow.tsx`. Tile runtime state lives in `src/features/canvas/state/store.tsx` and is created from the persisted `ProjectTile` data defined in `src/lib/projects/types.ts`. New tiles are created by the API route `src/app/api/projects/[projectId]/tiles/route.ts`, which also defines the default tile size and name. The top-level page uses `src/app/page.tsx` to connect the canvas to gateway events and to send messages; it appends user and assistant output lines to each tile.

Avatar generation code is sourced from the GitHub-hosted `@multiavatar/multiavatar` package and wrapped by `src/lib/avatars/multiavatar.ts` to produce an SVG data URL for an `<img>` tag.

Playwright e2e tests live under `tests/e2e/`, and Vitest unit tests live under `tests/unit/`. Existing e2e tests already mock `/api/projects` to supply tiles.

## Plan of Work

First, add the Multiavatar dependency via GitHub, then create a small avatar helper module that turns a seed string into an SVG string and a safe data URL. Add a unit test to validate that the helper returns valid SVG and a data URL prefix so the build breaks early if the dependency is not wired correctly.

Next, refactor `AgentTile` into an avatar-first layout: name above avatar, input below, and a transcript window that only renders once there is output or streaming. Add a gear button that reveals model and thinking selectors plus the status indicator and delete action. Use simple, accessible HTML (button + popover or details/summary) and add minimal `aria-label`/`data-` hooks for Playwright. Update the minimum tile size and the API’s default tile size to match the compact layout. Finally, add a Playwright test that verifies the avatar, input, and options panel are present for a new tile and that the transcript panel is hidden initially.

## Concrete Steps

Work from the repo root `/Users/georgepickett/clawdbot-agent-ui`.

1. Ensure the Multiavatar build exists by checking `../Multiavatar/dist/esm/index.js`. If the file is missing, run `npm install` and `npm run build` inside `/Users/georgepickett/Multiavatar` to generate `dist/`.

2. Add the local dependency to `package.json` as `"@multiavatar/multiavatar": "file:../Multiavatar"`, then run `npm install` to update `package-lock.json`.

3. Create `src/lib/avatars/multiavatar.ts` with two exported functions: `buildAvatarSvg(seed: string): string` and `buildAvatarDataUrl(seed: string): string`. Validate that `seed` is a non-empty string and throw a clear error if not. Call `multiavatar(seed, true)` (no environment circle) and wrap the SVG in a `data:image/svg+xml;utf8,` URL with `encodeURIComponent`.

4. Add `tests/unit/multiavatar.test.ts` that asserts:
   - `buildAvatarSvg("Agent A")` starts with `<svg` and contains `</svg>`.
   - `buildAvatarDataUrl("Agent A")` starts with `data:image/svg+xml;utf8,` and includes an encoded `<svg` fragment.

5. Add a small presentational component `src/features/canvas/components/AgentAvatar.tsx` that accepts `seed`, `name`, and optional `size` props, uses `buildAvatarDataUrl`, and renders an `<img>` inside a circular container (`rounded-full`, `overflow-hidden`). Use `alt` text like `Avatar for ${name}` for testability.

6. Refactor `src/features/canvas/components/AgentTile.tsx`:
   - Replace the current header row and transcript-first layout with a vertical stack: name input (centered), avatar, input row, then transcript panel.
   - Keep the name editable with the same onBlur/onKeyDown logic, but style it as a centered label above the avatar.
   - Introduce a gear button (using `lucide-react` settings icon) that opens an options panel containing the Model selector, Thinking selector, a read-only status indicator, and a “Delete agent” button. This panel should be accessible (keyboard focusable) and should not interfere with tile dragging.
   - Remove the always-visible “No output yet.” message; instead, render the transcript panel only when there is output (`tile.outputLines.length > 0`), streaming text, or active thinking.
   - Keep existing output rendering logic, including thinking traces and streamed text, but position it in the new panel below the input.

7. Update `MIN_TILE_SIZE` in `AgentTile.tsx` and the default `size` in `src/app/api/projects/[projectId]/tiles/route.ts` to match the compact layout (for example, around 420x520). Ensure the new minimum still allows the transcript to be visible when present.

8. Add a Playwright test `tests/e2e/agent-tile-avatar.spec.ts` that:
   - Mocks `/api/projects` to return a store with one tile and no output lines.
   - Navigates to `/` and asserts the avatar image with alt text is visible and the “Send a command” input exists.
   - Opens the gear options panel and asserts the Model and Thinking selectors are visible.
   - Asserts that the transcript panel is not present when output lines are empty (use a `data-testid` on the transcript container if needed).

9. Run unit and e2e tests: `npm test` and `npm run e2e`. If Playwright requires the dev server, use the same workflow as existing e2e tests.

## Validation and Acceptance

The change is accepted when:

- Creating a new agent renders a tile with a centered name above a circular avatar and an input labeled “Send a command,” and no transcript window is visible until a message is sent.
- After sending a command, the transcript window appears below the avatar and contains the user message and assistant output, with thinking traces formatted as before.
- A gear options panel exists on the tile, containing Model and Thinking controls, a status indicator, and a delete action.
- The avatar is generated from Multiavatar using a stable seed and displays consistently across reloads.

Milestone 1 verification workflow:

1. Tests to write: `tests/unit/multiavatar.test.ts` with assertions for `buildAvatarSvg` and `buildAvatarDataUrl`.
2. Implementation: add the local dependency, implement `src/lib/avatars/multiavatar.ts`.
3. Verification: run `npm test -- tests/unit/multiavatar.test.ts` and confirm it passes after failing before.
4. Commit: `git commit -m "Milestone 1: add avatar helper and tests"`.

Milestone 2 verification workflow:

1. Tests to write: `tests/e2e/agent-tile-avatar.spec.ts` to assert avatar, input, options panel, and hidden transcript.
2. Implementation: refactor `AgentTile`, add `AgentAvatar`, update tile sizes, and add necessary `aria-label`/`data-testid` hooks.
3. Verification: run `npm run e2e -- tests/e2e/agent-tile-avatar.spec.ts` and confirm it passes; run `npm test` to ensure unit tests still pass.
4. Commit: `git commit -m "Milestone 2: avatar-first tile layout and options menu"`.

## Idempotence and Recovery

All steps are safe to repeat. If `npm install` fails after adding the file dependency, remove the entry from `package.json`, run `npm install` to return to a clean state, then re-add the dependency once the Multiavatar build is confirmed. If UI changes cause layout regressions, revert the specific commit for the milestone and reapply the plan with adjusted sizes or layout choices.

## Artifacts and Notes

Expected unit test output excerpt:

  ✓ buildAvatarSvg returns svg
  ✓ buildAvatarDataUrl returns data url

Expected e2e assertions:

  - Avatar image is visible in the tile.
  - “Send a command” input is visible.
  - Options menu reveals Model and Thinking selectors.
  - Transcript container is absent when there is no output.

## Interfaces and Dependencies

Use the local `@multiavatar/multiavatar` package from `../Multiavatar` via a file dependency. Define a small helper module at `src/lib/avatars/multiavatar.ts` with:

  export function buildAvatarSvg(seed: string): string
  export function buildAvatarDataUrl(seed: string): string

`buildAvatarSvg` must throw a descriptive error if `seed` is empty. `buildAvatarDataUrl` must return a `data:image/svg+xml;utf8,` URL that can be used in an `<img>` tag. The `AgentAvatar` component must accept `seed` and `name` props and render an image with `alt="Avatar for ${name}"`.

Plan update (2026-01-28): Documented the switch to the GitHub-hosted Multiavatar package and updated progress to reflect completed milestones.
