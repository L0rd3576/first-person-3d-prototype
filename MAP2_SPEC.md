# Map 2 spec: "4th Ave S & 11th St S" (PVP-only map)

Reference images (ground truth) in `5 nights at kise/making the second map/`:
- `topdownview.png` : aerial of the intersection. Use for layout.
- `topdownview - annotations.png` : same view with annotations (see below).
- `streetview1.png` : ground-level look at the north side of 4th Ave S (houses, lawns, sidewalk, curb, trees).

## Requirements
1. New map, PVP only. In the PVP setup screen (coop-setup / quad-setup with `.pvp-setup`) add a **Map** option letting the player pick between "Campus" and the new map (mouse AND controller navigable, fits existing setup-screen style, shown only for PVP). Value feeds `selectedMapId` (existing; see `isCampusMap`, `ensureCampusWorld`, `setMap` test hook). PVE must always use campus and be unchanged.
2. The new map is MUCH smaller than campus: roughly the area visible in the topdown image (the 11th St S / 4th Ave S intersection plus one block of houses each side), enclosed by a sensible invisible/visible boundary (e.g. fences, tree lines, hedges) so players cannot leave.
3. Scale: slightly larger than campus. Define named const `MAP2_SCALE_MULT` (default 1.25) widening streets/sidewalks relative to campus widths (lane widths, sidewalks). Houses scale sensibly too.
4. Build from the topdown view: 11th St S runs north-south on the left; 4th Ave S runs east-west across the lower part; sidewalks, boulevard grass strips, crosswalk at the intersection, bus-stop sign on the west side of 11th St (icon at left-center), houses with house numbers in top-right block (320, 1104, 1108, 1114, 1118) and bottom (1101, 1105, 1115), 311 and 321 on west side, parked cars, deciduous trees (use existing tree-models.js), driveways, lawns, shared sidewalk lines. Houses: mostly small gabled houses with siding (cream / white / grey), brown/grey shingle roofs, porches/steps, a chimney on some, per streetview1.png. Solid collision on houses (boxes), trees (cylinders), cars. Houses may be hollow-optional; default: solid boxes with believable roofs, no interiors.
5. Construction closures from the ANNOTATIONS image, using EXISTING assets (find them in campus-world.js: the "street closed" / "road closed" construction sign and the "sidewalk closed" sign; reuse their builders, do not recreate):
   - ORANGE lines = street-closed construction signs (barricade across the roadway/street): north end of 11th St (short line across the street at top, near 320), west end of 4th Ave S (vertical line left of the intersection), south end of 11th St (bottom), east end of 4th Ave S (vertical line at right edge). They close the four road exits so the map is sealed.
   - PURPLE lines = sidewalk-closed signs placed across the sidewalks next to those orange lines (small purple ticks at the sidewalk positions at top-left, left, bottom-left, bottom of 11th, right edge).
   Place each sign along its line's position and orientation, mapped from image pixels (image ~640x590) to world coordinates.
6. Red dot at about px (432,408) on 4th Ave S, blue lines show a field of view facing north-northwest/north-east toward the houses on the north side: this is where streetview1.png was taken. Use this as a PVP spawn point region (and the look direction as its yaw). Provide additional spawn points spread around the map for up to 4 players, well separated, none inside solids.
7. Pickups/loot/ammo/weapons: PVP already handles these for campus; make the new map use the same PVP mechanics (spawns, zone/minimap, weapon pickups if any) with positions suited to the new layout. Minimap must draw the new map's footprints.
8. Keep the new map in its own file `map2-world.js` exposing the same interface that index.html uses from `campusWorld` (bounds, spawn, groundHeightAt, supportHeightAt, resolveCircle, segmentBlocked, raycast, isWalkable, minimapFootprints, updateVisibility, mapToWorld, environment, wetSurfaces, vehicleBlocksShot, etc.), reusing campus-world.js helpers where possible. Prefer reusing campus's interface by generalising `isCampusMap` branches into a `currentWorld` pointer instead of duplicating code paths.
9. Performance: instanced props, simple colliders, same LOD culling approach.

## Defaults chosen (no clarification asked)
- Name shown in picker: "Residential" (subtitle: "4th Ave S").
- Time of day/weather: same system as campus.
- No cars driveable unless campus vehicles already are; parked cars are static colliders.

## Deliverables / rules
- All new behaviour gated by the map choice; campus and PVE unchanged.
- Headless smoke test (`HASH='#pvptest' GL_MODE=swiftshader node tests/run-perf.js`, tests/pvp-test.js: add assertions that map 2 loads, spawns are walkable, signs exist at the 4 orange + 5 purple spots, boundary holds), JS syntax check, `node scripts/sync-frontend.js`, MAP2_NOTES.md, local commit, no push, no game launch.
- Render top-down and a street-level view from the red dot to PNGs (swiftshader) and compare to the reference images; iterate until they resemble each other.
