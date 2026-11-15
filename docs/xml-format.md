# h3x XML format, version 1

An `.h3x` file is a plain XML document. Each object type has its own element, and the element's
attributes match the fields of the matching type in `src/core/types.ts`. Read it with
`projectFromXML` / `H3xDocument.fromXML` and write it with `projectToXML` / `doc.toXML`.

## Conventions

- Units are **meters**. Plan coordinates are `(x, y)`.
- Angles (`rotation`) are **radians, counter-clockwise**. `0` means the item's front faces `+y`.
- Ids are strings, unique within a floor across all element types (nodes, walls, openings, rooms,
  items). Generated ids are 10-character nanoids.
- Numbers are written with at most 4 decimals (`XML_DECIMALS`), trailing zeros dropped, `-0`
  written as `0`. On read, any finite number is accepted.
- Writers sort child elements by id within each type, in the order node, wall, opening, room,
  item. Characters XML 1.0 forbids are written as U+FFFD; `& < > "` and line breaks are escaped.
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

Children: one optional `<meta>` and one or more `<floor>`.

### `<meta>`

| Attribute | Type            | Required | Default | Notes          |
| --------- | --------------- | -------- | ------- | -------------- |
| `name`    | string          | no       | `""`    | Project name.  |
| `created` | ISO 8601 string | no       | `""`    | Not validated. |

### `<floor>`

| Attribute    | Type   | Required | Default | Notes                              |
| ------------ | ------ | -------- | ------- | ---------------------------------- |
| `id`         | string | yes      | -       |                                    |
| `level`      | number | no       | `0`     | Storey index.                      |
| `elevation`  | number | no       | `0`     | Floor height above ground, meters. |
| `wallHeight` | number | yes      | -       | Default wall height, meters.       |

Children: `node`, `wall`, `opening`, `room`, `item`, in any order. A file may hold several
floors; the editing APIs work on the first and keep the others as loaded.

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

| Attribute     | Type    | Required | Default | Notes                                            |
| ------------- | ------- | -------- | ------- | ------------------------------------------------ |
| `id`          | string  | yes      | -       |                                                  |
| `walls`       | id list | yes      | -       | Wall ids separated by whitespace, in loop order. |
| `name`        | string  | no       | `""`    |                                                  |
| `floorFinish` | string  | no       | omitted | Finish id.                                       |

**Wall order.** `walls` lists the room's walls as a closed loop. The stored order is
counter-clockwise (CCW), so the interior is on the left of the traversal. On load, a clockwise
list is reversed to CCW. A list that does not form a closed loop is a parse error
(`element: room`, `attribute: walls`).

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

The `Mount` type also lists `opening`; that is a preset mount used by `addOpening`, not a valid
`<item mount>`.

## Errors on read

`projectFromXML` throws:

- `H3xParseError` (`element` and `attribute` say where, when known) for: malformed XML; root not
  `<h3x>`; missing, non-integer or `< 1` `version`; `unit` other than `m`; no `<floor>`; a
  missing required attribute; a non-numeric number (empty, `NaN`, `Infinity`); a bad `side` or
  `mount`; a duplicate id within a floor; a reference to a missing node or wall (wall `a` / `b`,
  opening `wall`, room `walls`, wall-item `wall`); a room whose walls do not form a loop.
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
