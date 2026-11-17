# Multi-floor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let h3x edit a whole house: an active floor, add / remove floors (copy of the floor below), stacked elevations with per-floor heights and slab thickness, slabs and view modes in 3D, faded floor below in 2D.

**Architecture:** The document holds `activeFloorId`; `doc.floor` returns the active floor so M1–M4 commands, tools and validators keep working. Every floor-scoped `EntityChange` carries `floorId`, and a new `'floor'` entity kind carries floor properties, so undo / redo and change events are exact across floors. Elevations and levels are derived by one pure function and emitted as `'floor'` changes by the commands that alter them.

**Tech Stack:** TypeScript, vitest (jsdom for plan tests), three.js, SVG, pnpm.

**Spec:** `docs/superpowers/specs/2026-11-17-multi-floor-design.md`

## Global Constraints

- XML stays `version="1"`; files from M1–M4 must load unchanged in behaviour.
- `slabThickness` default `0.15` m; `wallHeight` > 0, `slabThickness` > 0, all finite.
- Elevation above ground: `elev(n) = elev(n−1) + wallHeight(n−1) + slabThickness(n)`; below ground: `elev(n) = elev(n+1) − slabThickness(n+1) − wallHeight(n)`. Only the ground floor (level 0) elevation is an input.
- Ids are unique within a floor only; anything spanning floors keys by `(floorId, id)`. `addFloor` copies get fresh ids (`createId()`).
- `column-unsupported` tolerance: 1 cm (0.01 m), non-blocking.
- h3x.js ships no UI; the example page may add throwaway controls.
- A one-floor document behaves exactly as today. All existing tests keep passing.
- Verification commands: `pnpm test`, `pnpm typecheck`, `pnpm lint`.

## Review Focus

1. Undo of `addFloor` while the new floor is active: active floor falls back to the floor below, `'activefloor'` fires after `'change'`, plan and scene don't throw. → Task 2 + Task 3 tests.
2. An M4 single-floor file without `slabThickness` loads, keeps its ground elevation, and saves with `slabThickness="0.15"`. → Task 1 test.
3. A coalesced drag on floor A, then `setActiveFloor(B)`, then `undo()`: floor A changes, floor B untouched, and the drag is not merged with a later edit on B. → Task 2 test.
4. A loaded file with the same wall id `w1` on two floors: the scene builds both, `getWallMesh('w1', fA) !== getWallMesh('w1', fB)`. → Task 1 (loads) + Task 5 test.
5. Removing a middle floor renumbers levels and recomputes elevations above it; undo restores levels, elevations and all contents exactly (deep-equal project). → Task 3 test.

---

### Task 1: Floor model, stack derivation, XML and load normalisation

**Files:**
- Modify: `src/core/types.ts` (Floor, EntityKind, new FloorProps)
- Create: `src/core/floors/stack.ts`
- Modify: `src/core/xml/parse.ts`, `src/core/xml/serialize.ts`, `src/core/document/H3xDocument.ts` (create, constructor)
- Modify: `src/core/constants.ts` (DEFAULT_SLAB_THICKNESS)
- Test: `tests/core/floors-stack.test.ts`, `tests/core/xml.test.ts`

**Interfaces:**
- Produces:
  - `Floor.slabThickness: number`
  - `type FloorProps = Pick<Floor, 'id' | 'level' | 'elevation' | 'wallHeight' | 'slabThickness'>`
  - `EntityKind` gains `'floor'`
  - `DEFAULT_SLAB_THICKNESS = 0.15`
  - `deriveStack(floors: FloorProps[], groundIndex: number, groundElevation: number): FloorProps[]` — input sorted lowest first; returns new objects with `level = i − groundIndex` and elevations by the Global Constraints formulas; other fields copied.
  - `normalizeFloors(project: Project): void` — mutates: sorts floors by level (stable, file order breaks ties), picks the ground floor (exactly one level 0 → it; else lowest with level ≥ 0; else highest), then applies `deriveStack` with that floor's elevation.
  - `floorProps(f: Floor): FloorProps`

