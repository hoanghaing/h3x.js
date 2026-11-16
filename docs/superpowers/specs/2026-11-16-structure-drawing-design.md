# Milestone 4: Structure drawing — design

Date: 2026-11-16. Status: reviewed, awaiting user approval.

## Intent

h3x.js is a logic library for a realtime, XML-backed house editor: every edit event updates the
`H3xDocument`, so the XML and every view are current after each event. It ships classes, methods
and mouse / keyboard interaction, **no form inputs or editor chrome** (that is h3xEditor,
milestone 9).

Milestones 1–3 can only edit a fixed layout: nodes and walls move, but none can be added or
removed. A real editor starts from an empty page, and a template layout is too rigid: dragging
walls only deforms the polygon, you cannot add a corner to make a room bump out, or remove one.
Milestone 4 makes the structure fully editable in two ways the user asked for:

1. **Edit a template**: insert a point on a wall, delete a point, push / pull a wall segment
   so that new perpendicular walls are created (a square bump-out or recess), merge nodes.
2. **Draw from scratch**: click a point, then the next, wall by wall; closing the chain makes a
   room. Rooms next to each other share walls.

Rooms stay derived from closed wall loops and are re-detected after every structural change,
keeping their identity (id, name, floor finish). A wall with a free end (a partial wall that
screens a space without closing it) is valid and leaves the room whole. Free-standing
**columns** (round or square, load-bearing) are part of the structure too. A **site / lot
boundary** is a drawing reference.

## Goals

- Core commands for every structural edit, each producing **one undo step** that includes the
  room re-detection, so the XML is always consistent after each command.
- Room identity is kept across edits by a deterministic matching rule.
- `<site>` (lot boundary polygon) and `<column>` in the XML format, the data model, the 2D plan
  and the 3D view.
- Plan tools: `DrawWallTool`, `DrawSiteTool`, `ColumnTool`; `SelectEditTool` gains insert point,
  delete point / wall / column, push / pull, node merge on drop, column drag.
- Example page: start empty or from the sample layout, switch tools, see 3D follow.

## Non-goals

- Multiple floors (milestone 5). Everything still edits `floors[0]`.
- Slab thickness, stairs, roof (milestones 5–7).
- Site as a constraint: no setback rules, no "building outside lot" issue (deferred; the data
  shape must not block adding it later).
- Virtual room separator lines (a boundary that is not a wall, to split an open space into named
  zones). Idea for later; nothing in the design may block it (e.g. a future wall `kind`).
- Curved walls. Furniture placement (milestone 8).
- Any toolbar, palette, input box inside the library. Tool switching is the host's job; the
  example page has throwaway buttons.

## Anti-goals (failure even if it "works")

- A room losing its name / finish because a wall was split, a partial wall was attached, or a
  point was inserted on its boundary.
- One user action producing several undo steps, or undo leaving rooms out of sync with walls.
- The document committing an invalid state (crossing walls, zero-length walls, duplicate walls
  between the same two nodes).
- Openings or wall items silently deleted by a split or merge when they still fit.
- `src/core` importing DOM; `h3x/plan` importing `three`.

## Constraints

- Conventions of `CONTRIBUTING.md`: TDD, pure commands (`run` never mutates `ctx.floor`),
  `GEOM_TOL`, no module-level mutable state, typed errors.
- No new runtime dependencies.
- XML changes are additive: `FORMAT_VERSION` stays 1. Files written by milestone 3 load
  unchanged.
- Existing gestures of `SelectEditTool` keep working (node drag, wall drag, nudge, Esc,
  double-click on a dimension → `lengthEditRequest`).
- Validators keep rejecting `walls-cross`, `wall-too-short`; structural commands must produce
  states that pass them (split at crossings instead of failing).

## Approaches considered

1. **Every structural command re-syncs rooms itself (chosen by the user).** After computing the
   wall / node changes, the command runs room detection on the resulting floor and appends room
   changes (create / update walls list / delete), matched to the old rooms. One command, one undo
   step, XML always consistent.
2. Commands only touch walls; tools call a separate `syncRooms()`. Simpler commands, but a host
   that forgets the call has stale rooms, and one action becomes two undo steps.
3. Rooms as independently drawn polygons. Flexible (rooms without walls), but walls and polygons
   drift apart, and it breaks the current model. Rejected.

## Design

### Data model and XML

**Site** (project level, the ground is shared by all floors):

```ts
interface Site { points: Vec2[] } // CCW, >= 3 points, simple polygon
interface Project { …; site?: Site }
```

```xml
<h3x version="1" unit="m">
  <meta …/>
  <site points="0,0 12,0 12,20 0,20"/>
  <floor …>…</floor>
</h3x>
```

