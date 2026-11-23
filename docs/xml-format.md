# h3x XML format, version 1

An `.h3x` file is a plain XML document. Each object type has its own element, and the element's
attributes match the fields of the matching type in `src/core/types.ts`. Read it with
`projectFromXML` / `H3xDocument.fromXML` and write it with `projectToXML` / `doc.toXML`.

## Conventions

- Units are **meters**. Plan coordinates are `(x, y)`.
- Angles (`rotation`) are **radians, counter-clockwise**. `0` means the item's front faces `+y`.
- Ids are strings, unique within a floor across all element types (nodes, walls, openings, rooms,
  items, columns). Generated ids are 10-character nanoids.
- Numbers are written with at most 4 decimals (`XML_DECIMALS`), trailing zeros dropped, `-0`
  written as `0`. On read, any finite number is accepted.
- Writers sort child elements by id within each type, in the order node, wall, opening, room,
  item, column. A `<site>` is written directly after `<meta>`. Characters XML 1.0 forbids are written as U+FFFD; `& < > "` and line breaks are escaped.
- `flip` is written as `1` when true and omitted when false. On read, `1` and `true` mean true;
  anything else is false.
- Unknown elements inside `<floor>` are ignored on read (and lost on save). Unknown attributes are
  ignored.

## Elements

### `<h3x>` (root)

| Attribute | Type    | Required | Default | Notes                                                 |
| --------- | ------- | -------- | ------- | ----------------------------------------------------- |
| `version` | integer | yes      | -       | `>= 1`. Writers emit `1` (`FORMAT_VERSION`).          |
| `unit`    | string  | no       | `m`     | Only `m` is accepted; anything else is a parse error. |

Children: one optional `<meta>`, at most one `<site>` and one or more `<floor>`.

### `<meta>`

| Attribute | Type            | Required | Default | Notes          |
| --------- | --------------- | -------- | ------- | -------------- |
| `name`    | string          | no       | `""`    | Project name.  |
| `created` | ISO 8601 string | no       | `""`    | Not validated. |

### `<site>`

The ground outline, shared by all floors. Optional; at most one (a second is a parse error,
`element: site`).

| Attribute | Type       | Required | Notes                                                             |
| --------- | ---------- | -------- | ----------------------------------------------------------------- |
| `points`  | point list | yes      | Whitespace-separated `x,y` pairs, at least 3, all finite numbers. |

The stored order is counter-clockwise; on load a clockwise list is reversed (the first point stays
first). Fewer than 3 points or a malformed pair is a parse error (`element: site`,
`attribute: points`). In memory the site has the fixed id `site`; the id is not written.

### `<floor>`

| Attribute       | Type   | Required | Default | Notes                                                                |
| --------------- | ------ | -------- | ------- | -------------------------------------------------------------------- |
| `id`            | string | yes      | -       | Unique among floors (a duplicate is a parse error).                  |
| `level`         | number | no       | `0`     | Storey index; used to order floors on load, see below.               |
| `elevation`     | number | no       | `0`     | Height of the floor surface above ground, meters. Ground floor only. |
| `wallHeight`    | number | yes      | -       | Default wall height, meters.                                         |
| `slabThickness` | number | no       | `0.15`  | Thickness of the slab under this floor, meters; must be above 0.     |

Children: `node`, `wall`, `opening`, `room`, `item`, `column`, `stair`, `roof`, in any order. A file may hold
several floors; every floor can be edited by making it the active floor (see the README).

**Stack normalisation.** On load the floors are sorted by `level` (file order breaks ties) and
the stack is rebuilt:

- The **ground floor** is the single floor with `level="0"`; if several share level 0 or none
  does, it is the lowest floor with `level >= 0`, else the highest floor. It is renumbered to
  level 0 and the others contiguously (basements `-1`, `-2`, ..., upper floors `1`, `2`, ...), so
  in memory `level` is always contiguous.
- Only the ground floor's `elevation` is read. Every other elevation is derived and written back
  on save:
  - above the ground: `elevation(n) = elevation(n-1) + wallHeight(n-1) + slabThickness(n)`
  - below the ground: `elevation(n) = elevation(n+1) - slabThickness(n+1) - wallHeight(n)`
