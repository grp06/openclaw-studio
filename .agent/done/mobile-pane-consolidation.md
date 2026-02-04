# Mobile Pane Consolidation For Studio Workspace

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

The repo’s ExecPlan rules live at `.agent/PLANS.md` and this plan must be maintained in accordance with that file.

## Purpose / Big Picture

After this change, the mobile Studio experience (390x844 class screens) will no longer force users to scroll through the fleet list before reaching the active chat or inspect tools. Instead, mobile users have an explicit workspace mode switcher with focused panes for Fleet, Chat, and Inspect. Desktop behavior at `xl` and above remains unchanged with side-by-side panels.

## Progress

- [x] (2026-02-04 06:16Z) Capture UX evidence and map responsive root cause to source files (`src/app/page.tsx`, `src/features/agents/components/FleetSidebar.tsx`).
- [x] (2026-02-04 06:19Z) Implement mobile pane state + switcher in `src/app/page.tsx`.
- [x] (2026-02-04 06:23Z) Validate behavior with `npm run typecheck`, `npm run lint`, and refreshed Playwright screenshots.
- [ ] Move completed plan to `.agent/done/` with final notes.

## Surprises & Discoveries

- Observation: Mobile width does not overflow horizontally (`documentElement.scrollWidth === innerWidth`), so the issue is flow prioritization rather than overflow.
  Evidence: Playwright `eval` result at 390x844 (`docScrollWidth: 390`, `innerWidth: 390`).

- Observation: Playwright reference IDs became stale quickly after pane transitions; stable test IDs and text-role clicks were more reliable than replaying old refs.
  Evidence: Multiple `Ref eNN not found` events during the same session while snapshots advanced.

## Decision Log

- Decision: Apply a single-file consolidation in `src/app/page.tsx` instead of introducing new components.
  Rationale: Lowest blast radius and easiest rollback while still resolving the primary UX issue.
  Date/Author: 2026-02-04 / Codex

- Decision: Keep desktop (`xl`) composition unchanged and apply pane gating only below `xl`.
  Rationale: Desktop current layout is already usable and evidence-backed issue is mobile-first.
  Date/Author: 2026-02-04 / Codex

- Decision: Use a three-option segmented control (`Fleet`, `Chat`, `Inspect`) and disable `Inspect` unless an inspect agent is active.
  Rationale: It keeps mode semantics explicit and prevents dead-end taps.
  Date/Author: 2026-02-04 / Codex

## Outcomes & Retrospective

The targeted mobile UX issue is resolved by consolidating sub-`xl` content into one pane at a time with explicit navigation. On mobile, chat is now reachable immediately without scrolling through fleet; selecting an agent from fleet returns users to chat; opening inspect enters a focused inspect view; and closing inspect returns to chat. Desktop side-by-side layout remains intact.

Remaining gaps are non-blocking polish items (for example, potentially adding keyboard shortcuts or remembering the last mobile pane per session), but they were intentionally excluded to keep blast radius low.

## Context and Orientation

The Studio page is composed in `src/app/page.tsx`. In the connected/agents-present branch, layout previously rendered `FleetSidebar`, then `AgentChatPanel`, then optional `AgentInspectPanel` in a `flex-col` stack that only switched to row at `xl`. On mobile this made fleet dominate the initial viewport.

The before/after evidence set is in `output/playwright/ux-audit/.playwright-cli/` and includes:

- Before mobile default: `page-2026-02-04T06-14-55-595Z.png`
- After mobile chat pane default: `page-2026-02-04T06-20-31-031Z.png`
- After mobile fleet pane: `page-2026-02-04T06-20-52-224Z.png`
- After mobile inspect pane: `page-2026-02-04T06-22-54-276Z.png`
- After mobile inspect close back to chat: `page-2026-02-04T06-22-58-666Z.png`
- After desktop verification: `page-2026-02-04T06-21-32-235Z.png`

## Plan of Work

Edit `src/app/page.tsx` only.

Introduce `mobilePane` state (`fleet | chat | inspect`) and helper visibility classes that gate pane rendering below `xl` while preserving existing `xl` behavior.

Insert a compact mobile-only segmented control (`xl:hidden`) to switch panes directly.

Update callbacks to align pane transitions with user intent:

- Fleet row selection selects the agent and switches to `chat`.
- Inspect open switches to `inspect`.
- Inspect close switches back to `chat`.

Add an effect that exits inspect mode if inspect context disappears.

## Concrete Steps

Work in `/Users/georgepickett/openclaw-studio`.

1. Edit `src/app/page.tsx` to add `mobilePane` state and mobile pane switcher controls.
2. Gate panel wrappers using `mobilePane` for sub-`xl` visibility, with `xl:` classes restoring desktop behavior.
3. Update select/open/close handlers to drive mobile pane transitions.
4. Run validation commands:

    npm run typecheck
    npm run lint

5. Re-capture key screenshots at mobile and desktop sizes.
6. Update this plan with final outcomes and move to `.agent/done/`.

## Validation and Acceptance

Behavioral acceptance criteria and status:

1. At mobile width (390x844), only one pane is visible at a time: Fleet or Chat, and Inspect only when available. ✅
2. Fleet/Chat toggle switches visible pane immediately. ✅
3. Selecting an agent from Fleet switches pane to Chat. ✅
4. Opening Inspect from chat shows inspect pane; closing inspect returns to Chat. ✅
5. At desktop width (1920x1080), Fleet + Chat + optional Inspect remain side-by-side. ✅

Verification executed:

- `npm run typecheck` passed.
- `npm run lint` passed.
- Playwright screenshots captured and inspected for each acceptance criterion.

## Idempotence and Recovery

These changes are UI-only and reversible by editing `src/app/page.tsx`. Re-running validation commands and screenshot captures is safe and deterministic. If regressions appear, remove mobile visibility gating classes and keep desktop behavior unchanged while retaining `mobilePane` state hooks.

## Artifacts and Notes

Key generated artifacts (before cleanup):

- `output/playwright/ux-audit/.playwright-cli/page-2026-02-04T06-14-55-595Z.png` (before mobile)
- `output/playwright/ux-audit/.playwright-cli/page-2026-02-04T06-20-31-031Z.png` (after mobile chat)
- `output/playwright/ux-audit/.playwright-cli/page-2026-02-04T06-20-52-224Z.png` (after mobile fleet)
- `output/playwright/ux-audit/.playwright-cli/page-2026-02-04T06-22-54-276Z.png` (after mobile inspect)
- `output/playwright/ux-audit/.playwright-cli/page-2026-02-04T06-22-58-666Z.png` (after close inspect)
- `output/playwright/ux-audit/.playwright-cli/page-2026-02-04T06-21-32-235Z.png` (desktop check)

## Interfaces and Dependencies

No new dependencies.

`src/app/page.tsx` now includes:

- `type MobilePane = "fleet" | "chat" | "inspect"`
- `const [mobilePane, setMobilePane] = useState<MobilePane>("chat")`

No server APIs, gateway contracts, or store schemas changed.

Change Log:
- 2026-02-04: Initial plan created from screenshot-backed UX audit with single consolidation target.
- 2026-02-04: Marked implementation complete with validation outputs and final outcomes.
