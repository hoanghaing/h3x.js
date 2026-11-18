# h3x.js

h3x is a TypeScript library for describing house floor plans and saving them as XML. The scene
is stored as XML, and each object type has its own element with matching attributes.

This release ships `h3x/core` (the package root `h3x` re-exports it):

- an editable document model (`H3xDocument`) with undo / redo and drag coalescing,
- commands for layout (nodes and walls), openings, items, finishes and room names,
- validators for layout and placement (collision, containment, wall ranges),
- room detection and room geometry helpers,
- XML read / write in the `<h3x version="1" unit="m">` format,
- small 2D geometry helpers (oriented boxes).

Two optional subpaths build on it: `h3x/three` (a three.js 3D view) and `h3x/plan` (an SVG 2D
plan editor). Both render the same `H3xDocument`, so an edit in one shows up in the other.

Units are meters, plan coordinates are `(x, y)`, and item `rotation` is in radians,
counter-clockwise, with `0` meaning the front faces +y. Core has no dependency on three.js or Vue.

## Install

```sh
pnpm add h3x   # or npm install h3x
```

```ts
import { H3xDocument } from 'h3x/core'; // or from 'h3x'
```

**XML loading needs a DOM.** `H3xDocument.fromXML` / `projectFromXML` use the global
`DOMParser`. Browsers provide it (along with `XMLSerializer`); in Node, install a DOM such as
jsdom and expose its `DOMParser` (and `XMLSerializer`, if your own code uses it) as globals,
for example with the vitest `jsdom` environment. `toXML` / `projectToXML` build the string
themselves and need neither, and everything else works without a DOM.

## Quick example

```ts
import { H3xDocument, moveNode, roomArea } from 'h3x/core';

const xml = `<h3x version="1" unit="m">
  <floor id="f1" level="0" elevation="0" wallHeight="3.2">
    <node id="n1" x="0" y="0"/><node id="n2" x="4" y="0"/>
    <node id="n3" x="4" y="3"/><node id="n4" x="0" y="3"/>
    <wall id="w1" a="n1" b="n2" thickness="0.2" height="3.2"/>
    <wall id="w2" a="n2" b="n3" thickness="0.2" height="3.2"/>
    <wall id="w3" a="n3" b="n4" thickness="0.2" height="3.2"/>
    <wall id="w4" a="n4" b="n1" thickness="0.2" height="3.2"/>
    <room id="r1" walls="w1 w2 w3 w4" name="Living room"/>
  </floor>
</h3x>`;

const doc = H3xDocument.fromXML(xml);
doc.execute(moveNode('n3', { x: 5, y: 3 }));
doc.execute(moveNode('n2', { x: 5, y: 0 }));
console.log(roomArea(doc.floor, doc.floor.rooms.r1!, 'center')); // 15
console.log(doc.toXML());
doc.undo(); // every command is undoable
```

This example is run by the test suite (`tests/core/public-api.test.ts`); keep both in sync.

## API overview

### Document

- `H3xDocument.create({ name?, presets? })`, `H3xDocument.fromXML(xml, { presets? })`,
  `H3xDocument.fromProject(project, { presets? })` (deep-cloned; throws `H3xValidationError`
  with `no-floor` or `bad-reference`).
- `doc.project`, `doc.floor` (live, read-only), `doc.toXML({ pretty? })`.
- `doc.execute(cmd, { coalesceKey? })` throws `H3xValidationError` on rejection;
  `doc.tryExecute(cmd, opts)` returns `{ ok: true } | { ok: false, issues }`;
  `doc.preview(cmd)` returns the issues without changing anything.
- `doc.undo()`, `doc.redo()`, `doc.canUndo`, `doc.canRedo`. Commands with the same
  `coalesceKey` merge into one undo step until `doc.endCoalesce()`;
  `doc.cancelCoalesce(key)` instead reverts that open group with no undo or redo trace (returns
  `false` if it is closed or netted out). Commands that change nothing add no undo step and emit
  no event.
- `doc.on('change', fn)` receives `{ reason, changes }` (`reason`:
  `'execute' | 'undo' | 'redo' | 'load' | 'cancel'`). `EntityChange` is a discriminated union
  on `kind` (`'node' | 'wall' | 'opening' | 'room' | 'item'`), so `before` / `after` narrow to
  the entity type (`null` = absent).