- Ids need to be unique only within one floor; two floors may both hold a `w1`.

### `<node>`

| Attribute | Type   | Required | Notes                  |
| --------- | ------ | -------- | ---------------------- |
| `id`      | string | yes      |                        |
| `x`, `y`  | number | yes      | Plan position, meters. |

### `<wall>`

A straight wall between two nodes, centered on the line between them. Its direction is `a` to
`b`; "left" and "right" refer to that direction.

| Attribute                   | Type   | Required | Default            | Notes                    |
| --------------------------- | ------ | -------- | ------------------ | ------------------------ |
| `id`                        | string | yes      | -                  |                          |
| `a`, `b`                    | id     | yes      | -                  | Must reference nodes.    |
| `thickness`                 | number | yes      | -                  | Meters.                  |
| `height`                    | number | no       | floor `wallHeight` | Meters.                  |
| `finishLeft`, `finishRight` | string | no       | omitted            | Finish id for each side. |

### `<opening>`

A door, window or plain opening cut into a wall.

| Attribute | Type    | Required | Default        | Notes                                                                                |
| --------- | ------- | -------- | -------------- | ------------------------------------------------------------------------------------ |
| `id`      | string  | yes      | -              |                                                                                      |
| `wall`    | id      | yes      | -              | Must reference a wall.                                                               |
| `preset`  | string  | yes      | -              | Preset id: the host's, or a built-in one (`OPENING_PRESETS`).                        |
| `offset`  | number  | yes      | -              | Distance of the opening's **center** from node `a`, along the wall.                  |
| `width`   | number  | yes      | -              | Meters, above 0 (otherwise a parse error).                                           |
| `height`  | number  | yes      | -              | Meters.                                                                              |
| `sill`    | number  | no       | `0`            | Height of the bottom edge above the floor, meters.                                   |
| `type`    | string  | no       | from `sill`    | One of the types below; without it, `door-swing` at sill 0 and `window-fixed` above. |
| `hinge`   | `a`/`b` | no       | `a`            | The wall end nearer the hinge (or the jamb a single leaf starts from).               |
| `swing`   | string  | no       | `left`         | `left` or `right`: the side of the wall `a -> b` the opening opens to.               |
| `leaves`  | integer | no       | type's default | Leaf count, for the types that have one (see below).                                 |
| `split`   | number  | no       | `0.5`          | `door-double` only: share of the larger leaf, at least 0.5 and below 1.              |
| `flip`    | boolean | no       | -              | Read only, from older files: `1` means `hinge="b" swing="right"`. Never written.     |

Writers always write `type`; `hinge` and `swing` only when not `a` / `left`; `leaves` and `split`
only when set.

| Type              | Hinge                   | Swing | Leaves (default) | Split |
| ----------------- | ----------------------- | ----- | ---------------- | ----- |
| `door-swing`      | yes                     | yes   | 1                | -     |
| `door-double`     | when `split` is not 0.5 | yes   | 2                | yes   |
| `door-sliding`    | with one leaf           | yes   | 1 to 4 (2)       | -     |
| `door-folding`    | yes                     | yes   | 2 to 8 (4)       | -     |
| `door-rolling`    | -                       | yes   | 1                | -     |
| `opening`         | -                       | -     | 0                | -     |
| `window-casement` | with one leaf           | yes   | 1 to 4 (2)       | -     |
| `window-sliding`  | -                       | -     | 2 to 4 (2)       | -     |
| `window-awning`   | -                       | yes   | 1 to 4 (1)       | -     |
| `window-fixed`    | -                       | -     | 1 to 6 (1)       | -     |

A parameter a type does not use is kept and written, but changes nothing (`openingParams(o)`
lists the ones that apply), so switching the type and back loses nothing. Parse errors: an
unknown `type`, a `hinge` or `swing` other than the values above, a `leaves` outside the type's
range (or not a whole number above 0 on a type without one), a `split` outside `0.5 <= split < 1`.

