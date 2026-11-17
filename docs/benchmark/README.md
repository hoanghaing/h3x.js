# Benchmark: h3x.js core vs. leading home-design apps (2026-11-17)

Written from the point of view of a working designer / editor who draws Vietnamese townhouses
("nhà phố") every day, to decide what the h3x.js **core** must do before h3xEditor (M9) is built.
The editor is only as good as the engine underneath it: every tool, panel and shortcut in h3xEditor
needs a method, an event and a correct geometry in h3x.js.

Competitor facts come from public pages (links at the end); where a source was thin, the row says
"typical" — meaning common to this class of software, to be verified in the app. h3x.js facts come
from the code on branch `milestone-6-stairs`.

## Who we compare against

| App                                                | Class                         | Why it matters to us                                                                                                               |
| -------------------------------------------------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Chief Architect / Home Designer Pro                | Pro residential CAD (desktop) | The bar for "smart building objects": auto roofs, cabinets, framing, construction drawings.                                        |
| ArchiCAD / Revit                                   | BIM                           | Reference for how walls, joins, levels, dimensions and views _should_ behave. Too heavy for our users, but the concepts are right. |
| Sweet Home 3D                                      | Open source desktop           | Closest in scope to h3x: walls, rooms, levels, stairs, furniture, background-image tracing.                                        |
| RoomSketcher, Floorplanner, Planner 5D             | Web / app floor planners      | What homeowners and agents expect: fast drawing, measurements, symbols, print to scale.                                            |
| Coohom / Kujiale, Homestyler                       | Web interior design (CN)      | Huge catalogs, AI layout, precise dimension editing; dominant in Asian interior market.                                            |
| AutoCAD + SketchUp (how VN contractors work today) | General CAD + modeller        | What our users actually produce: permit drawings with axis grids, dimension chains, level marks, sections.                         |

## The designer's workflow for a townhouse

1. Lot and setbacks (lộ giới, khoảng lùi), north direction, ground level (cốt ±0.000).
2. Structural axis grid (trục A, B, C… / 1, 2, 3…) and columns on the grid.
3. Walls (110 / 220 brick, partition), with the wall drawn from its axis or from a face.
4. Doors and windows, sized and placed by distance from a wall end or axis.
5. Stairs, voids (ô thông tầng, giếng trời), balconies with parapets.
6. Upper floors, terrace (sân thượng), stair housing (tum), roof.
7. Finishes (floor tiles, paint, false ceilings), furniture, sanitary ware, kitchen.
8. Basic MEP marks: outlets, switches, lights, plumbing fixtures.
9. Documentation: dimension chains (openings / axes / overall), level marks, room names and areas,
   elevations, sections, title block, print to scale (1:100, 1:50).
10. Quantities and cost estimate for the client.

h3x.js today covers steps 1–5 partially, 6 partially (no roof yet), 7 only as data (finishes) with
footprint-rectangle items, and nothing of 8–10.

## Capability matrix

Legend — **h3x now**: ✅ done · 🟡 partial · ❌ missing. **Priority** for the core before h3xEditor:
**P0** must have, **P1** should have, **P2** later. "Core" = belongs in h3x.js; "Editor" = UI only.

### A. Precision and input

| Capability                                                                         | Leaders                                          | h3x now                                    | Gap                                                                       | Priority |
| ---------------------------------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------ | ------------------------------------------------------------------------- | -------- |
| Type exact lengths while drawing / editing                                         | All (Coohom even accepts `+ − × ÷` in the input) | ✅ `segmentLengthRequest`, `setWallLength` | Expressions are editor-side; core needs angle too                         | P0       |
| Type angles / polar input                                                          | Pro CAD, typical in planners                     | ❌                                         | Add `setPendingSegmentAngle` and relative angle                           | P0       |
| Units: store m, display mm / cm / m                                                | All                                              | 🟡 meters only                             | Display units are editor; core needs a rounding / precision policy (1 mm) | P1       |
| Object snaps: endpoint, midpoint, intersection, perpendicular, extension, parallel | Pro CAD; planners have basic snap                | 🟡 node, wall, alignment, 45°, grid        | Midpoint, perpendicular, extension, face snaps                            | P0       |
| Temporary snap override, ortho lock                                                | All (Floorplanner: hold key to disable)          | 🟡 Alt disables snap                       | Shift = ortho lock                                                        | P1       |
| Measure tool (distance, area)                                                      | Floorplanner tape measure, typical               | ❌                                         | Core: measure gesture + event                                             | P1       |

