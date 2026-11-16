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
  `false` if it is closed or netted out). Commands that change nothing
  add no undo step and emit no event.
- `doc.on('change', fn)` receives `{ reason, changes }` (`reason`: `'execute' | 'undo' | 'redo' | 'load' | 'cancel'`). `EntityChange` is a discriminated union
  on `kind` (`'node' | 'wall' | 'opening' | 'room' | 'item'`), so `before` / `after` narrow to
  the entity type (`null` = absent).
- `doc.addValidator(fn)`, `doc.validateLayout()`, `doc.validatePlacements()`.
- A file may hold several `<floor>` elements. Phase-1 editing APIs work on `floors[0]`; the
  other floors are kept untouched and saved as loaded.

Item and opening sizes come from a `PresetResolver` (`(presetId) => PresetInfo | undefined`)
passed as `presets`.

### Commands

- Layout: `moveNode(nodeId, to)`, `moveWall(wallId, delta)` (projected on the wall normal),
  `setWallLength(wallId, length, { anchor? })` (`anchor: 'a'` default keeps node `a` fixed, `'b'` keeps node `b`).
  Openings and wall items on resized
  walls are re-fitted into range. Topology (adding / removing nodes and walls) is fixed in this
  release.
- Openings: `addOpening({ wall, preset, offset, flip?, sill? })`,
  `moveOpening(id, { offset?, sill?, flip? })`, `removeOpening(id)`.
- Items: `addItem(newItem)` (floor, wall or ceiling mount), `moveItem(id, patch)`,
  `removeItem(id)`. `addOpening` / `addItem` expose `createdId`.
- Finishes and names: `setWallFinish(wallId, side, finish)`, `setRoomFinish(roomId, finish)`,
  `renameRoom(roomId, name)`.

### Validation and issue codes

Validators return `Issue { code, ids, message }`. Layout edits are never blocked by furniture:
issues on items or openings that a layout change causes are flagged by `validatePlacements()`
instead. Only entities touched by a change can block it.

| Code                               | Meaning                                                                                     |
| ---------------------------------- | ------------------------------------------------------------------------------------------- |
| `wall-too-short`                   | wall shorter than `MIN_WALL_LENGTH` (0.3 m)                                                 |
| `walls-cross`                      | two walls that do not share a node intersect                                                |
| `room-degenerate`                  | room outline not simple, flipped, or inner area below `MIN_ROOM_AREA`                       |
| `opening-out-of-wall`              | opening does not fit in its wall's usable range                                             |
| `opening-overlap`                  | two openings on one wall overlap                                                            |
| `opening-too-tall`                 | sill + height above the wall height                                                         |
| `wall-item-out-of-range`           | wall item outside its wall's usable range or height                                         |
| `wall-item-on-opening`             | wall item covers an opening                                                                 |
| `outside-room`                     | floor / ceiling item not fully inside a room                                                |
| `hits-wall`                        | floor item overlaps a wall                                                                  |
| `hits-item`                        | floor item overlaps another floor item (`layer: 'covering'` presets, like rugs, are exempt) |
| `invalid-number`                   | a command produced NaN or Infinity                                                          |
| `unknown-preset`, `mount-mismatch` | preset missing or wrong mount for the command                                               |
| `not-found`                        | referenced id does not exist                                                                |
| `duplicate-id`                     | a create command was run twice                                                              |
| `no-floor`, `bad-reference`        | invalid project passed to `fromProject`                                                     |
| `room-open`                        | room walls do not form a closed loop (from room geometry helpers)                           |
| `non-finite-number`                | `projectToXML` was given a non-finite number                                                |

The usable range along a wall is shortened at each end by half the thickness of the thickest
other wall meeting there (and, for openings, at least `OPENING_END_MARGIN`), so nothing sits
inside a corner. Standalone checks: `validateLayout(floor)`,
`validatePlacements(floor, presets)`, `checkOpening(floor, opening)`,
`checkItem(floor, item, presets)`.

### Rooms

`detectRooms(floor)` finds closed wall loops (used when a file has no `<room>` elements);
`roomPolygon(floor, room, 'center' | 'inner')` and `roomArea(floor, room, kind)` give room
outlines and areas. Rooms are stored in counter-clockwise wall order.

### XML

`projectFromXML(xml)` and `projectToXML(project, { pretty? })` convert between XML and plain
`Project` data. Parse problems throw `H3xParseError` (with `element` / `attribute`), newer
format versions throw `H3xVersionError`. A file without a `<floor>` is rejected. Numbers are
written with at most 4 decimals (`XML_DECIMALS`); characters XML 1.0 forbids are written as
U+FFFD.

### Geometry helpers

`obbCorners(obb)` and `wallOBB(a, b, thickness)` work with oriented boxes (`OBB`).
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
- **Picking.** Meshes carry `userData = { h3xKind: 'wall' | 'room' | 'join', h3xId }`. A `join`
  mesh closes the top of a T or X junction (or the slot of a very acute corner); its `h3xId` is
  the node id. Mesh objects keep their identity across document changes: only their geometry
  and materials are swapped, so references from `getWallMesh` / `getFloorMesh` stay valid.
- **Extra objects.** `scene.root` is the extension point: children you add to it (helpers,
  furniture, markers) survive rebuilds. h3x only manages its own `h3x-walls`, `h3x-floors` and
  `h3x-joins` groups.
- **Ownership.** One `H3xScene` attaches to one `H3xViewer` (the viewer adds `scene.root` to its
  own three.js scene). `scene.dispose()` disposes the materials it created, but a
  `MaterialLibrary` you pass in through `materials` stays yours to dispose. `dispose()` can be
  called more than once.

Try it with the example page, a 4 x 16 m tube house (`examples/layouts/nha-ong-4x16.h3x`):

```sh
pnpm dev   # http://localhost:5173
```

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
