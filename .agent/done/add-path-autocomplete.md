# Add @ path autocomplete in agent message input

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

There is no PLANS.md at the repository root. This plan must be maintained in accordance with `.agent/PLANS.md`.

## Purpose / Big Picture

After this change, a user can type `@` in the agent message textarea and see autocomplete suggestions for files and folders rooted at their home directory (`~/`). Selecting a suggestion inserts an `@` path into the message, and the `@` mention text appears blue in the input. This gives a fast, visible way to reference local paths without switching contexts, and it is observable by typing `@` and seeing up to 10 non-hidden entries from the user’s home directory, filtered by the current directory prefix.

## Progress

- [x] (2026-01-31 22:27Z) Milestone 1: Add path autocomplete backend helper, API route, and unit tests.
- [x] (2026-01-31 22:35Z) Milestone 2: Replace the agent message textarea with a mentions-enabled input, wire autocomplete suggestions, and verify UI behavior (manual UI verification still pending).

## Surprises & Discoveries

- TypeScript `npm run typecheck` fails due to existing errors in `tests/e2e/workspace-settings.spec.ts`, unrelated to the autocomplete changes.

## Decision Log

- Decision: Use `react-mentions-ts` for the textarea mention behavior because it targets React 19 and Tailwind v4 and exposes styling hooks for mention highlighting and suggestions. Rationale: It matches the repo’s React version and Tailwind setup and provides a built-in suggestions UI and async data callbacks. Date/Author: 2026-01-31 / Codex.
- Decision: Keep path suggestions scoped to the user home directory, reject paths that resolve outside home, and exclude dotfiles. Rationale: This matches the user request, keeps behavior predictable, and avoids accidental traversal outside the home scope. Date/Author: 2026-01-31 / Codex.
- Decision: Return directories with a trailing `/` in the display string so users can continue typing deeper paths without re-adding slashes. Rationale: It aligns with the “current directory prefix” requirement and reduces manual typing. Date/Author: 2026-01-31 / Codex.
- Decision: Keep `react-mentions-ts` default markup internally and persist only the `plainTextValue` while using `displayTransform` to add the `@` prefix. Rationale: This preserves mention parsing for highlights/suggestions while keeping stored drafts as plain text. Date/Author: 2026-01-31 / Codex.

## Outcomes & Retrospective

- The backend helper and API route return home-scoped suggestions with dotfiles excluded, and unit tests verify prefix filtering and safety checks. The agent message input now uses `MentionsInput` with `@` suggestions wired to the new API, but manual UI verification is still pending. Typecheck currently fails due to pre-existing e2e test typing issues.

## Context and Orientation

The agent message input lives in `src/features/canvas/components/AgentTile.tsx` as a controlled `<textarea>` bound to `tile.draft`. The draft value is stored in the canvas store (`src/features/canvas/state/store.tsx`) and updated through `onDraftChange` from `src/app/page.tsx`. Server-side APIs for the studio live under `src/app/api/...` and commonly use `NextResponse` plus `logger` for error handling. Client-side JSON helpers are in `src/lib/http.ts`, with typed API wrappers in `src/lib/projects/client.ts` and shared types in `src/lib/projects/types.ts`.

## Plan of Work

First, add a small path-autocomplete helper in `src/lib/fs/pathAutocomplete.ts` that accepts a query string and returns at most 10 entries from the directory segment implied by the query, scoped to the user’s home directory. The helper should reject queries that resolve outside home, missing directories, or non-directory targets, and it should exclude entries whose names begin with a dot. Then add a server route (for example `src/app/api/path-suggestions/route.ts`) that calls the helper, logs actionable errors, and returns JSON with the suggestions. Wire the helper into unit tests in `tests/unit/pathAutocomplete.test.ts` using a temporary home directory to validate filtering, prefix matching, and safety checks.

Next, install `react-mentions-ts`, import its Tailwind CSS into `src/app/globals.css`, and replace the message `<textarea>` in `AgentTile` with `MentionsInput` and a single `Mention` configured to trigger on `@`. Implement an async data callback that calls the new API route and maps results to mention suggestions, limiting to 10 results and logging errors via `logger`. Configure mention styling so the mention text (including the `@` prefix) is blue, and keep existing behaviors: auto-resize, Enter-to-send (without Shift), and placeholder text. Confirm that selecting a suggestion inserts `@~/...` exactly once and that the stored `tile.draft` remains plain text with no hidden markup.

## Concrete Steps

1) Add the dependency and global CSS import.

   In the repo root, run:

     npm install react-mentions-ts

   Then update `src/app/globals.css` to import the Tailwind v4 styles from the package near the top with the other `@import` lines.

