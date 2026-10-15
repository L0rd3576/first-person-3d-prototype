# MAP2_PLAN.md: "Residential" map (4th Ave S & 11th St S), PVP only

Implements MAP2_SPEC.md. Implement in the phase order below, and lint/test after each phase.
If anything here contradicts the code (line numbers drift), the code wins. Fix the plan and
note the change in MAP2_NOTES.md. If a step fails twice, stop and escalate (CLAUDE.md rule).

Reference images: `5 nights at kise/making the second map/`. `topdownview.png` and the
annotated copy are 640 x 590 px. All "px" coordinates below use that image (x right, y down).
I measured the coordinates by eye from the images, so they are accurate to about ±4 px (±0.8 m).
Phase 0 refines the annotation positions with a script.

---------------------------------------------------------------------------------------------

## 1. Pixel-to-world mapping

Convention matches campus-world.js `mapToWorld`: 1 unit = 1 m, +x = east (image right),
+z = south (image down), ground y = 0. Yaw follows index.html: `yaw = atan2(-dx, -dz)` for a
facing direction (dx, dz), so yaw 0 faces north (-z) and yaw -PI/2 faces east.

```js
const MAP2_SCALE_MULT = 1.25;                    // spec: streets/sidewalks 1.25x campus widths
const CAMPUS_ROAD_M = 17 * 0.66;                 // campus ROAD_WIDTH_PX * MAP_SCALE = 11.22 m curb to curb
const MAP2_ROAD_PX = 71;                         // 11th St S curb to curb in topdownview.png (x 142..213)
const MAP2_M_PER_PX = CAMPUS_ROAD_M * MAP2_SCALE_MULT / MAP2_ROAD_PX;   // = 0.1975 m/px
const MAP2_ORIGIN_PX = { x: 177.5, y: 411 };     // centre of the 11th St / 4th Ave intersection
function mapToWorld(px, py) {
  return { x: (px - MAP2_ORIGIN_PX.x) * MAP2_M_PER_PX, z: (py - MAP2_ORIGIN_PX.y) * MAP2_M_PER_PX };
}
```

The whole map uses one uniform scale, so houses, lots and trees also come out 1.25x their real
size, which satisfies "houses scale sensibly too". Check: a 16 px sidewalk is 3.16 m, against
campus 2.64 m x 1.25 = 3.30 m. Human-sized details (doors 2.1 m, steps 0.17 m, cars) are
**not** scaled.

Bounds rect (px `[36, 8, 634, 584]`): minX -27.95, maxX 90.16, minZ -79.59, maxZ 34.17.
That is about 118 x 114 m. Campus is about 1257 x 462 m.

---------------------------------------------------------------------------------------------

## 2. Layout (px rects are `[x1, y1, x2, y2]`)

### 2.1 Ground layers (flat, `groundHeightAt` returns 0 everywhere)
| Layer | px | Notes |
|---|---|---|
| 11th St S asphalt | `[142, -300, 213, 890]` | extends past the image for backdrop (fog hides the ends) |
| 4th Ave S asphalt | `[-300, 372, 940, 450]` | 78 px = 15.4 m (measured; wider than 11th) |
| 11th W sidewalk | `[112, -300, 128, 890]` minus road | concrete, 16 px |
| 11th E sidewalk | `[232, -300, 248, 890]` minus road | |
| 4th N sidewalk | `[-300, 330, 940, 346]` minus road | |
| 4th S sidewalk | `[-300, 482, 940, 498]` minus road | |
| Boulevards (grass) | 11th W `x128..142`, 11th E `x213..232`, 4th N `y346..372`, 4th S `y450..482` | grass, trees live here |
| Curbs | road edges | cosmetic 0.12 m lip, no collider (keeps movement simple) |
| Crosswalk (zebra) | west leg: 8 bars, each `x110..128` x 4 px, y from 377 to 445 every 9 px | white paint |
| Stop bar | east leg `x 255..258, y 372..411` | white paint |
| Driveways (concrete) | `[245,125,300,160]` (320/1104 off 11th), `[540,280,556,372]` (1114/1118), `[420,498,445,590]`, `[528,450,555,590]`, plus boulevard aprons where each meets the road | |
| West parking pad (asphalt) | `[55,128,105,195]` | 3 parked cars |
| Front walks (concrete) | `[325,272,333,338]` (1104), polyline (400,278)->(405,310)->(415,338) w 7 px (1108, curved), `[493,275,500,338]` (1114), `[85,240,112,247]` (321) | |
| Base grass | everything else, plane 300 m around the origin | lawns |

`groundMaterialAt(x, z, feetY)` / `surfaceAt` return the same strings campus returns
(grep campus `groundMaterialAt` for the exact set, e.g. "asphalt" / "concrete" / "grass"),
and do the lookups against the px rects above.