- [ ] **Step 1: Write failing tests** in `tests/core/floors-stack.test.ts`:
  - `deriveStack` on `[B(-1, wh 2.8, t .2), G(0, elev .45, wh 3.6, t .15), F1(wh 3.3, t .12)]`, groundIndex 1, groundElevation 0.45 → levels `[-1,0,1]`, elevations `[0.45−0.15−2.8 = −2.5, 0.45, 0.45+3.6+0.12 = 4.17]` (toBeCloseTo).
  - `normalizeFloors`: levels `1,2,3 → 0,1,2`; `−1,1 → −1,0`; `0,0 → 0,1` (second in file order becomes 1); all negative `−3,−2 → −1,0`; ground elevation from file kept, others recomputed.
  - In `tests/core/xml.test.ts`: an M4-style XML with one floor `elevation="0.3"` and no `slabThickness` → `floor.slabThickness === 0.15`, `elevation === 0.3`, and `toXML()` contains `slabThickness="0.15"`; round trip of `slabThickness="0.12"`; non-positive or non-numeric `slabThickness` is a parse error (`element: floor`, `attribute: slabThickness`); duplicate floor id is a parse error; same wall id on two floors loads.
- [ ] **Step 2:** `pnpm test tests/core/floors-stack.test.ts tests/core/xml.test.ts` → FAIL.
- [ ] **Step 3:** Implement. `normalizeFloors` runs in the `H3xDocument` constructor (so both `fromXML` and `fromProject` get it); `fromProject` also defaults a missing `slabThickness` like it does `columns`. `H3xDocument.create()` floor gets `slabThickness: DEFAULT_SLAB_THICKNESS`. Fix every exhaustive switch / record over `EntityKind` that `pnpm typecheck` flags (plan `entitiesOf`, scene `GEOMETRY_KINDS`, change `COLLECTION`) — `'floor'` changes are not handled yet beyond compiling (Task 2).
- [ ] **Step 4:** `pnpm test && pnpm typecheck` → PASS.
- [ ] **Step 5:** Commit `feat(core): floor slab thickness, stacked elevations and level normalisation`.

### Task 2: Floor-aware changes, history and active floor

**Files:**
- Modify: `src/core/document/changes.ts`, `src/core/document/history.ts`, `src/core/document/H3xDocument.ts`
- Test: `tests/core/active-floor.test.ts`

**Interfaces:**
- Consumes: `FloorProps`, `floorProps` (Task 1).
- Produces:
  - `EntityChange` members gain `floorId?: Id` (required in practice after `execute`: present on every change except `kind: 'site'`; for `kind: 'floor'`, `floorId === id`). `EntityByKind.floor = FloorProps`.
  - `CommandContext` gains `project: Readonly<Project>` and `floorId: Id` (active floor id).
  - `applyChanges` writes floor-scoped changes into `project.floors.find(f => f.id === c.floorId)`; a `'floor'` change with `before === null` inserts a floor (props + empty collections) keeping `floors` sorted by level; `after === null` deletes it; both non-null updates props in place, then re-sorts.
  - `mergeChanges` keys by `${floorId ?? ''}:${kind}:${id}`.
  - `H3xDocument`: `get activeFloorId(): Id`; `setActiveFloor(id: Id): void` (throws `H3xValidationError` code `unknown-floor` for a bad id; no-op if unchanged; calls `endCoalesce()`; emits `'activefloor'`); `on(type: 'activefloor', fn: (e: { floorId: Id; previous: Id }) => void): () => void`; `floorById(id): Readonly<Floor> | undefined`; `floorBelow(id): Readonly<Floor> | undefined`; `floorAbove(id): Readonly<Floor> | undefined`; `get floor()` returns the active floor.

- [ ] **Step 1: Write failing tests** in `tests/core/active-floor.test.ts` (build a 2-floor doc from XML, `f0` level 0 and `f1` level 1, both with a wall `w1`):
  - default active floor is the level-0 floor; `doc.floor.id === 'f0'`.
  - after `setActiveFloor('f1')`, `execute(moveNode(...))` changes only `f1`; the emitted change has `floorId: 'f1'`.
  - Review Focus 3: coalesced `moveNode` on `f0` with key `'drag'`, `setActiveFloor('f1')`, `moveNode` on `f1` with the same key → two undo steps; `undo()` reverts only `f1`'s node, second `undo()` only `f0`'s, while active stays `f1`.
  - `setActiveFloor('nope')` throws with code `unknown-floor`; setting the same floor emits nothing.
  - validators: a custom validator added with `addValidator` receives only changes whose `floorId` is the active floor or `kind === 'site'`, and is not called when that filtered list is empty.
  - applying a `'floor'` insert then delete via `applyChanges` leaves `project.floors` deep-equal to the start.