### `<room>`

| Attribute     | Type      | Required | Default | Notes                                            |
| ------------- | --------- | -------- | ------- | ------------------------------------------------ |
| `id`          | string    | yes      | -       |                                                  |
| `walls`       | id list   | yes      | -       | Wall ids separated by whitespace, in loop order. |
| `name`        | string    | no       | `""`    |                                                  |
| `floorFinish` | string    | no       | omitted | Finish id.                                       |
| `holes`       | loop list | no       | omitted | Closed wall loops inside the room, see below.    |

**Wall order.** `walls` lists the room's walls as a closed loop. The stored order is
counter-clockwise (CCW), so the interior is on the left of the traversal. On load, a clockwise
list is reversed to CCW. A list that does not form a closed loop is a parse error
(`element: room`, `attribute: walls`).

**Holes.** `holes` lists closed wall loops inside the room (an atrium, a free-standing block). Wall
ids are separated by whitespace and loops by `;`, for example `holes="w5 w6 w7 w8; w9 w10 w11"`.
Each loop is stored clockwise; on load a counter-clockwise loop is reversed. A loop that does not
close is a parse error (`element: room`, `attribute: holes`), and so is a reference to a missing
wall. The attribute is omitted when there are no holes. Whether a hole is geometrically valid is
checked by validation, not by the parser.

If a floor has **no** `<room>` elements, rooms are detected from closed wall loops
(`detectRooms`) and given fresh ids and empty names.

### `<item>`

Furniture and fixtures. Common attributes: `id` (required), `preset` (required), `variant`
(optional string) and `mount` (required: `floor`, `wall` or `ceiling`; any other value is a
parse error). Item sizes come from the preset, not the file.

Floor and ceiling items (`mount="floor"` / `"ceiling"`):

| Attribute  | Type   | Required | Default | Notes                                |
| ---------- | ------ | -------- | ------- | ------------------------------------ |
| `x`, `y`   | number | yes      | -       | Footprint center, meters.            |
| `rotation` | number | no       | `0`     | Radians CCW; `0` = front faces `+y`. |

Wall items (`mount="wall"`):

| Attribute   | Type              | Required | Default | Notes                                         |
| ----------- | ----------------- | -------- | ------- | --------------------------------------------- |
| `wall`      | id                | yes      | -       | Must reference a wall.                        |
| `side`      | `left` \| `right` | yes      | -       | Side of the wall the item is mounted on.      |
| `offset`    | number            | yes      | -       | Center distance from node `a` along the wall. |
| `elevation` | number            | no       | `0`     | Height of the item's bottom above the floor.  |

### `<column>`

A free-standing column.

| Attribute  | Type                | Required | Default           | Notes                                         |
| ---------- | ------------------- | -------- | ----------------- | --------------------------------------------- |
| `id`       | string              | yes      | -                 |                                               |
| `x`, `y`   | number              | yes      | -                 | Center, meters.                               |
| `shape`    | `round` \| `square` | yes      | -                 | Any other value is a parse error.             |
| `width`    | number              | yes      | -                 | Diameter (round) or side along local x.       |
| `depth`    | number              | no       | omitted (= width) | Square only, side along local y.              |
| `rotation` | number              | no       | `0`               | Radians CCW; square only.                     |
| `height`   | number              | no       | omitted           | Meters; omitted means the floor `wallHeight`. |

### `<stair>`

A stair that rises from this floor to the floor above. The bay (`x`, `y`, `width`, `depth`,
`rotation`) is the area the stair is laid out in; the flights, landings and treads are derived
from it and the rise to the floor above (risers of at most 0.18 m, so the count follows the
storey height). The stair's outline (the tight rectangle around its steps and landings, the
diameter square for a spiral) is cut out of the slab above.

