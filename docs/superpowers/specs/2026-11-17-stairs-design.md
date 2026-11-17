# Milestone 6 — Stairs design

Date: 2026-11-17. Status: draft for approval.

## Intent

Milestone 5 stacks floors; nothing connects them yet. Townhouse contractors (the target users, see
`docs/market-research/README.md`) reserve a stair bay — a fixed rectangle, e.g. 2.2 × 4.5 m — on
each floor and fit the stair into it. M6 lets them do exactly that: drag a stair bay, pick a type,
and the engine lays out flights, landings or winders and steps so they fit the storey height, cuts
the slab opening above, and draws the stair in 2D (drawing conventions) and 3D. When a storey
height changes, the steps recompute.

## Goals

1. **Stair as a bay.** A stair is a rotated rectangle on a floor (the lower floor) with
   parameters: type (`straight`, `L`, `U`, `spiral`), turn style for L / U (`landing` or `winder`,
   both supported — the user wants both), hand (`left` / `right`: which way it turns), flight width.
   It climbs from its floor to the floor directly above.
2. **Automatic steps.** Rise H = `elevation(above) − elevation(floor)`. Risers n = `ceil(H / 0.18)`,
   riser height h = H / n. Tread b = `0.62 − 2h`; if the flights do not fit the bay, b may shrink
   down to `0.60 − 2h` (so 2h + b stays within 0.60–0.64). Treads = risers − 1 in total (the last
   riser lands on the upper floor); a landing takes the place of one tread at its level. If it
   still does not fit, the stair is reported, not drawn.
3. **Layout per type** (local frame: origin at the bay centre, +y = the first flight's climbing
   direction, the first riser on the −y edge):
   - `straight`: one flight along +y, width = flight width, placed against the `hand` side.
   - `L`: first flight along +y on the side opposite the turn, a 90° turn toward `hand`, second
     flight along the +y edge. Turn = a square landing (side = flight width) or 3 winders.
   - `U`: first flight along +y on one side, a 180° turn toward `hand`, second flight back along
     −y on the other side. Turn = a landing across the bay (depth = flight width) or 6 winders
     (3 per 90°). The gap between flights (well) = bay width − 2 × flight width, ≥ 0.
   - `spiral`: centred in the bay, diameter = min(width, depth), centre column 0.15 m diameter,
     climbing counter-clockwise for `left`, clockwise for `right`. Tread depth b measured on the
     walking line at 2/3 of the radius. Headroom: one full turn must rise at least 2.1 m (my call:
     2.0 m clear + slab); if not, it is reported.
   - Winders radiate from the inner corner of the turn (pointed inner ends are allowed — common in
     narrow townhouses). Their tread depth on the walking line (middle of the flight) must be
     ≥ `0.60 − 2h`.
   - **Where the slack goes (my call).** The stair always arrives at a bay edge: the last riser
     lies on the bay boundary, where the upper slab edge is. Leftover length is absorbed so no odd
     strip appears at the top:
     - `straight`: the slack goes to the bottom; the first riser is set back from the −y edge
       (floor space in front of the stair, inside the bay).
     - `L` / `U` with a landing: risers are split as evenly as possible between the two flights
       (the first flight takes the extra riser when odd) and the landing grows to absorb the
       slack. The first flight starts at the −y edge; the second ends at the far edge (the side
       edge for L, the −y edge for U).
     - `L` / `U` with winders: the slack goes to the bottom of the first flight, as for straight.
     - `spiral`: the open corners of the square opening are accepted.
4. **Slab opening.** The floor directly above gets an opening equal to the stair bay (my call: the
   whole bay — simple, always gives headroom). The slab and the room floors of that floor are cut
   by it in 3D; in 2D the upper floor shows the opening.
5. **Editing.** Commands `addStair`, `updateStair(id, patch)`, `removeStair` (each one undo step).
   A `StairTool` in the plan drags a bay (two corners, snapped like drawing) and adds a stair with
   default parameters. `SelectEditTool` selects, drags (moves) and deletes stairs. Changing type,
   hand, turn, flight width or rotation is done by the host calling `updateStair`.