- [ ] **Step 2:** `pnpm test tests/core/active-floor.test.ts` → FAIL.
- [ ] **Step 3:** Implement. `ctx()` passes the active floor, its id and the project. In `attempt`/`preview`, stamp `floorId = activeFloorId` on every change returned without one (except `site`), then filter changes for validators as tested. After every apply (execute, undo, redo, cancel), if `activeFloorId` no longer exists, move it to the floor that was below it (else the lowest floor) and emit `'activefloor'` **after** the `'change'` event. Keep the previous floor's level to find "below" — store it before applying.
- [ ] **Step 4:** `pnpm test && pnpm typecheck` → PASS.
- [ ] **Step 5:** Commit `feat(core): active floor and floor-scoped changes`.

### Task 3: Floor commands

**Files:**
- Create: `src/core/commands/floors.ts`
- Modify: `src/core/index.ts` (exports)
- Test: `tests/core/floors-commands.test.ts`

**Interfaces:**
- Consumes: `CommandContext.project`, `deriveStack`, `floorProps`, `detectRooms` (`src/core/rooms/detect.ts`), `createId`.
- Produces (all `Command`):
  - `addFloor(opts: { position: 'above' | 'below'; wallHeight?: number; slabThickness?: number }): Command & { createdId: Id }` — source = top floor (`above`) or lowest (`below`). Changes, in order: the new `'floor'` insert; nodes, walls, columns copied with fresh ids (wall `a`/`b` remapped; finishes, thickness, height kept); rooms from `detectRooms` on the copy with fresh ids and no `name` / `floorFinish`; then `'floor'` updates for every other floor whose derived level / elevation changed. Openings and items not copied. Defaults copy the source floor's `wallHeight` / `slabThickness`.
  - `removeFloor(floorId: Id): Command` — removals of all its rooms, items, openings, columns, walls, nodes (that order), then the `'floor'` delete, then derived `'floor'` updates. Throws `H3xValidationError` code `floor-protected` for level 0 or the last floor; `unknown-floor` for a bad id.
  - `setFloorHeight(floorId: Id, wallHeight: number): Command`, `setSlabThickness(floorId: Id, t: number): Command`, `setGroundElevation(value: number): Command` — throw code `invalid-floor-dimension` for non-finite or non-positive height / thickness (ground elevation may be any finite number); emit `'floor'` updates for every floor whose props changed; no-op (empty list) if nothing changed.
  - Internal helper in the same file: `stackChanges(before: FloorProps[], after: FloorProps[]): EntityChange[]` — `'floor'` update changes for props that differ, matched by id.

- [ ] **Step 1: Write failing tests:**
  - `addFloor({position:'above'})` on a floor with 4 walls, 1 door, 1 item, 2 columns and a named room → new floor has 4 walls, 2 columns at the same coordinates, 0 openings, 0 items, 1 room with no name; no id on the new floor equals an id on the source; new level 1, elevation `= elev0 + wh0 + t`; active floor unchanged; one `undo()` restores the project deep-equal.
  - `addFloor({position:'below'})` on a ground-only doc → level −1, elevation `elev0 − t0 − wh`; ground keeps level 0 and its elevation.
  - Review Focus 1: `addFloor` above, `setActiveFloor(created)`, `undo()` → active is the ground floor; listener order is `change` then `activefloor`.
  - Review Focus 5: floors 0..3, `removeFloor(level-2 id)` → levels `0,1,2`, the floor that was level 3 is now level 2 with elevation `elev(level 1) + wh1 + t3`; `undo()` restores the project deep-equal to before.
  - `removeFloor` on level 0 and on the last floor → `floor-protected`.
  - `setFloorHeight(f0, 3.0)` with floors 0..2 → floors 1 and 2 elevations move by the delta; `setSlabThickness(f1, 0)` → `invalid-floor-dimension`; `setGroundElevation(0.6)` moves every floor by +0.15 from 0.45.
