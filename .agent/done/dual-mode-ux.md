# Migrate OpenClaw Studio to a Dual-Mode UX (Focused + Canvas)

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

The repo’s ExecPlan rules live at `.agent/PLANS.md` and this plan must be maintained in accordance with that file.

## Purpose / Big Picture

After this change, Studio will use a dual-mode experience. The default mode is an attention-first focused workspace with a compact fleet sidebar and one active agent workspace. A second mode keeps the canvas interaction model for spatial orchestration, so users can still drag agents around and organize their fleet visually when they want that creative control.

This matters because Discord already solves chat well; Studio needs to solve supervision and orchestration better than chat. The focused mode improves daily usability and reduces overload, while canvas mode preserves product differentiation and spatial planning workflows.

## Progress

- [x] (2026-02-03 20:49Z) Authored this ExecPlan and created Beads milestones with dependencies (`bd-26t` -> `bd-1bw` -> `bd-3c0`).
- [x] (2026-02-03 21:03Z) Removed deferred interaction scope from this plan and refocused Milestone 3 on persistence and full validation only.
- [x] (2026-02-03 21:15Z) Revised plan to dual-mode UX: focused workspace default with preserved canvas mode.
- [x] (2026-02-03 21:18Z) Implemented Milestone 1 dual-mode state model and settings persistence; unit tests pass; Bead closed. [bd-26t]
- [x] (2026-02-03 21:34Z) Implemented focused-default + canvas toggle UX, preserved canvas drag surface, and added e2e coverage for focused/canvas mode behavior. [bd-1bw]
- [x] (2026-02-03 21:44Z) Implemented dual-mode preference persistence (mode/filter/selection), added persistence e2e coverage, and ran full quality gates. [bd-3c0]

## Surprises & Discoveries

- Observation: There is no current `.agent/execplan-pending.md` file in this repo, so this plan must be created fresh.
  Evidence: `sed: .agent/execplan-pending.md: No such file or directory`.

- Observation: The current UI is structurally canvas-first (`CanvasFlow`) with one `selectedAgentId` in state, but every tile still renders a full chat surface.
  Evidence: `src/app/page.tsx` renders `<CanvasFlow tiles={agents} ...>` and `src/features/canvas/components/CanvasFlow.tsx` maps all tiles to full `AgentTile` nodes.

- Observation: The current state model already has the core primitives needed for focused view (`selectedAgentId`, `lastActivityAt`, `status`) but lacks explicit unread/attention tracking and filter preferences.
  Evidence: `src/features/canvas/state/store.tsx` `AgentTile` type and reducer actions.

- Observation: Gateway-key normalization treats any non-empty string key as valid; malformed keys are not rejected, they are normalized with default focused preferences.
  Evidence: `tests/unit/studioSettings.test.ts` (`normalizes_dual_mode_preferences`) keeps `focused.bad` with fallback values.

- Observation: Focused mode renders both sidebar and workspace empty-state messages, so broad text locators in e2e tests become ambiguous.
  Evidence: `tests/e2e/fleet-sidebar.spec.ts` required scoped assertions using `data-testid`.

- Observation: Existing e2e locators for “Connect”, “Disconnected”, and “Agents (0)” became ambiguous under the new dual-mode header/sidebar layout and required exact/scoped selectors.
  Evidence: Full `playwright test` run flagged strict-mode locator collisions in `tests/e2e/agent-inspect-panel.spec.ts`, `tests/e2e/agent-tile-avatar.spec.ts`, and `tests/e2e/workspace-settings.spec.ts`.

## Decision Log

- Decision: Implement the migration in three milestones: state first, then dual-mode layout, then persistence/e2e polish.
  Rationale: This keeps risk low, allows test-first verification at each layer, and avoids mixing reducer changes with large JSX rewrites.
  Date/Author: 2026-02-03 / Codex

- Decision: Keep backend APIs unchanged and build this entirely in Studio frontend/state.
  Rationale: The UX problem is presentation and interaction complexity, not missing runtime capability.
  Date/Author: 2026-02-03 / Codex

