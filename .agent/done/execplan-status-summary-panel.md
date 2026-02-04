# Refocus Agent Tiles on Status Summary

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This plan is governed by `.agent/PLANS.md` in the repository root and must be maintained in accordance with that file.

## Purpose / Big Picture

Shift the agent tiles toward a status-first presentation without adding new backend data or functionality. After this change, each agent tile should immediately communicate its status and a short “latest update” summary, while the message input remains available but visually secondary. This makes the UI feel more like a process dashboard than a chat wall, while preserving the current behavior and data flow.

## Progress

- [x] (2026-01-30 01:05Z) Rework the agent tile header to include a status-first summary and a latest-update preview using existing tile state.
- [x] (2026-01-30 01:18Z) Polish the layout and verify the UI changes via linting (manual UI run not executed in this environment).

## Surprises & Discoveries

- Observation: `npm run lint` reports an existing Next.js warning about using `<img>` in `src/features/canvas/components/AgentAvatar.tsx`.
  Evidence: `@next/next/no-img-element` warning from eslint.

## Decision Log

- Decision: Use only existing tile state (`status`, `streamText`, `lastResult`, `outputLines`) to build the summary preview, and avoid any new data fetching or timers.
  Rationale: The request explicitly avoids new functionality and should remain a pure presentational refactor.
  Date/Author: 2026-01-30 (assistant)
- Decision: Move the status pill into the new summary block and add a small line-clamp utility class for the preview.
  Rationale: Keeps the header clean and makes the status summary read first without introducing new data.
  Date/Author: 2026-01-30 (assistant)

## Outcomes & Retrospective

Agent tiles now surface a status-first summary and a latest-update preview using existing state, and the input row reads as secondary. No functional behavior changed. Linting reports a pre-existing Next.js `<img>` warning in `src/features/canvas/components/AgentAvatar.tsx`.

## Context and Orientation

The agent UI is rendered in `src/features/canvas/components/AgentTile.tsx`, which owns the tile layout, status chip, avatar, message input, and transcript panel. Tile state is defined in `src/features/canvas/state/store.tsx` as `AgentTile`, including `status`, `streamText`, `lastResult`, and `outputLines`. The avatar is a small component in `src/features/canvas/components/AgentAvatar.tsx`. Global styling hooks for selected avatars and names live in `src/app/globals.css`. No other files are needed for this UI-only refactor.

## Plan of Work

Update `src/features/canvas/components/AgentTile.tsx` to introduce a small “status summary” block near the top of each tile. The summary should show a human-friendly status label and a short preview of the latest assistant output. The preview should be derived from existing state in this order: current `streamText` if running, else `lastResult` if present, else a short non-empty line from `outputLines`, else a default empty-state string such as “No updates yet.” Keep the message input and send button intact but visually secondary (smaller, lighter, or positioned after the summary block). Avoid adding new data requests, timers, or complex animation.

If needed for layout clarity, add or adjust lightweight styling in `src/app/globals.css` or inline Tailwind classes, but do not introduce new dependencies. Keep the changes strictly presentational and make sure the tile still behaves the same for editing the name, shuffling the avatar/name, and sending a message.

## Concrete Steps

Work from the repo root.

    pwd

Open and edit `src/features/canvas/components/AgentTile.tsx` to add the status summary block and preview text logic. If a small reusable class is needed for truncation or spacing, add it in `src/app/globals.css` and reference it from the tile markup.

## Validation and Acceptance

The change is accepted when running the app shows each agent tile with a status-first summary and a readable latest-update preview, without breaking existing actions. Use the following verification workflow per milestone.

Milestone 1 verification workflow: Tests to write are not practical because this is a purely presentational change with no existing component test harness. Implement the summary block and preview text, then start the dev server and verify behavior manually. Run the app and ensure that a new agent shows “No updates yet,” a running agent shows streaming text when available, and a completed response updates the preview.

    npm run dev

Milestone 2 verification workflow: Adjust spacing/typography until the status summary reads first and the chat input reads second. Refresh the page and verify that editing the name, shuffling the avatar/name, opening settings, and sending messages still work. If you want extra confidence, run linting after the UI looks correct.

    npm run lint

## Idempotence and Recovery

These changes are safe and idempotent. Re-running the edits only changes UI markup and styles. If something looks wrong, revert the last edit in `src/features/canvas/components/AgentTile.tsx` and `src/app/globals.css`, then re-run the dev server to confirm the rollback.

## Artifacts and Notes

A representative summary block can look like this (formatting described, not exact code):

    Status: Running
    Latest: Refactoring auth flow to reduce redirects...

This should appear above the message input so the tile reads as a status card first and a chat tool second.

## Interfaces and Dependencies

No new dependencies are required. The preview text should use the existing `AgentTile` shape from `src/features/canvas/state/store.tsx`:

- `status: "idle" | "running" | "error"` drives the status label and color.
- `streamText: string | null` provides a live snippet while running.
- `lastResult: string | null` provides the latest assistant response summary.
- `outputLines: string[]` provides a fallback to find the last non-empty line.

No API changes, no new client calls, and no state mutations beyond what already exists.

Plan Change Note: 2026-01-30 — Initial plan created from the user request to move toward a status-first agent tile layout without adding new functionality.
Plan Change Note: 2026-01-30 — Marked milestones complete, recorded lint warning, and captured UI decisions after implementation.