`points` is whitespace-separated `x,y` pairs. On read a CW list is reversed to CCW; fewer than 3
points or a non-finite number is an `H3xParseError` (`element: site`). At most one `<site>`.
Self-intersection is not a parse error (it is reported by `validateLayout` as non-blocking
`site-not-simple`). Editing the site goes through a command and undo like everything else; the
change model gets a `site` kind (single entity, id `"site"`) whose `applyChanges` target is the
project, not the floor. _(How the change plumbing reaches the project is the builder's call; the
constraint is: site edits are undoable and appear in `change` events.)_

**Column** (per floor, entity kind `column`):

```ts
interface Column {
  id: Id;
  x: number;
  y: number; // center
  shape: 'round' | 'square';
  width: number; // diameter for round; side along local x for square
  depth?: number; // square only, side along local y; default = width
  rotation: number; // radians CCW, square only (ignored for round)
  height?: number; // default floor wallHeight
}
```

```xml
<column id="c1" x="4" y="3" shape="square" width="0.3" depth="0.3" rotation="0"/>
<column id="c2" x="8" y="3" shape="round" width="0.35"/>
```

Columns are sorted after items when writing. Bad `shape` is a parse error. Columns do not take
part in room detection. A column may stand free, touch, or sit inside a wall (no collision issue
with walls). Blocking validation: `width` / `depth` > 0 and ≤ 2 m, finite numbers. Non-blocking:
two columns overlapping (`columns-overlap`). Floor items vs columns collision is milestone 8.

**Room holes** _(decided with the user after review)_. A closed loop of walls inside a room that
does not touch the room's walls (an atrium / light well, a free-standing closet block) is a
**hole** of that room:

```ts
interface Room { …; holes?: Id[][] } // each hole: wall ids in loop order, stored clockwise
```

```xml
<room id="r1" walls="w1 w2 w3 w4" holes="w5 w6 w7 w8" name="Living"/>
```

`holes` is a list of wall loops separated by `;`, each loop whitespace-separated wall ids (same
rules as `walls`: must close, a CCW list is reversed to CW on read, a broken loop is a parse
error with `attribute: holes`). Omitted when empty. The faces inside the hole's walls are rooms of
their own (e.g. "Light well", "Closet") as usual. Effects:

- Room area (`roomArea`, 'inner' kind) subtracts each hole's outline outset by half the wall
  thickness; `MIN_ROOM_AREA` applies to the net area.
- `roomPolygon` stays the outer ring; a new `roomShape(floor, room, kind)` returns
  `{ outer, holes }` and is what the plan fill, the 3D floor and area use.
- 2D: room fill is one path with `fill-rule="evenodd"`; the label is placed inside the net area.
- 3D: the floor mesh is triangulated with holes (`ShapeUtils` supports holes).
- Validation: `room-degenerate` also when a hole is not closed, not simple, not strictly inside
  the outer ring, or overlaps another hole.
- This is the base for the slab opening of stairs in milestone 6.

`docs/xml-format.md` and `docs/validation.md` are updated.

### Topology rules (core)

- **Endpoints.** A wall endpoint is given as `{ node: Id }` (existing node) or `{ at: Vec2 }`
  (new point). An `at` point within `GEOM_TOL` of an existing node reuses it; on the interior of
  an existing wall it splits that wall there (T-junction).
- **Crossings.** A new wall that crosses existing walls splits both at each crossing point
  (new shared node). A new wall collinear and overlapping an existing wall is rejected with
  `walls-overlap`. This is an input check inside the structural commands only, **not** a new
  validator, so files from milestone 3 keep loading unchanged.
- **No duplicates.** A wall between two nodes that are already joined by a wall is a no-op
  (returns the existing wall id).
- **Free ends are valid.** Degree-1 nodes (partial walls) are allowed. Degree-0 nodes are deleted
  by the command that orphans them.
- **Split** (`splitWall(wallId, at)`): `at` is projected onto the wall; both halves must be
  ≥ `MIN_WALL_LENGTH`. The original id stays on the half from `a`, the other half gets a new id.
  Both keep thickness, height, finishes. Each opening / wall item goes to the half containing its
  center, offset re-based; one that straddles the split point is clamped into the half holding
  its center if it fits there, otherwise the split is rejected (`split-cuts-opening`, blocking).
- **Remove node** (`removeNode`): degree 2 and the two walls roughly collinear (angle within
  `COLLINEAR_TOL`, builder picks ≈ 1°)? → **merge** them into one wall (keeps the id of the first
  wall in id order, its thickness, height, finishes; openings / wall items re-based). Degree 2 but
  not collinear → merge as well, into a straight wall between the outer nodes (this is how a user
  "deletes a corner"); openings / items that no longer fit are clamped, and if they cannot fit the
  command is rejected (`merge-drops-opening`). Degree 1 or ≥ 3 → delete the node and every wall
  attached to it (with their openings / wall items).