- Decision: Persist dual-mode UX preferences in existing studio settings rather than browser-only localStorage.
  Rationale: This repo already persists connection/layout in `settings.json`; keeping UX preferences there centralizes state and avoids dual persistence paths.
  Date/Author: 2026-02-03 / Codex

- Decision: Preserve canvas mode as a first-class secondary view instead of removing it.
  Rationale: Canvas is a core differentiator and supports spatial orchestration workflows that a list/sidebar view does not.
  Date/Author: 2026-02-03 / Codex

- Decision: Model unseen activity explicitly in store state (`hasUnseenActivity`) and drive attention/filtering through pure selectors.
  Rationale: It keeps Milestone 1 self-contained, testable with unit tests, and reusable across both focused and canvas modes.
  Date/Author: 2026-02-03 / Codex

- Decision: Reuse existing `AgentTile` inside focused mode workspace instead of creating a second chat surface component.
  Rationale: This preserved inspect/send/message behavior with lower implementation risk while enabling fast mode-switch delivery.
  Date/Author: 2026-02-03 / Codex

- Decision: Persist focused preferences in `settings.focused[gatewayUrl]` with debounced `updateStudioSettings` writes and gateway-scoped load on page init.
  Rationale: It keeps persistence consistent with existing settings storage, avoids noisy write bursts, and makes mode/filter state survive reload without backend changes.
  Date/Author: 2026-02-03 / Codex

## Outcomes & Retrospective

All milestones are complete. Studio now ships dual-mode UX with focused mode as default and preserved canvas mode as alternate view, plus persisted mode/filter/selection preferences by gateway.

## Context and Orientation

This plan builds on the gateway-first architecture already shipped in `.agent/done/remote-gateways.md`. Studio currently loads agents from gateway (`agents.list`) and stores runtime tile state in `src/features/canvas/state/store.tsx`. The page entrypoint `src/app/page.tsx` coordinates websocket events, history loading, sending messages, model/thinking/heartbeat operations, and rendering.

Right now, the visual default is a canvas where each agent tile includes a full conversation UI (`src/features/canvas/components/AgentTile.tsx`), and all tiles render simultaneously via React Flow (`src/features/canvas/components/CanvasFlow.tsx`). This is the core source of overwhelm.

For this plan, “focused workspace” means a single active agent panel (chat + controls) and a compact “fleet sidebar” list used to switch agents and filter by urgency. “Canvas mode” means the existing React Flow layout is retained for spatial organization and drag interactions, but positioned as an alternate view rather than the default chat surface. “Needs attention” means an agent that is waiting for user input, in error, or has unseen new activity while not selected.

Key files to understand before editing:

`src/app/page.tsx`: main page orchestration, event handling, rendering structure.

`src/features/canvas/state/store.tsx`: runtime agent state, reducer actions, selection.

`src/features/canvas/components/CanvasFlow.tsx`: current all-tiles canvas rendering.

`src/features/canvas/components/AgentTile.tsx`: full chat tile UI currently repeated for each agent.

`src/features/canvas/components/AgentInspectPanel.tsx`: inspect/settings panel that must remain usable for the selected agent.

`src/lib/studio/settings.ts`, `src/lib/studio/settings.server.ts`, `src/app/api/studio/route.ts`: persistent Studio settings model and API.

`tests/unit/agentStore.test.ts`, `tests/unit/studioSettings.test.ts`, `tests/e2e/*.spec.ts`: existing test scaffolding to extend.

## Plan of Work

Milestone 1 introduces new state semantics without changing the main layout yet. Add explicit attention and unread-friendly tracking in the reducer layer, and add persisted UI preferences (active mode, focused filter, and last selected agent per gateway) into studio settings normalization/merge logic. This milestone should end with deterministic selectors and reducer behavior validated by unit tests.

Milestone 2 implements dual-mode composition. Build a compact sidebar component for focused mode with status and attention indicators plus filter controls (`All`, `Needs Attention`, `Running`, `Idle`) and render one active agent workspace. Preserve canvas mode by continuing to use `CanvasFlow` and existing drag interactions, but present it as an alternate mode selectable from the UI header. Keep inspect functionality for the selected agent in both modes by reusing `AgentInspectPanel` and existing callbacks.

