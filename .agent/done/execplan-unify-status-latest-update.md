# Unify Agent Status + Latest Update Panel

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This plan is governed by `.agent/PLANS.md` in the repository root and must be maintained in accordance with that file.

## Purpose / Big Picture

Make the agent tile header cleaner by unifying status and “latest update” into a single panel above the message input, and by making the latest update reflect the most recent thinking trace while the agent is running. After this change, the UI should show a live thinking summary during a run, then switch to the final assistant message when the agent returns to idle. The latest update should no longer be line-clamped with ellipsis.

## Progress

- [x] (2026-01-30 01:52Z) Define unified status/update panel content and selection logic (status label, latest update, last user message) using existing tile state.
- [x] (2026-01-30 02:05Z) Update tile layout to place the unified panel above the message input and remove truncation styling.
- [x] (2026-01-30 02:10Z) Run lint; manual UI verification not executed in this environment.

## Surprises & Discoveries

- Observation: `npm run lint` reports an existing Next.js warning about using `<img>` in `src/features/canvas/components/AgentAvatar.tsx`.
  Evidence: `@next/next/no-img-element` warning from eslint.

## Decision Log

- Decision: Use only existing tile state (`status`, `thinkingTrace`, `streamText`, `lastResult`, `outputLines`) to derive the unified panel content and avoid any new data fetching.
  Rationale: The request is a UI refactor and should not introduce new runtime behavior.
  Date/Author: 2026-01-30 (assistant)
- Decision: Remove line-clamp truncation and allow the latest update to wrap with a max-height + scroll.
  Rationale: The latest update should not be ellipsized; scrolling avoids excessive tile growth.
  Date/Author: 2026-01-30 (assistant)

## Outcomes & Retrospective

The unified panel now shows latest update (thinking while running, final response when idle) and the last user message above the input. The latest update is no longer clamped. Linting reports a pre-existing Next.js `<img>` warning in `src/features/canvas/components/AgentAvatar.tsx`.

## Context and Orientation

The agent tile UI is defined in `src/features/canvas/components/AgentTile.tsx`. It renders the avatar, name editor, status UI, message input, and transcript panel. Runtime tile state is defined in `src/features/canvas/state/store.tsx` as `AgentTile`, with `status`, `thinkingTrace`, `streamText`, `lastResult`, and `outputLines` available on each tile. Global UI styling lives in `src/app/globals.css`. The transcript panel below the input is already populated from `tile.outputLines` and `tile.streamText`.

“Thinking trace” refers to model reasoning text collected in `tile.thinkingTrace` or encoded in `tile.outputLines` via the `extractThinking` helpers. The helper functions `isTraceMarkdown` and `stripTraceMarkdown` already exist in `src/features/canvas/components/AgentTile.tsx` imports and are used to render transcript sections.

## Plan of Work

Update `src/features/canvas/components/AgentTile.tsx` to compute three display strings for the unified panel:

1. A short status label (Idle, Running, Error) with existing color styling.
2. A “latest update” body that uses this priority order:
   - If `tile.status === "running"` and `tile.thinkingTrace` has content, show the latest thinking trace content (use the current trace string; if it is long, allow wrapping rather than clamping).
   - Else if `tile.status === "running"` and `outputLines` contains trace markdown lines, show the most recent trace line after `stripTraceMarkdown`.
   - Else if `tile.status === "running"` and `streamText` has content, show the streaming assistant text.
   - Else if `tile.status !== "running"` and `lastResult` has content, show `lastResult`.
   - Else fall back to the most recent non-empty assistant line from `outputLines` (ignore trace lines and user lines that begin with `"> "`).
   - If none exist, show “No updates yet.”
3. A “last user message” line derived from the most recent line in `outputLines` that begins with `"> "`, with the prefix stripped. This is the “functionality from below” that moves into the unified panel.

Restructure the tile layout so the unified panel sits above the message input row, and remove the separate “Status” block if it still exists. Keep the input and send button behavior unchanged, but let the unified panel be the visual first read. Remove the line-clamp truncation class so the latest update text is not ellipsized; if the panel needs to stay tidy, prefer a max-height with scroll rather than clamping to a fixed number of lines.

If a class in `src/app/globals.css` currently enforces clamping (for example `.agent-summary-clamp`), remove it or replace it with a non-truncating style (wrapping or scroll). Do not add new dependencies or new data sources.

## Concrete Steps

Work from the repo root.

    pwd

Edit `src/features/canvas/components/AgentTile.tsx`:
- Add helper logic (inline or small local functions) to compute `statusLabel`, `latestUpdate`, and `lastUserMessage` per the priority rules above.
- Replace the existing status/latest block with a single panel that includes the status label and latest update text, plus a small “Last message” line showing `lastUserMessage` if available.
- Move this unified panel to sit directly above the message input row.
- Remove or relocate any redundant status chips so only one status display remains.

Edit `src/app/globals.css`:
- Remove the clamping rule for the summary (if present) or replace it with a non-truncating style (e.g., allow wrapping and optional scroll).

## Validation and Acceptance

This is a presentational change, so manual verification is appropriate.

Milestone 1 verification workflow:
1. Tests to write: Not practical for this UI-only refactor.
2. Implementation: Build the unified panel and selection logic.
3. Verification: Start the dev server and verify that, after sending a message, the panel shows the latest thinking trace while the agent is running. When the run completes, the panel should show the final assistant response. The last user message should appear in the panel if present. The latest update should not be clamped with ellipsis.
4. Commit: After validation, commit with a message like “Unify agent status and latest update panel.”

    npm run dev

Milestone 2 verification workflow:
1. Adjust spacing/typography to keep the panel readable and visually above the input.
2. Confirm the transcript panel still renders as before and that input/send interactions are unchanged.
3. Run lint to ensure no new lint errors are introduced.

    npm run lint

## Idempotence and Recovery

These edits are safe to repeat. If the layout or text selection logic looks wrong, revert the changes to `src/features/canvas/components/AgentTile.tsx` and `src/app/globals.css`, then re-run the dev server to confirm the rollback.

## Artifacts and Notes

An example unified panel layout (format only, not exact code):

    Running
    Latest update:
    Thinking: Inspecting repository structure and preparing changes...
    Last message: “Go and make new workspace lowercase”

The “Latest update” block should wrap naturally and remain visible without ellipsis.

## Interfaces and Dependencies

No new dependencies or API changes. This plan uses only the existing `AgentTile` fields in `src/features/canvas/state/store.tsx`:

- `status: "idle" | "running" | "error"`
- `thinkingTrace: string | null`
- `streamText: string | null`
- `lastResult: string | null`
- `outputLines: string[]`

Plan Change Note: 2026-01-30 — Initial plan drafted to unify status + latest update, use thinking trace while running, and remove truncation.
Plan Change Note: 2026-01-30 — Marked milestones complete, recorded lint warning, and captured UI decisions after implementation.
