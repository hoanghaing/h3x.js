# Milestone 3: 2D plan editing (`h3x/plan`) — design

Date: 2026-11-16. Status: reviewed, awaiting user approval.

## Intent

h3x.js is a logic library for a realtime, XML-backed house editor: every edit event updates the
`H3xDocument`, so the XML (`doc.toXML()`) and every view are current after each event. h3x.js
ships classes, methods and mouse / keyboard interaction. It ships **no form inputs or editor
chrome**; h3xEditor (separate repo, milestone 5) is the UI/UX-heavy reusable editor that attaches
inputs, panels and shortcuts on top.

Milestone 3 adds `h3x/plan`: an SVG top-down plan where the user selects and drags nodes and
walls, sees live dimensions, and sets wall lengths through a method. The plan and an `H3xViewer`
can share one document, so 2D edits show in 3D immediately (this already works through
`doc.on('change')`). It must be demonstrable on the example page before milestone 4 starts.

## Goals

- `H3xPlan`: renders a document's first floor as SVG in a container element, follows every
  document change, owns the view transform (pan / zoom / fit) and the selection.
- A tool system: `H3xPlan` delegates pointer and keyboard input to the active tool.
  Milestone 3 ships one tool, `SelectEditTool`; milestone 4 adds placement tools.
- Live editing with one undo step per gesture, and live validation feedback.
- Pure, DOM-free helpers for the maths (view transform, hit testing, snapping, dimension
  layout), unit-tested under vitest `node`.
- Example page: plan and 3D side by side on the same document, plus a throwaway length input
  for the demo.

## Non-goals

- Adding or removing nodes / walls (topology stays fixed, as in core).
- Dragging openings or items (milestone 4). They are drawn, not edited.
- Any input box, panel, toolbar or context menu inside the library.
- Binding undo / redo shortcuts (the editor decides key bindings for those).
- Multiple floors, rendering anything but `floors[0]`.
- Framework wrappers (`h3x/vue` is milestone 6).

## Anti-goals (failure even if it "works")

- A cancelled drag leaving an entry on the redo stack, or a drag producing many undo steps.
- `h3x/plan` importing `three` (it must work for users who never install three).
- `src/core` importing DOM APIs or anything from `plan`.
- Re-creating SVG elements on every change (breaks pointer capture mid-drag and element
  identity that callers hold on to).
- The document ending in an invalid state because of a drag (rejected moves are never committed).

## Constraints

- TypeScript strict, conventions in `CONTRIBUTING.md` (TDD, pure commands, `GEOM_TOL` for all
  geometry comparisons, no module-level mutable state, typed errors never swallowed).
- No new runtime dependencies. Plain DOM + SVG.
- New package subpath `h3x/plan` (`src/plan/index.ts`): add to `vite.config.ts` lib entries and
  `package.json` `exports`; it must not pull in `three` (check with the existing package test).
- Plan coordinates are `(x, y)` meters with +y up (same convention as 3D top view, not mirrored);
  SVG y-down is handled by the view transform.
- Pointer events (mouse, pen and touch through one path).

## Approaches considered

1. **One `H3xPlan` class owning rendering, camera, selection and editing.** Fastest to write,
   but milestone 4's placement drags would land in the same class and the gestures would
   tangle. Rejected.
2. **`H3xPlan` (rendering, view transform, selection) + pluggable tools.** Chosen by the user.
   Input handling lives in tool objects; the editor switches with `plan.setTool(...)`. Maths is
   in pure functions so it is testable without a DOM.
3. Dropped early: full SVG re-render per change (loses the dragged element, slow on big plans);
   Canvas (roadmap says SVG); d3 / svg.js (new dependency for little gain).

Both remaining approaches use **retained SVG**: one element (group) per node / wall / room /
opening, kept for the entity's lifetime, attributes updated on change — the same identity rule
as `H3xScene` meshes.

## Design

### Module layout

```
src/plan/
  index.ts            public exports
  H3xPlan.ts          the class: SVG root, layers, subscriptions, view, selection, events
  view.ts             pure: view transform (plan <-> screen), zoom about a point, fit to bounds
  render/             pure-ish builders returning attribute data per entity (walls, rooms,
                      openings, nodes, dimensions, grid); H3xPlan applies them to elements
  hit.ts              pure: what is under a screen point (node > dimension label > wall > room)
  snap.ts             pure: grid snap and axis alignment to other nodes
  tools/
    Tool.ts           Tool interface + ToolContext
    SelectEditTool.ts select, drag node / wall, arrow-key nudge, Esc cancel, dimension dblclick
```

