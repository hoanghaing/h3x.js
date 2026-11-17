# Changelog

## Unreleased

Milestone 6: stairs.

- Core: `Floor.stairs` and `Stair` (`straight`, `L`, `U`, `spiral`; `landing` or `winder` turns;
  hand, flight width); XML `<stair>` (see `docs/xml-format.md`) and `addFloor` copies stairs.
- Commands: `addStair`, `updateStair`, `removeStair`; new blocking code `invalid-stair`.
- Layout: `layoutStair(stair, rise)` (risers of at most 0.18 m, tread 2h + b between 0.60 and
  0.62 m, winders 3 per quarter turn, spiral headroom 2.1 m), `stairBay` and `stairRise`;
  `validateLayout` warns with `stair-does-not-fit`, `stair-no-floor-above` and
  `stair-overlaps-wall`.
- 3D: stair meshes (`h3xKind: 'stair'`) with a handrail, `scene.getStairMesh(id, floorId?)`,
  `buildStairGeometry` and `buildHandrailGeometry`; the slab and room floors of the floor above
  get an opening for every stair below.
- Plan: stairs drawn with steps, walking line, arrow and UP / DN labels (`stairLabels` option), a
  break line at 1.2 m with dashed steps above it, and the opening plus stair shown on the floor
  above; `StairTool` (drag a bay, corners snap to wall faces) and `snapBayCorner`;
  `SelectEditTool` selects, drags, nudges and deletes stairs.
- Example page: "Cầu thang" tool and controls for the selected stair (type, turn, hand, flight
  width, rotate 90°); the sample townhouse gains a stairwell with a U stair on floors -1, 0 and 1.

Milestone 5: multi-floor.

- Core: `Floor.slabThickness` (XML `slabThickness`, default 0.15); floors are normalised on load
  (sorted by level, contiguous levels, derived elevations; see `docs/xml-format.md`).
- Active floor: `doc.activeFloorId`, `doc.setActiveFloor(id)`, `floorById` / `floorBelow` /
  `floorAbove` and the `'activefloor'` event. Commands, validation, `doc.floor` and the plan work
  on the active floor; `EntityChange` carries `floorId` and a new `'floor'` kind.
- Commands: `addFloor`, `removeFloor`, `setFloorHeight`, `setSlabThickness`, `setGroundElevation`;
  new codes `unknown-floor`, `floor-protected`, `invalid-floor-dimension` and the
  `column-unsupported` layout warning. Walls at the storey height follow `setFloorHeight` (and
  `addFloor({ wallHeight })`); custom-height walls are kept. `fromProject` rejects duplicate floor
  ids and a bad `slabThickness` like `fromXML`.
- 3D: one group per floor, slab meshes with thickness and
  `scene.setViewMode('active' | 'cutaway' | 'all')`; `getWallMesh(id, floorId?)` and
  `getSlabMesh(floorId?)`; every mesh carries `userData.h3xFloorId`.
- Plan: the floor below is drawn faded underneath; switching floors commits an in-progress drag
  (one undo step), resets the tool and clears the selection.
- Example page: floor picker, add / remove floor, height, slab and ground elevation inputs, view
  mode select and a sample three-storey townhouse with a basement
  (`examples/layouts/townhouse-3f.xml`).

Milestone 4: structure drawing.

- Core commands: `addWall`, `removeWall`, `splitWall`, `removeNode`, `mergeNodes`, `dropNode`,
  `pushPullWall`, `addColumn`, `moveColumn`, `removeColumn` and `setSite`, each one undo step
  with rooms re-synced; new issue codes for splits, merges, push / pull, columns and the site.
- XML: `<column>` elements and an optional `<site>` outline (see `docs/xml-format.md`).
- Plan tools: `DrawWallTool`, `DrawSiteTool` and `ColumnTool`; `SelectEditTool` gains insert
  point (double-click a wall), delete, push / pull (Shift + drag a wall), join on drop and column
  drag.
- `segmentLengthRequest` event and `plan.setPendingSegmentLength(length)` for typed wall lengths
  while drawing.
- 3D: columns, site outline and floors with holes.
- Example page: toolbar to draw from an empty document, plus a segment length input.

Milestone 3: `h3x/plan`.

- `H3xPlan`: SVG plan of an `H3xDocument` with pan, zoom, pinch, selection, live dimensions,
  `selectionchange` / `lengthEditRequest` / `issues` events and CSS state classes. It does not
  need `three`.
- `SelectEditTool`: select and drag nodes and walls with grid and alignment snapping, arrow-key
  nudging, Esc to cancel a drag; custom tools through the `Tool` interface.
- `plan.setWallLength` picks the anchor automatically (`pickAnchor`); the library ships no
  inputs, the editor attaches them.
- `setWallLength` takes `{ anchor: 'a' | 'b' }` to choose which end stays fixed.
- `doc.cancelCoalesce(key)` and the `'cancel'` change reason revert an open drag with no undo
  trace.

Milestone 2: `h3x/three`.

- `H3xScene`: wall and floor meshes kept in sync with an `H3xDocument`, with mitered joins,
  door and window cut-outs and per-side finishes (`MaterialLibrary`).
- `H3xViewer`: render-on-demand viewer with perspective / orthographic cameras, orbit controls,
  `viewFromAxis`, `fitToContent` and an axis gizmo.
- Example page (`pnpm dev`) with a sample Vietnamese tube-house layout.
- `three` is a peer dependency of `h3x/three` only.

Milestone 1: `h3x/core`.

- `H3xDocument`: editable document with undo / redo, drag coalescing (`coalesceKey`), change
  events, `execute` / `tryExecute` / `preview`, and custom validators.
- Layout commands: `moveNode`, `moveWall`, `setWallLength`, with dependent openings and wall
  items re-fitted into range.
- Object commands: `addOpening`, `moveOpening`, `removeOpening`, `addItem`, `moveItem`,
  `removeItem` (floor, wall and ceiling mounts).
- Finish and name commands: `setWallFinish`, `setRoomFinish`, `renameRoom`.
- Validation with issue codes for layout and placement (collision, containment, wall ranges),
  one contact tolerance `GEOM_TOL` = 1 mm, and layout edits that are never blocked by
  furniture (see `docs/validation.md`).
- Room detection and geometry (`detectRooms`, `roomPolygon`, `roomArea`); rooms stored CCW.
- XML read / write in the `<h3x version="1" unit="m">` format (`projectFromXML`,
  `projectToXML`) with typed `H3xParseError` / `H3xVersionError`; see `docs/xml-format.md`.
- Oriented-box geometry helpers (`obbCorners`, `wallOBB`) and `createId`.
- Documentation: README, XML format, validation guide, contributing guide, roadmap.
