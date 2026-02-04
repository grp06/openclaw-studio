# Consolidate Empty-State Rendering and Fix Filter No-Match Layout

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This document follows `.agent/PLANS.md` from the repository root and must be maintained in accordance with that file.

## Purpose / Big Picture

After this change, empty states in the studio will be visually consistent and the filtered no-match state will fill the main panel instead of collapsing into a narrow column. A user can verify this by opening `http://localhost:3000`, selecting a filter that returns zero agents (for example `Running` when no agents are running), and observing that the empty message occupies the full chat pane with the same visual treatment used elsewhere.

## Progress

- [x] (2026-02-04 14:43Z) Wrote UX audit and selected a single consolidation refactor target in `.agent/ux-audit.md`.
- [x] (2026-02-04 14:45Z) Implemented shared empty-state component and replaced duplicated inline empty-state blocks in `src/app/page.tsx`, `src/features/agents/components/FleetSidebar.tsx`, and `src/features/agents/components/AgentChatPanel.tsx`.
- [x] (2026-02-04 14:48Z) Validated with `npm run lint`, `npm run typecheck`, and screenshot-based before/after comparison.
- [x] (2026-02-04 14:49Z) Moved completed plan to `.agent/done/ux-empty-state-consolidation.md`.

## Surprises & Discoveries

- Observation: The no-match message in the focused chat pane does not expand to fill available height.
  Evidence: `output/playwright/ux-audit/before-02-filter-empty-desktop.png` and fallback markup in `src/app/page.tsx` lacks `flex-1`.
- Observation: A first pass using `fillHeight` still rendered as a narrow strip because the empty-state container lacked `w-full`.
  Evidence: interim screenshot before final patch showed centered text in a narrow column; adding `w-full` in `EmptyStatePanel` resolved it (`output/playwright/ux-audit/after-02-filter-empty-desktop.png`).

## Decision Log

- Decision: Choose one refactor that both fixes the top UX issue and reduces duplication by introducing a reusable empty-state component.
  Rationale: This has the best payoff-to-risk ratio and touches only local UI files.
  Date/Author: 2026-02-04 / Codex

## Outcomes & Retrospective

The selected consolidation refactor delivered the intended UX behavior with low blast radius. Empty states now share a single primitive, and the highest-impact issue (collapsed no-match pane) is fixed and verified with screenshots.

## Context and Orientation

The main screen layout is assembled in `src/app/page.tsx`. It renders `FleetSidebar` (`src/features/agents/components/FleetSidebar.tsx`) and `AgentChatPanel` (`src/features/agents/components/AgentChatPanel.tsx`). Empty-state messages are currently hard-coded in each file with separate class strings. The key broken UX path is in `src/app/page.tsx`: when `focusedAgent` is null in the focused panel, the fallback element does not fill available space.

## Plan of Work

Create `src/features/agents/components/EmptyStatePanel.tsx` as the single empty-state primitive used by these surfaces. The component will accept a compact label, title/body text, and a `fillHeight` boolean that applies `h-full` so it can fill parent panels. Replace the inline empty states in:

- `src/app/page.tsx` for both `No agents match this filter.` and global `No agents available`
- `src/features/agents/components/FleetSidebar.tsx` for `No agents available.`
- `src/features/agents/components/AgentChatPanel.tsx` for `No messages yet.`

Keep text and behavior intact while standardizing structure and classes.

## Concrete Steps

From `/Users/georgepickett/openclaw-studio`:

1. Add `src/features/agents/components/EmptyStatePanel.tsx` with props for `label`, `title`, `description`, and `fillHeight`.
2. Update `src/app/page.tsx` to replace both empty-state blocks with `EmptyStatePanel` and set `fillHeight` for the focused no-match panel.
3. Update `src/features/agents/components/FleetSidebar.tsx` and `src/features/agents/components/AgentChatPanel.tsx` to use `EmptyStatePanel`.
4. Run:
   - `npm run lint`
   - `npm run typecheck`
5. Capture post-change screenshots in `output/playwright/ux-audit/` for the no-match filter state and baseline home state.

## Validation and Acceptance

Acceptance behaviors:

1. With app running at `http://localhost:3000`, selecting a filter with no matches shows a full-height empty state in the focused panel (no narrow strip).
2. Fleet/sidebar/chat empty states use one shared component and look consistent.
3. `npm run lint` exits successfully.
4. `npm run typecheck` exits successfully.

Verification workflow:

1. Tests to write: none; this is a presentational refactor with screenshot and static checks.
2. Implementation: complete all file changes listed in Plan of Work.
3. Verification: run lint/typecheck and capture after screenshots.
4. Commit readiness: only after verification passes and UX artifact cleanup runs.

## Idempotence and Recovery

Edits are additive and local to UI components. If a visual regression appears, revert only the touched component imports and call sites, keeping unrelated files unchanged. Re-running Playwright screenshots is safe and overwrites only chosen artifact paths.

## Artifacts and Notes

Before screenshots:

- `output/playwright/ux-audit/before-01-home-desktop.png`
- `output/playwright/ux-audit/before-02-filter-empty-desktop.png`

## Interfaces and Dependencies

No new external dependencies are required. Use existing project utilities and React component patterns. The new interface in `src/features/agents/components/EmptyStatePanel.tsx` should remain a plain typed React props object and be consumed by `page.tsx`, `FleetSidebar.tsx`, and `AgentChatPanel.tsx`.

Revision note: Initial plan created from `.agent/ux-audit.md` findings to implement one low-risk UX consolidation with direct screenshot evidence.

Revision note: Updated progress, discoveries, and outcomes after implementation and verification runs so this living document reflects the current completed state.

Revision note: Renamed and moved completed ExecPlan to `.agent/done/ux-empty-state-consolidation.md` per implement-execplan workflow.
