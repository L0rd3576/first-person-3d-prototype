# Campus Map Progress

Zone-by-zone detailing of the campus environment in `campus.html`. The
aerial screenshots in `5 nights at kise/making the map/` are the ground
truth. This file is the checklist that lets the work pause and resume across
sessions without redoing finished zones.

## Rules

- Zones are processed one at a time in the fixed order below, running west to
  east and north to south within each column.
- Every zone gets exactly 3 passes, then it is marked complete:
  1. **Geometry:** building heights and footprints set to the relative
     proportions visible in the image. Sidewalks stay distinct from streets.
  2. **Surface detail:** each material category is distinct (streets, lots,
     track, turf and so on).
  3. **Props and edge detail:** trees where visible, small structures
     (bleachers, dugouts, entry markers).
- A complete zone is never revisited unless explicitly asked.
- Environment art only: no enemies, gameplay or interiors.
- Performance: buildings, props and trees are instanced per zone, zones are
  frustum- and distance-culled, and trees drop out first (the LOD step).
  Collision uses simple boxes and cylinders, never detailed meshes.
- Where the image doesn't show enough detail, use a placeholder and add it
  to **Flags** below instead of guessing.

## Standing decisions (from earlier requests; still apply)

- Ballard Hall is demolished. Its site south of the mall is open lawn with
  one curving walk.
- Nelson Hall is a tall round tower (cylinder, 30 m).
- There are no tennis courts. That area east of 17th St / north of 9th Ave is
  grass. Tennis court fencing (step 3) is therefore skipped.
- 6th Ave S is under construction from just east of 11th St to just past
  13th St (`screenshot6.png`, orange box). The roadbed is bare dirt, sunk
  two 0.18 m steps below grade, and the sidewalks stay. This replaced the
  earlier flat dirt stretch.
- 13th St S runs from 5th to 6th Ave. The alley behind the 12th–14th St
  houses is gravel/dirt.
- The top-left lot (10th–11th St, 5th–6th Ave) is an open lawn.
- Tunnels connect the three Snarr halls, Nelson to Grantham, and Nelson to
  Holmquist. They are solid low connectors, not walkable.
- Public Safety is a low single-storey building.
- Comstock Memorial Union and MSUM Dining are one connected building. MSUM
  Dining is hollow: walls, roof and floor, with a door-size opening on its
  south side facing the mall.
- The south end of G-6 is a car turnaround (a drive loop around a grassy
  median), not a walkway.
- The Nelson–Grantham tunnel is slanted, running from Nelson's south-west
  side to Grantham, and doesn't cover the G-6 turnaround.
- Alex Nemzek Hall and Nemzek Fieldhouse are one connected building. A
  narrow alley runs between its east side and the stadium grandstand. The
  grandstand is open, with no canopy. It has a high-school-style press
  box (see standspressbox.png) on red columns in front of a brick back
  wall.
