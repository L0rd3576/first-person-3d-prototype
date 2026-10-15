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

## Rev 3: storm, car support bug, win-screen cursor, melee tuning
- **Map2 storm** (`updateZone`/`initZone`, `zoneIsMap2Pvp`, `ZONE_MAP2_CONVERGE_SECONDS`): starts as one circle centred on the map and reaching the farthest playable corner (everything safe), then both centre and radius glide linearly onto `world.pvpFinalZone` over 5 min of *match* time (ticks only once the match clock has started), then hold. Final circle = pink circle on `topdownview - annotations.png` (px 462,245, r 78 px = ~15.4 m; defined in `map2-world.js`). Phases are `converge` -> `stay`; no waves, warning, or random zones. Minimap and HUD read `zoneState` every frame ("Storm closing m:ss", then "Final circle"). Damage outside is unchanged. Campus keeps its cycle (test M2S.8). Match length is the shared `PVP_MATCH_SECONDS` = 15 min on both maps.
- **Map2 respawns late in the match**: the fixed spawn points all fall outside a 15 m circle, so `pickPvpSpawnPoint` now substitutes a random walkable point inside the zone for any fixed point outside it, and caps the min-distance rule at 0.6 x zone radius (map2 only).
- **Car roof bug (root cause)**: `campusSupportHeight` (player/enemy standing height, the vertical-physics step) queried `campusWorld.supportHeightAt` even on map2, so map2's car boxes (and every other collider) never gave a floor: you landed "through" a roof and were shoved sideways out of the car; with campus not yet built it would have thrown. It now uses `currentWorld` (identical on campus, so campus behaviour is unchanged). The collider boxes themselves match the rendered models (centred, L x W, heading `yaw`, body to the belt line + cabin to roof height) -- unchanged. Remaining approximation: the flat body box top is the belt height (~1.0 m) vs a visually lower hood/trunk, and the cabin box spans windshield base to rear-window base at full roof height.
- **Tests** (`tests/pvp-test.js`): `M2S.*` (storm), `CAR *` (map2 + campus: footprint corners, support heights, walk + jump onto a sedan roof, no clipping / falling through / popping; fails on map2 with the old `campusWorld` line), `19 win screen` (cursor).
- **Win screen**: the PVP results screen now counts as a menu screen (`isAnyMenuScreenVisible`), `setCursorHidden(true)` is ignored there for a keyboard+mouse P1 (another player's controller input used to re-hide the cursor), and a pointer lock granted while it is up (late retry listener) is released again. Lock is re-requested by the normal match start paths (`startCoopMatch`/`startQuadMatch`).
- **Bat**: heavy windup swing (`BAT_MELEE_DAMAGE`) 60 -> 100, fast shove (`BAT_SWEEP_DAMAGE`, up to 3 targets) 12 -> 25. The bat has no hold-to-charge, so "charged" was read as the heavy swing and "weak" as the shove. Applies to PVE too (shared constants; PVP melee uses WEAPON_DEFS values).
- **Katana**: `KATANA_MELEE_RANGE` 2.8 -> 2.4 (the slash sweep reads this one range; no other constant).

## Rev 4: wooden fences, back alley, east garage (streeview2 / topdownview - angle2)
- **Tall fence (1.8 m, tan vertical boards, posts every ~2.4 m, top rail)** round the street-facing yard of 1104 (px x 252, y 161..255 across the front, plus the north side along the drive edge to x 298 and the south side to x 300). The fenced house in streeview2 is 1104 (bearing check from the camera at px 185,185), not 320 as the brief said; 320 is the brown house at the left of the view.
- **Low dark fence (1.5 m, horizontal boards)** on the north side of the back alley, px y 98, x 248..302 and 372..404 (320's yard side, "left" of the alley in streeview2).
- **Back alley**: concrete strip px [300,98,402,122] east from the 320/1104 drive apron, north of the new east garage, out to the back yards. Open only at the west end beside the yellow car (the drive's south side is closed by the tall fence).
- **garageE** px [297,122,333,150]: beige gable, white double door facing the street, behind the yellow hatchback (`paint`/`model` options on the parking spot). 320 recoloured tan/brown, 1104 greyer to match streeview2.
- Fences are real colliders (`fx: "wood"`, opaque, drawn on the minimap like walls), one merged mesh per style plus instanced posts. Both are taller than the jump apex (7^2 / 36 = 1.36 m) so they cannot be climbed.
- Tests: `M2.8a..g` in tests/pvp-test.js (blocked from three sides, not jumpable, sight/shot blocked, alley walkable end to end, alley north fence, garage solid, minimap count). All pass.
- Known: `M2S.4 HUD says the storm is closing` and `M2S.5 still the final circle` fail in this swiftshader harness with or without these changes (HUD label text timing; the storm maths checks pass). Not touched here.
- Render comparison (map2.html#cam=185,185,1.7,-90,0 vs streeview2): layout, garage, yellow car, tall fence and dark fence line up. Houses still read taller than in the photo (storey heights are uniform).