| Attribute     | Type                                 | Required | Default   | Notes                                                |
| ------------- | ------------------------------------ | -------- | --------- | ---------------------------------------------------- |
| `id`          | string                               | yes      | -         |                                                      |
| `x`, `y`      | number                               | yes      | -         | Bay center, meters.                                  |
| `width`       | number                               | yes      | -         | Bay side along local x (> 0).                        |
| `depth`       | number                               | yes      | -         | Bay side along local y (> 0).                        |
| `rotation`    | number                               | no       | `0`       | Radians CCW.                                         |
| `type`        | `straight` \| `L` \| `U` \| `spiral` | yes      | -         | Any other value is a parse error.                    |
| `turn`        | `landing` \| `winder`                | no       | `landing` | How an L or U stair turns (spiral ignores it).       |
| `hand`        | `left` \| `right`                    | no       | `right`   | Turn direction for L / U, rotation sense for spiral. |
| `flightWidth` | number                               | no       | `0.9`     | Width of one flight, meters (> 0).                   |

Parse errors (`element: 'stair'`): a `type`, `turn` or `hand` outside the listed values; a
non-finite `x`, `y` or `rotation`; a non-positive `width`, `depth` or `flightWidth`; a
`flightWidth` greater than `width` (greater than `width / 2` for a `U` stair) by more than
1e-4 m; a spiral needs `flightWidth > 0` but ignores its value. `H3xDocument.fromProject` rejects the same stairs with `invalid-stair`.

Non-blocking warnings (reported by `validateLayout`): `stair-no-floor-above`,
`stair-does-not-fit` and `stair-overlaps-wall`; see [validation.md](validation.md).

### `<roof>`

A roof on this floor. Its underside passes through the outline (the outer wall faces) at the top of
the floor's walls plus `base`, so it bears on the wall tops. A floor can hold several roofs; they
may overlap or touch. A roof does not need walls under it.

A roof is in one of two modes:

- **Follow** (`follow="1"`, the default): the outline is the union of the rooms listed in `rooms`,
  grown to the outer wall faces. It tracks later wall edits. Edge specs are keyed by wall id in
  `wallEdges`.
- **Independent** (`follow="0"`): the outline is `points` (with optional `holes`), edited freely.
  Edge specs are given per edge in `edges` / `holeEdges`.

| Attribute       | Type                                                          | Required             | Default   | Notes                                                                                  |
| --------------- | ------------------------------------------------------------- | -------------------- | --------- | -------------------------------------------------------------------------------------- |
| `id`            | string                                                        | yes                  | -         |                                                                                        |
| `kind`          | `pitched` \| `flat`                                           | no                   | `pitched` | `flat` is a horizontal slab with an optional parapet.                                  |
| `preset`        | string                                                        | no                   | omitted   | Informational: the preset the roof was created from (see below).                       |
| `follow`        | `1` \| `0` \| `true` \| `false`                               | no                   | `1`       | `1` / `true` follows the walls; `0` / `false` selects independent mode.                |
| `rooms`         | id list                                                       | follow               | empty     | Room ids separated by whitespace. A room that no longer exists is dropped.             |
| `wallEdges`     | list of `wallId:spec`                                         | no                   | omitted   | Follow only. Walls not listed use `pitch`.                                             |
| `points`        | point list                                                    | independent          | -         | At least 3 `x,y` pairs, CCW, at the outer wall faces.                                  |
| `holes`         | point lists separated by `;`                                  | no                   | omitted   | Independent only. Each hole has at least 3 points (CW).                                |
| `edges`         | spec list                                                     | independent, pitched | -         | One spec per outline edge (edge `i` runs `points[i]` to `points[i+1]`).                |
| `holeEdges`     | spec lists separated by `;`                                   | no                   | omitted   | One list per hole, one spec per hole edge. Missing: slope at `pitch`.                  |
| `pitch`         | number                                                        | no                   | `30`      | Default slope, degrees, in (0, 90).                                                    |
| `breakHeight`   | number                                                        | no                   | omitted   | Two-pitch slopes: break height above the eaves, meters (> 0). Needs `upperPitch`.      |
| `upperPitch`    | number                                                        | no                   | omitted   | Upper pitch, degrees, in (0, 90), used above `breakHeight`. Needs `breakHeight`.       |
| `base`          | number                                                        | no                   | `0`       | Meters above floor elevation + `wallHeight`. May be negative.                          |
| `overhang`      | number                                                        | no                   | `0.5`     | Eaves overhang, meters, horizontal (>= 0).                                             |
| `gableOverhang` | number                                                        | no                   | `0.3`     | Rake overhang at gable edges, meters (>= 0).                                           |
| `thickness`     | number                                                        | no                   | `0.1`     | Meters (> 0).                                                                          |
| `material`      | `tile` \| `metal` \| `concrete` \| `glass` \| `polycarbonate` | no                   | `tile`    | Glass and polycarbonate are translucent; frame bars in 3D, a hatch in 2D.              |
| `parapet`       | number                                                        | no                   | omitted   | Flat roofs: parapet height, meters (>= 0). Parapets are 0.1 m thick.                   |
| `supports`      | `posts`                                                       | no                   | omitted   | Adds square steel posts from the floor to the roof underside (not stored as elements). |
| `postSize`      | number                                                        | no                   | `0.1`     | Post section side, meters (> 0).                                                       |
| `postSpacing`   | number                                                        | no                   | `3`       | Maximum post spacing along open edges, meters (> 0).                                   |