- `doc.addValidator(fn)`, `doc.validateLayout()`, `doc.validatePlacements()`.
- **Floors.** A file may hold several `<floor>` elements (basements, ground, upper floors),
  normalised on load (see [docs/xml-format.md](docs/xml-format.md)). `doc.activeFloorId`,
  `doc.setActiveFloor(id)` (throws `unknown-floor`), `doc.floorById(id)`, `doc.floorBelow(id)` and
  `doc.floorAbove(id)`; `doc.floor` is the active floor, and commands, `validateLayout()` and the
  plan work on it. `doc.on('activefloor', fn)` fires when it changes, also when the active floor
  is removed (after the `'change'` event). `EntityChange` has a `floorId`, and a `'floor'` kind
  for floor properties (height, slab thickness, elevation, level).
- Floor commands: `addFloor({ position: 'above' | 'below', wallHeight?, slabThickness? })`,
  `removeFloor(id)` (the ground floor is protected: `floor-protected`),
  `setFloorHeight(id, h)`, `setSlabThickness(id, t)`, `setGroundElevation(e)`
  (`invalid-floor-dimension` for bad numbers). `doc.validateLayout()` also warns with
  `column-unsupported` for a column with none below it.

Item and opening sizes come from a `PresetResolver` (`(presetId) => PresetInfo | undefined`)
passed as `presets`.

### Commands

- Layout: `moveNode(nodeId, to)`, `moveWall(wallId, delta)` (projected on the wall normal),
  `setWallLength(wallId, length, { anchor? })` (`anchor: 'a'` default keeps node `a` fixed and
  moves node `b`; `'b'` keeps node `b` fixed and moves node `a`). Openings and wall items stay
  where they are relative to the fixed end (their distance from node `a`, or from node `b` with
  `anchor: 'b'`), and are re-fitted into range on the resized wall. These do not re-sync rooms.
- Structure: `addWall({ from, to, thickness, height? })` draws a wall; each end is
  `{ node: id }` or `{ at: { x, y } }`. An `at` end within `GEOM_TOL` of a node reuses it, one on
  a wall splits that wall (T-junction); the new wall is cut at every node it passes through and
  every wall it crosses (that wall is split too); ends already joined by a wall are a no-op. After execute, `createdId` is the
  wall touching `from` (the existing one on a no-op) and `endNodeId` the node at `to`.
  Rejections: `invalid-thickness` (thickness, or height when given, not a finite number above
  0), `wall-too-short`, `walls-overlap` (collinear overlap with a wall), `split-too-short` (a
  crossing too close to a wall end).
  `splitWall(wallId, at)` (`at` projected onto the wall; the original id keeps the
  half from node `a`; `createdId` is the new node), `removeWall(wallId)` (also deletes its
  openings, wall items and nodes left without walls), `removeNode(nodeId)` (degree 2 merges the
  two walls into one straight wall, keeping the first wall id; otherwise deletes the node and
  its walls), `mergeNodes(keep, drop)` (re-attaches the walls of `drop` to `keep`; walls that
  would loop are deleted; of duplicate walls the one with more openings + wall items survives,
  then the smaller id), `dropNode(nodeId, { node } | { wall, at })` (moves a node onto a node or
  a wall point, T-junction, in one step; onto itself or its own wall is `invalid-target`),
  `pushPullWall(wallId, distance)` (moves a wall along its left normal, `+` = left of `a -> b`;
  per end a free end moves, a single neighbour along the normal slides, otherwise a connector wall
  copying thickness / height makes a square bump-out or recess; a connector below
  `MIN_WALL_LENGTH` is `wall-too-short`; `|distance| < GEOM_TOL` changes nothing).
  Openings / wall items are re-based and clamped into range. Each is one undo step
  and re-syncs rooms (rooms keep their id and name where they overlap most). Rejections:
  `split-too-short`, `split-cuts-opening`, `merge-drops-opening`, `push-pull-cuts-opening`,
  `invalid-target`.
- Openings: `addOpening({ wall, preset, offset, flip?, sill? })`,
  `moveOpening(id, { offset?, sill?, flip? })`, `removeOpening(id)`.
- Items: `addItem(newItem)` (floor, wall or ceiling mount), `moveItem(id, patch)`,
  `removeItem(id)`. `addOpening` / `addItem` expose `createdId`.
- Columns and site: `addColumn({ x, y, shape, width, depth?, rotation?, height? })` (exposes
  `createdId`), `moveColumn(id, patch)`, `removeColumn(id)`; columns do not touch rooms; sizes
  not above 0 or above the limit, or a `height` not above 0, are `column-size`.
  `setSite(points | null)` sets the ground outline (stored counter-clockwise; fewer than 3 points
  or a non-finite coordinate is `site-invalid`; `null` clears).
