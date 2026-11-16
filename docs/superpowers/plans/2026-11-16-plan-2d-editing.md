# Milestone 3: 2D plan editing (`h3x/plan`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `h3x/plan`, an SVG plan view with selection, node / wall dragging, live dimensions, length setting and live validation marks, sharing one `H3xDocument` with the 3D view.

**Architecture:** `H3xPlan` owns a retained SVG tree (one element per entity), the view transform, selection and issues; input goes to a pluggable `Tool` (`SelectEditTool` in this milestone). All maths (view, snapping, hit testing, render shapes, dimensions) lives in pure DOM-free modules. Two small core additions: `setWallLength` anchor and `doc.cancelCoalesce(key)`.

**Tech Stack:** TypeScript strict, plain DOM + SVG, vitest (node + jsdom), vite library build.

**Spec:** `docs/superpowers/specs/2026-11-16-plan-2d-editing-design.md`

## Global Constraints

- No new runtime dependencies. `src/plan/**` must not import `three` (directly or through `src/three`).
- `src/core` must not import DOM APIs (other than `DOMParser` in `xml/parse.ts`) or anything from `plan`.
- All geometry comparisons use `GEOM_TOL` (1e-3 m); no ad-hoc epsilons (`EPS` from `core/geometry/vec` is allowed where the existing code uses it).
- Plan coordinates `(x, y)` meters, +y up on screen (not mirrored).
- Retained SVG: an entity's element is created once and kept until the entity disappears; changes only update attributes.
- One undo step per drag gesture; a cancelled gesture leaves no undo and no redo entry; rejected steps are never committed.
- The library shows no input boxes and binds no undo / redo keys.
- TDD and conventional commits per `CONTRIBUTING.md`; each task ends with `pnpm test`, `pnpm typecheck`, `pnpm lint` green.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Undo / redo while a drag is in progress** (page Ctrl+Z with the pointer down): the drag ends at once, the document stays consistent, no extra undo steps — test in Task 11.
2. **Dragging a node back to exactly where it started**: history's net no-op path pops the group; `cancelCoalesce` afterwards must return `false` and Esc must not corrupt redo — test in Task 3 and Task 11.
3. **Document replaced underneath (entity removed by undo of something the plan never saw, or a node with no walls)**: the plan removes stale elements and never throws on missing ids — test in Task 8.
4. **Zero-size container (hidden tab, jsdom)**: `fitToContent`, `screenToPlan` and resize must not produce NaN — test in Task 4 and Task 8.
5. **Selected entity disappears** (undo removes nothing in M3, but `dispose`/external `select` with a bad id): `select` with an unknown id clears the selection and `selectionchange` fires once — test in Task 9.

---

## File structure

```
src/shared/walls/joins.ts       moved from src/three/walls/joins.ts (three-free)
src/three/walls/joins.ts        becomes `export * from '../../shared/walls/joins'`
src/core/commands/layout.ts     setWallLength anchor
src/core/document/history.ts    cancel(key)
src/core/document/H3xDocument.ts cancelCoalesce(key), ChangeEvent reason 'cancel'
src/plan/index.ts               public exports
src/plan/types.ts               PlanKind, Selection, ScreenPoint, Rect, PlanIssues
src/plan/view.ts                view transform (pure)
src/plan/snap.ts                grid + alignment snapping (pure)
src/plan/shapes.ts              wall / junction / room / opening / item shapes (pure)
src/plan/dimensions.ts          which walls show lengths, label placement, text (pure)
src/plan/hit.ts                 hit testing (pure)
src/plan/anchor.ts              length-edit anchor rule (pure)
src/plan/style.ts               default stylesheet text + class names
src/plan/H3xPlan.ts             the class
src/plan/tools/Tool.ts          Tool, ToolContext, PlanPointerEvent
src/plan/tools/SelectEditTool.ts
tests/plan/*.test.ts            one file per module
examples/*                      split view demo
```

---

### Task 1: Move wall joins to a shared three-free module

**Files:**

- Create: `src/shared/walls/joins.ts` (content of current `src/three/walls/joins.ts`, imports adjusted to `../../core/...`)
- Modify: `src/three/walls/joins.ts` (replace body with `export * from '../../shared/walls/joins';`)
- Test: `tests/shared/no-three.test.ts`

**Interfaces:**

- Produces: `computeWallCorners(floor): Record<Id, WallCorners>`, `computeJoins(floor): Joins`, types `WallCorners`, `Junction`, `Joins`, `MITER_LIMIT` importable from `src/shared/walls/joins`. Public `h3x/three` exports unchanged.