**Edge spec grammar.** One of:

- `gable`: the edge does not slope; the roof ends in a vertical triangle above it (a wall on that
  edge is raised to the roof underside).
- `slope:<pitch>`: a slope of `pitch` degrees (0 < pitch < 90).
- `slope:<pitch>/<breakHeight>/<upperPitch>`: a two-pitch slope, `pitch` up to `breakHeight`
  meters above the eaves and `upperPitch` above that.

Specs are separated by whitespace (and by `;` between holes). In `wallEdges` each entry is
`wallId:spec`, for example `wallEdges="w3:gable w5:slope:45"`; the override applies to every
outline edge that comes from that wall. Overrides for walls that no longer exist are dropped.

**Presets.** The presets (`ROOF_PRESETS`) give initial values only; every value stays editable per
roof and per edge, and `preset` just records where a roof started.

| Preset        | Shape | Pitch       | Overhang | Thickness | Material      | Extra              |
| ------------- | ----- | ----------- | -------- | --------- | ------------- | ------------------ |
| `thai`        | hip   | 35          | 0.8      | 0.10      | tile          |                    |
| `japanese`    | hip   | 22          | 0.9      | 0.10      | tile          |                    |
| `metal`       | shed  | 12          | 0.4      | 0.05      | metal         |                    |
| `traditional` | gable | 30          | 1.2      | 0.12      | tile          |                    |
| `gable`       | gable | 30          | 0.5      | 0.10      | tile          |                    |
| `hip`         | hip   | 30          | 0.5      | 0.10      | tile          |                    |
| `shed`        | shed  | 30          | 0.5      | 0.10      | tile          |                    |
| `mansard`     | hip   | 70, then 30 | 0.3      | 0.10      | tile          | break at 1.5 m     |
| `gambrel`     | gable | 60, then 30 | 0.3      | 0.10      | tile          | break at 1.5 m     |
| `flat`        | flat  | -           | 0        | 0.12      | concrete      | parapet 1.1 m      |
| `glass-frame` | shed  | 10          | 0.2      | 0.02      | glass         | `supports="posts"` |
| `poly-frame`  | shed  | 10          | 0.2      | 0.02      | polycarbonate | `supports="posts"` |

The shape decides which edges slope: `hip` slopes every edge; `shed` slopes the edges of the
longest side and makes the rest gables; `gable` slopes the longest side and every side whose
direction is within 30 degrees of it, and makes the others gables.

Defaults are omitted on save. A follow roof stores only the walls whose spec is set in
`wallEdges`; an independent roof always stores `edges` when pitched.