- Finishes and names: `setWallFinish(wallId, side, finish)`, `setRoomFinish(roomId, finish)`,
  `renameRoom(roomId, name)`.

### Stairs

A floor holds `stairs`: a bay (`x`, `y`, `width`, `depth`, `rotation`) plus `type`
(`'straight' | 'L' | 'U' | 'spiral'`), `turn` (`'landing' | 'winder'`), `hand` and `flightWidth`.
A stair links its floor to the floor above; the slab and room floors above get an opening.

- Commands: `addStair({ x, y, width, depth, type?, turn?, hand?, flightWidth?, rotation? })`
  (`createdId`; defaults `type: 'U'`, `turn: 'landing'`, `hand: 'right'`, `flightWidth: 0.9`,
  `rotation: 0`), `updateStair(id, patch)` and `removeStair(id)`. A non-finite position or
  rotation, an unknown type / turn / hand, a non-positive size (`flightWidth` too, for every
  type) or a flight wider than the bay (wider than half the bay for U) by more than
  `FLIGHT_WIDTH_TOL` (1e-4 m, so 4-decimal XML reloads) is `invalid-stair`; `fromProject` and
  `fromXML` reject such a stair too. `updateStair` ignores patch keys whose value is `undefined`.
- Parameters by type: `stairParams(type)` lists the parameters that shape a stair of that type
  (`straight`: `hand`, `flightWidth`; `L` / `U`: `turn`, `hand`, `flightWidth`; `spiral`: `hand`),
  so an editor can disable the other inputs.
- Layout: `layoutStair(stair, rise)` returns risers, riser height, tread depth, step and landing
  polygons, the walking line, `opening` (the outline) and `bay`, or `{ ok: false }` when the
  flights do not fit; `stairRise` and `stairBay` are helpers. `stairOutline(stair, rise)` is the
  stair's one exact outline: the tight rectangle around its steps and landings (the diameter
  square for a spiral; the bay when the layout is not ok). The plan draws, selects, hit-tests and
  snaps it, `stair-overlaps-wall` checks it and it is the slab opening on the floor above. Warnings `stair-does-not-fit`, `stair-no-floor-above` and
  `stair-overlaps-wall` come from `validateLayout()`.
- 3D: `scene.getStairMesh(id, floorId?)` (`h3xKind: 'stair'`); a handrail is part of the stair.
- Plan: `new StairTool({ type, turn, hand, flightWidth })` drags a bay and adds an axis-aligned
  stair (rotation 0; rotate it afterwards with `updateStair`). Bay corners snap to wall-face
  vertices with `snapBayCorner(p, floor, opts)` (grid only when `align` is off);
  `SelectEditTool` selects, drags (outline corners snap to wall faces), nudges and deletes stairs;
  the frame drawn around a stair is its outline (class `h3x-plan-stair-outline`); the `stairLabels` option (default
  `{ up: 'UP', down: 'DN' }`) sets the walking-line labels.

### Irregular lots and roofs

Lots do not have to be rectangles. Slab outlines, wall joins and roof outlines use a miter limit
(4 times the offset), so an acute corner is bevelled instead of growing a spike;
`floorOutline(floor, roomIds?)` returns the outer wall faces of the union of rooms, with
courtyards as hole rings. A wall can be low (a
parapet): give it a `height` below the storey height; it still bounds rooms.

A floor holds `roofs`. A roof is either **follow** (`follow: true`, outline from the walls of
`rooms`, tracking wall edits) or **independent** (`points`, optional `holes`, one `edges` spec
per outline edge). Each edge is `{ kind: 'gable' }` or
`{ kind: 'slope', pitch, breakHeight?, upperPitch? }` (degrees; a break height gives a two-pitch
mansard / gambrel slope). Lengths are meters, pitch is in degrees. The roof underside bears on the
wall tops (`floor.elevation + wallHeight + base`); `overhang` (default 0.5) extends the eaves and
`gableOverhang` (default 0.3) the rakes. `kind: 'flat'` gives a slab with an optional `parapet`.
`material` is `tile`, `metal`, `concrete`, `glass` or `polycarbonate`; `supports: 'posts'` adds
steel posts under a light roof. See [docs/xml-format.md](docs/xml-format.md) for every field.

