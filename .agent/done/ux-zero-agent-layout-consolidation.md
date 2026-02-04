# Consolidate Zero-Agent Dashboard Layout

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` are updated as work proceeds.

This document follows `.agent/PLANS.md`.

## Purpose / Big Picture

Today, when OpenClaw Studio has zero agents, the page still renders the normal split dashboard and repeats the same empty-state message in multiple panels. After this change, users see one clear, consolidated empty-fleet panel that explains what is happening and what to do next. This is visible immediately at `http://localhost:3000`.

## Progress

- [x] (2026-02-04 04:00Z) Captured before-state screenshots and mapped UX findings to source files.
- [x] (2026-02-04 04:23Z) Implemented one consolidation refactor in `src/app/page.tsx` to render a single zero-agent layout.
- [x] (2026-02-04 04:24Z) Validated with lint and screenshot recapture.
- [x] (2026-02-04 04:25Z) Finalized outcomes and moved this plan to `.agent/done/`.

## Surprises & Discoveries

- Observation: The Playwright wrapper skill script calls `playwright-cli`, but the currently installed `@playwright/mcp` package in this environment does not provide that binary.
  Evidence: `npx --yes --package @playwright/mcp playwright-cli --help` returns `sh: playwright-cli: command not found`.

## Decision Log

- Decision: Keep this refactor to a single file (`src/app/page.tsx`) and do not modify the fleet sidebar component yet.
  Rationale: The top UX issue is a page-level layout problem and can be solved cleanly with a low-risk conditional render.
  Date/Author: 2026-02-04 / Codex

- Decision: Use a direct Playwright script (`playwright` package already in repo) for evidence capture instead of the skill wrapper.
  Rationale: It preserves screenshot-backed UX validation despite wrapper/CLI mismatch and avoids blocking the flow.
  Date/Author: 2026-02-04 / Codex

## Outcomes & Retrospective

The zero-agent experience is now consolidated into one dedicated panel and no longer duplicates “No agents available” in separate panes. The main dashboard retains existing behavior for non-empty fleets. This directly addresses the highest-severity UX finding with minimal blast radius.

## Context and Orientation

The main UI shell lives in `src/app/page.tsx` inside `AgentStudioPage`. The current layout always renders three conceptual areas: `FleetSidebar`, a focused chat panel, and an optional inspect panel. The zero-agent case was previously handled twice:

- `src/features/agents/components/FleetSidebar.tsx` shows `No agents available.` when its `agents` prop is empty.
- `src/app/page.tsx` also showed `No agents available.` in the focused panel branch when no focused agent existed and the global agent list was empty.

This duplicated messaging and left a large blank main area on desktop.

## Plan of Work

Add a page-level gate in `AgentStudioPage` to detect `agents.length === 0`. For that case, render a single glass-panel empty state that includes current connection context and next-step guidance. When there is at least one agent, keep the existing split layout and behavior.

The only code changes are in `src/app/page.tsx`:

- Introduce `hasAnyAgents` derived state.
- Wrap the existing fleet/chat/inspect row in a conditional branch for `hasAnyAgents`.
- Add a dedicated zero-agent branch with one consolidated empty-state panel.

## Concrete Steps

From `/Users/georgepickett/openclaw-studio`:

1. Edited `src/app/page.tsx` to add `hasAnyAgents` and conditional rendering for zero-agent mode.
2. Ran lint:

    npm run lint

3. Re-captured screenshots for the zero-agent state:

    output/playwright/ux-audit/after-01-desktop-zero-agent.png
    output/playwright/ux-audit/after-03-mobile-zero-agent.png

## Validation and Acceptance

Acceptance is met.

1. With zero agents, the UI shows a single consolidated empty-state panel (no duplicate “No agents available.” in both sidebar and main pane).
2. Desktop no longer renders split sidebar + empty main pane in zero-agent mode.
3. Lint passes.
4. After screenshots confirm the visual change at the expected file paths.

## Idempotence and Recovery

The code edit is additive and reversible. If the conditional branch causes regressions, remove the zero-agent branch and restore the previous always-split layout in `src/app/page.tsx`.

## Artifacts and Notes

Before-state screenshots used for comparison:

- `output/playwright/ux-audit/before-01-desktop-initial.png`
- `output/playwright/ux-audit/before-06-mobile-initial.png`

After-state screenshots:

- `output/playwright/ux-audit/after-01-desktop-zero-agent.png`
- `output/playwright/ux-audit/after-03-mobile-zero-agent.png`

## Interfaces and Dependencies

No API or dependency changes. This refactor only changes rendering conditions and text in `src/app/page.tsx`.

---

Plan update note (2026-02-04): Completed implementation and verification; updated progress and retrospective with final outcomes.
