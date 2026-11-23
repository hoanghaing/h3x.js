# Changelog

## Unreleased

Quantities.

- Core: `floorQuantities(floor)` and `projectQuantities(project)` measure walls (length, gross,
  opening and net area, volume with corners counted once), room floor areas, openings grouped by
  type / preset / size, and roof areas, with totals per floor and for the project.

Doors and windows.

- Core: typed openings. `Opening` gains `type` (`door-swing`, `door-double`, `door-sliding`,
  `door-folding`, `door-rolling`, `opening`, `window-casement`, `window-sliding`,
  `window-awning`, `window-fixed`), `hinge` (`'a' | 'b'`), `swing` (`'left' | 'right'`) and
  optional `leaves` and `split`. XML attributes `type`, `hinge`, `swing`, `leaves`, `split` (see
  `docs/xml-format.md`); a file without them still loads (the type follows the sill, `flip="1"`
  reads as `hinge="b" swing="right"`). `openingParams`, `openingLeaves`, `nextOrientation`,
  `mirrorOrientation`, `validateOpeningParams`, `validateOpeningValues`, `normalizeOpening`.
- Built-in opening presets (`OPENING_PRESETS`, one or more per type), resolved after the host's
  presets (`createPresetResolver`); `PresetInfo.opening` gives a preset's type and parameters;
  `presetOpening`.
- Commands: `updateOpening` (any field, `wall` included; `moveOpening` is the same command),
  `resizeOpening`, `setOpeningDistance` (from the wall face / next opening or from the end node),
  `applyOpeningPreset`. `addOpening` takes `hinge`, `swing`, `type`, `leaves` and `split`. A type
  change drops a stored leaf count the new type cannot take (back to its default) unless the same
  patch sets one.
- **Changed:** `doc.presets` is always defined: the host's resolver wrapped so the built-in
  opening presets resolve after it.
- Geometry: `openingGeometry` (cut, frame / leaf / glass pieces closed and open, swept areas),
  `openingHit`, `pieceOutline`, `openingClearances` (type `OpeningClearances`); one shape for the plan symbol, hit area, 3D
  parts and checks. `resolvePlacement` places an opening near a point (host wall with
  hysteresis, snaps, clamp, re-host keeping the space a door opened into).
- Validation: new blocking codes `opening-hits-column` and, on opening edits, every
  `invalid-opening` value (type, orientation, leaves, split, sizes also as saved, sill, offset);
  new warning `opening-swing-blocked` (`validatePlacements` only; `isWarningIssue` and
  `WARNING_CODES` tell warnings apart). `validatePlacements(floor, presets, above?)` takes the
  floor above, which gives stairs their rise for the swing check. An edit that changes only the
  type, hinge, swing, leaves or split of a flagged opening is blocked only by issues it adds.
- **Changed:** `opening-out-of-wall` now uses the wall's clear length: an opening must stay clear
  of the drawn outline of a meeting wall, and at least `OPENING_END_MARGIN` from the node. Layout
  edits leave in place an opening that fits this or the old range, so older files do not move.
- Plan: `OpeningTool` (ghost on the nearest wall, snap ticks, red where invalid, Space for
  orientation, Alt for no snapping; `placement-no-host` when no wall is in reach).
  `SelectEditTool` moves an opening along its wall and onto other walls, resizes it by its jamb
  handles, nudges it with the arrows and cycles its orientation with Space; a drag is one undo
  step and dragging back leaves none. New events `openingDistanceRequest` (answer with
  `plan.setOpeningDistance`) and `openingEditRequest`. New classes `-warning` (amber, for an
  entity flagged only by a warning), `-opening-handle`, `-opening-distance`, `-ghost`,
  `-ghost-free`, `-ghost-guide` and `-ghost-guides`. `paintOpening` is exported. An opening that
  stands wholly beyond its wall is drawn as a red box and stays selectable.
- 3D: doors and windows get frame, leaf and glass meshes (`h3xKind: 'opening'`,
  `h3x-opening-<id>-<part>`, in an `h3x-openings` group per floor) and an invisible pick box;
  `buildOpeningParts`, `OPENING_PARTS`, `scene.getOpeningMeshes(id, floorId?)`, materials
  `openingFrame`, `openingLeaf`, `openingGlass`, `pick`. Only openings whose shape changed get new
  buffers.
- **Removed:** `flip` on `Opening`, `addOpening` and `moveOpening` (use `hinge` and `swing`; XML
  `flip` is still read, never written); `openingShape` / `OpeningShape` from `h3x/plan` (use
  `openingGeometry` and `paintOpening`); the plan class `-opening-leaf` (leaves are drawn in
  `-opening-lines`).
- **Changed:** an entity flagged only by `opening-swing-blocked` gets `-warning` instead of
  `-invalid`.
- `opening-out-of-wall` is listed once in the plan's standing issues (layout and placement
  checks both report it).
- 3D editing: `new H3xViewer(el, scene, { editing: true })` selects, places and drags doors and
  windows of the active floor with the pointer (Esc clears or cancels, Delete removes, the orbit
  is suspended while a handle or an opening is dragged). New `viewer.selection`,
  `viewer.select(sel | null)`, `viewer.setPlacement({ preset } | null)` and events
  `viewer.on('selectionchange' | 'issues', fn)`; types `ViewerSelection` and `ViewerPlacement`.
  Placement and drags use the same rules as the plan, one undo step per gesture. Without
  `editing` the pointer only orbits, as before.
