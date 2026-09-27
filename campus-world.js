// Campus world: the whole campus map -- layout data traced from the
// satellite screenshots in "5 nights at kise/making the map/", the scene
// built from it, and cheap local queries (collision, line of sight,
// walkability, local pathfinding). Shared by campus.html (the walk-only
// greybox) and index.html (the game's Campus map), so both always show the
// same campus. See CAMPUS_MAP_PROGRESS.md for how the layout was built.
//
// Usage: const world = buildCampusWorld(THREE, scene, renderer, options);
//   options.renderDistance / options.treeDrawDistance -- zone culling (m)
//   options.stepUpHeight -- ledges up to this tall are walked onto (m)
// Everything is added under world.root, so a game can hide the campus by
// toggling world.root.visible.
(function () {
  "use strict";

  function buildCampusWorld(THREE, scene, renderer, options = {}) {
    const root = new THREE.Group();
    root.name = "CampusWorld";
    scene.add(root);
    const RENDER_DISTANCE = options.renderDistance !== undefined ? options.renderDistance : 450;
    const TREE_DRAW_DISTANCE = options.treeDrawDistance !== undefined ? options.treeDrawDistance : 260;

    // ------------------------------------------------------------------
    // CAMPUS LAYOUT -- traced from the Google Maps satellite screenshots in
    // "5 nights at kise/making the map/":
    //   - "screenshot1.png" (1720 x 686) -- the coordinate
    //     system everything below uses: every rect is [x1, y1, x2, y2] in its
    //     pixels, and mapToWorld() converts to game units.
    //   - "screenshot3.png" -- same zoom, shifted exactly
    //     (+3, +3) px, reaching further east (8th Ave, 19th St, the municipal
    //     pool). Anything traced from it had 3 px subtracted from x and y.
    //   - "screenshot2.png" -- a 2x closer view of the central campus
    //     (A = x * 0.5 + 238, y * 0.5 + 202), used as a detail reference.
    //   - "firstedits.png" -- screenshot3 marked up with corrections
    //     (lot entrances, the walk west of G-1, the G-6 turnaround).
    //   - "screenshot4.png" -- closer zoom of 14th -> 20th
    //     Street; maps onto the main screenshot as x * 0.846 + 814,
    //     y * 0.846 - 2. Used for the 20th Street border, Nelson Hall, the
    //     tunnels, Public Safety and the Heating Plant block.
    // The map covers everything south of 5th Avenue South down to 9th
    // Avenue South, from 10th Street east to 20th Street -- campus,
    // athletics and the residential blocks between 5th and 6th Avenue.
    //
    // SCALE: 1 game unit = 1 meter, true to life (explicit request: no
    // shrinking to hit a target size -- the map is as big as it really is).
    // MAP_SCALE comes from the football field at Nemzek Stadium: its 109.7 m
    // end line to end line spans ~165 px, and its 48.8 m width ~77 px, so
    // ~0.66 m per screenshot pixel. The full map is ~1257 x 462 m; a street
    // block (11th -> 14th St is three) is ~128 m.
    // Building heights below are in meters directly.
    // ------------------------------------------------------------------
    const MAP_SCALE = 0.66;
    const MAP_CENTER_X = 948;
    const MAP_CENTER_Y = 345;
    // Walkable area, screenshot px. The borders (newborders.png) are the house
    // rows just past 5th Ave (north), 10th St (west) and 9th Ave (south); the
    // east edge is the railway fence past 20th St (RAIL_FENCE_X_PX below) --
    // the tracks themselves are walkable.
    const MAP_BOUNDS = [-58, -48, 1923.5, 736];
    const ROAD_WIDTH_PX = 14;

    // Street stretches that are torn up (screenshot6.png, orange box): the
    // asphalt is gone and the roadbed is sunk PIT_STEPS steps below the ground,
    // as bare dirt. Sidewalks along them are kept. Same format as ROADS.
    const CONSTRUCTION_ROADS = [
      [274, 175, 577.5, 175], // 6th Ave S, from east of 11th St to just past 13th St
    ];
    const PIT_STEP_M = 0.18;  // each step down (walkable -- see STEP_UP_HEIGHT)
    const PIT_STEPS = 2;
    const PIT_LEDGE_M = 0.7;  // width of each step's ledge

    // Streets as centerlines: [x1, y1, x2, y2, width px] (horizontal or
    // vertical; width defaults to ROAD_WIDTH_PX).
    const ROADS = [
      [-58, 8, 1790, 8],      // 5th Avenue South (ends in a cul-de-sac past 19th St -- see DRIVE_ARCS)
      // 6th Avenue South, split around the torn-up stretch (CONSTRUCTION_ROADS);
      // the pieces stop half a road width short so their ends meet the pit edge.
      [-58, 175, 267, 175],
      [584.5, 175, 1885, 175],
      [-58, 343, 232, 343],   // 7th Avenue South (ends at 11th Street)
      [-58, 680, 1722, 680],  // 9th Avenue South (ends at 19th St -- Romkey Park is grass beyond)
      [-58, 512, 8, 512],     // 8th Avenue South, west of 10th St (newborders.png)
      [1715, 495, 1885, 495], // 8th Avenue South (19th -> 20th Street)
      [8, -48, 8, 736],       // 10th Street South
      [232, -48, 232, 736],   // 11th Street South
      [815, -48, 815, 736],   // 14th Street South
      [1297, 8, 1297, 736],   // 17th Street South
      [1715, 495, 1715, 736], // 19th Street South (only south of 8th Ave -- fields north of it)
      [396, -48, 396, 161],   // 12th Street South (ends at the construction pit)
      [566.5, -48, 566.5, 161], // 13th Street South (screenshot6.png)
      [1160, -48, 1160, 175], // 16th Street South
      [1885, -48, 1885, 736, 18], // 20th Street South -- the east border
      // Short stretches past the border rows (newborders.png), each closed by
      // a barricade (BARRICADES):
      [398, 680, 398, 736],   // 12th St, south of 9th Ave
      [558, 680, 558, 736],   // 13th St, south of 9th Ave
      [695, -48, 695, 8, 8],  // alley north of 5th Ave, between 13th and 14th
      [986, -48, 986, 8],     // 15th St, north of 5th Ave
      [1318, -48, 1318, 8],   // 17th St, north of 5th Ave (jogs east of the south part)
      [1520, -48, 1520, 8],   // 18th St, north of 5th Ave
      [1438, 680, 1438, 736], // 18th St, south of 9th Ave
      [1688, -48, 1688, 175], // 19th St, from north of 5th Ave down to 6th Ave (between the soccer field and the houses)
    ];

    // Parking lots: flat, open, walkable.
    const LOTS = [
      [248, 30, 380, 160],    // north of 6th Ave, east of 11th St
      [30, 195, 215, 320, "z"], // Lot F (north) -- stall rows run north/south
      [30, 430, 95, 658],     // Lot F (south-west)
      [128, 505, 218, 658],   // lot south of Center for Business
      [604, 200, 665, 277, "z"], // Metered Parking M-5, between Lommen and Comstock (rows N-S)
      [290, 628, 395, 657, "x"], // Lot W-G
      [256, 512, 296, 541, "x"], // Z08: small lot between Bridges and Owens
      [556, 500, 788, 660, "z"], // big lot south of the mall (G-1), rows N-S
      [920, 198, 990, 262, "z"],  // G-6 (north of Nelson), rows N-S
      [990, 198, 1135, 262, "x"], // G-7 north (north of Holmquist), rows E-W
      [1136, 198, 1280, 400], // G-7 (east, around the Heating Plant) -- stops at the mall
      [838, 562, 1005, 660, "z"], // G-11, rows N-S
      [993, 490, 1050, 527],  // Z14: small lot east of Murray Hall
      [1062, 440, 1140, 660, "z"], // G-10 (west), rows N-S
      [1140, 500, 1164, 660, "z"], // G-10 middle (south of the tree strip)
      [1164, 420, 1194, 660, "z"], // G-10 east, along the Maintenance Building
      [1252, 420, 1280, 520, "z"], // parking beside the Maintenance Building
      // east of 17th Street
      [1385, 20, 1432, 150, "z"], // MSUM free parking F-1, rows N-S
      [1310, 198, 1500, 225], // lot north of Alex Nemzek Hall
    ];

    // Other ground surfaces, all flat and walkable:
    //   DIRT_AREAS   -- [x1, y1, x2, y2]
    //   DIRT_CIRCLES -- [centerX, centerY, radius px] (ball-field infields)
    //   DIRT_ARCS    -- [centerX, centerY, inner r, outer r, start deg, sweep deg]
    //                   (degrees counterclockwise on the screenshot, 0 = east)
    //   TRACKS       -- [x1, y1, x2, y2] running track as a capsule (round ends)
    //   TURF_AREAS   -- [x1, y1, x2, y2] stadium field
    //   GRASS_AREAS  -- [x1, y1, x2, y2] grass drawn on top of a lot (islands)
    const DIRT_AREAS = [
      // gravel alley behind the houses, 12th -> 14th St (screenshot7alley.png):
      // two pieces that stop at 13th St's curbs instead of crossing the road
      [403, 88.5, 559.5, 94.5], [573.5, 88.5, 808, 94.5],
      [1575, 652, 1635, 663], // Z20: bullpen strip behind the softball backstop
      [1674, 293, 1682, 302], // Z19: sand pits at the ends of the jump runways
      [1674, 447, 1682, 456],
    ];
    const DIRT_CIRCLES = [
      [1085, 95, 7],          // Z10: sandy patch in a backyard
      [1657, 627, 27],        // Nemzek softball infield
      // (the three practice diamonds east of the stadium are grass now -- firstedits.png)
    ];
    const DIRT_ARCS = [
      [1675, 648, 103.5, 108.5, 95, 85], // softball outfield warning track (centered on home plate)
    ];
    const TRACKS = [
      [1517, 240, 1637, 505], // Nemzek Stadium track
    ];
    // Natural-grass soccer pitches, long axis east/west: [x1, y1, x2, y2].
    const SOCCER_FIELDS = [
      [1443, 44, 1616, 140],  // MSUM women's soccer (close to the west fence, grass buffer on the east)
    ];
    // Straight rubber runways and pads (track surface): [x1, y1, x2, y2].
    const RUNWAYS = [
      [1660, 300, 1665, 452], // Z19: javelin / jump runways east of the stadium
      [1676, 302, 1680, 447],
      [1657, 295, 1668, 304], // throwing pad
      [1658, 448, 1666, 456],
    ];
    const TURF_AREAS = [
      [1540, 292, 1612, 455], // Scheels Field
    ];
    const POOLS = [
      [1785, 540, 1822, 611], // Moorhead Municipal Pool (lap pool, lanes run north/south)
    ];
    // Shallow pools and splash pads -- plain water, no lane lines.
    const WADING_POOLS = [
      [1800, 628, 1822, 641], // Z21: wading pool
    ];
    // Paved areas (same light concrete as the walkways).
    const PLAZAS = [
      [1478, 298, 1509, 318], // Nemzek: paved area at the north end of the stands, outside the inlet
      [1330, 298, 1450, 306], // Nemzek: hallway floor
      [1450, 298, 1478, 318], // Nemzek: the inlet in the building's east side (hallway's east door opens into it)
      [718.5, 283.5, 772, 391], // Z07: MSUM Dining's floor
      [711.8, 300.2, 718.5, 313.3], // Z07: entrance link floor
      [633, 272, 668, 297],   // Z07: paved plaza between the library, M-5 and Comstock's west door
      [633, 296, 638, 307.2], // Z07: plaza down to the library's north-east door
      [398, 525, 424, 592],   // Z08: paved court between Flora Frick, Grier and Roland Dille
      [245, 305, 300, 372],   // Z06: brick plaza at the Campus Gates
      [1757, 533, 1826, 651], // pool deck
    ];
    // Curved concrete walks: [centerX, centerY, radius px, width px, start deg,
    // sweep deg] (degrees counterclockwise on the screenshot, 0 = east).
    const PATH_ARCS = [
      [1079, 353, 6, 5, 0, 360], // Z13: round plaza south of Holmquist's courtyard
    ];
    // Curved drives (plain asphalt), same format as PATH_ARCS.
    const DRIVE_ARCS = [
      [1800, 8, 9, 18, 0, 360],     // 5th Ave's cul-de-sac east of 19th St (newborders.png)
      [952, 290, 26, 10, 180, 180], // Z12: car turnaround at the south end of G-6
    ];

    // Concrete walkways that run across a parking lot (drawn on top of it):
    // [x1, y1, x2, y2, width px].
    const LOT_WALKS = [
      // Z04: the walks crossing the 11th-12th St lot
      [280, 55, 280, 145, 4], [280, 92, 380, 92, 4],
    ];

    // Driveways and lot entrances: plain asphalt, no stall lines.
    const DRIVEWAYS = [
      // Z03
      [30, 360, 125, 430],    // service yard south of 7th Ave (storage, not parking)
      [120, 349, 130, 360],
      // Lot entrances marked in blue on firstedits.png (second round)
      [15, 414, 30, 428], [15, 503, 30, 517],       // Lot F south-west, off 10th St
      [71, 320, 86, 337], [132, 320, 146, 337],     // Lot F north, off 7th Ave
      [136, 182, 151, 196],                         // Lot F north, off 6th Ave
      [315, 158, 331, 168],                         // 11th-12th St lot, onto the 6th Ave dirt stretch
      [606, 182, 662, 201],                         // M-5, off 6th Ave (both sides of the divider)
      [955, 182, 969, 199], [1080, 182, 1094, 199], [1231, 182, 1245, 199], // G-6 / G-7, off 6th Ave
      [1280, 325, 1290, 339],                       // G-7 east, off 17th St
      [1304, 203, 1311, 217],                       // lot north of Nemzek, off 17th St
      [1485, 182, 1499, 199],                       // lot north of Nemzek, off 6th Ave
      [1388, 14, 1402, 21], [1388, 150, 1402, 168], // F-1, off 5th and 6th Ave
      // Z04
      [302, 15, 317, 30],
      // Z08: Bridges/Owens lot entrance off 11th St
      [239, 519, 256, 531],
      // Z15: Public Safety / facilities service yard (storage, not parking)
      [1194, 522, 1265, 660],
      // Z09: G-1 entrances -- one from 9th Ave, two from 14th St (firstedits.png)
      [637, 660, 653, 674], [788, 543, 808, 558], [788, 640, 808, 655],
      // Z12: G-6 extension south of the stalls, down to the turnaround
      [921, 262, 983, 290],
      // Z07: service drive north of Lommen, Kise Commons service yard
      [513, 198, 560, 226], [772, 305, 797, 382], [797, 352, 806, 362], // Dining service yard + its drive to 14th St
      // Z05: garage aprons onto the alley, and the paved lane in from 6th Ave
      [418, 80, 432, 87], [528, 80, 542, 87], [641, 79, 650.5, 87], [748, 80, 762, 87], [778, 80, 795, 87],
      [55, 656, 72, 674], [129, 656, 145, 674],
    ];
    const GRASS_AREAS = [
      // Z14: lawn island inside G-11
      [950, 588, 990, 625],
      // Z07: shrub planter in the plaza
      [635.5, 280, 650.3, 292.3],
      // Z12: grassy median down the G-6 extension into the turnaround
      [933, 264, 971, 290],
      // Z09: tree planters in the G-1 lot
      [632, 516, 638, 528], [632, 544, 638, 556], [632, 572, 638, 584],
      [650, 519, 656, 531], [650, 549, 656, 561], [650, 567, 656, 579], [678, 511, 688, 523],
      // Z07: planted divider down the M-5 lot
      [631, 203, 636, 255],
      // Z04: planted strips in the 11th-12th St lot
      [255, 40, 365, 50], [272, 132, 352, 142],
      // Z02: shrub strips across Lot F
      [45, 203, 205, 211], [45, 297, 175, 305],
      [1172, 329, 1224, 337], // islands in the lot around the Heating Plant
      [1156, 373, 1182, 381],
      [1262, 300, 1276, 318], // Z13: planted bump on the lot's east edge
      [1264, 344, 1283, 400], // Z13: lawn strip between the Heating Plant and 17th St
    ];

    // Sidewalks run along both sides of every road automatically (see
    // SIDEWALK_*). PATHS are the campus walkways traced from the satellite
    // view: [x1, y1, x2, y2, width px] (any angle; width defaults to
    // PATH_WIDTH_PX). Everything that isn't road, lot, path or building is grass.
    const PATH_WIDTH_PX = 5;
    const SIDEWALK_WIDTH_PX = 4;
    const SIDEWALK_GAP_PX = 1.5; // grass strip between curb and sidewalk
    const PATHS = [
      // the mall: one long east/west walk across the whole campus
      [240, 405, 815, 405, 9],
      [815, 405, 1290, 405, 9],
      // central quad (Hagen/Weld/Lommen -> mall): border, cross and diagonals
      [337, 285, 660, 285],   // walk along the south faces of Weld and Lommen
      [650.3, 291.4, 711.4, 314.1, 11], // broad paved walk from the plaza down past Comstock's wing to the Dining link
      [531, 287, 531, 405],
      // Z06 quad (traced from the close-up)
      [304, 285, 304, 405],
      [365, 240, 365, 405],
      [399, 273, 399, 405],
      [455, 285, 455, 405],
      [304, 343, 540, 343],
      [455, 368, 523, 368],
      [240, 325, 304, 325],   // Campus Gates plaza to the quad
      [304, 327, 361, 290],   // diagonals
      [361, 287, 427, 344],
      [427, 344, 387, 387],
      [387, 387, 365, 410],
      [427, 344, 495, 410],
      [528, 296, 478, 339],
      [236, 359, 304, 370],   // curving walk from the Campus Gates on 11th St...
      [304, 370, 365, 407],   // ...down to the mall
      [708.4, 312, 708.4, 405, 7], // walk between the library lawn and MSUM Dining (in its shadow), down to the mall
      [752, 391, 752, 405, 4], // Z07: MSUM Dining's door to the mall
      [657, 200, 657, 272, 4], // Z07: walk down Comstock's west side to the plaza
      [256, 506, 296, 512, 3], // Z08: walk along the north edge of the Bridges/Owens lot
      [290, 630, 423, 630],   // Z08: walk along the north edge of Lot W-G to Roland Dille
      [400, 407, 400, 423],   // Z08: mall to between MacLean and the Bookstore
      [446, 410, 446, 530],   // Z08: between the Bookstore/Grier and Roland Dille
      [550, 405, 550, 660],   // walk down the west edge of G-1, from the mall (firstedits.png)
      [551, 455, 600, 487],   // diagonal off it (the triangle in firstedits.png)
      [550, 487, 640, 487],   // walk along the north edge of G-1
      [765, 412, 720, 440],   // curving walk past the old Ballard Hall lawn
      [720, 440, 700, 470],
      [700, 470, 695, 505],
      // east of 14th Street
      [920, 262, 1135, 262],
      [1135, 262, 1135, 510],
      [918, 262, 918, 405],
      [888, 285, 918, 285],   // Z12: Dahl's east doors to the walk
      [888, 325, 918, 325],
      [822, 285, 860, 285],   // Z12: Dahl to 14th St
      [822, 322, 860, 322],
      [1000, 347, 1135, 347], // south of Holmquist
      [1079, 353, 1027, 405], // Holmquist lawn diagonals, from the round plaza
      [1079, 353, 1131, 405],
      [1079, 318, 1079, 430], // courtyard walk through to the mall
      [1027, 347, 1027, 405],
      [835, 410, 900, 440],   // mall to West Snarr
      [948, 410, 952, 440],   // Z14: curving walk from the mall past Murray...
      [952, 440, 968, 475],
      [968, 475, 1000, 495],  // ...to the lot east of Murray
      [1005, 492, 1060, 492],
      [1060, 440, 1060, 492],
      [922, 535, 1005, 535],  // Z14: walk along the north edge of G-11
      [913, 440, 913, 526, 4], // Z14: walk through the Snarr courtyard (no tunnel here)
      [900, 472, 913, 472, 4],  // West Snarr's east door to the courtyard walk
      [913, 526, 922, 540, 4],  // courtyard walk out between South and East Snarr
      [915, 535, 915, 562],   // Z14: between South and East Snarr down to G-11
      [1005, 530, 1005, 660],
      // east of 17th Street
      [1300, 443, 1510, 443], // south side of Alex Nemzek Hall
      [1311, 302, 1330, 302, 4], // 17th St sidewalk to the Nemzek hallway's west door
      [1500, 225, 1500, 300], // drive between Nemzek Hall and the stadium
      [95, 437, 215, 437],    // Z03: walk between the Newman Center and Center for Business
      [205, 437, 205, 490],   // Z03: east side of Center for Business
      [128, 490, 128, 505],   // Z03: Center for Business to the south lot
      // residential blocks between 5th and 6th Avenue
      // Z05: front walks from each house to the avenue sidewalk
      [427, 38, 427, 21, 2],
      [449, 38, 449, 21, 2],
      [472, 38, 472, 21, 2],
      [499, 38, 499, 21, 2],
      [533, 38, 533, 21, 2],
      [597, 38, 597, 21, 2],
      [617, 39, 617, 21, 2],
      [638, 38, 638, 21, 2],
      [670, 38, 670, 21, 2],
      [699, 38, 699, 21, 2],
      [750, 38, 750, 21, 2],
      [773, 38, 773, 21, 2],
      [429, 143, 429, 163, 2],
      [457, 143, 457, 163, 2],
      [480, 143, 480, 163, 2],
      [508, 143, 508, 163, 2],
      [538, 143, 538, 163, 2],
      [593, 143, 593, 163, 2],
      [621, 143, 621, 163, 2],
      [640, 143, 640, 163, 2],
      [661, 145, 661, 163, 2],
      [700, 125, 700, 163, 2],
      [726, 145, 726, 163, 2],
      [756, 143, 756, 163, 2],
      [785, 143, 785, 163, 2],
      // Z10: front walks
      [851, 33, 851, 21, 2],
      [874, 33, 874, 21, 2],
      [905, 33, 905, 21, 2],
      [933, 33, 933, 21, 2],
      [956, 33, 956, 21, 2],
      [986, 33, 986, 21, 2],
      [1018, 33, 1018, 21, 2],
      [1052, 33, 1052, 21, 2],
      [1085, 33, 1085, 21, 2],
      [853, 145, 853, 163, 2],
      [886, 145, 886, 163, 2],
      [921, 145, 921, 163, 2],
      [951, 145, 951, 163, 2],
      [986, 145, 986, 163, 2],
      [1016, 145, 1016, 163, 2],
      [1050, 145, 1050, 163, 2],
      [1082, 145, 1082, 163, 2],
      [1118, 145, 1118, 163, 2],
      [1120, 33, 1150, 33, 2],  // Z10: corner house to the 16th St sidewalk
      // Z11: front walks
      [1198, 29, 1198, 21, 2], [1250, 29, 1250, 21, 2], [1202, 147, 1202, 163, 2], [1250, 147, 1250, 163, 2],
      // border rows: a front walk from every house to its sidewalk
      [-42, -33, -42, -3, 2],
      [35, -18, 35, -3, 2],
      [69, -25, 69, -3, 2],
      [107, -25, 107, -3, 2],
      [144, -27, 144, -3, 2],
      [194, -24, 194, -3, 2],
      [271, -18, 271, -3, 2],
      [349, -22, 349, -3, 2],
      [444, -17, 444, -3, 2],
      [476, -25, 476, -3, 2],
      [525, -16, 525, -3, 2],
      [614, -24, 614, -3, 2],
      [652, -20, 652, -3, 2],
      [738, -20, 738, -3, 2],
      [783, -14, 783, -3, 2],
      [867, -15, 867, -3, 2],
      [937, -26, 937, -3, 2],
      [1021, -20, 1021, -3, 2],
      [1105, -15, 1105, -3, 2],
      [1197, -20, 1197, -3, 2],
      [1268, -15, 1268, -3, 2],
      [1362, -22, 1362, -3, 2],
      [1387, -22, 1387, -3, 2],
      [1426, -15, 1426, -3, 2],
      [1479, -26, 1479, -3, 2],
      [1547, -22, 1547, -3, 2],
      [1576, -26, 1576, -3, 2],
      [1611, -26, 1611, -3, 2],
      [1648, -25, 1648, -3, 2],
      [1722, -20, 1722, -3, 2],
      [1797, -24, 1797, -3, 2],
      [-26, 38, -3, 38, 2],
      [-30, 74, -3, 74, 2],
      [-22, 218, -3, 218, 2],
      [-30, 252, -3, 252, 2],
      [-26, 374, -3, 374, 2],
      [-34, 403, -3, 403, 2],
      [-24, 480, -3, 480, 2],
      [-30, 627, -3, 627, 2],
      [-14, 582, -3, 582, 3],
      [-45, 700, -45, 691, 2],
      [33, 704, 33, 691, 2],
      [58, 700, 58, 691, 2],
      [95, 701, 95, 691, 2],
      [184, 704, 184, 691, 2],
      [261, 704, 261, 691, 2],
      [290, 700, 290, 691, 2],
      [348, 703, 348, 691, 2],
      [432, 700, 432, 691, 2],
      [466, 702, 466, 691, 2],
      [520, 700, 520, 691, 2],
      [589, 702, 589, 691, 2],
      [618, 700, 618, 691, 2],
      [653, 702, 653, 691, 2],
      [690, 702, 690, 691, 2],
      [736, 703, 736, 691, 2],
      [770, 704, 770, 691, 2],
      [857, 700, 857, 691, 2],
      [892, 702, 892, 691, 2],
      [925, 704, 925, 691, 2],
      [961, 704, 961, 691, 2],
      [995, 704, 995, 691, 2],
      [1027, 704, 1027, 691, 2],
      [1065, 704, 1065, 691, 2],
      [1099, 704, 1099, 691, 2],
      [1163, 704, 1163, 691, 2],
      [1201, 704, 1201, 691, 2],
      [1246, 708, 1246, 691, 2],
      [1341, 700, 1341, 691, 2],
      [1372, 704, 1372, 691, 2],
      [1399, 710, 1399, 691, 2],
      [1471, 704, 1471, 691, 2],
      [1506, 706, 1506, 691, 2],
      [1543, 706, 1543, 691, 2],
      [1574, 700, 1574, 691, 2],
      [1608, 704, 1608, 691, 2],
      [1673, 710, 1673, 691, 2],
      [315, -18, 315, -3, 2], [-16, 134, -3, 134, 2], [-26, 279, -3, 279, 2], [-28, 307, -3, 307, 2],
      [-22, 427, -3, 427, 2], [-20, 539, -3, 539, 2], [131, 708, 131, 691, 2], [1638, 704, 1638, 691, 2],
      [724, 34, 724, 21, 2],
      // 1311's backyard walk (screenshot7alley.png): back door -> garage,
      // and from the alley gate out to the alley
      [641, 55.6, 639, 61.5, 1.6], [639, 61.5, 638.5, 67, 1.6], [638, 78, 638, 88.5, 1.6], [788, 37, 788, 21, 2],
      // municipal pool
      [1762, 505, 1762, 533],   // 8th Ave to the pool deck
      [1722, 590, 1757, 590, 5], // 19th St to the bathhouse entrance
    ];

    // Houses in the residential blocks between 5th and 6th Avenue, traced
    // from the satellite roofs (many are partly under trees, so these are
    // approximate). [x1, y1, x2, y2, height]: 7 m houses, 3.5 m garages.
    const HOUSES = [
      // 12th -> 14th Street, north row (facing 5th Ave)
      [420, 38, 435, 55, 7], [440, 38, 458, 55, 7], [463, 38, 482, 55, 7], [490, 38, 508, 55, 7],
      [525, 38, 542, 55, 7], [590, 38, 605, 55, 7], [610, 39, 625, 52, 7], [628, 38, 648, 55, 7], [660, 38, 680, 55, 7],
      [690, 38, 708, 55, 7], [712, 34, 736, 55, 7], [742, 38, 758, 55, 7], [765, 38, 779, 55, 7], [781, 37, 796, 50, 7],
      // 12th -> 14th Street, garages on the alley
      [591, 75, 605, 85, 3.5], [619, 71, 628, 81, 3.5],
      // back garages on the alley's south side (screenshot7alley.png)
      [592, 110, 606, 121, 3.5], [782, 97, 794, 107, 3.5],
      [418, 67, 432, 80, 3.5], [528, 67, 542, 80, 3.5], [641, 67.5, 650.5, 79, 3.5], // 1311's garage: roof only, not its shadow
      [748, 67, 762, 80, 3.5], [778, 67, 795, 80, 3.5],
      // 12th -> 14th Street, south row (facing 6th Ave)
      [418, 123, 440, 143, 7], [450, 123, 465, 143, 7], [470, 123, 490, 143, 7], [498, 123, 518, 143, 7],
      [528, 123, 548, 143, 7], [585, 123, 602, 143, 7], [612, 123, 630, 143, 7], [633, 123, 648, 143, 7],
      [654, 133, 669, 145, 7], [689, 112, 711, 125, 7], [714, 132, 738, 145, 7], [745, 123, 768, 143, 7],
      [775, 123, 795, 143, 7],
      // 14th -> 16th Street, north row
      [840, 33, 862, 60, 7], [864, 33, 884, 60, 7], [890, 33, 920, 60, 7], [923, 33, 944, 60, 7],
      [946, 33, 967, 60, 7], [973, 33, 1000, 60, 7], [1003, 33, 1033, 60, 7], [1037, 33, 1067, 60, 7],
      [1070, 33, 1100, 60, 7], [1110, 33, 1130, 70, 7],
      // 14th -> 16th Street, south row
      [843, 110, 863, 145, 7], [870, 110, 902, 145, 7], [910, 110, 933, 145, 7], [938, 110, 965, 145, 7],
      [973, 110, 1000, 145, 7], [1002, 110, 1030, 145, 7], [1038, 110, 1063, 145, 7], [1068, 110, 1097, 145, 7],
      [1103, 110, 1133, 145, 7],
      // 16th -> 17th Street
      [1181, 29, 1216, 53, 7], [1238, 29, 1262, 53, 7], [1181, 57, 1210, 81, 7], [1254, 59, 1272, 81, 5],
      [1181, 86, 1209, 110, 7], [1251, 89, 1279, 114, 7], [1186, 129, 1219, 147, 7], [1234, 129, 1266, 147, 7],
      // east side of 17th Street (north of 6th Ave)
      [1318, 28, 1350, 47, 7], [1318, 60, 1350, 80, 7], [1318, 92, 1350, 110, 7], [1320, 130, 1350, 150, 7],
      // east of the practice field
      [1703, 37, 1734, 60, 7], [1757, 23, 1783, 47, 7], [1800, 30, 1823, 53, 7], [1707, 73, 1730, 97, 7],
      [1800, 70, 1823, 87, 7], [1707, 107, 1733, 137, 7], [1757, 107, 1780, 127, 7], [1790, 133, 1823, 150, 7],
    ];

    // Border rows (newborders.png): the houses facing the map across 5th Ave
    // (north), 10th St (west) and 9th Ave (south). The imagery here is a
    // wider, lower-resolution view (see CAMPUS_MAP_PROGRESS.md), so these
    // footprints are approximate. [x1, y1, x2, y2, height]
    const BORDER_HOUSES = [
      // north of 5th Ave
      [-52, -47, -32, -33, 7], [24, -35, 46, -18, 7], [58, -40, 80, -25, 7], [94, -43, 120, -25, 7],
      [136, -42, 152, -27, 7], [182, -45, 206, -24, 7], [254, -40, 288, -18, 7], [338, -42, 360, -22, 7],
      [432, -45, 456, -17, 7], [462, -42, 490, -25, 7], [506, -36, 544, -16, 7], [598, -42, 630, -24, 7],
      [640, -38, 664, -20, 7], [726, -42, 750, -20, 7], [766, -32, 800, -14, 7], [850, -36, 884, -15, 7],
      [925, -46, 950, -26, 7], [1010, -42, 1032, -20, 7], [1094, -32, 1116, -15, 7], [1180, -42, 1214, -20, 7],
      [1254, -36, 1282, -15, 7], [1350, -46, 1374, -22, 7], [1378, -42, 1396, -22, 7], [1410, -32, 1442, -15, 7],
      [1466, -46, 1492, -26, 7], [1534, -42, 1560, -22, 7], [1562, -45, 1590, -26, 7], [1596, -42, 1626, -26, 7],
      [1636, -40, 1660, -25, 7], [1704, -42, 1740, -20, 7], [1776, -47, 1818, -24, 7],
      // west of 10th St
      [-48, 26, -26, 50, 7], [-50, 62, -30, 86, 7], [-46, 202, -22, 234, 7], [-52, 240, -30, 264, 7],
      [-48, 362, -26, 386, 7], [-54, 394, -34, 412, 7], [-46, 468, -24, 492, 7], [-50, 614, -30, 640, 7],
      [-44, 558, -14, 606, 9], // larger building with a curved drive (church?) -- placeholder
      // missed on the first pass (purple circles in newborders.png)
      [298, -44, 332, -18, 7], [-40, 118, -16, 150, 7], [-50, 268, -26, 290, 7], [-52, 296, -28, 318, 7],
      [-46, 414, -22, 440, 7], [-48, 526, -20, 552, 7], [116, 708, 146, 734, 7], [1624, 704, 1652, 732, 7],
      // south of 9th Ave
      [-56, 700, -34, 734, 7], [22, 704, 44, 727, 7], [46, 700, 70, 721, 7], [84, 701, 106, 722, 7],
      [170, 704, 198, 726, 7], [246, 704, 276, 732, 7], [278, 700, 302, 720, 7], [326, 703, 370, 721, 7],
      [418, 700, 446, 726, 7], [452, 702, 480, 726, 7], [504, 700, 536, 722, 7], [578, 702, 600, 730, 7],
      [604, 700, 632, 734, 7], [640, 702, 666, 730, 7], [678, 702, 702, 730, 7], [724, 703, 748, 726, 7],
      [758, 704, 782, 732, 7], [842, 700, 872, 726, 7], [882, 702, 902, 730, 7], [910, 704, 940, 734, 7],
      [946, 704, 976, 734, 7], [984, 704, 1006, 734, 7], [1012, 704, 1042, 734, 7], [1050, 704, 1080, 734, 7],
      [1086, 704, 1112, 734, 7], [1150, 704, 1176, 734, 7], [1186, 704, 1216, 734, 7], [1228, 708, 1264, 735, 7],
      [1322, 700, 1360, 730, 7], [1364, 704, 1380, 728, 7], [1386, 710, 1412, 735, 7], [1456, 704, 1486, 730, 7],
      [1492, 706, 1520, 734, 7], [1530, 706, 1556, 734, 7], [1562, 700, 1586, 730, 7], [1596, 704, 1620, 730, 7],
      [1656, 710, 1690, 735, 7],
    ];

    // ROAD CLOSED barricades (orange marks in newborders.png, built like
    // gamemapconstructionsign.jpg) on every street that leaves the map:
    // [x, y, line axis ("x" = the row runs east-west, across a north-south
    // street; "z" = runs north-south, across an avenue), road width px].
    const BARRICADES = [
      // north of 5th Ave
      [8, -33, "x", 14], [232, -33, "x", 14], [396, -35, "x", 14], [566.5, -40, "x", 14], [695, -35, "x", 8],
      [815, -31, "x", 14], [986, -31, "x", 14], [1160, -34, "x", 14], [1318, -31, "x", 14], [1520, -31, "x", 14],
      [1688, -31, "x", 14],
      [1719, 8, "z", 14],    // 5th Ave east of 19th St (toward the cul-de-sac)
      [1885, 131, "x", 18],  // 20th St north of 6th Ave
      // west of 10th St
      [-38, 8, "z", 14], [-38, 175, "z", 14], [-38, 343, "z", 14], [-30, 512, "z", 14], [-38, 680, "z", 14],
      // south of 9th Ave
      [8, 712, "x", 14], [232, 704, "x", 14], [398, 708, "x", 14], [558, 708, "x", 14], [815, 702, "x", 14],
      [1297, 711, "x", 14], [1438, 715, "x", 14], [1715, 716, "x", 14], [1885, 700, "x", 18],
      // Around the 6th Ave construction pit (CONSTRUCTION_ROADS): decoration
      // only -- no invisible barrier, and they face away from the pit toward
      // whoever is approaching. Options: { face: [px, py], barrier: false }.
      [264, 175, "z", 14, { face: [200, 175], barrier: false }],   // 6th Ave, from 11th St
      [588, 175, "z", 14, { face: [650, 175], barrier: false }],   // 6th Ave, from 14th St
      [396, 157, "x", 14, { face: [396, 100], barrier: false }],   // 12th St, from the north
      [566.5, 157, "x", 14, { face: [566.5, 100], barrier: false }], // 13th St, from the north
    ];

    // Buildings: [x1, y1, x2, y2, height in meters, color (optional)].
    // Solid, no interiors.
    const BUILDINGS = [
      // west of 11th Street
      [160, 371, 198, 436, 10],   // Newman Center (per the drop-off map; north of Center for Business)
      [107, 445, 198, 490, 12],   // Center for Business
      [98, 628, 118, 646, 7],     // South House -- placeholder, footprint hidden under the map label
      // central campus (11th -> 14th Street)
      [266, 201, 300, 310, 16],   // Hagen Hall (4 storeys)
      [300, 201, 354, 244, 13],   // Langseth Hall
      [354, 204, 371, 237, 9],    // Langseth Hall -- curved east wing
      [300, 244, 350, 289, 8],    // Langseth / Hagen glass-roofed connector
      [370, 243, 424, 271, 13],   // Weld Hall (main block)
      [381, 206, 410, 243, 16],   // Weld Hall (north wing, taller)
      [425, 201, 484, 271, 12],   // Lommen Hall (west)
      [484, 228, 585, 271, 12],   // Lommen Hall (south-east, below its courtyard)
      // Comstock + library corner re-traced from screenshot5B.png (the closest
      // view; A = px * 0.08732 + (624.1, 272.2)). The dark bands west of each
      // building there are shadows (morning sun from the east), not building.
      [668, 200, 787, 272, 12],   // Comstock Memorial Union (north part)
      [674.3, 272, 787, 283.6, 12], // Comstock -- down to where MSUM Dining joins
      [666.9, 272, 674.3, 279.7, 4], // Comstock west entrance vestibule (door on its south face)
      [674.3, 283.6, 701, 289.2, 6], // Comstock's angled one-storey south-west wing...
      [701, 283.6, 706.2, 296, 6],
      [558, 306, 622, 393, 14],   // Livingston Lord Library (west block)
      [622, 309, 633.3, 393, 8],  // lower roof between the two blocks (in the east block's shadow)
      [633.3, 307.2, 664.3, 393, 14], // Livingston Lord Library (east block)
      [638.1, 300.2, 660.8, 307.2, 14], // ...its north bump
      [664.3, 307.2, 669.5, 393, 5],  // ...and the low strip along its east side
      [539, 333, 558, 367, 8],    // Livingston Lord Library (lower west annex)
      [255, 377, 295, 462, 12],   // MacLean Hall (west wing)
      [295, 417, 400, 453, 12],   // MacLean Hall (main block)
      [400, 423, 440, 455, 8],    // MSUM Bookstore
      [327, 453, 380, 488, 10],   // MacLean -> Flora Frick link
      [297, 455, 327, 540, 12],   // Bridges Hall (MSUM Planetarium)
      [327, 488, 372, 530, 12],   // Flora Frick Hall
      [327, 528, 372, 557, 6],    // Flora Frick Hall -- low greenhouse annex
      [387, 490, 427, 523, 9],    // Grier Hall
      [452, 430, 535, 480, 12],   // Roland Dille Center for the Arts (north block)
      [452, 480, 535, 533, 12],   // Roland Dille (middle)
      [474, 480, 515, 533, 20],   // Roland Dille theater fly tower (the tall curved roof)
      [423, 533, 535, 648, 13],   // Roland Dille (south) / Center for the Arts
      [250, 543, 309, 600, 10],   // Owens Hall
      [309, 560, 324, 600, 8],    // Owens <-> King link
      [322, 557, 397, 612, 12],   // King Hall
      [713, 470, 768, 523, 10],   // Conlin Wellness Center (main)
      [735, 442, 768, 470, 10],   // Conlin Wellness Center (stepped north end)
      [768, 420, 785, 523, 8],    // Conlin Wellness Center (east wing along 14th St)
      [565, 605, 612, 652, 10],   // Hendrix Hall
      // east of 14th Street
      [860, 212, 885, 395, 18],   // Dahl Hall
      [885, 290, 907, 320, 12],   // Dahl Hall -- east wing
      [952, 343, 997, 375, 12],   // Grantham Hall
      [1040, 297, 1122, 314, 12], // Holmquist Hall (north)
      [1040, 314, 1053, 353, 12], // Holmquist Hall (west wing)
      [1107, 314, 1122, 353, 12], // Holmquist Hall (east wing)
      [857, 440, 900, 478, 16],   // West Snarr Hall
      [922, 445, 952, 525, 16],   // East Snarr Hall
      [958, 418, 987, 466, 10],   // Murray Commons (west block)
      [988, 422, 1033, 470, 10],  // Murray Hall
      [850, 520, 910, 550, 12],   // South Snarr Hall
      [1022, 535, 1056, 660, 22], // John Neumaier Hall
      [1232, 343, 1264, 398, 12], // Heating Plant
      [1197, 428, 1252, 520, 9],  // Maintenance Building
      [1226, 603, 1258, 628, 4.5], // Public Safety (low, single storey)
      [1224, 573, 1237, 594, 4],  // red-roofed outbuilding north of Public Safety
      // Tunnels -- the enclosed connectors between halls (solid here, not walkable).
      [900, 438, 922, 448, 3.5],  // West Snarr <-> East Snarr
      [860, 480, 870, 519, 3.5],  // West Snarr <-> South Snarr
      [1022, 301, 1040, 310, 3.5], // Nelson <-> Holmquist (right of Nelson)
      // east of 17th Street
      // Alex Nemzek Hall + Nemzek Fieldhouse: one connected building (roof
      // sections of different heights), with a narrow alley on its east side
      // between it and the stadium grandstand.
      // (the walk-through hallway between the fieldhouse and the hall, along
      // the blue line in screenshot4.png, is in HOLLOW_BUILDINGS)
      [1360, 233, 1478, 298, 18], // Nemzek Fieldhouse (north gym)
      [1330, 260, 1360, 298, 9],  // west wing
      [1335, 306, 1400, 437, 16], // west gym
      [1400, 306, 1450, 440, 12], // middle
      [1411, 352, 1446, 406, 17], // raised roof over the middle
      [1450, 318, 1478, 440, 13], // east block -- starts south of the inlet (the alley runs along its east side)
      [1683, 505, 1698, 515, 4],  // shed by the softball field
      [1683, 605, 1695, 640, 3.5], // softball storage building
      [1757, 545, 1776, 643, 5],  // Municipal Pool bathhouse (placeholder -- no interior)
      ...HOUSES,
      ...BORDER_HOUSES,
    ];

    // Hollow buildings you can walk into: [x1, y1, x2, y2, height m, door(s),
    // color (optional)], each door { side: "n"|"s"|"e"|"w", at: px along that
    // wall, width m, height m }. Built from walls + a roof, with a concrete
    // floor and door-size gaps.
    const HOLLOW_BUILDINGS = [
      // MSUM Dining (Kise Commons), joined to Comstock's south side. Doors: the
      // yellow dot in firstedits.png (south wall), and through from the glass
      // entrance link on its west side (blue in screenshot5B.png).
      [718.5, 283.5, 772, 391, 9, [
        { side: "s", at: 752, width: 1.8, height: 2.4 },
        { side: "w", at: 306.5, width: 3, height: 2.6 },
      ]],
      // Glass entrance link on Dining's west side: door on its south face (blue
      // in screenshot5B.png), open straight through into Dining on its east side.
      [711.8, 300.2, 718.5, 313.3, 4.5, [
        { side: "s", at: 714.8, width: 2, height: 2.4 },
        { side: "e", at: 306.5, width: 3, height: 2.6 },
      ]],
      // Alex Nemzek Hall hallway (blue line in screenshot4.png): a corridor
      // through the building from 17th St (west door) to the inlet in the
      // building's east side, just north of the stadium stands (east door).
      [1330, 298, 1450, 306, 7, [
        { side: "w", at: 302, width: 2.2, height: 2.6 },
        { side: "e", at: 302, width: 2.2, height: 2.6 },
      ]],
    ];
    const HOLLOW_WALL_M = 0.4;

    // Round buildings: [centerX, centerY, radius px, height in meters].
    const CYLINDER_BUILDINGS = [
      [1003, 302, 20, 30],        // Nelson Hall -- a tall round tower
    ];

    // Buildings that sit at an angle: [centerX, centerY, length px, width px,
    // height in meters, angle in degrees (counterclockwise on the screenshot)].
    // (The angled wing of Ballard Hall used to be the only entry -- Ballard is
    // gone now, its site is open lawn.)
    const ROTATED_BUILDINGS = [
      // ...the wing's slanted south face, (673.5, 289.3) -> (701, 298.4)
      [688.2, 291, 29, 6, 6, -18.3],
      // Nelson <-> Grantham tunnel: slants from Nelson's south-west side down to
      // Grantham's roofline, clear of the G-6 turnaround (screenshot4 + campus map.png)
      [984, 330, 29, 8, 3.5, 69],
    ];

    // ------------------------------------------------------------------
    // ZONES -- one per city block, bounded by the street grid (screenshot
    // px). They drive both the chunking (see the ZONES section of the scene)
    // and the zone-by-zone detailing process tracked in
    // CAMPUS_MAP_PROGRESS.md. A building/prop/tree belongs to the zone its
    // center falls in; the first matching rect wins where two touch.
    // ------------------------------------------------------------------
    const ZONES = [
      { id: "Z01", name: "10th-11th St, 5th-6th Ave", rect: [-5, -5, 232, 175] },
      { id: "Z02", name: "10th-11th St, 6th-7th Ave", rect: [-5, 175, 232, 343] },
      { id: "Z03", name: "10th-11th St, 7th-9th Ave", rect: [-5, 343, 232, 695] },
      { id: "Z04", name: "11th-12th St, 5th-6th Ave", rect: [232, -5, 396, 175] },
      { id: "Z05", name: "12th-14th St, 5th-6th Ave", rect: [396, -5, 815, 175] },
      { id: "Z06", name: "Central campus NW", rect: [232, 175, 523, 405] },
      { id: "Z07", name: "Central campus NE", rect: [523, 175, 815, 405] },
      { id: "Z08", name: "Central campus SW", rect: [232, 405, 523, 695] },
      { id: "Z09", name: "Central campus SE", rect: [523, 405, 815, 695] },
      { id: "Z10", name: "14th-16th St, 5th-6th Ave", rect: [815, -5, 1160, 175] },
      { id: "Z11", name: "16th-17th St, 5th-6th Ave", rect: [1160, -5, 1297, 175] },
      { id: "Z12", name: "East campus NW", rect: [815, 175, 1056, 405] },
      { id: "Z13", name: "East campus NE", rect: [1056, 175, 1297, 405] },
      { id: "Z14", name: "East campus SW", rect: [815, 405, 1056, 695] },
      { id: "Z15", name: "East campus SE", rect: [1056, 405, 1297, 695] },
      { id: "Z16", name: "17th-20th St, 5th-6th Ave", rect: [1297, -5, 1900, 175] },
      { id: "Z17", name: "Alex Nemzek Hall", rect: [1297, 175, 1500, 450] },
      { id: "Z18", name: "Nemzek Stadium", rect: [1500, 175, 1655, 450] },
      { id: "Z19", name: "East practice fields", rect: [1655, 175, 1900, 495] },
      { id: "Z20", name: "Softball field", rect: [1297, 450, 1715, 695] },
      { id: "Z21", name: "Municipal Pool", rect: [1715, 495, 1900, 695] },
      // Border rows (newborders.png)
      { id: "Z22", name: "North border, 10th-13th St", rect: [-70, -70, 600, -5] },
      { id: "Z23", name: "North border, 13th-17th St", rect: [600, -70, 1250, -5] },
      { id: "Z24", name: "North border, 17th-20th St", rect: [1250, -70, 1910, -5] },
      { id: "Z25", name: "West border, west of 10th St", rect: [-70, -5, -5, 695] },
      { id: "Z26", name: "South border, 10th-13th St", rect: [-70, 695, 600, 760] },
      { id: "Z27", name: "South border, 13th-17th St", rect: [600, 695, 1250, 760] },
      { id: "Z28", name: "South border, 17th-20th St", rect: [1250, 695, 1910, 760] },
    ];

    // Per-zone detail added by the refinement passes (Step 3):
    //   props      -- [x1, y1, x2, y2, height m, color, raised m (optional), "cyl"/"solid" (optional)]
    //                 ("solid": a raised prop that still collides, e.g. the press box)
    //                 small structures; raised ones float (crossbars, rooftop
    //                 stacks) and don't collide; "cyl" draws a round one
    //   bleachers  -- [x1, y1, x2, y2, top height m, steps, facing "n"|"s"|"e"|"w", color]
    //   trees      -- [x, y, kind]  kind "e" = evergreen, else deciduous
    //   treeRows   -- [x1, y1, x2, y2, spacing px, kind]
    //   fences     -- [x1, y1, x2, y2, height m, color] thin panels along a segment
    // Fenced areas. `fence` is the fence line (drawn as chain-link panels);
    // `outline` is the whole enclosed area as a polygon (the fence plus the
    // building faces that close it off), used to tell which side of a fence
    // a point is on. `gates` are always-open gates in the fence: a gap with
    // the gate leaf swung inward, at [x, y] on the fence line (green marks in
    // firstedits.png). `openings` are other ways in that aren't in the fence
    // (a doorway, an open end). Enemies only spawn on the far side of a fence
    // near one of these, and route through them (see findPath).
    const FENCE_HEIGHT_M = 2.4;
    const FENCE_COLOR = 0x8a9096;
    const GATE_WIDTH_M = 3.5;
    const GATE_SWING_DEG = 70;
    const FENCED_AREAS = [
      {
        name: "athletics", // Nemzek Stadium, the practice fields and softball
        fence: [[1478, 234], [1504, 234], [1504, 194], [1846, 194], [1846, 480], [1697, 480],
          [1697, 664], [1317, 664], [1317, 453], [1411, 453], [1411, 440]],
        outline: [[1478, 234], [1504, 234], [1504, 194], [1846, 194], [1846, 480], [1697, 480],
          [1697, 664], [1317, 664], [1317, 453], [1411, 453], [1411, 440], [1478, 440]],
        gates: [[1411, 446.5], [1497, 234], [1677.5, 664]],
        openings: [[1464, 310]], // the Nemzek hallway's east door opens (via the inlet) into the stadium
      },
      {
        name: "soccer", // two gates (dark pink in newborders.png)
        fence: [[1437, 22], [1672, 22], [1672, 160], [1437, 160], [1437, 22]],
        outline: [[1437, 22], [1672, 22], [1672, 160], [1437, 160]],
        gates: [[1520, 22], [1520, 160]],
        openings: [],
      },
      {
        name: "pool deck", // the bathhouse closes the west side; walk in from 8th Ave
        fence: null, // drawn in Z21's detail (a lower pool fence)
        outline: [[1768, 532], [1827, 532], [1827, 652], [1757, 652], [1757, 545], [1757, 532]],
        gates: [],
        openings: [[1762, 538]],
      },
    ];

    function pointInPolygon(x, y, poly) {
      let inside = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const [xi, yi] = poly[i], [xj, yj] = poly[j];
        if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
      }
      return inside;
    }

    // Fence polyline -> fence panels [x1, y1, x2, y2, height, color], with
    // a GATE_WIDTH_M gap at each gate and the gate leaf hinged at the gap's
    // far edge, swung GATE_SWING_DEG toward the inside of the area.
    function fencePanels(area) {
      const out = [];
      const gateWidthPx = GATE_WIDTH_M / MAP_SCALE;
      for (let i = 0; i + 1 < area.fence.length; i++) {
        const [ax, ay] = area.fence[i], [bx, by] = area.fence[i + 1];
        const len = Math.hypot(bx - ax, by - ay);
        const ux = (bx - ax) / len, uy = (by - ay) / len;
        // gates on this run, as distances along it
        const gaps = area.gates
          .map(([gx, gy]) => ({ t: (gx - ax) * ux + (gy - ay) * uy, off: Math.abs((gx - ax) * -uy + (gy - ay) * ux) }))
          .filter((g) => g.off < 1 && g.t > 0 && g.t < len)
          .map((g) => ({
            t0: Math.max(0, g.t - gateWidthPx / 2),
            t1: Math.min(len, g.t + gateWidthPx / 2),
          }))
          .sort((a, b) => a.t0 - b.t0);
        let cursor = 0;
        for (const g of gaps) {
          if (g.t0 > cursor) out.push([ax + ux * cursor, ay + uy * cursor, ax + ux * g.t0, ay + uy * g.t0]);
          // leaf: hinged at the gap's end, swung toward the inside
          const hx = ax + ux * g.t1, hy = ay + uy * g.t1;
          const probe = 1.5; // px
          const insideIsLeft = pointInPolygon(hx - ux * 2 - uy * probe, hy - uy * 2 + ux * probe, area.outline);
          const sideSign = insideIsLeft ? 1 : -1;
          const a = (GATE_SWING_DEG * Math.PI) / 180;
          // rotate (-u) toward the inside normal
          const lx = -ux * Math.cos(a) + -uy * sideSign * Math.sin(a);
          const ly = -uy * Math.cos(a) + ux * sideSign * Math.sin(a);
          const leaf = g.t1 - g.t0;
          out.push([hx, hy, hx + lx * leaf, hy + ly * leaf]);
          cursor = g.t1;
        }
        if (cursor < len) out.push([ax + ux * cursor, ay + uy * cursor, bx, by]);
      }
      return out.map((f) => [...f, FENCE_HEIGHT_M, FENCE_COLOR]);
    }
    const fencedArea = (name) => FENCED_AREAS.find((a) => a.name === name);

    const ZONE_DETAIL = {
      // Z01 is an open lawn now (the lot was removed) -- no detail.
      Z02: {
        treeRows: [
          [90, 190, 210, 190, 16],   // along 6th Ave
          [24, 200, 24, 315, 14],    // along 10th St
          [217, 185, 217, 330, 13],  // along 11th St
          [35, 322, 215, 322, 15],   // along 7th Ave
          [55, 207, 195, 207, 20],   // north shrub strip
          [55, 301, 165, 301, 20],   // south shrub strip
        ],
      },
      Z03: {
        treeRows: [
          [40, 357, 115, 357, 15],   // 7th Ave, in front of the service yard
          [135, 357, 220, 357, 15],  // 7th Ave, in front of the Newman Center
          [22, 445, 22, 655, 16],    // along 10th St
          [218, 390, 218, 500, 14],  // along 11th St
          [30, 663, 218, 663, 16],   // along 9th Ave
        ],
        trees: [[100, 452], [100, 478], [105, 545], [110, 585], [100, 612]],
        props: [
          [90, 383, 100, 393, 2.6, 0x5b7fa6], // storage containers in the service yard
          [57, 413, 70, 420, 2.5, 0x8a8f96],
        ],
      },
      Z04: {
        treeRows: [
          [252, 25, 298, 25, 12],    // along 5th Ave, west of the entrance
          [320, 25, 378, 25, 12],    // along 5th Ave, east of the entrance
          [258, 45, 362, 45, 12],    // north planted strip
          [276, 137, 348, 137, 12],  // south planted strip
          [382, 40, 382, 155, 14],   // along 12th St
          [247, 50, 247, 150, 20],   // along 11th St
          [255, 162, 378, 162, 13],  // along 6th Ave (the dirt stretch)
        ],
      },
      Z06: {
        treeRows: [
          [246, 200, 246, 300, 12],  // along 11th St, beside Hagen
          [246, 378, 246, 400, 11],
        ],
        trees: [
          // quad, north half
          [318, 300], [326, 318], [345, 300], [355, 325], [385, 305], [380, 330], [415, 300],
          [440, 312], [410, 332], [470, 300], [495, 305], [505, 325], [470, 330], [440, 278],
          // quad, south half
          [315, 360], [330, 385], [345, 375], [380, 360], [410, 372], [420, 395], [442, 382],
          [470, 385], [500, 380], [510, 396], [345, 396],
          // the quad is heavily wooded in the photo -- infill
          [330, 305], [372, 318], [425, 322], [452, 300], [485, 320], [512, 310],
          [325, 352], [360, 352], [395, 353], [455, 352], [485, 355], [515, 358],
          [360, 396], [395, 398], [455, 398], [485, 398],
          // by the Campus Gates
          [258, 380], [285, 385],
        ],
        props: [
          [245, 349, 248, 352, 3.2, 0x8b4a3c], // Campus Gates brick pillars at the 11th St entrance
          [245, 366, 248, 369, 3.2, 0x8b4a3c],
        ],
      },
      Z07: {
        treeRows: [
          [540, 294, 650, 294, 12],  // between the Lommen walk and the library
          [796, 205, 796, 290, 12],  // along 14th St, east of Comstock
          [555, 192, 600, 192, 12],  // along 6th Ave
          [690, 192, 785, 192, 14],
          [633, 210, 633, 250, 10],  // M-5 divider
          [560, 398, 660, 398, 14],  // south of the library, along the mall
        ],
        props: [
          // doors (blue in screenshot5B.png): dark glass panels on the walls
          [633.6, 307, 637.4, 307.3, 2.4, 0x2b3a48],   // library, north-east door
          [668.3, 279.7, 672.5, 280, 2.4, 0x2b3a48],   // Comstock west entrance
        ],
        trees: [
          [650, 215], [650, 237], [650, 258],          // flowering trees beside Comstock
          [641, 285], [647, 288],                      // plaza planter
          [627, 284], [628, 299],                      // west of the plaza
          [710.6, 288.8],                              // courtyard between the wing and Dining
          [676.5, 310.5], [683.5, 313], [689.6, 315.6], // flowering trees along the walk
          [678, 319], [674, 324], [686, 322], [690.5, 327], [678.3, 330], [700, 326], [671, 316], [671, 332], // library lawn
          [715, 329],
          [575, 205], [590, 220],                      // lawn east of Lommen
          [695, 342], [686, 366], [700, 392],          // lawn between the library and MSUM Dining
          [800, 300], [800, 330], [790, 395],          // east of MSUM Dining
        ],
      },
      Z08: {
        treeRows: [
          [245, 662, 520, 662, 14],  // along 9th Ave
        ],
        trees: [
          [395, 468], [415, 472],                 // courtyard south of MacLean / the Bookstore
          [250, 470], [265, 490], [245, 535], [282, 538], [317, 550], // lawn west of Bridges
          [255, 620], [275, 632],                 // west of Lot W-G
          [415, 605], [418, 622],                 // south-west of Roland Dille
        ],
      },
      Z09: {
        treeRows: [
          [796, 425, 796, 655, 14],  // along 14th St
          [560, 663, 800, 663, 14],  // along 9th Ave
        ],
        trees: [
          // the old Ballard Hall site -- open lawn with its trees kept
          [575, 455], [595, 470], [620, 455], [630, 480], [580, 490], [705, 462], [545, 450], [550, 480],
          // G-1 planters
          [635, 522], [635, 550], [635, 578], [653, 525], [653, 555], [653, 573], [683, 517],
        ],
      },
      Z10: {
        treeRows: [
          [822, 26, 1150, 26, 13],   // boulevard trees along 5th Ave
          [822, 156, 1150, 156, 13], // along 6th Ave
          [829, 40, 829, 140, 14],   // along 14th St
          [1147, 40, 1147, 140, 14], // along 16th St
        ],
        trees: [
          // backyards (dense canopy in the photo)
          [846, 71], [865, 78], [890, 71], [906, 78], [932, 75], [957, 73], [969, 79], [998, 76], [1014, 74],
          [1040, 71], [1063, 73], [1088, 76], [1107, 77], [1127, 81], [841, 98], [861, 101], [885, 101], [908, 93],
          [932, 94], [954, 100], [975, 91], [1000, 91], [1016, 93], [1038, 95], [1065, 96], [1104, 96], [1133, 99],
        ],
      },
      Z11: {
        treeRows: [
          [1172, 26, 1285, 26, 13],
          [1172, 156, 1285, 156, 13],
          [1173, 40, 1173, 140, 14], // along 16th St
          [1281, 40, 1281, 140, 14], // along 17th St
        ],
        trees: [[1225, 65], [1240, 80], [1228, 100], [1242, 115], [1222, 120]],
      },
      Z12: {
        treeRows: [
          [828, 300, 828, 395, 14],  // along 14th St
          [830, 191, 915, 191, 13],  // along 6th Ave
        ],
        trees: [
          [835, 200], [848, 222], [838, 240],                  // north of Dahl
          [895, 220], [906, 240], [893, 260], [910, 275], [896, 345], [910, 365], [898, 390],
          [944, 272], [952, 300],                              // median and island of the G-6 turnaround
        ],
      },
      Z13: {
        treeRows: [
          [1281, 200, 1281, 330, 13], // along 17th St
          [1062, 191, 1285, 191, 14], // along 6th Ave
        ],
        trees: [
          [1060, 325], [1070, 340], [1092, 322], [1098, 340], // Holmquist courtyard
          [1176, 333], [1190, 333], [1213, 333], [1170, 377], // lot islands
          [1255, 265], [1269, 309], // shade trees on the islands
          [1281, 350], [1281, 380],
        ],
        props: [
          // Heating Plant rooftop stacks: 3 red in a line down the east side of
          // the roof, and a white one continuing the line in the south-east
          // corner -- each ~5 m tall, ~1.4 m across
          [1256.9, 347.9, 1259.1, 350.1, 5, 0xa33a2c, 12, "cyl"],
          [1256.9, 359.9, 1259.1, 362.1, 5, 0xa33a2c, 12, "cyl"],
          [1256.9, 371.9, 1259.1, 374.1, 5, 0xa33a2c, 12, "cyl"],
          [1256.9, 390.9, 1259.1, 393.1, 5, 0xeeeeee, 12, "cyl"],
        ],
      },
      Z14: {
        treeRows: [
          [828, 415, 828, 560, 14],  // along 14th St
          [840, 663, 1010, 663, 14], // along 9th Ave
          [1010, 540, 1010, 655, 14], // between G-11 and Neumaier
        ],
        trees: [
          [880, 490], [888, 503], [895, 485], [878, 512], [843, 480], [845, 505],  // lawn between the Snarr halls
          [960, 480], [975, 500], [962, 510], [985, 515], [940, 470], [940, 500],  // lawn west of Murray
          [900, 425], [925, 422], [1040, 480],                   // north of the Snarr halls
          [958, 596], [980, 606], [966, 618],                                     // G-11 lawn island
          [1060, 560], [1060, 600], [1060, 640],                                  // east of Neumaier
        ],
      },
      Z15: {
        treeRows: [
          [1150, 425, 1150, 495, 10], // the tree strip north of G-10 middle
          [1281, 420, 1281, 660, 13], // along 17th St
          [1272, 530, 1272, 655, 14], // yard's east edge
          [1065, 663, 1280, 663, 15], // along 9th Ave
        ],
        trees: [[1160, 440], [1158, 470]],
        props: [
          // service yard clutter -- placeholders (see Flags)
          [1200, 530, 1216, 537, 2.6, 0x5b7fa6], [1200, 541, 1216, 548, 2.6, 0x7a6a55],
          [1240, 535, 1256, 542, 2.6, 0x8a8f96], [1244, 552, 1258, 566, 3, 0x9a9a9a],
          [1204, 575, 1212, 590, 2.4, 0x8a8f96],
        ],
      },
      Z16: {
        treeRows: [
          [1450, 30, 1662, 30, 9, "e"],   // evergreen windbreak, north side of the pitch
          [1450, 152, 1662, 152, 9, "e"], // south side
          [1662, 38, 1662, 146, 9, "e"],  // east side (no trees on the F-1 / west side)
          [1360, 30, 1360, 150, 12],      // between the 17th St houses and F-1
          [1312, 160, 1430, 160, 14],     // along 6th Ave
        ],
        trees: [
          [1745, 75], [1760, 95], [1785, 60], [1745, 140], [1790, 110], [1850, 60], [1840, 120], [1705, 150],
        ],
        props: [
          // soccer goals: two posts + a raised crossbar each
          [1442.75, 86.3, 1443, 86.55, 2.44, 0xf2f2f2],
          [1442.75, 98.45, 1443, 98.7, 2.44, 0xf2f2f2],
          [1442.75, 86.3, 1443, 98.7, 0.18, 0xf2f2f2, 2.44],
          [1616, 86.3, 1616.25, 86.55, 2.44, 0xf2f2f2],
          [1616, 98.45, 1616.25, 98.7, 2.44, 0xf2f2f2],
          [1616, 86.3, 1616.25, 98.7, 0.18, 0xf2f2f2, 2.44],
        ],
        // chain-link fence around the soccer field (see FENCED_AREAS)
        fences: fencePanels(fencedArea("soccer")),
      },
      Z17: {
        treeRows: [
          [1312, 232, 1312, 438, 13], // along 17th St
          [1375, 228, 1375, 258, 12], // between the west wing and the fieldhouse
        ],
        trees: [[1320, 265], [1322, 290], [1490, 460], [1310, 455]],
      },
      Z18: {
        bleachers: [
          // west grandstand (20 walkable steps), open to the sky -- press box below
          [1485, 318, 1509, 440, 10, 20, "e", 0x9da3aa], // starts south of the NE inlet
          [1637, 340, 1652, 415, 4, 8, "w", 0x9da3aa], // east bleachers
        ],
        props: [
          [1515, 195, 1528, 210, 3.5, 0xc9c2b3],      // ticket booth north of the track
          // Press box (standspressbox.png): a white two-level box perched on the
          // back rows on red steel columns, in front of a brick back wall.
          [1483.4, 318.3, 1484.9, 439.7, 11.5, 0xa0523f], // brick back wall just behind the top row (no shared faces -> no flicker)
          [1486, 347, 1495, 398, 3, 0xf1f1ee, 10, "solid"],    // lower level
          [1485, 344, 1497, 401, 3.2, 0xf6f6f3, 13, "solid"],  // upper level, overhanging
          [1497, 346, 1497.3, 399, 1.1, 0x2d3440, 14.2], // window band (east face)
          [1495.3, 346, 1495.6, 396, 0.9, 0x2d3440, 11.2], // lower windows
          [1495, 345, 1496, 346, 13, 0xb3302a], [1495, 360, 1496, 361, 13, 0xb3302a],
          [1495, 384, 1496, 385, 13, 0xb3302a], [1495, 399, 1496, 400, 13, 0xb3302a], // red columns
          [1488, 350, 1489, 351, 1, 0xdddddd, 16.2], [1488, 372, 1489, 373, 1, 0xdddddd, 16.2],
          [1488, 394, 1489, 395, 1, 0xdddddd, 16.2], // rooftop lights
          // stadium light towers: poles + raised light banks
          [1512, 262, 1514, 264, 22, 0x777777], [1512, 470, 1514, 472, 22, 0x777777],
          [1655, 262, 1657, 264, 22, 0x777777], [1655, 470, 1657, 472, 22, 0x777777],
          [1510, 260, 1516, 266, 2, 0xdddddd, 22], [1510, 468, 1516, 474, 2, 0xdddddd, 22],
          [1653, 260, 1659, 266, 2, 0xdddddd, 22], [1653, 468, 1659, 474, 2, 0xdddddd, 22],
          // goalposts (uprights + raised crossbar) at each end line
          [1575.8, 291.8, 1576.2, 292.2, 3.05, 0xf2d33a], [1575.8, 454.8, 1576.2, 455.2, 3.05, 0xf2d33a],
          [1571.75, 291.8, 1580.25, 292.2, 0.15, 0xf2d33a, 3.05], [1571.75, 454.8, 1580.25, 455.2, 0.15, 0xf2d33a, 3.05],
          [1571.75, 291.8, 1572.05, 292.2, 6, 0xf2d33a, 3.05], [1579.95, 291.8, 1580.25, 292.2, 6, 0xf2d33a, 3.05],
          [1571.75, 454.8, 1572.05, 455.2, 6, 0xf2d33a, 3.05], [1579.95, 454.8, 1580.25, 455.2, 6, 0xf2d33a, 3.05],
        ],
        trees: [[1650, 250], [1652, 290], [1650, 440], [1530, 225]],
      },
      Z19: {
        treeRows: [
          [1853, 200, 1853, 470, 9, "e"], // evergreen windbreak along 20th St, just outside the fence
          [1720, 474, 1850, 474, 13],     // along 8th Ave
        ],
        trees: [[1700, 440], [1712, 455], [1745, 465], [1845, 200]],
        // Chain-link fence around the athletic fields, with its three open
        // gates (see FENCED_AREAS): 6th Ave -> 20th St -> 8th Ave -> 19th St
        // -> 9th Ave -> 17th St -> Nemzek, stopping at the white line in
        // screenshot4.png, short of the stands.
        fences: fencePanels(fencedArea("athletics")),
        props: [
          [1697, 400, 1703, 418, 3, 0xd9d6cc], // equipment shed
        ],
      },
      Z20: {
        treeRows: [
          [1312, 460, 1312, 660, 14], // along 17th St
          [1310, 666, 1570, 666, 16], // along 9th Ave (the old tennis court site is grass now)
          [1700, 470, 1700, 600, 12], // along 19th St
        ],
        trees: [[1500, 470], [1520, 505], [1655, 520], [1640, 505]],
        // outfield fence just outside the warning track
        fences: Array.from({ length: 24 }, (_, i) => {
          const at = (k) => {
            const a = ((95 + (85 * k) / 24) * Math.PI) / 180;
            return [1675 + Math.cos(a) * 109.5, 648 - Math.sin(a) * 109.5];
          };
          return [...at(i), ...at(i + 1), 1.8, 0x3a5a40];
        }),
        props: [
          [1645, 652, 1658, 658, 2.6, 0xa0362f], // dugouts behind home plate
          [1633, 660, 1650, 665, 2.5, 0x8a8f96],
          [1669, 650, 1682, 652, 4, 0x777777],   // backstop
          [1683, 520, 1693, 528, 2.5, 0xd9d6cc], // equipment boxes
        ],
      },
      Z22: {
        treeRows: [[-50, -8, 600, -8, 14]], // boulevard trees, north side of 5th Ave
        trees: [[-10, -44], [70, -46], [160, -46], [220, -44], [305, -46], [390, -46], [410, -44], [500, -46], [570, -44]],
      },
      Z23: {
        treeRows: [[600, -8, 1250, -8, 14]],
        trees: [[680, -46], [715, -40], [790, -46], [900, -44], [960, -40], [1060, -44], [1135, -46], [1230, -44]],
      },
      Z24: {
        treeRows: [[1250, -8, 1780, -8, 14]],
        trees: [[1300, -44], [1345, -12], [1450, -12], [1505, -44], [1610, -12], [1670, -44], [1760, -40], [1850, -30], [1850, 20]],
      },
      Z25: {
        treeRows: [[-8, 20, -8, 670, 14]], // boulevard trees, west side of 10th St
        trees: [[-44, 120], [-40, 150], [-50, 290], [-44, 320], [-50, 440], [-44, 540], [-52, 660]],
      },
      Z26: {
        treeRows: [[-50, 696, 600, 696, 14]], // boulevard trees, south side of 9th Ave
        trees: [[120, 718], [140, 730], [215, 726], [310, 730], [385, 730], [490, 732], [560, 730]],
      },
      Z27: {
        treeRows: [[600, 696, 1250, 696, 14]],
        trees: [[715, 732], [800, 728], [832, 730], [1125, 726], [1140, 730]],
      },
      Z28: {
        treeRows: [[1250, 696, 1712, 696, 14]], // boulevard trees along 9th Ave (it ends at 19th St)
        trees: [[1280, 730], [1420, 730], [1528, 700], [1640, 728],
          // Romkey Park: scattered, not in rows
          [1777, 695], [1826, 691], [1808, 705], [1737, 711], [1738, 692], [1792, 726], [1822, 732], [1874, 690], [1857, 701], [1824, 705], [1810, 691], [1796, 702], [1847, 720], [1807, 728], [1837, 701], [1832, 715]],
        props: [
          [1746, 700, 1778, 724, 4, 0x8a6a4c], // Romkey Park picnic shelter (placeholder)
        ],
      },
      Z21: {
        treeRows: [
          [1730, 515, 1730, 575, 12], // along 19th St
          [1730, 625, 1730, 668, 12],
          [1790, 517, 1860, 517, 14], // along 8th Ave
        ],
        trees: [[1840, 545], [1852, 580], [1840, 615], [1855, 650], [1745, 665], [1800, 668]],
        // chain-link fence around the deck (the bathhouse closes the west side)
        fences: [
          [1768, 532, 1827, 532, 1.8, 0x7d8388],
          [1827, 532, 1827, 652, 1.8, 0x7d8388],
          [1827, 652, 1757, 652, 1.8, 0x7d8388],
        ],
        props: [
          [1783, 612, 1785, 614, 3.5, 0xdddddd], // lifeguard chair + diving board
          [1802, 611, 1804, 616, 1, 0xdddddd],
        ],
      },
      Z05: {
        // 1311's backyard fence (white lines in screenshot7alley.png): a
        // chest-high white fence from the house down to the alley and back
        // up to the garage, with two open gates (pink): one by the alley,
        // one at the north-east corner by the house. Each gate's leaf is
        // swung inward, same as the field gates.
        fences: [
          [630, 54.8, 630, 78], [630, 78, 636.3, 78],   // west side (from the house's back wall) + south run to the alley gate
          [636.3, 78, 637.8, 75.3],                     // alley gate leaf, swung in
          [639.5, 78, 641.3, 78],                       // stub to the garage's west wall
          [650.5, 54.8, 650.5, 67.7],                   // east side, house corner -> garage's north-east corner
          [650.5, 55, 649.2, 56.9],                     // north-east gate leaf (between the house and the east side), swung in
        ].map((f) => [...f, 1.3, 0xeae6dc]),
        treeRows: [
          [402, 28, 810, 28, 12],    // boulevard trees along 5th Ave
          [402, 155, 810, 155, 13],  // boulevard trees along 6th Ave
        ],
        trees: [
          // backyards north of the alley (clear of the garages)
          [450, 66], [472, 70], [500, 64], [556, 68], [580, 72], [612, 66], [668, 70], [700, 66], [722, 72], [805, 64],
          // backyards south of the alley
          [410, 108], [442, 112], [472, 106], [502, 114], [532, 108], [590, 110], [620, 104],
          [652, 112], [684, 106], [716, 112], [752, 104], [790, 110],
        ],
      },
    };

    // Spawn: inside Kise (MSUM Dining), facing north.
    const SPAWN_PX = { x: 745, y: 350 };

    function mapToWorld(px, py) {
      return { x: (px - MAP_CENTER_X) * MAP_SCALE, z: (py - MAP_CENTER_Y) * MAP_SCALE };
    }

    // Every building as a collider: center, half-extents and rotation
    // (cos/sin of its yaw), plus a world AABB for zone bounds.
    function makeCollider(cx, cz, halfX, halfZ, height, yaw) {
      const cos = Math.cos(yaw);
      const sin = Math.sin(yaw);
      const extentX = Math.abs(cos) * halfX + Math.abs(sin) * halfZ;
      const extentZ = Math.abs(sin) * halfX + Math.abs(cos) * halfZ;
      return {
        cx, cz, halfX, halfZ, height, yaw, cos, sin,
        minX: cx - extentX, maxX: cx + extentX, minZ: cz - extentZ, maxZ: cz + extentZ,
      };
    }

    // ------------------------------------------------------------------
    // BUILDING STYLES. Everything inside the campus core (6th Ave, 9th Ave,
    // 10th St, 20th St) is brick; everything outside it is a single-storey
    // house: painted walls + a pitched roof. A house's look is picked once,
    // from a seeded random keyed on its position, so it never changes.
    // ------------------------------------------------------------------
    const CAMPUS_CORE_PX = [8, 175, 1885, 680];
    function isInsideCampusCore(px, py) {
      return px > CAMPUS_CORE_PX[0] && px < CAMPUS_CORE_PX[2] && py > CAMPUS_CORE_PX[1] && py < CAMPUS_CORE_PX[3];
    }
    // Wall colors: [color, weight] -- maroon is the rare accent.
    const HOUSE_WALL_COLORS = [
      [0xb8bcbe, 22], // light gray
      [0x5e6367, 18], // dark gray
      [0xb7b495, 22], // light greenish-tan
      [0x37475d, 15], // dark blue
      [0xe9e7e0, 18], // corporate white
      [0x6a2a2c, 5],  // dark maroon red
    ];
    const HOUSE_ROOF_COLORS = [0x3b3b3d, 0x4a4540, 0x2f3134, 0x5a5048, 0x454a4f]; // asphalt shingles
    const HOUSE_ROOF_PITCHES = [0.33, 0.42, 0.5, 0.58];  // rise / run
    const HOUSE_WALL_HEIGHT_M = 3.0;
    const GARAGE_WALL_HEIGHT_M = 2.6;
    const HOUSE_ROOF_OVERHANG_M = 0.4;
    const HOUSE_ROOF_MAX_HEIGHT_M = 3.6;
    function styleAsHouse(c) {
      const rand = seededRandom(Math.round(c.px * 131 + c.py * 7919));
      const total = HOUSE_WALL_COLORS.reduce((sum, [, w]) => sum + w, 0);
      let roll = rand() * total;
      c.color = HOUSE_WALL_COLORS.find(([, w]) => (roll -= w) < 0)[0];
      c.roofColor = HOUSE_ROOF_COLORS[Math.floor(rand() * HOUSE_ROOF_COLORS.length)];
      const pitch = HOUSE_ROOF_PITCHES[Math.floor(rand() * HOUSE_ROOF_PITCHES.length)];
      const isGarage = c.height <= 4;
      c.wallHeight = (isGarage ? GARAGE_WALL_HEIGHT_M : HOUSE_WALL_HEIGHT_M) + (isGarage ? 0 : Math.floor(rand() * 3) * 0.15);
      // Ridge runs along the longer side; the roof spans the shorter one.
      c.ridgeAlongX = c.halfX > c.halfZ;
      const span = 2 * Math.min(c.halfX, c.halfZ);
      c.roofHeight = Math.min(HOUSE_ROOF_MAX_HEIGHT_M, pitch * (span / 2 + HOUSE_ROOF_OVERHANG_M));
      c.style = "house";
      // Collision follows the new silhouette: same footprint, height up to the ridge.
      c.height = c.wallHeight + c.roofHeight;
    }

    function buildingColliders() {
      const list = BUILDINGS.map((b) => {
        const w = rectToWorld(b);
        const c = makeCollider((w.minX + w.maxX) / 2, (w.minZ + w.maxZ) / 2,
          (w.maxX - w.minX) / 2, (w.maxZ - w.minZ) / 2, b[4], 0);
        c.px = (b[0] + b[2]) / 2;
        c.py = (b[1] + b[3]) / 2;
        if (b[5] !== undefined) c.color = b[5];
        if (!isInsideCampusCore(c.px, c.py)) styleAsHouse(c);
        return c;
      });
      // Hollow buildings: four walls (split around each door, with a lintel
      // over it) and a raised roof slab you can land on.
      for (const b of HOLLOW_BUILDINGS) {
        const [x1, y1, x2, y2, height, doorSpec] = b;
        const doors = Array.isArray(doorSpec) ? doorSpec : [doorSpec];
        const w = rectToWorld([x1, y1, x2, y2]);
        const t = HOLLOW_WALL_M;
        const pieces = [];
        const wall = (minX, maxX, minZ, maxZ, top, base) => pieces.push({ minX, maxX, minZ, maxZ, top, base });
        // One side: `along` is its long-axis extent; gaps come from the doors on it.
        const side = (name, fixedMin, fixedMax, along) => {
          const horizontal = name === "n" || name === "s";
          const seg = (a0, a1, top, base) => {
            if (a1 - a0 < 0.01) return;
            if (horizontal) wall(a0, a1, fixedMin, fixedMax, top, base);
            else wall(fixedMin, fixedMax, a0, a1, top, base);
          };
          const gaps = doors.filter((d) => d.side === name).map((d) => {
            const at = horizontal ? mapToWorld(d.at, 0).x : mapToWorld(0, d.at).z;
            return { g0: at - d.width / 2, g1: at + d.width / 2, height: d.height };
          }).sort((a, b) => a.g0 - b.g0);
          let cursor = along[0];
          for (const g of gaps) {
            seg(cursor, g.g0, height, 0);
            seg(g.g0, g.g1, height, g.height); // lintel
            cursor = g.g1;
          }
          seg(cursor, along[1], height, 0);
        };
        side("n", w.minZ, w.minZ + t, [w.minX, w.maxX]);
        side("s", w.maxZ - t, w.maxZ, [w.minX, w.maxX]);
        side("w", w.minX, w.minX + t, [w.minZ + t, w.maxZ - t]);
        side("e", w.maxX - t, w.maxX, [w.minZ + t, w.maxZ - t]);
        wall(w.minX, w.maxX, w.minZ, w.maxZ, height, height - 0.3); // roof slab
        for (const piece of pieces) {
          const c = makeCollider((piece.minX + piece.maxX) / 2, (piece.minZ + piece.maxZ) / 2,
            (piece.maxX - piece.minX) / 2, (piece.maxZ - piece.minZ) / 2, piece.top, 0);
          if (piece.base) {
            c.base = piece.base;
            c.halfHeight = true;
          }
          if (b[6] !== undefined) c.color = b[6];
          c.px = (x1 + x2) / 2;
          c.py = (y1 + y2) / 2;
          list.push(c);
        }
      }
      for (const b of CYLINDER_BUILDINGS) {
        const center = mapToWorld(b[0], b[1]);
        const radius = b[2] * MAP_SCALE;
        const c = makeCollider(center.x, center.z, radius, radius, b[3], 0);
        c.shape = "cylinder";
        c.radius = radius;
        c.px = b[0];
        c.py = b[1];
        list.push(c);
      }
      for (const b of ROTATED_BUILDINGS) {
        const center = mapToWorld(b[0], b[1]);
        const c = makeCollider(center.x, center.z, b[2] * MAP_SCALE / 2, b[3] * MAP_SCALE / 2,
          b[4], b[5] * Math.PI / 180);
        c.px = b[0];
        c.py = b[1];
        list.push(c);
      }
      for (const c of list) if (!c.style) c.style = "brick";
      return list;
    }

    function rectToWorld(rect) {
      const a = mapToWorld(rect[0], rect[1]);
      const b = mapToWorld(rect[2], rect[3]);
      return {
        minX: Math.min(a.x, b.x), maxX: Math.max(a.x, b.x),
        minZ: Math.min(a.z, b.z), maxZ: Math.max(a.z, b.z),
      };
    }


    // ------------------------------------------------------------------
    // SURFACE MATERIALS (Pass 2 "surface detail"). Every texture is drawn
    // procedurally onto a canvas once at startup and tiled -- nothing is
    // loaded from disk. A seeded RNG keeps the speckle identical every run.
    // ------------------------------------------------------------------
    function seededRandom(seed) {
      let t = seed >>> 0;
      return function () {
        t += 0x6d2b79f5;
        let r = Math.imul(t ^ (t >>> 15), 1 | t);
        r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
        return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
      };
    }

    const maxAnisotropy = renderer ? renderer.capabilities.getMaxAnisotropy() : 1;
    function canvasTexture(width, height, draw) {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      draw(canvas.getContext("2d"), width, height);
      const texture = new THREE.CanvasTexture(canvas);
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      texture.anisotropy = maxAnisotropy;
      return texture;
    }

    // Base color plus light/dark speckle -- the shared look of every rough surface.
    function speckle(ctx, width, height, base, amount, strength, seed) {
      const rand = seededRandom(seed);
      ctx.fillStyle = base;
      ctx.fillRect(0, 0, width, height);
      for (let i = 0; i < amount; i++) {
        const alpha = (rand() * strength).toFixed(3);
        ctx.fillStyle = rand() < 0.5 ? `rgba(255,255,255,${alpha})` : `rgba(0,0,0,${alpha})`;
        ctx.fillRect(Math.floor(rand() * width), Math.floor(rand() * height), 1 + Math.floor(rand() * 2), 1 + Math.floor(rand() * 2));
      }
    }

    // Tile sizes, in meters.
    const GRASS_TILE_M = 6;
    const DIRT_TILE_M = 4;
    const TRACK_TILE_M = 4;
    const ROAD_DASH_PERIOD_M = 12;  // one road tile along the street: 3 m dash + 9 m gap
    const SLAB_LENGTH_M = 1.5;      // sidewalk slab between expansion joints
    const STALL_WIDTH_M = 2.7;
    const STALL_DEPTH_M = 5.5;
    const STALL_ROW_TILE_M = STALL_WIDTH_M * 4; // parking tile along the rows: 4 stalls
    const STALL_MODULE_M = 18;      // parking tile across the rows: stall row + 7 m aisle + stall row

    const grassTexture = canvasTexture(128, 128, (ctx, w, h) => speckle(ctx, w, h, "#6f9a4e", 2200, 0.11, 1));
    const dirtTexture = canvasTexture(128, 128, (ctx, w, h) => speckle(ctx, w, h, "#9b7653", 2600, 0.2, 2));
    const trackTexture = canvasTexture(128, 128, (ctx, w, h) => speckle(ctx, w, h, "#a4503f", 1800, 0.12, 3));
    // Streets: u runs along the street, v across it; dashed yellow center line.
    const roadTexture = canvasTexture(256, 64, (ctx, w, h) => {
      speckle(ctx, w, h, "#4a4a4c", 3000, 0.15, 4);
      ctx.fillStyle = "#d8b83a";
      ctx.fillRect(0, h / 2 - 1, w / 4, 2);
    });
    // Sidewalks and walkways: u along the walk (one slab per tile), v across.
    const concreteTexture = canvasTexture(64, 64, (ctx, w, h) => {
      speckle(ctx, w, h, "#d2cfc7", 500, 0.1, 5);
      ctx.fillStyle = "rgba(0,0,0,0.25)";
      ctx.fillRect(0, 0, 1, h);
    });
    // Parking: u along the stall rows, v across them; white stall lines.
    const lotTexture = canvasTexture(256, 512, (ctx, w, h) => {
      speckle(ctx, w, h, "#5c5c5e", 6000, 0.14, 6);
      const pxPerMU = w / STALL_ROW_TILE_M;
      const rowDepth = STALL_DEPTH_M * (h / STALL_MODULE_M);
      ctx.fillStyle = "#e4e4e4";
      for (let i = 0; i < 4; i++) {
        const x = Math.round(i * STALL_WIDTH_M * pxPerMU);
        ctx.fillRect(x, 0, 3, rowDepth);
        ctx.fillRect(x, h - rowDepth, 3, rowDepth);
      }
    });
    // Football field, mapped once over its whole rectangle (canvas top =
    // north): 120 yards along the canvas height (end zones included), 53.3
    // yards across.
    const turfTexture = canvasTexture(512, 1024, (ctx, w, h) => {
      speckle(ctx, w, h, "#3f7d3a", 9000, 0.1, 7);
      const yd = h / 120;
      ctx.fillStyle = "#8c1d24"; // maroon end zones with "DRAGONS", as in the photo
      ctx.fillRect(0, 0, w, 10 * yd);
      ctx.fillRect(0, h - 10 * yd, w, 10 * yd);
      ctx.fillStyle = "#ffffff";
      for (let y = 10; y <= 110; y += 5) ctx.fillRect(0, y * yd - 1.5, w, 3);
      for (let y = 11; y < 110; y++) {
        if (y % 5 === 0) continue;
        ctx.fillRect(0, y * yd - 1, 10, 2);
        ctx.fillRect(w - 10, y * yd - 1, 10, 2);
        ctx.fillRect(w * 0.4 - 6, y * yd - 1, 12, 2);
        ctx.fillRect(w * 0.6 - 6, y * yd - 1, 12, 2);
      }
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 6;
      ctx.strokeRect(3, 3, w - 6, h - 6);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = "bold 30px Arial";
      for (let y = 20; y <= 100; y += 10) {
        const label = String(Math.min(y - 10, 110 - y));
        ctx.fillText(label, w * 0.15, y * yd);
        ctx.fillText(label, w * 0.85, y * yd);
      }
      // Each end zone's lettering reads from the field side (as in the photo:
      // north one upright seen from above, south one upside down).
      ctx.font = "bold 64px Arial";
      ctx.fillText("DRAGONS", w / 2, 5 * yd);
      ctx.save();
      ctx.translate(w / 2, h - 5 * yd);
      ctx.rotate(Math.PI);
      ctx.fillText("DRAGONS", 0, 0);
      ctx.restore();
    });
    // Pool, mapped once over its rectangle: lane lines run north/south.
    const POOL_LANES = 8;
    const poolTexture = canvasTexture(256, 256, (ctx, w, h) => {
      speckle(ctx, w, h, "#4fa3d1", 800, 0.08, 8);
      ctx.fillStyle = "#1d4f7a";
      for (let i = 1; i < POOL_LANES; i++) ctx.fillRect((i * w) / POOL_LANES - 2, 0, 4, h);
    });

    const GRASS_COLOR = 0x6f9a4e;   // untextured fallback / tree tint reference
    const BUILDING_COLOR = 0xc4c4c0;

    const surfaceMaterial = (map) => new THREE.MeshLambertMaterial({ map });
    const grassMaterial = surfaceMaterial(grassTexture);
    const dirtMaterial = surfaceMaterial(dirtTexture);
    const trackMaterial = surfaceMaterial(trackTexture);
    const roadMaterial = surfaceMaterial(roadTexture);
    const concreteMaterial = surfaceMaterial(concreteTexture);
    const lotMaterial = surfaceMaterial(lotTexture);
    const turfMaterial = surfaceMaterial(turfTexture);
    // Soccer pitch, mapped once over its rectangle: long axis along u.
    const soccerTexture = canvasTexture(1024, 512, (ctx, w, h) => {
      speckle(ctx, w, h, "#4f8a41", 9000, 0.1, 9);
      ctx.fillStyle = "rgba(255,255,255,0.05)";
      for (let i = 0; i < 12; i += 2) ctx.fillRect((i * w) / 12, 0, w / 12, h); // mowing stripes
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 4;
      const m = 8;
      ctx.strokeRect(m, m, w - 2 * m, h - 2 * m);
      ctx.beginPath();
      ctx.moveTo(w / 2, m);
      ctx.lineTo(w / 2, h - m);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(w / 2, h / 2, h * 0.14, 0, Math.PI * 2);
      ctx.stroke();
      for (const side of [0, 1]) {
        const x = side === 0 ? m : w - m;
        const dir = side === 0 ? 1 : -1;
        ctx.strokeRect(Math.min(x, x + dir * w * 0.157), h * 0.2, w * 0.157, h * 0.6);   // penalty area
        ctx.strokeRect(Math.min(x, x + dir * w * 0.052), h * 0.37, w * 0.052, h * 0.26); // goal area
      }
    });
    const soccerMaterial = surfaceMaterial(soccerTexture);
    const poolMaterial = surfaceMaterial(poolTexture);
    const laneLineMaterial = new THREE.MeshLambertMaterial({ color: 0xf2f2f2 });
    const plainAsphaltMaterial = new THREE.MeshLambertMaterial({ color: 0x4a4a4c });

    // ------------------------------------------------------------------
    // GROUND GEOMETRY. Every flat layer is one merged mesh per material
    // (a flat plane is too cheap to cull). Overlapping layers are stacked
    // LIFT meters apart so they never z-fight -- a few centimeters, which
    // holds up even far away on software/low-precision GPUs.
    // ------------------------------------------------------------------
    const LIFT = {
      walk: 0.02, plaza: 0.025, road: 0.04, intersection: 0.045, driveway: 0.05,
      track: 0.06, dirt: 0.06, laneLine: 0.07, lot: 0.08, field: 0.09, pool: 0.09,
      lotWalk: 0.1, infield: 0.1, grassIsland: 0.11, crosswalk: 0.055,
    };

    // Merges geometries that all carry position/normal/uv. With `worldTile`
    // set, UVs are recomputed from world x/z instead (seamless tiling across
    // separate pieces, e.g. grass or dirt).
    function mergedMesh(geometries, material, worldTile) {
      const positions = [];
      const normals = [];
      const uvs = [];
      for (const g of geometries) {
        const ng = g.index ? g.toNonIndexed() : g;
        const pos = ng.attributes.position.array;
        positions.push(...pos);
        normals.push(...ng.attributes.normal.array);
        if (worldTile) {
          for (let i = 0; i < pos.length; i += 3) uvs.push(pos[i] / worldTile, -pos[i + 2] / worldTile);
        } else {
          uvs.push(...ng.attributes.uv.array);
        }
      }
      const merged = new THREE.BufferGeometry();
      merged.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
      merged.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
      merged.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
      // Ground layers are painted bottom-up instead of depth-sorted: each is
      // drawn before any building (negative renderOrder, ordered by its
      // LIFT) without writing depth, so a higher layer always simply covers a
      // lower one. Overlapping coplanar pieces (sidewalks crossing at a
      // corner, walks meeting, streets meeting) can't z-fight at any distance.
      material.depthWrite = false;
      const mesh = new THREE.Mesh(merged, material);
      mesh.renderOrder = -1000 + Math.round((positions[1] || 0) * 1000);
      return mesh;
    }

    // Flat quad from four world-space {x, z} corners with explicit UVs,
    // wound so its face points up.
    function groundQuad(corners, quadUvs, lift) {
      let [a, b, c, d] = corners;
      let [ua, ub, uc, ud] = quadUvs;
      // (b - a) x (c - a) must point up (+y); flip the winding if not.
      if ((b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z) < 0) {
        [b, d] = [d, b];
        [ub, ud] = [ud, ub];
      }
      const g = new THREE.BufferGeometry();
      const verts = [a, b, c, a, c, d];
      const vuv = [ua, ub, uc, ua, uc, ud];
      g.setAttribute("position", new THREE.Float32BufferAttribute(verts.flatMap((p) => [p.x, lift, p.z]), 3));
      g.setAttribute("normal", new THREE.Float32BufferAttribute(verts.flatMap(() => [0, 1, 0]), 3));
      g.setAttribute("uv", new THREE.Float32BufferAttribute(vuv.flat(), 2));
      return g;
    }

    // Strip of `widthPx` along a segment at any angle. u runs along it
    // (one tile per `uPeriodM` meters), v goes 0 -> 1 across it. Ends are
    // extended by half the width so joints overlap cleanly.
    function stripQuad(x1, y1, x2, y2, widthPx, lift, uPeriodM, extendEnds = true) {
      const a = mapToWorld(x1, y1);
      const b = mapToWorld(x2, y2);
      const length = Math.hypot(b.x - a.x, b.z - a.z) || 1e-6;
      const dirX = (b.x - a.x) / length;
      const dirZ = (b.z - a.z) / length;
      const halfWidth = (widthPx * MAP_SCALE) / 2;
      const ext = extendEnds ? halfWidth : 0;
      const sx = a.x - dirX * ext, sz = a.z - dirZ * ext;
      const ex = b.x + dirX * ext, ez = b.z + dirZ * ext;
      const nx = -dirZ * halfWidth, nz = dirX * halfWidth;
      const uEnd = (length + ext * 2) / uPeriodM;
      return groundQuad(
        [{ x: sx - nx, z: sz - nz }, { x: ex - nx, z: ez - nz }, { x: ex + nx, z: ez + nz }, { x: sx + nx, z: sz + nz }],
        [[0, 0], [uEnd, 0], [uEnd, 1], [0, 1]],
        lift,
      );
    }

    // Axis-aligned rectangle (screenshot px). UVs either stretch 0 -> 1 over
    // it (`stretch`), or tile in meters with u along `uAxis` ("x" or "z").
    function rectGround(r, lift, { stretch = false, uAxis = "x", uTileM = 1, vTileM = 1 } = {}) {
      const w = rectToWorld(r);
      const corners = [
        { x: w.minX, z: w.minZ }, { x: w.maxX, z: w.minZ }, { x: w.maxX, z: w.maxZ }, { x: w.minX, z: w.maxZ },
      ];
      const uvOf = (p) => {
        // v runs south -> north so a canvas drawn north-up lands north-up.
        if (stretch) return [(p.x - w.minX) / (w.maxX - w.minX), (w.maxZ - p.z) / (w.maxZ - w.minZ)];
        return uAxis === "x"
          ? [(p.x - w.minX) / uTileM, (p.z - w.minZ) / vTileM]
          : [(p.z - w.minZ) / uTileM, (p.x - w.minX) / vTileM];
      };
      return groundQuad(corners, corners.map(uvOf), lift);
    }

    // Flat disc / ring lying on the ground (world UVs are applied when
    // merged). Angles are counterclockwise as seen on the screenshot:
    // rotateX(-90deg) turns the geometry's +y into -z, i.e. "up" on it.
    function flatDiscWorld(x, z, radiusM, lift) {
      const g = new THREE.CircleGeometry(radiusM, 48);
      g.rotateX(-Math.PI / 2);
      g.translate(x, lift, z);
      return g;
    }

    function flatArcWorld(x, z, innerM, outerM, startRad, sweepRad, lift) {
      const g = new THREE.RingGeometry(innerM, outerM, 48, 1, startRad, sweepRad);
      g.rotateX(-Math.PI / 2);
      g.translate(x, lift, z);
      return g;
    }

    const isHorizontal = (r) => r[1] === r[3];
    const bounds = rectToWorld(MAP_BOUNDS);
    const GROUND_MARGIN = 100; // unwalkable apron so the edge of the world isn't a visible cliff

    // Construction pits: the roadbed of each CONSTRUCTION_ROADS entry, in
    // screenshot px and in world units.
    const pitRectsPx = CONSTRUCTION_ROADS.map((r) => {
      const half = (r[4] || ROAD_WIDTH_PX) / 2;
      return isHorizontal(r)
        ? [Math.min(r[0], r[2]), r[1] - half, Math.max(r[0], r[2]), r[1] + half]
        : [r[0] - half, Math.min(r[1], r[3]), r[0] + half, Math.max(r[1], r[3])];
    });
    const pits = pitRectsPx.map(rectToWorld);

    // Ground height at a world point: 0, or a step down inside a pit.
    function groundHeightAt(x, z) {
      let h = 0;
      for (const p of pits) {
        for (let k = 0; k < PIT_STEPS; k++) {
          const i = k * PIT_LEDGE_M;
          if (x > p.minX + i && x < p.maxX - i && z > p.minZ + i && z < p.maxZ - i) h = Math.min(h, -(k + 1) * PIT_STEP_M);
        }
      }
      return h;
    }

    // Rectangle minus a hole -> up to four rectangles (screenshot px).
    function subtractRect(r, hole) {
      if (hole[0] >= r[2] || hole[2] <= r[0] || hole[1] >= r[3] || hole[3] <= r[1]) return [r];
      const out = [];
      if (hole[1] > r[1]) out.push([r[0], r[1], r[2], hole[1]]);
      if (hole[3] < r[3]) out.push([r[0], hole[3], r[2], r[3]]);
      const y0 = Math.max(r[1], hole[1]);
      const y1 = Math.min(r[3], hole[3]);
      if (hole[0] > r[0]) out.push([r[0], y0, hole[0], y1]);
      if (hole[2] < r[2]) out.push([hole[2], y0, r[2], y1]);
      return out;
    }

    // Grass everywhere except the pits (they're open holes in it).
    let grassRects = [[MAP_BOUNDS[0] - GROUND_MARGIN / MAP_SCALE, MAP_BOUNDS[1] - GROUND_MARGIN / MAP_SCALE,
      MAP_BOUNDS[2] + GROUND_MARGIN / MAP_SCALE, MAP_BOUNDS[3] + GROUND_MARGIN / MAP_SCALE]];
    for (const hole of pitRectsPx) grassRects = grassRects.flatMap((r) => subtractRect(r, hole));
    root.add(mergedMesh(grassRects.map((r) => rectGround(r, 0)), grassMaterial, GRASS_TILE_M));

    // Pit geometry: a dirt floor per step level (drawn before every other
    // ground layer, so the ground around a pit paints over its near edge like
    // a real rim), and inward-facing dirt walls for each step.
    function wallQuad(ax, az, bx, bz, yTop, yBottom, inX, inZ) {
      const g = new THREE.BufferGeometry();
      let v = [[ax, yTop, az], [bx, yTop, bz], [bx, yBottom, bz], [ax, yTop, az], [bx, yBottom, bz], [ax, yBottom, az]];
      // Wind so the face points toward (inX, inZ) (into the pit).
      const e1 = [bx - ax, 0, bz - az];
      const e2 = [0, yBottom - yTop, 0];
      const nx = e1[1] * e2[2] - e1[2] * e2[1];
      const nz = e1[0] * e2[1] - e1[1] * e2[0];
      if (nx * inX + nz * inZ < 0) v = [v[0], v[2], v[1], v[3], v[5], v[4]];
      const len = Math.hypot(inX, inZ) || 1;
      g.setAttribute("position", new THREE.Float32BufferAttribute(v.flat(), 3));
      g.setAttribute("normal", new THREE.Float32BufferAttribute(v.flatMap(() => [inX / len, 0, inZ / len]), 3));
      const along = Math.hypot(bx - ax, bz - az) / DIRT_TILE_M;
      const down = (yTop - yBottom) / DIRT_TILE_M;
      g.setAttribute("uv", new THREE.Float32BufferAttribute([0, down, along, down, along, 0, 0, down, along, 0, 0, 0], 2));
      return g;
    }
    const pitWallGeometries = [];
    pits.forEach((p, n) => {
      for (let k = 0; k < PIT_STEPS; k++) {
        const i = k * PIT_LEDGE_M;
        const x0 = p.minX + i, x1 = p.maxX - i, z0 = p.minZ + i, z1 = p.maxZ - i;
        const yTop = -k * PIT_STEP_M;
        const yBottom = -(k + 1) * PIT_STEP_M;
        const floor = mergedMesh([groundQuad(
          [{ x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 }], [[0, 0], [1, 0], [1, 1], [0, 1]], yBottom,
        )], dirtMaterial.clone(), DIRT_TILE_M);
        floor.renderOrder = -3000 + n * 10 + k; // before grass (-1000 and up), lower step last
        root.add(floor);
        pitWallGeometries.push(
          wallQuad(x0, z0, x1, z0, yTop, yBottom, 0, 1),
          wallQuad(x0, z1, x1, z1, yTop, yBottom, 0, -1),
          wallQuad(x0, z0, x0, z1, yTop, yBottom, 1, 0),
          wallQuad(x1, z0, x1, z1, yTop, yBottom, -1, 0),
        );
      }
    });
    if (pitWallGeometries.length > 0) {
      const walls = mergedMesh(pitWallGeometries, new THREE.MeshLambertMaterial({ map: dirtTexture, color: 0xbfa888 }));
      walls.material.depthWrite = true; // real geometry, depth-tested like buildings
      walls.renderOrder = 0;
      root.add(walls);
    }

    // Streets, with plain-asphalt patches over every intersection so center
    // lines stop at the crossing instead of z-fighting through it.
    const roadHalfWidth = (r) => (r[4] || ROAD_WIDTH_PX) / 2;
    root.add(mergedMesh(ROADS.map((r) =>
      stripQuad(r[0], r[1], r[2], r[3], roadHalfWidth(r) * 2, LIFT.road, ROAD_DASH_PERIOD_M)), roadMaterial));
    const intersectionPatches = [];
    for (const h of ROADS.filter(isHorizontal)) {
      for (const v of ROADS.filter((r) => !isHorizontal(r))) {
        const x = v[0];
        const y = h[1];
        if (x < Math.min(h[0], h[2]) - roadHalfWidth(v) || x > Math.max(h[0], h[2]) + roadHalfWidth(v)) continue;
        if (y < Math.min(v[1], v[3]) - roadHalfWidth(h) || y > Math.max(v[1], v[3]) + roadHalfWidth(h)) continue;
        intersectionPatches.push(rectGround(
          [x - roadHalfWidth(v), y - roadHalfWidth(h), x + roadHalfWidth(v), y + roadHalfWidth(h)], LIFT.intersection));
      }
    }
    root.add(mergedMesh(intersectionPatches, plainAsphaltMaterial));
    root.add(mergedMesh([
      ...DRIVEWAYS.map((r) => rectGround(r, LIFT.driveway)),
      ...DRIVE_ARCS.map((a) => {
        const c = mapToWorld(a[0], a[1]);
        return flatArcWorld(c.x, c.z, (a[2] - a[3] / 2) * MAP_SCALE, (a[2] + a[3] / 2) * MAP_SCALE,
          (a[4] * Math.PI) / 180, (a[5] * Math.PI) / 180, LIFT.driveway);
      }),
    ], plainAsphaltMaterial, 1));

    // Crosswalks: white zebra bars (one small alpha-tested texture, so it
    // stays in the cheap opaque pass).
    //   - across every lot entrance off a street, where the sidewalk crosses
    //     the driveway -- sidewalk to sidewalk;
    //   - across all four legs of the CROSSWALK_INTERSECTIONS.
    const CROSSWALK_INTERSECTIONS = [[815, 175], [815, 680]]; // 14th St at 6th Ave and at 9th Ave
    const CROSSWALK_BAR_PERIOD_M = 1.0;
    const crosswalkMaterial = new THREE.MeshLambertMaterial({
      alphaTest: 0.5,
      map: canvasTexture(64, 16, (ctx, w, h) => {
        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = "#f4f4f0";
        ctx.fillRect(0, 0, w * 0.55, h);
      }),
    });
    const crosswalkGeometries = [];
    // rect in px; `walkAxis`: the direction people walk ("x" or "z"); bars
    // are spaced along it and run across it.
    const addCrosswalk = (r, walkAxis) => {
      if (r[2] - r[0] < 0.5 || r[3] - r[1] < 0.5) return;
      const w = rectToWorld(r);
      const across = walkAxis === "x" ? w.maxZ - w.minZ : w.maxX - w.minX;
      crosswalkGeometries.push(rectGround(r, LIFT.crosswalk, { uAxis: walkAxis, uTileM: CROSSWALK_BAR_PERIOD_M, vTileM: across }));
    };
    const sidewalkBand = (r) => { // [near, far] offsets of the sidewalk band from the road's centerline, px
      const half = roadHalfWidth(r);
      return [half + SIDEWALK_GAP_PX * 0.5, half + SIDEWALK_GAP_PX + SIDEWALK_WIDTH_PX];
    };
    for (const d of DRIVEWAYS) {
      for (const r of ROADS) {
        const [near, far] = sidewalkBand(r);
        if (isHorizontal(r)) {
          const x0 = Math.max(d[0], Math.min(r[0], r[2])), x1 = Math.min(d[2], Math.max(r[0], r[2]));
          if (x1 - x0 < 1) continue;
          for (const side of [-1, 1]) {
            const a = r[1] + side * near, b = r[1] + side * far;
            const y0 = Math.min(a, b), y1 = Math.max(a, b);
            if (d[1] < y1 && d[3] > y0) addCrosswalk([x0, y0, x1, y1], "x");
          }
        } else {
          const y0 = Math.max(d[1], Math.min(r[1], r[3])), y1 = Math.min(d[3], Math.max(r[1], r[3]));
          if (y1 - y0 < 1) continue;
          for (const side of [-1, 1]) {
            const a = r[0] + side * near, b = r[0] + side * far;
            const x0 = Math.min(a, b), x1 = Math.max(a, b);
            if (d[0] < x1 && d[2] > x0) addCrosswalk([x0, y0, x1, y1], "z");
          }
        }
      }
    }
    for (const [ix, iy] of CROSSWALK_INTERSECTIONS) {
      const v = ROADS.find((r) => !isHorizontal(r) && r[0] === ix && Math.min(r[1], r[3]) <= iy && Math.max(r[1], r[3]) >= iy);
      const h = ROADS.find((r) => isHorizontal(r) && r[1] === iy && Math.min(r[0], r[2]) <= ix && Math.max(r[0], r[2]) >= ix);
      const vHalf = roadHalfWidth(v), hHalf = roadHalfWidth(h);
      const [hNear, hFar] = sidewalkBand(h);
      const [vNear, vFar] = sidewalkBand(v);
      // north and south legs: people cross 14th St (walk along x) in line with the avenue's sidewalks
      addCrosswalk([ix - vHalf - SIDEWALK_GAP_PX, iy - hFar, ix + vHalf + SIDEWALK_GAP_PX, iy - hNear], "x");
      addCrosswalk([ix - vHalf - SIDEWALK_GAP_PX, iy + hNear, ix + vHalf + SIDEWALK_GAP_PX, iy + hFar], "x");
      // west and east legs: people cross the avenue (walk along z) in line with 14th St's sidewalks
      addCrosswalk([ix - vFar, iy - hHalf - SIDEWALK_GAP_PX, ix - vNear, iy + hHalf + SIDEWALK_GAP_PX], "z");
      addCrosswalk([ix + vNear, iy - hHalf - SIDEWALK_GAP_PX, ix + vFar, iy + hHalf + SIDEWALK_GAP_PX], "z");
    }
    if (crosswalkGeometries.length > 0) root.add(mergedMesh(crosswalkGeometries, crosswalkMaterial));

    // Sidewalks (both sides of every street) and campus walkways -- the
    // same slab concrete, drawn under streets and lots so crossings and lot
    // edges read cleanly. Plazas are paved rectangles.
    const walkGeometries = PATHS.map((p) =>
      stripQuad(p[0], p[1], p[2], p[3], p[4] || PATH_WIDTH_PX, LIFT.walk, SLAB_LENGTH_M));
    for (const r of [...ROADS, ...CONSTRUCTION_ROADS]) {
      const offset = roadHalfWidth(r) + SIDEWALK_GAP_PX + SIDEWALK_WIDTH_PX / 2;
      for (const side of [-1, 1]) {
        const ox = isHorizontal(r) ? 0 : side * offset;
        const oy = isHorizontal(r) ? side * offset : 0;
        walkGeometries.push(stripQuad(r[0] + ox, r[1] + oy, r[2] + ox, r[3] + oy, SIDEWALK_WIDTH_PX, LIFT.walk, SLAB_LENGTH_M));
      }
    }
    for (const a of PATH_ARCS) {
      const c = mapToWorld(a[0], a[1]);
      const g = flatArcWorld(c.x, c.z, (a[2] - a[3] / 2) * MAP_SCALE, (a[2] + a[3] / 2) * MAP_SCALE,
        (a[4] * Math.PI) / 180, (a[5] * Math.PI) / 180, LIFT.walk);
      // Slab UVs: u follows the arc (one slab per SLAB_LENGTH_M), v runs across it.
      const pos = g.attributes.position.array;
      const uv = g.attributes.uv.array;
      for (let i = 0, j = 0; i < pos.length; i += 3, j += 2) {
        const dx = pos[i] - c.x;
        const dz = pos[i + 2] - c.z;
        const angle = Math.atan2(-dz, dx);
        const radius = Math.hypot(dx, dz);
        uv[j] = (angle * a[2] * MAP_SCALE) / SLAB_LENGTH_M;
        uv[j + 1] = (radius - (a[2] - a[3] / 2) * MAP_SCALE) / (a[3] * MAP_SCALE);
      }
      walkGeometries.push(g);
    }
    for (const r of PLAZAS) walkGeometries.push(rectGround(r, LIFT.plaza, { uTileM: SLAB_LENGTH_M, vTileM: SLAB_LENGTH_M }));
    root.add(mergedMesh(walkGeometries, concreteMaterial));
    // Walks across lots are their own mesh so they paint above the lots.
    root.add(mergedMesh(LOT_WALKS.map((w) =>
      stripQuad(w[0], w[1], w[2], w[3], w[4] || PATH_WIDTH_PX, LIFT.lotWalk, SLAB_LENGTH_M)), concreteMaterial.clone()));

    // Parking lots: stall rows run along each lot's longer side unless the
    // lot entry names an axis ("x" = rows run east/west, "z" = north/south).
    root.add(mergedMesh(LOTS.map((r) => {
      const w = rectToWorld(r);
      const uAxis = r[4] || (w.maxX - w.minX >= w.maxZ - w.minZ ? "x" : "z");
      return rectGround(r, LIFT.lot, { uAxis, uTileM: STALL_ROW_TILE_M, vTileM: STALL_MODULE_M });
    }), lotMaterial));

    // Running track as a capsule (straights + half-disc ends), with white
    // lane lines inset from its outer edge.
    const TRACK_LANES = 6;
    const TRACK_LANE_WIDTH_M = 1.22;
    const LANE_LINE_WIDTH_M = 0.08;
    function capsuleOf(r) {
      const w = rectToWorld(r);
      const radius = (w.maxX - w.minX) / 2;
      const cx = (w.minX + w.maxX) / 2;
      return { cx, radius, zTop: w.minZ + radius, zBottom: w.maxZ - radius };
    }
    const trackGeometries = [];
    const laneLineGeometries = [];
    for (const r of TRACKS) {
      const cap = capsuleOf(r);
      trackGeometries.push(
        rectGround([r[0], r[1] + (r[2] - r[0]) / 2, r[2], r[3] - (r[2] - r[0]) / 2], LIFT.track),
        flatDiscWorld(cap.cx, cap.zTop, cap.radius, LIFT.track),
        flatDiscWorld(cap.cx, cap.zBottom, cap.radius, LIFT.track),
      );
      for (let lane = 0; lane <= TRACK_LANES; lane++) {
        const rad = cap.radius - lane * TRACK_LANE_WIDTH_M;
        const half = LANE_LINE_WIDTH_M / 2;
        for (const side of [-1, 1]) {
          const lineX = cap.cx + side * rad;
          laneLineGeometries.push(groundQuad(
            [{ x: lineX - half, z: cap.zTop }, { x: lineX + half, z: cap.zTop },
              { x: lineX + half, z: cap.zBottom }, { x: lineX - half, z: cap.zBottom }],
            [[0, 0], [1, 0], [1, 1], [0, 1]], LIFT.laneLine));
        }
        laneLineGeometries.push(flatArcWorld(cap.cx, cap.zTop, rad - half, rad + half, 0, Math.PI, LIFT.laneLine));
        laneLineGeometries.push(flatArcWorld(cap.cx, cap.zBottom, rad - half, rad + half, Math.PI, Math.PI, LIFT.laneLine));
      }
    }
    for (const r of RUNWAYS) trackGeometries.push(rectGround(r, LIFT.track));
    root.add(mergedMesh(trackGeometries, trackMaterial, TRACK_TILE_M));
    root.add(mergedMesh(laneLineGeometries, laneLineMaterial, 1));

    root.add(mergedMesh(TURF_AREAS.map((r) => rectGround(r, LIFT.field, { stretch: true })), turfMaterial));
    root.add(mergedMesh(SOCCER_FIELDS.map((r) => rectGround(r, LIFT.field, { stretch: true })), soccerMaterial));
    root.add(mergedMesh(POOLS.map((r) => rectGround(r, LIFT.pool, { stretch: true })), poolMaterial));
    root.add(mergedMesh([
      ...WADING_POOLS.map((r) => rectGround(r, LIFT.pool)),
      (() => {
        const c = mapToWorld(1789, 634); // Z21: round splash pad
        return flatDiscWorld(c.x, c.z, 5 * MAP_SCALE, LIFT.pool);
      })(),
    ], new THREE.MeshLambertMaterial({ color: 0x8fd0ea }), 1));
    root.add(mergedMesh(GRASS_AREAS.map((r) => rectGround(r, LIFT.grassIsland)), grassMaterial, GRASS_TILE_M));
    root.add(mergedMesh([
      ...DIRT_AREAS.map((r) => rectGround(r, LIFT.dirt)),
      ...DIRT_CIRCLES.map((d) => {
        const c = mapToWorld(d[0], d[1]);
        return flatDiscWorld(c.x, c.z, d[2] * MAP_SCALE, LIFT.infield);
      }),
      ...DIRT_ARCS.map((a) => {
        const c = mapToWorld(a[0], a[1]);
        return flatArcWorld(c.x, c.z, a[2] * MAP_SCALE, a[3] * MAP_SCALE,
          a[4] * Math.PI / 180, a[5] * Math.PI / 180, LIFT.infield);
      }),
    ], dirtMaterial, DIRT_TILE_M));

    // ------------------------------------------------------------------
    // ZONES (spatial partitioning / chunking). One zone per city block (see
    // ZONES above and CAMPUS_MAP_PROGRESS.md). Each zone owns:
    //   - its buildings and props: one InstancedMesh per shape (every
    //     building is the same unit box or cylinder, scaled and tinted per
    //     instance), frustum-culled against the zone's bounding sphere and
    //     hidden past RENDER_DISTANCE;
    //   - its trees: instanced trunks + canopies, hidden past
    //     TREE_DRAW_DISTANCE (the LOD step -- small detail drops out first);
    //   - its colliders: only zones the player stands in (padded by
    //     ZONE_COLLISION_PADDING) are tested -- plain boxes/cylinders, kept
    //     separate from whatever the visuals turn into.
    // ------------------------------------------------------------------
    const ZONE_COLLISION_PADDING = 2;


    const buildingMaterial = new THREE.MeshLambertMaterial({ color: 0xffffff });

    // Brick: one small tiling canvas texture, projected in world space in the
    // shader (walls take it by their facing, flat roofs get gravel gray), so
    // every brick building shares a single material and bricks stay
    // real-size however the box is scaled.
    const BRICK_TILE_M = 2.4;
    const brickTexture = canvasTexture(256, 256, (ctx, w, h) => {
      const rand = seededRandom(21);
      ctx.fillStyle = "#b3a797"; // mortar
      ctx.fillRect(0, 0, w, h);
      const rows = 24, perRow = 8;
      const bh = h / rows, bw = w / perRow;
      const reds = ["#8e4a37", "#9a5341", "#7f4130", "#a15a44", "#874536", "#94503d"];
      for (let r = 0; r < rows; r++) {
        const offset = r % 2 === 0 ? 0 : bw / 2;
        for (let i = -1; i < perRow + 1; i++) {
          ctx.fillStyle = reds[Math.floor(rand() * reds.length)];
          ctx.fillRect(i * bw + offset + 1, r * bh + 1, bw - 2, bh - 2);
        }
      }
    });
    brickTexture.anisotropy = maxAnisotropy;
    const brickMaterial = new THREE.MeshLambertMaterial({ color: 0xffffff });
    brickMaterial.onBeforeCompile = (shader) => {
      shader.uniforms.brickMap = { value: brickTexture };
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vBrickPos;\nvarying vec3 vBrickNormal;")
        .replace("#include <project_vertex>", [
          "#include <project_vertex>",
          "vec4 brickWorld = vec4(transformed, 1.0);",
          "vec3 brickN = objectNormal;",
          "#ifdef USE_INSTANCING",
          "brickWorld = instanceMatrix * brickWorld;",
          "brickN = mat3(instanceMatrix) * brickN;",
          "#endif",
          "brickWorld = modelMatrix * brickWorld;",
          "vBrickPos = brickWorld.xyz;",
          "vBrickNormal = normalize(mat3(modelMatrix) * brickN);",
        ].join("\n"));
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", "#include <common>\nuniform sampler2D brickMap;\nvarying vec3 vBrickPos;\nvarying vec3 vBrickNormal;")
        .replace("#include <map_fragment>", [
          "vec3 brickNormal = normalize(vBrickNormal);",
          "if (abs(brickNormal.y) < 0.5) {",
          "  vec2 brickUv = abs(brickNormal.x) > abs(brickNormal.z) ? vBrickPos.zy : vBrickPos.xy;",
          "  diffuseColor.rgb *= texture2D(brickMap, brickUv / " + BRICK_TILE_M.toFixed(2) + ").rgb;",
          "} else {",
          "  diffuseColor.rgb *= vec3(0.56, 0.55, 0.53);", // flat gravel roof
          "}",
        ].join("\n"));
    };

    // House roof: one shared low-poly gable (a triangular prism, 8 faces),
    // unit-sized -- base at y 0, ridge at y 1 running along z -- scaled and
    // rotated per house.
    const unitGableRoof = (() => {
      const v = (x, y, z) => [x, y, z];
      const A = v(-0.5, 0, -0.5), B = v(0.5, 0, -0.5), C = v(0.5, 0, 0.5), D = v(-0.5, 0, 0.5);
      const E = v(0, 1, -0.5), F = v(0, 1, 0.5);
      const tris = [
        A, D, F, A, F, E,   // left slope
        C, B, E, C, E, F,   // right slope
        B, A, E,            // back gable
        D, C, F,            // front gable
        A, B, C, A, C, D,   // underside (seen past the overhang)
      ];
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(tris.flat(), 3));
      g.computeVertexNormals();
      return g;
    })();
    const roofMaterial = new THREE.MeshLambertMaterial({ color: 0xffffff });
    const unitBox = new THREE.BoxGeometry(1, 1, 1);
    unitBox.translate(0, 0.5, 0); // origin at the base, so scale.y is the height
    const unitCylinder = new THREE.CylinderGeometry(0.5, 0.5, 1, 40);
    unitCylinder.translate(0, 0.5, 0);

    // Trees: a tapered 6-sided trunk plus either a round canopy (deciduous)
    // or a cone (evergreen). Low-poly on purpose -- there are hundreds.
    const treeMaterial = new THREE.MeshLambertMaterial({ color: 0xffffff });
    const trunkGeometry = new THREE.CylinderGeometry(0.16, 0.24, 1, 6);
    trunkGeometry.translate(0, 0.5, 0);
    const canopyGeometry = new THREE.IcosahedronGeometry(1, 1);
    const coneGeometry = new THREE.ConeGeometry(1, 1, 8);
    coneGeometry.translate(0, 0.5, 0);
    const TREE_TRUNK_RADIUS = 0.3; // collision

    function zoneAt(px, py) {
      return ZONES.find((z) => px >= z.rect[0] && px < z.rect[2] && py >= z.rect[1] && py < z.rect[3]) || ZONES[0];
    }

    // True if a screenshot-px point is on a street, sidewalk, walk, lot,
    // driveway or plaza -- tree rows skip those spots so no tree ever stands
    // in a driveway or on a path.
    function distToSegment(px, py, x1, y1, x2, y2) {
      const dx = x2 - x1;
      const dy = y2 - y1;
      const len2 = dx * dx + dy * dy || 1e-9;
      const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / len2));
      return Math.hypot(px - (x1 + dx * t), py - (y1 + dy * t));
    }
    const inRect = (px, py, r, pad) => px >= r[0] - pad && px <= r[2] + pad && py >= r[1] - pad && py <= r[3] + pad;
    function isPaved(px, py) {
      const TREE_CLEARANCE_PX = 1.5;
      for (const r of GRASS_AREAS) {
        if (inRect(px, py, r, 0)) return false; // planted islands inside lots
      }
      for (const r of [...ROADS, ...CONSTRUCTION_ROADS]) {
        const d = distToSegment(px, py, r[0], r[1], r[2], r[3]);
        const half = (r[4] || ROAD_WIDTH_PX) / 2;
        if (d < half + TREE_CLEARANCE_PX) return true;
        // the sidewalks running along both sides of it
        if (Math.abs(d - (half + SIDEWALK_GAP_PX + SIDEWALK_WIDTH_PX / 2)) < SIDEWALK_WIDTH_PX / 2) return true;
      }
      for (const p of PATHS) {
        if (distToSegment(px, py, p[0], p[1], p[2], p[3]) < (p[4] || PATH_WIDTH_PX) / 2 + TREE_CLEARANCE_PX) return true;
      }
      for (const r of [...LOTS, ...PLAZAS]) {
        if (inRect(px, py, r, 0)) return true;
      }
      for (const r of DRIVEWAYS) {
        if (inRect(px, py, r, TREE_CLEARANCE_PX)) return true;
      }
      for (const a of [...DRIVE_ARCS, ...PATH_ARCS]) {
        const d = Math.hypot(px - a[0], py - a[1]);
        if (Math.abs(d - a[2]) < a[3] / 2 + TREE_CLEARANCE_PX) return true;
      }
      return false;
    }

    // True if a screenshot-px point is inside (or within a trunk's reach of)
    // any building footprint -- trees never grow inside a house.
    const TREE_BUILDING_CLEARANCE_PX = 2.5;
    function insideAnyBuilding(px, py) {
      for (const b of [...BUILDINGS, ...HOLLOW_BUILDINGS]) {
        if (px > b[0] - TREE_BUILDING_CLEARANCE_PX && px < b[2] + TREE_BUILDING_CLEARANCE_PX &&
          py > b[1] - TREE_BUILDING_CLEARANCE_PX && py < b[3] + TREE_BUILDING_CLEARANCE_PX) return true;
      }
      for (const c of CYLINDER_BUILDINGS) {
        if (Math.hypot(px - c[0], py - c[1]) < c[2] + TREE_BUILDING_CLEARANCE_PX) return true;
      }
      return false;
    }

    // Expands one zone's detail entry into colliders (props, bleachers,
    // trees) and tree instances.
    function zoneDetailContents(id) {
      const detail = ZONE_DETAIL[id] || {};
      const colliders = [];
      const trees = [];
      for (const p of detail.props || []) {
        const w = rectToWorld(p);
        const c = makeCollider((w.minX + w.maxX) / 2, (w.minZ + w.maxZ) / 2,
          (w.maxX - w.minX) / 2, (w.maxZ - w.minZ) / 2, p[4], 0);
        c.color = p[5];
        // Optional 7th value: raised off the ground by this many meters.
        // Raised props are decoration only -- no collision.
        if (p[6]) {
          c.base = p[6];
          if (p[7] === "solid" || p[8] === "solid") {
            // Raised but solid (e.g. the press box): collides from its base
            // up to its top, so nothing walks through it and you can stand on it.
            c.height = p[6] + p[4];
            c.halfHeight = true;
          } else {
            c.collide = false;
          }
        }
        if (p[7] === "cyl") {
          c.shape = "cylinder";
          c.radius = c.halfX;
        }
        colliders.push(c);
      }
      // Bleachers: [x1, y1, x2, y2, top height, steps, facing, color]. Built as
      // stacked boxes stepping down toward the side they face ("n"/"s"/"e"/"w"),
      // low enough per step (see STEP_UP_HEIGHT) to walk up.
      for (const b of detail.bleachers || []) {
        const [x1, y1, x2, y2, top, steps, facing, color] = b;
        for (let i = 1; i <= steps; i++) {
          const frac = (steps - i + 1) / steps; // fraction of the depth, measured from the back
          let r;
          if (facing === "e") r = [x1, y1, x1 + (x2 - x1) * frac, y2];
          else if (facing === "w") r = [x2 - (x2 - x1) * frac, y1, x2, y2];
          else if (facing === "s") r = [x1, y1, x2, y1 + (y2 - y1) * frac];
          else r = [x1, y2 - (y2 - y1) * frac, x2, y2];
          const w = rectToWorld(r);
          const c = makeCollider((w.minX + w.maxX) / 2, (w.minZ + w.maxZ) / 2,
            (w.maxX - w.minX) / 2, (w.maxZ - w.minZ) / 2, (top * i) / steps, 0);
          c.color = color;
          colliders.push(c);
        }
      }
      // Trees: single [x, y, kind] or rows [x1, y1, x2, y2, spacing px, kind];
      // kind "e" = evergreen, anything else deciduous. Sizes vary per tree
      // from a seeded RNG, so every run looks the same.
      const rand = seededRandom(id.split("").reduce((a, ch) => a * 31 + ch.charCodeAt(0), 7));
      const addTree = (x, y, kind, dirX = 0, dirY = 0) => {
        const blocked = (tx, ty) => isPaved(tx, ty) || insideAnyBuilding(tx, ty);
        if (blocked(x, y)) {
          // Row trees slide a little along their row to clear a walk or
          // driveway; anything still on pavement is left out.
          const shift = [3, -3, 5, -5].find((d) => !blocked(x + dirX * d, y + dirY * d));
          if (shift === undefined || (dirX === 0 && dirY === 0)) return;
          x += dirX * shift;
          y += dirY * shift;
        }
        const pos = mapToWorld(x, y);
        const evergreen = kind === "e";
        const trunkHeight = evergreen ? 1.2 + rand() * 0.6 : 2.2 + rand() * 1.4;
        let canopyRadius = evergreen ? 1.8 + rand() * 0.8 : 2.4 + rand() * 1.6;
        // Keep canopies out of buildings you can walk into (they'd show
        // through the walls inside): shrink to fit, or drop the tree.
        for (const hb of HOLLOW_BUILDINGS) {
          const w = rectToWorld(hb);
          const d = Math.hypot(Math.max(w.minX - pos.x, 0, pos.x - w.maxX), Math.max(w.minZ - pos.z, 0, pos.z - w.maxZ));
          if (d < 1.4) return;
          canopyRadius = Math.min(canopyRadius, d - 0.3);
        }
        const canopyHeight = evergreen ? 6 + rand() * 4 : canopyRadius * (0.8 + rand() * 0.2);
        const shade = 0.75 + rand() * 0.35;
        trees.push({ x: pos.x, z: pos.z, evergreen, trunkHeight, canopyRadius, canopyHeight, shade });
        const c = makeCollider(pos.x, pos.z, TREE_TRUNK_RADIUS, TREE_TRUNK_RADIUS,
          trunkHeight + (evergreen ? canopyHeight : canopyHeight * 1.8), 0);
        c.shape = "cylinder";
        c.radius = TREE_TRUNK_RADIUS;
        c.render = false;
        c.isTree = true;
        colliders.push(c);
      };
      // Fences: [x1, y1, x2, y2, height m, color] -- a thin panel along the
      // segment, rotated to match (collides like any other box).
      for (const f of detail.fences || []) {
        const a = mapToWorld(f[0], f[1]);
        const b = mapToWorld(f[2], f[3]);
        const length = Math.hypot(b.x - a.x, b.z - a.z);
        const c = makeCollider((a.x + b.x) / 2, (a.z + b.z) / 2, length / 2 + 0.05, 0.05, f[4],
          Math.atan2(-(b.z - a.z), b.x - a.x));
        c.color = f[5];
        c.seeThrough = true; // chain-link
        colliders.push(c);
      }
      for (const t of detail.trees || []) addTree(t[0], t[1], t[2]);
      for (const row of detail.treeRows || []) {
        const [x1, y1, x2, y2, spacing, kind] = row;
        const count = Math.max(1, Math.round(Math.hypot(x2 - x1, y2 - y1) / spacing));
        const len = Math.hypot(x2 - x1, y2 - y1) || 1;
        for (let i = 0; i <= count; i++) {
          addTree(x1 + ((x2 - x1) * i) / count, y1 + ((y2 - y1) * i) / count, kind, (x2 - x1) / len, (y2 - y1) / len);
        }
      }
      return { colliders, trees };
    }

    function instancedMesh(geometry, material, count, sphere) {
      const g = geometry.clone();
      g.boundingSphere = sphere;
      const mesh = new THREE.InstancedMesh(g, material, count);
      root.add(mesh);
      return mesh;
    }

    const allColliders = buildingColliders();
    const zones = ZONES.map((def) => {
      const colliders = allColliders.filter((c) => zoneAt(c.px, c.py) === def);
      const detail = zoneDetailContents(def.id);
      colliders.push(...detail.colliders);

      // Zone bounds: its block rectangle, grown to cover anything that pokes out.
      const rectW = rectToWorld(def.rect);
      const box = {
        minX: Math.min(rectW.minX, ...colliders.map((c) => c.minX)),
        maxX: Math.max(rectW.maxX, ...colliders.map((c) => c.maxX)),
        minZ: Math.min(rectW.minZ, ...colliders.map((c) => c.minZ)),
        maxZ: Math.max(rectW.maxZ, ...colliders.map((c) => c.maxZ)),
        maxY: Math.max(1, ...colliders.map((c) => c.height)),
      };
      // Each zone's meshes carry their own bounding sphere: r128's
      // InstancedMesh culls with the base geometry's sphere (a 1 m shape at
      // the origin), which would wrongly hide the zone whenever the world
      // origin was off-screen.
      const sphere = new THREE.Sphere(
        new THREE.Vector3((box.minX + box.maxX) / 2, box.maxY / 2, (box.minZ + box.maxZ) / 2),
        Math.hypot(box.maxX - box.minX, box.maxY, box.maxZ - box.minZ) / 2,
      );

      const matrix = new THREE.Matrix4();
      const rotation = new THREE.Quaternion();
      const up = new THREE.Vector3(0, 1, 0);
      const color = new THREE.Color();
      const meshes = [];
      const drawn = colliders.filter((c) => c.render !== false);
      const isBrick = (c) => c.style === "brick" && c.color === undefined;
      for (const [shapeGeometry, material, members] of [
        [unitBox, brickMaterial, drawn.filter((c) => c.shape !== "cylinder" && isBrick(c))],
        [unitCylinder, brickMaterial, drawn.filter((c) => c.shape === "cylinder" && isBrick(c))],
        [unitBox, buildingMaterial, drawn.filter((c) => c.shape !== "cylinder" && !isBrick(c))],
        [unitCylinder, buildingMaterial, drawn.filter((c) => c.shape === "cylinder" && !isBrick(c))],
      ]) {
        if (members.length === 0) continue;
        const mesh = instancedMesh(shapeGeometry, material, members.length, sphere);
        members.forEach((c, i) => {
          rotation.setFromAxisAngle(up, c.yaw);
          const bottom = c.base || 0;
          const size = c.style === "house" ? c.wallHeight : c.halfHeight ? c.height - bottom : c.height;
          matrix.compose(new THREE.Vector3(c.cx, bottom, c.cz), rotation,
            new THREE.Vector3(c.halfX * 2, size, c.halfZ * 2));
          mesh.setMatrixAt(i, matrix);
          mesh.setColorAt(i, color.set(isBrick(c) ? 0xffffff : c.color !== undefined ? c.color : BUILDING_COLOR));
        });
        mesh.instanceMatrix.needsUpdate = true;
        mesh.instanceColor.needsUpdate = true;
        meshes.push(mesh);
      }
      // House roofs: one instanced mesh per zone, culled with the zone.
      const houses = drawn.filter((c) => c.style === "house");
      if (houses.length > 0) {
        const roofs = instancedMesh(unitGableRoof, roofMaterial, houses.length, sphere);
        houses.forEach((c, i) => {
          rotation.setFromAxisAngle(up, c.yaw + (c.ridgeAlongX ? Math.PI / 2 : 0));
          const across = 2 * (c.ridgeAlongX ? c.halfZ : c.halfX) + HOUSE_ROOF_OVERHANG_M * 2;
          const along = 2 * (c.ridgeAlongX ? c.halfX : c.halfZ) + HOUSE_ROOF_OVERHANG_M * 2;
          matrix.compose(new THREE.Vector3(c.cx, c.wallHeight, c.cz), rotation, new THREE.Vector3(across, c.roofHeight, along));
          roofs.setMatrixAt(i, matrix);
          roofs.setColorAt(i, color.set(c.roofColor));
        });
        roofs.instanceMatrix.needsUpdate = true;
        roofs.instanceColor.needsUpdate = true;
        meshes.push(roofs);
      }

      const treeMeshes = [];
      const trees = detail.trees;
      if (trees.length > 0) {
        const trunks = instancedMesh(trunkGeometry, treeMaterial, trees.length, sphere);
        const leafy = trees.filter((t) => !t.evergreen);
        const conifers = trees.filter((t) => t.evergreen);
        trees.forEach((t, i) => {
          matrix.compose(new THREE.Vector3(t.x, 0, t.z), rotation.identity(), new THREE.Vector3(1, t.trunkHeight, 1));
          trunks.setMatrixAt(i, matrix);
          trunks.setColorAt(i, color.setRGB(0.36, 0.26, 0.17));
        });
        trunks.instanceColor.needsUpdate = true;
        treeMeshes.push(trunks);
        if (leafy.length > 0) {
          const canopies = instancedMesh(canopyGeometry, treeMaterial, leafy.length, sphere);
          leafy.forEach((t, i) => {
            matrix.compose(new THREE.Vector3(t.x, t.trunkHeight + t.canopyHeight * 0.8, t.z), rotation.identity(),
              new THREE.Vector3(t.canopyRadius, t.canopyHeight, t.canopyRadius));
            canopies.setMatrixAt(i, matrix);
            canopies.setColorAt(i, color.setRGB(0.26 * t.shade, 0.45 * t.shade, 0.2 * t.shade));
          });
          canopies.instanceColor.needsUpdate = true;
          treeMeshes.push(canopies);
        }
        if (conifers.length > 0) {
          const cones = instancedMesh(coneGeometry, treeMaterial, conifers.length, sphere);
          conifers.forEach((t, i) => {
            matrix.compose(new THREE.Vector3(t.x, t.trunkHeight, t.z), rotation.identity(),
              new THREE.Vector3(t.canopyRadius, t.canopyHeight, t.canopyRadius));
            cones.setMatrixAt(i, matrix);
            cones.setColorAt(i, color.setRGB(0.15 * t.shade, 0.32 * t.shade, 0.18 * t.shade));
          });
          cones.instanceColor.needsUpdate = true;
          treeMeshes.push(cones);
        }
      }

      return { id: def.id, name: def.name, colliders, box, meshes, treeMeshes };
    });

    function distanceToZone(zone, x, z) {
      const dx = Math.max(zone.box.minX - x, 0, x - zone.box.maxX);
      const dz = Math.max(zone.box.minZ - z, 0, z - zone.box.maxZ);
      return Math.hypot(dx, dz);
    }


    // ------------------------------------------------------------------
    // ROAD CLOSED BARRICADES (BARRICADES): a row of striped barricades across
    // each closed street -- two metal legs on flat feet, three orange/white
    // striped boards, sandbags on the feet -- with a ROAD CLOSED sign on the
    // middle one and cones at the curbs (gamemapconstructionsign.jpg). All of
    // them together are a handful of instanced meshes; each barricade has one
    // simple box collider (you can see and shoot over/through them).
    // ------------------------------------------------------------------
    {
      const stripeTexture = canvasTexture(256, 32, (ctx, w, h) => {
        ctx.fillStyle = "#f4f2ec";
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = "#ee6f1c";
        for (let x = -h; x < w + h; x += 44) {
          ctx.beginPath();
          ctx.moveTo(x, h);
          ctx.lineTo(x + 22, h);
          ctx.lineTo(x + 22 + h, 0);
          ctx.lineTo(x + h, 0);
          ctx.closePath();
          ctx.fill();
        }
      });
      const signTexture = canvasTexture(256, 160, (ctx, w, h) => {
        ctx.fillStyle = "#f7f7f5";
        ctx.fillRect(0, 0, w, h);
        ctx.strokeStyle = "#151515";
        ctx.lineWidth = 7;
        ctx.strokeRect(9, 9, w - 18, h - 18);
        ctx.fillStyle = "#151515";
        ctx.font = "bold 50px Arial";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("ROAD", w / 2, h * 0.34);
        ctx.fillText("CLOSED", w / 2, h * 0.68);
      });
      const white = new THREE.MeshLambertMaterial({ color: 0xf2f0ea });
      const faces = (front) => [white, white, white, white, front, front]; // BoxGeometry: +x -x +y -y +z -z
      const boardMaterials = faces(new THREE.MeshLambertMaterial({ map: stripeTexture }));
      // the sign reads only on its front (toward the map); its back is blank
      const signMaterials = [white, white, white, white, new THREE.MeshLambertMaterial({ map: signTexture }), white];
      const metal = new THREE.MeshLambertMaterial({ color: 0x9aa1a8 });
      const burlap = new THREE.MeshLambertMaterial({ color: 0xb36a33 });
      const coneOrange = new THREE.MeshLambertMaterial({ color: 0xf2661d });
      const box = new THREE.BoxGeometry(1, 1, 1);
      const coneGeo = new THREE.ConeGeometry(0.17, 0.66, 10);
      coneGeo.translate(0, 0.04 + 0.33, 0); // sits on its base
      const coneBase = new THREE.MeshLambertMaterial({ color: 0x1d1d1d });

      const parts = { board: [], sign: [], metal: [], bag: [], cone: [], coneBase: [], swPanel: [], swSign: [], swFoot: [] };
      // SIDEWALK CLOSED barricades (gamemapsidewalksign.jpg): an orange
      // plastic panel with open vertical slots and a white sign, about 60%
      // the height of the road barricades, on both sidewalks of every closed
      // street. The slots are an alpha-tested texture (still one cheap
      // opaque pass).
      const swPanelTexture = canvasTexture(256, 128, (ctx, w, h) => {
        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = "#ec5a1a";
        ctx.fillRect(0, 0, w, h);
        for (let i = 0; i < 11; i++) {
          const x = 14 + i * 21.5;
          ctx.clearRect(x, 34, 11, 70); // slots
        }
        ctx.fillStyle = "#c9460f";
        ctx.fillRect(0, 0, w, 6);
        ctx.fillRect(0, h - 8, w, 8);
      });
      // A molded panel with real thickness: slotted faces front and back,
      // solid orange edges.
      const swSlotted = new THREE.MeshLambertMaterial({ map: swPanelTexture, alphaTest: 0.5 });
      const swOrange = new THREE.MeshLambertMaterial({ color: 0xe0561a });
      const swPanelMaterial = [swOrange, swOrange, swOrange, swOrange, swSlotted, swSlotted];
      const swSignTexture = canvasTexture(256, 96, (ctx, w, h) => {
        ctx.fillStyle = "#f7f7f5";
        ctx.fillRect(0, 0, w, h);
        ctx.strokeStyle = "#151515";
        ctx.lineWidth = 6;
        ctx.strokeRect(7, 7, w - 14, h - 14);
        ctx.fillStyle = "#151515";
        ctx.font = "bold 34px Arial";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("SIDEWALK", w / 2, h * 0.33);
        ctx.fillText("CLOSED", w / 2, h * 0.7);
      });
      const swSignMaterials = [white, white, white, white, new THREE.MeshLambertMaterial({ map: swSignTexture }), white];
      const SW_PANEL_DEPTH_M = 0.09;
      const swSidewalkOffsetPx = SIDEWALK_GAP_PX + SIDEWALK_WIDTH_PX / 2;
      const mapCenter = mapToWorld((MAP_BOUNDS[0] + MAP_BOUNDS[2]) / 2, (MAP_BOUNDS[1] + MAP_BOUNDS[3]) / 2);
      // Invisible wall across the whole street (road + sidewalks) at every
      // barricade, tall enough that nobody jumps or flies over it.
      const BARRIER_HEIGHT_M = 200;
      const barrierExtraPx = SIDEWALK_GAP_PX + SIDEWALK_WIDTH_PX + 2;
      const unitMatrix = new THREE.Matrix4();
      const localMatrix = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const yAxis = new THREE.Vector3(0, 1, 0);
      const put = (list, lx, ly, lz, sx, sy, sz) => {
        localMatrix.compose(new THREE.Vector3(lx, ly, lz), new THREE.Quaternion(), new THREE.Vector3(sx, sy, sz));
        list.push(new THREE.Matrix4().multiplyMatrices(unitMatrix, localMatrix));
      };
      const UNIT_W = 2.4;
      for (const [px, py, axis, widthPx, options = {}] of BARRICADES) {
        const center = mapToWorld(px, py);
        const along = axis === "x" ? { x: 1, z: 0 } : { x: 0, z: 1 };
        // Local +z (the barricade's front: sign text, sandbags) faces into the map.
        let yaw = Math.atan2(-along.z, along.x);
        const facePoint = options.face ? mapToWorld(options.face[0], options.face[1]) : mapCenter;
        const inX = facePoint.x - center.x, inZ = facePoint.z - center.z;
        if (Math.sin(yaw) * inX + Math.cos(yaw) * inZ < 0) yaw += Math.PI;
        q.setFromAxisAngle(yAxis, yaw);
        const length = widthPx * MAP_SCALE;
        const count = Math.max(2, Math.round(length / 2.5));
        const spacing = length / count;
        const signIndex = Math.floor((count - 1) / 2);
        for (let i = 0; i < count; i++) {
          const t = -length / 2 + spacing * (i + 0.5);
          // Every other unit sits a little forward/back, like the photo.
          const stagger = i % 2 === 0 ? 0.25 : -0.25;
          const cx = center.x + along.x * t + along.z * stagger;
          const cz = center.z + along.z * t + along.x * stagger;
          unitMatrix.compose(new THREE.Vector3(cx, 0, cz), q, new THREE.Vector3(1, 1, 1));
          for (const lx of [-0.95, 0.95]) {
            put(parts.metal, lx, 0.73, 0, 0.05, 1.46, 0.05);   // leg
            put(parts.metal, lx, 0.025, 0, 0.07, 0.05, 0.85);  // foot
            put(parts.bag, lx, 0.09, 0.28, 0.42, 0.17, 0.26);  // sandbag
          }
          for (const y of [0.45, 0.86, 1.27]) put(parts.board, 0, y, 0, UNIT_W, 0.24, 0.035);
          if (i === signIndex) {
            for (const lx of [-0.45, 0.45]) put(parts.metal, lx, 1.8, 0, 0.05, 0.7, 0.05);
            put(parts.sign, 0, 1.86, 0.02, 1.3, 0.8, 0.04);
          }
          const collider = makeCollider(cx, cz, UNIT_W / 2, 0.45, 1.4, yaw);
          collider.render = false;
          collider.seeThrough = true;
          const zone = zones[ZONES.indexOf(zoneAt(px, py))];
          zone.colliders.push(collider);
        }
        // cones (on square black bases) just outside each end of the row
        for (const end of [-1, 1]) {
          const t = end * (length / 2 + 0.5);
          unitMatrix.compose(new THREE.Vector3(center.x + along.x * t, 0, center.z + along.z * t), q, new THREE.Vector3(1, 1, 1));
          for (const [cx0, cz0] of [[0, 0.6], [0.1, -0.7]]) {
            put(parts.cone, cx0, 0, cz0, 1, 1, 1);
            put(parts.coneBase, cx0, 0.02, cz0, 0.42, 0.04, 0.42);
          }
        }
        // SIDEWALK CLOSED barricade on each sidewalk, in line with the row
        for (const side of [-1, 1]) {
          const t = side * (widthPx / 2 + swSidewalkOffsetPx) * MAP_SCALE;
          unitMatrix.compose(new THREE.Vector3(center.x + along.x * t, 0, center.z + along.z * t), q, new THREE.Vector3(1, 1, 1));
          put(parts.swPanel, 0, 0.62, 0, 2.0, 1.0, SW_PANEL_DEPTH_M); // panel, 0.12 -> 1.12 m
          put(parts.swSign, 0, 0.92, 0.04, 0.95, 0.36, 0.03);   // sign, top ~1.1 m
          for (const lx of [-0.85, 0.85]) put(parts.swFoot, lx, 0.06, 0, 0.18, 0.12, 0.5); // feet
          // solid, like the road barricades (you can see and shoot through the slots)
          const sx = center.x + along.x * t, sz = center.z + along.z * t;
          const swCollider = makeCollider(sx, sz, 1.0, 0.25, 1.12, yaw);
          swCollider.render = false;
          swCollider.seeThrough = true;
          zones[ZONES.indexOf(zoneAt(px, py))].colliders.push(swCollider);
        }
        // invisible barrier across the full street width (map-edge closures only)
        if (options.barrier === false) continue;
        const barrierLength = (widthPx + barrierExtraPx * 2) * MAP_SCALE;
        const barrier = makeCollider(center.x, center.z, barrierLength / 2, 0.3, BARRIER_HEIGHT_M, yaw);
        barrier.render = false;
        barrier.seeThrough = true;
        zones[ZONES.indexOf(zoneAt(px, py))].colliders.push(barrier);
      }
      // ---- The playable area's edge: invisible walls strung between the
      // border-row houses (north, west, south), so the only way past a house
      // row is... nowhere. They also close every street through the row, so
      // each ROAD CLOSED barricade is joined to the houses on either side.
      const addWall = (ax, ay, bx, by) => {
        const a = mapToWorld(ax, ay), b = mapToWorld(bx, by);
        const len = Math.hypot(b.x - a.x, b.z - a.z);
        if (len < 0.05) return;
        const wall = makeCollider((a.x + b.x) / 2, (a.z + b.z) / 2, len / 2 + 0.3, 0.3, BARRIER_HEIGHT_M,
          Math.atan2(-(b.z - a.z), b.x - a.x));
        wall.render = false;
        wall.seeThrough = true;
        zones[ZONES.indexOf(zoneAt((ax + bx) / 2, (ay + by) / 2))].colliders.push(wall);
      };
      const rows = { north: [], west: [], south: [] };
      for (const h of BORDER_HOUSES) {
        const cx = (h[0] + h[2]) / 2, cy = (h[1] + h[3]) / 2;
        if (cy < -5) rows.north.push(h);
        else if (cy > 695) rows.south.push(h);
        else if (cx < -5) rows.west.push(h);
      }
      for (const name of ["north", "south"]) {
        const row = rows[name].sort((p1, p2) => p1[0] - p2[0]);
        let px = MAP_BOUNDS[0], py = (row[0][1] + row[0][3]) / 2;
        for (const h of row) {
          const cy = (h[1] + h[3]) / 2;
          addWall(px, py, h[0], cy);
          px = h[2];
          py = cy;
        }
        addWall(px, py, MAP_BOUNDS[2], py);
      }
      {
        const row = rows.west.sort((p1, p2) => p1[1] - p2[1]);
        let px = (row[0][0] + row[0][2]) / 2, py = MAP_BOUNDS[1];
        for (const h of row) {
          const cx = (h[0] + h[2]) / 2;
          addWall(px, py, cx, h[1]);
          px = cx;
          py = h[3];
        }
        addWall(px, py, px, MAP_BOUNDS[3]);
      }

      const addInstanced = (geometry, material, matrices) => {
        if (matrices.length === 0) return;
        const mesh = new THREE.InstancedMesh(geometry, material, matrices.length);
        matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
        mesh.instanceMatrix.needsUpdate = true;
        mesh.frustumCulled = false; // spread over the whole map edge; cheap enough to always draw
        root.add(mesh);
      };
      addInstanced(box, boardMaterials, parts.board);
      addInstanced(box, signMaterials, parts.sign);
      addInstanced(box, metal, parts.metal);
      addInstanced(box, burlap, parts.bag);
      addInstanced(coneGeo, coneOrange, parts.cone);
      addInstanced(box, coneBase, parts.coneBase);
      addInstanced(box, swPanelMaterial, parts.swPanel);
      addInstanced(box, swSignMaterials, parts.swSign);
      addInstanced(box, new THREE.MeshLambertMaterial({ color: 0x222222 }), parts.swFoot);

      // ---- Railway along the east edge, just past 20th St: ballast, ties
      // and two rails about 10 m east of the sidewalk, then a chain-link
      // fence a little beyond -- the map's east border (see MAP_BOUNDS).
      const RAIL_X_PX = 1915;
      const RAIL_FENCE_X_PX = 1924;
      const railStart = mapToWorld(RAIL_X_PX, MAP_BOUNDS[1] - 220);
      const railEnd = mapToWorld(RAIL_X_PX, MAP_BOUNDS[3] + 220);
      const railLength = railEnd.z - railStart.z;
      const railMidZ = (railStart.z + railEnd.z) / 2;
      const ballast = new THREE.MeshLambertMaterial({ map: canvasTexture(64, 64, (ctx, w, h) => speckle(ctx, w, h, "#8b857c", 900, 0.25, 11)) });
      ballast.map.repeat.set(1, railLength / 4);
      const ballastMesh = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.35, railLength), ballast);
      ballastMesh.position.set(railStart.x, 0.175, railMidZ);
      root.add(ballastMesh);
      // The raised ballast bed is walkable: low enough to step up onto.
      const ballastCollider = makeCollider(railStart.x, railMidZ, 1.7, railLength / 2, 0.35, 0);
      ballastCollider.render = false;
      ballastCollider.seeThrough = true;
      zones[ZONES.indexOf(zoneAt(RAIL_X_PX, 300))].colliders.push(ballastCollider);
      const tieMatrices = [];
      const tie = new THREE.Matrix4();
      for (let z = railStart.z; z < railEnd.z; z += 0.6) {
        tie.compose(new THREE.Vector3(railStart.x, 0.4, z), new THREE.Quaternion(), new THREE.Vector3(2.6, 0.14, 0.24));
        tieMatrices.push(tie.clone());
      }
      addInstanced(box, new THREE.MeshLambertMaterial({ color: 0x5a4636 }), tieMatrices);
      const steel = new THREE.MeshLambertMaterial({ color: 0x6f6a66 });
      for (const offset of [-0.72, 0.72]) {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.15, railLength), steel);
        rail.position.set(railStart.x + offset, 0.545, railMidZ);
        root.add(rail);
      }
      const fenceX = mapToWorld(RAIL_FENCE_X_PX, 0).x;
      const fenceMaterial = new THREE.MeshLambertMaterial({ color: 0x8a9096, transparent: true, opacity: 0.75 });
      const railFence = new THREE.Mesh(new THREE.BoxGeometry(0.06, 2.1, railLength), fenceMaterial);
      railFence.position.set(fenceX, 1.05, railMidZ);
      root.add(railFence);
      const postMatrices = [];
      for (let z = railStart.z; z < railEnd.z; z += 3) {
        tie.compose(new THREE.Vector3(fenceX, 1.1, z), new THREE.Quaternion(), new THREE.Vector3(0.09, 2.2, 0.09));
        postMatrices.push(tie.clone());
      }
      addInstanced(box, metal, postMatrices);
    }

    // ------------------------------------------------------------------
    // WORLD QUERIES -- everything the games need to know about the campus
    // without touching the whole map: all of it goes through a static
    // bucket grid of the colliders (built once here), so every query only
    // looks at the handful of colliders near the point/segment asked about.
    // ------------------------------------------------------------------
    const STEP_UP_M = options.stepUpHeight !== undefined ? options.stepUpHeight : 0.5;
    const SIGHT_MIN_HEIGHT_M = 1.2;  // shorter than this doesn't block line of sight (curbs, low steps)
    const SIGHT_MAX_BASE_M = 1.6;    // raised pieces above this (lintels, roof slabs) don't either

    const worldColliders = zones.flatMap((z) => z.colliders).filter((c) => c.collide !== false);
    const BUCKET_M = 16;
    const bucketOriginX = bounds.minX - GROUND_MARGIN;
    const bucketOriginZ = bounds.minZ - GROUND_MARGIN;
    const bucketCols = Math.ceil((bounds.maxX - bounds.minX + GROUND_MARGIN * 2) / BUCKET_M);
    const bucketRows = Math.ceil((bounds.maxZ - bounds.minZ + GROUND_MARGIN * 2) / BUCKET_M);
    const buckets = new Array(bucketCols * bucketRows);
    const bucketCol = (x) => Math.min(bucketCols - 1, Math.max(0, Math.floor((x - bucketOriginX) / BUCKET_M)));
    const bucketRow = (z) => Math.min(bucketRows - 1, Math.max(0, Math.floor((z - bucketOriginZ) / BUCKET_M)));
    for (const c of worldColliders) {
      c.stamp = 0;
      for (let row = bucketRow(c.minZ); row <= bucketRow(c.maxZ); row++) {
        for (let col = bucketCol(c.minX); col <= bucketCol(c.maxX); col++) {
          const i = row * bucketCols + col;
          (buckets[i] || (buckets[i] = [])).push(c);
        }
      }
    }
    // Colliders overlapping a world-space box, each visited once.
    let queryStamp = 0;
    function forEachColliderIn(minX, minZ, maxX, maxZ, visit) {
      queryStamp++;
      for (let row = bucketRow(minZ); row <= bucketRow(maxZ); row++) {
        for (let col = bucketCol(minX); col <= bucketCol(maxX); col++) {
          const list = buckets[row * bucketCols + col];
          if (!list) continue;
          for (const c of list) {
            if (c.stamp === queryStamp) continue;
            c.stamp = queryStamp;
            if (c.maxX < minX || c.minX > maxX || c.maxZ < minZ || c.minZ > maxZ) continue;
            if (visit(c) === true) return true;
          }
        }
      }
      return false;
    }

    function toLocal(c, x, z) {
      const dx = x - c.cx;
      const dz = z - c.cz;
      return { x: dx * c.cos - dz * c.sin, z: dx * c.sin + dz * c.cos };
    }
    function toWorld(c, lx, lz) {
      return { x: c.cx + lx * c.cos + lz * c.sin, z: c.cz - lx * c.sin + lz * c.cos };
    }

    // Does collider c block a body whose feet are at feetY?
    function blocksBody(c, feetY, grounded, bodyHeight) {
      if (feetY >= c.height - 0.01) return false;                  // standing above it
      if (c.base && feetY + bodyHeight <= c.base) return false;     // passing under it (door lintel)
      if (grounded && c.height - feetY <= STEP_UP_M) return false;  // low enough to step onto
      return true;
    }

    // Pushes body.x/body.z (any object with those, e.g. a THREE.Vector3)
    // out of every building/prop/tree trunk it overlaps.
    function resolveCircle(body, radius, feetY = 0, grounded = true, bodyHeight = 1.85) {
      for (let pass = 0; pass < 2; pass++) {
        forEachColliderIn(body.x - radius, body.z - radius, body.x + radius, body.z + radius, (c) => {
          if (!blocksBody(c, feetY, grounded, bodyHeight)) return;
          if (c.shape === "cylinder") {
            const dx = body.x - c.cx;
            const dz = body.z - c.cz;
            const minDist = c.radius + radius;
            const distSq = dx * dx + dz * dz;
            if (distSq >= minDist * minDist) return;
            const dist = Math.sqrt(distSq);
            if (dist < 1e-6) {
              body.x = c.cx + minDist;
              return;
            }
            body.x = c.cx + (dx / dist) * minDist;
            body.z = c.cz + (dz / dist) * minDist;
            return;
          }
          const local = toLocal(c, body.x, body.z);
          const qx = Math.max(-c.halfX, Math.min(local.x, c.halfX));
          const qz = Math.max(-c.halfZ, Math.min(local.z, c.halfZ));
          const dx = local.x - qx;
          const dz = local.z - qz;
          const distSq = dx * dx + dz * dz;
          if (distSq >= radius * radius) return;
          let out;
          if (distSq > 1e-8) {
            const dist = Math.sqrt(distSq);
            out = { x: qx + (dx / dist) * radius, z: qz + (dz / dist) * radius };
          } else {
            // Center is inside the box: push out through the nearest face.
            const pushes = [
              { d: local.x + c.halfX, x: -c.halfX - radius, z: local.z },
              { d: c.halfX - local.x, x: c.halfX + radius, z: local.z },
              { d: local.z + c.halfZ, x: local.x, z: -c.halfZ - radius },
              { d: c.halfZ - local.z, x: local.x, z: c.halfZ + radius },
            ];
            pushes.sort((a, b) => a.d - b.d);
            out = pushes[0];
          }
          const w = toWorld(c, out.x, out.z);
          body.x = w.x;
          body.z = w.z;
        });
      }
    }

    // Highest surface under a footprint that's at or below fromY: the
    // ground (0, or a construction-pit step) or a roof/step top.
    function supportHeightAt(x, z, radius, fromY) {
      let support = groundHeightAt(x, z);
      forEachColliderIn(x - radius, z - radius, x + radius, z + radius, (c) => {
        if (c.height > fromY + 0.01 || c.height <= support) return;
        if (c.shape === "cylinder") {
          const r = c.radius + radius;
          if ((x - c.cx) ** 2 + (z - c.cz) ** 2 < r * r) support = c.height;
          return;
        }
        const local = toLocal(c, x, z);
        const dx = local.x - Math.max(-c.halfX, Math.min(local.x, c.halfX));
        const dz = local.z - Math.max(-c.halfZ, Math.min(local.z, c.halfZ));
        if (dx * dx + dz * dz < radius * radius) support = c.height;
      });
      return support;
    }

    function blocksSight(c) {
      return !c.isTree && !c.seeThrough && c.height >= SIGHT_MIN_HEIGHT_M && !(c.base > SIGHT_MAX_BASE_M);
    }

    // True if the segment (x1,z1)-(x2,z2), widened by `clearance`, crosses
    // anything that blocks sight/passage (buildings, walls, bleachers --
    // not trees, fences, curbs or overhead slabs). Analytic, no sampling.
    // includeFences: fences count too -- you can see (and shoot) through
    // chain-link, but nothing walks or reaches through it.
    function segmentBlocked(x1, z1, x2, z2, clearance = 0, includeFences = false) {
      const pad = clearance + 0.01;
      return forEachColliderIn(Math.min(x1, x2) - pad, Math.min(z1, z2) - pad, Math.max(x1, x2) + pad, Math.max(z1, z2) + pad, (c) => {
        if (!blocksSight(c) && !(includeFences && c.seeThrough && c.height >= SIGHT_MIN_HEIGHT_M)) return false;
        if (c.shape === "cylinder") {
          const dx = x2 - x1, dz = z2 - z1;
          const len2 = dx * dx + dz * dz || 1e-9;
          const t = Math.max(0, Math.min(1, ((c.cx - x1) * dx + (c.cz - z1) * dz) / len2));
          return Math.hypot(c.cx - (x1 + dx * t), c.cz - (z1 + dz * t)) < c.radius + clearance;
        }
        // Liang-Barsky clip against the box (grown by clearance) in its own frame.
        const a = toLocal(c, x1, z1);
        const b = toLocal(c, x2, z2);
        const hx = c.halfX + clearance, hz = c.halfZ + clearance;
        let t0 = 0, t1 = 1;
        const ddx = b.x - a.x, ddz = b.z - a.z;
        const clip = (p, q) => {
          if (Math.abs(p) < 1e-12) return q >= 0;
          const r = q / p;
          if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; } else { if (r < t0) return false; if (r < t1) t1 = r; }
          return true;
        };
        return clip(-ddx, a.x + hx) && clip(ddx, hx - a.x) && clip(-ddz, a.z + hz) && clip(ddz, hz - a.z) && t0 <= t1;
      });
    }

    // Can a body of this radius stand at (x, z)? (inside the playable area,
    // not overlapping any building/prop/trunk it couldn't step onto)
    function isWalkable(x, z, radius = 0.4) {
      if (x < bounds.minX + radius || x > bounds.maxX - radius || z < bounds.minZ + radius || z > bounds.maxZ - radius) return false;
      return !forEachColliderIn(x - radius, z - radius, x + radius, z + radius, (c) => {
        if (!blocksBody(c, 0, true, 1.85)) return false;
        if (c.shape === "cylinder") return (x - c.cx) ** 2 + (z - c.cz) ** 2 < (c.radius + radius) ** 2;
        const local = toLocal(c, x, z);
        const dx = local.x - Math.max(-c.halfX, Math.min(local.x, c.halfX));
        const dz = local.z - Math.max(-c.halfZ, Math.min(local.z, c.halfZ));
        return dx * dx + dz * dz < radius * radius;
      });
    }

    // Distance (capped at maxDistance) from (x, z) to the nearest thing
    // that blocks sight -- for "near a building" spawn weighting.
    // A few spawn-spot suggestions ahead of a player that are hidden from
    // them: for each sight-blocking building roughly ahead (within halfAngle
    // of the direction, between minR and maxR), the spot just past its far
    // side on the player's line. One bucket-grid query; the spawn manager
    // still validates every suggestion (walkable, really hidden, etc.).
    function spotsBehindBuildings(px, pz, dirX, dirZ, minR, maxR, halfAngle, count) {
      const cosLimit = Math.cos(halfAngle);
      const cx = px + dirX * (minR + maxR) / 2, cz = pz + dirZ * (minR + maxR) / 2;
      const half = maxR * 0.75;
      const found = [];
      forEachColliderIn(cx - half, cz - half, cx + half, cz + half, (c) => {
        if (!blocksSight(c) || c.height < 2.5) return;
        const vx = c.cx - px, vz = c.cz - pz;
        const d = Math.hypot(vx, vz);
        if (d < 1) return;
        if ((vx * dirX + vz * dirZ) / d < cosLimit) return;
        const reach = Math.max(c.halfX, c.halfZ) + 3;
        const r = d + reach;
        if (r < minR || r > maxR + 3) return;
        found.push({ x: c.cx + (vx / d) * reach, z: c.cz + (vz / d) * reach });
      });
      // a random few, so the same building isn't always the one
      for (let i = found.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [found[i], found[j]] = [found[j], found[i]];
      }
      return found.slice(0, count);
    }

    function distanceToNearestBuilding(x, z, maxDistance) {
      let best = maxDistance;
      forEachColliderIn(x - maxDistance, z - maxDistance, x + maxDistance, z + maxDistance, (c) => {
        if (!blocksSight(c)) return;
        let d;
        if (c.shape === "cylinder") {
          d = Math.hypot(x - c.cx, z - c.cz) - c.radius;
        } else {
          const local = toLocal(c, x, z);
          d = Math.hypot(local.x - Math.max(-c.halfX, Math.min(local.x, c.halfX)), local.z - Math.max(-c.halfZ, Math.min(local.z, c.halfZ)));
        }
        if (d < best) best = d;
      });
      return Math.max(0, best);
    }

    // ---- Fenced areas (FENCED_AREAS): which side of each fence a point is
    // on, and the ways through. A handful of small polygons -- cheap.
    const toPx = (x, z) => [x / MAP_SCALE + MAP_CENTER_X, z / MAP_SCALE + MAP_CENTER_Y];
    const enclosures = FENCED_AREAS.map((area) => ({
      name: area.name,
      outline: area.outline,
      // world-space points just inside / just outside each way through
      passages: [...area.gates, ...area.openings].map(([gx, gy]) => {
        const center = mapToWorld(gx, gy);
        return { x: center.x, z: center.z };
      }),
    }));
    // Bitmask: bit i set if (x, z) is inside FENCED_AREAS[i].
    function enclosureMask(x, z) {
      const [px, py] = toPx(x, z);
      let mask = 0;
      enclosures.forEach((e, i) => {
        if (pointInPolygon(px, py, e.outline)) mask |= 1 << i;
      });
      return mask;
    }
    // Can something at (bx, bz) get to (ax, az) without going over a fence?
    // Same side of every fence, or within nearGate meters of a way through
    // the fence it would have to cross.
    function isSameFenceSide(ax, az, bx, bz, nearGate = 0) {
      const diff = enclosureMask(ax, az) ^ enclosureMask(bx, bz);
      if (!diff) return true;
      return enclosures.every((e, i) => !(diff & (1 << i)) ||
        e.passages.some((g) => Math.hypot(g.x - bx, g.z - bz) <= nearGate));
    }
    // Where to head first when a fence is in the way: a point a few meters
    // past the best way through (on the goal's side), or null if no fence
    // separates the two points (or the fenced area has no way in at all).
    function fenceWaypoint(sx, sz, gx, gz) {
      const diff = enclosureMask(sx, sz) ^ enclosureMask(gx, gz);
      if (!diff) return null;
      const i = enclosures.findIndex((_, k) => diff & (1 << k));
      const e = enclosures[i];
      let best = null, bestCost = Infinity;
      for (const g of e.passages) {
        const cost = Math.hypot(g.x - sx, g.z - sz) + Math.hypot(gx - g.x, gz - g.z);
        if (cost < bestCost) { bestCost = cost; best = g; }
      }
      if (!best) return null;
      // step through: just past the gap, toward the goal's side
      const goalInside = !!(enclosureMask(gx, gz) & (1 << i));
      for (const r of [3, 5]) {
        for (let k = 0; k < 8; k++) {
          const a = (k / 8) * Math.PI * 2;
          const x = best.x + Math.cos(a) * r, z = best.z + Math.sin(a) * r;
          const [px, py] = toPx(x, z);
          if (pointInPolygon(px, py, e.outline) === goalInside && isWalkable(x, z, 0.4) &&
            !segmentBlocked(best.x, best.z, x, z, 0.35, true)) {
            if (Math.hypot(best.x - sx, best.z - sz) < 2.5) return { x, z };
            return { x: best.x, z: best.z, through: { x, z } };
          }
        }
      }
      return { x: best.x, z: best.z };
    }

    const hollowRects = HOLLOW_BUILDINGS.map(rectToWorld);
    function isInsideHollowBuilding(x, z) {
      return hollowRects.some((r) => x > r.minX && x < r.maxX && z > r.minZ && z < r.maxZ);
    }

    // ------------------------------------------------------------------
    // LOCAL NAVIGATION -- walkability is rasterized lazily in small chunks
    // (only where something actually asks for a path), and A* only ever
    // searches a small window around the start and goal. Nothing here scans
    // or precomputes the whole map.
    // ------------------------------------------------------------------
    const NAV_CELL_M = 1;
    const NAV_CHUNK_CELLS = 32;
    const NAV_CLEARANCE_M = 0.4;
    const NAV_WINDOW_CELLS = 96;          // A* never searches beyond a 96 m square
    const NAV_MAX_EXPANSIONS = 2500;
    const NAV_CHUNK_CACHE_LIMIT = 400;    // ~400 KB worst case, oldest dropped first
    const navChunks = new Map();

    function rasterizeNavChunk(chunkX, chunkZ) {
      const cells = new Uint8Array(NAV_CHUNK_CELLS * NAV_CHUNK_CELLS);
      const x0 = chunkX * NAV_CHUNK_CELLS * NAV_CELL_M;
      const z0 = chunkZ * NAV_CHUNK_CELLS * NAV_CELL_M;
      const span = NAV_CHUNK_CELLS * NAV_CELL_M;
      const nearby = [];
      forEachColliderIn(x0 - NAV_CLEARANCE_M, z0 - NAV_CLEARANCE_M, x0 + span + NAV_CLEARANCE_M, z0 + span + NAV_CLEARANCE_M, (c) => {
        if (blocksBody(c, 0, true, 1.85)) nearby.push(c);
      });
      for (let j = 0; j < NAV_CHUNK_CELLS; j++) {
        for (let i = 0; i < NAV_CHUNK_CELLS; i++) {
          const x = x0 + (i + 0.5) * NAV_CELL_M;
          const z = z0 + (j + 0.5) * NAV_CELL_M;
          let walkable = x > bounds.minX + NAV_CLEARANCE_M && x < bounds.maxX - NAV_CLEARANCE_M &&
            z > bounds.minZ + NAV_CLEARANCE_M && z < bounds.maxZ - NAV_CLEARANCE_M;
          for (let k = 0; walkable && k < nearby.length; k++) {
            const c = nearby[k];
            if (c.shape === "cylinder") {
              if ((x - c.cx) ** 2 + (z - c.cz) ** 2 < (c.radius + NAV_CLEARANCE_M) ** 2) walkable = false;
            } else {
              const local = toLocal(c, x, z);
              const dx = local.x - Math.max(-c.halfX, Math.min(local.x, c.halfX));
              const dz = local.z - Math.max(-c.halfZ, Math.min(local.z, c.halfZ));
              if (dx * dx + dz * dz < NAV_CLEARANCE_M * NAV_CLEARANCE_M) walkable = false;
            }
          }
          cells[j * NAV_CHUNK_CELLS + i] = walkable ? 1 : 0;
        }
      }
      return cells;
    }

    function navWalkableCell(cx, cz) {
      const chunkX = Math.floor(cx / NAV_CHUNK_CELLS);
      const chunkZ = Math.floor(cz / NAV_CHUNK_CELLS);
      const key = chunkZ * 100000 + chunkX;
      let cells = navChunks.get(key);
      if (!cells) {
        if (navChunks.size >= NAV_CHUNK_CACHE_LIMIT) navChunks.delete(navChunks.keys().next().value);
        cells = rasterizeNavChunk(chunkX, chunkZ);
        navChunks.set(key, cells);
      }
      return cells[(cz - chunkZ * NAV_CHUNK_CELLS) * NAV_CHUNK_CELLS + (cx - chunkX * NAV_CHUNK_CELLS)] === 1;
    }

    const navWindowSize = NAV_WINDOW_CELLS * NAV_WINDOW_CELLS;
    const navG = new Float32Array(navWindowSize);
    const navFrom = new Int32Array(navWindowSize);
    const navState = new Uint8Array(navWindowSize); // 0 unseen, 1 open, 2 closed
    const navHeap = [];
    const NAV_NEIGHBORS = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];

    // Nearest walkable cell within a few cells of (cx, cz), or null.
    function nearestWalkableCell(cx, cz, inWindow) {
      for (let r = 0; r <= 3; r++) {
        for (let dz = -r; dz <= r; dz++) {
          for (let dx = -r; dx <= r; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
            if (inWindow(cx + dx, cz + dz) && navWalkableCell(cx + dx, cz + dz)) return { cx: cx + dx, cz: cz + dz };
          }
        }
      }
      return null;
    }

    // Grid A* from (sx, sz) toward (gx, gz), world units. Returns cell-center
    // waypoints (start excluded), [] if already there, or null if no route
    // was found within the window/expansion budget. A goal farther away than
    // the window allows is pulled in along the straight line, so a far chase
    // still gets a sensible partial route instead of a map-wide search.
    function findPath(sx, sz, gx, gz) {
      // A fence between here and the goal: route to (and through) a gate
      // first -- the next repath, once on the goal's side, goes straight on.
      const via = fenceWaypoint(sx, sz, gx, gz);
      if (via) {
        const toGate = findPathLocal(sx, sz, via.x, via.z);
        if (toGate && via.through) toGate.push({ x: via.through.x, z: via.through.z });
        return toGate;
      }
      return findPathLocal(sx, sz, gx, gz);
    }

    function findPathLocal(sx, sz, gx, gz) {
      const half = NAV_WINDOW_CELLS / 2 - 2;
      let scx = Math.floor(sx / NAV_CELL_M), scz = Math.floor(sz / NAV_CELL_M);
      let gcx = Math.floor(gx / NAV_CELL_M), gcz = Math.floor(gz / NAV_CELL_M);
      const span = Math.max(Math.abs(gcx - scx), Math.abs(gcz - scz));
      if (span > half * 2) {
        const t = (half * 2) / span;
        gcx = scx + Math.round((gcx - scx) * t);
        gcz = scz + Math.round((gcz - scz) * t);
      }
      const originX = Math.floor((scx + gcx) / 2) - NAV_WINDOW_CELLS / 2;
      const originZ = Math.floor((scz + gcz) / 2) - NAV_WINDOW_CELLS / 2;
      const inWindow = (cx, cz) => cx >= originX && cx < originX + NAV_WINDOW_CELLS && cz >= originZ && cz < originZ + NAV_WINDOW_CELLS;
      const start = nearestWalkableCell(scx, scz, inWindow);
      let goal = nearestWalkableCell(gcx, gcz, inWindow);
      // Goal inside a building (e.g. a far goal pulled in along the line):
      // back off toward the start until there's somewhere to stand.
      for (let k = 1; !goal && k <= 12; k++) {
        const t = 1 - k / 12;
        goal = nearestWalkableCell(scx + Math.round((gcx - scx) * t), scz + Math.round((gcz - scz) * t), inWindow);
      }
      if (!start || !goal) return null;
      const toIndex = (cx, cz) => (cz - originZ) * NAV_WINDOW_CELLS + (cx - originX);
      const startIndex = toIndex(start.cx, start.cz);
      const goalIndex = toIndex(goal.cx, goal.cz);
      if (startIndex === goalIndex) return [];

      navState.fill(0);
      navG[startIndex] = 0;
      navFrom[startIndex] = -1;
      navState[startIndex] = 1;
      const h = (index) => Math.hypot((index % NAV_WINDOW_CELLS) - (goalIndex % NAV_WINDOW_CELLS),
        ((index / NAV_WINDOW_CELLS) | 0) - ((goalIndex / NAV_WINDOW_CELLS) | 0));
      // Binary heap of [f, index].
      navHeap.length = 0;
      const push = (f, index) => {
        navHeap.push([f, index]);
        let i = navHeap.length - 1;
        while (i > 0) {
          const p = (i - 1) >> 1;
          if (navHeap[p][0] <= navHeap[i][0]) break;
          [navHeap[p], navHeap[i]] = [navHeap[i], navHeap[p]];
          i = p;
        }
      };
      const pop = () => {
        const top = navHeap[0];
        const last = navHeap.pop();
        if (navHeap.length > 0) {
          navHeap[0] = last;
          let i = 0;
          for (;;) {
            const l = i * 2 + 1, r = l + 1;
            let m = i;
            if (l < navHeap.length && navHeap[l][0] < navHeap[m][0]) m = l;
            if (r < navHeap.length && navHeap[r][0] < navHeap[m][0]) m = r;
            if (m === i) break;
            [navHeap[m], navHeap[i]] = [navHeap[i], navHeap[m]];
            i = m;
          }
        }
        return top;
      };
      push(h(startIndex), startIndex);
      let expansions = 0;
      let found = false;
      let closest = startIndex; // best partial progress, if the goal isn't reached
      let closestH = h(startIndex);
      while (navHeap.length > 0) {
        const [, current] = pop();
        if (navState[current] === 2) continue;
        navState[current] = 2;
        if (current === goalIndex) { found = true; break; }
        const hc = h(current);
        if (hc < closestH) { closestH = hc; closest = current; }
        if (++expansions > NAV_MAX_EXPANSIONS) break;
        const lx = current % NAV_WINDOW_CELLS, lz = (current / NAV_WINDOW_CELLS) | 0;
        const cx = lx + originX, cz = lz + originZ;
        for (const [dx, dz, cost] of NAV_NEIGHBORS) {
          const nx = lx + dx, nz = lz + dz;
          if (nx < 0 || nz < 0 || nx >= NAV_WINDOW_CELLS || nz >= NAV_WINDOW_CELLS) continue;
          const ni = nz * NAV_WINDOW_CELLS + nx;
          if (navState[ni] === 2) continue;
          if (!navWalkableCell(cx + dx, cz + dz)) continue;
          if (dx !== 0 && dz !== 0 && (!navWalkableCell(cx + dx, cz) || !navWalkableCell(cx, cz + dz))) continue;
          const g = navG[current] + cost;
          if (navState[ni] === 1 && g >= navG[ni]) continue;
          navG[ni] = g;
          navFrom[ni] = current;
          navState[ni] = 1;
          push(g + h(ni), ni);
        }
      }
      // No full route within the window/budget: head for the closest point
      // reached instead (the next repath continues from there).
      const endIndex = found ? goalIndex : closest;
      if (endIndex === startIndex) return null;
      const path = [];
      for (let cursor = endIndex; cursor !== startIndex && cursor !== -1; cursor = navFrom[cursor]) {
        path.push({
          x: ((cursor % NAV_WINDOW_CELLS) + originX + 0.5) * NAV_CELL_M,
          z: (((cursor / NAV_WINDOW_CELLS) | 0) + originZ + 0.5) * NAV_CELL_M,
        });
      }
      path.reverse();
      return path;
    }

    // Hide zones whose footprint is farther than the draw distances from
    // every viewer (co-op has two), so far blocks cost nothing to render.
    function updateVisibility(viewers) {
      for (const zone of zones) {
        let distance = Infinity;
        for (const v of viewers) distance = Math.min(distance, distanceToZone(zone, v.x, v.z));
        for (const mesh of zone.meshes) mesh.visible = distance <= RENDER_DISTANCE;
        for (const mesh of zone.treeMeshes) mesh.visible = distance <= TREE_DRAW_DISTANCE;
      }
    }

    const spawnWorld = mapToWorld(SPAWN_PX.x, SPAWN_PX.y);
    return {
      root,
      bounds,
      zones,
      mapToWorld,
      spawn: spawnWorld,
      stepUpHeight: STEP_UP_M,
      renderDistance: RENDER_DISTANCE,
      groundHeightAt,
      resolveCircle,
      supportHeightAt,
      segmentBlocked,
      isWalkable,
      distanceToNearestBuilding,
      isInsideHollowBuilding,
      spotsBehindBuildings,
      enclosureMask,
      isSameFenceSide,
      findPath,
      navChunkCount: () => navChunks.size,
      updateVisibility,
      distanceToZone,
    };

  }

  window.buildCampusWorld = buildCampusWorld;
})();
