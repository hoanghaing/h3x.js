# Validation

Validators return `Issue { code, ids, message }[]`. `ids` lists the entities involved: first
the one at fault, then what it conflicts with. There are two kinds of checking:

- **Blocking**: run by `H3xDocument` on every command. If a change produces issues, the command
  is rejected (`execute` throws `H3xValidationError`, `tryExecute` returns `{ ok: false, issues }`,
  `preview` returns the issues) and nothing changes. Only entities touched by the change are
  checked.
- **Reported-only**: returned by the standalone checks `validateLayout(floor)` and
  `validatePlacements(floor, presets)` (and `doc.validateLayout()` / `doc.validatePlacements()`)
  over the whole floor. They never block anything.

Validators added with `doc.addValidator(fn)` run on every command and block like the built-in
ones.

## Layout edits are never blocked by furniture

Any command that touches a node (`moveNode`, `moveWall`, `setWallLength`) skips the placement
validator. An opening or item that no longer fits after such an edit does not refuse it; it is
flagged by `validatePlacements()`. In contrast, **object edits that collide are rejected**:
`addOpening`, `moveOpening`, `addItem` and `moveItem` fail if the new or moved entity breaks a
placement rule. Layout edits are still blocked by rules about the layout itself (short walls,
crossing walls, degenerate rooms).

## Tolerance contract

All contact, containment and range checks use one tolerance, `GEOM_TOL = 1e-3` m (1 mm). Things
that touch, sit flush or overlap by up to 1 mm pass. XML numbers are rounded to 4 decimals (error
at most 5e-5 m), far below `GEOM_TOL`, so a document that validates keeps validating after a save
and load round trip. Minimums use the same slack: a wall is too short only below
`MIN_WALL_LENGTH - GEOM_TOL`.

The usable range along a wall is shortened at each end by half the thickness of the thickest
other wall meeting at that end node. Openings also keep at least `OPENING_END_MARGIN` (0.1 m)
from each end, so nothing sits inside a corner.

## Issue codes

Constants: `MIN_WALL_LENGTH` = 0.3 m, `MIN_ROOM_AREA` = 1.0 m2.

### Layout

| Code                   | Meaning                                                                                                                                                                                                           | Blocking                                            | Ids                 |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ------------------- |
| `wall-too-short`       | wall shorter than `MIN_WALL_LENGTH`                                                                                                                                                                               | yes, for walls touched by the change                | the wall            |
| `walls-cross`          | two walls that do not share a node intersect                                                                                                                                                                      | yes, when one of them is touched                    | both walls          |
| `room-degenerate`      | room loop open, outline not simple or flipped, a hole open, not simple, crossing the outline or overlapping another hole (touching at nodes is fine), or net inner area (outer minus holes) below `MIN_ROOM_AREA` | yes, for rooms touched or containing a touched wall | the room            |
| `column-size`          | column width or depth not above 0 or above `MAX_COLUMN_SIZE` (2 m), or height (when set) not above 0                                                                                                              | yes, for columns touched by the change              | the column          |
| `columns-overlap`      | two columns overlap in area (touching is fine)                                                                                                                                                                    | `validateLayout` only: reported                     | both columns        |
| `column-unsupported`   | column on an upper floor with no column below whose centre is within 0.01 m (`validateLayout` only)                                                                                                               | `validateLayout` only: reported, never blocks       | the column          |
| `stair-no-floor-above` | stair on the top floor, nothing to reach (`validateLayout` only)                                                                                                                                                  | `validateLayout` only: reported, never blocks       | the stair           |
| `stair-does-not-fit`   | stair flights do not fit the bay for the current rise (e.g. after `setFloorHeight`; `validateLayout` only)                                                                                                        | `validateLayout` only: reported, never blocks       | the stair           |
| `stair-overlaps-wall`  | stair bay overlaps a wall outline by more than 1e-4 m� (touching is fine; `validateLayout` only)                                                                                                                  | `validateLayout` only: reported, never blocks       | the stair, the wall |
| `site-not-simple`      | site outline self-intersects (`validateLayout` checks `project.site`)                                                                                                                                             | `validateLayout` only: reported                     | `site`              |
| `opening-out-of-wall`  | opening outside its wall's usable range (see Placement)                                                                                                                                                           | in `validateLayout`: reported only                  | the opening         |