Milestone 3 adds final persistence validation and completion checks. Expand Playwright coverage to assert default focused layout, filter behavior, canvas mode availability, and persistence of dual-mode preferences across reloads. Finish with lint, typecheck, unit tests, and e2e.

## Concrete Steps

Work in repo root:

    cd /Users/georgepickett/openclaw-studio

Use Beads to execute milestones in order:

    br ready --json
    br update bd-26t --status in_progress

Run a tight test loop per milestone before broad checks:

    npm run test -- tests/unit/agentStore.test.ts tests/unit/studioSettings.test.ts

When each milestone passes:

    br close <id> --reason "Tests pass, committed"
    br sync --flush-only
    git add -A
    git commit -m "Milestone N: <summary>"

Run final checks:

    npm run lint
    npm run typecheck
    npm run test
    npm run e2e

Expected final quality-gate signals:

    lint exits 0
    typecheck exits 0
    vitest reports all tests passed
    playwright reports all specs passed

## Validation and Acceptance

### Milestone 1: Dual-mode state model [bd-26t]

Acceptance behavior: state can classify and filter agents by attention, track unseen activity when events arrive for non-selected agents, and persist/read dual-mode UX preferences through studio settings normalization and merge.

1. Tests to write first.
   In `tests/unit/agentStore.test.ts`, add tests named `tracks_unseen_activity_for_non_selected_agents` and `filters_agents_by_attention_and_status` that assert reducer/selectors produce the expected list for each filter.
   In `tests/unit/studioSettings.test.ts`, add tests named `normalizes_dual_mode_preferences` and `merges_dual_mode_preferences_without_dropping_layouts`.
   Run:

       npm run test -- tests/unit/agentStore.test.ts tests/unit/studioSettings.test.ts

   Confirm failures reflect missing fields/selectors before implementation.

2. Implementation.
   Update `src/features/canvas/state/store.tsx` to introduce explicit filter/attention primitives and unread tracking fields.
   Extend `src/lib/studio/settings.ts` and `src/lib/studio/settings.server.ts` to support persisted dual-mode UX preferences keyed by gateway.
   Keep changes backward-compatible with existing `settings.json` by normalizing absent fields to defaults.

3. Verification.
   Re-run the milestone tests and confirm they pass.

4. Commit.
   Commit with message: `Milestone 1: add dual-mode state and persisted preferences`.

### Milestone 2: Focused default + preserved canvas mode [bd-1bw]

Acceptance behavior: default page shows focused mode (compact fleet sidebar and one active agent workspace); users can switch to canvas mode and continue dragging agents; filter tabs change visible sidebar rows in focused mode; inspect panel still opens and works for the selected agent in both modes.

1. Tests to write first.
   Add/extend UI tests:
   `tests/e2e/canvas-smoke.spec.ts` with `loads_focused_workspace_default_layout`.
   New `tests/e2e/fleet-sidebar.spec.ts` with `switches_active_agent_from_sidebar` and `applies_attention_filters`.
   Add `tests/e2e/canvas-mode.spec.ts` with `switches_to_canvas_mode` and `retains_drag_capability`.
   Stub gateway/settings responses using current route-mocking patterns.
   Run:

       npm run e2e -- tests/e2e/canvas-smoke.spec.ts tests/e2e/fleet-sidebar.spec.ts tests/e2e/canvas-mode.spec.ts

   Confirm failing assertions before implementation.

2. Implementation.
   Create sidebar component(s), for example `src/features/canvas/components/FleetSidebar.tsx`.
   Refactor `src/app/page.tsx` to support two-pane focused workspace as default and a mode toggle to canvas view.
   Reuse existing `CanvasFlow` and related handlers for canvas mode instead of rebuilding drag behavior.
   Reuse existing send/history/event logic and `AgentInspectPanel` callbacks for the selected agent.
   Preserve connection panel and header controls.

3. Verification.
   Run targeted e2e specs and related unit tests until all pass.

4. Commit.
   Commit with message: `Milestone 2: ship focused default with preserved canvas mode`.

### Milestone 3: Dual-mode persistence and final validation [bd-3c0]

Acceptance behavior: view mode and focused preferences survive reload and reconnect for the same gateway, unseen indicators clear on focus, and all quality gates pass.