Mitered wall outlines: `computeWallCorners` / `computeJoins` in `src/three/walls/joins.ts` do
not depend on three. Move them to a shared internal module (for example
`src/shared/walls/joins.ts`, not part of the public `core` API) and import from both `three`
and `plan`, so the plan draws exactly the outlines the 3D view extrudes.

### `H3xPlan` public API (shape, names may be refined by the builder)

```ts
new H3xPlan(container: HTMLElement, doc: H3xDocument, opts?: H3xPlanOptions)

interface H3xPlanOptions {
  grid?: boolean;                 // default true
  snap?: { grid?: number; align?: boolean }; // default { grid: 0.05, align: true }
  tool?: Tool;                    // default new SelectEditTool()
  classPrefix?: string;           // default 'h3x-plan'
}

plan.svg: SVGSVGElement
plan.fitToContent(padding?)       plan.setView({ center, scale })   plan.view (read-only)
plan.planToScreen(p) / plan.screenToPlan(p)
plan.selection: Selection | null  // { kind: PlanKind, id }
// PlanKind = 'node' | 'wall' | 'room' | 'opening' | 'item'. Defined in full now so milestone 4
// can make openings / items selectable in SelectEditTool without a breaking change. In M3
// only nodes and walls are selectable; clicking a room, opening or item clears the selection.
// Hit testing and layers already cover all five kinds (openings and items get hit areas).
plan.select(sel | null)
plan.setTool(tool) / plan.tool
plan.setWallLength(wallId, length, { anchor?: 'a' | 'b' }): { ok: true } | { ok: false; issues }
plan.on('selectionchange' | 'lengthEditRequest' | 'issues', fn): () => void
plan.getElement(kind, id): SVGGElement | undefined
plan.dispose()                    // idempotent; removes listeners, the SVG, the doc subscription
```

- `lengthEditRequest` payload: `{ wallId, length, anchor: 'a' | 'b', anchorRect }`
  (`anchorRect` = screen rect of the dimension label, `{ x, y, width, height }`) so the editor
  can place its own input there.