### Placement

Blocking for openings and items created or modified by the command, except when the same
command moved a node (then reported only, via `validatePlacements`).

| Code                     | Meaning                                                                                    | Ids           |
| ------------------------ | ------------------------------------------------------------------------------------------ | ------------- |
| `opening-out-of-wall`    | opening does not fit the wall's usable range                                               | opening, wall |
| `opening-overlap`        | two openings on one wall overlap by more than `GEOM_TOL`                                   | both openings |
| `opening-too-tall`       | `sill + height` above the wall height                                                      | opening, wall |
| `wall-item-out-of-range` | wall item outside the usable range, or elevation outside `0 .. wall height - item height`  | item, wall    |
| `wall-item-on-opening`   | wall item's rectangle covers an opening                                                    | item, opening |
| `outside-room`           | floor or ceiling item footprint not fully inside a room's inner polygon                    | item          |
| `hits-wall`              | floor item footprint overlaps a wall                                                       | item, wall    |
| `hits-item`              | floor item overlaps another floor item; presets with `layer: 'covering'` (rugs) are exempt | both items    |
| `unknown-preset`         | preset unknown to the `PresetResolver`                                                     | item          |

Ceiling items are checked only for `outside-room`.

### Command and document errors (always blocking)

| Code                      | Meaning                                                                                                                   | Ids                        |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| `invalid-number`          | the change's new state holds NaN or Infinity                                                                              | the changed entity         |
| `not-found`               | a command referenced an id that does not exist                                                                            | the missing id             |
| `duplicate-id`            | a create command was run twice (its generated id already exists), or `fromProject` got repeated floor ids                 | the id                     |
| `unknown-preset`          | preset missing, or not an opening preset for `addOpening`                                                                 | the entity id              |
| `mount-mismatch`          | `addItem` mount differs from the preset's mount                                                                           | the new item id            |
| `no-floor`                | `H3xDocument.fromProject` got a project without floors                                                                    | none                       |
| `bad-reference`           | `H3xDocument.fromProject` got a dangling node or wall reference                                                           | holding entity, missing id |
| `walls-overlap`           | `addWall` would overlap an existing wall collinearly                                                                      | new wall, existing wall    |
| `invalid-thickness`       | `addWall` thickness, or height when given, not a finite number above 0                                                    | the new wall id            |
| `split-too-short`         | a split (by `splitWall`, `addWall`, `dropNode` or a crossing) would leave a part below `MIN_WALL_LENGTH`                  | the split wall             |
| `split-cuts-opening`      | a split cuts an opening / wall item that cannot fit in the half holding its center                                        | the opening / item         |
| `merge-drops-opening`     | `removeNode`, `mergeNodes` or `dropNode` leaves a wall too short for its openings / wall items                            | the opening / item         |
| `push-pull-cuts-opening`  | `pushPullWall` leaves a slid wall too short for an opening / wall item on it                                              | the opening / item         |
| `invalid-target`          | `mergeNodes` / `dropNode` onto the node itself or one of its own walls                                                    | the node (and the wall)    |
| `site-invalid`            | `setSite` with fewer than 3 points or a non-finite coordinate                                                             | `site`                     |
| `unknown-floor`           | `setActiveFloor` or a floor command got an id that is not a floor                                                         | the floor id               |
| `floor-protected`         | `removeFloor` on the ground floor or the last remaining floor                                                             | the floor id               |
| `invalid-floor-dimension` | wall height or slab thickness not a finite number above 0 (also checked by `fromProject`), or ground elevation not finite | the floor id               |

`invalid-number` keeps the XML contract: writing a non-finite number fails, so no command may
produce one.

### Other errors

| Code                | Where                                                                                                        |
| ------------------- | ------------------------------------------------------------------------------------------------------------ |
| `room-open`         | room geometry helpers (`roomPolygon`, `roomArea`) on walls that are not a closed loop (`H3xValidationError`) |
| `non-finite-number` | `projectToXML` given NaN or Infinity (`H3xValidationError`)                                                  |

## Writing a validator

A validator is `(doc, changes) => Issue[]`. Inspect only the entities in `changes` so commands
stay cheap, return issues instead of throwing, and use `GEOM_TOL` for every comparison.
