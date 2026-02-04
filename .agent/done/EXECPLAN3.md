# Refactor Canvas Zoom/Pan for a Figma-like Agent Workspace

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

Maintain this document in accordance with `.agent/PLANS.md` (repository root).

## Purpose / Big Picture

After this change, the Agent UI canvas supports a “real canvas” interaction model that feels closer to Figma: zoom is anchored to the cursor (so the point under your mouse stays under your mouse while zooming), trackpad pinch zoom works, mouse wheel can zoom (without breaking trackpad two-finger pan), and canvas panning is smooth and predictable. Managing many agent tiles becomes practical because you can quickly zoom to inspect a tile, zoom out for overview, and use a minimap to navigate large layouts.

You can see it working by starting the dev server, creating/opening a workspace with multiple agent tiles, then pinch-zooming on a trackpad (the point under the cursor stays pinned), using a mouse wheel to zoom, two-finger scrolling to pan, dragging empty canvas space to pan, and using a minimap overlay to jump around when tiles are spread out.

## Progress

- [x] (2026-01-27 00:00Z) Audited current canvas transform/zoom behavior and drafted ExecPlan.
- [x] (2026-01-27) Milestone 1: Add transform math utilities + unit tests that define cursor-anchored zoom behavior.
- [x] (2026-01-27) Milestone 2: Implement wheel/pinch zoom + trackpad pan with rAF throttling; keep existing buttons working.
- [x] (2026-01-27) Milestone 3: Add minimap (overview) and “zoom to fit” navigation helpers for large canvases.
- [x] (2026-01-27) Milestone 4: Add Playwright interaction coverage and polish (performance + edge cases).

## Surprises & Discoveries

(To be filled in during implementation.)

## Decision Log

- Decision: Implement the interaction model without introducing a third-party canvas/graph library (no React Flow / no D3 zoom).
  Rationale: The current UI already has tile layout and drag/resize behavior; the biggest UX gap is transform math + input handling. Keeping it in-house minimizes dependency surface and keeps the behavior easy to tailor.
  Date/Author: 2026-01-27 / Codex

- Decision: Use “zoom to cursor” math and multiplicative zoom deltas (exponential scaling) rather than linear +/- 0.1 steps for wheel/pinch.
  Rationale: Cursor-anchored zoom is the core Figma-like affordance; multiplicative zoom feels consistent across zoom levels and matches common canvas UX expectations.
  Date/Author: 2026-01-27 / Codex

- Decision: Default input mapping: trackpad two-finger scroll pans; trackpad pinch (wheel event with ctrlKey) zooms; mouse wheel zooms when it appears to be a wheel (line-based deltas) and otherwise pans.
  Rationale: Browsers do not reliably distinguish “mouse wheel” vs “trackpad scroll” in a principled way. This heuristic keeps trackpad pan usable while still enabling mouse wheel zoom without requiring keyboard shortcuts.
  Date/Author: 2026-01-27 / Codex

- Decision: Trackpad pan subtracts wheel deltas from offsets (scroll down reveals lower world coordinates).
  Rationale: Matches standard scroll direction expectations while keeping zoom anchor math unchanged.
  Date/Author: 2026-01-27 / Codex

- Decision: `zoomToFit` accepts the current transform to preserve state when there are no tiles.
  Rationale: The helper needs a fallback transform; passing it in keeps the helper pure and avoids hidden defaults.
  Date/Author: 2026-01-27 / Codex

## Outcomes & Retrospective

- Outcome: Canvas interactions now support cursor-anchored zoom (wheel/pinch), smooth pan, minimap navigation, and zoom-to-fit, with shared transform math and coverage in unit/e2e tests.

## Context and Orientation

This repo is a Next.js App Router UI. The “canvas” is implemented as a full-screen `CanvasViewport` that renders multiple draggable/resizable “agent tiles”.

Relevant files include `src/features/canvas/components/CanvasViewport.tsx` (canvas surface + CSS transform), `src/features/canvas/components/AgentTile.tsx` (tile drag/resize; pointer deltas are divided by zoom), `src/features/canvas/components/HeaderBar.tsx` (zoom controls + zoom readout), `src/features/canvas/state/store.tsx` (the `CanvasTransform` state and `setCanvas` reducer action), and `src/app/page.tsx` (wires state to the viewport and header).

Current behavior (as of 2026-01-27) is that zoom only changes via header +/- buttons and is applied as CSS `translate(offsetX, offsetY) scale(zoom)` with `transformOrigin: "0 0"`. Panning is pointer-drag on empty canvas space only (no trackpad two-finger pan and no wheel support). Zoom is not cursor-anchored; it effectively zooms around the top-left origin of the inner container.

