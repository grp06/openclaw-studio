# Replace the custom canvas with the ReactFlow-based canvas used in crabwalk

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This plan is governed by `/Users/georgepickett/clawdbot-agent-ui/.agent/PLANS.md` and must be maintained in accordance with it.

## Purpose / Big Picture

The current canvas pan/zoom behavior feels inconsistent and “buggy” because it is custom, uses CSS zoom, and depends on device-specific wheel semantics. After this change, the canvas will behave like the crabwalk monitor canvas: smooth, predictable pan/zoom, reliable zoom-to-fit, and consistent minimap/controls interactions. A user will be able to zoom with the mouse wheel, drag the background to pan, resize tiles cleanly, and see the zoom readout update accurately. This can be verified by running the app, interacting with the canvas, and running the updated Playwright tests that simulate wheel zoom, drag pan, and tile resize.

## Progress

- [x] (2026-01-27 00:00Z) Drafted ExecPlan based on the crabwalk ReactFlow implementation.
- [x] (2026-01-28 00:00Z) Replace the custom canvas with ReactFlow and keep zoom readout, tile drag, and tile resize working.
- [x] (2026-01-28 00:00Z) Update automated tests to match the new canvas behavior and verify zoom, pan, and resize.

## Surprises & Discoveries

- Observation: crabwalk’s monitor canvas uses `@xyflow/react` (ReactFlow) with `Controls`, `MiniMap`, and `Background`, and relies on its built-in pan/zoom behavior rather than custom math. The package exports `NodeResizer`, which we can use for resize handles inside custom nodes.
  Evidence: `/Users/georgepickett/crabwalk/src/components/monitor/ActionGraph.tsx` plus `/Users/georgepickett/crabwalk/node_modules/@xyflow/react/dist/esm/additional-components/NodeResizer/types.d.ts`.
- Observation: ReactFlow uses a named `ReactFlow` export (no default), and forcing selection via node props can cause update loops; letting ReactFlow own selection and syncing via callbacks avoided the runtime error.
  Evidence: `/Users/georgepickett/clawdbot-agent-ui/src/features/canvas/components/CanvasFlow.tsx` runtime error overlay during early test runs.

## Decision Log

- Decision: Use `@xyflow/react` (same library and defaults as crabwalk) for the canvas engine, and wire our tiles into custom ReactFlow nodes with `NodeResizer` for resizing.
  Rationale: This directly copies crabwalk’s proven pan/zoom behavior and removes our custom CSS-zoom transform path, which is the likely source of inconsistent UX.
  Date/Author: 2026-01-27, Codex.

## Outcomes & Retrospective

ReactFlow now drives the canvas with built-in pan/zoom, minimap, and controls; tile drag and resize update project state, and the header zoom readout stays in sync. The e2e suite now covers wheel zoom, background pan, and NodeResizer-based resizing on the new canvas.

## Context and Orientation

The current canvas lives in `/Users/georgepickett/clawdbot-agent-ui/src/app/page.tsx`, with the rendering handled by `/Users/georgepickett/clawdbot-agent-ui/src/features/canvas/components/CanvasViewport.tsx` and `/Users/georgepickett/clawdbot-agent-ui/src/features/canvas/components/CanvasMinimap.tsx`. The transform math lives in `/Users/georgepickett/clawdbot-agent-ui/src/features/canvas/lib/transform.ts`, and the tile UI is in `/Users/georgepickett/clawdbot-agent-ui/src/features/canvas/components/AgentTile.tsx`. The canvas zoom/offset state is stored in `/Users/georgepickett/clawdbot-agent-ui/src/features/canvas/state/store.tsx` as `CanvasTransform` with `zoom`, `offsetX`, and `offsetY`. The crabwalk canvas we want to copy is implemented with ReactFlow in `/Users/georgepickett/crabwalk/src/components/monitor/ActionGraph.tsx` using `ReactFlow`, `Controls`, `MiniMap`, and `Background`, with pan/zoom handled by the library and no custom CSS zoom logic.

In this repo, tile positions and sizes are stored in the project state and persisted via `/Users/georgepickett/clawdbot-agent-ui/src/lib/projects/client`. Any new canvas implementation must continue to update tile position and size in state so existing persistence and UI flows remain intact. The zoom readout in the header (`/Users/georgepickett/clawdbot-agent-ui/src/features/canvas/components/HeaderBar.tsx`) is currently derived from `state.canvas.zoom`, so the new canvas must keep that value updated as the user pans and zooms.