### B. Selection and transforms — biggest functional gap

| Capability                                                  | Leaders                    | h3x now                                  | Gap                               | Priority |
| ----------------------------------------------------------- | -------------------------- | ---------------------------------------- | --------------------------------- | -------- |
| Multi-select (shift-click), box select (window / crossing)  | All                        | ❌ single selection                      | Selection model must become a set | **P0**   |
| Move / rotate / mirror / scale selection with numeric input | All                        | 🟡 drag one node / wall / column / stair | Transforms on any selection       | **P0**   |
| Copy, paste, duplicate, array; paste to another floor       | All                        | ❌ (only `addFloor` copy)                | Clipboard as document fragments   | **P0**   |
| Align / distribute                                          | Pro and planners (typical) | ❌                                       |                                   | P1       |
| Group, lock, hide                                           | Pro, typical               | ❌                                       |                                   | P1       |
| Mirror whole plan                                           | Floorplanner               | ❌                                       | Falls out of transforms           | P1       |

### C. Walls

| Capability                                              | Leaders                       | h3x now                | Gap                                                   | Priority |
| ------------------------------------------------------- | ----------------------------- | ---------------------- | ----------------------------------------------------- | -------- |
| Straight walls, thickness, height, joins, split / merge | All                           | ✅                     |                                                       | —        |
| Reference line: draw by axis / left face / right face   | ArchiCAD / Revit / Chief      | ❌ (always centreline) | Contractors draw from the axis grid or the outer face | **P0**   |
| Wall presets (110, 220, partition) with finishes        | All                           | 🟡 thickness per wall  | Wall types library                                    | P1       |
| Curved walls                                            | Chief, Sweet Home 3D, typical | ❌                     | Arc walls affect rooms, openings, dims                | P2       |
| Low walls / parapets / sloped wall tops                 | Pro CAD                       | ❌                     | Needed for terraces, balconies, gables (M7)           | P1       |
| Wall layers (core + finishes)                           | BIM                           | ❌                     | Needed for exact quantities later                     | P2       |
| Offset / parallel wall, walls from room outline         | Pro CAD                       | ❌                     |                                                       | P1       |

### D. Rooms and spaces

| Capability                                                               | Leaders                         | h3x now     | Gap                                      | Priority |
| ------------------------------------------------------------------------ | ------------------------------- | ----------- | ---------------------------------------- | -------- |
| Auto room detection keeping identity                                     | Sweet Home (manual), Chief auto | ✅ strong   |                                          | —        |
| Net area, perimeter; gross floor area per floor (diện tích sàn xây dựng) | All show areas                  | 🟡 net area | Gross area incl. walls, per-floor totals | **P0**   |
| Room type, ceiling height, false ceiling                                 | Pro, typical                    | ❌          |                                          | P1       |
| Voids / double-height openings not tied to stairs                        | Pro CAD                         | ❌          | Very common in townhouses                | P1       |

### E. Doors and windows

| Capability                                                                        | Leaders                                  | h3x now          | Gap                                      | Priority |
| --------------------------------------------------------------------------------- | ---------------------------------------- | ---------------- | ---------------------------------------- | -------- |
| Place on wall, auto cut, size, sill                                               | All (RoomSketcher snaps at correct size) | ✅ data + 3D cut |                                          | —        |
| Select, resize, move along wall, move to another wall, delete in 2D               | All                                      | ❌               | Planned M8                               | **P0**   |
| Types: single / double swing, sliding, folding; window casement / sliding / fixed | All                                      | 🟡 presets only  | Parametric types with correct 2D symbols | **P0**   |
| Hinge side, swing angle, opening direction                                        | RoomSketcher, all                        | 🟡 `flip`        | Hinge side + swing separately            | P0       |
| Place by distance from wall end / axis with live dims                             | Pro CAD                                  | ❌               |                                          | P0       |

