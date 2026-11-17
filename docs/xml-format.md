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

Children: `node`, `wall`, `opening`, `room`, `item`, `column`, in any order. A file may hold
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

A door or window cut into a wall.

| Attribute | Type    | Required | Default | Notes                                                               |
| --------- | ------- | -------- | ------- | ------------------------------------------------------------------- |
| `id`      | string  | yes      | -       |                                                                     |
| `wall`    | id      | yes      | -       | Must reference a wall.                                              |
| `preset`  | string  | yes      | -       | Preset id, resolved by the host.                                    |
| `offset`  | number  | yes      | -       | Distance of the opening's **center** from node `a`, along the wall. |
| `width`   | number  | yes      | -       | Meters.                                                             |
| `height`  | number  | yes      | -       | Meters.                                                             |
| `sill`    | number  | no       | `0`     | Height of the bottom edge above the floor, meters.                  |
| `flip`    | boolean | no       | false   | Mirrors the opening; written as `1` only when true.                 |

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

The `Mount` type also lists `opening`; that is a preset mount used by `addOpening`, not a valid
`<item mount>`.

## Errors on read

`projectFromXML` throws:

- `H3xParseError` (`element` and `attribute` say where, when known) for: malformed XML; root not
  `<h3x>`; missing, non-integer or `< 1` `version`; `unit` other than `m`; no `<floor>`; a
  missing required attribute; a non-numeric number (empty, `NaN`, `Infinity`); a bad `side`,
  `mount` or column `shape`; a bad or missing `<site>` (fewer than 3 points, malformed point, more
  than one); a duplicate id within a floor; a duplicate floor id; a `slabThickness` not above 0; a reference to a missing node or wall (wall `a` / `b`,
  opening `wall`, room `walls` / `holes`, wall-item `wall`); a room whose walls or hole loops do
  not form a loop.
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
    <opening id="d1" wall="w1" preset="door-single" offset="1" width="0.9" height="2.1" sill="0"/>
    <opening id="win1" wall="w3" preset="window-2" offset="2" width="1.4" height="1.2" sill="0.9" flip="1"/>
    <room id="r1" walls="w1 w2 w3 w4" name="Studio"/>
    <item id="sofa1" preset="sofa-3seat" mount="floor" x="2" y="3.2" rotation="3.1416"/>
    <item id="out1" preset="outlet" mount="wall" wall="w2" side="left" offset="2" elevation="0.3"/>
    <item id="lamp1" preset="ceiling-lamp" mount="ceiling" x="2" y="2" rotation="0"/>
  </floor>
</h3x>
```
