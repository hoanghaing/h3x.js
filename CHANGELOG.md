# Changelog

## Unreleased

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