2) Create the backend helper and API route.

   Add `src/lib/fs/pathAutocomplete.ts` with a function like `listPathAutocompleteEntries` that accepts `{ query, homedir, maxResults }` and returns `{ entries, directory, query }`. Use `resolveUserPath` with an injected `homedir` function, enforce that the resolved path is inside the home directory, and derive `directory` and `prefix` from the query. Use `fs.readdirSync(dir, { withFileTypes: true })`, exclude hidden entries, filter by prefix, sort deterministically (directories first, then name), and slice to `maxResults`. Each entry should include `name`, `fullPath`, `displayPath` (with `~/` prefix), and `isDirectory`, with directories shown as `~/path/`.

   Add `src/app/api/path-suggestions/route.ts` with `runtime = "nodejs"` and a GET handler that accepts `?q=`. If the query is empty, treat it as `~/` so typing just `@` lists home entries. Return JSON on success. On error, log once with `logger.error` and return `{ error: message }` with a 400 or 404 status depending on the failure. Do not silently swallow errors.

3) Add unit tests for the helper.

   Create `tests/unit/pathAutocomplete.test.ts` using `vitest` and a temporary directory as the home directory. Cover at least:

   - Query `~/` returns non-hidden entries and excludes dotfiles.
   - Query `~/Doc` returns only entries starting with `Doc`.
   - Queries that resolve outside the temp home (for example `~/../`) are rejected with an actionable error.
   - Missing directories return a clear error.

   Use the same cleanup patterns as other fs tests in `tests/unit/projectFs.test.ts`.

4) Add client API helper and wire the UI.

   Add types for the new endpoint in `src/lib/projects/types.ts`, and add a `fetchPathSuggestions(query)` helper in `src/lib/projects/client.ts` that calls `/api/path-suggestions?q=`.

   In `src/features/canvas/components/AgentTile.tsx`, replace the `<textarea>` with `MentionsInput` and a `Mention` trigger for `@`. Keep the existing `draftRef` behavior by wiring the textarea ref from the mentions component to `draftRef` so `resizeDraft()` still works. Use the mention data callback to call `fetchPathSuggestions` and map entries into `{ id, display }` results. Ensure the inserted text is `@~/...` exactly once and that `tile.draft` stays plain text; if needed, adjust `markup` and `displayTransform` so the stored value matches the visible text. Set `allowSpaceInQuery` so paths with spaces still show suggestions. Apply a blue text class to the mention highlight and keep the existing send-on-Enter behavior.

## Validation and Acceptance

For Milestone 1, write the tests first, run them to see them fail, then implement until they pass. Run:

  (repo root)
  npm test -- tests/unit/pathAutocomplete.test.ts

Acceptance for Milestone 1 is that all new tests pass and the helper returns the expected entries for the temp home directory.

For Milestone 2, run the unit test suite and then start the dev server. Verify by typing `@` in the agent message input that a suggestions list appears with up to 10 non-hidden entries from the home directory, that `@` mentions are blue, and that selecting a suggestion inserts `@~/...` into the textarea. Confirm Enter sends the message as before and Shift+Enter adds a newline.

## Idempotence and Recovery

All steps are additive and can be safely re-run. If a test fails due to unexpected path handling, adjust the helper logic and re-run the tests. If the mention input shows double `@` characters, adjust `markup` or `displayTransform` and re-verify without touching unrelated code.

## Artifacts and Notes

After Milestone 1 tests run, capture a short transcript like:

  $ npm test -- tests/unit/pathAutocomplete.test.ts
   ✓ tests/unit/pathAutocomplete.test.ts (4 tests)

After Milestone 2 manual verification, capture a brief note describing the observed suggestion list and the inserted value, for example:

  Typed "@" and saw 10 suggestions from ~/ with no dotfiles. Selected "~/Documents/" and the input shows "@~/Documents/" in blue.

## Interfaces and Dependencies

Add `react-mentions-ts` as a dependency. Use `MentionsInput` and `Mention` from the package. The mention `data` callback must accept a query string and a callback function, and it must call the callback with an array of `{ id: string; display: string }` items derived from the new API. Ensure the `Mention` component uses `trigger="@"` and `allowSpaceInQuery` to support paths with spaces. The API route returns `PathAutocompleteResult` with `entries` and should be consumed via `fetchPathSuggestions`.

When you revise this plan, update the living sections (`Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective`) and add a note at the bottom describing what changed and why.

Plan updated on 2026-01-31 to reflect implemented backend/UI changes, test results, and outstanding manual verification.
