# MAP2_NOTES.md: "Residential" map (4th Ave S & 11th St S), PVP only

## What was built
- `map2-world.js`: `buildMap2World` returns the same interface as `buildCampusWorld` (+ `pvpSpawnPoints`, `closures`, `playablePolygon`, `minimapRoads`). Uniform px->world scale `MAP2_M_PER_PX = 0.1975` (`MAP2_SCALE_MULT = 1.25`), origin at the intersection. Bounds ~118 x 114 m.
- `world-queries.js`: collider queries (resolveCircle, segmentBlocked, isWalkable, raycast, car hitboxes) shared by map2. Campus keeps its own copy (tech debt: the two should be merged later; not done to avoid campus regressions).
- `campus-world.js`: closure-barricade builder exposed as `window.campusKit.buildClosureBarricades` (new options `sidewalks`, `swWidthScale`, `barrier:false`); campus calls it unchanged.
- `index.html`: `currentWorld` / `isWorldMap` pointer for generic world queries (campus-only paths still use `isCampusMap`); PVP setup "Map" picker (Campus / Residential) on coop and quad setups: click, L1/R1 on any pad, `[` / `]` keys. PVE always uses campus. Fixed PVP spawn points with their own yaw; minimap draws map2 roads + footprints.
- `map2.html`: headless viewer, `#cam=px,py,eyeHeight,yawDeg,pitchDeg` in topdownview.png pixels.
- Tests: `tests/pvp-test.js` M2.* checks (picker, world switch, spawns, 4 road + 8 sidewalk closures, boundary rays, LOS, minimap, switching back).

## Notes
- **Purple signs: 8, not 5.** The annotation image shows two per orange line (one per sidewalk); the spec's "5" lists areas. 8 are placed (P1..P8 in the plan).
- Spawn S1 = the red dot (px 432,408), yaw -0.11 (facing the north-side houses).
- No world weapon pickups exist in PVP, so none were added; `pvpPickupSpots` is exported for later.
- Renders (swiftshader, not committed) compared against both reference images: layout, house colours/roofs, sidewalks, parked cars and trees line up; trees and house detail are simplified.