1. Tests to write first.
   Add tests in `tests/e2e/fleet-sidebar.spec.ts` named `focused_preferences_persist_across_reload` and `clears_unseen_indicator_on_focus`.
   Add test in `tests/e2e/canvas-mode.spec.ts` named `view_mode_persists_across_reload`.
   Add or extend unit coverage in `tests/unit/agentStore.test.ts` for clearing unseen activity on selection.
   Run failing tests first.

2. Implementation.
   Ensure view mode and focused preference updates are wired through `src/app/page.tsx` and persisted through settings updates after mode/selection/filter changes.
   Ensure both focused and canvas interactions remain deterministic under reconnect and refresh scenarios.
   Wire persistence updates through existing `/api/studio` settings path.

3. Verification.
   Run:

       npm run lint
       npm run typecheck
       npm run test
       npm run e2e

   Milestone is complete only when all commands pass.

4. Commit.
   Commit with message: `Milestone 3: finalize dual-mode persistence and validation`.

## Idempotence and Recovery

All steps are safe to rerun. Studio settings updates are merge-based; rerunning should overwrite the same preference keys without deleting existing gateway layouts. If a settings-related regression appears, recover by removing only the new preference fields from the settings JSON and restarting the app; do not delete the settings directory. If e2e tests are flaky due to timing, retry with targeted spec execution first, then full suite.

If the focused layout migration introduces regressions in production behavior, keep the old `CanvasFlow` path behind an internal temporary toggle during rollout so the UI can be switched back without backend changes. Remove the temporary toggle in a follow-up cleanup after stabilization.

## Artifacts and Notes

Expected focused layout DOM signals after Milestone 2 (example):

    Sidebar contains one row per agent with status badge text.
    Main workspace contains exactly one agent conversation panel.
    Selecting a different sidebar row updates main panel title and message input target.

Keep payload additive; do not remove existing `gateway` and `layouts` keys.

Expected dual-mode preference payload shape via `/api/studio` (example):

    {
      "focused": {
        "ws://gateway.example:18789": {
          "mode": "canvas",
          "selectedAgentId": "openclaw-studio",
          "filter": "needs-attention"
        }
      }
    }

## Interfaces and Dependencies

Add focused preference types to `src/lib/studio/settings.ts`:

    export type FocusFilter = "all" | "needs-attention" | "running" | "idle";

    export type StudioFocusedPreference = {
      mode: "focused" | "canvas";
      selectedAgentId: string | null;
      filter: FocusFilter;
    };

    export type StudioSettings = {
      version: 1;
      gateway: StudioGatewaySettings | null;
      layouts: Record<string, StudioGatewayLayout>;
      focused: Record<string, StudioFocusedPreference>;
    };

Add store-level helpers in `src/features/canvas/state/store.tsx`:

    export type AgentAttention = "normal" | "needs-attention";
    export const getAttentionForAgent: (agent: AgentTile, selectedAgentId: string | null) => AgentAttention;
    export const getFilteredAgents: (state: CanvasState, filter: FocusFilter) => AgentTile[];

Ensure event-driven patches in `src/app/page.tsx` update unseen activity fields when non-selected agents receive new assistant output or error transitions, regardless of active view mode.

No new backend dependencies are required. Continue using existing Next.js API routes, gateway websocket stream, and Vitest/Playwright setup already present in this repository.

Change Note:
- 2026-02-03: Initial creation of focused workspace migration ExecPlan to replace default multi-tile chat wall with attention-first sidebar and single active agent panel. This was added because the repository had no `.agent/execplan-pending.md` and the requested UX migration needed an executable, test-first plan.
- 2026-02-03: Revised plan direction to dual-mode UX so canvas interactions are preserved as a secondary mode while focused workspace remains the default.
- 2026-02-03: Marked Milestone 1 complete and updated plan details to match implemented state/settings interfaces and test evidence.
- 2026-02-03: Marked Milestone 2 complete after shipping header mode toggle, focused sidebar workspace, and targeted e2e coverage for mode switching and canvas availability.
- 2026-02-03: Marked Milestone 3 complete after wiring dual-mode preference persistence and passing lint, typecheck, full unit suite, and full e2e suite.
