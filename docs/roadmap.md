# Roadmap

Each milestone must run and be demonstrable before the next starts. Scope is phase 1: a single
floor of a house.

| #   | Milestone                        | Scope                                                                                                                 | Status  |
| --- | -------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------- |
| 1   | `h3x/core`                       | Data model, XML round trip, commands with undo / redo, room detection, geometry, validation. Fully tested.            | Done    |
| 2   | 3D with one layout (`h3x/three`) | Build walls with door and window cut-outs and a floor from a sample layout file; camera and axis gizmo.               | Done    |
| 3   | 2D plan editing (`h3x/plan`)     | SVG plan: drag nodes and walls, type lengths, live dimensions; the 3D view updates with edits.                        | Done    |
| 4   | Constrained placement            | Catalog, GLB loading, drag and drop of floor / wall / opening / ceiling items with the placement rules, in 2D and 3D. | Planned |
| 5   | h3xEditor                        | Full editor UI, IndexedDB saving, import / export, i18n, 8 sample layouts, playground.                                | Planned |
| 6   | Packaging and docs               | UMD build and `mountH3xEditor`, complete `h3x/vue` wrapper, API documentation.                                        | Planned |

## Repositories and scope

- **h3x.js** (this repo) is the engine: core, and later the `three`, `plan` and `vue` subpaths.
- **h3xEditor** is a separate repository that builds the editor on top of h3x (milestones 5 and 6).
- The product website (accounts, cloud sync, sharing, a real catalog) is out of scope for these
  libraries.

Ideas for later, deliberately not blocked by the current design: drawing walls freehand,
multiple floors, stairs and roofs (the `floor` element can grow), item-on-item placement, WebGPU.