Definitions used in this plan: “world coordinates” are the coordinate space where tile positions and sizes are stored (tile `{ position: {x,y}, size: {width,height} }` in `AgentTile` data). “viewport/screen coordinates” are CSS pixels relative to the visible canvas viewport element. The transform maps world → screen as `screen = offset + zoom * world`, where `offset` is `{offsetX, offsetY}` in screen pixels.

This plan also uses a few browser/DOM terms. `requestAnimationFrame` (abbreviated “rAF” below) is a browser API that runs a callback before the next repaint; we use it to coalesce many rapid pointer/wheel events into at most one state update per frame. A “passive” event listener is one that cannot call `preventDefault()`; we must use a non-passive `wheel` listener so we can prevent the browser’s own page zoom behavior during trackpad pinch. A `WheelEvent`’s `deltaMode` describes whether `deltaX/deltaY` are in pixels (typical trackpads) or lines (typical mouse wheels).

## Plan of Work

This change is mostly about (1) getting transform math correct and testable, and (2) implementing input handling that feels intentional and smooth under real device behavior (mouse wheels, trackpads, pinch gestures). The work proceeds in small steps so that the core math is locked down with tests before wiring up user input.

Milestone 1 creates a small, pure “canvas transform math” module and unit tests that specify cursor-anchored zoom and viewport/world conversions. This is the foundation; everything else builds on it.

Milestone 2 wires wheel/pinch/pan into `CanvasViewport` using non-passive event listeners (so we can `preventDefault()` to stop browser-page zoom during pinch) and rAF throttling (so transform updates do not cause jank). Existing header zoom buttons are updated to use the same transform math (zooming around viewport center).

Milestone 3 adds an overview minimap that visualizes tile bounds and the current viewport rectangle, plus a “zoom to fit” action that frames all tiles with padding. This is the “manage many tiles” accelerator.

Milestone 4 adds Playwright coverage for the interaction contract and cleans up edge cases (clamping, empty canvas, huge deltas, selection behavior), keeping the implementation simple but robust.

## Concrete Steps

All commands below run from:

    /Users/georgepickett/clawdbot-agent-ui

### Milestone 1: Transform Math + Unit Tests

Acceptance for this milestone is that a pure function can compute a new `CanvasTransform` that zooms at a given viewport point (cursor-anchored), preserving the world point under the cursor across zoom changes, and that conversions between screen and world coordinates are correct and covered by unit tests.

1. Create `src/features/canvas/lib/transform.ts` (new).

   Implement these exported functions (keep them pure and small). `clampZoom(zoom: number): number` clamps to a chosen range (decide in this milestone; the tests encode the final decision). `screenToWorld(transform, screen)` computes `{ (screen.x - offsetX) / zoom, (screen.y - offsetY) / zoom }` and `worldToScreen(transform, world)` computes `{ offsetX + world.x * zoom, offsetY + world.y * zoom }`. `zoomAtScreenPoint(transform, nextZoomRaw, screenPoint)` computes the world point under `screenPoint` using `screenToWorld`, clamps `nextZoomRaw`, then sets offsets so the same world point maps back to `screenPoint` at the clamped zoom via `nextOffsetX = screenPoint.x - world.x * nextZoom` and `nextOffsetY = screenPoint.y - world.y * nextZoom`, returning `{ zoom: nextZoom, offsetX: nextOffsetX, offsetY: nextOffsetY }`.

   Keep `CanvasTransform` imported from `src/features/canvas/state/store.tsx` (do not redefine the type). Choose a zoom clamp range appropriate for reading tile content; a reasonable starting point is `minZoom=0.25` and `maxZoom=3.0`, but the tests should encode the final decision.

2. Add unit tests in `tests/unit/canvasTransform.test.ts` (new).

   Write these tests first and confirm they fail until you implement the functions. Add a round-trip test that asserts `worldToScreen` then `screenToWorld` are inverses within float tolerance (for example using `{ zoom: 1.5, offsetX: 120, offsetY: -80 }`). Add a cursor-anchored zoom test that asserts `zoomAtScreenPoint` preserves the world point under the cursor within tolerance. Add a clamp test that asserts values below/above min/max are clamped appropriately.

3. Run:

       npm run test -- tests/unit/canvasTransform.test.ts

   Expect all new tests to pass.

4. Commit:

       git add -A
       git commit -m "Milestone 1: Add cursor-anchored canvas transform math"

### Milestone 2: Wheel/Pinch Zoom + Trackpad Pan (Smooth)

Acceptance for this milestone is that trackpad pinch zoom works (browser page zoom does not trigger while the cursor is over the canvas), mouse wheel zoom works, trackpad two-finger scroll pans the canvas (so you can navigate without drag), dragging empty canvas space still pans (existing behavior), and panning/zooming feels smooth (no stutter from excessive state updates).