- [ ] **Step 1: Write the failing test** `tests/shared/no-three.test.ts`: read every `.ts` file under `src/shared` and (later) `src/plan` with `node:fs` (recursive), assert none contains `from 'three'`, `from "three"`, `'three/` or `/three/` import paths (a missing `src/plan` directory counts as zero files); also assert `src/shared/walls/joins.ts` exists.
- [ ] **Step 2: Run** `pnpm vitest run tests/shared` — expect FAIL (file missing).
- [ ] **Step 3: Move the file** with `git mv`, fix relative imports, add the re-export stub at the old path.
- [ ] **Step 4: Run** `pnpm test` — expect all existing tests (joins, junctions, scene) PASS unchanged.
- [ ] **Step 5: Commit** `refactor: move wall joins to a shared three-free module`

### Task 2: `setWallLength` anchor option

**Files:**

- Modify: `src/core/commands/layout.ts` (`setWallLength`)
- Modify: `README.md` Commands section
- Test: `tests/core/layout.test.ts`

**Interfaces:**

- Produces: `setWallLength(wallId: Id, length: number, opts?: { anchor?: 'a' | 'b' }): Command`. Default `'a'` (today's behaviour). `'b'`: node b fixed, a moves along b→a to distance `length`.

- [ ] **Step 1: Write failing tests** in `layout.test.ts` using `oneRoomFloor` wall `w1` (n1 (0,0) → n2 (4,0)), with neighbouring nodes free to stretch walls:
  - `anchor: 'b'` with length 3 → `n1` at `(1, 0)`, `n2` unchanged, undo restores `n1 (0,0)`.
  - no opts and `anchor: 'a'` both → `n2` at `(3, 0)`.
  - `anchor: 'b'` with length 0.2 → throws `H3xValidationError` with code `wall-too-short`.
- [ ] **Step 2: Run** `pnpm vitest run tests/core/layout.test.ts` — expect the `'b'` tests FAIL.
- [ ] **Step 3: Implement** the option (direction from the fixed node towards the moving node; reuse `applyMoves`).
- [ ] **Step 4: Run** the file — PASS. Update README Commands line: `setWallLength(wallId, length, { anchor? })` (`anchor: 'a'` default keeps node a fixed, `'b'` keeps node b).
- [ ] **Step 5: Commit** `feat(core): setWallLength can keep either end fixed`

### Task 3: `doc.cancelCoalesce(key)`

**Files:**

- Modify: `src/core/document/history.ts`, `src/core/document/H3xDocument.ts`
- Modify: `README.md` Document section
- Test: `tests/core/document.test.ts`

**Interfaces:**

- Produces: `History.cancel(key: string): EntityChange[] | undefined`; `H3xDocument.cancelCoalesce(key: string): boolean`; `ChangeEvent.reason` gains `'cancel'`.

Behaviour: history stores, when it pushes a **new** keyed entry (not a merge), the redo stack as it was just before that push (`groupRedo`). `cancel(key)` succeeds only if the group is open (`!sealed`) and the top entry's key is `key`: pop it, restore `redoStack = groupRedo`, seal, return its changes. `cancelCoalesce` applies them backward and emits `{ reason: 'cancel', changes: invert(changes) }`; returns `true`. Otherwise returns `false`, emits nothing.

- [ ] **Step 1: Write failing tests** (`oneRoomFloor`, `moveNode('n2', …)`):
  - three moves with key `'g1'`, `cancelCoalesce('g1')` → `true`, `n2` back at `(4,0)`, `canUndo === false`, one change event with reason `'cancel'`.
  - redo preserved: execute A (no key), undo → `canRedo`; then two moves with key `'g1'`, cancel → `canRedo === true` and `redo()` re-applies A.
  - wrong key → `false`, state unchanged, no event.
  - after `endCoalesce()` → `false`.
  - net no-op: move `n2` away and back to `(4,0)` with key `'g1'` (history pops the group) → `cancelCoalesce('g1')` is `false` and `canUndo === false`.
  - a keyed move with `'g1'`, then a keyless command → `cancelCoalesce('g1')` is `false` and the state is unchanged (the keyless push sealed the group).
- [ ] **Step 2: Run** `pnpm vitest run tests/core/document.test.ts` — FAIL (`cancelCoalesce` missing).
- [ ] **Step 3: Implement** in `History` and `H3xDocument` as described.
- [ ] **Step 4: Run** `pnpm test` (H3xScene must handle reason `'cancel'` — it rebuilds for any reason; confirm `tests/three/scene.test.ts` still passes). README: add `doc.cancelCoalesce(key)` next to `endCoalesce`, and `'cancel'` to the reasons.
- [ ] **Step 5: Commit** `feat(core): cancel an open coalesced gesture by key`

### Task 4: `h3x/plan` entry, types and view transform

**Files:**

- Create: `src/plan/index.ts`, `src/plan/types.ts`, `src/plan/view.ts`
- Modify: `vite.config.ts` (entry `'plan/index': 'src/plan/index.ts'`), `package.json` `exports["./plan"]` (types `./dist/plan/index.d.ts`, import `./dist/plan/index.js`), `tsconfig.json` paths `h3x/plan`, `examples/vite.config.ts` alias `h3x/plan`
- Test: `tests/plan/view.test.ts`, `tests/package.test.ts`

**Interfaces:**

- Produces (`types.ts`): `type PlanKind = 'node' | 'wall' | 'room' | 'opening' | 'item'`; `interface Selection { kind: PlanKind; id: Id }`; `interface ScreenPoint { x: number; y: number }`; `interface Rect { x: number; y: number; width: number; height: number }`; `interface PlanIssues { rejected: Issue[]; standing: Issue[] }`.
- Produces (`view.ts`): `interface View { cx: number; cy: number; scale: number; width: number; height: number }` (scale = px per meter; width/height = viewport px). `MIN_SCALE = 5`, `MAX_SCALE = 2000`, `DEFAULT_SCALE = 50`. Functions: `planToScreen(v, p: Vec2): ScreenPoint` (`sx = (x-cx)*scale + width/2`, `sy = height/2 - (y-cy)*scale`), `screenToPlan(v, s): Vec2`, `zoomAt(v, s: ScreenPoint, factor): View` (keeps the plan point under `s` fixed, scale clamped), `panBy(v, dx, dy): View` (screen px), `fitBounds(v, min: Vec2, max: Vec2, paddingPx = 40): View`.

- [ ] **Step 1: Write failing tests** in `view.test.ts`:
  - round trip `screenToPlan(v, planToScreen(v, p))` ≈ `p` for `v = { cx: 2, cy: 1, scale: 50, width: 800, height: 600 }`, `p = (3.5, -2)`.
  - `planToScreen(v, {x:2,y:2}).y < planToScreen(v, {x:2,y:1}).y` (+y up).
  - `zoomAt` keeps the plan point under the cursor; scale clamps to `[5, 2000]`.
  - `fitBounds` of `(0,0)–(4,16)` in 800×600 with padding 40 → scale `= min(720/4, 520/16) = 32.5`, centre `(2, 8)`.
  - zero-size viewport (`width: 0, height: 0`): `fitBounds` returns `DEFAULT_SCALE`, finite centre; `screenToPlan` finite.
  - `package.test.ts`: `exports['./plan']` equals `{ types: './dist/plan/index.d.ts', import: './dist/plan/index.js' }`.
- [ ] **Step 2: Run** `pnpm vitest run tests/plan tests/package.test.ts` — FAIL.
- [ ] **Step 3: Implement** the files and wiring; `index.ts` exports the types and view functions for now.
- [ ] **Step 4: Run** `pnpm test`, `pnpm build` — `dist/plan/index.js` exists and contains no `three` import (`grep -c "from \"three\"" dist/plan/index.js` → 0).
- [ ] **Step 5: Commit** `feat(plan): add h3x/plan entry and view transform`

### Task 5: Snapping

**Files:**

- Create: `src/plan/snap.ts`
- Test: `tests/plan/snap.test.ts`

**Interfaces:**

- Produces: `interface SnapOptions { grid: number; align: boolean; alignRadius: number /* meters */ }`; `interface SnapResult { point: Vec2; guides: Array<{ axis: 'x' | 'y'; value: number; from: Vec2 }> }`; `snapPoint(p: Vec2, others: Vec2[], opts: SnapOptions): SnapResult`; `snapScalar(v: number, grid: number): number`. Rule: per axis, alignment to the nearest other node within `alignRadius` wins over grid; otherwise round to `grid`. `grid <= 0` disables grid. Callers pass `alignRadius = 8 / view.scale`.

- [ ] **Step 1: Write failing tests**: `(1.23, 2.07)` grid 0.05 no others → `(1.25, 2.05)`, no guides; with other `(1.21, 9)` and radius 0.05 → x = `1.21` with guide `{ axis: 'x', value: 1.21 }`, y grid-snapped; `align: false` ignores others; `grid: 0` + no others → point unchanged; `snapScalar(0.376, 0.05)` ≈ `0.4`; `snapScalar(-0.024, 0.05)` ≈ `0`.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement.** Results rounded with the same `tidy` approach as core (1e-9) to avoid `1.2500000001`.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(plan): grid and alignment snapping`

### Task 6: Render shapes and dimensions

**Files:**

- Create: `src/plan/shapes.ts`, `src/plan/dimensions.ts`
- Test: `tests/plan/shapes.test.ts`, `tests/plan/dimensions.test.ts`

**Interfaces:**

- Consumes: `computeJoins` (Task 1), `roomPolygon`, `roomArea` (core), `View` (Task 4).
- Produces (`shapes.ts`, all plan-space meters):
  - `wallOutline(c: WallCorners): Vec2[]` → `[startLeft, endLeft, endRight, startRight]`.
  - `junctionPolygons(joins: Joins): Record<Id, Vec2[]>` (node id → `points`).
  - `roomLabel(floor, room): { at: Vec2; name: string; area: string }`; `area` = `` `${roomArea(floor, room, 'inner').toFixed(1)} m²` ``; `at` = label point inside the inner polygon (algorithm is the builder's choice, must be inside for convex and L-shaped rooms).
  - `openingShape(floor, o): { kind: 'door' | 'window'; gap: [Vec2, Vec2, Vec2, Vec2]; leaf?: [Vec2, Vec2]; arc?: { from: Vec2; to: Vec2; center: Vec2; r: number; sweep: 0 | 1 }; lines?: [Vec2, Vec2][] }`. Door when `o.sill < GEOM_TOL`, else window. `gap` = the opening rectangle across the wall thickness (centre at `offset` from node a, width `o.width`). Door: hinge at the end nearer node a, leaf of length `width` perpendicular to the wall on the left side of a→b; `flip: true` mirrors (hinge at the far end, right side). Window: three lines along the wall at −t/2, 0, +t/2 (`lines`).
  - `itemFootprint(item, floor, presets?): Vec2[] | undefined` (floor / ceiling: rotated `footprint.w × footprint.d` rectangle at `(x, y)` with `rotation`; wall item: `w × 0.1` box against the given side at `offset`; `undefined` when the preset does not resolve).
- Produces (`dimensions.ts`):
  - `wallsShowingDimensions(floor, state: { selection: Selection | null; draggingNode: Id | null }): Id[]`: dragging node → walls touching it; else selected wall → `[id]`; selected node → walls touching it; nothing → exterior walls (walls in fewer than two rooms).
  - `dimensionLabel(floor, wallId, view: View): { text: string; at: Vec2; angle: number; line: [Vec2, Vec2] }`: `text = length.toFixed(2)` (centre-line length); line parallel to the wall offset by `thickness/2 + 18 / view.scale` on the side away from the centroid of all nodes; `angle` in degrees kept within (−90, 90] so text is never upside down.

- [ ] **Step 1: Write failing tests**:
  - `oneRoomFloor` wall `w1` outline has 4 points: the left side (towards +y, `leftNormal` of +x) at y = `0.1`, the right side at y = `-0.1`, and with square mitred corners x spans `[-0.1, 4.1]` on the outer side and `[0.1, 3.9]` on the inner side.
  - `roomLabel` for `r1`: `area === '14.4 m²'` (inner 3.8×3.8 = 14.44), `name === 'Phòng khách'`, `at` inside `(0.1..3.9)²`.
  - door `o1` on `w1` (offset 1.2, width 0.9): `kind 'door'`, gap x-range `[0.75, 1.65]`, hinge at `(0.75, ·)`, `arc.r === 0.9`; with `flip: true` hinge at `(1.65, ·)` and the leaf on the other side. Window variant (sill 0.9): 3 lines, no arc.
  - `itemFootprint` with unknown preset → `undefined`; floor item `w 2, d 1` at `(1,1)` rotation `Math.PI/2` → bounding box `0.5..1.5 × 0..2`.
  - `wallsShowingDimensions`: nothing selected on `twoRoomFloor` excludes the shared wall; dragging `n2` on `oneRoomFloor` → `['w1','w2']` (order-insensitive).
  - `dimensionLabel(w1)` with scale 50: `text '4.00'`, `line` y below the wall (centroid is above), offset `0.1 + 0.36`; for a wall running right→left the `angle` is within (−90, 90].
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** both modules.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(plan): shapes and dimension layout for the plan`

### Task 7: Hit testing and length-edit anchor

**Files:**

- Create: `src/plan/hit.ts`, `src/plan/anchor.ts`
- Test: `tests/plan/hit.test.ts`, `tests/plan/anchor.test.ts`

**Interfaces:**

- Consumes: shapes (Task 6), `View` (Task 4).
- Produces:
  - `type HitTarget = { kind: PlanKind; id: Id } | { kind: 'dimension'; id: Id /* wall id */ } | null`.
  - `interface HitScene { floor: Floor; view: View; corners: Record<Id, WallCorners>; dimensions: Array<{ wallId: Id; rect: Rect /* screen px */ }>; presets?: PresetResolver }`.
  - `hitTest(scene: HitScene, s: ScreenPoint): HitTarget`. Priority: node (within 8 px of the node) > dimension label rect > opening (inside its gap rectangle) > wall (inside outline or within 4 px of the centre line) > item footprint > room (inside centre polygon) > null.
  - `pickAnchor(floor, wallId, near?: Vec2): 'a' | 'b'`: end with more incident walls stays; tie → end farther from `near`; tie or no `near` → `'a'`.

- [ ] **Step 1: Write failing tests**: on `oneRoomFloor` at scale 50: point 3 px from `n2` → node `n2`; point on `w1` midpoint → wall `w1`; point inside door `o1` gap → opening `o1`; room centre → room `r1`; far outside → `null`; a dimension rect containing the point beats the wall under it. `pickAnchor`: T-junction fixture (add a wall from the midpoint node of a wall in a test-local floor) → the end with 3 walls; `oneRoomFloor` `w1` with `near = (3.9, 0)` → `'a'` (farther end is a); with `near = (0.1, 0)` → `'b'`; no `near` → `'a'`.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** (`pointInPolygon`, `closestPointOnSegment` from core geometry).
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(plan): hit testing and length anchor rule`

### Task 8: `H3xPlan` rendering, document sync and view

**Files:**

- Create: `src/plan/H3xPlan.ts`, `src/plan/style.ts`
- Modify: `src/plan/index.ts`
- Test: `tests/plan/H3xPlan.test.ts` (`// @vitest-environment jsdom`)

**Interfaces:**

- Consumes: Tasks 4–7.
- Produces:

  ```ts
  interface H3xPlanOptions {
    grid?: boolean; // default true
    snap?: { grid?: number; align?: boolean }; // default { grid: 0.05, align: true }
    classPrefix?: string; // default 'h3x-plan'
    presets?: PresetResolver; // default doc.presets
  }
  class H3xPlan {
    constructor(container: HTMLElement, doc: H3xDocument, opts?: H3xPlanOptions);
    readonly svg: SVGSVGElement;
    readonly doc: H3xDocument;
    get view(): View;
    setView(v: Partial<Pick<View, 'cx' | 'cy' | 'scale'>>): void;
    fitToContent(paddingPx?: number): void;
    planToScreen(p: Vec2): ScreenPoint;
    screenToPlan(s: ScreenPoint): Vec2;
    getElement(kind: PlanKind, id: Id): SVGGElement | undefined;
    dispose(): void;
  }
  ```

  Layers (`<g>` with class `${prefix}-layer-<name>`), in order: `grid, rooms, walls, joins, openings, items, dimensions, nodes, overlay`. Each entity `<g>` has `data-h3x-kind`, `data-h3x-id`, class `${prefix}-${kind}`. Container size from `clientWidth/clientHeight` (0 allowed); `ResizeObserver` when defined, else `window` resize.
  Rendering: one `<g>` per entity, containing `<polygon>`/`<path>`/`<text>` children; the root `<g>` carries the plan→screen transform as `matrix(scale,0,0,-scale,…)` **except text**, which is positioned in screen space (so labels are upright and pixel-sized). Strokes use `vector-effect: non-scaling-stroke`. Grid: 1 m major, 0.1 m minor hidden when `0.1 * scale < 6`.
  Sync: `doc.on('change')` → collect changed ids; recompute corners/joins (cheap) and re-apply attributes for changed walls **and walls sharing a node with any changed node or wall**, their openings, rooms containing them, and all dimensions; add/remove elements for entities that appeared/disappeared (reason `'load'` or any → full reconcile is acceptable when the change touches > 50 ids).
  Style: `style.ts` exports `DEFAULT_CSS(prefix)`; injected as a `<style>` element inside the SVG (scoped by the root class), so no global side effects.

- [ ] **Step 1: Write failing tests** (container `div` with `clientWidth`/`clientHeight` stubbed via `Object.defineProperty` to 800×600):
  - builds one element per node / wall / room / opening with the right `data-h3x-*`; layer order as listed.
  - identity: `getElement('wall','w1')` is the same object after `doc.execute(moveNode('n2',{x:5,y:0}))`, and its polygon `points` attribute changed; `w2`'s points changed too (shared node); `w3`'s did not.
  - undo after the move restores the original `points` string.
  - `fitToContent()` on `oneRoomFloor` gives centre `(2, 2)`; with a 0×0 container no attribute contains `NaN`.
  - a floor with an isolated node (no walls) renders without throwing.
  - `dispose()` removes the SVG from the container, a later doc change does not throw and touches nothing; calling `dispose()` twice is fine.
  - grep-style guard: `tests/shared/no-three.test.ts` now also scans `src/plan` (already written in Task 1 — confirm it covers the new files).
- [ ] **Step 2: Run** `pnpm vitest run tests/plan/H3xPlan.test.ts` — FAIL.
- [ ] **Step 3: Implement** `H3xPlan` rendering, sync, view, resize, dispose and `style.ts` (no tool support yet: Task 10 adds the `tool` option and dispatch).
- [ ] **Step 4: Run** `pnpm test` — PASS.
- [ ] **Step 5: Commit** `feat(plan): H3xPlan renders a document as retained SVG`

### Task 9: Selection, issues and `setWallLength`

**Files:**

- Modify: `src/plan/H3xPlan.ts`
- Test: `tests/plan/H3xPlan.selection.test.ts` (jsdom)

**Interfaces:**

- Produces on `H3xPlan`:

  ```ts
  get selection(): Selection | null;
  select(sel: Selection | null): void;     // unknown id → null; fires only when it changes
  get issues(): PlanIssues;
  reportRejected(issues: Issue[]): void;   // used by tools; [] clears
  setWallLength(wallId: Id, length: number, opts?: { anchor?: 'a' | 'b' }):
    { ok: true } | { ok: false; issues: Issue[] };   // anchor default pickAnchor(floor, wallId)
  on(type: 'selectionchange', fn: (s: Selection | null) => void): () => void;
  on(type: 'lengthEditRequest', fn: (e: LengthEditRequest) => void): () => void;
  on(type: 'issues', fn: (e: PlanIssues) => void): () => void;
  emitLengthEditRequest(wallId: Id, near?: Vec2): void;   // used by tools
  // LengthEditRequest = { wallId: Id; length: number; anchor: 'a' | 'b'; anchorRect: Rect }
  ```

  Classes: selected element `${prefix}-selected`; standing problems `${prefix}-invalid` on every entity in any standing issue's `ids`; rejected flash `${prefix}-rejected` added on `reportRejected` and removed after 600 ms (via `setTimeout`, cleared on dispose). Standing = `[...doc.validateLayout(), ...doc.validatePlacements()]`, recomputed on construction and after every change; `issues` fires when either list's content changes (compare by `code` + `ids`).
  `setWallLength` runs `doc.tryExecute(setWallLength(...))`; on failure calls `reportRejected`.

- [ ] **Step 1: Write failing tests**:
  - `select({kind:'wall',id:'w1'})` → class on `w1`, `selectionchange` fired once with the selection; selecting again → no event; `select({kind:'wall',id:'nope'})` → `null` and one event.
  - selection affects dimensions: with `w1` selected the dimensions layer has exactly one label, text `4.00`; after `select(null)` it has four (all walls of `oneRoomFloor` are exterior).
  - standing issues: shorten `w1` with `doc.execute(setWallLength('w1', 1.0))` so door `o1` (offset 1.2, width 0.9) no longer fits → `o1` element has `-invalid`, `plan.issues.standing` contains code `opening-out-of-wall`, `issues` event fired; undo → class gone, standing empty.
  - `plan.setWallLength('w1', 0.1)` → `{ ok: false }`, `issues.rejected[0].code === 'wall-too-short'`, `w1` gets `-rejected` (use `vi.useFakeTimers()`; class removed after 600 ms).
  - `plan.setWallLength('w1', 3)` without anchor on `oneRoomFloor` → `'a'` rule (tie, no `near`) → `n2` at `(3,0)`.
  - `emitLengthEditRequest('w1')` → payload `{ wallId:'w1', length: 4, anchor:'a', anchorRect }` with finite rect numbers.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm test` — PASS.
- [ ] **Step 5: Commit** `feat(plan): selection, standing issues and setWallLength`

### Task 10: Tool interface, pointer dispatch, pan and zoom

**Files:**

- Create: `src/plan/tools/Tool.ts`
- Modify: `src/plan/H3xPlan.ts`, `src/plan/index.ts`
- Test: `tests/plan/tools.test.ts` (jsdom)

**Interfaces:**

- Produces:

  ```ts
  interface PlanPointerEvent {
    native: PointerEvent | MouseEvent;
    screen: ScreenPoint;
    plan: Vec2;
    hit: HitTarget;
  }
  interface ToolContext {
    plan: H3xPlan;
    doc: H3xDocument;
    hit(s: ScreenPoint): HitTarget;
    snap(p: Vec2, exclude: Id[], disabled: boolean): SnapResult; // uses opts.snap, alignRadius = 8 / scale, others = nodes not in exclude
    showGuides(g: SnapResult['guides']): void; // overlay; [] clears
    setDragging(nodeId: Id | null): void; // drives wallsShowingDimensions
  }
  interface Tool {
    activate(ctx: ToolContext): void;
    deactivate(): void;
    onPointerDown?(e: PlanPointerEvent): boolean; // true = consumed (plan will not pan)
    onPointerMove?(e: PlanPointerEvent): void;
    onPointerUp?(e: PlanPointerEvent): void;
    onDoubleClick?(e: PlanPointerEvent): void;
    onKeyDown?(e: KeyboardEvent): boolean;
  }
  // H3xPlan: setTool(tool: Tool | null): void; get tool(): Tool | null
  // H3xPlanOptions gains `tool?: Tool | null` (Task 11 makes `new SelectEditTool()` the default when omitted; `null` = no tool)
  // The tool receives pointermove/up even when its onPointerDown returned false (it just has no gesture); the plan pans in that case.
  ```

  `H3xPlan` listens on `svg`: `pointerdown/move/up/cancel`, `dblclick`, `wheel` (`passive: false`), `keydown` (svg has `tabindex="0"`; focus on pointerdown). Pointer capture on pointerdown. Wheel: `zoomAt(view, cursor, Math.exp(-deltaY * 0.0015))`, `preventDefault`. Pan: pointerdown not consumed by the tool (or middle button) → drag pans the view. Pinch: two active pointers → zoom about their midpoint by distance ratio, pan by midpoint motion; the tool gets no events while two pointers are down. `pointercancel` is delivered to the tool as `onPointerUp`. `setTool` calls `deactivate` on the old tool before `activate` on the new; `dispose` deactivates.

- [ ] **Step 1: Write failing tests** with a recording fake tool and synthetic events (jsdom has `PointerEvent` only in recent versions; if missing, dispatch `MouseEvent` with type `pointerdown` and a `pointerId` property — add a tiny helper in the test):
  - the tool receives down/move/up with `plan` coordinates matching `screenToPlan` and `hit` = node `n1` when pressing on `n1`.
  - tool returning `false` from `onPointerDown` → dragging 100 px right moves `view.cx` by `-100 / scale`.
  - wheel with `deltaY: -100` at a screen point keeps that plan point fixed and increases scale.
  - `setTool(b)` calls `a.deactivate()` then `b.activate(ctx)`; `dispose()` calls `b.deactivate()`.
  - keydown on the svg is forwarded to `onKeyDown`.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm test` — PASS.
- [ ] **Step 5: Commit** `feat(plan): tool dispatch with pan, zoom and pinch`

### Task 11: `SelectEditTool`

**Files:**

- Create: `src/plan/tools/SelectEditTool.ts`
- Modify: `src/plan/H3xPlan.ts` (default tool), `src/plan/index.ts`
- Test: `tests/plan/SelectEditTool.test.ts` (jsdom)

**Interfaces:**

- Consumes: `Tool`, `ToolContext` (Task 10); `moveNode`, `moveWall`, `doc.tryExecute`, `doc.endCoalesce`, `doc.cancelCoalesce` (Task 3); `plan.select`, `plan.reportRejected`, `plan.emitLengthEditRequest` (Task 9).
- Produces: `class SelectEditTool implements Tool` with `constructor(opts?: { dragThresholdPx?: number /* 4 */; nudge?: number /* 0.01 */; nudgeLarge?: number /* 0.1 */ })`.

Behaviour (from the spec):

- pointerdown on node / wall: consume, remember start; on room / opening / item / empty: return `false` (plan pans) and on pointerup without movement clear the selection (`plan.select(null)`). Dimension hit: consume, no drag.
- movement > threshold starts a gesture with key `plan-drag-<n>` (`n` increments per tool instance) and selects the target.
- node drag: target = `ctx.snap(e.plan, [nodeId], altKey)` → `tryExecute(moveNode(id, point), { coalesceKey })`; `ctx.showGuides`; `ctx.setDragging(id)`. Failure → `plan.reportRejected(issues)`, node stays; success after a failure → `reportRejected([])`.
- wall drag: wanted offset along the wall's left normal = dot(e.plan − pressPlan, n) snapped with `snapScalar` (unless Alt), delta = wanted − already applied → `tryExecute(moveWall(id, scale(n, delta)), { coalesceKey })`.
- pointerup: `doc.endCoalesce()`, clear guides and dragging. Click (no gesture) selects the target.
- Esc during a gesture: `doc.cancelCoalesce(key)`, end gesture, clear rejected. Esc without gesture: `plan.select(null)`. Returns `true` when handled.
- Interrupted gesture: the tool sets `issuing = true` around its own `tryExecute`; a change event during a gesture while `!issuing` ends the gesture (no cancel, no further moves until the next pointerdown). `deactivate()` ends any gesture the same way (calls `endCoalesce`).
- Arrow keys with a node / wall selected: move by `nudge` (Shift: `nudgeLarge`) via one keyless `tryExecute` per press (wall: only the normal component); failure → `reportRejected`. Return `true`; other keys `false`.
- dblclick on a dimension label: `plan.emitLengthEditRequest(wallId, e.plan)`.

- [ ] **Step 1: Write failing tests** (`oneRoomFloor`, 800×600 container, `fitToContent()`):
  - click on `n1` selects it; click on empty space clears.
  - drag `n2` by +1 m in x over 5 moves → `n2` at `(5, 0)` (snapped), `doc.canUndo`, one `undo()` returns `n2` to `(4,0)`.
  - drag `n2` onto `n1` (wall would be < 0.3 m) → `n2` stays at the last valid position, `plan.issues.rejected[0].code === 'wall-too-short'`; moving back to a valid spot clears `rejected`.
  - Alt held → no snapping (`n2` at the exact unsnapped plan point).
  - alignment: drag `n3` (4,4) to a plan point 0.03 m right of `x = 4` with `snap.grid` set to `0` in the plan options → `n3.x === 4` (aligned with `n2`), and the overlay layer contains one guide element; after pointerup the overlay is empty.
  - wall drag of `w3` upward by 0.5 m → `n3.y` and `n4.y` both `4.5`; one undo step.
  - Esc mid-drag → document back to the start, `canUndo === false`, `canRedo` as before the drag (set up a redo entry first and check it survives).
  - interrupted: start dragging `n2`, then call `doc.undo()` on an earlier keyless step from the test → further pointer moves do not change the document; pointerup is harmless; Esc does nothing.
  - drag back to the exact start then Esc → no throw, `canUndo === false`.
  - ArrowRight with `n2` selected → `(4.01, 0)`; Shift+ArrowUp with `w1` selected → `n1.y` and `n2.y` `0.1`; each press its own undo step.
  - dblclick on `w1`'s dimension label → `lengthEditRequest` with `wallId 'w1'`, `length 4`.
  - `setTool(null)` mid-drag ends the gesture and the drag is one undo step.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement**; make it the default tool in `H3xPlan`.
- [ ] **Step 4: Run** `pnpm test`, `pnpm typecheck`, `pnpm lint` — all green.
- [ ] **Step 5: Commit** `feat(plan): SelectEditTool for selecting and dragging nodes and walls`

### Task 12: Example page — plan and 3D side by side

**Files:**

- Modify: `examples/index.html`, `examples/main.ts`
- Create: `examples/lengthInput.ts`
- Test: `tests/plan/example-length-input.test.ts` (jsdom)

**Interfaces:**

- Consumes: `H3xPlan`, `lengthEditRequest`, `plan.setWallLength`, `plan.on('issues')`.
- Produces: `attachLengthInput(plan: H3xPlan, host: HTMLElement): () => void` — on `lengthEditRequest` shows an absolutely positioned `<input type="number" step="0.01">` over `anchorRect` (relative to the plan container) with the current length; Enter → `plan.setWallLength(wallId, value, { anchor })`, closes on success, keeps open with the first issue message in its `title` and a red border on failure; Esc or blur closes. Demo code only.

Layout: `#plan` left half, `#app` (3D) right half (stack vertically under 700 px width), toolbar unchanged plus status showing standing issue count. Page binds Ctrl+Z / Ctrl+Y (Cmd on macOS) to `doc.undo/redo`, ignoring key events from the length input. Vietnamese UI text like the existing page.

- [ ] **Step 1: Write failing test**: with a plan on `oneRoomFloor`, `attachLengthInput`, then `plan.emitLengthEditRequest('w1')` → an input with value `4` appears; set value `3`, dispatch Enter → `n2` at `(3, 0)` and the input is removed; request again, value `0.1`, Enter → input stays and has a non-empty `title`; Esc removes it.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** `lengthInput.ts`, the split layout and wiring in `main.ts`.
- [ ] **Step 4: Run** `pnpm test`; then `pnpm dev` and check in a browser: drag a node in 2D → 3D updates live; Esc cancels; double-click a dimension → input; shorten a wall under the door → the door turns red.
- [ ] **Step 5: Commit** `feat(examples): plan and 3D side by side with a demo length input`

### Task 13: Docs and roadmap

**Files:**

- Modify: `README.md` (new `## h3x/plan` section after `## h3x/three`; intro list mentions the subpath), `docs/roadmap.md` (milestone 3 → Done), `CHANGELOG.md` (Unreleased: `h3x/plan`, `setWallLength` anchor, `cancelCoalesce`)
- Test: `tests/core/public-api.test.ts` (only if the README example block changes)

README section must cover: quick example (doc + `H3xPlan` + `H3xViewer` on the same doc), view methods, selection, events and payloads (`selectionchange`, `lengthEditRequest`, `issues`), the "library has no inputs, the editor attaches them" rule, tools (`setTool`, `SelectEditTool` gestures and keys, Esc, interruption rule), CSS classes and `data-h3x-*` attributes, ownership / `dispose`.

- [ ] **Step 1: Write the docs.**
- [ ] **Step 2: Run** `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build`, `npx prettier --check --end-of-line auto .` — all green.
- [ ] **Step 3: Commit** `docs(plan): document h3x/plan; mark milestone 3 done`
