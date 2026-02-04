# Add Inspect Sidebar + De-duplicated Agent Tile Summary

This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision Log, and Outcomes & Retrospective must be kept up to date as work proceeds.

This plan follows /Users/georgepickett/openclaw-studio/.agent/PLANS.md and must be maintained in accordance with it.

## Purpose / Big Picture

After this change, the canvas shows a clean, delegation-first tile for each agent: a prominent status pill, a single summary line of the agent’s latest update, and the “send direction” input. All power-user detail (transcript, thinking traces, brain files, model/thinking settings, heartbeat) moves into a left-side Inspect panel that is hidden by default and opened only via an explicit Inspect button. Users can focus on the summary while still having a deep inspection surface when needed, without duplicated information.

## Progress

- [x] (2026-01-31 01:17Z) Draft Inspect sidebar design, data flow, and new UI state for open/close behavior.
- [x] Implement the Inspect sidebar (Activity, Thinking, Brain Files, Settings) and simplify the tile summary view.
- [x] Update Playwright tests to reflect the new Inspect button and sidebar behavior.
- [x] Verify behavior manually and via automated tests; record outcomes and commit.

## Surprises & Discoveries

- Observation: React Flow clears selection after clicking Inspect, even when we explicitly select the tile.
  Evidence: The inspect panel closed immediately until we stopped closing on null selection changes.

## Decision Log

- Decision: Use an explicit Inspect button to open a left sidebar that is hidden by default, and close it when a different tile is selected (not on deselection).
  Rationale: React Flow clears selection immediately after Inspect clicks; keeping the panel open unless another tile is selected preserves the intended behavior.
  Date/Author: 2026-01-31 / Codex

## Outcomes & Retrospective

- Inspect sidebar implemented with Activity, Thinking, Brain Files, and Settings sections; tiles now show status + single summary + send input.
- Playwright: `npx playwright test tests/e2e/agent-tile-avatar.spec.ts tests/e2e/agent-inspect-panel.spec.ts`.

## Context and Orientation

OpenClaw Studio renders agent tiles on a React Flow canvas. Each tile is built in /Users/georgepickett/openclaw-studio/src/features/canvas/components/AgentTile.tsx and is wrapped by /Users/georgepickett/openclaw-studio/src/features/canvas/components/AgentTileNode.tsx, which is instantiated by /Users/georgepickett/openclaw-studio/src/features/canvas/components/CanvasFlow.tsx. The main page that wires the canvas and global UI state is /Users/georgepickett/openclaw-studio/src/app/page.tsx.

The tile currently contains duplicate information (latest update + last message + transcript + thinking traces). The settings modal (also inside AgentTile) includes model/thinking, heartbeat, and workspace file editors. We will move those deeper controls into a new Inspect sidebar while keeping the tile summary simple.

“Inspect sidebar” in this plan means a left-aligned, full-height panel that appears only after an explicit Inspect button click on a tile. “Brain files” refers to the per-agent workspace files (AGENTS.md, SOUL.md, IDENTITY.md, USER.md, TOOLS.md, HEARTBEAT.md, MEMORY.md), which are defined in /Users/georgepickett/openclaw-studio/src/lib/projects/workspaceFiles.ts.

## Plan of Work

Create a new Inspect sidebar component and move detailed views into it. In /Users/georgepickett/openclaw-studio/src/app/page.tsx, add inspect panel state that is independent of selection, opened only by an explicit Inspect button, and automatically closed when the selected tile changes. Pass a new onInspect handler through CanvasFlow and AgentTileNode into AgentTile. Simplify AgentTile so it only shows status, a single summary line (from latest preview / last result), and the send input; remove last message, transcript, and settings modal from the tile.

The new Inspect sidebar should include four sections:

- Activity: full transcript (existing outputLines + streamText) and a “Load history” button when empty.
- Thinking: the current thinking trace and any trace-marked segments (using existing extractThinking helpers), separate from the main transcript.
- Brain Files: the existing workspace file editor UI, still editable.
- Settings: per-agent model + thinking level selector, heartbeat settings, and archive/restore action.

Keep Boot/Bootstrap hidden by not adding them to the Brain Files list. Keep model + thinking per-agent. Do not auto-open Inspect on selection; only via the new Inspect button. When a different tile is selected, close Inspect if it was open for the previous tile.

## Concrete Steps

1) Add a new Inspect state in /Users/georgepickett/openclaw-studio/src/app/page.tsx.
   - Create local state inspectTileId: string | null.
   - Add a handler handleInspectTile(tileId) that sets inspectTileId = tileId and also selects that tile via dispatch({ type: "selectTile", tileId }).
   - Add a useEffect that closes the inspect panel when the selected tile changes away from inspectTileId (set inspectTileId to null if state.selectedTileId is different).
   - Render the new Inspect sidebar component only when inspectTileId is not null and the tile exists in the active project.

2) Pass the Inspect handler down to the tile.
   - Update /Users/georgepickett/openclaw-studio/src/features/canvas/components/CanvasFlow.tsx to accept onInspectTile: (id: string) => void in CanvasFlowProps and in handlersRef.
   - Update /Users/georgepickett/openclaw-studio/src/features/canvas/components/AgentTileNode.tsx to include onInspect in AgentTile props.
   - Update /Users/georgepickett/openclaw-studio/src/features/canvas/components/AgentTile.tsx to render a new Inspect button that calls onInspect.

