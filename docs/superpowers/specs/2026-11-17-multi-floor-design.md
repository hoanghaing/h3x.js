# Milestone 5 — Multi-floor design

Date: 2026-11-17. Status: draft for approval.

## Intent

Milestones 1–4 edit one floor. The target users (Vietnamese townhouse design-build contractors,
see `docs/market-research/README.md`) design 3–5 storey houses, often with a basement. Stairs (M6)
and roof (M7) need several floors stacked with real heights. M5 makes the engine handle a whole
house: pick the floor being edited, add and remove floors, slabs with thickness, and views that
show how floors stack.

The workflow the user described: when a contractor adds a floor they get a copy of the floor below
(walls and columns in place, no items) and edit from there, because the outer walls and column grid
normally carry up through the house. Floor heights stack automatically, and each floor's height
can be typed because storeys differ.

## Goals

1. **Active floor.** The document has one floor being edited. Every existing editing API (commands,
   tools, validators, `doc.floor`) works on it. Undo / redo always change the floor where the
   change was made, whichever floor is active.
2. **Add floor above / below.** Adding a floor copies the top floor (for "above") or the lowest
   floor (for "below" / basement): nodes, walls and columns at the same positions, under new ids.
   Rooms are detected again from the walls, with no names and no finishes. Openings and items are
   not copied. One undo step.
3. **Remove floor.** Removes a floor and everything on it as one undo step. The last remaining
   floor and the ground floor (level 0) cannot be removed.
