# Roadmap

Each milestone must run and be demonstrable before the next starts. Milestones 1–3 covered a
single floor with a fixed layout; from milestone 4 the engine grows to draw structure from scratch
and to handle a whole house: several floors, stairs and a roof. Placement rules depend on walls,
rooms, floors and slab openings, so they come after the structure.

| #   | Milestone                        | Scope                                                                                                                                                                                                                                                | Status      |
| --- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| 1   | `h3x/core`                       | Data model, XML round trip, commands with undo / redo, room detection, geometry, validation. Fully tested.                                                                                                                                           | Done        |
| 2   | 3D with one layout (`h3x/three`) | Build walls with door and window cut-outs and a floor from a sample layout file; camera and axis gizmo.                                                                                                                                              | Done        |
| 3   | 2D plan editing (`h3x/plan`)     | SVG plan: drag nodes and walls, type lengths, live dimensions; the 3D view updates with edits.                                                                                                                                                       | Done        |
| 4   | Structure drawing                | Lot / site boundary, draw and delete walls, split a wall at a T-junction, merge nodes, automatic room detection that keeps room identity (names, finishes), openings re-assigned on split.                                                           | Done        |
| 5   | Multi-floor                      | Active floor, add / remove floors, basement, slabs with thickness, 3D view modes (active floor / active + below with cutaway / whole house), floor below shown faded in 2D.                                                                          | Done        |
| 6   | Stairs                           | Straight, L, U and spiral stairs; automatic riser / tread (2h + b ≈ 60–64 cm); links two floors and cuts the slab opening; 2D drawing conventions and 3D geometry.                                                                                   | Done        |
| 7   | Roof                             | Irregular lots (miter-limited slabs and joins, wall drawing snaps to the site); roofs of any outline with per-edge slope or gable, broken slopes, overhangs, light roofs on posts, flat roofs with parapets; low walls; 2D roof drawing and editing. | Done        |
| 8   | Objects and openings             | Catalog, GLB loading, constrained drag and drop of floor / wall / opening / ceiling items on any floor, in 2D and 3D.                                                                                                                                | In progress |
| 9   | Editing fundamentals             | Move, copy, rotate, mirror, array and similar editing operations across plan and 3D.                                                                                                                                                                 | Planned     |
| 10  | 2D documentation                 | Dimensions, annotations, sections and printable sheets from the model.                                                                                                                                                                               | Planned     |
| 11  | Quantities                       | Areas, lengths and material take-offs (walls, wall faces, slabs, rooms, openings, roof faces) and a cost estimate from unit prices.                                                                                                                  | Done        |
| 12  | Views                            | Saved views and view modes beyond the floor picker.                                                                                                                                                                                                  | Planned     |
| 13  | h3xEditor                        | Full editor UI including floor picker and view-mode switch, IndexedDB saving, import / export, i18n, sample layouts, playground.                                                                                                                     | Planned     |
| 14  | Packaging and docs               | UMD build and `mountH3xEditor`, complete `h3x/vue` wrapper, API documentation.                                                                                                                                                                       | Planned     |

## Repositories and scope

- **h3x.js** (this repo) is the engine: core, and later the `three`, `plan` and `vue` subpaths.
- **h3xEditor** is a separate repository that builds the editor on top of h3x (milestones 13 and 14).
- The product website (accounts, cloud sync, sharing, a real catalog) is out of scope for these
  libraries.

Ideas for later, deliberately not blocked by the current design: item-on-item placement, WebGPU.