- Alex Nemzek Hall has a walk-through hallway (the blue line in
  screenshot4.png), running from a door on 17th St to a door in the small
  inlet in the building's east side, just north of the stadium stands
  (the hallway ends at the inlet's back wall). The stands start south of
  it. The field fence's south run stops at the white line in
  screenshot4.png, short of the stands.
- The player spawns inside Kise (MSUM Dining).
- The athletic-field fence has three always-open gates (green in
  firstedits.png): on the stub by Nemzek's south walk, just east of the
  fieldhouse on 6th Ave, and on 9th Ave by the softball field. Each is a gap
  with its leaf swung inward. Fences are defined in `FENCED_AREAS` in
  campus-world.js.
- The Heating Plant has 3 red roof stacks in a line on the east side, set
  toward the north, plus a white one continuing that line in the south-east
  corner. All four are about 5 m tall and 1.4 m across.
- The athletic fields east of 17th St are fenced (chain-link). There are no
  practice diamonds. Along 20th St the fence sits inside the evergreen row,
  with the trees on the street side close to it.
- The soccer field has the same chain-link fence. The pitch runs almost up
  to the west fence (F-1 side, no trees there) and leaves a wide grass
  buffer before the east fence.
- G-7 north and G-7 east are one connected lot (no planted strip between
  them).
- There is no South Snarr–East Snarr tunnel. A walk runs through the Snarr
  courtyard instead.
- Real-world scale: 1 unit = 1 m, 0.66 m per screenshot pixel. The map runs
  from 5th Ave S down to 9th Ave S and from 10th St to 20th St.

## Step 1: Zones

Bounds are screenshot-A pixels `[x1, y1, x2, y2]`, matching `ZONES` in
`campus.html`.

| Zone | Bounds | Contents |
|---|---|---|
| Z01 | [-5, -5, 232, 175] | 10th–11th St, 5th–6th Ave: large surface parking lot |
| Z02 | [-5, 175, 232, 343] | 10th–11th St, 6th–7th Ave: Lot F (north) |
| Z03 | [-5, 343, 232, 695] | 10th–11th St, 7th–9th Ave: service yard, building north of Center for Business, Center for Business, Lot F south-west, lot south of Center for Business, South House |
| Z04 | [232, -5, 396, 175] | 11th–12th St, 5th–6th Ave: parking lot |
| Z05 | [396, -5, 815, 175] | 12th–14th St, 5th–6th Ave: houses, alley and garages |
| Z06 | [232, 175, 523, 405] | Central NW: Hagen, Langseth, Weld, west Lommen, the quad, Campus Gates, dirt stretch of 6th Ave |
| Z07 | [523, 175, 815, 405] | Central NE: east Lommen, lot between Lommen and Comstock, Comstock Memorial Union, Kise Commons, Livingston Lord Library |
| Z08 | [232, 405, 523, 695] | Central SW: MacLean, Bookstore, Bridges, Flora Frick / Grier, Owens, King, Roland Dille, Lot W-G |
| Z09 | [523, 405, 815, 695] | Central SE: old Ballard lawn, Conlin Wellness Center, big lot G-1, Hendrix Hall |
| Z10 | [815, -5, 1160, 175] | 14th–16th St, 5th–6th Ave: houses |
| Z11 | [1160, -5, 1297, 175] | 16th–17th St, 5th–6th Ave: houses and garages |
| Z12 | [815, 175, 1056, 405] | East NW: Dahl, Nelson (round), Grantham, G-6/G-7 lot west, Nelson–Grantham tunnel |
| Z13 | [1056, 175, 1297, 405] | East NE: Holmquist, Holmquist lawn, G-7 lots, Heating Plant, Nelson–Holmquist tunnel |
| Z14 | [815, 405, 1056, 695] | East SW: West/East/South Snarr and their tunnels, Murray Commons, G-11, John Neumaier Hall |
| Z15 | [1056, 405, 1297, 695] | East SE: G-10, Maintenance Building, Public Safety, service yard |
| Z16 | [1297, -5, 1900, 175] | 17th–20th St, 5th–6th Ave: houses by 17th St, F-1 lot, women's soccer field, houses by 20th St |
| Z17 | [1297, 175, 1500, 450] | Alex Nemzek Hall and the lot north of it |
| Z18 | [1500, 175, 1655, 450] | Nemzek Stadium: track, Scheels Field, grandstand, east bleachers |
| Z19 | [1655, 175, 1900, 495] | East practice fields, practice diamonds, long jump |
| Z20 | [1297, 450, 1715, 695] | Nemzek softball field, dugouts, grass where the tennis courts were |
| Z21 | [1715, 495, 1900, 695] | Moorhead Municipal Pool: pool, deck, bathhouse |

## Step 2: Surface classification (whole map, low detail)

**Status: complete.**

Every category is placed map-wide: grass, streets, sidewalks, parking lots,
building footprints, track, turf field, softball infield and pool. Tennis
courts are intentionally absent (see Standing decisions).

Buildings kept their already-traced heights instead of being reset to a
uniform placeholder. Pass 1 of each zone re-checks them against the image.

## Step 3: Per-zone refinement

Status values are `pending`, `in-progress` or `complete`. P1, P2 and P3 are
the three passes.

| Zone | Status | P1 | P2 | P3 | Notes |
|---|---|---|---|---|---|
| Z01 | complete | x | x | x | P1 no buildings; lot outline checked, 3 grass islands, 3 driveways, NE corner walk. P2 stall lines (rows E-W). P3 6 tree rows + 1 island tree. |
| Z02 | complete | x | x | x | P1 no buildings; lot outline checked, 2 shrub strips. P2 stall rows set N-S to match the photo. P3 6 tree rows (streets + strips). |
| Z03 | complete | x | x | x | P1 Newman Center (named from the drop-off map) + Center for Business footprints checked; South House placeholder. P2 lots rows N-S; service yard plain paving; 3 driveways; walks around Center for Business. P3 5 tree rows, 5 lawn trees, 2 yard containers. |
| Z04 | complete | x | x | x | P1 no buildings; lot outline checked, 2 planted strips. P2 stall lines + 2 concrete walks across the lot (new LOT_WALKS layer); driveway from 5th Ave. P3 8 tree rows. |
| Z05 | complete | x | x | x | P1 house/garage footprints checked against roofs (7 m houses, 3.5 m garages). P2 front walks for all 24 houses, garage aprons onto the alley, paved lane in from 6th Ave. P3 boulevard trees on both avenues + 22 backyard trees. |
| Z06 | complete | x | x | x | P1 re-traced from the 2x close-up: Hagen 16 m, Langseth 13 m + curved east wing, glass connector 8 m, Weld as main block + taller north wing, Lommen split around its NE courtyard. P2 quad walks re-traced (4 N-S, 3 E-W, 6 diagonals), curving walk from the gates to the mall, brick plaza at the Campus Gates. P3 ~50 quad trees, 11th St tree rows, 2 brick gate pillars. |
| Z07 | complete | x | x | x | P1 Comstock narrowed (west walk + east tree row) with low SW entrance wing, Kise Commons/MSUM Dining re-traced, library split into main block + lower west annex. P2 M-5 lot deepened (rows N-S) with planted divider, service drive north of Lommen, Kise service yard, walks re-traced. P3 6 tree rows + 14 trees. |
| Z08 | complete | x | x | x | P1 re-traced from the 2x close-up: MacLean main block extended, Bookstore, MacLean-Flora link, Bridges Hall (planetarium), Flora Frick + low greenhouse annex, Grier, Owens + link, King; Roland Dille split into north/middle/south with a 20 m theater fly tower. P2 Lot W-G (rows E-W), paved court by Grier, walks re-traced. P3 9th Ave tree row + 11 trees. |
| Z09 | complete | x | x | x | P1 Roland Dille east edge corrected to x 535; Conlin re-traced as main block + stepped north end + east wing; Ballard stays removed (lawn). P2 G-1 lot re-traced (rows N-S) with 7 tree planters, 2 entrances. P3 14th St + 9th Ave tree rows, 8 lawn trees on the old Ballard site, 7 planter trees. |
| Z10 | complete | x | x | x | P1 house footprints checked against roofs (south row trimmed to roof depth). P2 front walks for all 18 houses + corner walk. P3 boulevard trees on 5th/6th Ave, 14th/16th St, 27 backyard trees, sandy backyard patch. |
| Z11 | complete | x | x | x | P1 8 houses re-traced (2 blocks previously marked as garages are small houses, 7 m / 5 m). P2 front walks. P3 boulevard trees on all 4 streets + 5 backyard trees. |
| Z12 | complete | x | x | x | P1 Dahl narrowed to its real footprint (18 m) + east wing, Grantham lowered to 12 m, Nelson (round, 30 m) nudged north; tunnels checked. P2 G-6 (rows N-S) / G-7 north (rows E-W) split, curved walk around the lawn west of Nelson (new PATH_ARCS layer), Dahl door walks. P3 14th St + 6th Ave tree rows, 14 trees. |
| Z13 | complete | x | x | x | P1 Holmquist re-traced as a 12 m U (N block + W/E wings) from the close zoom, Nelson-Holmquist tunnel re-aligned; Heating Plant re-traced + NW annex + 30 m smokestack. P2 Holmquist lawn walks radiate from a round plaza (PATH_ARCS), courtyard walk through to the mall; planted strips between the G-7 lots, lawn strip along 17th St. P3 3 tree rows + 14 trees (courtyard, lot islands). |
| Z14 | complete | x | x | x | P1 West/East/South Snarr, Murray Hall + Murray Commons re-traced from the close-up; W-E and S-E tunnels re-aligned to the connectors visible in the photo. P2 G-11 (rows N-S) with lawn island, small lot east of Murray, curving walk past Murray, G-11 north-edge walk. P3 3 tree rows + 21 trees. |
| Z15 | complete | x | x | x | P1 Maintenance Building, Public Safety (low) and red outbuilding checked. P2 G-10 re-split into west/middle/east lots (rows N-S) with the tree strip only at the north end; Public Safety yard changed from parking to plain service paving. P3 4 tree rows + yard clutter props. |
| Z16 | complete | x | x | x | P1 17th St houses, F-1 lot and east houses checked. P2 MSUM women's soccer pitch (new SOCCER_FIELDS layer: mowing stripes, touchlines, halfway line, center circle, penalty + goal areas), F-1 rows N-S, lane moved to x 1688. P3 evergreen windbreaks on all 4 sides of the pitch, 2 goals (posts + raised crossbar), 2 tree rows, 8 yard trees. |
| Z17 | complete | x | x | x | P1 Alex Nemzek Hall re-traced as 5 blocks; the fieldhouse (north gym, 18 m) and the raised middle roof (17 m) now read bigger and taller than the academic halls. P2 lot north of the hall and the south walk checked. P3 17th St tree row + 6 trees. |
| Z18 | complete | x | x | x | P1 west grandstand rebuilt as 20 walkable steps up to 10 m with a raised canopy (13 m) and press box; east bleachers stepped. P2 track and Scheels Field re-traced to the photo (track 6 lanes, maroon DRAGONS end zones oriented as in the photo; fixed a north-south flip in stretched textures). P3 4 light towers, 2 goalposts, ticket booth, 4 trees. |
| Z19 | complete | x | x | x | P1 no buildings; equipment shed. P2 3 dirt diamonds re-traced; the single dirt 'long jump' strip replaced with 2 rubber runways + pads (new RUNWAYS layer, track surface) and sand pits. P3 evergreen windbreak along 20th St, 8th Ave tree row, 3 backstops, 4 trees. |
| Z20 | complete | x | x | x | P1 softball shed/storage re-traced. P2 infield re-traced; warning-track arc refit around home plate; bullpen strip; old tennis court site is grass (standing decision). P3 continuous outfield fence (new fences layer), dugouts, backstop, equipment boxes, 3 tree rows + 4 trees. Tennis court fencing from the brief is skipped because the courts were removed. |
| Z21 | complete | x | x | x | P1 bathhouse re-traced (placeholder, see Flags). P2 lap pool re-traced to the photo (lanes run N-S), deck, wading pool + round splash pad (new WADING_POOLS layer), walks from 8th Ave and 19th St. P3 chain-link fence around the deck, lifeguard chair, diving board, 3 tree rows + 6 trees. |

## Shared systems (built once, used by every zone)

All of these live in `campus.html`.

- **Procedural canvas textures**, drawn at startup:
  - streets: asphalt with a dashed yellow center line; plain patches at
    intersections
  - sidewalks and walkways: concrete slabs with expansion joints
  - parking lots: asphalt with white stall lines; per-lot row direction
    (`"x"` or `"z"`)
  - grass and dirt: speckled
  - running track: red rubber with 6 lanes
  - football field: yard lines, numbers, maroon "DRAGONS" end zones
  - soccer pitch: full markings
  - pool: lane lines
- **Ground layers:**
  - `ROADS`, `LOTS`, `DRIVEWAYS` (plain paving), `PATHS`, `PATH_ARCS`
    (curved walks), `LOT_WALKS`, `PLAZAS`
  - `GRASS_AREAS`, `DIRT_AREAS`, `DIRT_CIRCLES`, `DIRT_ARCS`
  - `TRACKS`, `RUNWAYS`, `TURF_AREAS`, `SOCCER_FIELDS`, `POOLS`,
    `WADING_POOLS`
  - Layers are stacked a few centimeters apart (`LIFT`) so they never
    z-fight. A logarithmic depth buffer keeps that working from flying
    height.
- **Per-zone detail** (`ZONE_DETAIL`):
  - `props`: boxes; raised ones, such as crossbars and light banks, don't
    collide
  - `bleachers`: stepped, walkable (`STEP_UP_HEIGHT`)
  - `fences`: thin rotated panels
  - `trees` and `treeRows`: deciduous, or evergreen with `"e"`
- **Chunking and performance:**
  - Every zone is its own render and collision chunk.
  - Buildings and props are instanced per zone (boxes and cylinders), with
    per-instance color.
  - Trees are instanced as trunk, canopy and cone.
  - Zones are frustum-culled. Buildings are hidden past 450 m and trees
    past 260 m (the LOD step).
  - Collision is plain boxes and cylinders, and only for the zone the
    player is in.
  - Whole map: about 77 draw calls and about 112k triangles.
- **Debug camera:** `campus.html#cam=px,py,height,yawDeg,pitchDeg` freezes
  the view at a screenshot-pixel position. Useful for checking a zone
  without playing.

## Revisions (explicit requests after completion)

- **2026-09-26, `firstedits.png`:**
  - Fixed street/sidewalk flicker at intersections (ground layers now paint
    in order).
  - Z09: G-1 entrances off 14th St and 9th Ave; trees removed from the
    driveways; the walk west of G-1 now connects up to the mall.
  - Z07: Comstock and MSUM Dining merged; MSUM Dining made hollow with a
    door.
  - Z12: G-6 turnaround.
  - Z13: Heating Plant stacks.
  - All zones: trees can no longer spawn on streets, sidewalks, walks, lots
    or driveways. Rows shift slightly to clear them.

- **2026-09-26 (2):**
  - Z12: Nelson–Grantham tunnel slanted, per screenshot4 and campus
    map.png.
  - Z17: Nemzek merged into one building with an east-side alley.
  - Z18: grandstand canopy and press box removed.

- **2026-09-26 (3):**
  - Z13: stacks halved to 5 m and thinned; the red ones moved north.
  - Z18: press box added back.
  - Z14: South–East Snarr tunnel replaced with a courtyard walk.
  - Z08: new lot between Bridges and Owens, with an entrance off 11th St.
- **2026-09-26 (4), from the re-saved `firstedits.png`:**
  - 20 lot entrances: Lot F, M-5, G-6/G-7, the lot north of Nemzek, F-1,
    and the 11th–12th St lot.
  - Chain-link fence (2.4 m) around the athletic fields: along 6th Ave to
    20th St, down to 8th Ave, 19th St, 9th Ave and 17th St, and back to
    Nemzek.
  - The three dirt practice diamonds east of the stadium are grass now,
    with their backstops removed.

- **2026-09-26 (5):**
  - Fence moved in along 20th St with the trees outside it.
  - Soccer field fenced, pitch shifted west, west tree row removed.
  - G-7 lots joined.
  - Dining area re-traced from `screenshot5.png` (fitted: map px =
    screenshot5 px × 0.147 + (574, 264)):
    - Comstock gets its angled south-west face.
    - MSUM Dining widened to its real footprint (718–772).
    - Glass entrance link added on Dining's west side.
    - Library split into west and east blocks.
    - Diagonal walk re-traced from the library's NE corner, with the
      north–south walk at x 707.
    - Dining service yard east of the building.

- **2026-09-26 (6), high-traffic zone (Comstock / MSUM Dining / library
  corner), from `screenshot5B.png`** (fitted: map px = screenshot5B px ×
  0.08732 + (624.1, 272.2)):
  - Shadows separated from buildings: the photo's sun is from the east, so
    the dark bands west of each building are shadow. Dining's west wall is
    at x 718.5, and the wedge between Comstock's wing and Dining is open
    ground with a tree.
  - Comstock: main mass, west entrance vestibule, and the angled one-storey
    south-west wing.
  - Library east block: north bump and low east strip; shadowed lower roof
    to the west.
  - Paved plaza with a shrub planter, the broad diagonal walk and the
    north–south walk re-fitted to the photo; trees re-placed.
  - Doors (blue in `screenshot5B.png`):
    - library north-east: door panel
    - Comstock west vestibule: door panel
    - glass entrance link: a real opening leading through the link into
      MSUM Dining (hollow buildings now support several doors)

- **2026-09-26 (7):**
  - Kise entrance link recolored to the building gray.
  - Tree canopies can no longer poke into walk-in buildings.
  - Z01 lot turned into lawn.
  - From `screenshot6.png` (fitted: map px = screenshot6 px × 0.296 +
    (243, −5)):
    - 13th St added.
    - Alley turned to gravel.
    - House 1305 and two garages added; 1316, 1320 and 1324 moved.
    - 6th Ave construction pit (new CONSTRUCTION_ROADS layer, stepped
      terrain).

- **2026-09-26 (8):**
  - The campus moved into `campus-world.js` (shared by campus.html and the
    game's new Campus map). **Map edits now go in that file.**
  - Nemzek hallway added, bleachers shortened, fence shortened.
  - Spawn moved into Kise.

- **2026-09-26 (9):**
  - Three fence gates added.
  - Fences now block enemy reach, contact and explosions; you can still see
    and shoot through them.
  - Enemies spawn only on the player's side of a fence, or within 25 m of a
    gate, and route through gates.
  - Enemy recycler added (far / stuck), in procedural-spawn.js.

- **2026-09-26 (10), map borders (`newborders.png`, fitted: map px =
  newborders px × 1.1893 − 61.4, × 1.1889 − 51.3):**
  - The map now runs to the house rows across 5th Ave (north), 10th St
    (west) and 9th Ave (south), which are the new borders. Walkable area is
    about 1293 × 517 m.
  - 76 border houses added, with front walks and boulevard trees, as zones
    Z22–Z28.
  - Every street leaving the map is closed by a ROAD CLOSED barricade row
    (orange marks), built like `gamemapconstructionsign.jpg`: striped
    3-board barricades on metal legs with sandbags, a sign on the middle
    one, and cones at the curbs.
  - Short street stubs added past the borders where the barricades sit, plus
    8th Ave west of 10th St and 5th Ave's cul-de-sac east of 19th St.

- **2026-09-26 (11):**
  - Barricades now face into the map (sign readable from inside, blank on
    the back).
  - Cones sit on square bases.
  - Invisible 200 m-tall barriers span each closed street, road plus
    sidewalks, so nobody walks, jumps or flies out.
  - 9 missed border houses added (purple circles).
  - 9th Ave ends at 19th St; Romkey Park is grass.
  - Soccer field gets two gates (dark pink).
  - Railway (ballast, ties, rails) about 10 m east of the 20th St sidewalk,
    with a chain-link fence just beyond it.

- **2026-09-26 (12), building styles:**
  - Everything inside 6th Ave / 9th Ave / 10th St / 20th St is brick: a
    world-space brick texture, with gravel-gray flat roofs.
  - Everything outside is a single-storey house:
    - wall color from a weighted palette (light gray, dark gray, greenish
      tan, dark blue, white, with maroon rare)
    - a shared instanced gable roof with 4 pitches and 5 shingle colors
    - 3.0 m walls (garages 2.6 m)
  - Each house's look is seeded by its position, so it's stable. Collision
    keeps the same footprint, with its height set to the roof ridge.

- **2026-09-26 (13):**
  - Invisible walls strung between all border houses (north, west, south),
    joined to each ROAD CLOSED barrier, so the playable edge is sealed.
  - Romkey Park trees scattered.
  - Trees can't spawn inside or against building footprints.
  - Bleacher back wall pulled off the stands' faces, fixing the flicker.
  - Three houses moved out of sidewalks.
  - Zebra crosswalks at every lot entrance, sidewalk to sidewalk, and on
    all four legs of 14th St at 6th Ave and at 9th Ave.
  - Alley block re-checked against `screenshot7alley.png` (fitted: map px =
    px × 0.25 + (393, −1)):
    - the alley is split so it stops at 13th St's curbs
    - one missing house and two back garages added

- **2026-09-26 (14):**
  - SIDEWALK CLOSED barricades (`gamemapsidewalksign.jpg`) on both
    sidewalks of every closed street: an orange slotted plastic panel with a
    white sign, about 60% of the road barricade's height, facing into the
    map.

- **2026-09-26 (15), 1311 backyard (annotated `screenshot7alley.png`):**
  - Chest-high (1.3 m) white fence along the white lines, with two open
    gates (pink), each leaf swung inward.
  - The alley garage is shrunk to its roof: the dark band beside it was its
    shadow.
  - Backyard walk from the back door to the garage, and from the alley gate
    to the alley.

- **2026-09-26 (16):**
  - Nemzek's east-side inlet restored: an open notch about 18 × 13 m
    (x 1450–1478, y 298–318 px), just north of the stands.
  - The hallway now ends at the inlet's back wall (x 1450), with its east
    door opening into the inlet.
  - The east block starts south of the inlet again.

- **2026-09-26 (17):**
  - Decorative ROAD CLOSED and SIDEWALK CLOSED barricades on every approach
    to the 6th Ave construction pit: 6th Ave from both ends, and 12th and
    13th St from the north.
  - They face away from the pit and have no invisible barrier; you can walk
    around them into the zone.
  - `BARRICADES` entries take an optional
    `{ face: [px, py], barrier: false }`.

- **2026-09-26 (18):** SIDEWALK CLOSED barricades are now 9 cm-thick panels
  (solid orange edges, slotted faces) with box collision, 1.1 m tall and
  see/shoot-through.

- **2026-09-27:** Two mid-block zebra crosswalks from the pink marks on
  `screenshot1.png`: across 14th St on the central mall (y 405) and across
  17th St at the walk to Nemzek's west door (y 302). Each sits on a plain
  asphalt patch so the dashed center line stops at the bars.

- **2026-09-27 (2):** Alex Nemzek Hall re-traced from `screenshot8nemzek.png`
  (fitted: map px = (px - 530) × 0.353 + 1450, (py - 267.5) × 0.353 + 302):
  - Hallway (blue) widened to ~6.3 m (y 297.2–306.8); the north blocks now end at 297.2.
  - The east inlet (red) is shallower (y 297.2–306.8); the east block starts right below it.
  - Nemzek Fieldhouse (purple) is now walk-in, from `gamenemzekfieldhouse.jpg` (the plan's
    bottom is west): a gray concrete indoor track, 185 m around the outer lane, with four
    lanes, around an NCAA men's court with ceiling-hung hoops, plus the plan's small rooms
    in the corners. Doors: V102–V105 out to the west (with walks to the 17th St sidewalk),
    C110 and C109 east into the open area, and C101 north into the hallway.
  - The open area (green) is walk-in: open to the hallway along its full width, with doors
    into the fieldhouse.

- **2026-09-27 (3):** Nemzek and the stadium, second pass:
  - The hallway is as wide as the inlet, and both reach the grandstand's north end (y 297.2–318).
    The Fieldhouse and the open area shift south to fit; the Fieldhouse now ends in line with
    the building's south side (y 433.4). The open area's ceiling is the hallway's height (7 m).
  - The Fieldhouse track sits where the plan shows it: off-center toward the west, with 3 lanes.
  - A concrete alley runs between the building and the back of the grandstand. The press box
    is narrower north–south (y 349–390).
  - Stadium: only the lanes are track surface. The infield is turf, with a darker event area
    inside the north curve, and the west straight's lanes run on as a squared-off chute north
    of the curve.

- **2026-09-27 (4):** Nemzek details:
  - The grandstand's north end reaches a little past the inlet's south edge (y 313).
  - Fieldhouse hoops are portable stanchions (`gamehoop.webp`, black padding): a padded base
    behind each baseline, an upright, and a boom out to the backboard.
  - The hallway's west and east entrances are 11 m wide, almost the hallway's width
    (`gamenemzekentrance.jpg`). The west one has a white overhang on two brick pillars and a
    wider walk from 17th St.
  - A "NEMZEK HALL" sign (`gamenemzeksign.jpg`) sits north of the entrance walk, facing south
    and square to the building: a cream panel on two brick pedestals.

- **2026-09-27 (5):** Kise (MSUM Dining) re-laid out from the annotations on `screenshot5.png`
  (fitted to the building's edges: map x = 718.5 + (px - 980) × 0.1486, y = 283.5 + (py - 138) × 0.1631)
  and `insidekiselookingnorth.png`:
  - A hallway (pink) runs down the west side from the north wall, reached through the glass entrance
    link (the northmost doorway), and opens into the dining room.
  - A new interior wall (green) closes off the kitchen side. The kitchen and the block north of the
    dining room are now solid (not walk-in).
  - Glass walls (light blue): the dining room's west side and most of its south side, clear up to
    3.4 m, with two new doors (purple) in the west glass. A short glass partition stands where the
    hallway meets the dining room. Glass is its own shared transparent material; it blocks
    movement but not sight.

- **2026-09-27 (6):** Kise second pass from the new `screenshot5.png` annotations:
  - Brick (red): the west wall between its two doors and at its south end.
    The interior glass partition is longer (to y 334.7) and ends in a short brick piece.
  - The hallway and dining room are single storey (ceiling 3.5 m, `KISE_CEILING_M`), and the glass runs up to it.
  - The yellow block is a raised clerestory (roof 8.2 m, ceiling ~7.9 m) built on the low roof.
    This uses the new optional raised-rect value on hollow buildings.
  - Adjusted:
    - The low ceiling is now 3.7 m and the raised ceiling 7.6 m (roof 8.5 m).
    - Kise roof slabs are now 0.9 m thick (new 9th hollow-building value), so they read as solid through the glass.

## Flags (not enough detail in the image; placeholder used)
- Z03 South House: footprint hidden under the Google Maps label. Placeholder 7 m house south of the lawn.
- Z03 service yard contents are unclear (containers or equipment). Two placeholder containers.
- Z15 facilities service yard contents are unclear (equipment and containers). Five placeholder boxes.
- Z21 Municipal Pool bathhouse: the interior and roof details aren't visible. Plain 5 m box placeholder, not enterable.
- Border rows (Z22–Z28): traced from `newborders.png`, which is a wider view
  than the other screenshots, so house footprints are approximate. The
  larger building west of 10th St (by the curved drive) and the Romkey Park
  shelter are placeholders.
- Z17 Nemzek Fieldhouse: the track follows the emergency plan's placement and proportions,
  which makes its outer lane ~146 m around. The 185 m real-life figure doesn't fit the plan's
  layout inside the hall. C109 falls just south of the green box, so the open area runs a few
  meters past it to include that door. C111 (south-east on the plan) opens into an unbuilt
  part of the interior, so it's left out.