## Plan of Work

First, add ReactFlow (`@xyflow/react`) to the UI dependencies and import its base styles so the canvas engine renders and handles pointer interactions correctly. Next, replace the custom `CanvasViewport` and `CanvasMinimap` with a new `CanvasFlow` component that wraps a `ReactFlow` instance, matching crabwalk’s configuration (`Controls`, `MiniMap`, `Background`, `fitView`, `minZoom`, `maxZoom`). Then adapt the tile UI to render as a custom ReactFlow node: remove the absolute positioning from `AgentTile` and instead drive width and height via the ReactFlow node style, while adding a `NodeResizer` to keep tile resizing functional. Wire node drag and resize updates to dispatch tile position/size updates into the canvas store. Finally, update the zoom controls and readout to use the ReactFlow viewport state (x, y, zoom), and update or add Playwright tests to verify wheel zoom, drag pan, and resize behavior on the new canvas.

## Concrete Steps

Work in `/Users/georgepickett/clawdbot-agent-ui`.

1) Add ReactFlow as a dependency and include its stylesheet. Update `package.json` to include `@xyflow/react` (use the same major version as crabwalk, `^12.10.0`), then add an import of `@xyflow/react/dist/style.css` in a global entry such as `/Users/georgepickett/clawdbot-agent-ui/src/app/globals.css` or a new canvas component that is guaranteed to be loaded on the client.

2) Create a new canvas component, for example `/Users/georgepickett/clawdbot-agent-ui/src/features/canvas/components/CanvasFlow.tsx`, that wraps `ReactFlowProvider` and `ReactFlow` and exposes the same outward props as the current `CanvasViewport`, plus a new `onInit` callback to pass the `ReactFlowInstance` back up to `/Users/georgepickett/clawdbot-agent-ui/src/app/page.tsx`. Use `nodeTypes` to register a custom node component (see next step). Configure `ReactFlow` similarly to crabwalk: `fitView`, `fitViewOptions={{ padding: 0.2 }}`, `minZoom={0.1}`, `maxZoom={2}`, and include `Background`, `Controls`, and `MiniMap` so the core interaction model matches crabwalk.

3) Add a custom node component for tiles, for example `/Users/georgepickett/clawdbot-agent-ui/src/features/canvas/components/AgentTileNode.tsx`. This component should render the existing `AgentTile` UI, but without absolute left/top positioning. Use the `NodeResizer` from `@xyflow/react` inside this component to provide resize handles. Configure `NodeResizer` with `minWidth` and `minHeight` matching the existing `MIN_SIZE` (560 x 440), and wire `onResizeEnd` to dispatch a tile size update into the store using the new width and height provided by `NodeResizer`. Ensure the root element still includes `data-tile` so existing tests can find it.

4) Refactor `/Users/georgepickett/clawdbot-agent-ui/src/features/canvas/components/AgentTile.tsx` so it no longer sets `left` and `top` inline styles. It should instead rely on the ReactFlow node wrapper for position and only set `width` and `height` based on `tile.size`. Remove the custom drag handlers (`handleDragStart`) so ReactFlow is the only drag system, and add a stable drag handle element on the tile header (for example by adding a `data-drag-handle` attribute) so ReactFlow can be configured to drag only from the header without interfering with text inputs.

5) Replace usage of `CanvasViewport` and `CanvasMinimap` in `/Users/georgepickett/clawdbot-agent-ui/src/app/page.tsx` with the new `CanvasFlow` component. Keep the existing `viewportRef` for size measurement but wire `CanvasFlow` to expose the ReactFlow instance via `onInit`. Update the zoom handlers (`handleZoomIn`, `handleZoomOut`, `handleZoomReset`, `handleZoomToFit`) to call ReactFlow’s `zoomIn`, `zoomOut`, `setViewport`, and `fitView` respectively, and then update the canvas store’s `zoom`, `offsetX`, and `offsetY` using `useOnViewportChange` (or `onMove`) so the header readout remains accurate.

6) Update `CanvasFlow` to keep store state and ReactFlow in sync. Use `onNodesChange` (and/or `onNodeDragStop`) to dispatch tile position updates when a node finishes dragging, `onNodeClick` or `onSelectionChange` to update the selected tile, and `onPaneClick` to clear selection. Use `onMove` or `useOnViewportChange` to call `onUpdateTransform({ zoom, offsetX: x, offsetY: y })` whenever the viewport changes, so `state.canvas` continues to drive readouts and placement calculations.