1. Update `src/features/canvas/components/CanvasViewport.tsx` to handle wheel and pinch.

   Attach a native `wheel` event listener to the viewport element with `{ passive: false }` so `preventDefault()` reliably works. On wheel events, compute `screenPoint` relative to the viewport element (use `getBoundingClientRect()` and `event.clientX/Y`). Decide whether the wheel event is zoom vs pan: treat `event.ctrlKey === true` as zoom (common trackpad-pinch signal), otherwise treat line-based deltas (`event.deltaMode`) as zoom (typical mouse wheel), and treat remaining pixel-based deltas as pan (typical trackpad scroll). When zooming, use multiplicative scaling (for example `nextZoom = transform.zoom * Math.exp(-event.deltaY * ZOOM_SENSITIVITY)`) and apply `zoomAtScreenPoint(transform, nextZoom, screenPoint)` from Milestone 1. When panning, update offsets by wheel deltas; verify the sign feels like direct manipulation and record the final choice in the Decision Log.

   For smoothness, do not call `onUpdateTransform` on every raw wheel/pointer event. Throttle to animation frames by storing a pending transform update in a ref and scheduling a single `requestAnimationFrame` to apply the latest pending transform. Keep the existing pointer-drag pan, but apply the same rAF throttling to pointermove updates so panning stays smooth with many tiles.

2. Update `src/app/page.tsx` zoom handlers to use the new math and feel consistent.

   Replace linear `zoom +/- 0.1` with multiplicative steps (for example `zoom *= 1.1` and `zoom /= 1.1`) using the same clamp. Anchor button-based zoom to the viewport center (not cursor) for predictability; ensure the handler computes a viewport-center screen point and calls `zoomAtScreenPoint` rather than directly patching zoom. Avoid creating a second transform path: all zoom changes (wheel/pinch/buttons) should go through the same math utility so behavior stays consistent.

3. Manually verify this behavior and record brief observations under `Artifacts and Notes`. Start the dev server (`npm run dev`), open the app, create/open a workspace, create several agent tiles, then pinch-zoom with a trackpad (verify browser page zoom does not happen while over the canvas and the point under the cursor remains pinned), two-finger scroll (verify pan), and mouse wheel (verify zoom, using a mouse rather than a trackpad).

4. Add or update Playwright coverage (keep it stable/deterministic).

   Extend `tests/e2e/canvas-smoke.spec.ts` or add `tests/e2e/canvas-zoom-pan.spec.ts` (preferred) by mocking `/api/projects` to return one workspace with one tile positioned away from the origin.

   Add one test that dispatches wheel events over the canvas surface and asserts the zoom percentage text changes. Add a second test that dispatches a trackpad-like wheel (pixel deltas, no ctrlKey) and verifies the tile’s screen position changes by comparing `boundingBox()` before and after; `boundingBox()` is Playwright’s API for reading an element’s rendered rectangle in CSS pixels. If Playwright wheel synthesis cannot reliably reproduce the intended wheel characteristics (especially `deltaMode`), focus on the zoom readout plus a clear bounding box change and document the limitation in `Artifacts and Notes`. If needed, add a stable `data-*` attribute on the canvas viewport element to query it reliably (for example `data-canvas-viewport`).

5. Run:

       npm run test
       npm run e2e

6. Commit:

       git add -A
       git commit -m "Milestone 2: Add wheel/pinch zoom and smooth pan"

### Milestone 3: Minimap + Zoom to Fit

Acceptance for this milestone is that a minimap appears when there is at least one tile, it shows tile rectangles and the current viewport rectangle, clicking (or dragging) in the minimap recenters the viewport to that location, and a “Zoom to Fit” action frames all tiles with padding.

1. Add `src/features/canvas/components/CanvasMinimap.tsx` (new).

   Keep the minimap simple and SVG-based. It takes `tiles: AgentTile[]`, `transform: CanvasTransform`, `viewportSize: { width: number; height: number }` (measured from `CanvasViewport` via a `ResizeObserver`, a browser API that notifies you when an element’s size changes), and `onUpdateTransform(patch: Partial<CanvasTransform>): void`. It computes the world bounds of all tiles using tile position and size, adds padding in world units, then computes the current viewport world rectangle using the transform (`worldLeft = -offsetX / zoom`, `worldTop = -offsetY / zoom`, `worldWidth = viewportWidth / zoom`, `worldHeight = viewportHeight / zoom`). Render an SVG with a `viewBox` matching the content bounds; `viewBox` is the SVG coordinate system used to map world units into the minimap panel. Draw tile rects and the viewport rect. On click/drag in the minimap, convert minimap coordinates back to a world point and update offsets so that world point becomes the viewport center.

2. Wire minimap into `src/app/page.tsx` (or into `CanvasViewport` as an overlay).

   Place it as a floating panel in a corner (for example bottom-right) with `pointer-events-auto` and a small footprint so it doesn’t interfere with tiles.