### F. Structure

| Capability                                       | Leaders                                | h3x now                  | Gap                                        | Priority |
| ------------------------------------------------ | -------------------------------------- | ------------------------ | ------------------------------------------ | -------- |
| Columns                                          | Pro CAD                                | ✅                       |                                            | —        |
| Structural axis grid (trục) with labels and dims | Pro CAD / BIM; standard in VN drawings | ❌                       | Grid object, snap to grid lines, axis dims | **P0**   |
| Beams (dầm), slabs with openings                 | Pro CAD / BIM                          | 🟡 slabs, stair openings | Beams P2; free slab openings P1            | P1       |
| Foundations                                      | Pro CAD                                | ❌                       |                                            | P2       |

### G. Stairs, railings, ramps

| Capability                                         | Leaders              | h3x now            | Gap                         | Priority |
| -------------------------------------------------- | -------------------- | ------------------ | --------------------------- | -------- |
| Straight / L / U / spiral, auto risers, openings   | Chief, Sweet Home 3D | ✅ M6              |                             | —        |
| Railings / balustrades on stairs, balconies, voids | Pro CAD              | 🟡 one simple rail | Railing object along a path | P1       |
| Manual riser count, custom shapes                  | Pro CAD              | ❌                 |                             | P2       |

### H. Roof (M7)

| Capability                                               | Leaders           | h3x now    | Gap             | Priority |
| -------------------------------------------------------- | ----------------- | ---------- | --------------- | -------- |
| Auto roof from outline: flat, shed, gable, hip, overhang | Chief (benchmark) | ❌ planned |                 | **P0**   |
| Flat terrace roof with parapet, stair housing (tum)      | VN townhouse norm | ❌         | Add to M7 scope | **P0**   |
| Dormers, skylights                                       | Chief             | ❌         |                 | P2       |

### I. Objects, symbols, catalog (M8)

| Capability                                                       | Leaders                                        | h3x now                 | Gap                                            | Priority |
| ---------------------------------------------------------------- | ---------------------------------------------- | ----------------------- | ---------------------------------------------- | -------- |
| Mount rules: floor, wall-hung, ceiling, in-opening               | All                                            | 🟡 data types exist     | Placement engine + constraints                 | **P0**   |
| True-scale 2D plan symbols                                       | All                                            | ❌ footprint rectangles | Own symbol set + stretch rules                 | **P0**   |
| Rotate, mirror, resize, snap to walls / other objects, collision | All                                            | 🟡                      |                                                | P0       |
| Parametric cabinets / kitchen counters                           | Chief, Coohom                                  | ❌                      | Basic straight / L counter                     | P1       |
| Electrical and plumbing symbols                                  | RoomSketcher, Chief (outlets snap to cabinets) | ❌                      | Outlets, switches, lights, fixtures as objects | P1       |
| Huge 3D catalogs                                                 | Coohom (tens of millions of models)            | ❌                      | Out of core scope — loader + catalog API only  | —        |

### J. 2D documentation — what contractors actually deliver

| Capability                                                                   | Leaders                                 | h3x now             | Gap                                                      | Priority |
| ---------------------------------------------------------------------------- | --------------------------------------- | ------------------- | -------------------------------------------------------- | -------- |
| Live wall-length dimensions                                                  | All                                     | ✅                  |                                                          | —        |
| Dimension chains per side (openings / axes / overall)                        | Pro CAD; VN standard                    | ❌                  | Auto chains + manual dimension lines                     | **P0**   |
| Level marks (cốt), room name / area tags, text notes, north arrow, scale bar | Pro CAD, planners                       | 🟡 room name + area |                                                          | **P0**   |
| Wall hatching / poché, line weights                                          | Pro CAD                                 | ❌                  | Style tokens                                             | P1       |
| Print / export to scale (1:50, 1:100) with title block; SVG / PDF / PNG      | RoomSketcher print to scale, all export | ❌                  | Core: export plan SVG at scale; editor adds sheet layout | **P0**   |
| DXF export / import                                                          | Pro CAD                                 | ❌                  | Contractors exchange with AutoCAD                        | P1       |