- [ ] **Step 2:** `pnpm test tests/core/floors-commands.test.ts` → FAIL.
- [ ] **Step 3:** Implement; set `floorId` explicitly on every change these commands return (Task 2 stamping must not overwrite an existing `floorId`). Export from `src/core/index.ts`; update `tests/core/public-api.test.ts` if it snapshots exports.
- [ ] **Step 4:** `pnpm test && pnpm typecheck` → PASS.
- [ ] **Step 5:** Commit `feat(core): add, remove and size floors`.

### Task 4: Column support warning

**Files:**
- Create: `src/core/validate/floors.ts`
- Modify: `src/core/document/H3xDocument.ts` (`validateLayout()` appends it)
- Test: `tests/core/column-support.test.ts`

**Interfaces:**
- Consumes: `doc.floorBelow`.
- Produces: `validateColumnSupport(floor: Floor, below: Floor | undefined): Issue[]` — one issue per column of `floor` with no column in `below` whose centre is within 0.01 m; `code: 'column-unsupported'`, `ids: [columnId]`. Returns `[]` when `below` is undefined. Not part of the blocking validators.

- [ ] **Step 1: Failing tests:** aligned column → no issue; column moved 0.02 m on the upper floor → one issue; lowest floor → none; `execute(moveColumn(...))` with an unsupported column still succeeds; after `addFloor` above, `setActiveFloor(new)`, `doc.validateLayout()` has no `column-unsupported`.
- [ ] **Step 2:** run → FAIL. **Step 3:** implement; document the code in `docs/validation.md`. **Step 4:** `pnpm test` → PASS.
- [ ] **Step 5:** Commit `feat(core): column-unsupported warning`.

### Task 5: 3D — all floors, slabs, view modes

**Files:**
- Modify: `src/three/scene.ts`
- Create: `src/three/slab.ts`
- Modify: `src/three/index.ts` (exports: `H3xViewMode`, `buildSlabGeometry`)
- Test: `tests/three/scene.test.ts`, `tests/three/slab.test.ts`

**Interfaces:**
- Consumes: `doc.project.floors`, `doc.activeFloorId`, `'activefloor'` event, `EntityChange.floorId`.
- Produces:
  - `type H3xViewMode = 'active' | 'cutaway' | 'all'`
  - `H3xScene.setViewMode(mode: H3xViewMode): void`, `get viewMode(): H3xViewMode` (default `'all'`); visibility only, no geometry rebuild; fires `onInvalidate` listeners.
  - `getWallMesh(id, floorId?)`, `getColumnMesh(id, floorId?)`, `getFloorMesh(roomId, floorId?)`, `getSlabMesh(floorId?)` — default the active floor.
  - One `Group` per floor, `name = 'h3x-floor-' + floorId`, `userData.h3xFloorId`; each holds the existing walls / rooms / joins / columns groups for that floor plus one slab mesh (`userData.h3xKind = 'slab'`, `h3xId = floorId`). `H3xKind` gains `'slab'`.
  - `buildSlabGeometry(floor: Floor): BufferGeometry | null` — the floor's outer outline (union of room outlines grown to the outer wall faces — builder's choice, reuse room / join geometry), a closed prism from `elevation − slabThickness` to `elevation`; `null` for a floor with no rooms.