3) Simplify AgentTile.
   - Remove the settings modal and its local state.
   - Remove transcript rendering, thinking trace blocks, and last user message from the tile.
   - Keep status pill, agent avatar/name editing, and a single summary panel.
   - Update latestUpdate computation to prefer tile.latestPreview, tile.lastResult, or the last non-trace output line. Do not use thinkingTrace or trace-marked lines in the summary.
   - Label the summary block clearly (e.g., “Summary” or keep “Latest update”), but only show a single summary line.
   - Keep the send input and make sure its behavior is unchanged.

4) Implement the Inspect sidebar component.
   - Create /Users/georgepickett/openclaw-studio/src/features/canvas/components/AgentInspectPanel.tsx.
   - Move the workspace files and heartbeat editor logic from AgentTile into this component, keeping them editable and preserving existing API calls in /Users/georgepickett/openclaw-studio/src/lib/projects/client.
   - Move model + thinking selector UI here as part of the Settings section.
   - Add Activity and Thinking sections using the existing transcript and thinking rendering logic that previously lived in AgentTile.
   - Add a close button to the sidebar that sets inspectTileId to null in the parent.
   - Add data-testid values for testability: agent-inspect-toggle, agent-inspect-panel, agent-inspect-close, agent-inspect-activity, agent-inspect-thinking, agent-inspect-files, agent-inspect-settings.

5) Add layout + styles for the sidebar.
   - In /Users/georgepickett/openclaw-studio/src/app/page.tsx, render the Inspect sidebar as a left-aligned, full-height panel.
   - Ensure it has pointer events enabled while not blocking header overlays.
   - Add minimal CSS in /Users/georgepickett/openclaw-studio/src/app/globals.css for width, shadow, and scroll behavior (for example, fixed width around 360–420px, full height, overflow-y auto).

6) Update Playwright tests.
   - Modify /Users/georgepickett/openclaw-studio/tests/e2e/agent-tile-avatar.spec.ts to open the Inspect sidebar using the new Inspect button and assert that the panel shows the Settings section (Model + Thinking) and Brain Files section.
   - Add a new Playwright test file (for example /Users/georgepickett/openclaw-studio/tests/e2e/agent-inspect-panel.spec.ts) that verifies:
     - The Inspect panel is hidden by default.
     - Clicking Inspect opens the panel.
     - Clicking another tile closes the panel.
     - Closing the panel via the close button hides it.

## Validation and Acceptance

Acceptance criteria are behavior-based and must be visible in the UI:

- When the app loads with existing tiles, each tile shows only a single summary line and a status pill; no transcript or thinking details appear on the tile.
- The Inspect panel does not open automatically; it opens only when the Inspect button is clicked on a tile.
- When a different tile is selected, the open Inspect panel closes.
- The Inspect panel includes Activity (transcript + Load history), Thinking (trace), Brain Files (editable), and Settings (model/thinking + heartbeat + archive) sections.
- The workspace files remain editable with the same functionality as before.

Milestone verification workflow:

Milestone 1: Implement Inspect sidebar + simplified tile
1. Tests to write: Create or update Playwright tests as described. Ensure they fail because Inspect is not yet implemented.
2. Implementation: Apply the UI changes in page.tsx, CanvasFlow.tsx, AgentTileNode.tsx, AgentTile.tsx, and add AgentInspectPanel.tsx plus any CSS updates.
3. Verification: Run `npx playwright test tests/e2e/agent-tile-avatar.spec.ts tests/e2e/agent-inspect-panel.spec.ts` in /Users/georgepickett/openclaw-studio and confirm passing.
4. Commit: Commit with message “Milestone 1: Add inspect sidebar and simplify tiles”.

## Idempotence and Recovery

All steps are additive or refactors of existing UI. If any step fails, you can safely re-run it. If the sidebar causes layout issues, you can temporarily disable its rendering in page.tsx to restore the prior UI while debugging.

## Artifacts and Notes

Expected Playwright snippet for the Inspect panel test (example; keep actual assertions in code):

    expect(page.getByTestId("agent-inspect-panel")).toBeHidden();
    await page.getByTestId("agent-inspect-toggle").click();
    await expect(page.getByTestId("agent-inspect-panel")).toBeVisible();

## Interfaces and Dependencies

Update these interfaces and props with explicit signatures:

- In /Users/georgepickett/openclaw-studio/src/features/canvas/components/CanvasFlow.tsx, extend CanvasFlowProps with:
  onInspectTile: (id: string) => void

- In /Users/georgepickett/openclaw-studio/src/features/canvas/components/AgentTileNode.tsx, extend AgentTileNodeData with:
  onInspect: () => void

- In /Users/georgepickett/openclaw-studio/src/features/canvas/components/AgentTile.tsx, extend AgentTileProps with:
  onInspect: () => void

- In /Users/georgepickett/openclaw-studio/src/app/page.tsx, add local state:
  const [inspectTileId, setInspectTileId] = useState<string | null>(null)

- New component at /Users/georgepickett/openclaw-studio/src/features/canvas/components/AgentInspectPanel.tsx should accept:
  tile: AgentTile
  projectId: string
  models: GatewayModelChoice[]
  onClose: () => void
  onLoadHistory: () => void
  onModelChange: (value: string | null) => void
  onThinkingChange: (value: string | null) => void
  onDelete: () => void

Record any new props or helper functions added during implementation in this section as the plan evolves.

- Added onDelete prop to AgentInspectPanel for archive/restore action.
- CanvasFlow/AgentTile/AgentTileNode props trimmed to remove model/thinking/settings and pass only onInspect + send/edit handlers.

---

Plan change note: Initial plan authored to implement an Inspect sidebar and simplified tiles based on user direction on 2026-01-31.