3. Add “Zoom to Fit” button to `src/features/canvas/components/HeaderBar.tsx`.

   Implement a helper in `src/features/canvas/lib/transform.ts` named `zoomToFit(tiles: AgentTile[], viewportSize: { width: number; height: number }, paddingPx: number): CanvasTransform`. If there are no tiles it should return the current transform unchanged. Otherwise it should compute a zoom that fits all tile bounds within the viewport (minus padding), clamp that zoom, and compute offsets so the bounds are centered.

4. Tests:

   Add `tests/unit/canvasZoomToFit.test.ts` (new) to assert that `zoomToFit` produces a transform where the fitted bounds map within the viewport with padding.

5. Run:

       npm run test
       npm run e2e

6. Commit:

       git add -A
       git commit -m "Milestone 3: Add minimap and zoom-to-fit"

### Milestone 4: Polish + Edge Cases

Acceptance for this milestone is that there are no regressions in tile drag/resize under zoom, canvas interactions remain responsive with many tiles, and edge cases are handled without mystery behavior (empty canvas, extreme wheel deltas, zoom clamping).

1. Verify tile interactions under zoom by dragging a tile while zoomed in and out (movement tracks cursor correctly) and resizing a tile while zoomed in and out (size changes are proportional and clamped).

2. Keep performance guardrails in place: ensure wheel/pan uses rAF throttling (no synchronous state update loops), add `will-change: transform;` to the scaled inner container if needed, and consider adding `overscroll-behavior: none;` and `touch-action: none;` to the canvas surface so browser scroll/zoom gestures do not fight the canvas.

3. Expand Playwright tests only as far as they remain deterministic.

4. Run final verification:

       npm run lint
       npm run typecheck
       npm run test
       npm run e2e

5. Commit:

       git add -A
       git commit -m "Milestone 4: Polish canvas interactions and add coverage"

## Validation and Acceptance

This work is accepted when, on a developer machine, the canvas supports cursor-anchored zoom (pinch or wheel) and the world point under the cursor remains stable while zooming; trackpad two-finger scroll pans (not zoom) while mouse wheel zoom works; existing header zoom controls still work and feel consistent with wheel/pinch zoom; a minimap provides an overview and navigation for canvases with many tiles; and `npm run test` and `npm run e2e` pass, with the new unit tests failing before implementation and passing after.

## Idempotence and Recovery

The transform refactor is safe to apply incrementally because it is additive first (pure math module + tests), then wiring changes. If input handling becomes confusing or flaky, revert to the last milestone commit and re-apply one interaction at a time (wheel zoom first, then trackpad pan, then minimap). Keep the old header zoom buttons functional throughout so the UI remains usable even while iterating.

## Artifacts and Notes

Record short evidence snippets here during implementation, such as unit test failure output that guided a math fix, a brief note on the final chosen zoom clamp range and why, and any device-specific observations (for example “Chrome pinch zoom sets ctrlKey=true on wheel events on macOS”).

- 2026-01-27: Added transform math utils + tests. Clamp range set to 0.25–3.0 to keep tiles readable while allowing overview. `npm run test -- tests/unit/canvasTransform.test.ts` passes.
- 2026-01-27: Added wheel/pinch zoom + rAF throttling, updated header zoom anchoring, and added Playwright coverage. Playwright wheel events always surfaced as line-based deltas, so trackpad-pan simulation was unreliable; tests cover zoom readout changes and tile bounds updates instead. `npm run test` and `npm run e2e` pass.
- 2026-01-27: Added SVG minimap + zoom-to-fit helper/button, plus `zoomToFit` unit tests. `npm run test` and `npm run e2e` pass.
- 2026-01-27: Added overscroll/touch-action guardrails and `will-change: transform` on the scaled canvas content; lint/typecheck/test/e2e pass.
- 2026-01-27: Switched canvas scaling to use CSS `zoom` when supported (fallback to transform scale) to keep zoomed text crisp.

## Interfaces and Dependencies

No new third-party dependencies are required for this plan. The core interfaces are `CanvasTransform` from `src/features/canvas/state/store.tsx`, new pure transform helpers in `src/features/canvas/lib/transform.ts`, and a minimap component in `src/features/canvas/components/CanvasMinimap.tsx`. The implementation must keep a single source of truth for transform math by routing all zoom changes (wheel/pinch/buttons/zoom-to-fit) through `src/features/canvas/lib/transform.ts`.

Plan creation note (2026-01-27 00:00Z): Created this ExecPlan after auditing current zoom/pan behavior in `CanvasViewport.tsx`, `AgentTile.tsx`, and `page.tsx`, and after researching common canvas UX conventions (cursor-anchored zoom, pinch zoom, scroll-to-pan, minimap + zoom-to-fit) to keep the plan self-contained and beginner-executable.