4. **Heights.** Each floor has `wallHeight` (clear storey height) and `slabThickness`, both editable
   per floor (undoable). The ground floor's `elevation` (cốt nền, e.g. 0.45 above the pavement) is
   editable. All other elevations are computed:
   - above ground: `elev(n) = elev(n−1) + wallHeight(n−1) + slabThickness(n)`
   - below ground: `elev(n) = elev(n+1) − slabThickness(n+1) − wallHeight(n)`

   (`elevation` is the top of that floor's slab; the slab occupies `[elev − slabThickness, elev]`.)
   Changing any height moves every floor above (or below, for basements) at once.

5. **Slabs in 3D.** Each floor gets a slab: the outer outline of its walls (the union of its rooms
   plus the wall thickness), extruded by `slabThickness` below its elevation. Room floor finishes
   stay as they are, drawn on top.
6. **3D view modes** on `H3xScene`: `'active'` (only the active floor), `'cutaway'` (the active
   floor and every floor below it, floors above hidden — so you can look into the active floor
   from above), `'all'` (whole house). Default `'all'`.
7. **Faded floor below in 2D.** `H3xPlan` draws the walls and columns of the floor directly below
   the active floor as a faded, non-interactive layer under the active floor. The lowest floor
   shows nothing. Switching the active floor re-renders the plan.
8. **Alignment warning.** A non-blocking issue `column-unsupported` for a column with no column
   on the floor directly below at the same position (tolerance 1 cm). The lowest floor never
   reports it.

## Non-goals

- Live synchronisation between floors. The copy is made once; after that floors are independent
  (decided by the user). The faded underlay and the column warning are the help for keeping them
  aligned.
- Slab openings and stairs (M6). Roof (M7). Items on other floors behave as they do today on the
  active floor, nothing more (M8).
- Floor picker or view-mode UI — that is h3xEditor (M9). The example page may add throwaway
  buttons.
- Mezzanines / split levels (floors not stacked one on another).

## Anti-goals

- Undo that changes a floor the user is not looking at **without telling the host**: every change
  event must say which floor it touched, so the host can switch to it if it wants.
- Breaking M1–M4 behaviour or files. A one-floor document must behave exactly as today.

## Constraints

- h3x.js is logic only; inputs and panels belong to h3xEditor (see
  `project-library-vs-editor-split`). M5 exposes methods and events.
- XML stays version 1 and backward compatible: old files load, with `slabThickness` defaulting.
- Ids stay unique within a floor (current rule); the same id may appear on two floors (older or
  hand-written files already do this) and a floor id may equal an entity id. Everything that
  spans floors keys by `(floorId, id)`. Copies made by `addFloor` still get fresh ids, so in
  practice repeats only come from loaded files.

## Approaches considered

- **A. Active floor held by the document (chosen).** `doc.activeFloorId`, `doc.setActiveFloor(id)`;
  `doc.floor` returns the active floor; each `EntityChange` carries `floorId`. Existing commands,
  tools and validators keep using `ctx.floor` / `doc.floor` unchanged. Plan and scene read the
  same active floor so they always agree. Cost: the document holds one piece of UI state (not
  saved to XML, not an undo step).
- **B. Every command takes a `floorId`, document has no active floor.** Purer core, but every
  command, tool and call site changes, and plan and scene must keep their own active floor in sync.
- **C. Per-floor handle objects (`doc.floorView(id).execute(...)`) with shared history.** Larger
  API, harder to explain, no user-visible gain over A.

The user chose A.

## Design

### Data model (`h3x/core`)

- `Floor` gains `slabThickness: number` (meters, > 0). `level` and `elevation` remain but become
  derived: `level` is the storey index (ground = 0, basements negative, contiguous), `elevation`
  is recomputed by the formulas above after every change. Only the ground floor's elevation is
  an input.
- `project.floors` is kept sorted by level, lowest first.
- New entity kind `'floor'` in `EntityChange`. Its snapshot is the floor's properties only
  (`{ id, level, elevation, wallHeight, slabThickness }`), not its contents. Adding a floor =
  a `floor` change (null → props) plus one change per copied node / wall / column / room;
  removing = the reverse. Applying a `floor` change creates the floor with empty collections or
  deletes it.
- Every non-site, non-floor `EntityChange` gains `floorId: Id`. `applyChanges` writes to that floor instead of
  `floors[0]`. `mergeChanges` keys on `(floorId, kind, id)`. Commands keep returning changes
  without `floorId`; `H3xDocument.execute` stamps the active floor id on them (commands that
  touch other floors — add / remove floor — set it themselves).
- After any apply (execute, undo, redo, load), levels and elevations are recomputed. Derived
  changes to other floors' `elevation` are included in the same change list as `floor` changes so
  events and undo stay exact.

### Document API

- `activeFloorId: Id` (getter), `setActiveFloor(id)` — throws for an unknown id; emits a new
  `'activefloor'` event `{ floorId, previous }`. Not undoable, not in XML. Default after load /
  create: the ground floor (level 0), else the lowest floor.
- `get floor()` returns the active floor. `floorById(id)`, `floorBelow(id)`, `floorAbove(id)`
  helpers.
- If the active floor is removed (by a command, undo or redo), the active floor moves to the floor
  below it (else above) and `'activefloor'` is emitted after the `'change'` event.
- `ChangeEvent` is unchanged in shape; each change now has `floorId`, so hosts can tell which floor
  an undo touched.

### Commands (in `core/commands/floors.ts`)

- `addFloor({ position: 'above' | 'below', wallHeight?, slabThickness? })` — copies the top / lowest
  floor as in goal 2. Defaults: copy the source floor's `wallHeight` and `slabThickness`. Fresh ids
  from the existing id generator. Rooms are re-detected on the new floor with the existing room
  detection, names and finishes empty.
- `removeFloor(floorId)` — refuses (H3xValidationError `floor-protected`) for level 0 or the last
  floor.
- `setFloorHeight(floorId, wallHeight)`, `setSlabThickness(floorId, t)`,
  `setGroundElevation(value)` — validated (`wallHeight` > 0, `slabThickness` > 0, finite).

### Validation

- Validators (built-in and `addValidator`) keep today's contract: they run against `doc.floor`,
  the active floor. My call: a command that changes another floor (`addFloor`, `removeFloor`) is
  not rejected by the per-floor validators; `addFloor` copies an existing floor, so it cannot
  introduce new layout errors. Undo / redo are not validated, as today.
- `column-unsupported` (goal 8) is part of `validateLayout()` for the active floor and reads the
  floor below. `H3xPlan` already recomputes issues on every change event, so an edit to the floor
  below refreshes it too (changes on any floor trigger the recompute).
- Duplicate floor ids are a parse error (they would break every reference).

### Level normalisation on load (my call)

M1–M4 never checked levels, so old multi-floor files may have gaps, a missing level 0 or
duplicates. Loading must not fail on these:

1. Sort floors by `level`, ties broken by file order.
2. Pick the ground floor: the floor with level 0 if exactly one; otherwise the lowest floor with
   level ≥ 0; if all levels are negative, the highest floor.
3. Renumber contiguously around it: ground = 0, floors after it 1, 2, …, floors before it −1, −2, ….
   Examples: `1,2,3 → 0,1,2`; `−1,1 → −1,0`; `0,0 → 0,1`.
4. The ground floor's `elevation` from the file is the anchor; all other elevations are recomputed.

So "ground floor" always means level 0 after load, and `setGroundElevation` always edits it.

### XML

- `<floor>` gains optional `slabThickness` (default `0.15` — my call; a common townhouse slab is
  10–15 cm plus finish).
- `elevation` and the normalised `level` are written, for other readers. On read, levels are
  normalised (above) and only the ground floor's `elevation` is used.
- `docs/xml-format.md`: drop the "editing APIs work on the first floor" note and document the new
  attribute and the derivation.

### 3D (`h3x/three`)

- `H3xScene` builds every floor, each in its own `Group` named by floor id, positioned at its
  elevation. Walls, joins, columns and room floors are built per floor as today; a new slab mesh
  per floor (userData `h3xKind: 'slab'`).
- `scene.setViewMode('active' | 'cutaway' | 'all')`, `viewMode` getter. Mode and active floor
  changes toggle group visibility without rebuilding geometry.
- Mesh maps are per floor (ids may repeat across floors). `getWallMesh(id, floorId?)` etc. default
  to the active floor.
- Rebuild granularity: a change rebuilds only the floors named in its `floorId`s; a `floor` change
  (heights) re-positions groups.

### 2D (`h3x/plan`)

- `H3xPlan` renders `doc.floor` (now the active floor) as today; it only holds one floor's
  elements, so its id-keyed maps and selection stay as they are. It ignores changes whose
  `floorId` is neither the active floor nor the floor below (except for re-running issues).
- New underlay layer below everything else: walls (outline only) and columns of
  `doc.floorBelow(active)`, using new style tokens (`underlay` colour, low opacity). Not hit-tested,
  not snapped to (my call — snapping to the floor below is a natural follow-up but adds rules).
- On `'activefloor'`, the plan clears selection, cancels any active tool gesture, and rebuilds.

## Left to the builder

- Exact slab outline algorithm (union of room polygons offset by half the wall thickness, or the
  outer boundary of the wall join polygons) — choose whichever reuses existing geometry best;
  for a floor with no rooms, no slab.
- Id generation details for copies, file layout within `core/commands`, style token values.
- Example page: throwaway floor buttons (add above / below, remove, previous / next), a view-mode
  select and a height input, plus a sample 3-floor layout with a basement in `examples/layouts`.
- README and CHANGELOG updates; roadmap status.