6. **Copy on add floor.** `addFloor` copies stairs like columns (fresh ids, same bay and
   parameters), because townhouse stairs stack in the same bay. The new top floor therefore
   carries a stair with `stair-no-floor-above` until another floor is added; the user deletes it
   or keeps it for roof access (M7). This is a normal, non-blocking state.
7. **Validation (non-blocking warnings, so a storey-height change is never blocked):**
   - `stair-does-not-fit` — flights / winders / spiral headroom cannot fit the bay.
   - `stair-no-floor-above` — the stair is on the top floor.
   - `stair-overlaps-wall` — a wall outline overlaps the bay interior by more than 1 cm² (touching
     a wall face, the normal case for a bay inside a stairwell, does not count).
     A stair with one of the first two warnings is drawn as its bay outline only.
8. **2D drawing** (on the stair's floor): steps as lines, the walking line with an arrow from the
   first riser, the label "UP" (overridable, see below), and a diagonal break line across the first
   flight at about 1.2 m height; steps beyond the break are drawn dashed. On the floor above: the
   opening outline and the whole stair seen from above (thin lines), with the label "DN".
   Label text comes from a plan option `stairLabels?: { up: string; down: string }` (default
   `{ up: 'UP', down: 'DN' }`) so h3xEditor can localise ("LÊN" / "XUỐNG").
9. **3D.** Each stair is a concrete-style mass: solid steps on a sloped soffit (waist) for flights,
   flat landings, winder wedges, spiral wedges around the centre column. One simple handrail
   (0.9 m above the step nosings) on the open side of each flight. Built in the stair floor's
   group, shown / hidden with it by the view modes.

## Non-goals

- Free-form stairs, curved (non-spiral) flights, stairs spanning more than one storey.
- Detailed railings, balusters, stair finishes per step.
- Free voids / double-height openings (ô thông tầng, giếng trời) not tied to a stair — a separate
  element later; this design must not block it.
- A manual riser-count override (follow-up if contractors ask).
- The opening in core data: room areas, quantities and item / column checks ignore it in M6 (a 2D /
  3D matter). The quantities milestone will subtract it.
- Host UI for stair parameters (h3xEditor, M9).

## Anti-goals

- Drawing a stair that does not fit. A misfit is reported and shown as an outline, never squeezed.
- Stored step geometry going stale: steps are always derived, never saved.

## Constraints

- h3x.js is logic only: methods, events, tools; no input boxes (see
  `project-library-vs-editor-split`).
- XML stays version 1; `<stair>` is a new optional element inside `<floor>`; older files load.
- Follows the M5 floor model: a stair is a floor-scoped entity, its changes carry `floorId`, undo
  works per floor, ids unique within a floor.

## Approaches considered

- **A. `stair` entity on the lower floor, geometry derived (chosen).** Only the user's parameters
  are stored. A pure `layoutStair(stair, rise)` computes flights, steps, landings / winders, the
  walking line and the opening; 3D, 2D and validators all use it. The opening on the floor above
  is derived from the stairs of the floor below. Fits the M5 change model, undo, `addFloor` copy
  and XML, and recomputes on height changes.
- **B. Store computed steps in the file.** Allows per-step edits but goes stale on every height
  change; contradicts automatic recomputation.
- **C. Project-level stair linking floor X to floor Y.** Allows multi-storey stairs but breaks the
  "every change belongs to one floor" model from M5 (undo, events, floor copy). Townhouse stairs
  always link adjacent floors.

The user chose A.

## Design

### Data model (`h3x/core`)

```ts
type StairType = 'straight' | 'L' | 'U' | 'spiral';
interface Stair {
  id: Id;
  x: number;
  y: number; // bay centre
  width: number;
  depth: number; // bay size along local x / y, meters
  rotation: number; // radians, local +y = climbing direction of the first flight
  type: StairType;
  turn: 'landing' | 'winder'; // ignored for straight / spiral
  hand: 'left' | 'right';
  flightWidth: number; // meters; ignored for spiral
}
```

- `Floor.stairs: Record<Id, Stair>`; `EntityKind` gains `'stair'`.
- Defaults for `addStair`: `type 'U'`, `turn 'landing'`, `hand 'right'`, `flightWidth 0.9`,
  `rotation 0` (my calls: U with a landing is the most common townhouse stair).
- Validation at command / parse time (blocking, code `invalid-stair`): width, depth, flightWidth
  finite and > 0; flightWidth ≤ width for straight and L, ≤ width / 2 for U.

### Layout (`core/stairs/layout.ts`)

`layoutStair(stair: Stair, rise: number): StairLayout`

```ts
type StairLayout =
  | { ok: false; reason: 'does-not-fit' | 'no-rise' }
  | {
      ok: true;
      risers: number;
      riserHeight: number;
      treadDepth: number;
      steps: { outline: Vec2[]; top: number }[]; // plan polygons, world coords; top above floor
      landings: { outline: Vec2[]; top: number }[];
      walkLine: Vec2[]; // from first riser to last
      opening: Vec2[]; // bay rectangle, world coords
    };
```

`rise` is `elevation(above) − elevation(floor)`; callers pass `NaN` / call with `no-rise` when
there is no floor above. Pure, deterministic, unit-tested per type and turn style. A helper
`stairLayoutFor(doc or project, floorId, stairId)` resolves the rise.

### Commands

`addStair(input: Omit<Stair, 'id' | defaults>)` returning `createdId`, `updateStair(id, patch)`,
`removeStair(id)`. `addFloor` copies `stairs` with fresh ids. `removeFloor` removes them.

### Validation

`validateStairs(floor, above: Floor | undefined): Issue[]` appended in `doc.validateLayout()` —
`stair-does-not-fit`, `stair-no-floor-above`, `stair-overlaps-wall` (non-blocking, like
`column-unsupported`).

### XML

`<stair id x y width depth rotation type turn hand flightWidth/>` inside `<floor>`;
`rotation` default 0, `turn` default `landing`, `hand` default `right`, `flightWidth` default 0.9,
`type` required. Bad values are parse errors (`element: stair`). Documented in
`docs/xml-format.md`.

### 3D (`h3x/three`)

- `buildStairGeometry(layout, floor)` → BufferGeometry (steps + waist + landings / winders /
  spiral + centre column) and a handrail geometry; meshes `h3xKind: 'stair'`, `h3xId`,
  `h3xFloorId`, in the stair floor's `FloorView`.
- The slab and room floors of the floor above get holes for every opening of the stairs on the
  floor below (clip the opening polygon out; builder picks the clipping approach, e.g. treating the
  opening as an extra hole where it lies inside, clipping where it crosses).
- Rebuild rules: a stair change rebuilds its floor and the floor above (opening); a `'floor'`
  change already rebuilds affected floors.

### 2D (`h3x/plan`)

- New plan kind `stair` rendered from `layoutStair` (steps, walking line + arrow, label, break
  line, dashed steps beyond); bay outline only when the layout is not ok; `invalid` styling from
  the warnings as for other kinds.
- The floor above shows a non-interactive layer with the openings and the stairs seen from above,
  labelled "DN" (reuse / extend the M5 underlay layer).
- `StairTool` (drag a bay; Esc cancels), selection / move / delete in `SelectEditTool`;
  hit-testing on the bay rectangle. Bay corners snap to the corners of room inner outlines (wall
  faces) first, then to the grid, so a bay dragged inside a stairwell room sits on the wall faces
  and does not trigger `stair-overlaps-wall` (my call: nodes are wall centrelines and would overlap
  half of each wall).
- Plan option `stairLabels`.

## Left to the builder

- Exact riser split between flights for L / U, winder tread geometry details within the rules
  above, the 3D waist thickness (suggest 0.12 m), handrail cross-section.
- Clipping approach for openings in slab / room floor geometry.
- Example page: a "Stair" tool button, a few throwaway parameter controls for the selected stair
  (type, turn, hand, flight width, rotate 90°), stairs added to the townhouse sample layout.
- README, CHANGELOG, `docs/validation.md`, roadmap status.