Parse errors (`element: 'roof'`): a `kind`, `material` or `supports` outside the listed values; a
`follow` other than `0`, `1`, `true` or `false`; a `pitch` / `upperPitch` outside (0, 90) or a
`breakHeight` not above 0; a `breakHeight` without an `upperPitch` or the reverse (`attribute` names
the one present); a non-finite number; a negative `overhang`, `gableOverhang` or `parapet`; a
`thickness`, `postSize` or `postSpacing` not above 0; an independent roof with fewer than 3 points,
a malformed `x,y` pair, or (when pitched) an `edges` count different from the points count; a hole
with fewer than 3 points or a `holeEdges` list whose length differs from its hole; a malformed edge
spec (`attribute` names the attribute).
`H3xDocument.fromProject` rejects the same roofs with `invalid-roof`.

Non-blocking warnings (reported by `validateLayout`): `roof-invalid-outline`, `roof-no-walls` and
`roof-build-failed`; see [validation.md](validation.md).

The `Mount` type also lists `opening`; that is a preset mount used by `addOpening`, not a valid
`<item mount>`.

## Errors on read

`projectFromXML` throws:

- `H3xParseError` (`element` and `attribute` say where, when known) for: malformed XML; root not
  `<h3x>`; missing, non-integer or `< 1` `version`; `unit` other than `m`; no `<floor>`; a missing
  required attribute; a non-numeric number (empty, `NaN`, `Infinity`); a bad `side`, `mount` or
  column `shape`; a bad `<opening>` (see its section); a bad `<stair>` or `<roof>` (see their sections); a bad or missing `<site>` (fewer than 3 points, malformed point, more than one); a
  duplicate id within a floor; a duplicate floor id; a `slabThickness` not above 0; a reference to a
  missing node or wall (wall `a` / `b`, opening `wall`, room `walls` / `holes`, wall-item `wall`); a
  room whose walls or hole loops do not form a loop.
- `H3xVersionError` (`found`) when `version` is greater than the supported `FORMAT_VERSION`.

Parsing does not run geometric validation (wall length, collisions, ...). Use `validateLayout` /
`validatePlacements`; see [validation.md](validation.md). Writing throws `H3xValidationError`
with code `non-finite-number` if a number is NaN or Infinity.

## Versioning policy

`version` is a single integer. A reader accepts files with `version <= FORMAT_VERSION` and
rejects newer ones with `H3xVersionError` rather than guessing. Additive changes (new optional
attributes or elements with defaults) keep the version. A change that alters the meaning of
existing data bumps it, and the reader gains a migration from each older version.

## Complete example

A 4 x 4 m room with a door, a window, a sofa, an outlet and a ceiling lamp. Walls run CCW, so
`left` is the room interior. Preset ids are examples; sizes come from your `PresetResolver`.

```xml
<h3x version="1" unit="m">
  <meta name="Studio" created="2026-11-16T09:00:00.000Z"/>
  <floor id="f1" level="0" elevation="0" wallHeight="3">
    <node id="n1" x="0" y="0"/>
    <node id="n2" x="4" y="0"/>
    <node id="n3" x="4" y="4"/>
    <node id="n4" x="0" y="4"/>
    <wall id="w1" a="n1" b="n2" thickness="0.2" height="3"/>
    <wall id="w2" a="n2" b="n3" thickness="0.2" height="3"/>
    <wall id="w3" a="n3" b="n4" thickness="0.2" height="3"/>
    <wall id="w4" a="n4" b="n1" thickness="0.2" height="3"/>
    <opening id="d1" wall="w1" preset="door-single" offset="1" width="0.9" height="2.1" sill="0" type="door-swing"/>
    <opening id="win1" wall="w3" preset="window-2" offset="2" width="1.4" height="1.2" sill="0.9" type="window-casement" hinge="b" swing="right" leaves="2"/>
    <room id="r1" walls="w1 w2 w3 w4" name="Studio"/>
    <item id="sofa1" preset="sofa-3seat" mount="floor" x="2" y="3.2" rotation="3.1416"/>
    <item id="out1" preset="outlet" mount="wall" wall="w2" side="left" offset="2" elevation="0.3"/>
    <item id="lamp1" preset="ceiling-lamp" mount="ceiling" x="2" y="2" rotation="0"/>
  </floor>
</h3x>
```