### 2.2 Playable polygon (the real seal)
These are invisible `BARRIER_HEIGHT` (200 m) walls, built the same way as campus `addWall`.
Clockwise:

| Pt | px | world (x, z) |
|---|---|---|
| A | (36, 98) | (-27.95, -61.82) |
| B | (302, 98) | (24.59, -61.82) |
| C | (302, 8) | (24.59, -79.59) |
| D | (634, 8) | (90.16, -79.59) |
| E | (634, 584) | (90.16, 34.17) |
| F | (250, 584) | (14.32, 34.17) |
| G | (250, 535) | (14.32, 24.49) |
| H | (36, 535) | (-27.95, 24.49) |

Edge A-B lies on the north barricade line and G-H on the south one. B-C follows 320's west wall.
The west and east barricades sit about 3 m inside edges H-A and D-E, which leaves small
unreachable road pockets. Everything outside the polygon (311, the church, the 11th St stub
north of the barricade, 320's driveway) is **backdrop**: rendered, but needs no colliders.
`insidePlayableEdge(x, z, margin)` = point in polygon AND distance to every edge >= margin.

Visible boundary dressing (cosmetic meshes on the polygon line; the invisible wall does the
blocking):
- A-B: wood privacy fence x 36..105, hedge x 128..142 and 213..232, wood fence x 248..302
  (gaps at the sidewalks and road are filled by the signs and barricades).
- B-C: 320's wall; fence y 8..15.
- C-D: 1.8 m wood privacy fence + the existing back-yard trees.
- D-E: wood fence (1118 straddles it; that's fine).
- E-F: wood fence in the side-yard and driveway gaps between the south houses
  (x 338..355, 415..462, 528..565, 620..634).
- F-G: wood fence.
- G-H: wood fence x 36..108, hedge 128..142 and 213..232, fence 248..250.
- H-A: wood fence y 98..330 and 498..535, hedge 346..372 and 450..482.

### 2.3 Construction closures (from the annotations)
**ORANGE = ROAD CLOSED barricade rows** (reuse the campus builder, see section 4.2). In campus
list format `[px, py, axis, widthPx, options]`: axis "x" means the row runs east-west.

| Id | Where | px centre | axis | widthPx | world centre | length |
|---|---|---|---|---|---|---|
| O1 | north end of 11th St (near 320) | (177.5, 98) | x | 71 | (0.00, -61.82) | 14.0 m |
| O2 | west end of 4th Ave | (50, 411) | z | 78 | (-25.18, 0.00) | 15.4 m |
| O3 | south end of 11th St | (177.5, 535) | x | 71 | (0.00, 24.49) | 14.0 m |
| O4 | east end of 4th Ave | (619, 411) | z | 78 | (87.20, 0.00) | 15.4 m |

The sign and sandbag face points toward the map (the builder already does this via
`mapCenter` / `options.face`).

**PURPLE = SIDEWALK CLOSED barricades.** The annotation image shows **8** purple ticks, two
per orange line. The spec text says "5 purple spots", but its list names 5 *areas*. Plan with
8 and flag it to the user. Positions are snapped to the sidewalk centrelines; the
along-road coordinate comes from the image:

| Id | Pairs with | px | world (x, z) | panel runs along |
|---|---|---|---|---|
| P1 | O1, west sidewalk | (120, 98) | (-11.36, -61.82) | x |
| P2 | O1, east sidewalk | (240, 96) | (12.34, -62.21) | x |
| P3 | O2, north sidewalk | (54, 338) | (-24.39, -14.42) | z |
| P4 | O2, south sidewalk | (52, 490) | (-24.79, 15.60) | z |
| P5 | O3, west sidewalk | (118, 533) | (-11.75, 24.10) | x |
| P6 | O3, east sidewalk | (238, 528) | (11.95, 23.11) | x |
| P7 | O4, north sidewalk | (604, 338) | (84.23, -14.42) | z |
| P8 | O4, south sidewalk | (608, 490) | (85.02, 15.60) | z |

The campus builder puts sidewalk signs at a fixed offset (`widthPx/2 + SIDEWALK_WIDTH_PX/2`).
Map2's boulevards make that offset wrong, so the builder gets an explicit
`options.sidewalks: [[px,py],[px,py]]` override (section 4.2). Scale the panel width by
`MAP2_SCALE_MULT` (2.0 m to 2.5 m) so it spans the 3.2 m sidewalk better
(`options.swWidthScale`).

### 2.4 Houses (solid box collider each, believable roof, no interiors)
Style follows streetview1.png: siding walls, a 0.5 m dark foundation band, windows with
trim (black shutters on 1114), a door, steps or a small porch with railings. Roof pitch is about
35 degrees, with a 0.3 m overhang. Heights: 1 storey has 3.2 m walls; 1.5 or 2 storeys have
5.8 m walls. Ridge height = walls + roof. Collider height = ridge height.

| House | px rect | storeys | roof form (ridge) | siding | roof | front (porch) | extras |
|---|---|---|---|---|---|---|---|
| 1104 | `[300,188,363,272]` + rear wing `[298,150,345,188]` (1 st, dark roof) | 1.5 | front-gable (ridge N-S) | cream `#e6dcc0` | grey `#6f747a` | S: wood deck + 4 steps, railings | streetview left house |
| 1108 | `[383,210,450,275]` | 1 | side-gable (ridge E-W) | pale yellow `#e3d6a8` | grey-brown `#8a7c6c` | S: stoop + railings, centred door | streetview centre |
| 1114 | `[466,210,540,272]` | 1 | side-gable + small front cross-gable | white `#f1f1ee` | brown `#7a5a48` | S: stoop + railings | brick chimney, black shutters |
| 1118 | `[595,195,640,268]` + rear `[570,175,630,195]` | 2 | front-gable | white `#ecebe6` | grey `#7d8186` | S: porch | crosses edge D-E (ok) |
| 320 | `[302,15,372,97]` | 1.5 | hip | white | grey `#8a8f96` | W (faces 11th) | wall on edge B-C |
| 321 | `[38,205,85,262]` | 1 | side-gable (ridge N-S) | white | blue-grey `#6c7886` | E (faces 11th) | |
| 1101 | `[272,522,338,590]` | 1 | side-gable | cream | grey | N | crosses edge E-F |
| 1109 (unlabelled, "11.." in image) | `[355,522,415,590]` | 1 | side-gable | grey `#b9bcbf` | dark brown `#5b4a40` | N | chimney |
| 1105 | `[462,528,528,590]` | 1.5 | front-gable | white | red `#9a3b33` | N | |
| 1115 | `[565,530,620,590]` | 1 | side-gable | light grey | grey | N | |
| garage (W) | `[40,115,62,137]` | 3.5 m | gable | white | dark | - | |
| garage (N) | `[455,5,480,35]` | 3.5 m | gable | grey | dark | - | |
| house (NE corner) | `[618,20,640,70]` | 1 | gable | grey | grey | - | crosses edge D |
| **Backdrop** 311 | `[0,15,75,75]` | 1.5 | front-gable | tan | dark red-brown | - | outside, no collider needed |
| **Backdrop** church | `[0,512,50,590]` + 30 px west of the image | 2 | gable | brick `#8c5a44` | brown | - | outside |

House number plates (canvas text, small, by the door) show the number from this table.

### 2.5 Parked cars (static; `createParkedVehicleSystem`, occupancy 1)
Campus heading convention: yaw 0 = +x east, PI/2 = +z south. Park on the right-hand side of
the road.

| Car | px | world (x, z) | heading | note |
|---|---|---|---|---|
| C1 | (440, 383) | (51.84, -5.53) | PI (W) | silver wagon from the streetview, in front of the red-dot spawn |
| C2 | (585, 383) | (80.48, -5.53) | PI | white; moved west of O4 |
| C3 | (82, 137) | (-18.86, -54.12) | PI | west pad |
| C4 | (80, 157) | (-19.26, -50.17) | PI | west pad |
| C5 | (72, 180) | (-20.84, -45.62) | PI | west pad |
| C6 | (272, 143) | (18.66, -52.93) | 0 | yellow, 320/1104 drive |
| C7 | (548, 298) | (73.17, -22.32) | -PI/2 (N) | dark sedan, 1114 drive |
| C8 | (548, 322) | (73.17, -17.58) | -PI/2 | second sedan from the streetview |
| C9 | (540, 560) | (71.59, 29.43) | PI/2 (S) | 1105 drive |
| C10 | (151, 250) | (-5.23, -31.80) | PI/2 | 11th St west curb, north of the bus stop (keep the bus-stop curb clear) |

If the vehicle module's `spaces` record needs more fields, copy one of the campus
`parkingSpaces.push({...})` records (campus-world.js about line 6066) and set
`occupancy: 1, noBackIn: true`.

### 2.6 Trees (tree-models.js `createTreeSystem` + `addTrees`)
Records take the campus shape: `{ x, z, evergreen:false, trunkHeight, canopyRadius, canopyHeight, shade }`.
Use `canopyRadius = rPx * MAP2_M_PER_PX`, `trunkHeight` 2.5..3.5, `canopyHeight` about
`canopyRadius * 1.1`, and shade 0.9..1.1. Flowering trees get shade 1.25 and stay broadleaf.
Each tree gets a trunk collider: cylinder r 0.35 m, h 6, `isTree: true`.

| px (x, y) | r px | | px (x, y) | r px |
|---|---|---|---|---|
| (222, 285) | 48 (big tree, 11th E boulevard) | | (455, 192) | 45 |
| (470, 100) | 45 | | (365, 145) | 32 |
| (530, 30) | 40 | | (600, 30) | 35 |
| (603, 118) | 35 | | (405, 70) | 30 |
| (68, 292) | 28 | | (72, 352) | 30 (white flowering, NW corner) |
| (262, 103) | 24 | | (552, 205) | 22 |
| (572, 272) | 20 | | (630, 300) | 22 |
| (310, 462) | 28 (white flowering, S boulevard) | | (255, 508) | 30 |
| (597, 462) | 25 | | (630, 522) | 20 |
| backdrop (18, 112), (15, 280), (182, 80) | 30, 25, 22 | | | |

### 2.7 Small props
- **Bus stop sign**: pole at px (131, 310), world (-9.18, -19.95), on the 11th W boulevard
  edge, facing the road (east). It is a canvas texture with "BUS STOP" and a bus pictogram on
  a blue/white plate, 2.4 m pole. Cylinder collider r 0.08, `seeThrough`.
- Optional, cosmetic: a street-name sign at the NE corner px (232, 352), an old tyre and a
  bollard on the north boulevard (from the streetview), and trash bins by driveways.

### 2.8 PVP spawns (`pvpSpawnPoints`, `[x, z, yaw]`)
The red dot is at px (432, 408). The blue FOV rays go to (197, 224) and (640, 310). Their
bisector points to world (0.112, -0.994), about north and 6 degrees east, so yaw = -0.11.

| Id | px | world (x, z) | yaw | spot |
|---|---|---|---|---|
| S1 | (432, 408) | (50.26, -0.59) | -0.11 | red dot, on 4th Ave facing 1104-1118 |
| S2 | (100, 300) | (-15.31, -21.92) | -PI/2 (E) | lawn in front of 321 |
| S3 | (520, 140) | (67.64, -53.53) | PI (S) | back yards behind 1114 |
| S4 | (460, 510) | (55.79, 19.55) | 0 (N) | lawn by 1105/1109 |
| S5 | (80, 470) | (-19.26, 11.65) | -PI/4 (NE) | SW corner boulevard |
| S6 | (600, 290) | (83.44, -23.90) | PI/2 (W) | lawn south of 1118 |
| S7 | (372, 300) | (38.49, -21.92) | PI (S) | between 1104 and 1108 |
| S8 | (300, 500) | (24.19, 17.58) | -PI/4 | south lawn east of 11th |

Pairwise separation is at least about 18 m. Every point must pass
`isWalkable(x, z, 0.8)` and `insidePlayableEdge(x, z, 2)` at build time. If one fails, the
build nudges it outward 0.5 m at a time for up to 6 m and logs a warning.

### 2.9 Pickups
PVP currently has no world weapon pickups: weapons come from the respawn panel via
`pvpGiveWeapon`. Before building, confirm with `grep -n "pickup" index.html`; the PVE "ammo
pickup" drops from enemies only. If none exist, add nothing, and export
`pvpPickupSpots: [S7, (177.5,411) intersection, (420,250) 1108 lawn]` for later use.

---------------------------------------------------------------------------------------------

## 3. New file `map2-world.js`

`window.buildMap2World(THREE, scene, renderer, options)` returns the same object shape as
`buildCampusWorld` (campus-world.js about lines 7040-7137). Every member index.html touches is
listed below with what map2 does. Run `grep -o "campusWorld\.[a-zA-Z_]*" index.html | sort -u`
again before starting.

| Member | Map2 implementation |
|---|---|
| root, environment (same uniform shape as campus lines 25-39), mapToWorld, bounds, spawn (= S1), stepUpHeight (0.5) | direct |
| groundHeightAt | `() => 0` |
| resolveCircle, supportHeightAt, segmentBlocked, isWalkable, raycast, distanceToNearestBuilding, minimapFootprints | from `world-queries.js` (section 4.1) |
| insidePlayableEdge | polygon (section 2.2) |
| vehicleBlocksShot, carAt, carClimbSlots, clampToCarTop, carRecords | car hitboxes copied from campus (about lines 6085-6240), moved into world-queries.js `createCarQueries` |
| groundMaterialAt, surfaceAt | px-rect lookup (section 2.1) |
| updateVisibility(viewers, views, lodScale) | treeSystem + vehicleSystem update (+ grassSystem if used); houses are always visible (small map) |
| prepareView / endViews | grass system passthrough, or no-op |
| treeDensityNear | treeSystem passthrough |
| wetSurfaces | road, concrete, curb, grass, roof materials |
| updateStreetLights, prepareLights, prewarmObjects, streetLightCount | no-ops / `[]` / 0 (no street lamps in the streetview) |
| findPath, isSameFenceSide, spotsBehindBuildings, isInsideHollowBuilding, navChunkCount, navLevelAt, isOnStairPortal, enclosureMask, distanceToZone, zones | PVE-only: stubs (`null`, `true`, `[]`, `false`, 0). Not reached in PVP. |
| **new**: `id: "map2"`, `pvpSpawnPoints`, `pvpSpawnTuning: { MIN_DISTANCE: 15, DISTANCE_CAP: 60 }`, `closures: { roads:[{x,z,axis,length}], sidewalks:[{x,z,axis}] }`, `playablePolygon`, `minimapRoads()` | used by index.html and the tests |

Performance: draw calls stay below about 60.
- House walls: one InstancedMesh of boxes with instanceColor.
- Roofs: one InstancedMesh per roof form (gable prism like campus about line 4099, plus hip)
  with instanceColor.
- Windows, doors, trim, shutters: one InstancedMesh each, thin boxes.
- Porches, steps, railings: InstancedMesh.
- Chimneys: InstancedMesh.
- Fences and hedges: InstancedMesh.
- Ground layers: one merged mesh per material. Write depth and use a small y lift per layer
  (0.004 / 0.008 / 0.012); no stencil needed on flat ground.

Colliders: one box per house, porch box h 0.45 (steppable), cylinder per tree trunk, car
boxes, closure barricades (from the builder), and invisible polygon walls.

Optional, last: `window.createGrassSystem` with a tester that is true only on lawn and
boulevard (not on roads, sidewalks, driveways or inside houses). Do it only if the perf test
stays within 5% of campus PVP.

---------------------------------------------------------------------------------------------

## 4. Shared-code refactor (campus behaviour must stay byte-for-byte the same in-game)

### 4.1 New `world-queries.js`
`window.createColliderQueries({ colliders, bounds, groundHeightAt, stepUpHeight })` returns
`{ forEachColliderIn, resolveCircle, supportHeightAt, segmentBlocked, isWalkable, raycast, distanceToNearestBuilding, blocksSight }`.
Copy it from campus-world.js lines 5443-5700 (bucket grid, `toLocal` / `toWorld`,
`blocksBody`, `segmentBlocked` + `segmentBlocked3D`). Drop stairs, nav levels and climbables;
map2 has none. Also copy `raycast` (about line 6238) and the car hitbox functions as
`createCarQueries(vehicleSystem, ...)`.

Campus keeps its own copy. Rewiring campus onto this module is out of scope (regression
risk), so note the duplication in MAP2_NOTES.md as tech debt.

### 4.2 Reuse the closure builder from campus-world.js (spec: "do not recreate")
1. Read campus-world.js 4456-4720 in full. That is the ROAD CLOSED / SIDEWALK CLOSED block plus
   the code that turns `parts` into InstancedMeshes, which follows the edge-wall code.
2. Move the barricade part (textures, materials, the `for (... of BARRICADES)` loop, and the
   `parts` to InstancedMesh conversion) into a top-level function inside the IIFE:
   `buildClosureBarricades(THREE, parent, list, ctx)`.
   - `ctx` = `{ mapToWorld, groundHeightAt, makeCollider, addCollider(collider, px, py), canvasTexture, mapScale, sidewalkWidthPx, mapCenter, barrierHeight }`.
   - It returns `{ meshes, rows: [...], sidewalkSigns: [...] }` (world positions, used by the
     tests).
   - Campus calls it with ctx values that reproduce today's behaviour exactly.
     `addCollider` = `zones[ZONES.indexOf(zoneAt(px, py))].colliders.push(c)`.
3. New per-row options, defaulting to today's behaviour:
   - `sidewalks: [[px,py],[px,py]]`: explicit sidewalk-sign positions.
   - `swWidthScale`: panel width multiplier.
   - `barrier: false` already exists. Map2 passes `barrier: false`, because the polygon is the
     seal.
4. Export `window.campusKit = { buildClosureBarricades, makeCollider, canvasTexture }`. Hoist
   `makeCollider` and `canvasTexture` if they're inside `buildCampusWorld`; they're pure.
5. Verify campus is unchanged:
   - campus-spawn-test and pvp-test pass.
   - Headless screenshots of a campus barricade before and after are identical, e.g.
     `campus.html#cam=` at a BARRICADES entry. Use the first entry of the `BARRICADES` list.

### 4.3 Script tags and sync
- index.html line 3344 area: add `<script src="world-queries.js"></script>` and
  `<script src="map2-world.js"></script>` after `campus-world.js`.
- `scripts/sync-frontend.js`: add both files to the shared-file list.
- New `map2.html` greybox viewer, a trimmed copy of campus.html. It supports
  `#cam=px,py,eyeHeight,yawDeg,pitchDeg` in map2 image px, and is used only for the headless
  screenshots (section 7). Add it to the sync list too.

---------------------------------------------------------------------------------------------

## 5. index.html interface refactor (`currentWorld` pointer)

There are 90 `isCampusMap` hits. Split them into two groups.

**A. Generic world queries (any built map). Switch these to `currentWorld` / `isWorldMap`.**
This covers:
- ground height
- support height and step-up
- resolveWallCollisions
- hasLineOfSight / segmentBlocked (players, turret LOS, worldBlocksShot)
- raycast / impact FX
- groundMaterialAt / surfaceAt (footsteps)
- tree density, leaf/dust particles, sun rays, wind, heat haze, wet surfaces, street lights
- updateVisibility / prepareView / endViews
- zoneMapRect, ensureZoneStaticLayer
- car climb/clamp
- PVP spawn and respawn
- aim assist LOS
- body/rig feet Y (`campusGroundY`; keep the property name, it now means "world ground Y")

Concrete lines from the grep (they will drift): 9785, 10049, 10299, 10331, 10338, 10358,
10384, 10650, 11424, 11918, 12894-12934, 13058, 13098, 13197, 13404, 13659-13670, 14948,
15019, 15028, 15111, 15122, 15132, 15154, 18156, 21322, 21344, 21667, 21671, 22530-22579,
23683, 23784, 23870, 24440, 25091, 25123, 25378, 25914-25963.

**B. Campus/PVE-only. Keep these as `isCampusMap` / `campusWorld`.** This covers:
- ensureCampusWorld
- campusSpawner / campusRecycler
- the boardable barricades (12371-12554, 15259)
- spawn debug / F8 (13251, 13303)
- findPath (11352)
- isInsideHollowBuilding (9788, 11173), unless it's needed for rain/indoor tests; map2's
  version returns false anyway, so it is safe to generalise too
- enemy logic

Changes:
```js
let selectedMapId = "campus";   // existing; now "campus" | "map2"
let pvpMapId = "campus";        // setup-screen choice (PVP only); copied into selectedMapId at match start
let isCampusMap = false;        // existing meaning kept: the campus specifically
let isWorldMap = false;         // any built world (campus or map2)
let currentWorld = null;        // campusWorld | map2World | null (tiny arena)
let map2World = null;
function ensureMap2World() { ... buildMap2World(THREE, scene, renderer, {...}); root hidden; registerWetSurface each; }
```
- `applySelectedMap()`:
  - `isCampusMap = id === "campus"` and `isMap2 = id === "map2"`; ensure the chosen world is
    built.
  - `currentWorld = ...` and `isWorldMap = !!currentWorld`.
  - Arena meshes are visible only when `!isWorldMap`.
  - Each world's root is visible only when it's the current one.
  - `skyDome.renderOrder` keys off `isWorldMap`.
  - `weatherEnvironment = currentWorld.environment`. This moves out of ensureCampusWorld into
    applySelectedMap.
  - Wet surfaces from both worlds are registered once; hidden ones are harmless. Confirm
    `registerWetSurface` (9670) just appends.
- Match starts (callers of applySelectedMap at about 19977, 20768, 22072):
  `selectedMapId = pvpSetupSelected ? pvpMapId : "campus";` goes right before
  `applySelectedMap()`. Singleplayer is always campus. **PVE never reads pvpMapId.**
- `placePlayersAtMapSpawn`: generic, uses `currentWorld.spawn`. For map2, use spawn points
  S1..S4 per player.
- `pickPvpSpawnPoint` (about 22544):
  - If `currentWorld.pvpSpawnPoints` exists, score each fixed point the same way. Add up to
    1.5 m of random jitter, re-validated with `isWalkable(…, CLEARANCE)`; on failure use the
    raw point.
  - Take `MIN_DISTANCE` / `DISTANCE_CAP` from `currentWorld.pvpSpawnTuning ?? PVP_SPAWN`.
  - Use the point's own yaw. The red dot keeps its streetview yaw; the others face the
    centre, or use the yaw listed in section 2.8.
  - Campus keeps the random-ring path unchanged.
- Zone: `zoneMapRect()` returns `currentWorld.bounds`. The radii are fractions of the short
  side (ZONE_CONFIG 13344-13354), so they scale automatically: LARGE about 52 m, SMALL about
  18 m. No change needed.
- Minimap (`ensureZoneStaticLayer`, about 13657):
  - Cache key `${selectedMapId}|…`.
  - Draw `currentWorld.minimapFootprints()`.
  - New, optional: if `currentWorld.minimapRoads` exists, draw those rects first in `#3b4046`
    so streets read. Campus has no such member, so it's unchanged.
- Test hooks (about 28780-28900):
  - Add `get currentWorld`, `get map2World`, `get pvpMapId`, `setPvpMap(id)`,
    `stepPvpMap(dir)`, and `get selectedMapId`.
  - `startPvpForTest(n, mode, mapId = "campus")` sets `pvpMapId` before starting.
  - `setMap(id)` stays as is.

---------------------------------------------------------------------------------------------

## 6. Setup-screen map picker (PVP only)

**HTML**: in both `#title-coop-setup` (after `#coop-pvp-settings-button`, about line 2912) and
`#title-quad-setup` (about line 3010):
```html
<div id="coop-setup-map-label" class="pvp-map-label">Map <span class="pvp-settings-hint">L1 / R1</span></div>
<div id="coop-pvp-map-options" class="pvp-map-options">
  <div class="pvp-map-option" data-pvp-map="campus"><div class="difficulty-name">Campus</div><div class="pvp-mode-desc">MSUM campus</div></div>
  <div class="pvp-map-option" data-pvp-map="map2"><div class="difficulty-name">Residential</div><div class="pvp-mode-desc">4th Ave S</div></div>
</div>
```
The quad copy uses `quad-` ids. Use a **separate class** `pvp-map-option`, not
`pvp-mode-option`. The existing `querySelectorAll(".pvp-mode-option")` handler (19616-19638)
would otherwise set `pvpMode = undefined` on click.

**CSS** (about 2744-2756):
- `.pvp-map-label, .pvp-map-options { display:none }`.
- `.pvp-setup .pvp-map-options { display:flex; gap:12px; margin-bottom:24px }` and
  `.pvp-setup .pvp-map-label { display:block; … }`, copying the mode-label rule.
- Add `.pvp-map-option` to the existing `.pvp-mode-option`, `:hover` and `.active` selectors.
- Check that the quad screen still fits at 1280x720; reduce margins if not.

**JS** (next to updatePvpModeButtons):
- `PVP_MAP_ORDER = ["campus", "map2"]`.
- `updatePvpMapButtons()` toggles `.active` on `[data-pvp-map]`.
- `stepPvpMap(dir)` clamps, plays `menu_click_01` and updates the buttons.
- Clicking an option sets `pvpMapId` and updates.
- Add `.pvp-map-option` to the click-sound delegation selector (about line 7459).
- `setPvpSetup(on)` calls `updatePvpMapButtons()`. The choice persists for the session; it is
  not reset, unlike the mode.

**Controller**: L1 / R1 (buttons 4 / 5) step the map on the PVP setup screens. They're
unclaimed in menus; `INVENTORY_TAB_*` uses them only in-game.
- Add `pollPvpMapButtons()`, called beside `pollPvpSettingsOpenButton()` in the "PVP setup
  screens' branch of animate()" (about line 28565).
- Any connected pad, edge-triggered (track per-pad previous state).
- Skip it while the PVP Settings panel is open.

**Keyboard**: Q / E. First grep that nothing on the coop and quad setup screens uses KeyQ /
KeyE; if they're taken, use `[` / `]`. Mouse: click.

---------------------------------------------------------------------------------------------

## 7. Test and verification plan

All runs are headless. Never launch the game (memory: no auto-launch). Run commands one at a
time.

1. **Syntax**:
   - `node --check map2-world.js`, `node --check world-queries.js`,
     `node --check campus-world.js`.
   - For index.html, the headless runs fail on any inline-script error; also
     `grep -c "SyntaxError"` the run output.
2. **Campus regression first** (after phase 2, before map2 exists in menus):
   - `HASH='#spawntest' GL_MODE=swiftshader node tests/run-perf.js`
   - `HASH='#pvptest' GL_MODE=swiftshader node tests/run-perf.js`
   - Both must pass exactly as they did before. Record the baseline pass counts in phase 0.
3. **New checks in `tests/pvp-test.js`** (prefix "M2"):
   - M2.0a The PVP coop setup shows `#coop-pvp-map-options` (computed display flex); the quad
     setup shows `#quad-pvp-map-options`; PVE setup hides both.
   - M2.0b Default `H.pvpMapId === "campus"`, with the campus option `.active`.
   - M2.0c Clicking `[data-pvp-map=map2]` sets pvpMapId "map2" and `.active`, and leaves
     `H.pvpMode` unchanged (the class-collision guard).
   - M2.0d `H.stepPvpMap(-1)` gives campus; `stepPvpMap(1)` gives map2; it clamps at the ends.
   - M2.0e PVE after picking map2: start a PVE coop run through the existing flow; then
     `H.selectedMapId === "campus"` and `H.isCampusMap`.
   - M2.1 `startPvpForTest(2, "deathmatch", "map2")`:
     - `H.currentWorld === H.map2World`.
     - The map2 root is visible and the campus root hidden.
     - The bounds span is 100..140 m on each axis.
   - M2.2 Spawns:
     - Every `pvpSpawnPoints` entry passes `isWalkable(x,z,0.8)` and
       `insidePlayableEdge(x,z,2)`.
     - S1 is within 1 m of `mapToWorld(432,408)`, with |yaw + 0.11| < 0.05.
     - Pairwise distance is >= 15 m.
     - 200 calls of `pickPvpSpawnPoint` with 4 players give all-walkable results that are
       inside the polygon.
   - M2.3 Signs: `map2World.closures.roads.length === 4`, each within 1.5 m of the section 2.3
     world centre with the matching axis; `closures.sidewalks.length === 8`, each within 1.5 m
     of P1..P8.
   - M2.4 Boundary:
     - 64 rays from S1 and from world (0,0): march a body (r 0.35) 0.3 m per step for 500
       steps outward with `resolveCircle`. It must end with `insidePlayableEdge(x,z,-0.6)`.
     - At each barricade, start 4 m inside on the road centreline and walk 20 m outward. The
       final position must be inside the polygon.
   - M2.5 LOS:
     - `segmentBlocked` from the 1108 front lawn, px (416,300), to the 1108 back yard,
       px (416,190), is true.
     - From S1 to world (0,0), along 4th Ave, it is false.
   - M2.6 Minimap: `ensureZoneStaticLayer()` gives a `zoneUi.layerKey` that starts with
     "map2"; `minimapFootprints().length >= 12`.
   - M2.7 Switch back: `startPvpForTest(2, "deathmatch", "campus")` gives `H.isCampusMap`,
     the campus root visible, the map2 root hidden, and the existing campus spawn checks still
     pass.
4. **Perf**: run `GL_MODE=swiftshader node tests/run-perf.js` (#perftest) before and after.
   Campus numbers must stay within noise. Optionally add a map2 PVP perf pass with
   `setMap("map2")`.
5. **Visual comparison** (headless Edge, command in memory `reference_headless_screenshots`,
   using `map2.html`):
   - Top-down: `map2.html#cam=320,295,180,0,-89`. Compare to topdownview.png: road positions,
     house footprints, trees, and the barricades at the orange/purple marks.
   - Street level: `map2.html#cam=432,408,1.6,-6,2`. Compare to streetview1.png: 1104 (cream,
     deck) on the left, 1108 (small, yellow) in the centre, 1114 (white, chimney, shutters)
     right of centre, 1118 at the far right, cars in the 1114 drive, the silver wagon in the
     foreground at the curb, lawns, sidewalk and boulevard.
   - Iterate on colours, heights and positions until they resemble the references. Save the
     PNGs outside the repo or in a gitignored folder; don't commit them unless asked.
6. **Finish**:
   - `node scripts/sync-frontend.js`.
   - Write MAP2_NOTES.md: what was built, the 8-vs-5 purple note, tech debt from 4.1, and the
     measured coordinates.
   - Local commit. No push, no launch.

---------------------------------------------------------------------------------------------

## 8. Phases (lint/test after each)

0. **Baseline.**
   - Run spawntest, pvptest and perftest and record the results.
   - Optional refinement: `python -I %TEMP%\map2_annot.py "<ref dir>"`. The script colour-
     detects the orange/purple/red annotation pixels by diffing the two topdown PNGs; it
     needs approval to run. Update section 2.3 if any position moves by more than 4 px.
1. **world-queries.js**: copy plus unit-ish checks through the pvp test hooks later.
2. **Closure-builder extraction** in campus-world.js, then the campus regression run
   (section 7.2) and the barricade screenshot diff.
3. **map2-world.js plus map2.html.**
   - Build order: ground, roads, sidewalks, houses, trees, cars, closures, polygon, props.
   - Take headless screenshots and iterate.
4. **index.html `currentWorld` refactor** (section 5), then the campus regression run again.
5. **Setup-screen map picker** (section 6).
6. **M2 tests, perf, visual comparison, sync, NOTES, commit.**

Open questions for the user (defaults are already chosen above, so work isn't blocked):
- Purple count: the image has 8 ticks and the spec says 5. The plan uses 8.
- Should the map choice persist between visits to the setup screen? The plan says yes,
  for the session.
- Should the house mesh behind the south polygon edge stay? The south houses cross the
  image bottom.