- **Remove wall** (`removeWall`): deletes the wall, its openings and wall items, and any node left
  with degree 0. Rooms re-sync.
- **Merge nodes** (`mergeNodes(keep, drop)`): walls of `drop` are re-attached to `keep`; a wall
  that would join `keep` to itself is deleted; a resulting duplicate wall is deleted (the one with
  more openings / items wins, then id order).
- **Drop node** (`dropNode(nodeId, target)`, target = `{ node: Id }` or `{ wall: Id, at: Vec2 }`):
  one command that moves the node onto the target and merges it (node target: `mergeNodes`;
  wall target: split the wall at that point and merge, a T-junction). Needed because the
  intermediate "node on top of node" state would fail `wall-too-short`. The plan uses it at the
  end of a node drag.
- **Push / pull** (`pushPullWall(wallId, distance)`): moves the wall along its normal by
  `distance` (signed, + is the left normal) and, at each end, inserts a new node and a new
  connector wall from the old node position to the moved end, so neighbours stay where they are
  and the bump-out / recess is square. Connector walls copy the pushed wall's thickness and
  height. Per end, decided independently _(designer's call after review)_:
  - the end node has degree 1 (free end): no connector, the end just moves;
  - the end has exactly one other wall and it runs along the push direction (within
    `COLLINEAR_TOL` of the wall normal, the usual case of a rectangle's wall): no connector, the
    node slides along that neighbour, which gets longer or shorter (same as `moveWall` today);
  - otherwise (neighbour collinear with the pushed wall, i.e. the wall was split by an inserted
    point, or several walls meet there): insert a connector wall.
    So pushing a whole wall of a rectangle just moves it; pushing the middle segment between two
    inserted points makes a square bump-out / recess. A connector shorter than `MIN_WALL_LENGTH`
    is not committed: during a live Shift + drag, distances below that threshold show only the
    snap guides and leave the document unchanged; releasing there is a no-op.
- **Columns**: `addColumn`, `moveColumn(id, patch)`, `removeColumn`. No topology effect.
- **Site**: `setSite(points | null)`.

Every structural command validates its input and throws `H3xValidationError` with `not-found` /
the codes above; resulting states are then checked by the existing validators.

### Room re-sync (core)

A pure function `syncRooms(before: Floor, after: Floor): EntityChange[]` used by every structural
command (add / remove / split wall, remove / merge nodes, push / pull). `moveNode`, `moveWall`,
`setWallLength` keep the topology and do **not** re-sync (their room walls stay valid).

1. Detect faces on `after` with `detectRooms` (dangling chains are already pruned, so partial
   walls are ignored). Then assign holes: for each connected component of the remaining wall
   graph, its outer boundary loop (the dropped outer face) becomes a hole of the smallest face of
   another component that strictly contains it. A component not inside any face is just a
   separate building part (no hole). Faces whose inner area is below `MIN_ROOM_AREA` or that are degenerate are
   **not** made rooms (no issue raised; a tiny gap between walls is not an error).
2. Match each old room to new faces by **overlap area** of their center polygons. Each new face
   takes the old room with the largest overlap; each old room's identity goes to at most one face:
   the face with the largest overlap with it. Ties break by face area, then by smallest node id.
   - Room split in two: the larger part keeps id, name, finish; the other gets a new id, the
     same finish and an empty name.
   - Two rooms merged: the face keeps the room that overlaps it most (the larger one); the other
     room is deleted.
   - New face with no overlap: new room, empty name, no finish.
   - Old room with no face: deleted.
3. Emit room changes: update `walls` where it changed (stored CCW as today), create, delete.

How overlap area is computed is left to the builder (polygon clipping of simple, possibly
concave polygons, or a wall-lineage heuristic with area tie-break) as long as the rules above
hold and it is deterministic. Rooms loaded from a file that do not correspond to any face are
deleted on the first structural edit (documented).

### Plan (`h3x/plan`)

**First, split `H3xPlan.ts`** (~600 lines) into smaller modules (rendering of each entity kind,
selection, overlay / guides) without behaviour change, so the new entity kinds fit. `HitTarget`
gains `column` and `site` (site vertices are not individually hit in milestone 4, only the
outline for selection / delete).

Rendering: site outline as a dashed polygon under everything; columns as filled shapes above
walls; walls with a free end draw a square end cap; rooms, labels, dimensions as today.

**Snapping** (shared by all drawing tools): existing node > point on a wall > alignment with
nodes (horizontal / vertical) > angle lock at 45° steps from the previous point > grid. Alt
disables snapping (as today). Guides shown as today.

**`DrawWallTool`** (options: `thickness`, default `0.2`; `height` default floor height):

- Click: first point. Move: rubber-band preview wall with live length. Click: commits a wall
  (`addWall`) and continues from its end. Each click is its own undo step.
- Clicking the start node of the current chain, or any existing node / wall, commits the wall
  and ends the chain (rooms appear through re-sync).
- Double-click or Enter ends the chain at the last point; Esc cancels the preview segment (the
  committed walls stay); Backspace calls `doc.undo()` once if the newest history entry is this
  chain's last click (the tool tracks that), which also reverts the splits and room re-sync of
  that click, and moves the chain back one point; otherwise it does nothing.
- Emits `lengthEditRequest`-style event while drawing so a host can type the segment length
  (`segmentLengthRequest`, with `plan.setPendingSegmentLength(len)`); the example page wires a
  throwaway input.

**`DrawSiteTool`**: same click-chain interaction, closes on the first point; commits one
`setSite` at close. Esc cancels the whole polygon. Snaps to grid / alignment / site vertices.

**`ColumnTool`** (options: `shape`, `width`, `depth`): click places a column (snapped: node,
wall center line, grid). One undo step per column.

**`SelectEditTool` additions:**

- Columns: select, drag (snapped), nudge with arrows, Delete removes.
- **Insert point**: double-click on a wall body (not on a dimension, which keeps opening the
  length editor) → `splitWall` at that point; the new node is selected.
- **Delete / Backspace** on selection: node → `removeNode`; wall → `removeWall`; column →
  `removeColumn`; site → `setSite(null)`.
- **Push / pull**: dragging a wall with **Shift** held runs `pushPullWall` live (one coalesced
  undo step, Esc cancels like other drags). Without Shift, wall drag behaves as today.
- **Join on drop**: while a node drag is snapped onto another node or onto a wall, the move is
  previewed (guides + highlight of the target) instead of executed; releasing there runs
  `dropNode` in the same coalesced undo step as the drag. Releasing elsewhere ends the drag as
  today.

### 3D (`h3x/three`)

- Columns: box (square, rotated) or cylinder (round) from floor to height, own mesh per id,
  same identity / disposal rules as walls. `getColumnMesh(id)`.
- Site: a flat outline (line loop) on the ground plane, slightly above 0 to avoid z-fighting.
  No ground fill in milestone 4.
- Free wall ends get a square end cap (check `src/shared/walls/joins.ts` already handles degree
  1; add tests).
- The scene already rebuilds on node / wall / room changes; add `column` and `site` to the
  rebuild trigger.

### Example page

Toolbar buttons (throwaway): Select, Draw wall, Draw site, Column, Clear (new empty document),
Load sample. A length input for the segment being drawn. Plan and 3D side by side as today.

### Testing

- Core: unit tests per command (topology outcomes, openings re-based, rejections), `syncRooms`
  cases (split, merge, partial wall attached keeps identity, point inserted keeps identity,
  push / pull keeps identity, tiny face skipped, loaded non-face room deleted), XML round trip
  for `<site>` and `<column>`, undo / redo of every command restores rooms exactly.
- Plan: tool state machines with the same fake-DOM approach as milestone 3; snapping order.
- 3D: column meshes, site line, free end caps.
- Browser check on the example page before the PR.

## Decided with the user

- Lot boundary is only a drawing reference in milestone 4 (option A).
- Two drawing workflows: edit a template (insert / delete points, push / pull) and draw from
  scratch by chaining points.
- Push / pull creates perpendicular connector walls (option A), as a mode next to the existing
  wall drag.
- Rooms re-sync inside every structural command (approach 1).
- Partial walls with free ends are valid and do not split a room.
- Free-standing load-bearing columns, round or square, are in scope.
- A closed wall loop inside a room without touching it is a hole of that room (option A):
  `holes` on `<room>`, net area, floor with a cut-out in 2D and 3D.

## Designer's calls (user may override)

- Split keeps the original id on the half from node `a`; the larger part of a split room keeps
  identity; merged rooms keep the larger room.
- Faces smaller than `MIN_ROOM_AREA` are silently not rooms.
- Deleting a degree-2 node always merges its walls (even at a corner); degree 1 / ≥ 3 deletes
  attached walls.
- Columns may sit in or against walls; only column–column overlap is reported (non-blocking).
- Site lives on the project, not the floor.
- Gestures: Shift + drag = push / pull, double-click on wall = insert point, Delete / Backspace
  removes the selection.

## Left to the builder

- Overlap-area computation for room matching (within the rules above).
- How `site` changes are routed through `applyChanges` / history.
- `COLLINEAR_TOL` value; snap priority radii.
- Exact module split of `H3xPlan.ts`.
- Names of events / methods beyond those given, if a clearer name fits the existing API.
