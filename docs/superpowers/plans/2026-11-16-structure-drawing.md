# Milestone 4: Structure drawing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the structure fully editable: draw / delete / split walls, insert / delete / merge points, push / pull, columns, room holes and a site boundary, with rooms re-detected (identity kept) inside every structural command, in core, the 2D plan and the 3D view.

**Architecture:** Structural commands work on a cloned "draft" floor, mutate it with topology helpers, run `syncRooms(before, draft)` and return `diffFloors(before, draft)` — one command, one undo step. Room detection is rewritten to drop bridges, split pinched faces and assign holes. The plan gets new tools (`DrawWallTool`, `DrawSiteTool`, `ColumnTool`) and new `SelectEditTool` gestures; 3D adds column meshes, a site line and floors with holes.

**Tech Stack:** TypeScript strict, plain DOM + SVG, three.js (only in `h3x/three`), vitest (node + jsdom), vite.

**Spec:** `docs/superpowers/specs/2026-11-16-structure-drawing-design.md`

## Global Constraints

- No new runtime dependencies. `src/plan/**` must not import `three`; `src/core` must not import DOM APIs (other than `DOMParser` in `xml/parse.ts`) or `plan` / `three`.
- XML changes are additive: `FORMAT_VERSION` stays `1`; every existing fixture / example file loads and round-trips unchanged.
- Geometry comparisons use `GEOM_TOL` (1e-3 m). `MIN_WALL_LENGTH` 0.3, `MIN_ROOM_AREA` 1.0 stay as they are.
- Commands are pure: `run(ctx)` never mutates `ctx.floor` / `ctx.site`.
- Every structural command (add / remove / split wall, remove / merge / drop node, push / pull) produces exactly one change list including its room changes; `moveNode`, `moveWall`, `setWallLength` do not re-sync rooms.
- `walls-overlap` is an input check inside structural commands, not a validator.
- Existing `SelectEditTool` gestures keep working (node / wall drag, nudge, Esc, double-click on a dimension → `lengthEditRequest`).
- One undo step per click / drag gesture; a cancelled gesture leaves no undo or redo entry.
- TDD and conventional commits per `CONTRIBUTING.md`; each task ends with `pnpm test`, `pnpm typecheck`, `pnpm lint` green.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Bridge wall between an outer loop and an inner loop** (a wall joining the room boundary to a closet box): both endpoints have degree ≥ 2, so degree-1 pruning keeps it and the face revisits nodes. Expected: the bridge is ignored for faces, the inner box becomes a hole of the outer room — test in Task 3.
2. **Inner loop touching the outer boundary at one node** (closet corner on the wall): the traced face revisits that node. Expected: the face is split at the repeated node into the outer ring and a hole; the room survives — test in Task 3.
3. **Undo / redo of a structural command restores rooms exactly** (same ids, names, finishes, `walls`, `holes`), including undo of a split that created a new room — test in Task 4 and Task 6.
4. **Drawing over existing geometry**: a wall drawn exactly through an existing node, along an existing wall, or ending within `GEOM_TOL` of a wall end must reuse / reject, never create a zero-length wall or a duplicate — test in Task 6.
5. **Document mutated under an active tool** (undo while `DrawWallTool` has a chain, or the chain's last node deleted): the tool drops its chain without throwing — test in Task 13.

---

## File structure

```
src/core/types.ts                 Column, Site, Room.holes, EntityKind += 'column' | 'site'
src/core/document/changes.ts      applyChanges(project, …), CommandContext.site
src/core/document/H3xDocument.ts  passes project / site through
src/core/xml/parse.ts|serialize.ts <site>, <column>, room holes
src/core/validate/refs.ts         holes refs
src/core/validate/layout.ts       holes in room-degenerate, column-size, columns-overlap, site-not-simple
src/core/geometry/clip.ts         polygonOverlapArea (new)
src/core/rooms/detect.ts          detectRooms rewrite (bridges, pinches, holes), roomShape, roomArea
src/core/rooms/sync.ts            syncRooms (new)
src/core/topology/draft.ts        structural(), diffFloors, graph helpers (new)
src/core/topology/ops.ts          splitAt, removeWallIn, removeNodeIn, mergeNodesIn, rebase (new)
src/core/commands/structure.ts    addWall, removeWall, splitWall, removeNode, mergeNodes, dropNode, pushPullWall (new)
src/core/commands/columns.ts      addColumn, moveColumn, removeColumn, setSite (new)
src/plan/H3xPlan.ts               slimmed (Task 10)
src/plan/reconcile.ts, overlay.ts split out of H3xPlan.ts (Task 10)
src/plan/shapes.ts, render.ts, hit.ts   columns, site, room holes
src/plan/snap.ts                  snapDraw (new function)
src/plan/tools/chain.ts           shared click-chain state machine (new)
src/plan/tools/DrawWallTool.ts, DrawSiteTool.ts, ColumnTool.ts (new)
src/plan/tools/SelectEditTool.ts  delete, insert point, columns, push / pull, join on drop
src/three/columns.ts (new), src/three/site.ts (new), src/three/floors.ts, src/three/scene.ts
examples/*                        tool buttons, segment length input
docs/xml-format.md, docs/validation.md, README.md, CHANGELOG.md
```

---

### Task 1: Data model, change plumbing and XML for site, column and room holes

**Files:**

- Modify: `src/core/types.ts`, `src/core/document/changes.ts`, `src/core/document/H3xDocument.ts`, `src/core/commands/objects.ts` (`assertFreeId`), `src/core/validate/refs.ts`, `src/core/xml/parse.ts`, `src/core/xml/serialize.ts`, `src/core/rooms/normalize.ts`, `docs/xml-format.md`
- Test: `tests/core/xml.test.ts`, `tests/core/document.test.ts`

**Interfaces:**

- Produces:

  ```ts
  interface Site { id: 'site'; points: Vec2[] }            // CCW
  interface Column { id: Id; x: number; y: number; shape: 'round' | 'square';
    width: number; depth?: number; rotation: number; height?: number }
  interface Room { …; holes?: Id[][] }                       // each loop CW
  interface Floor { …; columns: Record<Id, Column> }
  interface Project { …; site?: Site }
  type EntityKind = 'node' | 'wall' | 'opening' | 'room' | 'item' | 'column' | 'site'
  interface CommandContext { floor: Readonly<Floor>; site?: Readonly<Site>; presets?: PresetResolver }
  function applyChanges(project: Project, changes: EntityChange[], dir: 'forward' | 'backward'): void
  ```

  `applyChanges` writes floor kinds into `project.floors[0]` and `site` into `project.site` (`null` → delete). `H3xDocument.create` adds `columns: {}`.

- [ ] **Step 1: Write failing tests**
  - `xml.test.ts`: `'round-trips site, columns and room holes'` — parse the XML below, expect `project.site.points` CCW `[{0,0},{12,0},{12,20},{0,20}]`, `floor.columns.c1` `{shape:'square', width:0.3, depth:0.3, rotation:0}`, `floor.columns.c2` `{shape:'round', width:0.35}`, `rooms.r1.holes` one CW loop of `w5 w6 w7 w8`; `projectToXML` then `projectFromXML` deep-equals.
    ```xml
    <site points="0,0 0,20 12,20 12,0"/>  <!-- CW on purpose → reversed -->
    <column id="c1" x="4" y="3" shape="square" width="0.3" depth="0.3" rotation="0"/>
    <column id="c2" x="8" y="3" shape="round" width="0.35"/>
    <room id="r1" walls="w1 w2 w3 w4" holes="w5 w6 w7 w8" name="Living"/>  <!-- 6x6 outer, 2x2 inner box, CCW hole list → reversed to CW -->
    ```
  - Parse errors (`H3xParseError` with `element`/`attribute`): site with 2 points; site point `"1,x"`; two `<site>`; column `shape="hex"`; `holes` loop that does not close (`attribute: 'holes'`); `holes` naming a missing wall.
  - Writer: `<site>` directly after `<meta>`; columns after items; `holes` omitted when empty; loops joined by `"; "`.
  - `document.test.ts`: `'site changes are undoable'` — a hand-written command returning `{kind:'site', id:'site', before:null, after:{id:'site', points:[…]}}` sets `doc.project.site`, undo removes it, the change event carries the site change. `'columns ids collide with other kinds'` — `assertFreeId` rejects an id used by a column.
- [ ] **Step 2: Run** `pnpm vitest run tests/core/xml.test.ts tests/core/document.test.ts` — FAIL.
- [ ] **Step 3: Implement** the types, `applyChanges(project, …)` (update the only call sites in `H3xDocument`: `attempt`, `cancelCoalesce`, `preview`, `undo`, `redo`), `CommandContext.site` from `project.site`, `checkRefs` for hole wall ids, `normalizeRoomOrientation` reversing CCW hole loops to CW, parse / serialize per the spec. Update `docs/xml-format.md` (`<site>`, `<column>`, `holes`, child order).
- [ ] **Step 4: Run** `pnpm test && pnpm typecheck && pnpm lint` — PASS (existing plan / three code may need `column`/`site` cases added to exhaustive maps such as `H3xPlan.onChange`'s `changed` record; ignore those kinds there for now).
- [ ] **Step 5: Commit** `feat(core): site, columns and room holes in the model and XML`

---

### Task 2: Overlap area, room shape with holes, and new validation

**Files:**

- Create: `src/core/geometry/clip.ts`
- Modify: `src/core/rooms/detect.ts` (`roomShape`, `roomArea`), `src/core/validate/layout.ts`, `src/core/index.ts`, `docs/validation.md`
- Test: `tests/core/geometry/clip.test.ts`, `tests/core/rooms.test.ts`, `tests/core/layout.test.ts`

**Interfaces:**

- Produces:

  ```ts
  function polygonOverlapArea(a: Vec2[], b: Vec2[]): number; // ≥ 0, simple polygons, any winding
  function roomShape(
    floor: Floor,
    room: Room,
    kind: 'center' | 'inner',
  ): { outer: Vec2[]; holes: Vec2[][] };
  // holes: 'center' = hole node loops; 'inner' = hole loops OUTSET by half each wall's thickness
  function roomArea(floor, room, kind = 'inner'): number; // outer minus holes
  ```

- [ ] **Step 1: Write failing tests**
  - `clip.test.ts`: two unit squares offset by 0.5 → `0.5`; disjoint → `0`; identical L-shapes (concave, area 3) → `3`; L-shape vs square covering its notch → overlap of the arms only; CW input gives the same result.
  - `rooms.test.ts`: 6×6 room (`thickness 0.2`) with a 2×2 hole box (`thickness 0.1`): `roomArea(…,'center')` = `36 - 4`; `'inner'` = `5.8² - 2.1²`; `roomShape(…,'inner').holes[0]` is the 2.1×2.1 square.
  - `layout.test.ts` → `validateLayout`: `room-degenerate` for a hole that crosses the outer ring, for two overlapping holes, for net inner area < 1; a hole touching the outer ring at one node is **valid**. `column-size` (blocking via `layoutValidator`) for `width 0`, `width 2.5`, `depth -1`; `columns-overlap` reported by `validateLayout` but not by `layoutValidator`; `site-not-simple` for a bow-tie site (non-blocking).
- [ ] **Step 2: Run** the three test files — FAIL.
- [ ] **Step 3: Implement.** `polygonOverlapArea` uses a signed fan decomposition of `a` so no ear clipping is needed:
  ```
  area(a ∩ b) = | Σ_i sign(T_i) · area(clipConvex(b, T_i)) |,  T_i = (a0, ai, ai+1)
  ```
  where `clipConvex` is Sutherland–Hodgman of `b` against the (CCW-ordered) triangle; S–H output may contain degenerate edges for a concave `b` but its signed area is exact. Hole containment uses `polygonContainsPolygon` (touch-tolerant). Layout validator scopes: columns touched by the change set for `column-size`. Document the codes in `docs/validation.md` and README's table.
- [ ] **Step 4: Run** `pnpm test && pnpm typecheck && pnpm lint` — PASS.
- [ ] **Step 5: Commit** `feat(core): overlap area, rooms with holes, column and site checks`

---

### Task 3: Room detection with bridges, pinches and holes

**Files:**

- Modify: `src/core/rooms/detect.ts`, `src/core/xml/parse.ts` (load path stores `holes`)
- Test: `tests/core/rooms.test.ts`

**Interfaces:**

- Produces: `function detectRooms(floor: Floor): DetectedRoom[]` with `interface DetectedRoom { walls: Id[]; nodes: Id[]; holes: Id[][] }` (walls CCW, holes CW). Faces with inner net area `< MIN_ROOM_AREA` or non-simple outer rings are dropped. Exported from `src/core/index.ts` (type too).

- [ ] **Step 1: Write failing tests** (`describe('detectRooms')`, existing cases must stay green):
  - `'partial wall leaves one room'`: 4×4 room plus a wall from the middle of `w1`'s node to a free point → 1 room, wall not in `walls`.
  - `'inner box is a hole'`: 6×6 + free-standing 2×2 box → 2 rooms; the outer has `holes` = the box's 4 walls CW, the box room has none.
  - `'bridge to inner box is ignored'` _(Review Focus 1)_: as above plus a wall joining an outer corner to a box corner → same 2 rooms, bridge in neither.
  - `'pinched hole'` _(Review Focus 2)_: box sharing one node with the outer ring → 2 rooms, outer has the hole.
  - `'nested'`: box inside box inside room → each hole goes to the smallest containing face only.
  - `'tiny face dropped'`: two parallel walls 0.3 m apart closing a 0.3×2 strip → no room for the strip.
  - Loading a floor with no `<room>` and an inner box gives the outer room `holes`.
- [ ] **Step 2: Run** `pnpm vitest run tests/core/rooms.test.ts` — FAIL.
- [ ] **Step 3: Implement.** Replace degree-1 pruning with **bridge removal** (iterative Tarjan bridge finding; a dangling chain consists of bridges, so it is covered). Trace faces as today on the remaining graph. A traced loop that revisits a node is split at each repeated node into sub-loops; the one with positive area is a candidate outer ring, negative sub-loops become its holes. Negative-area loops that are whole components' outer boundaries are assigned as holes to the smallest positive face of another component that contains them (`polygonContainsPolygon`); unassigned ones are dropped. Filter by `MIN_ROOM_AREA` using `roomArea`-equivalent net inner area.
- [ ] **Step 4: Run** `pnpm test && pnpm typecheck && pnpm lint` — PASS.
- [ ] **Step 5: Commit** `feat(core): detect rooms with holes, ignoring bridges and pinches`

---

### Task 4: `syncRooms` with identity matching

**Files:**

- Create: `src/core/rooms/sync.ts`
- Test: `tests/core/sync.test.ts`

**Interfaces:**

- Consumes: `detectRooms`, `roomShape`, `polygonOverlapArea`.
- Produces: `function syncRooms(before: Readonly<Floor>, after: Readonly<Floor>): EntityChange[]` — room changes only, computed against `before.rooms`; never mutates its inputs. New room ids from `createId()`.

- [ ] **Step 1: Write failing tests** (floors built by hand; `before` has named rooms with finishes):
  - `'same face keeps identity'`: `after` = `before` with `w1` split into `w1` + `w9` → one change updating `r1.walls` only; name, finish, id kept.
  - `'split room'`: a wall added across a 4×6 room near one end (parts 4×4 and 4×2) → `r1` (4×4 part) keeps name/finish; a created room with `name ''`, same `floorFinish`.
  - `'merged rooms'`: two rooms 4×4 (`Big`) and 4×2 (`Small`), the shared wall removed → `Big`'s id on the merged face, `Small` deleted.
  - `'new face'`: rooms appear where none were → created with empty name, no finish.
  - `'loaded room that is not a face is deleted'`.
  - `'hole does not steal identity'`: the room with a hole keeps its id; the box room (inside its outer ring) keeps its own id — matching uses **net** overlap (holes subtracted).
  - `'no-op'`: `syncRooms(f, f)` → `[]`.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement.** Net overlap of rooms A, B (outer O, holes H, holes disjoint and inside O):
  ```
  ov(A,B) = ov(Oa,Ob) − Σ ov(Ha,Ob) − Σ ov(Oa,Hb) + Σ ov(Ha,Hb)
  ```
  using `'center'` shapes. Assignment per spec: each old room's identity goes to the face it overlaps most (ties: larger face area, then smallest node id in the face); if two old rooms pick the same face, the one with the larger overlap wins and the other is deleted; faces left over become new rooms, inheriting `floorFinish` (not name) from the old room they overlap most, if any.
- [ ] **Step 4: Run** `pnpm test && pnpm typecheck && pnpm lint` — PASS.
- [ ] **Step 5: Commit** `feat(core): syncRooms keeps room identity across topology changes`

---

### Task 5: Draft infrastructure, `splitWall`, `removeWall`, `removeNode`

**Files:**

- Create: `src/core/topology/draft.ts`, `src/core/topology/ops.ts`, `src/core/commands/structure.ts`
- Modify: `src/core/index.ts`, `README.md` (Commands section)
- Test: `tests/core/structure.test.ts`

**Interfaces:**

- Produces:

  ```ts
  // draft.ts
  function diffFloors(before: Readonly<Floor>, after: Readonly<Floor>): EntityChange[]; // floor kinds only, deterministic order: node, wall, opening, item, column, room
  function structural(label: string, mutate: (draft: Floor, ctx: CommandContext) => void): Command;
  //  run = clone ctx.floor → mutate → append syncRooms(ctx.floor, draft) → diffFloors
  function wallsAt(floor: Readonly<Floor>, node: Id): Wall[];
  // ops.ts (mutate a draft; throw H3xValidationError)
  function splitAt(draft: Floor, wallId: Id, at: Vec2, newWallId: Id, newNodeId: Id): Id; // returns node id
  function removeWallIn(draft: Floor, wallId: Id): void; // + its openings / wall items + orphaned nodes
  function removeNodeIn(draft: Floor, nodeId: Id): void; // merge-or-delete rule from the spec
  const COLLINEAR_TOL = (1 * Math.PI) / 180;
  // structure.ts
  function splitWall(wallId: Id, at: Vec2): Command & { createdId: Id }; // createdId = new node
  function removeWall(wallId: Id): Command;
  function removeNode(nodeId: Id): Command;
  ```

  Error codes: `not-found`, `split-too-short` (a half `< MIN_WALL_LENGTH`), `split-cuts-opening`, `merge-drops-opening`.

- [ ] **Step 1: Write failing tests** (via `H3xDocument.execute`, using `oneRoomFloor` / `twoRoomFloor` and hand-built floors):
  - `splitWall('w1', {x:1.5, y:0.02})`: point projected to `(1.5,0)`; `w1` keeps id from `a` to the new node, new wall to old `b`, thickness / height / finishes copied; an opening at offset 3 moves to the new wall with offset `1.5`; the room keeps id and name with 5 walls; **one** undo restores everything (Review Focus 3).
  - Rejections: split 0.1 m from an end → `split-too-short`; split through the middle of a 0.9 m door whose center half cannot hold it → `split-cuts-opening`; a straddling opening that fits in its center's half is clamped.
  - `removeWall` on a shared wall merges the two rooms (bigger keeps name); on an outer wall deletes the room; deletes the wall's openings and wall items; orphaned nodes deleted.
  - `removeNode`: degree-2 collinear node (after a split) → walls merged back, opening offsets re-based, room keeps id; degree-2 corner of a 4×4 room → triangle room keeps id; degree-3 T node → node and its 3 walls deleted; merge where an opening no longer fits → `merge-drops-opening`.
  - `diffFloors(f, f)` → `[]`.
- [ ] **Step 2: Run** `pnpm vitest run tests/core/structure.test.ts` — FAIL.
- [ ] **Step 3: Implement.** Opening / wall-item re-basing reuses `openingRange` / `wallUsableRange` from `validate/layout.ts` against the draft. The merged wall in `removeNodeIn` keeps the first wall id in id order, its thickness, height, finishes, and runs between the outer nodes; offsets of the other wall's items are re-based onto it.
- [ ] **Step 4: Run** `pnpm test && pnpm typecheck && pnpm lint` — PASS.
- [ ] **Step 5: Commit** `feat(core): structural commands split, remove wall and remove node with room re-sync`

---

### Task 6: `addWall`

**Files:**

- Modify: `src/core/commands/structure.ts`, `src/core/topology/ops.ts`, `src/core/index.ts`, `README.md`
- Test: `tests/core/addWall.test.ts`

**Interfaces:**

- Produces:

  ```ts
  type WallEnd = { node: Id } | { at: Vec2 };
  function addWall(input: {
    from: WallEnd;
    to: WallEnd;
    thickness: number;
    height?: number;
  }): Command & { createdId: Id; endNodeId: Id };
  ```

  `createdId` = id of the wall touching `from` (after crossing splits there may be several new walls; ids pre-generated for the first, others from `createId()`); `endNodeId` = the node at `to` (existing or pre-generated). If `from`/`to` already joined by a wall, the command returns no changes and `createdId` is that wall's id (the tool reads it from `doc.floor` after execute). Errors: `not-found`, `wall-too-short` (from == to or < `MIN_WALL_LENGTH`), `walls-overlap`.

- [ ] **Step 1: Write failing tests** _(Review Focus 4 included)_:
  - Empty floor: 4 chained `addWall` calls closing a 4×4 square → 1 room after the 4th, none before.
  - `{at}` within `GEOM_TOL` of a node reuses it; `{at}` on a wall interior splits it (T) and the existing room keeps id.
  - A wall across a room from wall to wall splits the room (Task 4 rule).
  - A wall crossing two existing walls creates 2 crossing nodes and 3 new wall pieces; no `walls-cross` issue.
  - A wall passing exactly through an existing node is split at that node.
  - Collinear overlap with an existing wall → `walls-overlap`; partial collinear touch at an end only → allowed.
  - Same endpoints as an existing wall → no-op, nothing in history.
  - Free-end partial wall from a room's wall into the room → room keeps id, `walls` now includes the split halves.
  - Each `addWall` is exactly one undo step.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** in the draft: resolve ends (node / snap-to-node within `GEOM_TOL` / split wall), collect crossings of the new segment with every existing wall (segment intersection; touching at an existing node counts as passing through that node), sort by parameter, split each crossed wall, then add one wall per consecutive pair of points.
- [ ] **Step 4: Run** `pnpm test && pnpm typecheck && pnpm lint` — PASS.
- [ ] **Step 5: Commit** `feat(core): addWall with T-junctions, crossings and room re-sync`

---

### Task 7: `mergeNodes` and `dropNode`

**Files:**

- Modify: `src/core/commands/structure.ts`, `src/core/topology/ops.ts`, `src/core/index.ts`, `README.md`
- Test: `tests/core/structure.test.ts`

**Interfaces:**

- Produces:

  ```ts
  function mergeNodes(keep: Id, drop: Id): Command;
  function dropNode(nodeId: Id, target: { node: Id } | { wall: Id; at: Vec2 }): Command;
  ```

  `dropNode` moves `nodeId` onto the target and merges in one change list (node target → `mergeNodesIn`; wall target → `splitAt` + merge). Self-loop walls deleted; duplicate walls: the one with more openings + wall items survives, then smaller id; the loser's openings are deleted.

- [ ] **Step 1: Write failing tests**: `mergeNodes` of two nodes of an open L chain closes nothing but joins walls; merging the free end of a partial wall onto the opposite wall's node splits a room into two (identity rule); merging two nodes joined by a wall deletes that wall; duplicate-wall resolution; `dropNode(n, {node})` where `n` and target share a wall (the case where a plain `moveNode` would fail `wall-too-short`) succeeds in one undo step; `dropNode(n, {wall, at})` makes a T and room re-sync.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** in `ops.ts` as `mergeNodesIn(draft, keep, drop)`; commands wrap with `structural`.
- [ ] **Step 4: Run** `pnpm test && pnpm typecheck && pnpm lint` — PASS.
- [ ] **Step 5: Commit** `feat(core): mergeNodes and dropNode`

---

### Task 8: `pushPullWall`

**Files:**

- Modify: `src/core/commands/structure.ts`, `src/core/index.ts`, `README.md`
- Test: `tests/core/pushPull.test.ts`

**Interfaces:**

- Produces: `function pushPullWall(wallId: Id, distance: number): Command` — `+` = left normal of `a→b`. Per end: degree 1 → end moves; exactly one other wall within `COLLINEAR_TOL` of the wall normal → node slides along it; otherwise connector (copies thickness / height). `|distance| < GEOM_TOL` → no changes. A connector `< MIN_WALL_LENGTH` → `wall-too-short` (the tool treats it as "nothing yet").

- [ ] **Step 1: Write failing tests**: 4×4 room, push `w1` by `-1` (outward, CCW room) → still 4 walls, room 4×5, same id; pull by `+1` → 4×3; split `w1` twice at x=1 and x=3 then push the middle segment outward 1 m → 2 connectors, room has 8 walls and area `16 + 2`, same id; same inward → recess area `16 − 2`; free-end partial wall → end just moves; push of `0.2` with connectors → `wall-too-short`; one undo step each.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** with `structural`.
- [ ] **Step 4: Run** `pnpm test && pnpm typecheck && pnpm lint` — PASS.
- [ ] **Step 5: Commit** `feat(core): pushPullWall for square bump-outs and recesses`

---

### Task 9: Column and site commands

**Files:**

- Create: `src/core/commands/columns.ts`
- Modify: `src/core/index.ts`, `README.md`
- Test: `tests/core/columns.test.ts`

**Interfaces:**

- Produces:
  ```ts
  function addColumn(
    input: Omit<Column, 'id' | 'rotation'> & { rotation?: number },
  ): Command & { createdId: Id };
  function moveColumn(
    id: Id,
    patch: Partial<Pick<Column, 'x' | 'y' | 'rotation' | 'width' | 'depth' | 'shape' | 'height'>>,
  ): Command;
  function removeColumn(id: Id): Command;
  function setSite(points: Vec2[] | null): Command; // CW input stored CCW; < 3 points → 'site-invalid'
  ```
- [ ] **Step 1: Write failing tests**: add / move / remove with undo; `duplicate-id` on re-run of `addColumn`; `width 3` rejected by `column-size`; columns don't change rooms; `setSite` stores CCW, `null` clears, undo restores the previous site.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** following `objects.ts` patterns.
- [ ] **Step 4: Run** `pnpm test && pnpm typecheck && pnpm lint` — PASS.
- [ ] **Step 5: Commit** `feat(core): column and site commands`

---

### Task 10: Split `H3xPlan.ts` (no behaviour change)

**Files:**

- Create: `src/plan/reconcile.ts` (dirty-set computation and per-entity sync from `onChange` / `reconcileAll`), `src/plan/overlay.ts` (guides, dimensions layer)
- Modify: `src/plan/H3xPlan.ts` (target ≤ 350 lines)
- Test: existing `tests/plan/**` unchanged and green

**Interfaces:**

- Produces: `function dirtyEntities(floor: Readonly<Floor>, changes: EntityChange[]): Record<PlanKind, Set<Id>>` in `reconcile.ts` (pure, unit-tested in `tests/plan/reconcile.test.ts` with the corner-propagation case currently covered indirectly). Public `H3xPlan` API unchanged.

- [ ] **Step 1:** Write `tests/plan/reconcile.test.ts`: moving `n2` of `twoRoomFloor` dirties the walls at `n2`, their neighbours' walls, openings on those walls and both rooms.
- [ ] **Step 2:** Run — FAIL. **Step 3:** Move code. **Step 4:** `pnpm test && pnpm typecheck && pnpm lint` — PASS.
- [ ] **Step 5: Commit** `refactor(plan): split H3xPlan into reconcile and overlay modules`

---

### Task 11: Plan rendering of columns, site, room holes; new hit targets

**Files:**

- Modify: `src/plan/types.ts` (`PlanKind` += `'column' | 'site'`), `src/plan/shapes.ts`, `src/plan/render.ts`, `src/plan/hit.ts`, `src/plan/reconcile.ts`, `src/plan/style.ts`, `src/plan/H3xPlan.ts`
- Test: `tests/plan/shapes.test.ts`, `tests/plan/hit.test.ts`, `tests/plan/H3xPlan.test.ts`

**Interfaces:**

- Produces: `columnShape(c: Column): { kind: 'circle'; cx; cy; r } | { kind: 'polygon'; points: Vec2[] }`; `roomPath(shape: {outer; holes}): string` (one SVG path, `fill-rule="evenodd"`); `site` rendered as one dashed polygon in a layer under rooms; columns in a layer above walls. `hitTest` order: node > column > opening / item > wall > room > site outline (within `WALL_TOLERANCE_PX` of an edge only).

- [ ] **Step 1: Write failing tests**: square column rotated 45° → 4 corners; round → circle radius `width/2`; room with hole → path with 2 subpaths; clicking inside a hole hits the inner room / nothing, not the outer room; clicking a column inside a room hits the column; site edge hit, site interior not hit; `getElement('column', id)` exists after `addColumn`, removed after undo; the same element is kept across `moveColumn` (retained SVG).
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4:** `pnpm test && pnpm typecheck && pnpm lint` — PASS.
- [ ] **Step 5: Commit** `feat(plan): render and hit-test columns, site and rooms with holes`

---

### Task 12: Drawing snap

**Files:**

- Modify: `src/plan/snap.ts`, `src/plan/tools/Tool.ts` (`ToolContext.snapDraw`), `src/plan/H3xPlan.ts`
- Test: `tests/plan/snap.test.ts`

**Interfaces:**

- Produces:

  ```ts
  type DrawSnapTarget = { kind: 'node'; id: Id } | { kind: 'wall'; id: Id } | { kind: 'free' };
  interface DrawSnapResult extends SnapResult {
    target: DrawSnapTarget;
  }
  function snapDraw(
    p: Vec2,
    floor: Readonly<Floor>,
    opts: SnapOptions & { reach: number; from?: Vec2; extra?: Vec2[] },
  ): DrawSnapResult;
  // ToolContext: snapDraw(p: Vec2, from: Vec2 | undefined, disabled: boolean, extra?: Vec2[]): DrawSnapResult   (reach = 8 screen px)
  ```

  Priority: node within reach > closest point on a wall within reach > alignment (existing `snapPoint`) > angle lock to 45° steps from `from` (when the angle is within 5° of a step, project onto that ray, then grid-snap the length) > grid. `extra` = additional alignment / vertex points (site tool passes its own vertices). `disabled` → `{point: p, guides: [], target: free}`.

- [ ] **Step 1: Write failing tests** for each priority level and ties (node wins over wall at the same distance); angle lock at 44° snaps to 45°, at 30° does not.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4:** `pnpm test && pnpm typecheck && pnpm lint` — PASS.
- [ ] **Step 5: Commit** `feat(plan): drawing snap to nodes, walls, alignment, angles and grid`

---

### Task 13: `DrawWallTool`

**Files:**

- Create: `src/plan/tools/chain.ts`, `src/plan/tools/DrawWallTool.ts`
- Modify: `src/plan/H3xPlan.ts` (preview layer API, `segmentLengthRequest` event, `setPendingSegmentLength`), `src/plan/index.ts`
- Test: `tests/plan/DrawWallTool.test.ts`

**Interfaces:**

- Consumes: `addWall` (Task 6), `ToolContext.snapDraw` (Task 12).
- Produces:

  ```ts
  class DrawWallTool implements Tool { constructor(opts?: { thickness?: number; height?: number }) }
  // H3xPlan
  on(type: 'segmentLengthRequest', fn: (e: { from: Vec2; direction: Vec2; length: number }) => void): () => void
  setPendingSegmentLength(length: number): boolean   // commits the current segment at that length along the preview direction; false if no chain
  showPreview(segments: Array<[Vec2, Vec2]> | null, label?: { at: Vec2; text: string }): void   // @internal for tools
  ```

  `chain.ts` holds the shared click-chain logic: `points`, `lastHistoryMark` (the tool records `doc.canUndo` + a change-event counter to know whether the newest history entry is its own last click), `reset()`.

- [ ] **Step 1: Write failing tests** (fake DOM approach of `tests/plan/tools.test.ts`):
  - click, click, click, click on the start node → 4 walls, 1 room, 4 undo steps.
  - Clicking an existing wall mid-chain commits a T and ends the chain; clicking an existing node ends it.
  - Double-click ends the chain at the last point (no extra wall); Enter likewise.
  - Esc removes only the preview; committed walls stay.
  - Backspace after 2 walls → `doc.undo()` once, chain back one point; Backspace when the newest history entry is not the chain's → nothing.
  - `setPendingSegmentLength(3)` after the first click with the mouse heading +x → wall of exactly 3 m, chain continues from its end.
  - A rejected click (e.g. `walls-overlap`) → `plan.issues.rejected` set, chain unchanged.
  - _(Review Focus 5)_ external `doc.undo()` removing the chain's last node → the next move does not throw and the chain is reset.
  - `deactivate()` clears preview and chain.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4:** `pnpm test && pnpm typecheck && pnpm lint` — PASS.
- [ ] **Step 5: Commit** `feat(plan): DrawWallTool`

---

### Task 14: `DrawSiteTool` and `ColumnTool`

**Files:**

- Create: `src/plan/tools/DrawSiteTool.ts`, `src/plan/tools/ColumnTool.ts`
- Modify: `src/plan/index.ts`
- Test: `tests/plan/DrawSiteTool.test.ts`, `tests/plan/ColumnTool.test.ts`

**Interfaces:**

- Consumes: `chain.ts`, `setSite`, `addColumn`, `snapDraw` (site passes its vertices as `extra`; it ignores node / wall targets — only grid / alignment / own vertices).
- Produces: `class DrawSiteTool implements Tool`; `class ColumnTool implements Tool { constructor(opts?: { shape?: 'round' | 'square'; width?: number; depth?: number }) }` (defaults `square`, `0.3`).

- [ ] **Step 1: Write failing tests**: site — 4 clicks + click on first vertex → one `setSite`, one undo step; Esc cancels the polygon with no history; closing with < 3 points does nothing. Column — click places a column at the snapped point (node / wall line / grid), one undo step each, column selected after placement.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4:** `pnpm test && pnpm typecheck && pnpm lint` — PASS.
- [ ] **Step 5: Commit** `feat(plan): DrawSiteTool and ColumnTool`

---

### Task 15: `SelectEditTool` structural gestures

**Files:**

- Modify: `src/plan/tools/SelectEditTool.ts`
- Test: `tests/plan/SelectEditTool.test.ts`

**Interfaces:**

- Consumes: `splitWall`, `removeNode`, `removeWall`, `removeColumn`, `setSite`, `pushPullWall`, `dropNode`, `moveColumn`, `snapDraw`.

- [ ] **Step 1: Write failing tests**:
  - Double-click on a wall body → `splitWall` at the point, new node selected; double-click on a dimension still emits `lengthEditRequest`.
  - Delete and Backspace on a selected node / wall / column / site run the matching command; selection cleared; one undo step.
  - Column drag (snapped), arrow nudge, Esc cancels a column drag with no history.
  - Shift + wall drag → `pushPullWall` coalesced into one undo step; below 0.3 m on a segment that needs connectors the document is unchanged; Esc cancels; plain wall drag unchanged.
  - Node drag snapped onto another node: the move is not executed while snapped (target highlighted); release → `dropNode` in the same undo group as the drag; release onto a wall → T-junction.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4:** `pnpm test && pnpm typecheck && pnpm lint` — PASS.
- [ ] **Step 5: Commit** `feat(plan): insert / delete points, push-pull and join on drop`

---

### Task 16: 3D columns, site line, floors with holes

**Files:**

- Create: `src/three/columns.ts`, `src/three/site.ts`
- Modify: `src/three/floors.ts`, `src/three/scene.ts` (`GEOMETRY_KINDS` += `column`, `site`; `getColumnMesh(id)`; site line object), `src/three/index.ts`
- Test: `tests/three/columns.test.ts`, `tests/three/floors.test.ts`, `tests/three/scene.test.ts`, `tests/three/joins.test.ts`

**Interfaces:**

- Produces: `buildColumnGeometry(floor: Floor, c: Column): BufferGeometry` (box rotated by `rotation`, or cylinder with 24 segments, from `floor.elevation` to `+ (c.height ?? floor.wallHeight)`); `buildSiteLine(site: Site): LineLoop` at y = 0.005; `buildFloorGeometry` uses `roomShape(…,'inner')` holes.

- [ ] **Step 1: Write failing tests**: column bounding boxes (square 0.3 rotated 0 → 0.3×0.3×wallHeight; round → diameter 0.35); mesh identity kept across `moveColumn`, removed on `removeColumn`; floor with a hole has triangle area = net area; site line has 4 points; a wall with a free end gets a square cap (joins test for degree 1, existing behaviour pinned).
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4:** `pnpm test && pnpm typecheck && pnpm lint` — PASS.
- [ ] **Step 5: Commit** `feat(three): columns, site outline and floors with holes`

---

### Task 17: Example page, docs, changelog

**Files:**

- Modify: `examples/index.html`, `examples/main.ts`, `examples/lengthInput.ts` (reuse for segment length), `README.md`, `CHANGELOG.md`, `docs/roadmap.md` (M4 status stays "Planned" until merged — leave it)
- Test: `tests/plan/example-length-input.test.ts` extended

- [ ] **Step 1:** Test: the example's segment input calls `plan.setPendingSegmentLength` on Enter.
- [ ] **Step 2:** Run — FAIL. **Step 3:** Throwaway toolbar: Select, Draw wall, Draw site, Column (round / square), Clear (`H3xDocument.create()` and re-attach plan + viewer), Load sample. README: new commands, tools, events; CHANGELOG entry.
- [ ] **Step 4:** `pnpm test && pnpm typecheck && pnpm lint && pnpm build` — PASS. Run `pnpm dev`, check in a browser: draw a 2-room house from empty, insert point + push a bump-out, delete a corner, add a partial wall, an inner light-well box, columns, site; 3D follows; undo / redo through all of it.
- [ ] **Step 5: Commit** `docs: milestone 4 example page, README and changelog`