- Anchor choice *(designer's call after review)*: `a` / `b` is just file order, so the plan
  picks the end that should stay put and puts it in the payload as a suggestion. Rule: keep
  the end that more walls meet at; on a tie keep the end farther from the double-click point;
  if still tied, `'a'`. `plan.setWallLength` uses the same rule when `anchor` is omitted. The
  editor can pass the suggestion back unchanged or override it.
- Two kinds of issues *(user's decision: persistent marking)*:
  - **Rejected step** — a drag step, arrow nudge or `plan.setWallLength` call that the
    document refused. The offending entities flash briefly (`…-rejected` class).
  - **Standing placement problems** — after every document change (and on construction) the
    plan runs `validatePlacements()` (and `validateLayout()`) and keeps every entity named in
    an issue marked with a persistent `…-invalid` class until a later change fixes it. Example:
    a wall gets shorter and a window now sticks out of it — the window stays red.
  - `issues` event payload: `{ rejected: Issue[]; standing: Issue[] }`, fired whenever either
    list changes. `plan.issues` gives the current standing list. Validation runs once per
    document change (one floor of a house: cheap enough during drags).
- Elements carry `data-h3x-kind` / `data-h3x-id`; styling is CSS via class names
  (`h3x-plan-wall`, `…-selected`, `…-invalid`, …). A small default stylesheet is injected once
  per plan root (scoped under the root class), overridable by the host page.

### Rendering

Layers bottom to top: grid, rooms (fill + name + area at the polygon's label point), walls
(mitered outline polygons, filled), openings (door: gap + leaf + swing arc respecting `flip`;
window: gap + three lines), items (footprint rectangle outline, read-only), dimensions, nodes
(handles, visible on hover / selection), overlay (snap guides, invalid flash).

- Grid: 1 m major and 0.1 m minor lines, minor lines hidden when they would be closer than a
  few pixels.
- Dimensions: the selected wall shows its length; while dragging a node, every wall touching
  it shows its live length; with nothing selected, exterior walls show their lengths (*builder
  may tune which walls show at rest*). Length is the centre-line length, shown with 2 decimals
  in meters.
- Line widths, handle sizes and label sizes are constant in screen pixels (use
  `vector-effect: non-scaling-stroke` or recompute on zoom).
- Updates: on `doc` change, update only affected entities, but recompute mitered corners for
  walls sharing a node with any changed node / wall (corners depend on neighbours).

### View

- Wheel zooms about the cursor (clamped scale range); dragging empty space pans (also middle
  button); pinch-zoom with two pointers. `fitToContent()` frames all walls with padding.
- The SVG resizes with its container (`ResizeObserver` when available, like `H3xViewer`).

### Tools

```ts
interface Tool {
  activate(ctx: ToolContext): void;
  deactivate(): void;            // must cancel any gesture in progress
  onPointerDown?(e: PlanPointerEvent): void;
  onPointerMove?(e: PlanPointerEvent): void;
  onPointerUp?(e: PlanPointerEvent): void;
  onDoubleClick?(e: PlanPointerEvent): void;
  onKeyDown?(e: KeyboardEvent): boolean; // true = handled
}
// PlanPointerEvent: native event + plan point + hit result
// ToolContext: doc, plan (selection, view, hit, snap, emit issues, overlay guides)
```

Pan / zoom is handled by `H3xPlan` itself when the tool does not consume the pointer-down
(empty-space drag, wheel). Keyboard events are taken while the SVG has focus (`tabindex="0"`).

### `SelectEditTool` behaviour

- **Click** a node or wall: select it. Click empty space: clear selection.
- **Drag a node**: each pointer move computes the target from the plan point, applies snapping
  (grid 5 cm; alignment to the x or y of other nodes within a few screen pixels, guide line
  drawn; holding Alt disables snapping), then
  `doc.tryExecute(moveNode(id, target), { coalesceKey })`. On rejection the node stays at its
  last valid position and `issues` fires. Pointer-up: `doc.endCoalesce()`.
- **Drag a wall**: same flow with `moveWall`; the delta is computed against the wall's
  *current* position each move (the command is relative). Snap the wall's offset along its
  normal to the grid.
- **Esc during a drag**: revert to the state before the gesture with no redo entry (needs the
  core addition below). Esc with no gesture clears selection.
- **Arrow keys** with a selection: nudge 1 cm (Shift: 10 cm) through the same commands; each
  key press is its own undo step. For a wall, only the component along its normal applies.
- **Double-click a dimension label**: emit `lengthEditRequest`; the tool never shows an input.
- A small movement threshold (a few pixels) separates click from drag.

### Core additions (small, with tests, per CONTRIBUTING "Adding a command")

1. `setWallLength(wallId, length, { anchor?: 'a' | 'b' })` — default `'a'` keeps today's
   behaviour; `'b'` keeps node b fixed and moves a. README Commands section updated.
2. Cancelling a coalesced gesture: `doc.cancelCoalesce(key)` reverts the changes recorded
   under the currently open coalesce group **only if that group's key equals `key`**, emits a
   change event (reason e.g. `'cancel'`, or reuse `'undo'` — builder's call, document it), and
   leaves the redo stack as it was before the gesture. Otherwise it does nothing and returns
   `false`. Each gesture uses a unique key (for example `plan-drag-<counter>`), so a gesture
   can never cancel someone else's group. History must keep the redo stack that existed when
   the group opened so it can be restored. *(Designer's call after review.)*

### Interrupted gestures *(designer's call after review)*

The coalesce group belongs to the document, not to the drag: any command run without the
same key, `undo`, `redo` or an external `endCoalesce()` closes it (`History.push`). So the
rule is: **if the document changes during a gesture and the change did not come from that
gesture, the gesture ends at once**, keeping what it already committed (no cancel). The tool
detects this by comparing change events with the commands it issued itself. Esc after that
point does nothing to the document. Calling `setTool` or `dispose` mid-gesture also ends it,
in the same way.

### Example page

Split view: plan on the left, 3D on the right, same `H3xDocument`. Keep the existing buttons. A
throwaway `<input>` positioned from `lengthEditRequest` (Enter applies through
`plan.setWallLength`, Esc closes), a status line showing `issues`, and Ctrl+Z / Ctrl+Y bound by
the page. This input is demo code, not library code.

### Testing

- Pure modules (`view`, `snap`, `hit`, `render/*`, dimension text) under vitest `node`.
- `H3xPlan` and `SelectEditTool` under jsdom: element identity across changes, selection events,
  a drag sequence via synthetic pointer events producing one undo step, rejection keeping the
  last valid position, Esc leaving no redo entry, `lengthEditRequest` payload, `dispose`.
  jsdom lacks SVG geometry (`getBBox`, `getScreenCTM`): compute everything from the plan's own
  view transform rather than relying on those.
- Package test: `h3x/plan` entry exists and does not import `three`.
- README: an `h3x/plan` section (API, CSS classes, events, the "no inputs in the library" rule);
  roadmap status updated when done.

## Left to the builder

Exact class / method / CSS names, default colours and pixel sizes, zoom limits, the snap
radius in pixels, the click-vs-drag threshold, which walls show dimensions at rest, the label
point algorithm for room names, how the default stylesheet is injected, and the reason string
for a cancelled gesture.