7) Update or add Playwright tests to reflect the new canvas behavior. The existing tests in `/Users/georgepickett/clawdbot-agent-ui/tests/e2e/canvas-zoom-pan.spec.ts` should continue to verify that a wheel event changes the zoom readout and affects tile bounds, but adjust event payloads or selectors if ReactFlow introduces different DOM structure. Add a new test that drags the canvas background to pan and asserts that a tile’s bounding box moves relative to the viewport. Add a resize test that drags a NodeResizer handle and asserts the tile bounding box width/height changes. Keep these tests focused on user-visible behavior rather than implementation details.

## Validation and Acceptance

Acceptance is met when the canvas behaves like crabwalk’s: wheel zoom is smooth and consistent, drag-to-pan works across devices, tiles drag and resize without jitter, the minimap and controls are functional, and the zoom readout updates as the viewport changes.

For each milestone, follow this verification workflow.

Milestone 1: ReactFlow canvas with draggable tiles and viewport syncing.

1. Tests to write: Update `/Users/georgepickett/clawdbot-agent-ui/tests/e2e/canvas-zoom-pan.spec.ts` to assert the zoom readout changes after a wheel event on the canvas root, and add a new test `pan-drag-shifts-tiles` in the same file that drags the canvas background and verifies the tile’s bounding box moves relative to its previous position.
2. Implementation: Add `@xyflow/react`, create `CanvasFlow`, hook it into `page.tsx`, and refactor `AgentTile` to be usable in a ReactFlow node. Use `onMove` (or `useOnViewportChange`) to keep `state.canvas` in sync.
3. Verification: Run `npm run e2e -- tests/e2e/canvas-zoom-pan.spec.ts` and confirm the new tests fail before changes and pass after the ReactFlow integration is complete.
4. Commit: After tests pass, commit with the message `Milestone 1: ReactFlow canvas and viewport sync`.

Milestone 2: Tile resizing via NodeResizer and persistence.

1. Tests to write: Add `resize-handle-updates-tile-size` to `/Users/georgepickett/clawdbot-agent-ui/tests/e2e/canvas-zoom-pan.spec.ts` (or a new `canvas-resize.spec.ts`) that drags a resize handle on a tile and asserts its bounding box width and height change by at least a small threshold.
2. Implementation: Add `AgentTileNode` with `NodeResizer`, wire `onResizeEnd` to update tile size in the store, and ensure tile size persists on re-render by mapping node width/height from `tile.size`.
3. Verification: Run `npm run e2e -- tests/e2e/canvas-zoom-pan.spec.ts` (or the new file) and confirm the resize test fails before the change and passes after.
4. Commit: After tests pass, commit with the message `Milestone 2: Tile resizing with NodeResizer`.

## Idempotence and Recovery

These steps are safe to run multiple times because dependency changes are additive and all code edits are deterministic. If ReactFlow integration causes regressions, revert to the previous commit boundary at the end of each milestone, or temporarily re-enable `CanvasViewport` by restoring its usage in `page.tsx`. If a test becomes flaky due to interaction timing, increase Playwright’s drag step delays or wait conditions rather than disabling the test.

## Artifacts and Notes

When validating, capture short command outputs in this section (for example, the final lines of `npm run e2e` showing the pass/fail summary). Keep any terminal transcripts short and focused on confirming success.

- `npm run e2e -- tests/e2e/canvas-zoom-pan.spec.ts`
  - 4 passed (4.1s)

## Interfaces and Dependencies

Use `@xyflow/react` for the canvas engine, including `ReactFlow`, `ReactFlowProvider`, `Controls`, `MiniMap`, `Background`, `NodeResizer`, and `useOnViewportChange` or `onMove` events to observe viewport changes. The custom node component (`AgentTileNode`) should accept `data` containing the `AgentTile` plus callbacks for selection, move, resize, rename, and send actions. The `CanvasFlow` component should accept `tiles`, `selectedTileId`, and callback props mirroring the current `CanvasViewport` API, and should expose a `ReactFlowInstance` through `onInit` so the header can trigger `zoomIn`, `zoomOut`, `setViewport`, and `fitView`.

Changes made: Initial plan drafted based on crabwalk’s ReactFlow canvas and the current clawdbot-agent-ui canvas structure.