### K. Views

| Capability                                                            | Leaders             | h3x now | Gap                                   | Priority |
| --------------------------------------------------------------------- | ------------------- | ------- | ------------------------------------- | -------- |
| 2D plan, 3D orbit, floor cutaway                                      | All                 | ✅      |                                       | —        |
| First-person walkthrough                                              | Sweet Home 3D, most | ❌      | Camera mode in `h3x/three`            | P1       |
| Elevations (mặt đứng) and sections (mặt cắt) generated from the model | Pro CAD / BIM       | ❌      | Needed for permit drawings            | P1       |
| Realistic rendering                                                   | Coohom, Homestyler  | ❌      | Out of core scope (PBR materials yes) | P2       |

### L. Import, site, data

| Capability                                               | Leaders               | h3x now                     | Gap                                | Priority |
| -------------------------------------------------------- | --------------------- | --------------------------- | ---------------------------------- | -------- |
| Trace over a scanned plan / photo with scale calibration | Sweet Home 3D, Coohom | ❌                          | Underlay image + "set real length" | **P0**   |
| Lot boundary                                             | Pro                   | ✅                          | Setbacks / build-line warnings     | P1       |
| North direction, sun                                     | Pro                   | ❌                          |                                    | P2       |
| GLB / OBJ export of the 3D model                         | Most                  | ❌                          | three.js exporters                 | P1       |
| Open, versioned file format, round trip                  | Most proprietary      | ✅ XML v1, round-trip tests | Migration policy for v2            | P1       |

### M. Quantities and estimate (our differentiator in VN)

| Capability                                                                                 | Leaders                                                     | h3x now | Gap                           | Priority                |
| ------------------------------------------------------------------------------------------ | ----------------------------------------------------------- | ------- | ----------------------------- | ----------------------- |
| Areas, wall lengths, wall areas net of openings, tile / paint quantities, concrete volumes | Chief (materials list); VN estimate tools are separate apps | ❌      | Quantities API from the model | P1 (milestone after M8) |

### N. Engine quality (invisible to users, decisive for the editor)

| Area                                                                        | Status                | What "comprehensive" means                             |
| --------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------ |
| One exact outline per object kind for draw / select / hit / validate / snap | 🟡 being enforced now | Done for every kind, tested                            |
| Undo / redo across floors, coalescing                                       | ✅                    | Keep                                                   |
| Validation (blocking vs. warnings)                                          | ✅                    | Add VN-norm checks later (QCVN: room minimums, stairs) |
| Performance at 10+ floors / 2 000 objects                                   | ❓ untested           | Benchmarks and incremental rebuilds                    |
| Public API stability and docs                                               | 🟡 README             | API reference (M10)                                    |
| Event coverage for every editor input                                       | 🟡                    | Each editable property has a method and an event       |

## What h3x already does better than most

- **Realtime document:** every edit updates the XML model immediately, with per-floor undo — most
  planners keep opaque state.
- **Room identity survives topology edits** (split / merge keeps names and finishes).
- **Automatic stairs** that recompute when storey heights change, with the opening above.
- **Explicit validation** with blocking errors and non-blocking warnings, all ids reported.

## Biggest gaps, in the order a designer feels them

1. Selection and transforms (multi-select, copy / paste, rotate, mirror) — without them every
   other feature is slow to use.
2. 2D documentation: dimension chains, axis grid, level marks, print / export to scale.
3. Doors and windows as editable, parametric objects with correct symbols.
4. Wall reference line (axis / face) and precise snaps (midpoint, perpendicular, extension, angle).
5. Roof incl. flat terrace with parapet and tum.
6. Objects with mount rules and true-scale plan symbols (basic townhouse set).
7. Trace over an image with scale calibration.
8. Gross floor area and quantities.