- 3D: `scene.document` gives the `H3xDocument` the scene renders.
- Example page: the 3D view edits openings with the pointer, selection is shared with the plan,
  the preset picker also drives 3D placement and rejections show in the status line. Door and window tool with a preset picker, a bar for the selected opening (type,
  width, height, sill, hinge, swing, leaves, split; inputs the type does not use are disabled),
  an input for a clicked clear distance, and rejection reasons in the status line.

Editing fixes.

- Openings and wall items stay in place when either end of their wall moves (`moveNode`,
  `moveWall`, `pushPullWall`, `mergeNodes`); they used to slide when node `a` moved.
- Node and wall drags compute every step from the start of the drag, so dragging back restores
  openings; new option `restart` on `execute` / `tryExecute` (with `coalesceKey`).
- **Changed:** a wall drawn, dropped or split into a door or window is rejected
  (`split-cuts-opening`, the opening flashes red); it used to push the opening aside.
- **Changed:** follow roofs keep what they cover when rooms change: a split room stays roofed on
  both sides; merging with an unroofed room or opening the roofed room turns the roof into an
  independent one of the same shape.
- **Changed:** an opening width of 0 or less is rejected (`invalid-opening`; a parse error when
  loading XML).
- The fill at wall junctions is clickable at every zoom.
- Room outlines follow the wall faces where the miter would shoot off: a step where walls of
  different thickness meet in a (nearly) straight line, a bevel round a sharp spike of wall. A
  room could lose its area, be drawn kilometres wide, or vanish after saving.
  **Changed:** the area and outline of such rooms change, their inner `roomPolygon` has more
  points than the room has nodes, and an item reaching into the thicker wall is `outside-room`.
- **Changed:** where a room is narrower than its walls, `roomArea(…, 'inner')` is the floor the
  walls as drawn leave free. Phantom rooms (inside-out outlines with a large area) are no longer
  detected or accepted, and real rooms that such outlines lost are found again. A phantom already
  stored in a file is reported as `room-degenerate`: edits of its walls that leave it that narrow
  are rejected, and the next structural edit removes it (a follow roof on it becomes independent).
- A wall loop too small to be a room becomes one when its walls are dragged larger (`moveNode`,
  `moveWall`, `setWallLength`); it used to wait for the next structural edit or a reload.

Milestone 7: irregular lots and roofs.

- Irregular lots: slab outlines, wall joins and roof outlines use a miter limit so acute corners are bevelled; `floorOutline(floor, roomIds?)` returns the outer
  wall faces of the union of rooms; `DrawWallTool` and `RoofTool` snap to site vertices and edges.
- Core: `Floor.roofs` and `Roof` (follow rooms or independent points / holes; per-edge `gable`,
  `slope:p` or `slope:p/breakHeight/upperPitch`; `wallEdges`, `holeEdges`; materials `tile`,
  `metal`, `concrete`, `glass`, `polycarbonate`; `supports="posts"`); XML `<roof>` (see
  `docs/xml-format.md`); `ROOF_PRESETS` (`thai`, `japanese`, `metal`, `traditional`, `gable`,
  `hip`, `shed`, `mansard`, `gambrel`, `flat`, `glass-frame`, `poly-frame`).
- Commands: `addRoof`, `updateRoof` (`setRoofParams`), `setRoofEdge`, `detachRoof`,
  `fitRoofToWalls`, `removeRoof`; new blocking code `invalid-roof`.
- Geometry: `roofGeometry`, `roofFaceArea`, `gableProfile` (weighted straight skeleton with
  per-edge pitch, broken slopes, overhangs and rakes); `validateLayout` warns with
  `roof-invalid-outline`, `roof-no-walls` and `roof-build-failed` (the roof is then drawn flat).
- Walls: low walls (parapets) close height steps in joins and get the `-wall-low` plan class;
  gable walls are raised to the roof underside in 3D.
- 3D: roof meshes (`h3xKind: 'roof'`, `h3x-roof-<id>`), frame bars and posts for light roofs,
  `scene.getRoofMeshes(id, floorId?)`, `viewer.setRoofsVisible(visible)`.
- Plan: roofs layer (outline, overhang, ridge / hip / valley lines, slope arrows, light hatch,
  posts), real-outline hit testing, `plan.setRoofsVisible(visible)`, `RoofTool` (follow / draw),
  roof editing in `SelectEditTool` (vertex drag detaches a follow roof, edge click fires
  `roofEdgeRequest`, Delete) and the `roofdetached` event; new plan issue `roof-no-room`.
- Example page: roof tool with preset and mode pickers, roofs visibility toggle and a sample
  four-storey townhouse on a trapezoid lot (`examples/layouts/townhouse-trapezoid.xml`).
- Roadmap reordered: M8 objects and openings, M9 editing fundamentals, M10 2D documentation,
  M11 quantities, M12 views, M13 h3xEditor, M14 packaging and docs.

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