- [ ] **Step 1: Failing tests:**
  - 3-floor doc → three floor groups; ground slab box `min.y ≈ elev0 − t0`, `max.y ≈ elev0`; upper walls start at their floor elevation.
  - modes with active = middle floor: `'active'` → only middle group visible; `'cutaway'` → ground + middle visible, top hidden; `'all'` → all visible; `setActiveFloor` updates visibility in the current mode.
  - Review Focus 4: file with `w1` on two floors → two distinct meshes via `getWallMesh('w1', fA)` / `(…, fB)`.
  - a `moveNode` on the active floor rebuilds only that floor (other floor's wall mesh keeps the same `geometry` object); `setFloorHeight` on the ground floor rebuilds floors whose elevation changed; `removeFloor` disposes that group's geometries and removes the group.
  - `slab.test.ts`: rectangular 4×5 room with 0.2 walls → slab footprint covers the outer wall faces (bbox 4.2×5.2 for centreline 4×5), thickness `slabThickness`; floor with no rooms → `null`.
- [ ] **Step 2:** run → FAIL. **Step 3:** implement. Geometry already uses `floor.elevation`, so an elevation change can simply rebuild that floor. **Step 4:** `pnpm test && pnpm typecheck` → PASS.
- [ ] **Step 5:** Commit `feat(three): all floors, slabs and view modes`.

### Task 6: 2D — active floor switching and faded floor below

**Files:**
- Modify: `src/plan/H3xPlan.ts`, `src/plan/render.ts` (underlay layer), `src/plan/style.ts`
- Create: `src/plan/underlay.ts`
- Test: `tests/plan/H3xPlan.floors.test.ts`

**Interfaces:**
- Consumes: `doc.floorBelow`, `'activefloor'` event, `EntityChange.floorId`.
- Produces:
  - `renderUnderlay(below: Floor | undefined, layer: SVGGElement, ctx: { view; corners }): void` in `underlay.ts` — replaces the layer's children with wall polygons and column shapes (reuse `shapes.ts`), class `${prefix}-underlay`; empty when `below` is undefined.
  - A `<g class="${prefix}-underlay">` layer inserted above the grid and below rooms; `pointer-events: none`.
  - CSS rule: `.${prefix}-underlay polygon, .${prefix}-underlay circle { fill: none; stroke: #a8a29e; stroke-width: 1; opacity: 0.6; }` (style values are the builder's to tune).

- [ ] **Step 1: Failing tests** (jsdom, 2-floor doc):
  - active = upper floor → underlay layer has one element per lower-floor wall and column; active = ground → underlay empty.
  - hit-testing at a point covered only by an underlay wall selects nothing; `snapDraw` ignores underlay geometry (draw tool starting on an underlay wall end does not snap to it).
  - on `setActiveFloor`, selection becomes `null` (`selectionchange` fires), an in-progress `DrawWallTool` chain is cancelled, and the rendered walls are the new floor's.
  - a change on the floor below re-renders the underlay; a change on an unrelated floor touches no element (spy on `syncEntity` or compare element identity) but `issues` are recomputed.
  - Review Focus 1: `undo()` of an `addFloor` while that floor is active → plan shows ground floor, no throw.
- [ ] **Step 2:** run → FAIL. **Step 3:** implement: subscribe to `'activefloor'` → clear selection, cancel the active tool gesture (use the tool's existing cancel path), `reconcileAll()`, re-render underlay. In `onChange`, only feed `dirtyEntities` with changes whose `floorId` is the active floor (plus `site`); re-render the underlay when any change has the floor-below id or `kind === 'floor'`. **Step 4:** `pnpm test && pnpm typecheck && pnpm lint` → PASS.
- [ ] **Step 5:** Commit `feat(plan): active floor switching and faded floor below`.

### Task 7: Example, sample layout and docs

**Files:**
- Create: `examples/layouts/townhouse-3f.xml` (basement + ground + 2 floors, ground elevation 0.45, mixed heights)
- Modify: `examples/main.ts`, `examples/index.html`
- Modify: `docs/xml-format.md`, `README.md`, `CHANGELOG.md`, `docs/roadmap.md` (M4 Done, M5 Done)
- Test: `tests/three/sample-layout.test.ts` (the new layout loads with no layout issues)

- [ ] **Step 1:** Failing test: `townhouse-3f.xml` parses, has levels `[-1,0,1,2]`, `validateLayout()` on each floor (via `setActiveFloor`) returns no blocking issues.
- [ ] **Step 2:** run → FAIL. **Step 3:** add the layout; example page: floor select (lists floors by level), buttons "Add above", "Add below", "Remove", number inputs for wall height / slab thickness of the active floor and ground elevation, a view-mode select — all throwaway, calling the Task 2–5 APIs. Docs: `slabThickness`, derived `level` / `elevation`, normalisation rules, `'floor'` change kind, `floorId`, `activefloor` event, view modes, `column-unsupported`. Remove "editing APIs work on the first floor".
- [ ] **Step 4:** `pnpm test && pnpm typecheck && pnpm lint && pnpm build` → PASS. Run `pnpm dev` and check in a browser: add a floor, switch floors, change heights, view modes.
- [ ] **Step 5:** Commit `docs: milestone 5 example page, layout, README and changelog`.