- Presets: `ROOF_PRESETS` (`thai`, `japanese`, `metal`, `traditional`, `gable`, `hip`, `shed`,
  `mansard`, `gambrel`, `flat`, `glass-frame`, `poly-frame`) give initial values only; every value
  stays editable. `presetEdges(id, ring)` and `presetWallEdges(id, ring)` return the edge specs a
  preset gives to an outline.
- Commands: `addRoof({ preset?, rooms?, points?, ...fields })` (`createdId`; follow mode unless
  `points` are given), `updateRoof(id, patch)` (alias `setRoofParams`), `setRoofEdge(id, { index,
hole? } | { wallId }, edge)`, `detachRoof(id)` (turns a follow roof independent; extra
  disjoint outlines become new roofs, listed in the command's `newIds`),
  `fitRoofToWalls(id, rooms?)` and `removeRoof(id)`. Bad input is `invalid-roof`
  (`validateRoofParams`); `fromProject` and `fromXML` reject such a roof too.
- Geometry: `roofGeometry(roof, floor)` returns `{ ok, bodies }` with every face (polygons in 3D),
  the ridge / hip / valley / eave / rake lines, the overhang outline, posts and parapets;
  `roofFaceArea(face)` gives a face's area and `gableProfile(floor, wallId)` the top profile of a
  gable wall. A roof the algorithm cannot build is drawn flat and reported.
- Warnings from `validateLayout()`: `roof-invalid-outline`, `roof-no-walls` and
  `roof-build-failed` (see [docs/validation.md](docs/validation.md)).
- 3D: roofs are built per floor (`h3xKind: 'roof'`, meshes `h3x-roof-<id>`, plus `-frame` bars on
  light roofs and `-posts`); `scene.getRoofMeshes(id, floorId?)` lists them and
  `viewer.setRoofsVisible(visible)` shows or hides all roofs. Gable walls are raised to the roof
  underside.
- Plan: roofs are drawn above the walls (overhang outline dashed, ridge / hip / valley lines,
  downhill arrows with pitch, a light hatch for glass / polycarbonate, posts), hit-tested on their
  real outline, and `plan.setRoofsVisible(visible)` toggles them. `new RoofTool({ preset?, mode?
})` adds a roof: `'follow'` (default) on a click inside a room (`roof-no-room` outside any),
  `'draw'` by clicking a polygon. `SelectEditTool` edits a selected roof: drag a vertex (a follow
  roof detaches first and fires `roofdetached` with `{ roofId, newIds }`), click an edge to fire
  `roofEdgeRequest` with `{ roofId, index, hole?, wallId?, current, at }` (the editor shows its
  own input and runs `setRoofEdge`), drag an independent roof to move it, **Delete** removes it.
  Drawing walls and roofs snaps to site vertices and site edges.

### Validation and issue codes

Validators return `Issue { code, ids, message }`. Layout edits are never blocked by furniture:
issues on items or openings that a layout change causes are flagged by `validatePlacements()`
instead. Only entities touched by a change can block it.

| Code                               | Meaning                                                                                                                   |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `wall-too-short`                   | wall shorter than `MIN_WALL_LENGTH` (0.3 m)                                                                               |
| `walls-cross`                      | two walls that do not share a node intersect                                                                              |
| `room-degenerate`                  | room outline not simple, flipped, a hole crossing it or overlapping another hole, or net inner area below `MIN_ROOM_AREA` |
| `column-size`                      | column width or depth not above 0 or above 2 m, or height (when set) not above 0                                          |
| `columns-overlap`                  | two columns overlap (reported only)                                                                                       |
| `site-not-simple`                  | site outline self-intersects (reported only)                                                                              |
| `invalid-roof`                     | a roof has a bad kind, material, preset, pitch, size, outline or edge spec                                                |
| `roof-invalid-outline`             | independent roof outline not simple, or a hole outside / crossing (reported only)                                         |
| `roof-no-walls`                    | follow roof whose rooms give no outline (reported only)                                                                   |
| `roof-build-failed`                | roof geometry could not be built; drawn flat (reported only)                                                              |
| `opening-out-of-wall`              | opening does not fit in its wall's usable range                                                                           |
| `opening-overlap`                  | two openings on one wall overlap                                                                                          |
| `opening-too-tall`                 | sill + height above the wall height                                                                                       |
| `wall-item-out-of-range`           | wall item outside its wall's usable range or height                                                                       |
| `wall-item-on-opening`             | wall item covers an opening                                                                                               |
| `outside-room`                     | floor / ceiling item not fully inside a room                                                                              |
| `hits-wall`                        | floor item overlaps a wall                                                                                                |
| `hits-item`                        | floor item overlaps another floor item (`layer: 'covering'` presets, like rugs, are exempt)                               |
| `invalid-number`                   | a command produced NaN or Infinity                                                                                        |
| `unknown-preset`, `mount-mismatch` | preset missing or wrong mount for the command                                                                             |
| `not-found`                        | referenced id does not exist                                                                                              |
| `duplicate-id`                     | a create command was run twice                                                                                            |
| `walls-overlap`                    | `addWall` would overlap an existing wall collinearly                                                                      |
| `invalid-thickness`                | `addWall` thickness, or height when given, not a finite number above 0                                                    |
| `invalid-target`                   | `mergeNodes` / `dropNode` onto the node itself or one of its own walls                                                    |
| `site-invalid`                     | `setSite` with fewer than 3 points or a non-finite coordinate                                                             |
| `split-too-short`                  | a split would leave a wall part below `MIN_WALL_LENGTH`                                                                   |
| `push-pull-cuts-opening`           | a slid neighbour wall gets too short for an opening / wall item on it                                                     |
| `split-cuts-opening`               | a split cuts an opening / wall item that cannot fit in the half holding its center                                        |
| `merge-drops-opening`              | removing a node would merge walls into one too short for its openings / wall items                                        |
| `no-floor`, `bad-reference`        | invalid project passed to `fromProject`                                                                                   |
| `room-open`                        | room walls do not form a closed loop (from room geometry helpers)                                                         |
| `non-finite-number`                | `projectToXML` was given a non-finite number                                                                              |

The usable range along a wall is shortened at each end by half the thickness of the thickest
other wall meeting there (and, for openings, at least `OPENING_END_MARGIN`), so nothing sits
inside a corner. Standalone checks: `validateLayout(floor)`,
`validatePlacements(floor, presets)`, `checkOpening(floor, opening)`,
`checkItem(floor, item, presets)`.

### Rooms

`detectRooms(floor)` finds the faces of the wall graph as `DetectedRoom { walls, nodes, holes }`
(used when a file has no `<room>` elements). A room is stored as its outer wall loop in
counter-clockwise order plus optional `holes` (wall loops, clockwise) for free-standing wall
boxes inside it, such as a light well. `roomPolygon(floor, room, 'center' | 'inner')` gives the
outer outline, `roomShape(floor, room, kind)` the outline and the hole outlines
(`{ outer, holes }`), and `roomArea(floor, room, kind)` the outer area minus the holes.
`polygonOverlapArea(a, b)` is the area two simple polygons share.

Structural commands re-sync rooms with the faces of the wall graph, keeping identity by overlap:
when a room is split, the bigger part keeps its id, name and finish and the smaller part gets a
new id, an empty name and the same floor finish; when rooms merge, the bigger one is kept and
the others are deleted. This runs over all rooms of the floor, so on the first structural edit
a room loaded from a file that is not a face of the wall graph is replaced: it is re-fitted to
the face it overlaps most, or deleted when it overlaps none.

### XML

`projectFromXML(xml)` and `projectToXML(project, { pretty? })` convert between XML and plain
`Project` data. Parse problems throw `H3xParseError` (with `element` / `attribute`), newer
format versions throw `H3xVersionError`. A file without a `<floor>` is rejected. Numbers are
written with at most 4 decimals (`XML_DECIMALS`); characters XML 1.0 forbids are written as
U+FFFD.

### Geometry helpers

`obbCorners(obb)` and `wallOBB(a, b, thickness)` work with oriented boxes (`OBB`).
One plan outline per kind, shared by the plan (drawing, selection, hit-testing) and the
validators (overlap and containment): `wallOutline(corners)` / `wallOutlines(floor)` (the mitred
outline as drawn), `columnShape(column)` / `columnPolygon(column)`, `itemFootprint(item, floor,
presets)`, `openingSpan(opening)` and `stairOutline(stair, rise)`; `convexOverlap(a, b)` and
`circleOverlapArea(a, b)` are the overlap tests (touching is not overlap).
`createId()` makes 10-character nanoid ids.

## h3x/three

`h3x/three` renders an `H3xDocument` with three.js: extruded walls with door and window
cut-outs, mitered corners, floors and an orbit viewer with an axis gizmo. `three` is a peer
dependency, so install it next to h3x (`h3x/core` and the package root do not need it):

```sh
pnpm add h3x three
```

```ts
import { H3xDocument } from 'h3x/core';
import { H3xScene, H3xViewer } from 'h3x/three';

const doc = H3xDocument.fromXML(xml);
const scene = new H3xScene(doc); // meshes follow every document change
const viewer = new H3xViewer(document.getElementById('app')!, scene);
viewer.fitToContent();

viewer.setProjection('orthographic');
viewer.viewFromAxis('y'); // top view
```

- **Coordinates.** Plan `(x, y)` at elevation `e` maps to world `(x, e + v, -y)`, where `v` is the
  height. A plan rotation (CCW seen from above) becomes `object.rotation.y`. A top-down view is
  therefore not mirrored.
- **Finishes and materials.** Walls get one material per side plus trim; floors use the room
  finish. A finish value starting with `#` is used as a literal colour (`#c8a77e`); other ids
  go through the optional `resolveFinish` callback of `H3xScene` / `MaterialLibrary`.
  Defaults: wall `#f2efe9`, floor `#c8b49a`, trim `#e2ddd5`.
- **Render on demand.** There is no animation loop. The viewer renders after document changes,
  camera moves and resizes; call `viewer.requestRender()` after changing anything yourself, and
  `viewer.dispose()` / `scene.dispose()` when done.
- **Floors and view modes.** h3x manages one group per floor (`h3x-floor-<id>`, lowest floor
  first, `userData.h3xFloorId` set) holding its `h3x-walls`, `h3x-floors`, `h3x-joins` and
  `h3x-columns` groups and a slab mesh (`h3xKind: 'slab'`, thickness from `slabThickness`).
  `scene.setViewMode('active' | 'cutaway' | 'all')` shows the active floor only, the active floor
  with the ones below it, or the whole house (default `'all'`); read it with `scene.viewMode`.
  `getWallMesh(id, floorId?)`, `getFloorMesh(id, floorId?)` and `getSlabMesh(floorId?)` default
  to the active floor; `buildSlabGeometry` is exported too.
- **Picking.** Meshes carry
  `userData = { h3xKind: 'wall' | 'room' | 'join' | 'column' | 'slab', h3xId, h3xFloorId }`.
  Ids can repeat across floors, so picking must read `h3xFloorId` as well as `h3xId`; both sit on
  the mesh itself, no parent walk needed. A `join` mesh closes the top of a T or X junction (or the
  slot of a very acute corner); its `h3xId` is the node id. A `slab` mesh's `h3xId` is the floor id.
  Mesh objects keep their identity across document changes: only their geometry and materials are
  swapped, so references from `getWallMesh` / `getFloorMesh` stay valid.
- **Extra objects.** `scene.root` is the extension point: children you add to it (helpers,
  furniture, markers) survive rebuilds. h3x only manages its own `h3x-floor-<id>` groups and
  the site line.
- **Ownership.** One `H3xScene` attaches to one `H3xViewer` (the viewer adds `scene.root` to its
  own three.js scene). `scene.dispose()` disposes the materials it created, but a
  `MaterialLibrary` you pass in through `materials` stays yours to dispose. `dispose()` can be
  called more than once.

Try it with the example page, a 4 x 16 m tube house (`examples/layouts/nha-ong-4x16.h3x`):

```sh
pnpm dev   # http://localhost:5173
```

## h3x/plan

`h3x/plan` draws an `H3xDocument` as an SVG plan you can pan, zoom, select in and edit: drag
nodes and walls, nudge with the keyboard, draw walls, site outlines and columns, and ask for a
typed wall length. It does not need `three`, only a DOM (`h3x/core` and the package root stay
DOM-free).

```ts
import { H3xDocument } from 'h3x/core';
import { H3xScene, H3xViewer } from 'h3x/three';
import { H3xPlan } from 'h3x/plan';

const doc = H3xDocument.fromXML(xml);
const plan = new H3xPlan(document.getElementById('plan')!, doc);
const viewer = new H3xViewer(document.getElementById('view3d')!, new H3xScene(doc));
plan.fitToContent();
viewer.fitToContent();

plan.on('selectionchange', (sel) => console.log(sel)); // { kind: 'wall', id: 'w1' } | null
```

Dragging a wall in the plan edits `doc`, so the 3D view follows, and `doc.undo()` reverts it in
both views.

- **View.** `plan.view` (a copy of `{ cx, cy, scale, width, height }`, `scale` in px per meter),
  `plan.setView({ cx?, cy?, scale? })`, `plan.fitToContent(paddingPx?)`,
  `plan.planToScreen(p)` and `plan.screenToPlan(p)`. Dragging empty space pans, the wheel zooms
  around the cursor, and two fingers pinch and pan. The view follows its container's size. The
  svg sets `touch-action: none` so touch gestures reach the plan instead of scrolling the page.
- **Selection.** `plan.selection` is `{ kind, id } | null` (`kind`: `'node'`, `'wall'`,
  `'room'`, `'opening'`, `'item'`, `'column'` or `'site'`); `plan.select(sel)` sets it (an
  unknown id selects nothing). Clicking selects nodes, walls, columns and the site outline.
  `plan.getElement(kind, id)` returns the entity's `<g>`.
- **Events.** `plan.on(type, fn)` returns an unsubscribe function.
  - `selectionchange` receives the new `Selection | null`, only when it changes.
  - `lengthEditRequest` receives `{ wallId, length, anchor, anchorRect }` when the user
    double-clicks a wall's dimension label. `length` is in meters, `anchor` is the end the
    plan suggests keeping fixed, and `anchorRect` is the label's rect in px, so you can place
    an input over it.
  - `segmentLengthRequest` receives `{ from, direction, length }` when a drawing tool starts a
    wall segment (see the tools below).
  - `issues` receives `{ rejected, standing }`. `rejected` holds the issues of the last
    rejected edit (flashed for 600 ms, then cleared with another event). `standing` holds the
    layout and placement issues of the document as it is now.
- **The library ships no inputs; the editor attaches them.** The plan never creates a text
  field. On `lengthEditRequest` your editor shows its own input, then calls
  `plan.setWallLength(wallId, length, { anchor? })`. That runs `setWallLength` through
  `doc.tryExecute`, returns `{ ok: true } | { ok: false, issues }` and flashes a rejection.
  Without `anchor` the plan picks one with `pickAnchor(floor, wallId)`: the end with more walls
  attached stays, and on a tie node `a` stays. The `anchor` suggested in `lengthEditRequest`
  uses `pickAnchor(floor, wallId, near)` with the double-click point, so there a tie keeps the
  end farther from the double-click. `pickAnchor` is exported. `plan.reportRejected(issues)`
  flashes issues from your own edits.
- **Tools.** `plan.setTool(tool | null)` swaps the active tool (the old one is deactivated
  first); `plan.tool` is the current one. The default is `new SelectEditTool()`; `tool: null`
  leaves a plan that only pans and zooms. A `Tool` implements `activate(ctx)`, `deactivate()`
  and optionally `onPointerDown / Move / Up`, `onDoubleClick` and `onKeyDown`, which receive
  plan and screen coordinates and the hit target. `SelectEditTool` supports:
  - click a node, wall, column or the site outline to select it, click empty space to clear;
  - drag a node, or a wall (it moves along its normal). A drag snaps to a 5 cm grid and to
    alignment with other nodes (guide lines are drawn); hold **Alt** to disable snapping. The
    whole drag is one undo step;
  - **Esc** during a drag cancels it with no undo or redo trace (`doc.cancelCoalesce`); with no
    drag it clears the selection;
  - arrow keys nudge the selected node or wall by 1 cm, **Shift** + arrow by 10 cm (up is +y);
  - double-click a dimension label to request a length edit;
  - double-click a wall to insert a point (`splitWall`); a node dropped onto a node or wall joins
    it (`mergeNodes` / `dropNode`);
  - **Delete** / **Backspace** removes the selected node (`removeNode`), wall (`removeWall`),
    column (`removeColumn`) or site outline (`setSite(null)`);
  - **Shift** + drag a wall pushes / pulls it (`pushPullWall`), growing a bump-out or recess;
  - drag a column to move it (`moveColumn`).

  Drawing tools, activated with `plan.setTool(...)`:

  - `new DrawWallTool({ thickness?, height? })` (defaults 0.2 m and the floor's wall height):
    click to set the start, every further click commits a wall (`addWall`, one undo step) and
    continues from its end. A click on the chain's start, a node or a wall ends the chain, as do
    double-click and **Enter**; **Esc** drops the preview (committed walls stay); **Backspace**
    undoes the last click; **Alt** disables snapping.
  - `new DrawSiteTool()`: click the vertices of the site outline; a click on the first vertex,
    **Enter** or double-click closes it (`setSite`); **Esc** cancels.
  - `new ColumnTool({ shape?, width?, depth? })` (`'square'` 0.3 m by default): one click places a
    column (`addColumn`) and selects it.

  `DrawWallTool` fires `segmentLengthRequest` (`{ from, direction, length }`) whenever a new
  segment starts. The editor shows its own input, then calls
  `plan.setPendingSegmentLength(length)`, which commits a wall of exactly that length along the
  preview direction and returns `false` when nothing is pending or `length` is not a finite
  number above 0.

  Length labels show on the selected wall, on the walls of a selected or dragged node, and,
  with nothing selected, on walls that border fewer than two rooms.

- **Interrupted gestures.** If the document changes under a drag for any reason other than the
  tool's own steps (undo, redo, a load, another editor's command), the drag ends where it is
  and the rest of that press is ignored. Known limitation: an external `doc.endCoalesce()` in
  the middle of a drag cannot be detected, because it emits no event, so the drag's next steps
  start a new undo step.
- **Options.** `new H3xPlan(container, doc, { grid?, snap?: { grid?, align? }, classPrefix?,
presets?, tool?, stairLabels? })`. Defaults: grid shown, `snap` 0.05 m with alignment on,
  prefix `h3x-plan`, `presets` taken from the document, `stairLabels` `{ up: 'UP', down: 'DN' }`.
- **Styling.** The plan injects a stylesheet scoped under the root class (`h3x-plan`, or your
  `classPrefix`); override it with more specific rules. Every entity is a `<g>` with class
  `h3x-plan-<kind>` (`node`, `wall`, `room`, `opening`, `item`, `column`, `site`) and
  attributes `data-h3x-kind` and `data-h3x-id`. Junction fills carry `data-h3x-node` (class `h3x-plan-join`) and dimension
  labels `data-h3x-wall` (class `h3x-plan-dimension`). State classes on entity elements:
  `h3x-plan-selected`, `h3x-plan-invalid` (the entity is in a standing issue) and
  `h3x-plan-rejected` (flashed after a rejected edit).
- **Ownership.** One plan per container: it appends its own `<svg>` (`plan.svg`) and removes it
  on `dispose()`, which also drops the document subscription and listeners and can be called
  more than once. It does not dispose the document.

In 3D, columns, the site outline (a line loop on the ground around the house) and floors with
holes (inner light wells) are rendered too. Columns and `<site>` are stored as their own XML
elements; see [docs/xml-format.md](docs/xml-format.md).

The plan shows the active floor, with the floor below drawn faded underneath. Switching the
active floor commits an in-progress drag as it stands (one undo step), resets the current tool
(a wall chain ends, keeping the walls already placed; an unfinished site outline is dropped),
clears the selection and redraws.

The example page shows the plan and the 3D view side by side on one document, with a throwaway
toolbar (select, draw wall, draw site, columns, stair, clear, sample houses), controls for the
selected stair (type, turn, hand, flight width, rotate 90°), demo inputs wired to
`lengthEditRequest` and `segmentLengthRequest`, and a floor bar (floor picker, add above / below,
remove, wall height, slab thickness, ground elevation and view mode). It opens a sample
three-storey townhouse with a basement (`examples/layouts/townhouse-3f.xml`) (`pnpm dev`). A second
sample, a four-storey townhouse on a trapezoid lot (`examples/layouts/townhouse-trapezoid.xml`),
has a terrace with 1.1 m parapets, a stair housing with a metal roof and a glass roof on posts
over part of the terrace; the toolbar has a roof tool with preset and mode pickers and a roofs
visibility toggle.

## Tolerance

All contact, containment and range checks use one tolerance, `GEOM_TOL` = 1e-3 m (1 mm).
Things that touch, sit flush or overlap by up to 1 mm are fine. This is well above the
rounding of 4-decimal XML, so a document that validates keeps validating after save and load.

## Clean-room note

This library is a clean-room implementation. No code from earlier, unrelated projects was
opened, copied, ported or paraphrased; only the general idea of an XML scene with one element
per object type carries over.

## Development

```sh
pnpm install
pnpm test        # run tests once (vitest)
pnpm test:watch  # watch mode
pnpm typecheck   # tsc --noEmit
pnpm lint        # eslint
pnpm format      # prettier --write
pnpm build       # vite library build to dist/
pnpm dev         # example page (examples/) with the sample layout
```

## Documentation

- [XML format](docs/xml-format.md): every element and attribute of `.h3x` v1, with an example.
- [Validation](docs/validation.md): issue codes, blocking vs reported-only, the tolerance contract.
- [Roadmap](docs/roadmap.md): milestones.
- [Contributing](CONTRIBUTING.md): setup, rules, how to add commands and validators.
- [Changelog](CHANGELOG.md).

## License

MIT