## Proposed core roadmap (before h3xEditor)

| #   | Milestone            | Scope                                                                                                                                                                                                                                                                                   |
| --- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 6   | Stairs (finishing)   | Exact outlines for every kind; stair params by type.                                                                                                                                                                                                                                    |
| 7   | Roof                 | Flat (terrace + parapet + tum), shed, gable, hip, overhang; gable walls; low walls / parapets.                                                                                                                                                                                          |
| 8   | Objects and openings | Placement engine (floor / wall / ceiling / opening), door and window types with hinge / swing, opening edit (select, resize, move, re-host, delete), true-scale symbols, basic set: door, window, outlet, switch, light, table, chair, sofa, bed, wardrobe, kitchen counter, WC, basin. |
| 9   | Editing fundamentals | Selection sets, box select, move / rotate / mirror / copy / paste / duplicate / array, paste to floor, align, lock; snaps: midpoint, perpendicular, extension, angle input, Shift ortho; wall reference line; measure tool.                                                             |
| 10  | 2D documentation     | Axis grid; dimension chains (openings / axes / overall) and manual dimensions; level marks; text; north arrow; scale bar; hatching; export plan to SVG / PNG / PDF at scale; DXF export; image underlay with scale calibration.                                                         |
| 11  | Quantities           | Gross / net areas, wall lengths and areas net of openings, finishes quantities, concrete volumes (slabs, columns, stairs), per floor and total.                                                                                                                                         |
| 12  | Views                | First-person walk, elevations and sections from the model, GLB export.                                                                                                                                                                                                                  |
| 13  | h3xEditor            | Full UI on top of the above.                                                                                                                                                                                                                                                            |
| 14  | Packaging and docs   | UMD, Vue wrapper, API reference, hardening.                                                                                                                                                                                                                                             |

## Sources

- Chief Architect / Home Designer: [2025 new features](https://cloud-hd.chiefarchitect.com/1/pdf/product-info/2025/new-features.pdf), [2024 new features](https://cloud-hd.chiefarchitect.com/1/pdf/product-info/2024/new-features.pdf), [comparison matrix 2025](https://cloud-hd.chiefarchitect.com/1/pdf/product-info/2025/comparison-matrix.pdf), [Chief vs Home Designer Pro](https://chiefarchitect.com/blog/comparing-chief-architect-and-home-designer-pro)
- ArchiCAD wall junctions: [Graphisoft help center](https://helpcenter.graphisoft.com/knowledgebase/87136/), [How walls are connected](https://community.graphisoft.com/t5/Getting-started/How-Walls-are-Connected-in-Archicad/ta-p/303922); Revit layer priorities: [Autodesk ideas](https://forums.autodesk.com/t5/revit-ideas/more-layer-priorities-in-wall-editor/idc-p/13291229)
- Sweet Home 3D: [user's guide](https://www.sweethome3d.com/users-guide/), [multi-level guide](https://www.sweethome3d.com/multiLevelHouseGuide.pdf)
- RoomSketcher: [2D floor plans](https://www.roomsketcher.com/features/2D-floor-plans/), [blueprint maker](https://www.roomsketcher.com/floor-plans/blueprint-maker/), [features](https://www.roomsketcher.com/features/)
- Floorplanner: [editor manual](https://cdn.floorplanner.com/static/brochures/Floorplanner+editor+manual+version+050718.pdf); Planner 5D: [2D floor plan](https://planner5d.com/use/2d-floor-plan)
- Coohom: [adjust wall size (arithmetic in dimension input)](https://www.coohom.com/helpcenter/floor-plan-adjust-the-wall-size.md), [floor planner](https://www.coohom.com/floor-planner), [AI floor planner 2026](https://www.coohom.com/blog/what-can-an-ai-floor-planner-actually-do-in-2026)
- Market context: `docs/market-research/README.md`
