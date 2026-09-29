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
    // Shared, purely cosmetic environment uniforms: the game's weather
    // writes these once per frame (see WEATHER / wind / heat haze in
    // index.html) and every tree and hot surface reads them on the GPU.
    const environment = {
      envTime: { value: 0 },
      windDir: { value: new THREE.Vector2(1, 0) },
      windStrength: { value: 0 },
      windGust: { value: 0 },
      heatHaze: { value: 0 },            // 0 = none .. 1 = full (still very faint)
      hazeColor: { value: new THREE.Color(0xc9d6e0) },
      hazeNear: { value: 18 },           // m -- no shimmer closer than this
      hazeFar: { value: 95 },            // m -- none past this
      nightLights: { value: 0 },         // 0..1 -- lit windows at night (index.html's ENVIRONMENT STATE)
    };
    // The realism pass's shared settings and per-surface response
    // (environment-fx.js; absent in a page that doesn't load it).
    const ENV = window.ENVIRONMENT_CONFIG || {};
    const envSurface = (material, response) => {
      if (window.environmentFX) window.environmentFX.setSurface(material, response);
      return material;
    };

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

    // Streets sit a little below the rest of the ground, edged by a concrete
    // curb (see STREET LEVEL). Every curb also has an invisible ramp: the
    // walking height eases over CURB_RAMP_M on the street side instead of
    // stepping -- like the sloped player clip games lay over curbs and
    // stairs -- so stepping on or off a curb glides instead of popping.
    const STREET_DROP_M = 0.12;
    const CURB_RAMP_M = 0.5;
    const CURB_TOP_WIDTH_M = 0.18; // concrete strip along the top of the curb

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
    //   TRACKS       -- [x1, y1, x2, y2, extras?] running track as a capsule (round ends)
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
      // Nemzek Stadium track (screenshot8nemzek.png): only the lanes are track
      // surface -- the infield is turf, except the darker event area inside
      // the north curve (from its lanes down to ~4 px short of the field),
      // and the west straight's lanes run on north past the curve's start as
      // a square-ended chute.
      [1517, 240, 1637, 505, { northEventAreaToY: 287.4, westChuteTopY: 248.9 }],
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
      [1478, 297.2, 1509, 318], // Nemzek: paved area at the north end of the stands, outside the inlet
      [1329.3, 297.2, 1450, 318], // Nemzek: hallway floor
      [1450, 297.2, 1478, 318], // Nemzek: the inlet in the building's east side (hallway's east door opens into it)
      [1335.3, 318, 1396.3, 433.4], // Nemzek Fieldhouse floor (track and court are drawn over it)
      [1396.3, 318, 1431.6, 380.2], // Nemzek: open area east of the fieldhouse
      [1478, 318, 1485, 440], // Nemzek: concrete alley between the building and the back of the grandstand
      [718.5, 283.5, 772, 391], // Z07: MSUM Dining's floor
      [706.2, 283.6, 718.5, 291.5], // Z07: walkway from the Sun Garden to Kise
      [666.9, 272, 674.3, 279.7], // Z07: Comstock's west entrance vestibule floor
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
      [1311, 307.6, 1330, 307.6, 9], // 17th St sidewalk to the Nemzek hallway's wide west entrance (gamenemzekentrance.jpg)
      [1311, 330.7, 1335.3, 330.7, 3], // 17th St sidewalk to the Fieldhouse's west doors (V102-V105)
      [1311, 355.1, 1335.3, 355.1, 3],
      [1311, 397, 1335.3, 397, 3],
      [1311, 417.6, 1335.3, 417.6, 3],
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
      // (Hagen Hall and Langseth Hall -- one building -- are walk-in: FLOOR_PLANS)
      [370, 243, 424, 271, 13],   // Weld Hall (main block)
      [381, 206, 410, 243, 16],   // Weld Hall (north wing, taller)
      [425, 201, 484, 271, 12],   // Lommen Hall (west)
      [484, 228, 585, 271, 12],   // Lommen Hall (south-east, below its courtyard)
      // Comstock + library corner re-traced from screenshot5B.png (the closest
      // view; A = px * 0.08732 + (624.1, 272.2)). The dark bands west of each
      // building there are shadows (morning sun from the east), not building.
      // (Comstock Memorial Union, its Sun Garden wing and the library are
      // walk-in: FLOOR_PLANS; its west vestibule is in HOLLOW_BUILDINGS)
      // Kise's closed-off parts (no longer walk-in): north of the dining room
      // (below the corridor along its north end), east of the hallway, and
      // the kitchen side east of the new interior wall.
      [726.4, 291.5, 772, 325.4, 9],
      [756.7, 325.4, 772, 391, 9],
      [725.8, 334.7, 726.4, 336.4, 3.7], // (KISE_CEILING_M) brick end of the interior glass partition (red)
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
      // (footprint re-traced from screenshot8nemzek.png: the Fieldhouse is the
      // south-west block, walk-in, with the open area east of it -- both in
      // HOLLOW_BUILDINGS)
      [1360, 233, 1478, 297.2, 18], // north gym
      [1330, 260, 1360, 297.2, 9],  // west wing
      [1431.6, 318, 1450, 380.2, 12], // middle, beside the open area
      [1396.3, 380.2, 1450, 440, 12], // middle, south of the open area
      [1411, 380.2, 1446, 406, 17], // raised roof over the middle
      [1450, 318, 1478, 440, 13], // east block -- south of the inlet, in line with the grandstand's north end
      [1683, 505, 1698, 515, 4],  // shed by the softball field
      [1683, 605, 1695, 640, 3.5], // softball storage building
      [1757, 545, 1776, 643, 5],  // Municipal Pool bathhouse (placeholder -- no interior)
      ...HOUSES,
      ...BORDER_HOUSES,
    ];

    // Nemzek Fieldhouse footprint (screenshot px) -- a 40 x 76 m hall, south of
    // the hallway -- and its indoor track, placed like the emergency plan
    // (gamenemzekfieldhouse.jpg): the plan's track spans 12% / 88% of the hall
    // north -> south and sits off-center to the west (7.1 m clear on the east,
    // 5.1 m on the west, where the plan's bottom is). Offsets are meters from
    // the hall's inner center, x east, z south.
    const FIELDHOUSE_PX = [1335.3, 318, 1396.3, 433.4];
    const FIELDHOUSE = {
      trackOuter: { minX: -14.67, maxX: 12.65, minZ: -28.57, maxZ: 28.97 },
      lanes: 3,
      laneWidthM: 1.07,
      courtLengthM: 28.65,     // NCAA men's regulation: 94 x 50 ft
      courtWidthM: 15.24,
    };
    FIELDHOUSE.trackCenterX = (FIELDHOUSE.trackOuter.minX + FIELDHOUSE.trackOuter.maxX) / 2;
    FIELDHOUSE.trackCenterZ = (FIELDHOUSE.trackOuter.minZ + FIELDHOUSE.trackOuter.maxZ) / 2;
    FIELDHOUSE.trackOuterRadiusM = (FIELDHOUSE.trackOuter.maxX - FIELDHOUSE.trackOuter.minX) / 2;
    FIELDHOUSE.trackHalfStraightM = (FIELDHOUSE.trackOuter.maxZ - FIELDHOUSE.trackOuter.minZ) / 2 - FIELDHOUSE.trackOuterRadiusM;

    // Fieldhouse props (screenshot px, see ZONE_DETAIL's prop format): the
    // two ceiling-hung hoops over the court, and the small rooms from the
    // plan tucked into the hall's corners, clear of the track's curves.
    function fieldhouseProps() {
      const cpx = (FIELDHOUSE_PX[0] + FIELDHOUSE_PX[2]) / 2, cpy = (FIELDHOUSE_PX[1] + FIELDHOUSE_PX[3]) / 2;
      const px = (mx) => cpx + mx / MAP_SCALE, py = (mz) => cpy + mz / MAP_SCALE;
      // Box centered on (x, z) m from the hall's center, size w x d m.
      const box = (x, z, w, d, height, color, raised) =>
        [px(x - w / 2), py(z - d / 2), px(x + w / 2), py(z + d / 2), height, color, ...(raised ? [raised] : [])];
      const props = [];
      const hx0 = FIELDHOUSE.trackCenterX;
      // Portable hoops (gamehoop.webp, with black padding instead of blue): a
      // padded base behind the baseline, a padded upright, a white boom
      // reaching over the baseline to the backboard (1.22 m inside it).
      const PAD = 0x161616, STEEL = 0xe8e8e6;
      for (const end of [-1, 1]) {
        const at = (m) => FIELDHOUSE.trackCenterZ + end * m; // m from the court's center toward this end
        const baseline = FIELDHOUSE.courtLengthM / 2;
        const boardM = baseline - 1.22;
        props.push(box(hx0, at(baseline + 2.4), 1.3, 2.2, 1.0, PAD));               // padded base (collides)
        props.push(box(hx0, at(baseline + 1.55), 0.46, 0.46, 1.5, PAD, 1.0));       // padded upright
        props.push(box(hx0, at(baseline + 1.55), 0.3, 0.3, 0.95, STEEL, 2.5));      // steel upright
        props.push(box(hx0, at((baseline + 1.55 + boardM) / 2), 0.2, baseline + 1.55 - boardM, 0.2, STEEL, 3.3)); // boom
        props.push(box(hx0, at(boardM + 0.25), 0.9, 0.12, 0.8, STEEL, 2.95));       // board frame behind the glass
        props.push(box(hx0, at(boardM), 1.83, 0.05, 1.07, 0xd9e2e6, 2.9));          // backboard
        props.push(box(hx0, at(boardM), 1.87, 0.09, 0.1, PAD, 2.82));               // bottom-edge padding
        props.push(box(hx0, at(boardM - 0.03), 0.59, 0.051, 0.45, 0xf6f6f6, 3.05));  // shooter's square
        const rimM = boardM - 0.38;
        props.push(box(hx0, at(rimM - 0.225), 0.47, 0.02, 0.02, 0xe0561a, 3.05));   // rim (four bars)
        props.push(box(hx0, at(rimM + 0.225), 0.47, 0.02, 0.02, 0xe0561a, 3.05));
        props.push(box(hx0 - 0.225, at(rimM), 0.02, 0.47, 0.02, 0xe0561a, 3.05));
        props.push(box(hx0 + 0.225, at(rimM), 0.02, 0.47, 0.02, 0xe0561a, 3.05));
      }
      // Rooms (locker rooms L103/L104 and J101/105B on the north wall, L101 in
      // the south-east corner), wall-to-wall inside, 3.2 m tall.
      const hx = (FIELDHOUSE_PX[2] - FIELDHOUSE_PX[0]) * MAP_SCALE / 2 - 0.45;
      const hz = (FIELDHOUSE_PX[3] - FIELDHOUSE_PX[1]) * MAP_SCALE / 2 - 0.45;
      props.push(box((9.5 + hx) / 2, -hz + 1.9, hx - 9.5, 3.8, 3.2, 0xc4bba9));  // L103 / L104 (north-east)
      props.push(box(-(9.5 + hx) / 2, -hz + 1.9, hx - 9.5, 3.8, 3.2, 0xc4bba9)); // J101 / 105B (north-west)
      props.push(box((12 + hx) / 2, hz - 1.9, hx - 12, 3.8, 3.2, 0xc4bba9));     // L101 (south-east)
      return props;
    }

    // Hollow buildings you can walk into: [x1, y1, x2, y2, height m, door(s),
    // color (optional)], each door { side: "n"|"s"|"e"|"w", at: px along that
    // wall, width m, height m }. Built from walls + a roof, with a concrete
    // floor and door-size gaps.
    // Kise (MSUM Dining) is single storey inside: the ceiling (underside of
    // the roof slab) sits a little above a normal room's, and above the
    // tallest jump (~3.2 m head height).
    const KISE_CEILING_M = 3.7;
    const KISE_ROOF_THICK_M = 0.9; // thick slabs, so the roof reads as solid through the glass
    const KISE_ROOF_M = KISE_CEILING_M + KISE_ROOF_THICK_M;
    const HOLLOW_BUILDINGS = [
      // MSUM Dining (Kise Commons), joined to Comstock's south side, laid out
      // from the annotations on screenshot5.png (fitted to the building's own
      // edges: map x = 718.5 + (px - 980) x 0.1486, y = 283.5 + (py - 138) x
      // 0.1631) and insidekiselookingnorth.png:
      //   - a hallway (pink) down the west side from the north wall, reached
      //     through the glass entrance link (the northmost doorway), opening
      //     into the dining room;
      //   - the dining room, walled off from the kitchen side by a new
      //     interior wall (green) -- the rest of the building is solid, see
      //     BUILDINGS;
      //   - glass walls (light blue) on the dining room's west side and most
      //     of its south side, with two new doors (purple) in the west glass,
      //     plus a short glass partition inside (see GLASS_WALLS);
      //   - brick (red): the hallway's north/east walls, the dining room's
      //     north wall, the west wall between the two doors and at its south
      //     end, and the south end of the interior glass partition;
      //   - ceilings: the hallway and dining room are a single storey
      //     (KISE_CEILING_M), except the raised block outlined in yellow,
      //     a clerestory a little under the old 9 m roof (8th value: raised
      //     [x1, y1, x2, y2, height]; 9th: roof slab thickness m, default 0.3).
      [718.5, 283.5, 726.4, 325.4, KISE_ROOF_M, [
        { side: "w", at: 306.5, width: 3, height: 2.6 },          // through from the glass entrance link
        { side: "w", at: 287.5, width: 5.2, height: KISE_CEILING_M }, // the walkway to the Sun Garden
        { side: "s", at: 722.45, width: 4.4, height: 9 },         // open into the dining room
        { side: "n", at: 722.45, width: 5.3, height: 9 },          // open into Comstock's Main Lounge (gamecmu1st2nd - edits.JPG)
        { side: "e", at: 287.5, width: 5.3, height: KISE_CEILING_M }, // into the corridor along Kise's north end
      ], undefined, undefined, KISE_ROOF_THICK_M],
      // The corridor along Kise's north end, from the hallway east to a door
      // out to the service yard (gamecmu1st2nd.JPG: the passage south of
      // Comstock with the exit arrow). Single storey inside; its roof slab
      // runs up to the 9 m roof of the block south of it.
      [726.4, 283.5, 772, 291.5, 9, [
        { side: "n", at: 743.55, width: 22.6, height: 9 },       // no wall: it's part of Comstock's Main Lounge (purple on the edits)
        { side: "w", at: 287.5, width: 5.3, height: KISE_CEILING_M },
        { side: "e", at: 287.5, width: 2.2, height: 2.6 },
      ], undefined, undefined, 9 - KISE_CEILING_M],
      [718.5, 325.4, 756.7, 391, KISE_ROOF_M, [
        { side: "n", at: 722.45, width: 4.4, height: 9 },         // open to the hallway
        { side: "s", at: 752, width: 1.8, height: 2.4 },          // the south door (yellow in firstedits.png)
        // West side: glass, door, brick, door, glass, brick to the corner.
        { side: "w", from: 334.4, to: 351.55, height: KISE_CEILING_M, glass: true, doors: [349.9] },
        { side: "w", from: 365.33, to: 383.4, height: KISE_CEILING_M, glass: true, doors: [367.0] },
        { side: "s", from: 719.1, to: 750.4, height: KISE_CEILING_M, glass: true }, // glass wall (starts past the west wall, so brick fills the corner)
      ], undefined, [725.8, 336.4, 748.2, 379.6, 8.5], KISE_ROOF_THICK_M], // raised roof (yellow): ceiling 8.5 - 0.9 = 7.6 m
      // Comstock's west entrance vestibule: door on its south face (blue in
      // screenshot5B.png), and through to the Welcome Lounge on its east side.
      [666.9, 272, 674.3, 279.7, 4, [
        { side: "s", at: 670.6, width: 2.2, height: 2.6 },
        { side: "e", at: 275.85, width: 2.4, height: 2.6 },
        { side: "n", at: 670.36, width: 2.4, height: 2.6 },    // to the short stair down into the Welcome Lounge
      ]],
      // Walkway from the Sun Garden Lounge east to Kise's west hallway, along
      // the south side of the Rec Lounge's brick wall (green on "gamecmu1st2nd -
      // edits.JPG"); the west short stair leads down from it into the lounge.
      // Ceiling 4.1 m, as tall as its opening from the Sun Garden.
      [706.2, 283.6, 718.5, 291.5, 6, [
        { side: "n", at: 714.8, width: 5.4, height: 9 },       // (Comstock's wall is open here, over the short stair)
        { side: "w", at: 287.55, width: 5.2, height: 4.1 },    // Sun Garden Lounge
        { side: "e", at: 287.55, width: 5.2, height: 3.7 },    // Kise's hallway
      ], undefined, undefined, 6 - 4.1, 0xe7e4dd], // (painted ceiling, like the Sun Garden's: FP_COLORS.ceiling)
      // Glass entrance link on Dining's west side: door on its south face (blue
      // in screenshot5B.png), open straight through into Dining on its east side.
      [711.8, 300.2, 718.5, 313.3, 4.5, [
        { side: "s", at: 714.8, width: 2, height: 2.4 },
        { side: "e", at: 306.5, width: 3, height: 2.6 },
      ]],
      // Alex Nemzek Hall hallway (blue in screenshot4.png / screenshot8nemzek.png):
      // a wide corridor through the building from 17th St (west door) to the
      // inlet in the building's east side (east door), as wide as the inlet --
      // which reaches the grandstand's north end. On its south side: the
      // Fieldhouse's C101 door, and the open area (green in
      // screenshot8nemzek.png) along its whole width, no doors.
      [1329.3, 297.2, 1450, 318, 7, [
        // Entrances nearly the hallway's full width (gamenemzekentrance.jpg:
        // a bank of glass doors under a white overhang).
        { side: "w", at: 307.6, width: 11, height: 3.2 },
        { side: "e", at: 307.6, width: 11, height: 3.2 },
        { side: "s", at: 1364, width: 2.2, height: 2.6 }, // Fieldhouse C101
        { side: "s", at: 1413.95, width: 22.3, height: 7 }, // open to the open area
      ]],
      // Nemzek Fieldhouse (purple in screenshot8nemzek.png; interior from the
      // emergency plan, gamenemzekfieldhouse.jpg -- the plan's bottom is west).
      // A 185 m indoor track (outer lane) around a basketball court, see
      // FIELDHOUSE. Doors: V102-V105 out to the west (toward 17th St), C110 and
      // C109 east into the open area, C101 north into the hallway.
      [...FIELDHOUSE_PX, 16, [
        { side: "w", at: 330.7, width: 2.4, height: 2.6 }, // V102
        { side: "w", at: 355.1, width: 2.4, height: 2.6 }, // V103
        { side: "w", at: 397, width: 2.4, height: 2.6 },   // V104
        { side: "w", at: 417.6, width: 2.4, height: 2.6 }, // V105
        { side: "e", at: 333, width: 2.4, height: 2.6 },   // C110
        { side: "e", at: 376.8, width: 2.4, height: 2.6 }, // C109
        { side: "n", at: 1364, width: 2.2, height: 2.6 },  // C101
      ]],
      // Open area east of the fieldhouse (green in screenshot8nemzek.png):
      // the hallway's height, open to it along its north side, doors into
      // the fieldhouse.
      [1396.3, 318, 1431.6, 380.2, 7, [
        { side: "n", at: 1413.95, width: 22.3, height: 7 },
        { side: "w", at: 333, width: 2.4, height: 2.6 },   // C110
        { side: "w", at: 376.8, width: 2.4, height: 2.6 }, // C109
      ]],
    ];
    const HOLLOW_WALL_M = 0.4;
    const GLASS_PANE_M = 0.06;      // glass thickness
    const GLASS_DOOR_WIDTH_M = 2.2; // doors set into a glass wall
    const GLASS_DOOR_HEIGHT_M = 2.6;
    const GLASS_DOOR_FRAME_M = 0.14;  // brick jambs either side of a door in a glass wall
    const GLASS_DOOR_HEADER_M = 0.2;  // brick header over it
    // Free-standing interior glass walls: [x1, y1, x2, y2, height m] (axis-aligned px).
    const GLASS_WALLS = [
      [726.1, 325.4, 726.1, 334.7, KISE_CEILING_M], // Kise: the hallway's glass side where it meets the dining room (insidekiselookingnorth.png); brick end: BUILDINGS
    ];

    // ------------------------------------------------------------------
    // WALK-IN FLOOR PLANS (FLOOR_PLANS): Hagen, Langseth, Livingston Lord
    // Library and Comstock Memorial Union, laid out room by room from the
    // photos of their plans in "making the map/" (gamehagen1st.JPG,
    // gamelangseth1st.JPG, gamelibrary1st.JPG, gamecmu1st2nd.JPG). Only the
    // open areas, classrooms and stairwells are walk-in. Every other room is
    // a solid block, and a door the plan shows into one is a closed,
    // cosmetic door panel.
    //
    // Each plan is written in its photo's own pixels (u across, v down, in
    // the photo scaled to 1600 px on its long side) and mapped onto the
    // screenshot by piecewise-linear knots per axis, fitted to the traced
    // footprint (`px` / `py`: which plan axis drives that screenshot axis,
    // and [plan, screenshot px] pairs). A plan without knots is written in
    // screenshot px.
    //   floors      -- [u1, v1, u2, v2] the ground floor's interior (also
    //                  what counts as indoors); floorQuads add 4-point
    //                  polygons for curved or slanted edges
    //   outlines    -- exterior wall polygons ([u, v] points): brick, set
    //                  just inside the line, as tall as the roof above them;
    //                  { points, open: true } leaves out the closing edge
    //   roofs       -- [u1, v1, u2, v2, height m] roof heights by area
    //                  (default `roof`); the building's mass fills from the
    //                  top floor's `ceiling` up to them
    //   solids      -- rooms that aren't walk-in, floor to ceiling
    //   partitions  -- interior walls [u1, v1, u2, v2] (painted block)
    //   doors       -- [u, v, width m, kind, face, opts]. kind "door": an
    //                  opening with a lintel; "open": open to the ceiling;
    //                  "glass": a closed glass door (a pane in a frame -- you
    //                  can see through it but nothing gets through);
    //                  "fake": a closed door panel on its `face` side ("+u",
    //                  "-u", "+v" or "-v"). opts: { base, h, color }
    //   stairs      -- [u1, v1, u2, v2, rising toward "+u"|"-u"|"+v"|"-v",
    //                  from m, to m]; from == to is a landing
    //   shafts      -- [u1, v1, u2, v2, ceiling m]: stairwells and tall rooms
    //                  whose ceiling sits higher than the floor's
    //   columns     -- [u1, v1, u2, v2] free-standing solids (pillars)
    //   upper       -- a walk-in second floor: { level m, slab m, holes,
    //                  solids, partitions, doors, rails } (Comstock only)
    //   level       -- the ground floor's height when it's below the ground
    //                  (m, negative): its floors are sunk, except
    //                  `raisedFloors` (at ground level); `sunkenExtra` adds
    //                  sunken landings outside its doors
    //   rails       -- glass balcony rails at ground level [u1, v1, u2, v2]
    //   ramps       -- [uA, vA, uB, vB, width m, height at A, height at B],
    //                  with glass rails down both sides
    //   brickPartitions -- indexes into `partitions` built in brick
    //   portals     -- enemy navigation links up each stair: the walking line
    //                  [[u, v, height m], ...] from the floor below to the
    //                  floor (or landing) above -- see FLOOR_PLAN_PORTALS
    //                  (add `{ open: false }` as a last element to close one)
    //   outlines' { glass: [edge indexes] } -- all-glass walls (up to the
    //                  ceiling, brick above)
    // The stairwells climb to a second-floor landing that ends at a closed
    // door (those floors aren't built), except Comstock's, which reach its
    // second floor.
    // ------------------------------------------------------------------
    // Comstock's sunken first floor and its stairs: every Comstock stair has
    // the big stairs' slope (4.5 m in 21 steps over 41 plan px), so the ones
    // down into the lower level are just 3 of those steps.
    const CMU_STEP_M = 4.5 / 21;
    const CMU_TREAD_V = 41 / 21;
    const CMU_LOWER_M = -3 * CMU_STEP_M;
    const FLOOR_PLANS = [
      // Hagen Hall (gamehagen1st.JPG): north is right on the plan, west is up.
      // One long corridor (C101) from the south door (V101) to the north
      // door (V102), with two ways through to Langseth on its east side: the
      // east branch opposite 104, and the north strip past 118.
      {
        name: "Hagen Hall",
        px: { from: "v", knots: [[415, 266], [783, 300]] },
        py: { from: "u", knots: [[311, 310], [1524, 201]] },
        roof: 16,
        ceiling: 3.8,
        floors: [[311, 415, 1524, 783]],
        outlines: [[[311, 415], [1524, 415], [1524, 783], [311, 783]]],
        solids: [
          [311, 415, 875, 571],   // L101, the 103 / 105 / 107 office suites, 109, 111
          [1332, 520, 1378, 571], // 117A
          [1470, 415, 1524, 571], // L102
          [1277, 632, 1326, 783], // 118
          [790, 735, 895, 783],   // 120
          [1365, 640, 1420, 783], // P1 elevator, 122
          [1464, 632, 1524, 665], // E102
        ],
        partitions: [
          [875, 571, 1470, 571],  // corridor | 113, 117, 121
          [1090, 415, 1090, 571], // 113 | 117
          [1332, 415, 1332, 520], // 117 | 121
          [311, 632, 715, 632],   // corridor | S101, 104
          [790, 632, 1277, 632],  // corridor | 112, 114, 116
          [415, 632, 415, 783],   // S101 | 104
          [715, 632, 715, 783],   // 104 | east branch
          [790, 632, 790, 735],   // east branch | 112
          [895, 632, 895, 783],   // 112, 120 | 114
          [1190, 632, 1190, 783], // 114 | 116
          [1420, 640, 1464, 640], // north lobby | S102
        ],
        doors: [
          [311, 601, 3, "door"],       // V101, south end
          [1524, 605, 3, "door"],      // V102, north end
          [761.5, 783, 3.6, "open"],   // east branch -> Langseth's C105
          [1343, 783, 2, "door"],      // north strip -> Langseth
          [913, 571, 1.8, "door"], [1036, 571, 1.8, "door"],  // 113
          [1118, 571, 1.8, "door"], [1300, 571, 1.8, "door"], // 117
          [1396, 571, 1.8, "door"],    // 121
          [1332, 495, 1.6, "door"],    // 117 <-> 121
          [386, 632, 2, "door"],       // S101
          [548, 632, 1.8, "door"],     // 104
          [873, 632, 1.8, "door"],     // 112
          [916, 632, 1.8, "door"],     // 114
          [1204, 632, 1.8, "door"],    // 116
          [1190, 720, 1.6, "door"],    // 114 <-> 116
          [1442, 640, 2, "door"],      // S102
          // rooms that aren't walk-in
          [350, 571, 1, "fake", "+v"], [379, 571, 1, "fake", "+v"], [420, 571, 1, "fake", "+v"], // L101, L103, 103
          [678, 571, 1, "fake", "+v"], [770, 571, 1.6, "fake", "+v"], [830, 571, 1, "fake", "+v"], // 107, 109, 111
          [1355, 571, 1, "fake", "+v"], [1476, 571, 1, "fake", "+v"], // 117A, L102
          [1326, 668, 1, "fake", "+u"], // 118
          [790, 760, 1, "fake", "-u"],  // 120
          [1392, 640, 1.1, "fake", "-v", { color: 0x9ea3a8 }], // P1 elevator
          // second-floor doors at the stair tops
          [336, 632, 1, "fake", "+v", { base: 4 }],
          [1488, 665, 1, "fake", "+v", { base: 4 }],
        ],
        stairs: [
          // S101 (plan: UP flight on the right, DN on the left)
          [362, 695, 412, 765, "+v", 0, 2], [311, 765, 415, 783, "+v", 2, 2],
          [315, 695, 358, 765, "-v", 2, 4], [315, 634, 358, 695, "-v", 4, 4],
          // S102
          [1420, 690, 1462, 765, "+v", 0, 2], [1420, 765, 1524, 783, "+v", 2, 2],
          [1464, 690, 1512, 765, "-v", 2, 4], [1464, 665, 1512, 690, "-v", 4, 4],
        ],
        shafts: [[311, 632, 415, 783, 7], [1420, 665, 1524, 783, 7], [1420, 640, 1464, 665, 7]],
        portals: [
          [[386, 640, 0], [387, 690, 0], [387, 774, 2], [336, 774, 2], [336, 700, 4], [336, 645, 4]],       // S101
          [[1442, 645, 0], [1441, 690, 0], [1441, 774, 2], [1488, 774, 2], [1488, 700, 4], [1488, 675, 4]], // S102
        ],
      },
      // Langseth Hall (gamelangseth1st.JPG): north is right, west (Hagen) is
      // up. Placed so its C105 and north corridor meet Hagen's two openings;
      // 104 is the curved lecture hall of the east wing, two storeys tall.
      {
        name: "Langseth Hall",
        px: { from: "v", knots: [[375, 300], [722, 354], [782, 369]] },
        py: { from: "u", knots: [[540, 298.2], [1160, 202.1]] },
        roof: 13,
        ceiling: 3.8,
        roofs: [[0, 0, 890, 2000, 8], [890, 0, 2000, 722, 13], [890, 722, 2000, 2000, 9]],
        floors: [
          [540, 375, 705, 406], [563, 406, 705, 528], [643, 528, 705, 640], [632, 600, 643, 640],
          [705, 375, 716, 640], [716, 375, 1126, 722], [1126, 604, 1160, 662], [1126, 662, 1148, 722],
          [940, 722, 1116, 762],
        ],
        floorQuads: [
          [[940, 762], [940, 772], [1000, 780], [1000, 762]],
          [[1000, 762], [1000, 780], [1060, 778], [1060, 762]],
          [[1060, 762], [1060, 778], [1116, 762], [1116, 762]],
        ],
        outlines: [[
          [540, 375], [890, 375], [1126, 375], [1126, 604], [1160, 604], [1160, 662], [1148, 662], [1148, 722],
          [1116, 722], [1116, 762], [1060, 778], [1000, 780], [940, 772], [940, 722], [890, 722], [716, 722],
          [716, 640], [632, 640], [632, 600], [643, 600], [643, 528], [563, 528], [563, 406], [540, 406],
        ]],
        solids: [
          [745, 375, 775, 497],   // P2 elevator, 116, E105, E104
          [862, 375, 1043, 408],  // J102 and the service strip
          [862, 408, 895, 497],   // 112
          [1015, 408, 1043, 497], // 110A
          [1065, 408, 1126, 497], // 108, J101, V108
          [862, 525, 918, 607],   // 105, 107
          [1065, 525, 1126, 604], // P1 elevator, 106, E101 - E103
          [878, 636, 940, 722],   // L101, L102
        ],
        partitions: [
          [563, 406, 705, 406],   // S103 | 118
          [705, 375, 705, 528],   // S103, 118 | C105
          [643, 528, 705, 528],   // 118 | 101
          [775, 497, 862, 497],   // 114 | C102
          [895, 497, 1015, 497],  // 110 | C102
          [745, 525, 862, 525],   // C102 | 103
          [918, 525, 1043, 525],  // C102 | 109
          [745, 525, 745, 607],   // 101 | 103
          [745, 607, 862, 607],   // 103 | C101
          [918, 607, 1043, 607],  // 109 | C101
          [1043, 525, 1043, 607], // 109 | C104
          [716, 640, 744, 640],   // 101 | S101
          [744, 636, 744, 722],   // S101 | C103
          [772, 636, 878, 636],   // C101 | 102
          [772, 636, 772, 722],   // C103 | 102
          [940, 662, 1148, 662],  // east lobby | 104, S102
          [940, 662, 940, 722],   // L101, L102 | 104
          [1116, 662, 1116, 722], // 104 | S102
        ],
        doors: [
          [725.2, 375, 3.6, "open"],  // C105 -> Hagen's east branch
          [1062.6, 375, 2, "door"],   // north corridor -> Hagen
          [632, 620, 2.2, "door"],    // V101
          [690, 640, 2.2, "door"],    // V109
          [758, 722, 1.6, "door"],    // V103
          [940, 745, 2.2, "door"],    // V104 (from 104)
          [1160, 618, 2.2, "door"],   // V102
          [1160, 652, 2.2, "door"],   // V107
          [1126, 388, 2.2, "door"],   // V106
          [705, 420, 1.8, "door"],    // 118 from C105
          [695, 528, 1.6, "door"],    // 118 from 101
          [705, 398, 1.4, "door"],    // S103
          [790, 497, 1.6, "door"], [845, 497, 1.6, "door"],  // 114
          [916, 497, 1.6, "door"], [997, 497, 1.6, "door"],  // 110
          [760, 525, 1.6, "door"], [852, 607, 1.6, "door"],  // 103
          [1018, 525, 1.6, "door"], [930, 607, 1.6, "door"], // 109
          [784, 636, 1.6, "door"], [864, 636, 1.6, "door"],  // 102
          [723, 640, 1.4, "door"],    // S101
          [960, 662, 2, "door"],      // 104
          [1140, 662, 1.5, "door"],   // S102
          // rooms that aren't walk-in
          [745, 462, 1, "fake", "-u"], [745, 485, 1, "fake", "-u"], // E105, E104
          [878, 497, 1, "fake", "+v"],  // 112
          [1030, 497, 1, "fake", "+v"], // 110A
          [1043, 392, 1, "fake", "+u"], // J102
          [1065, 450, 1, "fake", "-u"], // 108
          [1065, 560, 1, "fake", "-u"], // 106
          [875, 525, 1, "fake", "-v"], [905, 525, 1, "fake", "-v"], // 105, 107
          [875, 607, 1, "fake", "+v"], [905, 607, 1, "fake", "+v"],
          [898, 636, 1, "fake", "-v"], [930, 636, 1, "fake", "-v"], // L101, L102
          // second-floor doors at the stair tops
          [705, 383, 1, "fake", "-u", { base: 4 }],
          [737, 640, 1, "fake", "+v", { base: 4 }],
          [1124, 662, 1, "fake", "+v", { base: 4 }],
        ],
        stairs: [
          // S103: a long switchback beside 118
          [610, 391, 690, 406, "-u", 0, 2], [575, 375, 610, 406, "-u", 2, 2],
          [610, 375, 690, 391, "+u", 2, 4], [690, 375, 705, 391, "+u", 4, 4],
          // S101
          [716, 660, 730, 700, "+v", 0, 2], [716, 700, 744, 722, "+v", 2, 2],
          [730, 660, 744, 700, "-v", 2, 4], [730, 640, 744, 660, "-v", 4, 4],
          // S102
          [1132, 668, 1148, 708, "+v", 0, 2], [1116, 708, 1148, 722, "+v", 2, 2],
          [1116, 678, 1132, 708, "-v", 2, 4], [1116, 662, 1132, 678, "-v", 4, 4],
        ],
        shafts: [[540, 375, 705, 406, 7], [716, 640, 744, 722, 7], [1116, 662, 1148, 722, 7], [940, 662, 1116, 780, 6.5]],
        portals: [
          [[712, 398, 0], [698, 398, 0], [600, 398, 2], [590, 383, 2], [698, 383, 4]],        // S103
          [[723, 630, 0], [723, 650, 0], [723, 712, 2], [737, 712, 2], [737, 648, 4]],        // S101
          [[1140, 655, 0], [1140, 666, 0], [1140, 715, 2], [1124, 715, 2], [1124, 668, 4]],   // S102
        ],
      },
      // Livingston Lord Library (gamelibrary1st.JPG): north is up. The big
      // reading room (104 / 114A-D) with its pillars, the C105 walk along the
      // lower roof between the two blocks, and the annex (100) on the west,
      // joined by the C101 passage between the V101 and V102 doors.
      {
        name: "Livingston Lord Library",
        px: { from: "u", knots: [[192, 539], [377, 558], [1230, 669.5]] },
        py: { from: "v", knots: [[269, 300.2], [302, 307.2], [955, 393]] },
        roof: 14,
        ceiling: 4.2,
        roofs: [
          [0, 0, 377, 2000, 8], [377, 302, 866, 955, 14], [866, 302, 950, 955, 8],
          [950, 0, 1187, 955, 14], [1187, 0, 2000, 955, 5], [377, 955, 2000, 2000, 5],
        ],
        floors: [[377, 302, 1230, 955], [980, 269, 1175, 302], [965, 955, 1150, 990], [192, 510, 290, 740], [290, 530, 377, 715]],
        outlines: [
          [[377, 302], [866, 302], [950, 302], [980, 302], [980, 269], [1175, 269], [1175, 302], [1187, 302], [1230, 302],
            [1230, 955], [1187, 955], [1150, 955], [1150, 990], [965, 990], [965, 955], [950, 955], [866, 955], [377, 955]],
          [[192, 510], [290, 510], [290, 530], [377, 530], [377, 715], [290, 715], [290, 740], [192, 740]],
        ],
        solids: [
          [510, 302, 715, 400],   // 108 office suite, 109
          [617, 400, 715, 470],   // 108, 108A, 106, 107
          [560, 430, 615, 460],   // E104
          [590, 460, 612, 540],   // J101
          [377, 695, 490, 760],   // L101, L102
          [600, 680, 715, 775],   // E101, 111, 101A, 112
          [377, 865, 486, 955],   // 101C
          [508, 855, 603, 955],   // 101B, E102
          [980, 269, 1100, 330],  // 124
          [1100, 269, 1175, 345], // S107, 139
          [1175, 302, 1230, 360], // 125
          [940, 420, 1045, 638],  // 122, 126 - 129, C107, 120, 121, P101
          [1010, 638, 1045, 680], // beside S104
          [940, 680, 1045, 915],  // L103, L104, 103, 116 - 119, 130, 131, C106
          [1080, 450, 1230, 475], // 135 - 138
          [1080, 640, 1230, 700], // 133
          [965, 955, 1025, 990],  // E105
        ],
        // the reading room's square pillars, and the long ones along C105
        columns: [
          ...[740, 868].flatMap((u) => [473, 539, 605, 670, 732, 797, 861, 925].map((v) => [u - 3, v - 3, u + 3, v + 3])),
          ...[330, 390, 470, 540, 600, 660, 720, 780, 840, 900].map((v) => [898, v - 12, 906, v + 12]),
        ],
        partitions: [
          [377, 380, 510, 380],   // 110 | 103
          [425, 302, 425, 340],   // 110 | S103
          [425, 340, 500, 340],
          [500, 302, 500, 340],
          [510, 380, 510, 560],   // 103 | 105
          [393, 560, 510, 560],   // 103 | 102 (open at its west end)
          [603, 775, 603, 855],   // 101 | 113
          [715, 775, 715, 955],   // 113 | 114C
          [940, 638, 940, 680],   // C105 | S104
          [1080, 475, 1080, 640], // C108 | 134
          [1080, 700, 1080, 955], // C108 | 132
          [1080, 955, 1150, 955], // 132 | S106
          [290, 530, 290, 715],   // C101 | 100
        ],
        doors: [
          [335, 530, 2.4, "door"],  // V101 (north end of the C101 passage)
          [335, 715, 2.4, "door"],  // V102 (south end)
          [377, 580, 2.4, "door"],  // C101 -> 102
          [377, 680, 2.4, "door"],
          [290, 625, 2.4, "door"],  // 100
          [485, 302, 1.8, "door"],  // V109 (by S103)
          [965, 302, 2.4, "door"],  // V108, the north-east entrance
          // V104, V103 and V105 are closed glass doors (circled blue on gamelibrary1st.JPG)
          [925, 955, 2.4, "glass"],  // V104 (end of C105)
          [497, 955, 1.6, "glass"],  // V103 (end of C103)
          [1050, 990, 2.4, "glass"], // V105
          [1150, 972, 2, "door"],   // V106
          [440, 380, 1.6, "door"],  // 110 <-> 103
          [500, 313, 1.2, "door"],  // S103
          [603, 787, 1.6, "door"],  // 113 from 101
          [715, 808, 1.6, "door"],  // 113 from 114C
          [940, 670, 1.3, "door"],  // S104
          [1080, 615, 1.8, "door"], // 134
          [1080, 760, 2, "door"],   // 132
          [1115, 955, 1.8, "door"], // 132 -> S106
          // rooms that aren't walk-in
          [560, 400, 1, "fake", "+v"], [680, 470, 1, "fake", "+v"], [715, 380, 1, "fake", "+u"], // 108 suite
          [612, 500, 1, "fake", "+u"], [585, 460, 1, "fake", "+v"], // J101, E104
          [420, 695, 1, "fake", "-v"], [465, 695, 1, "fake", "-v"], // L101, L102
          [600, 730, 1, "fake", "-u"],  // 101A
          [440, 865, 1, "fake", "-v"], [486, 900, 1, "fake", "+u"], // 101C
          [555, 855, 1, "fake", "-v"],  // 101B
          ...[460, 540, 600, 730, 790, 850, 900].map((v) => [940, v, 1, "fake", "-u"]), // the room stack, from C105
          ...[520, 700, 860].map((v) => [1045, v, 1, "fake", "+u"]),                    // ...and from C108
          [1040, 330, 1.6, "fake", "+v"], [1140, 345, 1, "fake", "+v"], [1200, 360, 1, "fake", "+v"], // 124, 139, 125
          [1110, 475, 1, "fake", "+v"], [1160, 475, 1, "fake", "+v"], [1210, 475, 1, "fake", "+v"], // 135 - 138
          [1080, 670, 1, "fake", "-u"], // 133
          [995, 955, 1, "fake", "-v"],  // E105
          [1175, 287, 1.8, "fake", "+u", { color: 0x2b3a48 }], // V107 (outside door into S107)
          // second-floor doors at the stair tops
          [500, 331, 1, "fake", "-u", { base: 4.6 }],
          [586, 670, 1, "fake", "-u", { base: 4.6 }],
          [940, 648, 1, "fake", "+u", { base: 4.6 }],
        ],
        stairs: [
          // S103, inside 110
          [440, 305, 480, 322, "-u", 0, 2.3], [425, 302, 440, 340, "-u", 2.3, 2.3],
          [440, 322, 490, 340, "+u", 2.3, 4.6], [490, 322, 500, 340, "+u", 4.6, 4.6],
          // S102, the open stair between 102 and 101
          [520, 679, 586, 696, "-u", 0, 2.3], [508, 662, 520, 696, "-u", 2.3, 2.3],
          [520, 662, 572, 679, "+u", 2.3, 4.6], [572, 662, 586, 679, "+u", 4.6, 4.6],
          // S104, off C105
          [950, 659, 1000, 680, "+u", 0, 2.3], [1000, 638, 1010, 680, "+u", 2.3, 2.3],
          [950, 638, 1000, 659, "-u", 2.3, 4.6], [940, 638, 950, 659, "-u", 4.6, 4.6],
        ],
        shafts: [[425, 302, 500, 340, 7.5], [508, 662, 586, 696, 7.5], [940, 638, 1010, 680, 7.5]],
        portals: [
          [[490, 295, 0], [490, 312, 0], [432, 312, 2.3], [432, 331, 2.3], [496, 331, 4.6]],   // S103
          [[595, 690, 0], [584, 688, 0], [514, 688, 2.3], [514, 670, 2.3], [580, 670, 4.6]],   // S102
          [[930, 670, 0], [945, 670, 0], [1005, 670, 2.3], [1005, 648, 2.3], [945, 648, 4.6]], // S104
        ],
      },
      // Comstock Memorial Union (gamecmu1st2nd.JPG): north is up; the lower
      // plan is the first floor, the upper one the second, drawn 608 px
      // higher (second-floor v below is already shifted onto the first
      // floor's). Joined to Kise: the plan's corridor along Kise's north end
      // and Kise's west hallway both open into it (see HOLLOW_BUILDINGS).
      // Changes marked on "gamecmu1st2nd - edits.JPG": most of the first floor
      // (the Lower, Rec and Welcome lounges, the food court seating and the
      // hallways north of them) is 3 steps down (`level`). Only the Main Lounge
      // -- a platform with a glass balcony, open south to Kise's corridor --
      // and the west entrance stay at ground level (`raisedFloors`). A ramp runs
      // from the entrance down into the lounges, short stairs lead from the
      // Main Lounge down into the pockets beside it, and the big stairs go from
      // the pockets up to the second floor. The two north doors open onto a
      // sunken landing with 3 steps up to the ground (`sunkenExtra`).
      {
        name: "Comstock Memorial Union",
        px: { from: "u", knots: [[325, 668], [945, 787]] },
        py: { from: "v", knots: [[918, 200], [1350, 283.6]] },
        roof: 12,
        ceiling: 9,
        level: CMU_LOWER_M,
        floors: [[325, 918, 945, 1290], [358, 1290, 945, 1350]],
        raisedFloors: [
          [358, 1300, 405, 1350], // west entrance, by the vestibule and the Sun Garden
          [605, 1255, 753, 1350], // Main Lounge, open to Kise's corridor
          [580, 1309, 605, 1350], // the big stairs start at ground level
          [753, 1309, 780, 1350],
        ],
        // outside the north doors: 1 m of landing at the lower level, then
        // steps up -- each exactly as wide as its doorway
        sunkenExtra: [[463.5, 904.7, 482.5, 922], [768.2, 904.7, 791.8, 922]],
        outlines: [[[325, 918], [945, 918], [945, 1350], [358, 1350], [358, 1290], [325, 1290]]],
        solids: [
          [325, 918, 395, 951],   // north-west corner, elevator
          [325, 951, 388, 1193],  // 120
          [427, 918, 466, 997],   // 115, 117
          [483, 918, 752, 998],   // 113, restrooms
          [425, 1034, 482, 1194], // 121
          [482, 1034, 534, 1141], // 126
          [551, 1034, 752, 1171], // 114, 125, 106 and the service core
          [806, 1111, 945, 1202], // 103 food court
        ],
        partitions: [
          [806, 918, 806, 1111],   // 105 (meeting room)
          [552, 1305, 552, 1350],  // brick walls (black on the edits): Rec Lounge | west stair pocket
          [808, 1300, 808, 1350],  // east stair pocket | food court seating
        ],
        brickPartitions: [1, 2],
        doors: [
          [473, 918, 2.4, "door"],  // north entrance by 115
          [780, 918, 3, "door"],    // north entrance by the bus stop
          [358, 1310, 2.4, "door", null, { h: 2.88 }], // west entrance, through the vestibule (at ground level)
          [335, 1290, 2.4, "door", null, { h: 2.88 }], // vestibule -> the short stair down into the Welcome Lounge
          [680.5, 1350, 32.3, "open"], // no wall from the west short stair to the food court: the walkway, Kise's hallway and corridor
          [414, 1350, 14.2, "open"], // Sun Garden Lounge (the south-west wing)
          [806, 1040, 2.4, "door"], // 105
          // rooms that aren't walk-in
          [377, 951, 1.1, "fake", "+v", { color: 0x9ea3a8 }], // elevator
          [446, 997, 1, "fake", "+v"], [560, 998, 1.2, "fake", "+v"], [690, 998, 1, "fake", "+v"], [730, 998, 1, "fake", "+v"],
          [388, 1100, 1.2, "fake", "+u"], [425, 1110, 1.2, "fake", "-u"], [534, 1090, 1, "fake", "+u"],
          [600, 1034, 1.2, "fake", "-v"], [600, 1171, 1.2, "fake", "+v"], [700, 1171, 1.2, "fake", "+v"],
          [752, 1070, 1.6, "fake", "+u"], [806, 1160, 1.8, "fake", "-u"],
        ],
        stairs: [
          // north-west stairwell (switchback) to the second floor
          [395, 930, 411, 951, "-v", CMU_LOWER_M, 2.25], [395, 918, 427, 930, "-v", 2.25, 2.25], [411, 930, 427, 951, "+v", 2.25, 4.5],
          // the big stairs either side of the Main Lounge, from ground level up to the second floor (yellow)
          [580, 1309, 605, 1350, "-v", 0, 4.5],
          [753, 1309, 780, 1350, "-v", 0, 4.5],
          // short stairs beside them, down north into the lounge (red; plan: the small stair icons)
          [553, 1350 - 3 * CMU_TREAD_V, 578, 1350, "+v", CMU_LOWER_M, 0],
          [781, 1350 - 3 * CMU_TREAD_V, 807, 1350, "+v", CMU_LOWER_M, 0],
          // short stair from the west vestibule down into the Welcome Lounge (red)
          [326, 1290 - 3 * CMU_TREAD_V, 345, 1290, "+v", CMU_LOWER_M, 0],
          // outside the north doors: 3 steps up from the landing to the ground
          [463.5, 904.7, 482.5, 904.7 + 3 * CMU_TREAD_V, "-v", CMU_LOWER_M, 0],
          [768.2, 904.7, 791.8, 904.7 + 3 * CMU_TREAD_V, "-v", CMU_LOWER_M, 0],
          // the Sun Garden Lounge's stair up to the Overlook Lounge (the
          // second floor's south-west corner): in the Sun Garden, rising north
          // to Comstock's south wall, which is open above it on the second floor
          [428, 1350, 447, 1350 + 41, "-v", 0, 4.5],
        ],
        // the ramp from the west entrance down into the lounges (orange), [uA, vA, uB, vB, width m, height at A, at B]
        ramps: [[398, 1323, 511.4, 1252.3, 2.4, 0, CMU_LOWER_M]],
        // glass balcony rails at ground level (light blue): [u1, v1, u2, v2]
        rails: [
          [605, 1255, 753, 1255], [605, 1255, 605, 1309], [753, 1255, 753, 1309], // around the Main Lounge
          [358, 1300, 405, 1300], [405, 1300, 405, 1312], [405, 1334, 405, 1350], // around the west entrance
          [405, 1350, 470, 1350],   // Sun Garden | Rec Lounge
        ],
        portals: [
          [[592, 1356, 0], [592, 1348, 0], [592, 1309, 4.5], [592, 1295, 4.5]],   // big stair, west of the Main Lounge
          [[766, 1356, 0], [766, 1348, 0], [766, 1309, 4.5], [766, 1295, 4.5]],   // big stair, east of it
          [[437.5, 1400, 0], [437.5, 1392, 0], [437.5, 1350, 4.5], [437.5, 1336, 4.5]], // Sun Garden -> Overlook Lounge
          [[403, 1000, CMU_LOWER_M], [403, 952, CMU_LOWER_M], [403, 924, 2.25], [419, 924, 2.25], [419, 951, 4.5], [419, 965, 4.5]], // north-west stairwell
        ],
        upper: {
          level: 4.5,
          slab: 0.4,
          holes: [[395, 918, 427, 951], [545, 1309, 809, 1350], [610, 1275, 751, 1309]], // stairwell, "Open to 1st Floor"
          solids: [
            [325, 918, 395, 954],   // north-west corner, elevator
            [427, 918, 487, 961],   // 218
            [526, 918, 605, 961],   // 216
            [642, 918, 722, 962],   // 214
            [757, 918, 864, 963],   // 212, storage
            [864, 918, 945, 956],   // north-east corner
            [895, 956, 945, 1258],  // 208, 207, 205, 204
            [870, 1258, 945, 1340], // 203
            [325, 1028, 402, 1222], // 222
            [432, 992, 486, 1226],  // ballroom storage, 225
            [465, 1258, 545, 1350], // restrooms
          ],
          partitions: [[486, 992, 864, 992], [864, 992, 864, 1226], [486, 1226, 864, 1226]], // 200 Ballroom
          doors: [
            [675, 992, 2.4, "door"], [864, 1110, 2.4, "door"], [560, 1226, 2.4, "door"], [790, 1226, 2.4, "door"], // Ballroom
            [460, 961, 1, "fake", "+v"], [565, 961, 1, "fake", "+v"], [680, 962, 1, "fake", "+v"], [790, 963, 1, "fake", "+v"],
            ...[1000, 1090, 1180, 1240].map((v) => [895, v, 1, "fake", "-u"]), // 208 - 204
            [870, 1300, 1, "fake", "-u"],  // 203
            [402, 1120, 1.2, "fake", "+u"], // 222
            [460, 1226, 1, "fake", "+v"],  // 225
            [432, 1050, 1, "fake", "-u"],  // storage
            [505, 1258, 1, "fake", "-v"],  // restrooms
            [377, 954, 1.1, "fake", "+v", { color: 0x9ea3a8 }], // elevator
            [411.5, 1350, 13.55, "open"], // the Overlook Lounge: open over the Sun Garden (u 358 - 465)
          ],
          rails: [
            [358, 1350, 428, 1350], [447, 1350, 465, 1350], // along the overlook, either side of the Sun Garden stair's top
            [395, 951, 411, 951], // over the stairwell's lower flight
            [545, 1309, 580, 1309], [605, 1309, 610, 1309], [751, 1309, 753, 1309], [780, 1309, 809, 1309],
            [809, 1309, 809, 1350], // (none along the restrooms: pink on the edits)
            [610, 1275, 751, 1275], [610, 1275, 610, 1309], [751, 1275, 751, 1309],
          ],
        },
      },
      // Comstock's Sun Garden Lounge: the angled south-west wing (footprint
      // from screenshot5B.png, in screenshot px), open along its north side
      // into the first floor. Its east, south and slanted walls are all glass
      // (blue on "gamecmu1st2nd - edits.JPG"). Two storeys tall inside ("Open
      // to 1st Floor" on the second-floor plan): the Overlook Lounge looks
      // down into it, and its stair (in Comstock's plan) climbs up to it.
      {
        name: "Comstock - Sun Garden Lounge",
        roof: 10.5,
        ceiling: 9,
        // (the extra strips under the slanted wall keep the roof closed there)
        floors: [[674.3, 283.6, 706.2, 289.3], [701, 289.3, 706.2, 296], [688, 289.3, 701, 293.6], [680, 289.3, 688, 291.2]],
        floorQuads: [
          [[673.8, 289.3], [701, 289.3], [701, 298.4], [701, 298.4]],
          [[701, 296], [706.2, 296], [701, 298.4], [701, 298.4]],
        ],
        outlines: [{ points: [[706.2, 283.6], [706.2, 291.5], [706.2, 296], [701, 298.4], [673.8, 289.3], [674.3, 283.6]], open: true, glass: [1, 2, 3] }], // north side: Comstock's wall
        doors: [[706.2, 287.55, 5.2, "door", null, { h: 4.1 }]], // into the walkway to Kise (green on the edits), as tall as its ceiling
      },
    ];
    const FP_PARTITION_M = 0.2;        // interior walls (exterior ones are HOLLOW_WALL_M)
    const FP_DOOR_HEIGHT_M = 2.4;
    const FP_FAKE_DOOR_HEIGHT_M = 2.2;
    const FP_MAX_RISE_M = 0.22;        // stair step, well under STEP_UP_M
    const FP_RAIL_HEIGHT_M = 1.1;
    const FP_BAND_DEPTH_M = 4;         // roof over a slanted/curved wall
    const FP_INSET_M = 0.02;           // keeps painted faces off the brick ones
    const FP_COLORS = {
      partition: 0xd8d2c6, solid: 0xcdc6b8, ceiling: 0xe7e4dd, stair: 0xa9a49c, carpet: 0x7a6c64,
      door: 0x6e4f36, doorFrame: 0x9a948c, handle: 0xc9c9c9, railCap: 0x8c9196,
    };

    // Plan pixels -> screenshot px.
    function floorPlanToPx(plan) {
      if (!plan.px) return (u, v) => [u, v];
      const lerp = (knots, t) => {
        let i = 0;
        while (i < knots.length - 2 && t > knots[i + 1][0]) i++;
        const [a0, b0] = knots[i], [a1, b1] = knots[i + 1];
        return b0 + ((t - a0) * (b1 - b0)) / (a1 - a0);
      };
      return (u, v) => [lerp(plan.px.knots, plan.px.from === "u" ? u : v), lerp(plan.py.knots, plan.py.from === "u" ? u : v)];
    }
    function floorPlanRectPx(toPx, r) {
      const [ax, ay] = toPx(r[0], r[1]), [bx, by] = toPx(r[2], r[3]);
      return [Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by)];
    }
    // Every plan's ground-floor interior, screenshot px (indoors, the floor
    // mesh, and where trees and grass stay out).
    const FLOOR_PLAN_FLOORS_PX = FLOOR_PLANS.flatMap((plan) => {
      const toPx = floorPlanToPx(plan);
      return plan.floors.map((r) => floorPlanRectPx(toPx, r));
    });
    const FLOOR_PLAN_QUADS_PX = FLOOR_PLANS.flatMap((plan) => {
      const toPx = floorPlanToPx(plan);
      return (plan.floorQuads || []).map((q) => q.map(([u, v]) => toPx(u, v)));
    });
    const inFloorPlanQuad = (px, py) => FLOOR_PLAN_QUADS_PX.some((q) => pointInPolygon(px, py, q));
    // Rectangle minus rectangle, screenshot px -> up to four rectangles.
    function subtractPxRect(r, h) {
      if (h[0] >= r[2] || h[2] <= r[0] || h[1] >= r[3] || h[3] <= r[1]) return [r];
      const out = [];
      if (h[1] > r[1]) out.push([r[0], r[1], r[2], h[1]]);
      if (h[3] < r[3]) out.push([r[0], h[3], r[2], r[3]]);
      const y0 = Math.max(r[1], h[1]), y1 = Math.min(r[3], h[3]);
      if (h[0] > r[0]) out.push([r[0], y0, h[0], y1]);
      if (h[2] < r[2]) out.push([h[2], y0, r[2], y1]);
      return out;
    }
    // Sunken floors (plans whose `level` is below the ground): the floors
    // minus `raisedFloors`, stopped at the inside face of the exterior walls
    // (the walls themselves stand on the ground outside), plus `sunkenExtra`.
    // { rect (screenshot px), depth (m) } -- see groundHeightAt.
    const FLOOR_PLAN_SUNKEN = FLOOR_PLANS.filter((plan) => plan.level < 0).flatMap((plan) => {
      const toPx = floorPlanToPx(plan);
      const floors = plan.floors.map((r) => floorPlanRectPx(toPx, r));
      let lower = floors;
      for (const h of (plan.raisedFloors || []).map((r) => floorPlanRectPx(toPx, r))) lower = lower.flatMap((r) => subtractPxRect(r, h));
      // (open straight into another walk-in building, e.g. Kise, counts as inside)
      const inside = (x, y) => [...FLOOR_PLAN_FLOORS_PX, ...HOLLOW_BUILDINGS].some((f) => x > f[0] && x < f[2] && y > f[1] && y < f[3]);
      const onOutline = (x0, y0, x1, y1, nx, ny) => [0.1, 0.3, 0.5, 0.7, 0.9].some((t) =>
        !inside(x0 + (x1 - x0) * t + nx * 0.3, y0 + (y1 - y0) * t + ny * 0.3));
      const wallPx = HOLLOW_WALL_M / MAP_SCALE;
      lower = lower.flatMap(([x0, y0, x1, y1]) => {
        const cut = [onOutline(x0, y0, x0, y1, -1, 0), onOutline(x0, y0, x1, y0, 0, -1), onOutline(x1, y0, x1, y1, 1, 0), onOutline(x0, y1, x1, y1, 0, 1)];
        const r = [cut[0] ? x0 + wallPx : x0, cut[1] ? y0 + wallPx : y0, cut[2] ? x1 - wallPx : x1, cut[3] ? y1 - wallPx : y1];
        // Where a cut edge is only partly wall (the rest opens into another
        // walk-in building), give the open stretches back as tabs.
        const tabs = [];
        const edges = [
          [cut[0], (t) => [x0, t], [y0, y1], (a, b) => [x0, a, r[0], b], [-0.3, 0]],
          [cut[1], (t) => [t, y0], [x0, x1], (a, b) => [a, y0, b, r[1]], [0, -0.3]],
          [cut[2], (t) => [x1, t], [y0, y1], (a, b) => [r[2], a, x1, b], [0.3, 0]],
          [cut[3], (t) => [t, y1], [x0, x1], (a, b) => [a, r[3], b, y1], [0, 0.3]],
        ];
        for (const [isCut, at, [lo, hi], tab, [nx, ny]] of edges) {
          if (!isCut) continue;
          let start = null;
          for (let t = lo; t <= hi + 1e-6; t += 0.25) {
            const [px, py] = at(Math.min(t + 0.125, hi));
            const open = t < hi && inside(px + nx, py + ny);
            if (open && start === null) start = t;
            if (!open && start !== null) { tabs.push(tab(start, Math.min(t, hi))); start = null; }
          }
        }
        return [r, ...tabs];
      });
      const extra = (plan.sunkenExtra || []).map((r) => floorPlanRectPx(toPx, r));
      return [...lower, ...extra].map((rect) => ({ rect, depth: -plan.level }));
    });
    const sunkenWorld = FLOOR_PLAN_SUNKEN.map((s) => ({ ...rectToWorld(s.rect), depth: s.depth }));
    // Ramps (FLOOR_PLANS' `ramps`): smooth slopes, part of the ground height
    // (see groundHeightAt), world units.
    const FLOOR_PLAN_RAMPS = FLOOR_PLANS.flatMap((plan) => {
      const toPx = floorPlanToPx(plan);
      return (plan.ramps || []).map(([ua, va, ub, vb, width, ha, hb]) => {
        const a = mapToWorld(...toPx(ua, va)), b = mapToWorld(...toPx(ub, vb));
        const len = Math.hypot(b.x - a.x, b.z - a.z);
        return { a, b, len, ux: (b.x - a.x) / len, uz: (b.z - a.z) / len, half: width / 2, ha, hb, floor: plan.level || 0 };
      });
    });
    // Height of a ramp's surface at (x, z), or null off every ramp.
    function rampHeightAt(x, z) {
      for (const r of FLOOR_PLAN_RAMPS) {
        const dx = x - r.a.x, dz = z - r.a.z;
        const along = dx * r.ux + dz * r.uz, across = Math.abs(dx * -r.uz + dz * r.ux);
        if (along >= 0 && along <= r.len && across <= r.half) return r.ha + ((r.hb - r.ha) * along) / r.len;
      }
      return null;
    }
    // Stair ramps: an invisible slope over every stair (FLOOR_PLANS'
    // `stairs`), like the curbs' (CURB_RAMP_M) -- the sloped player clip
    // games lay over steps -- so walking up or down one glides instead of
    // popping a step at a time. It runs through the middle of each step's
    // rise (never more than half a step off the real treads), starting half
    // a tread out in front of the bottom step and levelling off over the
    // last half tread. Only supportHeightAt uses it (in place of that
    // stair's step tops); the steps stay the solid colliders everything
    // else (the nav grid, sight, collision) sees. World units.
    const FLOOR_PLAN_STAIR_RAMPS = new Map(); // stair entry (its array) -> ramp
    // Walk-in buildings' exterior brick walls, for the night windows (see
    // WINDOWS): filled in by floorPlanColliders.
    const FLOOR_PLAN_FACADES = [];
    for (const plan of FLOOR_PLANS) {
      const toPx = floorPlanToPx(plan);
      const W = (u, v) => mapToWorld(...toPx(u, v));
      for (const stair of plan.stairs || []) {
        const [u1, v1, u2, v2, dir, h0, h1] = stair;
        if (!(h1 > h0)) continue; // a landing
        const um = (u1 + u2) / 2, vm = (v1 + v2) / 2;
        const [bottom, top] = { "+u": [[u1, vm], [u2, vm]], "-u": [[u2, vm], [u1, vm]], "+v": [[um, v1], [um, v2]], "-v": [[um, v2], [um, v1]] }[dir];
        const a = W(...bottom), b = W(...top);
        const len = Math.hypot(b.x - a.x, b.z - a.z);
        const dx = (b.x - a.x) / len, dz = (b.z - a.z) / len;
        const r = rectToWorld(floorPlanRectPx(toPx, [u1, v1, u2, v2]));
        const half = Math.abs(dx) > Math.abs(dz) ? (r.maxZ - r.minZ) / 2 : (r.maxX - r.minX) / 2;
        const n = Math.ceil((h1 - h0) / FP_MAX_RISE_M - 1e-6);
        FLOOR_PLAN_STAIR_RAMPS.set(stair, { ax: a.x, az: a.z, dx, dz, len, half, h0, h1, tread: len / n, rise: (h1 - h0) / n });
      }
    }
    // The stair ramp under (x, z) for a body whose feet can reach fromY:
    // { ramp, h } or null.
    function stairRampAt(x, z, fromY) {
      for (const r of FLOOR_PLAN_STAIR_RAMPS.values()) {
        const px = x - r.ax, pz = z - r.az;
        const s = px * r.dx + pz * r.dz;
        if (s < -r.tread / 2 || s > r.len || Math.abs(pz * r.dx - px * r.dz) > r.half) continue;
        const h = Math.max(r.h0, Math.min(r.h1, r.h0 + r.rise * (s / r.tread + 0.5)));
        if (h <= fromY + 0.01) return { ramp: r, h };
      }
      return null;
    }
    // STAIR PORTALS (enemy navigation between floors). The nav grid holds one
    // stand height per cell, so an upper floor (Comstock's second floor, a
    // stairwell's top landing) isn't part of it and a stair's top reads as a
    // dead end. Each portal is a known walking line up an existing stair,
    // bottom -> top; findPath uses it to join the floor below to the floor
    // above. Enemies still walk the real steps (it's a route, not a
    // teleport). `level` is shared by every portal reaching the same floor
    // of the same building; a body counts as up there once it stands within
    // NAV_LEVEL_MARGIN_M of that floor's height, inside the building.
    const NAV_LEVEL_MARGIN_M = 1.0;
    const FLOOR_PLAN_LEVELS = new Map(); // "building:height" -> level
    const FLOOR_PLAN_PORTALS = FLOOR_PLANS.flatMap((plan) => {
      const toPx = floorPlanToPx(plan);
      const floors = plan.floors.map((r) => rectToWorld(floorPlanRectPx(toPx, r)));
      return (plan.portals || []).map((raw) => {
        const open = !(raw.length && raw[raw.length - 1] && raw[raw.length - 1].open === false);
        const line = raw.filter(Array.isArray).map(([u, v, h]) => ({ ...mapToWorld(...toPx(u, v)), y: h }));
        const upperH = line[line.length - 1].y, lowerH = line[0].y;
        const key = plan.name + ":" + upperH;
        if (!FLOOR_PLAN_LEVELS.has(key)) {
          FLOOR_PLAN_LEVELS.set(key, {
            key, refY: upperH, floors,
            box: {
              minX: Math.min(...floors.map((f) => f.minX)), maxX: Math.max(...floors.map((f) => f.maxX)),
              minZ: Math.min(...floors.map((f) => f.minZ)), maxZ: Math.max(...floors.map((f) => f.maxZ)),
            },
          });
        }
        const pad = 1.2;
        return {
          level: FLOOR_PLAN_LEVELS.get(key), line, lowerH, upperH, open,
          bottom: line[0], top: line[line.length - 1],
          box: {
            minX: Math.min(...line.map((q) => q.x)) - pad, maxX: Math.max(...line.map((q) => q.x)) + pad,
            minZ: Math.min(...line.map((q) => q.z)) - pad, maxZ: Math.max(...line.map((q) => q.z)) + pad,
          },
        };
      });
    });
    // Which upper floor (level) a body standing at height y is on, or null
    // for the ordinary ground-level navigation.
    function navLevelAt(x, z, y) {
      if (y === undefined) return null;
      for (const level of FLOOR_PLAN_LEVELS.values()) {
        if (y < level.refY - NAV_LEVEL_MARGIN_M || y > level.refY + 2) continue;
        if (level.floors.some((f) => x > f.minX && x < f.maxX && z > f.minZ && z < f.maxZ)) return level;
      }
      return null;
    }
    // The portal whose stair a body is partway up (not at either end), or null.
    function navPortalUnder(x, z, y) {
      for (const p of FLOOR_PLAN_PORTALS) {
        if (x < p.box.minX || x > p.box.maxX || z < p.box.minZ || z > p.box.maxZ) continue;
        if (y > p.lowerH + 0.15 && y < p.upperH - 0.15) return p;
      }
      return null;
    }

    // Floors at ground level (the floor mesh): everything but the sunken parts.
    const FLOOR_PLAN_GROUND_FLOORS_PX = FLOOR_PLANS.flatMap((plan) => {
      const toPx = floorPlanToPx(plan);
      return (plan.level < 0 ? plan.raisedFloors || [] : plan.floors).map((r) => floorPlanRectPx(toPx, r));
    });

    // World rect helpers (world rects: { minX, maxX, minZ, maxZ }).
    function intersectWorldRects(a, b) {
      const r = { minX: Math.max(a.minX, b.minX), maxX: Math.min(a.maxX, b.maxX), minZ: Math.max(a.minZ, b.minZ), maxZ: Math.min(a.maxZ, b.maxZ) };
      return r.maxX - r.minX > 0.01 && r.maxZ - r.minZ > 0.01 ? r : null;
    }
    function subtractWorldRects(rects, holes) {
      let out = rects;
      for (const h of holes) {
        const next = [];
        for (const r of out) {
          if (!intersectWorldRects(r, h)) { next.push(r); continue; }
          const midZ0 = Math.max(r.minZ, h.minZ), midZ1 = Math.min(r.maxZ, h.maxZ);
          const pieces = [
            { minX: r.minX, maxX: r.maxX, minZ: r.minZ, maxZ: h.minZ },
            { minX: r.minX, maxX: r.maxX, minZ: h.maxZ, maxZ: r.maxZ },
            { minX: r.minX, maxX: h.minX, minZ: midZ0, maxZ: midZ1 },
            { minX: h.maxX, maxX: r.maxX, minZ: midZ0, maxZ: midZ1 },
          ];
          for (const p of pieces) if (p.maxX - p.minX > 0.01 && p.maxZ - p.minZ > 0.01) next.push(p);
        }
        out = next;
      }
      return out;
    }

    // One plan -> colliders: exterior walls, partitions (with their doors
    // cut out), solid rooms, cosmetic doors, stairs, the ceiling slabs and
    // the building's mass above them, and (Comstock) the second floor.
    function floorPlanColliders(plan) {
      const toPx = floorPlanToPx(plan);
      const W = (u, v) => { const [x, y] = toPx(u, v); return mapToWorld(x, y); };
      const rectW = (r) => rectToWorld(floorPlanRectPx(toPx, r));
      const DIRS = { "+u": [1, 0], "-u": [-1, 0], "+v": [0, 1], "-v": [0, -1] };
      const dirW = (u, v, d) => {
        const a = W(u, v), b = W(u + DIRS[d][0], v + DIRS[d][1]);
        const len = Math.hypot(b.x - a.x, b.z - a.z);
        return { x: (b.x - a.x) / len, z: (b.z - a.z) / len };
      };
      const floorsPx = plan.floors.map((r) => floorPlanRectPx(toPx, r));
      const cpx = (Math.min(...floorsPx.map((r) => r[0])) + Math.max(...floorsPx.map((r) => r[2]))) / 2;
      const cpy = (Math.min(...floorsPx.map((r) => r[1])) + Math.max(...floorsPx.map((r) => r[3]))) / 2;
      const out = [];
      // A box of half size hx (along yaw) x hz, from base to top.
      const addBox = (cx, cz, hx, hz, base, top, yaw, props) => {
        if (hx <= 0.005 || hz <= 0.005 || top - base <= 0.005) return null;
        const c = makeCollider(cx, cz, hx, hz, top, yaw);
        if (base !== 0) { c.base = base; c.halfHeight = true; }
        Object.assign(c, props);
        c.px = cpx;
        c.py = cpy;
        c.floorPlan = true;
        out.push(c);
        return c;
      };
      const addRect = (r, base, top, props, inset = 0) => addBox((r.minX + r.maxX) / 2, (r.minZ + r.maxZ) / 2,
        (r.maxX - r.minX) / 2 - inset, (r.maxZ - r.minZ) / 2 - inset, base, top, 0, props);

      const upper = plan.upper;
      const lowerCeiling = upper ? upper.level - upper.slab : plan.ceiling;
      const L = plan.level || 0; // the ground floor (below 0 when sunken)
      const floorsW = plan.floors.map(rectW);
      const insideFloors = (x, z) => floorsW.some((f) => x > f.minX && x < f.maxX && z > f.minZ && z < f.maxZ);
      // A painted slab under a ceiling (or a floor): flush with its
      // neighbours (a little overlap), but kept inside the brick exterior
      // walls so it never shows on the outside.
      const addSlab = (r, base, top, color) => {
        const side = (x0, z0, x1, z1, nx, nz) => [0.1, 0.3, 0.5, 0.7, 0.9].some((t) =>
          !insideFloors(x0 + (x1 - x0) * t + nx * 0.1, z0 + (z1 - z0) * t + nz * 0.1)) ? -0.05 : 0.02;
        const g = {
          minX: r.minX - side(r.minX, r.minZ, r.minX, r.maxZ, -1, 0),
          maxX: r.maxX + side(r.maxX, r.minZ, r.maxX, r.maxZ, 1, 0),
          minZ: r.minZ - side(r.minX, r.minZ, r.maxX, r.minZ, 0, -1),
          maxZ: r.maxZ + side(r.minX, r.maxZ, r.maxX, r.maxZ, 0, 1),
        };
        addRect(g, base, top, { color });
      };
      const roofZones = (plan.roofs || [[-1e5, -1e5, 1e5, 1e5, plan.roof]]).map((z) => ({ rect: rectW(z), h: z[4] }));
      const shafts = (plan.shafts || []).map((s) => ({ rect: rectW(s), top: s[4] }));
      const inRectW = (r, p) => p.x > r.minX && p.x < r.maxX && p.z > r.minZ && p.z < r.maxZ;
      const roofAt = (p) => (roofZones.find((z) => inRectW(z.rect, p)) || { h: plan.roof }).h;
      const ceilingAt = (p) => (shafts.find((s) => inRectW(s.rect, p)) || { top: plan.ceiling }).top;

      // Walls: { a, b (the plan line, world), off (world offset of the
      // wall's center line), thick, base, top, props, gaps }.
      const walls = [];
      for (const outline of plan.outlines || []) {
        const pts = (outline.points || outline).map(([u, v]) => W(u, v));
        let area = 0;
        for (let i = 0; i < pts.length; i++) {
          const p = pts[i], q = pts[(i + 1) % pts.length];
          area += p.x * q.z - q.x * p.z;
        }
        const skipClosing = outline.open === true; // the edge back to the first point is open
        const glassEdges = outline.glass || [];
        for (let i = 0; i < pts.length; i++) {
          if (skipClosing && i === pts.length - 1) continue;
          const a = pts[i], b = pts[(i + 1) % pts.length];
          const len = Math.hypot(b.x - a.x, b.z - a.z);
          if (len < 0.01) continue;
          const ux = (b.x - a.x) / len, uz = (b.z - a.z) / len;
          const n = area > 0 ? { x: -uz, z: ux } : { x: uz, z: -ux }; // toward the inside
          const mid = { x: (a.x + b.x) / 2 + n.x * 0.6, z: (a.z + b.z) / 2 + n.z * 0.6 };
          const top = roofAt(mid);
          const t = HOLLOW_WALL_M;
          if (glassEdges.includes(i)) {
            // All glass up to the ceiling, brick above it.
            walls.push({ a, b, off: { x: n.x * t / 2, z: n.z * t / 2 }, thick: t, base: lowerCeiling, top, props: {}, gaps: [], exterior: true });
            addBox((a.x + b.x) / 2 + n.x * t / 2, (a.z + b.z) / 2 + n.z * t / 2, len / 2, 0.03, 0, lowerCeiling, Math.atan2(-uz, ux),
              { glass: true, seeThrough: true });
          } else {
            walls.push({ a, b, off: { x: n.x * t / 2, z: n.z * t / 2 }, thick: t, base: 0, top, props: {}, gaps: [], exterior: true });
          }
          if (Math.abs(ux) > 0.01 && Math.abs(uz) > 0.01) {
            // Slanted / curved wall: a band of roof running along it, from
            // the ceiling under it up to the wall's top.
            const base = ceilingAt(mid);
            const yaw = Math.atan2(-uz, ux);
            const cx = (a.x + b.x) / 2 + n.x * FP_BAND_DEPTH_M / 2, cz = (a.z + b.z) / 2 + n.z * FP_BAND_DEPTH_M / 2;
            addBox(cx, cz, len / 2, FP_BAND_DEPTH_M / 2, base, top, yaw, {});
            addBox(cx + n.x * 0.05, cz + n.z * 0.05, len / 2 - 0.05, FP_BAND_DEPTH_M / 2 - 0.05,
              base - 0.12, base, yaw, { color: FP_COLORS.ceiling });
          }
        }
      }
      const addPartitions = (list, base, top, brick = []) => {
        (list || []).forEach((p, i) => {
          const a = W(p[0], p[1]), b = W(p[2], p[3]);
          const props = brick.includes(i) ? {} : { color: FP_COLORS.partition };
          walls.push({ a, b, off: { x: 0, z: 0 }, thick: FP_PARTITION_M, base, top: p[4] || top, props, gaps: [], trim: 0.03 });
        });
      };
      addPartitions(plan.partitions, L, lowerCeiling, plan.brickPartitions);
      if (upper) addPartitions(upper.partitions, upper.level, plan.ceiling);

      // Doors: real ones cut a gap into every wall they sit on; fake ones
      // are a panel in a frame, with a handle, on the face side.
      const addDoors = (list, levelBase, levelCeiling) => {
        for (const [u, v, width, kind, face, opts = {}] of list || []) {
          const p = W(u, v);
          const base = levelBase + (opts.base || 0);
          if (kind === "fake") {
            const f = dirW(u, v, face);
            const along = { x: -f.z, z: f.x };
            const yaw = Math.atan2(-along.z, along.x);
            const h = FP_FAKE_DOOR_HEIGHT_M;
            const panel = { color: opts.color !== undefined ? opts.color : FP_COLORS.door, collide: false };
            addBox(p.x + f.x * 0.02, p.z + f.z * 0.02, width / 2 + 0.08, 0.04, base, base + h + 0.08, yaw, { color: FP_COLORS.doorFrame, collide: false });
            addBox(p.x + f.x * 0.05, p.z + f.z * 0.05, width / 2, 0.07, base, base + h, yaw, panel);
            if (opts.color === undefined) {
              const hx = p.x + f.x * 0.14 + along.x * (width / 2 - 0.16), hz = p.z + f.z * 0.14 + along.z * (width / 2 - 0.16);
              addBox(hx, hz, 0.06, 0.03, base + 1.0, base + 1.04, yaw, { color: FP_COLORS.handle, collide: false });
            }
            continue;
          }
          const top = kind === "open" ? levelCeiling : base + (opts.h || FP_DOOR_HEIGHT_M);
          if (kind === "glass") {
            // A closed glass door: a pane in a dark frame, filling the opening.
            const along = (() => {
              let best = null;
              for (const w of walls) {
                const len = Math.hypot(w.b.x - w.a.x, w.b.z - w.a.z);
                const ux = (w.b.x - w.a.x) / len, uz = (w.b.z - w.a.z) / len;
                const d = Math.abs((p.x - w.a.x) * -uz + (p.z - w.a.z) * ux);
                if (d < 0.45 && (!best || d < best.d)) best = { d, ux, uz, off: w.off };
              }
              return best;
            })();
            if (along) {
              const yaw = Math.atan2(-along.uz, along.ux);
              const cx = p.x + along.off.x, cz = p.z + along.off.z;
              const doorBase = Math.max(base, 0);
              addBox(cx, cz, width / 2, 0.03, doorBase, top, yaw, { glass: true, seeThrough: true });
              for (const side of [-1, 1]) { // frame
                addBox(cx + along.ux * side * (width / 2 - 0.03), cz + along.uz * side * (width / 2 - 0.03), 0.03, 0.06,
                  doorBase, top, yaw, { color: 0x2f3338, collide: false });
              }
              addBox(cx, cz, width / 2, 0.06, top - 0.06, top, yaw, { color: 0x2f3338, collide: false });
              addBox(cx, cz, 0.02, 0.07, doorBase + 0.9, doorBase + 1.3, yaw, { color: 0xc9c9c9, collide: false }); // handles
            }
          }
          for (const w of walls) {
            if (w.top <= base || w.base >= top) continue;
            const len = Math.hypot(w.b.x - w.a.x, w.b.z - w.a.z);
            const ux = (w.b.x - w.a.x) / len, uz = (w.b.z - w.a.z) / len;
            const s = (p.x - w.a.x) * ux + (p.z - w.a.z) * uz;
            const d = Math.abs((p.x - w.a.x) * -uz + (p.z - w.a.z) * ux);
            if (d > 0.45 || s < -0.1 || s > len + 0.1) continue;
            w.gaps.push({ s0: s - width / 2, s1: s + width / 2, y0: base, y1: top });
          }
        }
      };
      addDoors(plan.doors, L, lowerCeiling);
      if (upper) addDoors(upper.doors, upper.level, plan.ceiling);

      for (const w of walls) {
        const len = Math.hypot(w.b.x - w.a.x, w.b.z - w.a.z);
        const ux = (w.b.x - w.a.x) / len, uz = (w.b.z - w.a.z) / len;
        const yaw = Math.atan2(-uz, ux);
        const trim = w.trim || 0;
        const piece = (s0, s1, y0, y1) => {
          s0 = Math.max(s0, trim);
          s1 = Math.min(s1, len - trim);
          if (s1 - s0 < 0.01) return;
          const m = (s0 + s1) / 2;
          addBox(w.a.x + w.off.x + ux * m, w.a.z + w.off.z + uz * m, (s1 - s0) / 2, w.thick / 2, y0, y1, yaw, { ...w.props });
        };
        // Between every pair of neighbouring gap ends, the wall minus each gap
        // over that stretch (gaps can stack: a door on each floor, one above
        // the other), so below a gap (a door up a floor), between stacked
        // gaps and the lintel all stay.
        const cuts = [...new Set([0, len, ...w.gaps.flatMap((g) => [g.s0, g.s1])])].filter((s) => s >= 0 && s <= len).sort((a, b) => a - b);
        for (let i = 0; i + 1 < cuts.length; i++) {
          const s0 = cuts[i], s1 = cuts[i + 1], m = (s0 + s1) / 2;
          let y = w.base;
          for (const g of w.gaps.filter((g) => g.s0 < m && g.s1 > m).sort((a, b) => a.y0 - b.y0)) {
            if (g.y0 > y) piece(s0, s1, y, Math.min(w.top, g.y0));
            y = Math.max(y, g.y1);
          }
          if (y < w.top) piece(s0, s1, y, w.top);
        }
      }
      // Exterior brick walls standing on the ground, with the openings cut
      // into them, for the night windows (WINDOWS).
      for (const w of walls) {
        if (!w.exterior || w.base > 0.01) continue;
        const offLen = Math.hypot(w.off.x, w.off.z) || 1;
        FLOOR_PLAN_FACADES.push({ a: w.a, b: w.b, outX: -w.off.x / offLen, outZ: -w.off.z / offLen, top: w.top, gaps: w.gaps, key: plan.name });
      }

      // Rooms that aren't walk-in, and pillars.
      for (const s of plan.solids || []) addRect(rectW(s), L, lowerCeiling, { color: FP_COLORS.solid }, FP_INSET_M);
      for (const s of plan.columns || []) addRect(rectW(s), L, lowerCeiling, { color: FP_COLORS.partition }, FP_INSET_M);
      if (upper) for (const s of upper.solids || []) addRect(rectW(s), upper.level, plan.ceiling, { color: FP_COLORS.solid }, FP_INSET_M);

      // Stairs: solid steps (walkable, like the bleachers), each at most
      // FP_MAX_RISE_M above the last.
      for (const stair of plan.stairs || []) {
        const [u1, v1, u2, v2, dir, h0, h1] = stair;
        const stairRamp = FLOOR_PLAN_STAIR_RAMPS.get(stair);
        const n = h1 > h0 ? Math.ceil((h1 - h0) / FP_MAX_RISE_M - 1e-6) : 1;
        for (let i = 0; i < n; i++) {
          const f0 = i / n, f1 = (i + 1) / n;
          let r;
          if (dir === "+u") r = [u1 + (u2 - u1) * f0, v1, u1 + (u2 - u1) * f1, v2];
          else if (dir === "-u") r = [u2 - (u2 - u1) * f1, v1, u2 - (u2 - u1) * f0, v2];
          else if (dir === "+v") r = [u1, v1 + (v2 - v1) * f0, u2, v1 + (v2 - v1) * f1];
          else r = [u1, v2 - (v2 - v1) * f1, u2, v2 - (v2 - v1) * f0];
          // (a stair that starts at ground level stands on it; one that starts
          // below it runs down to the sunken floor)
          // Steps butt against each other with no gap along the run (a gap
          // would read as the floor below to the nav grid); only the sides
          // are kept off the walls.
          const w = rectW(r), along = dir === "+u" || dir === "-u" ? "u" : "v";
          const alongX = (rectW([0, 0, 1, 0]).maxX - rectW([0, 0, 1, 0]).minX) > (rectW([0, 0, 0, 1]).maxX - rectW([0, 0, 0, 1]).minX)
            ? along === "u" : along === "v"; // does the run go along world x?
          const g = alongX
            ? { minX: w.minX - 0.005, maxX: w.maxX + 0.005, minZ: w.minZ + FP_INSET_M, maxZ: w.maxZ - FP_INSET_M }
            : { minX: w.minX + FP_INSET_M, maxX: w.maxX - FP_INSET_M, minZ: w.minZ - 0.005, maxZ: w.maxZ + 0.005 };
          addRect(g, h0 >= 0 ? 0 : L, h0 + (h1 - h0) * (h1 > h0 ? f1 : 1), { color: FP_COLORS.stair, climbable: true, stairRamp });
        }
      }

      // Glass rails: a pane with a steel cap along each segment.
      const addRail = (a, b, base, top, props = {}) => {
        const len = Math.hypot(b.x - a.x, b.z - a.z);
        const yaw = Math.atan2(-(b.z - a.z), b.x - a.x);
        const cx = (a.x + b.x) / 2, cz = (a.z + b.z) / 2;
        addBox(cx, cz, len / 2, 0.03, base, top, yaw, { glass: true, seeThrough: true, ...props });
        if (props.render !== false) addBox(cx, cz, len / 2, 0.05, top, top + 0.06, yaw, { color: FP_COLORS.railCap, collide: false });
      };
      for (const [u1, v1, u2, v2] of plan.rails || []) addRail(W(u1, v1), W(u2, v2), 0, FP_RAIL_HEIGHT_M);

      // Ramps: the slope itself is ground (FLOOR_PLAN_RAMPS, drawn with the
      // sunken floors); here just the colliders of the glass rail down each
      // side, in short lengths that step with it. They aren't drawn: the
      // rails you see are smooth, sloped with the ramp (see "Ramp rails").
      for (const [ua, va, ub, vb, width, ha, hb] of plan.ramps || []) {
        const a = W(ua, va), b = W(ub, vb);
        const len = Math.hypot(b.x - a.x, b.z - a.z);
        const ux = (b.x - a.x) / len, uz = (b.z - a.z) / len;
        const nx = -uz, nz = ux;
        const n = 16;
        for (let i = 0; i < n; i++) {
          const top = ha + ((hb - ha) * i) / n;
          const s0 = (len * i) / n, s1 = (len * (i + 1)) / n, m = (s0 + s1) / 2;
          const cx = a.x + ux * m, cz = a.z + uz * m;
          for (const side of [-1, 1]) {
            const ex = cx + nx * side * width / 2, ez = cz + nz * side * width / 2;
            addRail({ x: ex - ux * (s1 - s0) / 2, z: ez - uz * (s1 - s0) / 2 }, { x: ex + ux * (s1 - s0) / 2, z: ez + uz * (s1 - s0) / 2 },
              L, Math.max(top, L) + FP_RAIL_HEIGHT_M, { render: false });
          }
        }
      }

      // Ceilings and the mass above them, per roof area; stairwells (shafts)
      // get their own higher ceiling.
      const shaftRects = shafts.map((s) => s.rect);
      const slabUnder = (r, at) => addSlab(r, at - 0.12, at, FP_COLORS.ceiling);
      for (const f of floorsW) {
        for (const z of roofZones) {
          const i = intersectWorldRects(f, z.rect);
          if (!i) continue;
          for (const r of subtractWorldRects([i], shaftRects)) {
            addRect(r, plan.ceiling, z.h, {});
            slabUnder(r, plan.ceiling);
          }
          for (const s of shafts) {
            const r = intersectWorldRects(i, s.rect);
            if (!r) continue;
            addRect(r, s.top, z.h, {});
            slabUnder(r, s.top);
          }
        }
      }

      // Second floor: the slab (the first floor's ceiling underneath, carpet
      // on top) with its openings, and glass railings around them.
      if (upper) {
        const holes = upper.holes.map(rectW);
        for (const r of subtractWorldRects(floorsW, holes)) {
          addSlab(r, upper.level - upper.slab, upper.level - 0.05, FP_COLORS.ceiling);
          addSlab(r, upper.level - 0.05, upper.level, FP_COLORS.carpet);
        }
        for (const [u1, v1, u2, v2] of upper.rails || []) addRail(W(u1, v1), W(u2, v2), upper.level, upper.level + FP_RAIL_HEIGHT_M);
      }
      return out;
    }

    // Round buildings: [centerX, centerY, radius px, height in meters].
    const CYLINDER_BUILDINGS = [
      [1003, 302, 20, 30],        // Nelson Hall -- a tall round tower
    ];

    // Buildings that sit at an angle: [centerX, centerY, length px, width px,
    // height in meters, angle in degrees (counterclockwise on the screenshot)].
    // (The angled wing of Ballard Hall used to be the only entry -- Ballard is
    // gone now, its site is open lawn.)
    const ROTATED_BUILDINGS = [
      // (Comstock's angled south-west wing is walk-in now: FLOOR_PLANS)
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
        openings: [[1464, 307.6]], // the Nemzek hallway's east door opens (via the inlet) into the stadium
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
        // (the library's north-east door and Comstock's west door, blue in
        // screenshot5B.png, are real openings now: FLOOR_PLANS / HOLLOW_BUILDINGS)
        props: [],
        trees: [
          [650, 215], [650, 237], [650, 258],          // flowering trees beside Comstock
          [641, 285], [647, 288],                      // plaza planter
          [627, 284], [628, 299],                      // west of the plaza
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
        props: [
          ...fieldhouseProps(),
          // Hallway west entrance (gamenemzekentrance.jpg): a white overhang
          // over the doors on two tan-brick pillars at its outer corners.
          [1322.3, 297.6, 1329.3, 317.6, 2.8, 0xe6e2d8, 3.3], // overhang
          [1322.6, 299, 1323.9, 300.3, 3.3, 0xc99561],   // brick pillars
          [1322.6, 314.9, 1323.9, 316.2, 3.3, 0xc99561],
          // "NEMZEK HALL" sign (gamenemzeksign.jpg) north of the entrance
          // walk, face to the south, square to the building: a cream panel
          // on two brick pedestals (lettering: see the sign's face below).
          [1313.6, 300.2, 1320.4, 300.75, 1.9, 0xe4e0d6, 0.45, "solid"],
          [1314.5, 300.05, 1315.4, 300.9, 1.2, 0xb8714a],
          [1318.6, 300.05, 1319.5, 300.9, 1.2, 0xb8714a],
        ],
      },
      Z18: {
        bleachers: [
          // west grandstand (20 walkable steps), open to the sky -- press box below
          [1485, 313, 1509, 440, 10, 20, "e", 0x9da3aa], // north end overlaps the NE inlet a little (screenshot8nemzek.png)
          [1637, 340, 1652, 415, 4, 8, "w", 0x9da3aa], // east bleachers
        ],
        props: [
          [1515, 195, 1528, 210, 3.5, 0xc9c2b3],      // ticket booth north of the track
          // Press box (standspressbox.png): a white two-level box perched on the
          // back rows on red steel columns, in front of a brick back wall.
          [1483.4, 313.3, 1484.9, 439.7, 11.5, 0xa0523f], // brick back wall just behind the top row (no shared faces -> no flicker)
          // (north-south span from screenshot8nemzek.png: ~y 349-390)
          [1486, 352, 1495, 387, 3, 0xf1f1ee, 10, "solid"],    // lower level
          [1485, 349, 1497, 390, 3.2, 0xf6f6f3, 13, "solid"],  // upper level, overhanging
          [1497, 351, 1497.3, 388, 1.1, 0x2d3440, 14.2], // window band (east face)
          [1495.3, 353, 1495.6, 386, 0.9, 0x2d3440, 11.2], // lower windows
          [1495, 350, 1496, 351, 13, 0xb3302a], [1495, 363, 1496, 364, 13, 0xb3302a],
          [1495, 375, 1496, 376, 13, 0xb3302a], [1495, 388, 1496, 389, 13, 0xb3302a], // red columns
          [1488, 355, 1489, 356, 1, 0xdddddd, 16.2], [1488, 369, 1489, 370, 1, 0xdddddd, 16.2],
          [1488, 383, 1489, 384, 1, 0xdddddd, 16.2], // rooftop lights
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
        const wall = (minX, maxX, minZ, maxZ, top, base, glass) => pieces.push({ minX, maxX, minZ, maxZ, top, base, glass });
        // One side: `along` is its long-axis extent; gaps come from the doors on it.
        const side = (name, fixedMin, fixedMax, along) => {
          const horizontal = name === "n" || name === "s";
          const seg = (a0, a1, top, base) => {
            a0 = Math.max(a0, along[0]); a1 = Math.min(a1, along[1]);
            if (a1 - a0 < 0.01) return;
            if (horizontal) wall(a0, a1, fixedMin, fixedMax, top, base);
            else wall(fixedMin, fixedMax, a0, a1, top, base);
          };
          // A glass pane, thin, in the middle of the wall's thickness.
          const mid = (fixedMin + fixedMax) / 2;
          const glassSeg = (a0, a1, top, base) => {
            a0 = Math.max(a0, along[0]); a1 = Math.min(a1, along[1]);
            if (a1 - a0 < 0.01) return;
            if (horizontal) wall(a0, a1, mid - GLASS_PANE_M / 2, mid + GLASS_PANE_M / 2, top, base, true);
            else wall(mid - GLASS_PANE_M / 2, mid + GLASS_PANE_M / 2, a0, a1, top, base, true);
          };
          const toAlong = (px) => (horizontal ? mapToWorld(px, 0).x : mapToWorld(0, px).z);
          // Doors ({ at, width }) and glass spans ({ from, to, glass, doors }).
          const gaps = doors.filter((d) => d.side === name).map((d) => {
            if (d.from !== undefined) return { g0: toAlong(d.from), g1: toAlong(d.to), height: d.height, glass: d.glass, doors: d.doors };
            const at = toAlong(d.at);
            return { g0: at - d.width / 2, g1: at + d.width / 2, height: d.height };
          }).sort((a, b) => a.g0 - b.g0);
          let cursor = along[0];
          for (const g of gaps) {
            seg(cursor, g.g0, height, 0);
            if (g.height < height) seg(g.g0, g.g1, height, g.height); // lintel
            if (g.glass) {
              // Storefront glass up to the lintel, with door openings in it
              // (glass above each door).
              let at = g.g0;
              for (const doorPx of (g.doors || []).slice().sort((a, b) => a - b)) {
                const d0 = toAlong(doorPx) - GLASS_DOOR_WIDTH_M / 2, d1 = d0 + GLASS_DOOR_WIDTH_M;
                // A thin brick frame around the doorway (jambs + header),
                // kept inside this glass span so it never overlaps the wall.
                const f0 = Math.max(g.g0, d0 - GLASS_DOOR_FRAME_M), f1 = Math.min(g.g1, d1 + GLASS_DOOR_FRAME_M);
                const frameTop = Math.min(g.height, GLASS_DOOR_HEIGHT_M + GLASS_DOOR_HEADER_M);
                glassSeg(at, f0, g.height, 0);
                seg(f0, d0, frameTop, 0);
                seg(d1, f1, frameTop, 0);
                seg(d0, d1, frameTop, GLASS_DOOR_HEIGHT_M);
                glassSeg(f0, f1, g.height, frameTop);
                at = f1;
              }
              glassSeg(at, g.g1, g.height, 0);
            }
            cursor = Math.max(cursor, g.g1);
          }
          seg(cursor, along[1], height, 0);
        };
        side("n", w.minZ, w.minZ + t, [w.minX, w.maxX]);
        side("s", w.maxZ - t, w.maxZ, [w.minX, w.maxX]);
        side("w", w.minX, w.minX + t, [w.minZ + t, w.maxZ - t]);
        side("e", w.maxX - t, w.maxX, [w.minZ + t, w.maxZ - t]);
        const raised = b[7];
        const slab = b[8] ?? 0.3; // roof slab thickness
        if (b[9] !== undefined) {
          // painted ceiling under the roof slab (10th value: its color)
          pieces.push({ minX: w.minX + t - 0.02, maxX: w.maxX - t + 0.02, minZ: w.minZ + t - 0.02, maxZ: w.maxZ - t + 0.02,
            top: height - slab, base: height - slab - 0.12, color: b[9] });
        }
        if (!raised) {
          wall(w.minX, w.maxX, w.minZ, w.maxZ, height, height - slab); // roof slab
        } else {
          // A raised block (clerestory): the roof slab around it, brick
          // walls standing on the roof up to its own roof slab.
          const r = rectToWorld(raised);
          const top = raised[4];
          wall(w.minX, w.maxX, w.minZ, r.minZ, height, height - slab);
          wall(w.minX, w.maxX, r.maxZ, w.maxZ, height, height - slab);
          wall(w.minX, r.minX, r.minZ, r.maxZ, height, height - slab);
          wall(r.maxX, w.maxX, r.minZ, r.maxZ, height, height - slab);
          const rt = Math.max(0.3, slab / 2);
          wall(r.minX, r.maxX, r.minZ, r.minZ + rt, top, height - slab);
          wall(r.minX, r.maxX, r.maxZ - rt, r.maxZ, top, height - slab);
          wall(r.minX, r.minX + rt, r.minZ + rt, r.maxZ - rt, top, height - slab);
          wall(r.maxX - rt, r.maxX, r.minZ + rt, r.maxZ - rt, top, height - slab);
          wall(r.minX, r.maxX, r.minZ, r.maxZ, top, top - slab); // raised roof slab
        }
        for (const piece of pieces) {
          const c = makeCollider((piece.minX + piece.maxX) / 2, (piece.minZ + piece.maxZ) / 2,
            (piece.maxX - piece.minX) / 2, (piece.maxZ - piece.minZ) / 2, piece.top, 0);
          if (piece.base) {
            c.base = piece.base;
            c.halfHeight = true;
          }
          if (b[6] !== undefined) c.color = b[6];
          if (piece.color !== undefined) c.color = piece.color;
          if (piece.glass) {
            c.glass = true;
            c.seeThrough = true; // you (and enemies) can see through it
          }
          c.px = (x1 + x2) / 2;
          c.py = (y1 + y2) / 2;
          list.push(c);
        }
      }
      for (const g of GLASS_WALLS) {
        const a = mapToWorld(g[0], g[1]), b = mapToWorld(g[2], g[3]);
        const c = makeCollider((a.x + b.x) / 2, (a.z + b.z) / 2,
          Math.max(GLASS_PANE_M / 2, Math.abs(b.x - a.x) / 2), Math.max(GLASS_PANE_M / 2, Math.abs(b.z - a.z) / 2), g[4], 0);
        c.glass = true;
        c.seeThrough = true;
        c.px = (g[0] + g[2]) / 2;
        c.py = (g[1] + g[3]) / 2;
        list.push(c);
      }
      for (const plan of FLOOR_PLANS) list.push(...floorPlanColliders(plan));
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
    // One-way streets (ONE_WAY_STREETS): the same asphalt, but the dashed
    // line between their two lanes is white, as on a real one-way.
    const oneWayRoadTexture = canvasTexture(256, 64, (ctx, w, h) => {
      speckle(ctx, w, h, "#4a4a4c", 3000, 0.15, 4);
      ctx.fillStyle = "#e6e6e2";
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
      // The line along the heads of the stalls where one tile's last row
      // meets the next tile's first (the middle of a double row), so two
      // facing stalls read as two spots, not one very long one. Split
      // across the wrap so it sits centered on the seam.
      ctx.fillRect(0, 0, w, 2);
      ctx.fillRect(0, h - 1, w, 1);
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
    const oneWayRoadMaterial = surfaceMaterial(oneWayRoadTexture);
    const concreteMaterial = surfaceMaterial(concreteTexture);
    const indoorFloorMaterial = surfaceMaterial(concreteTexture); // FLOOR_PLANS' floors: concrete, like Kise's
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

    // Heat haze (cosmetic): on hot, dark, open surfaces -- roads, lots,
    // concrete -- a barely-there shimmer at a distance: the surface's own
    // texture wobbles by about a pixel (a screen-space offset of the
    // lookup, so no extra render pass) and, at low grazing angles, a faint
    // wavering sheen of sky color (the "wet road" look of hot air). Off
    // (zero cost beyond one uniform test) whenever heatHaze is 0.
    function addHeatHaze(material) {
      material.extensions = { derivatives: true };
      material.onBeforeCompile = (shader) => {
        shader.uniforms.envTime = environment.envTime;
        shader.uniforms.heatHaze = environment.heatHaze;
        shader.uniforms.hazeColor = environment.hazeColor;
        shader.uniforms.hazeNear = environment.hazeNear;
        shader.uniforms.hazeFar = environment.hazeFar;
        shader.vertexShader = shader.vertexShader
          .replace("#include <common>", "#include <common>\nvarying vec3 vHazeWorld;")
          .replace("#include <project_vertex>", "#include <project_vertex>\nvHazeWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;");
        shader.fragmentShader = shader.fragmentShader
          .replace("#include <common>", "#include <common>\nvarying vec3 vHazeWorld;\nuniform float envTime;\nuniform float heatHaze;\nuniform vec3 hazeColor;\nuniform float hazeNear;\nuniform float hazeFar;")
          .replace("#include <map_fragment>", [
            "float hazeK = 0.0;",
            "float hazeRipple = 0.0;",
            "if (heatHaze > 0.001) {",
            "  vec3 hazeTo = vHazeWorld - cameraPosition;",
            "  float hazeDist = length(hazeTo.xz);",
            "  float grazing = 1.0 - clamp(abs(hazeTo.y) / max(hazeDist, 0.001) * 3.5, 0.0, 1.0);",
            "  float band = smoothstep(hazeNear, hazeNear + 20.0, hazeDist) * (1.0 - smoothstep(hazeFar * 0.75, hazeFar, hazeDist));",
            "  hazeK = heatHaze * band * grazing;",
            "  hazeRipple = sin(vHazeWorld.x * 0.8 + envTime * 2.1 + sin(vHazeWorld.z * 0.6 + envTime * 0.9) * 2.0) * sin(vHazeWorld.z * 1.1 - envTime * 1.7 + vHazeWorld.x * 0.3);",
            "}",
            "#ifdef USE_MAP",
            "  vec2 hazeUv = vUv;",
            "  if (hazeK > 0.0) hazeUv += dFdy(vUv) * hazeRipple * hazeK * 1.4 + dFdx(vUv) * hazeRipple * hazeK * 0.4;",
            "  vec4 texelColor = texture2D( map, hazeUv );\n  texelColor = mapTexelToLinear( texelColor );\n  diffuseColor *= texelColor;",
            "#endif",
          ].join("\n"))
          .replace("#include <fog_fragment>", "gl_FragColor.rgb = mix(gl_FragColor.rgb, hazeColor, hazeK * (0.035 + 0.035 * hazeRipple));\n#include <fog_fragment>");
      };
    }
    for (const m of [roadMaterial, oneWayRoadMaterial, lotMaterial, concreteMaterial, plainAsphaltMaterial]) addHeatHaze(m);
    // How each surface answers the weather (environment-fx.js): asphalt
    // takes a real wet sheen and gathers puddles (along the road edges on
    // streets), concrete less, grass barely; broad color variation on all
    // of them so big surfaces never read as one flat tile.
    envSurface(roadMaterial, { wet: 0.85, puddles: 2, variation: 0.32 });
    envSurface(oneWayRoadMaterial, { wet: 0.85, puddles: 2, variation: 0.32 });
    envSurface(plainAsphaltMaterial, { wet: 0.85, puddles: 1, variation: 0.32 });
    envSurface(lotMaterial, { wet: 0.75, puddles: 1, variation: 0.38 });
    envSurface(concreteMaterial, { wet: 0.35, puddles: 0.45, variation: 0.26 });
    envSurface(dirtMaterial, { wet: 0.12, puddles: 0.8, variation: 0.4 });
    envSurface(trackMaterial, { wet: 0.3, variation: 0.18 });
    envSurface(grassMaterial, { variation: 0.5 }); // (grass only darkens when wet -- no sheen)
    envSurface(turfMaterial, { variation: 0.12 });

    // ------------------------------------------------------------------
    // GROUND GEOMETRY. Every flat layer is one merged mesh per material
    // (a flat plane is too cheap to cull). Overlapping layers are stacked
    // LIFT meters apart so they never z-fight -- a few centimeters, which
    // holds up even far away on software/low-precision GPUs.
    // ------------------------------------------------------------------
    const LIFT = {
      walk: 0.02, plaza: 0.025, curb: 0.03, road: 0.04, intersection: 0.045, driveway: 0.05,
      track: 0.06, dirt: 0.06, laneLine: 0.07, lot: 0.08, field: 0.09, pool: 0.09,
      lotWalk: 0.1, infield: 0.1, grassIsland: 0.11, crosswalk: 0.055,
      indoor: 0.026, // walk-in floor plans' floors: level with Kise's (a plaza), just over the walks under them
      // stadium infield (between the track fill and the lane lines)
      infieldTurf: 0.064, eventArea: 0.066, infieldCover: 0.067,
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
      // ...and skips pixels the street mask has claimed (see STREET LEVEL),
      // so ground drawn flat across a street never covers the sunken road.
      material.stencilWrite = true; // (enables the stencil test; the ops keep the buffer as is)
      material.stencilFunc = THREE.NotEqualStencilFunc;
      material.stencilRef = 1;
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
    // `origin` (a world rect) anchors the tiling at its corner instead, so
    // pieces cut from one rectangle line up.
    function rectGround(r, lift, { stretch = false, uAxis = "x", uTileM = 1, vTileM = 1, origin } = {}) {
      const w = rectToWorld(r);
      const o = origin || w;
      const corners = [
        { x: w.minX, z: w.minZ }, { x: w.maxX, z: w.minZ }, { x: w.maxX, z: w.maxZ }, { x: w.minX, z: w.maxZ },
      ];
      const uvOf = (p) => {
        // v runs south -> north so a canvas drawn north-up lands north-up.
        if (stretch) return [(p.x - w.minX) / (w.maxX - w.minX), (w.maxZ - p.z) / (w.maxZ - w.minZ)];
        return uAxis === "x"
          ? [(p.x - o.minX) / uTileM, (p.z - o.minZ) / vTileM]
          : [(p.z - o.minZ) / uTileM, (p.x - o.minX) / vTileM];
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

    // ------------------------------------------------------------------
    // STREET LEVEL. Every street (ROADS, plus any cul-de-sac -- a full disc
    // among DRIVE_ARCS) is sunk STREET_DROP_M below the ground, with a curb
    // wherever it meets the ground (not where it meets another street or a
    // pit). Walking height ramps up over the last CURB_RAMP_M before a curb.
    // ------------------------------------------------------------------
    const streetRectsPx = ROADS.map((r) => {
      const half = (r[4] || ROAD_WIDTH_PX) / 2;
      return isHorizontal(r)
        ? [Math.min(r[0], r[2]) - half, r[1] - half, Math.max(r[0], r[2]) + half, r[1] + half]
        : [r[0] - half, Math.min(r[1], r[3]) - half, r[0] + half, Math.max(r[1], r[3]) + half];
    });
    const streetRects = streetRectsPx.map(rectToWorld);
    const isCulDeSac = (a) => a[2] - a[3] / 2 <= 0 && a[5] >= 360;
    const CUL_DE_SAC_SEGMENTS = 48; // same as flatArcWorld/flatDiscWorld, so the curb follows the asphalt's edge
    const culDeSacs = DRIVE_ARCS.filter(isCulDeSac).map((a) => ({ ...mapToWorld(a[0], a[1]), r: (a[2] + a[3] / 2) * MAP_SCALE }));

    // Parts of segment a -> b that have street or pit right beside them on
    // the side of the normal (nx, nz), as sorted, merged [t0, t1] ranges.
    function streetCoverAlong(ax, az, bx, bz, nx, nz, skipDisc) {
      const EPS = 0.01;
      const ox = ax + nx * EPS, oz = az + nz * EPS;
      const dx = bx - ax, dz = bz - az;
      const covered = [];
      for (const w of [...streetRects, ...pits]) {
        // Liang-Barsky: the t range of the offset segment inside w
        let t0 = 0, t1 = 1, outside = false;
        for (const [p, q] of [[-dx, ox - w.minX], [dx, w.maxX - ox], [-dz, oz - w.minZ], [dz, w.maxZ - oz]]) {
          if (Math.abs(p) < 1e-9) { if (q < 0) outside = true; continue; }
          if (p < 0) t0 = Math.max(t0, q / p); else t1 = Math.min(t1, q / p);
        }
        if (!outside && t1 > t0) covered.push([t0, t1]);
      }
      for (const c of culDeSacs) {
        if (c === skipDisc) continue;
        const fx = ox - c.x, fz = oz - c.z;
        const A = dx * dx + dz * dz, B = 2 * (fx * dx + fz * dz), C = fx * fx + fz * fz - c.r * c.r;
        const disc = B * B - 4 * A * C;
        if (disc <= 0) continue;
        const s = Math.sqrt(disc);
        const t0 = Math.max(0, (-B - s) / (2 * A)), t1 = Math.min(1, (-B + s) / (2 * A));
        if (t1 > t0) covered.push([t0, t1]);
      }
      covered.sort((p, q) => p[0] - q[0]);
      const merged = [];
      for (const r of covered) {
        const last = merged[merged.length - 1];
        if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
        else merged.push([...r]);
      }
      return merged;
    }
    // The rest of [0, 1] after sorted, merged `ranges`.
    function uncoveredRanges(ranges) {
      const out = [];
      let t = 0;
      for (const [t0, t1] of ranges) {
        if (t0 > t) out.push([t, t0]);
        t = Math.max(t, t1);
      }
      if (t < 1) out.push([t, 1]);
      return out;
    }

    // Curb lines: the stretches of street edge that meet the ground, with
    // (nx, nz) pointing off the street.
    const curbs = [];
    function addCurb(ax, az, bx, bz, nx, nz, skipDisc) {
      const len = Math.hypot(bx - ax, bz - az);
      for (const [t0, t1] of uncoveredRanges(streetCoverAlong(ax, az, bx, bz, nx, nz, skipDisc))) {
        if ((t1 - t0) * len < 0.02) continue;
        curbs.push({ ax: ax + (bx - ax) * t0, az: az + (bz - az) * t0, bx: ax + (bx - ax) * t1, bz: az + (bz - az) * t1, nx, nz });
      }
    }
    for (const w of streetRects) {
      addCurb(w.minX, w.minZ, w.maxX, w.minZ, 0, -1);
      addCurb(w.minX, w.maxZ, w.maxX, w.maxZ, 0, 1);
      addCurb(w.minX, w.minZ, w.minX, w.maxZ, -1, 0);
      addCurb(w.maxX, w.minZ, w.maxX, w.maxZ, 1, 0);
    }
    for (const c of culDeSacs) {
      // same vertices as the disc geometry: angle counterclockwise on the screenshot, z = -sin
      const at = (i) => {
        const a = (i / CUL_DE_SAC_SEGMENTS) * Math.PI * 2;
        return { x: c.x + c.r * Math.cos(a), z: c.z - c.r * Math.sin(a) };
      };
      for (let i = 0; i < CUL_DE_SAC_SEGMENTS; i++) {
        const p = at(i), q = at(i + 1);
        const mid = ((i + 0.5) / CUL_DE_SAC_SEGMENTS) * Math.PI * 2;
        addCurb(p.x, p.z, q.x, q.z, Math.cos(mid), -Math.sin(mid), c);
      }
    }

    // Street shapes and curb lines bucketed on a coarse grid, so a height
    // lookup only looks at what's near the point.
    const STREET_CELL_M = 8;
    const streetCells = new Map();
    const streetCellKey = (x, z) => Math.floor(x / STREET_CELL_M) * 65536 + Math.floor(z / STREET_CELL_M);
    function addToStreetCells(minX, minZ, maxX, maxZ, field, item) {
      for (let i = Math.floor(minX / STREET_CELL_M); i <= Math.floor(maxX / STREET_CELL_M); i++) {
        for (let j = Math.floor(minZ / STREET_CELL_M); j <= Math.floor(maxZ / STREET_CELL_M); j++) {
          const key = i * 65536 + j;
          let cell = streetCells.get(key);
          if (!cell) streetCells.set(key, (cell = { rects: [], discs: [], curbs: [] }));
          cell[field].push(item);
        }
      }
    }
    for (const w of streetRects) addToStreetCells(w.minX, w.minZ, w.maxX, w.maxZ, "rects", w);
    for (const c of culDeSacs) addToStreetCells(c.x - c.r, c.z - c.r, c.x + c.r, c.z + c.r, "discs", c);
    for (const k of curbs) {
      addToStreetCells(Math.min(k.ax, k.bx) - CURB_RAMP_M, Math.min(k.az, k.bz) - CURB_RAMP_M,
        Math.max(k.ax, k.bx) + CURB_RAMP_M, Math.max(k.az, k.bz) + CURB_RAMP_M, "curbs", k);
    }

    // Street surface height at a world point (0 off the streets): the full
    // drop, easing linearly up to 0 at a curb over the last CURB_RAMP_M.
    function streetHeightAt(x, z) {
      const cell = streetCells.get(streetCellKey(x, z));
      if (!cell) return 0;
      let inside = false;
      for (const w of cell.rects) {
        if (x >= w.minX && x <= w.maxX && z >= w.minZ && z <= w.maxZ) { inside = true; break; }
      }
      if (!inside) {
        for (const c of cell.discs) {
          if ((x - c.x) ** 2 + (z - c.z) ** 2 <= c.r * c.r) { inside = true; break; }
        }
      }
      if (!inside) return 0;
      let d = CURB_RAMP_M;
      for (const k of cell.curbs) d = Math.min(d, distToSegment(x, z, k.ax, k.az, k.bx, k.bz));
      return -STREET_DROP_M * (d / CURB_RAMP_M);
    }

    // Ground height at a world point: 0, a street (sunk, ramping up to its
    // curbs), or a step down inside a pit.
    function groundHeightAt(x, z) {
      let h = streetHeightAt(x, z);
      for (const p of pits) {
        for (let k = 0; k < PIT_STEPS; k++) {
          const i = k * PIT_LEDGE_M;
          if (x > p.minX + i && x < p.maxX - i && z > p.minZ + i && z < p.maxZ - i) h = Math.min(h, -(k + 1) * PIT_STEP_M);
        }
      }
      for (const w of sunkenWorld) if (x > w.minX && x < w.maxX && z > w.minZ && z < w.maxZ) h = Math.min(h, -w.depth);
      const ramp = rampHeightAt(x, z);
      if (ramp !== null) h = ramp;
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
    function wallQuad(ax, az, bx, bz, yTop, yBottom, inX, inZ, tileM = DIRT_TILE_M) {
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
      const along = Math.hypot(bx - ax, bz - az) / tileM;
      const down = (yTop - yBottom) / tileM;
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
        for (const [ax, az, bx, bz, inX, inZ] of [
          [x0, z0, x1, z0, 0, 1], [x0, z1, x1, z1, 0, -1], [x0, z0, x0, z1, 1, 0], [x1, z0, x1, z1, -1, 0],
        ]) {
          if (k > 0) {
            pitWallGeometries.push(wallQuad(ax, az, bx, bz, yTop, yBottom, inX, inZ));
            continue;
          }
          // The top wall only rises to street level where a street runs into the pit.
          const onStreet = streetCoverAlong(ax, az, bx, bz, -inX, -inZ);
          for (const [t0, t1, top] of [
            ...onStreet.map(([t0, t1]) => [t0, t1, -STREET_DROP_M]),
            ...uncoveredRanges(onStreet).map(([t0, t1]) => [t0, t1, yTop]),
          ]) {
            pitWallGeometries.push(wallQuad(ax + (bx - ax) * t0, az + (bz - az) * t0, ax + (bx - ax) * t1, az + (bz - az) * t1,
              top, yBottom, inX, inZ));
          }
        }
      }
    });
    if (pitWallGeometries.length > 0) {
      const walls = mergedMesh(pitWallGeometries, new THREE.MeshLambertMaterial({ map: dirtTexture, color: 0xbfa888 }));
      walls.material.depthWrite = true; // real geometry, depth-tested like buildings
      walls.material.stencilWrite = false; // ...and never hidden by the street mask
      walls.renderOrder = 0;
      root.add(walls);
    }

    // Streets, sunk to street level (see STREET LEVEL), with plain-asphalt
    // patches over every intersection so center lines stop at the crossing
    // instead of z-fighting through it.
    const streetLift = (lift) => lift - STREET_DROP_M;
    const roadHalfWidth = (r) => (r[4] || ROAD_WIDTH_PX) / 2;
    // One-way streets: 14th Street South (northbound only), white lane line.
    const ONE_WAY_STREETS = [815];
    const isOneWay = (r) => !isHorizontal(r) && ONE_WAY_STREETS.includes(r[0]);
    const roadStrip = (r) => stripQuad(r[0], r[1], r[2], r[3], roadHalfWidth(r) * 2, streetLift(LIFT.road), ROAD_DASH_PERIOD_M);
    root.add(mergedMesh(ROADS.filter((r) => !isOneWay(r)).map(roadStrip), roadMaterial));
    root.add(mergedMesh(ROADS.filter(isOneWay).map(roadStrip), oneWayRoadMaterial));
    const intersectionPatches = [];
    for (const h of ROADS.filter(isHorizontal)) {
      for (const v of ROADS.filter((r) => !isHorizontal(r))) {
        const x = v[0];
        const y = h[1];
        if (x < Math.min(h[0], h[2]) - roadHalfWidth(v) || x > Math.max(h[0], h[2]) + roadHalfWidth(v)) continue;
        if (y < Math.min(v[1], v[3]) - roadHalfWidth(h) || y > Math.max(v[1], v[3]) + roadHalfWidth(h)) continue;
        intersectionPatches.push(rectGround(
          [x - roadHalfWidth(v), y - roadHalfWidth(h), x + roadHalfWidth(v), y + roadHalfWidth(h)], streetLift(LIFT.intersection)));
      }
    }
    root.add(mergedMesh(intersectionPatches, plainAsphaltMaterial));
    const driveArc = (a, lift) => {
      const c = mapToWorld(a[0], a[1]);
      return flatArcWorld(c.x, c.z, (a[2] - a[3] / 2) * MAP_SCALE, (a[2] + a[3] / 2) * MAP_SCALE,
        (a[4] * Math.PI) / 180, (a[5] * Math.PI) / 180, lift);
    };
    if (culDeSacs.length > 0) {
      root.add(mergedMesh(DRIVE_ARCS.filter(isCulDeSac).map((a) => driveArc(a, streetLift(LIFT.driveway))), plainAsphaltMaterial, 1));
    }
    root.add(mergedMesh([
      ...DRIVEWAYS.map((r) => rectGround(r, LIFT.driveway)),
      ...DRIVE_ARCS.filter((a) => !isCulDeSac(a)).map((a) => driveArc(a, LIFT.driveway)),
    ], plainAsphaltMaterial, 1));

    // The ground's own layers (grass, sidewalks, walks, driveways) still run
    // flat across the streets. The street-level layers paint first; then this
    // mask -- the streets' outline at ground level, never drawn in color --
    // marks the stencil buffer, and every later ground layer skips marked
    // pixels (see mergedMesh), leaving an open hole down to the street.
    const streetMask = mergedMesh([
      ...streetRectsPx.map((r) => rectGround(r, 0)),
      ...culDeSacs.map((c) => flatDiscWorld(c.x, c.z, c.r, 0)),
    ], new THREE.MeshBasicMaterial({ colorWrite: false }));
    streetMask.material.stencilFunc = THREE.AlwaysStencilFunc;
    streetMask.material.stencilZPass = THREE.ReplaceStencilOp;
    streetMask.renderOrder = -1050; // after every street-level layer, before the ground (-1000 and up)
    root.add(streetMask);

    // Curbs: a concrete face from the street up to just above the ground
    // along every curb line (real, depth-tested geometry like the pit walls),
    // and a thin concrete strip along its top on the ground side.
    const curbFaceMaterial = envSurface(new THREE.MeshLambertMaterial({ map: concreteTexture, color: 0xe2dfd8 }), { variation: 0.2 });
    if (curbs.length > 0) {
      const faces = mergedMesh(curbs.map((k) =>
        wallQuad(k.ax, k.az, k.bx, k.bz, LIFT.curb, -STREET_DROP_M, -k.nx, -k.nz, SLAB_LENGTH_M)), curbFaceMaterial);
      faces.material.depthWrite = true;
      faces.material.stencilWrite = false;
      faces.renderOrder = 0;
      root.add(faces);
      root.add(mergedMesh(curbs.map((k) => {
        const len = Math.hypot(k.bx - k.ax, k.bz - k.az) / SLAB_LENGTH_M;
        const ox = k.nx * CURB_TOP_WIDTH_M, oz = k.nz * CURB_TOP_WIDTH_M;
        return groundQuad(
          [{ x: k.ax, z: k.az }, { x: k.bx, z: k.bz }, { x: k.bx + ox, z: k.bz + oz }, { x: k.ax + ox, z: k.az + oz }],
          [[0, 0], [len, 0], [len, 0.15], [0, 0.15]],
          LIFT.curb,
        );
      }), concreteMaterial));
    }

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
    const streetCrosswalkGeometries = [];
    // rect in px; `walkAxis`: the direction people walk ("x" or "z"); bars
    // are spaced along it and run across it. The part out on a street is
    // drawn again down at street level (the ground-level copy is masked there).
    const addCrosswalk = (r, walkAxis) => {
      if (r[2] - r[0] < 0.5 || r[3] - r[1] < 0.5) return;
      const w = rectToWorld(r);
      const across = walkAxis === "x" ? w.maxZ - w.minZ : w.maxX - w.minX;
      const tiling = { uAxis: walkAxis, uTileM: CROSSWALK_BAR_PERIOD_M, vTileM: across, origin: w };
      crosswalkGeometries.push(rectGround(r, LIFT.crosswalk, tiling));
      for (const s of streetRectsPx) {
        const piece = [Math.max(r[0], s[0]), Math.max(r[1], s[1]), Math.min(r[2], s[2]), Math.min(r[3], s[3])];
        if (piece[2] - piece[0] > 0.01 && piece[3] - piece[1] > 0.01) {
          streetCrosswalkGeometries.push(rectGround(piece, streetLift(LIFT.crosswalk), tiling));
        }
      }
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
    // Mid-block crossings of a north-south street (pink marks on
    // screenshot1.png): [street x, center y, width] in px, curb to curb
    // plus the grass strips, lined up with the walk that meets them.
    const MIDBLOCK_CROSSWALKS = [
      [815, 405, 9],  // 14th St, on the central mall
      [1297, 302, 5], // 17th St, at the walk to Nemzek's west door
    ];
    // A plain asphalt patch under each (like the intersections') so the
    // road's dashed center line doesn't show between the bars.
    const midblockPatches = [];
    for (const [ix, iy, width] of MIDBLOCK_CROSSWALKS) {
      const v = ROADS.find((r) => !isHorizontal(r) && r[0] === ix && Math.min(r[1], r[3]) <= iy && Math.max(r[1], r[3]) >= iy);
      const vHalf = roadHalfWidth(v);
      addCrosswalk([ix - vHalf - SIDEWALK_GAP_PX, iy - width / 2, ix + vHalf + SIDEWALK_GAP_PX, iy + width / 2], "x");
      midblockPatches.push(rectGround([ix - vHalf, iy - width / 2 - 0.5, ix + vHalf, iy + width / 2 + 0.5], streetLift(LIFT.intersection)));
    }
    root.add(mergedMesh(midblockPatches, plainAsphaltMaterial));
    if (crosswalkGeometries.length > 0) root.add(mergedMesh(crosswalkGeometries, crosswalkMaterial));
    if (streetCrosswalkGeometries.length > 0) root.add(mergedMesh(streetCrosswalkGeometries, crosswalkMaterial));

    // Nemzek Hall sign face (gamenemzeksign.jpg): black lettering across the
    // top of the cream panel, facing south toward the entrance walk.
    {
      const left = mapToWorld(1313.6, 0).x, right = mapToWorld(1320.4, 0).x;
      const faceZ = mapToWorld(0, 300.75).z + 0.012;
      const panelHeight = 1.9, panelBase = 0.45;
      const signTexture = canvasTexture(1024, Math.round(1024 * panelHeight / (right - left)), (ctx, w, h) => {
        ctx.fillStyle = "#e4e0d6";
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = "#1c2024";
        ctx.font = `${Math.round(h * 0.22)}px "Century Gothic", "Futura", "Trebuchet MS", Arial, sans-serif`;
        ctx.textBaseline = "middle";
        // Wide letter spacing like the real sign, drawn letter by letter.
        const text = "NEMZEK  HALL";
        const spacing = h * 0.05;
        const widths = [...text].map((c) => ctx.measureText(c).width);
        const total = widths.reduce((a, b) => a + b, 0) + spacing * (text.length - 1);
        let x = (w - total) / 2;
        [...text].forEach((c, i) => { ctx.fillText(c, x, h * 0.3); x += widths[i] + spacing; });
      });
      signTexture.wrapS = signTexture.wrapT = THREE.ClampToEdgeWrapping;
      const face = new THREE.Mesh(new THREE.PlaneGeometry(right - left, panelHeight), new THREE.MeshLambertMaterial({ map: signTexture }));
      face.position.set((left + right) / 2, panelBase + panelHeight / 2, faceZ);
      root.add(face);
    }

    // Nemzek Fieldhouse floor: a gray concrete indoor track (outer lane 185 m)
    // with white lane lines, around a maple basketball court.
    {
      const fh = FIELDHOUSE;
      const hall = mapToWorld((FIELDHOUSE_PX[0] + FIELDHOUSE_PX[2]) / 2, (FIELDHOUSE_PX[1] + FIELDHOUSE_PX[3]) / 2);
      const center = { x: hall.x + fh.trackCenterX, z: hall.z + fh.trackCenterZ }; // track + court center
      const h = fh.trackHalfStraightM;
      const R = fh.trackOuterRadiusM;
      const innerR = R - fh.lanes * fh.laneWidthM;
      // Point on a stadium outline of radius r (straights along z), t in [0, 4).
      const outline = (t, r) => {
        const seg = Math.floor(t) % 4, f = t - Math.floor(t);
        if (seg === 0) return { x: center.x + r, z: center.z - h + 2 * h * f };             // east straight, north -> south
        if (seg === 1) { const a = Math.PI * f; return { x: center.x + r * Math.cos(a), z: center.z + h + r * Math.sin(a) }; } // south curve
        if (seg === 2) return { x: center.x - r, z: center.z + h - 2 * h * f };             // west straight
        const a = Math.PI + Math.PI * f;
        return { x: center.x + r * Math.cos(a), z: center.z - h + r * Math.sin(a) };        // north curve
      };
      // Flat ring between radii r0 < r1 (upward-facing triangles).
      const ring = (r0, r1, lift, steps = 24) => {
        const pos = [];
        const tri = (a, b, c) => {
          if ((b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z) < 0) [b, c] = [c, b];
          for (const q of [a, b, c]) pos.push(q.x, lift, q.z);
        };
        const n = steps * 4;
        for (let i = 0; i < n; i++) {
          const t0 = (i / n) * 4, t1 = ((i + 1) / n) * 4;
          const a = outline(t0, r0), b = outline(t1, r0), c = outline(t1, r1), d = outline(t0, r1);
          tri(a, b, c);
          tri(a, c, d);
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
        g.setAttribute("normal", new THREE.Float32BufferAttribute(pos.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
        return g;
      };
      const trackMaterial = new THREE.MeshLambertMaterial({
        map: canvasTexture(128, 128, (ctx, w, hh) => speckle(ctx, w, hh, "#8f8f8b", 1400, 0.07, 31)),
      });
      root.add(mergedMesh([ring(innerR, R, 0.12)], trackMaterial, 3));
      const lineGeometries = [];
      for (let k = 0; k <= fh.lanes; k++) {
        const r = R - k * fh.laneWidthM;
        lineGeometries.push(ring(r - (k === 0 ? 0.06 : 0.025), r + (k === fh.lanes ? 0.06 : 0.025), 0.125));
      }
      root.add(mergedMesh(lineGeometries, new THREE.MeshLambertMaterial({ color: 0xe9e9e4 }), 1));

      // Court (NCAA men's markings), with a 1 m darker apron. Canvas: x across
      // the court (west -> east), y along it (north at the top).
      const apronM = 1;
      const cw = fh.courtWidthM + 2 * apronM, cl = fh.courtLengthM + 2 * apronM;
      const PPM = 40; // canvas pixels per meter
      const courtTexture = canvasTexture(Math.round(cw * PPM), Math.round(cl * PPM), (ctx, w, hh) => {
        const m = (v) => v * PPM;
        ctx.fillStyle = "#8a5a31";
        ctx.fillRect(0, 0, w, hh);
        const x0 = m(apronM), y0 = m(apronM), W = m(fh.courtWidthM), L = m(fh.courtLengthM);
        ctx.fillStyle = "#c99a5e";
        ctx.fillRect(x0, y0, W, L);
        // maple boards along the court
        const rand = seededRandom(77);
        for (let bx = x0; bx < x0 + W; bx += m(0.06)) {
          ctx.fillStyle = `rgba(${rand() < 0.5 ? "90,55,20" : "255,235,200"},${0.04 + rand() * 0.06})`;
          ctx.fillRect(bx, y0, m(0.06), L);
        }
        const cx = x0 + W / 2, cy = y0 + L / 2;
        ctx.fillStyle = "rgba(166,25,46,0.85)"; // MSUM red paint in the lanes and center circle
        const laneW = m(3.66), ftDist = m(5.79);
        ctx.fillRect(cx - laneW / 2, y0, laneW, ftDist);
        ctx.fillRect(cx - laneW / 2, y0 + L - ftDist, laneW, ftDist);
        ctx.beginPath(); ctx.arc(cx, cy, m(1.83), 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = "#f6f4ee";
        ctx.lineWidth = m(0.05);
        ctx.strokeRect(x0, y0, W, L);
        ctx.beginPath(); ctx.moveTo(x0, cy); ctx.lineTo(x0 + W, cy); ctx.stroke();
        ctx.beginPath(); ctx.arc(cx, cy, m(1.83), 0, Math.PI * 2); ctx.stroke();
        for (const end of [1, -1]) {
          const base = end > 0 ? y0 : y0 + L;             // baseline
          const hoop = base + end * m(1.575);              // basket center
          // lane + free-throw circle
          ctx.strokeRect(cx - laneW / 2, Math.min(base, base + end * ftDist), laneW, ftDist);
          ctx.beginPath(); ctx.arc(cx, base + end * ftDist, m(1.83), 0, Math.PI * 2); ctx.stroke();
          // three-point line: 6.75 m arc, straight 1.02 m in from each sideline
          const r3 = m(6.75), side = m(6.6);
          const reach = Math.sqrt(r3 * r3 - side * side);
          ctx.beginPath();
          ctx.moveTo(cx - side, base); ctx.lineTo(cx - side, hoop + end * reach);
          const a0 = Math.atan2(end * reach, -side), a1 = Math.atan2(end * reach, side);
          ctx.arc(cx, hoop, r3, a0, a1, end < 0);
          ctx.lineTo(cx + side, base);
          ctx.stroke();
        }
      });
      const halfW = cw / 2 / MAP_SCALE, halfL = cl / 2 / MAP_SCALE;
      const cpx = (FIELDHOUSE_PX[0] + FIELDHOUSE_PX[2]) / 2 + fh.trackCenterX / MAP_SCALE;
      const cpy = (FIELDHOUSE_PX[1] + FIELDHOUSE_PX[3]) / 2 + fh.trackCenterZ / MAP_SCALE;
      root.add(mergedMesh([rectGround([cpx - halfW, cpy - halfL, cpx + halfW, cpy + halfL], 0.13, { stretch: true })],
        new THREE.MeshLambertMaterial({ map: courtTexture })));
    }

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
    // Floors inside the walk-in floor plans (the ground-level ones). Unlike
    // the outdoor ground layers these write depth: next to a sunken floor
    // (Comstock) things run on down below them -- the ramp's sides and
    // rails, people on its lower end, stair bases -- and a floor that
    // didn't write depth let all of that show through it like x-ray. They're
    // still painted in the ground's order (every layer drawn after them is
    // higher, so passes the depth test), and they overlap no other layer, so
    // there's nothing for them to flicker against.
    const indoorFloors = mergedMesh([
      ...FLOOR_PLAN_GROUND_FLOORS_PX.map((r) => rectGround(r, LIFT.indoor)),
      ...FLOOR_PLAN_QUADS_PX.map((q) => groundQuad(q.map(([x, y]) => mapToWorld(x, y)), q.map(() => [0, 0]), LIFT.indoor)),
    ], indoorFloorMaterial, SLAB_LENGTH_M);
    indoorFloors.material.depthWrite = true;
    root.add(indoorFloors);
    // Sunken floors (FLOOR_PLAN_SUNKEN) and their edges: concrete faces from
    // the ground down all round them.
    if (FLOOR_PLAN_SUNKEN.length > 0) {
      const sunkFloors = mergedMesh(FLOOR_PLAN_SUNKEN.map((s) => rectGround(s.rect, -s.depth + 0.004)), indoorFloorMaterial.clone(), SLAB_LENGTH_M);
      // Real geometry, depth-tested like the buildings: drawn over the ground
      // layers, but hidden behind a sunken area's near edge (see `edges`).
      sunkFloors.material.depthWrite = true;
      sunkFloors.material.stencilWrite = false;
      sunkFloors.renderOrder = 0;
      root.add(sunkFloors);
      const edgeGeometries = [];
      const inOther = (x, z, self) => sunkenWorld.some((o) => o !== self && x > o.minX && x < o.maxX && z > o.minZ && z < o.maxZ);
      for (const w of sunkenWorld) {
        for (const [ax, az, bx, bz, inX, inZ] of [
          [w.minX, w.minZ, w.maxX, w.minZ, 0, 1], [w.minX, w.maxZ, w.maxX, w.maxZ, 0, -1],
          [w.minX, w.minZ, w.minX, w.maxZ, 1, 0], [w.maxX, w.minZ, w.maxX, w.maxZ, -1, 0],
        ]) {
          // the stretches of this edge that don't open onto another sunken rect
          const len = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.ceil(len / 0.1));
          let start = null;
          for (let i = 0; i <= n; i++) {
            const t = (i + 0.5) / n;
            const open = i < n && !inOther(ax + (bx - ax) * t - inX * 0.05, az + (bz - az) * t - inZ * 0.05, w);
            if (open && start === null) start = i / n;
            if (!open && start !== null) {
              const t0 = start, t1 = i / n;
              edgeGeometries.push(wallQuad(ax + (bx - ax) * t0, az + (bz - az) * t0, ax + (bx - ax) * t1, az + (bz - az) * t1,
                0, -w.depth, inX, inZ, SLAB_LENGTH_M));
              start = null;
            }
          }
        }
      }
      // Both sides drawn: seen from outside, the near edge hides the floor and
      // steps below the ground behind it.
      // Ramps: one sloped surface each, and its sides down to the floor below.
      const rampSurfaces = [];
      const tri = (pts) => {
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.Float32BufferAttribute(pts.flat(), 3));
        g.computeVertexNormals();
        g.setAttribute("uv", new THREE.Float32BufferAttribute(pts.flatMap((q) => [q[0] / SLAB_LENGTH_M, q[2] / SLAB_LENGTH_M]), 2));
        return g;
      };
      for (const r of FLOOR_PLAN_RAMPS) {
        const nx = -r.uz * r.half, nz = r.ux * r.half, lift = 0.006;
        const p = (x, z, y) => [x, y + lift, z];
        const A1 = p(r.a.x - nx, r.a.z - nz, r.ha), A2 = p(r.a.x + nx, r.a.z + nz, r.ha);
        const B1 = p(r.b.x - nx, r.b.z - nz, r.hb), B2 = p(r.b.x + nx, r.b.z + nz, r.hb);
        const low = Math.min(r.ha, r.hb);
        // wound to face up
        rampSurfaces.push(tri([A1, B2, B1]), tri([A1, A2, B2]));
        for (const [P, Q] of [[A1, B1], [A2, B2]]) {
          const Pl = [P[0], low, P[2]], Ql = [Q[0], low, Q[2]];
          edgeGeometries.push(tri([P, Q, Ql]), tri([P, Ql, Pl]));
        }
      }
      if (rampSurfaces.length > 0) {
        const up = rampSurfaces.map((g) => {
          // make sure each triangle faces up (flip if its normal points down)
          const n = g.attributes.normal.array;
          if (n[1] < 0) {
            const a = g.attributes.position.array;
            for (let k = 0; k < 3; k++) { const t = a[3 + k]; a[3 + k] = a[6 + k]; a[6 + k] = t; }
            g.computeVertexNormals();
          }
          return g;
        });
        const ramps = mergedMesh(up, indoorFloorMaterial.clone());
        ramps.material.depthWrite = true;
        ramps.material.stencilWrite = false;
        ramps.renderOrder = 0;
        root.add(ramps);
      }
      const edges = mergedMesh(edgeGeometries, new THREE.MeshLambertMaterial({ map: concreteTexture, color: 0xd8d4cc, side: THREE.DoubleSide }));
      edges.material.depthWrite = true;
      edges.material.stencilWrite = false;
      edges.renderOrder = 0;
      root.add(edges);
    }
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
    // Infield: turf over the track fill inside the lanes; the event area,
    // then turf again over the rest so the event area stays north of its line.
    const infieldGeometries = [];
    const eventAreaGeometries = [];
    const infieldCoverGeometries = [];
    for (const r of TRACKS) {
      const extra = r[4] || {};
      const cap = capsuleOf(r);
      const radiusPx = (r[2] - r[0]) / 2;
      const lanesPx = (TRACK_LANES * TRACK_LANE_WIDTH_M) / MAP_SCALE;
      const innerR = cap.radius - TRACK_LANES * TRACK_LANE_WIDTH_M;
      const innerRPx = radiusPx - lanesPx;
      infieldGeometries.push(
        rectGround([r[0] + lanesPx, r[1] + radiusPx, r[2] - lanesPx, r[3] - radiusPx], LIFT.infieldTurf),
        flatDiscWorld(cap.cx, cap.zTop, innerR, LIFT.infieldTurf),
        flatDiscWorld(cap.cx, cap.zBottom, innerR, LIFT.infieldTurf),
      );
      if (extra.northEventAreaToY !== undefined) {
        eventAreaGeometries.push(flatDiscWorld(cap.cx, cap.zTop, innerR, LIFT.eventArea));
        infieldCoverGeometries.push(rectGround(
          [r[0] + lanesPx, extra.northEventAreaToY, r[2] - lanesPx, r[1] + radiusPx + innerRPx], LIFT.infieldCover));
      }
      if (extra.westChuteTopY !== undefined) {
        // The chute: the west straight's lanes squared off north of the curve.
        trackGeometries.push(rectGround([r[0], extra.westChuteTopY, r[0] + lanesPx, r[1] + radiusPx], LIFT.track));
        const chuteTop = mapToWorld(0, extra.westChuteTopY).z;
        const half = LANE_LINE_WIDTH_M / 2;
        for (let lane = 0; lane <= TRACK_LANES; lane++) {
          const lineX = cap.cx - (cap.radius - lane * TRACK_LANE_WIDTH_M);
          laneLineGeometries.push(groundQuad(
            [{ x: lineX - half, z: chuteTop }, { x: lineX + half, z: chuteTop },
              { x: lineX + half, z: cap.zTop }, { x: lineX - half, z: cap.zTop }],
            [[0, 0], [1, 0], [1, 1], [0, 1]], LIFT.laneLine));
        }
        // square end line across the chute's top
        laneLineGeometries.push(rectGround([r[0], extra.westChuteTopY, r[0] + lanesPx, extra.westChuteTopY + LANE_LINE_WIDTH_M / MAP_SCALE], LIFT.laneLine));
      }
    }
    for (const r of RUNWAYS) trackGeometries.push(rectGround(r, LIFT.track));
    root.add(mergedMesh(trackGeometries, trackMaterial, TRACK_TILE_M));
    const infieldTurfMaterial = new THREE.MeshLambertMaterial({
      map: canvasTexture(128, 128, (ctx, w, h) => speckle(ctx, w, h, "#3f7d3a", 1600, 0.08, 41)),
    });
    root.add(mergedMesh(infieldGeometries, infieldTurfMaterial, 3));
    if (eventAreaGeometries.length) {
      root.add(mergedMesh(eventAreaGeometries, new THREE.MeshLambertMaterial({
        map: canvasTexture(128, 128, (ctx, w, h) => speckle(ctx, w, h, "#7e2f28", 1600, 0.1, 43)),
      }), TRACK_TILE_M));
      root.add(mergedMesh(infieldCoverGeometries, infieldTurfMaterial, 3));
    }
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


    const buildingMaterial = envSurface(new THREE.MeshLambertMaterial({ color: 0xffffff }), { variation: 0.14, wetDarken: 0.1 });
    // Storefront glass (Kise): blue-green tinted with a strong specular sheen,
    // and a Fresnel edge so it reads as glass. Head-on it stays see-through;
    // at a glancing angle it turns more opaque and brighter, the way real
    // glass turns reflective, so a pane stays visible even when nothing
    // behind it gives it away. Light-independent: it follows the scene's
    // lighting, so it doesn't glow at night.
    const glassMaterial = new THREE.MeshPhongMaterial({ color: 0xffffff, specular: 0x8899aa, shininess: 120, transparent: true, opacity: 0.44, depthWrite: false });
    glassMaterial.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        "gl_FragColor = vec4( outgoingLight, diffuseColor.a );",
        `float glassFresnel = pow(1.0 - abs(dot(normal, normalize(vViewPosition))), 3.0);
        gl_FragColor = vec4(outgoingLight * (1.0 + 0.35 * glassFresnel), mix(diffuseColor.a, 0.9, glassFresnel));`,
      );
    };

    // Ramp rails (FLOOR_PLAN_RAMPS): a glass pane and a steel cap down each
    // side, sloped with the ramp in one smooth piece (their colliders, built
    // with the floor plans, step with it and aren't drawn).
    if (FLOOR_PLAN_RAMPS.length > 0) {
      const panes = [], caps = [];
      // A box skewed along a -> b, t either side: bottom and top heights at each end.
      const slopedBox = (out, a, b, nx, nz, t, yA0, yB0, yA1, yB1) => {
        const c = (p, side, y) => [p.x + nx * side * t, y, p.z + nz * side * t];
        const v = [c(a, -1, yA0), c(b, -1, yB0), c(b, 1, yB0), c(a, 1, yA0), c(a, -1, yA1), c(b, -1, yB1), c(b, 1, yB1), c(a, 1, yA1)];
        for (const [i, j, k, l] of [[0, 1, 2, 3], [7, 6, 5, 4], [0, 4, 5, 1], [1, 5, 6, 2], [2, 6, 7, 3], [3, 7, 4, 0]]) {
          out.push(...v[i], ...v[j], ...v[k], ...v[i], ...v[k], ...v[l]);
        }
      };
      for (const r of FLOOR_PLAN_RAMPS) {
        const nx = -r.uz, nz = r.ux;
        for (const side of [-1, 1]) {
          const ox = nx * side * r.half, oz = nz * side * r.half;
          const a = { x: r.a.x + ox, z: r.a.z + oz }, b = { x: r.b.x + ox, z: r.b.z + oz };
          const topA = Math.max(r.ha, r.floor) + FP_RAIL_HEIGHT_M, topB = Math.max(r.hb, r.floor) + FP_RAIL_HEIGHT_M;
          // (standing on the ramp's edge -- never reaching below it, where
          // the pane would poke down under the floor the ramp starts on)
          slopedBox(panes, a, b, nx, nz, 0.03, Math.max(r.ha, r.floor), Math.max(r.hb, r.floor), topA, topB);
          slopedBox(caps, a, b, nx, nz, 0.05, topA, topB, topA + 0.06, topB + 0.06);
        }
      }
      const railMesh = (positions, material) => {
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
        g.computeVertexNormals();
        const mesh = new THREE.Mesh(g, material);
        root.add(mesh);
        return mesh;
      };
      const paneMaterial = glassMaterial.clone();
      paneMaterial.color.set(0x9fc6d6); // the tint the instanced glass gets per instance
      paneMaterial.side = THREE.DoubleSide;
      paneMaterial.onBeforeCompile = glassMaterial.onBeforeCompile;
      railMesh(panes, paneMaterial).renderOrder = 1;
      railMesh(caps, new THREE.MeshLambertMaterial({ color: FP_COLORS.railCap, side: THREE.DoubleSide }));
    }

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
    const brickMaterial = envSurface(new THREE.MeshLambertMaterial({ color: 0xffffff }), { variation: 0.22, wetDarken: 0.26 });
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
          // Ambient occlusion where the wall meets the ground (cheap: a
          // function of height, no extra pass), and faint weathering --
          // soft vertical streaks and a dirtier splash zone at the foot.
          "  float brickAO = mix(" + (1 - (ENV.AO_INTENSITY ?? 0.3)).toFixed(3) + ", 1.0, smoothstep(-0.05, " + (ENV.AO_RADIUS ?? 1.3).toFixed(2) + ", vBrickPos.y));",
          "  float brickCol = floor(brickUv.x * 1.7);",
          "  float brickStreak = fract(sin(brickCol * 12.9898 + 4.1) * 43758.5453);",
          "  float brickGrime = 1.0 - 0.07 * smoothstep(0.55, 1.0, brickStreak) - 0.05 * (1.0 - smoothstep(0.0, 0.45, vBrickPos.y));",
          "  diffuseColor.rgb *= brickAO * brickGrime;",
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
    const roofMaterial = envSurface(new THREE.MeshLambertMaterial({ color: 0xffffff }), { variation: 0.3, wetDarken: 0.22 });
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
      for (const b of [...BUILDINGS, ...HOLLOW_BUILDINGS, ...FLOOR_PLAN_FLOORS_PX]) {
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
          c.climbable = true; // see canClimbAlong / the nav grid's step heights
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
        let maxCrownR;
        for (const hb of [...HOLLOW_BUILDINGS, ...FLOOR_PLAN_FLOORS_PX]) {
          const w = rectToWorld(hb);
          const d = Math.hypot(Math.max(w.minX - pos.x, 0, pos.x - w.maxX), Math.max(w.minZ - pos.z, 0, pos.z - w.maxZ));
          if (d < 1.4) return;
          canopyRadius = Math.min(canopyRadius, d - 0.3);
          if (d - 0.3 < 8) maxCrownR = Math.min(maxCrownR === undefined ? Infinity : maxCrownR, d - 0.3);
        }
        const canopyHeight = evergreen ? 6 + rand() * 4 : canopyRadius * (0.8 + rand() * 0.2);
        const shade = 0.75 + rand() * 0.35;
        trees.push({ x: pos.x, z: pos.z, evergreen, trunkHeight, canopyRadius, canopyHeight, shade, maxCrownR });
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
    // Trees (visual only -- their colliders are the zones' own, above):
    // tree-models.js when loaded, else the old simple instanced shapes.
    const treeSystem = window.createTreeSystem
      ? window.createTreeSystem(THREE, root, environment, { drawDistance: TREE_DRAW_DISTANCE })
      : null;
    const allTrees = [];
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
      const isBrick = (c) => c.style === "brick" && c.color === undefined && !c.glass;
      for (const [shapeGeometry, material, members] of [
        [unitBox, brickMaterial, drawn.filter((c) => c.shape !== "cylinder" && isBrick(c))],
        [unitCylinder, brickMaterial, drawn.filter((c) => c.shape === "cylinder" && isBrick(c))],
        [unitBox, buildingMaterial, drawn.filter((c) => c.shape !== "cylinder" && !isBrick(c) && !c.glass)],
        [unitCylinder, buildingMaterial, drawn.filter((c) => c.shape === "cylinder" && !isBrick(c))],
        [unitBox, glassMaterial, drawn.filter((c) => c.glass)],
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
          mesh.setColorAt(i, color.set(c.glass ? 0x9fc6d6 : isBrick(c) ? 0xffffff : c.color !== undefined ? c.color : BUILDING_COLOR));
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
      if (treeSystem) {
        allTrees.push(...trees); // drawn by tree-models.js, chunked across zones
      } else if (trees.length > 0) {
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
    if (treeSystem) treeSystem.addTrees(allTrees);

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
          unitMatrix.compose(new THREE.Vector3(cx, groundHeightAt(cx, cz), cz), q, new THREE.Vector3(1, 1, 1));
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
          const ex = center.x + along.x * t, ez = center.z + along.z * t;
          unitMatrix.compose(new THREE.Vector3(ex, groundHeightAt(ex, ez), ez), q, new THREE.Vector3(1, 1, 1));
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
    // STOP SIGNS (explicit request). Standard US R1-1 signs: a 30 in
    // (0.76 m) red octagon with a white border and white STOP, flat-topped,
    // on a galvanized square steel post with its bottom edge 7 ft (2.1 m)
    // up, standing on the grass strip at the right of the approaching lane,
    // just before the crosswalk / stop line, facing the drivers.
    //   - all-way stops at the three intersections circled in blue on
    //     newborders.png: 17th St & 6th Ave, 11th St & 9th Ave, 17th St &
    //     9th Ave (a sign for every approach);
    //   - where 5th, 6th and 9th Ave S cross 14th St: only the avenues
    //     stop (14th St is one-way northbound and has no stop there);
    //   - 14th St's mid-block crosswalk on the central mall: a sign on each
    //     side of the street for the northbound traffic.
    // One instanced draw for all of them; each post has a thin collider.
    // ------------------------------------------------------------------
    {
      // [intersection px x, y, approaches ("n" = traffic coming from the north, ...)]
      const STOP_INTERSECTIONS = [
        [1297, 175, ["n", "s", "e", "w"]], // 17th St & 6th Ave S
        [232, 680, ["n", "s", "e", "w"]],  // 11th St & 9th Ave S
        [1297, 680, ["n", "s", "e", "w"]], // 17th St & 9th Ave S
        [815, 8, ["e", "w"]],              // 5th Ave S crossing 14th St
        [815, 175, ["e", "w"]],            // 6th Ave S crossing 14th St
        [815, 680, ["e", "w"]],            // 9th Ave S crossing 14th St
      ];
      const SIGN_APOTHEM_M = 0.381;                         // 30 in across the flats
      const SIGN_R_M = SIGN_APOTHEM_M / Math.cos(Math.PI / 8); // to the corners
      const SIGN_CENTER_M = 2.13 + SIGN_APOTHEM_M;          // bottom edge at 7 ft
      const POST_M = 0.051;                                 // 2 in square post
      const POST_TOP_M = SIGN_CENTER_M + SIGN_APOTHEM_M + 0.05;
      const LATERAL_M = 0.55;  // from the curb, out onto the grass strip
      const STOPLINE_M = 0.9;  // before the far edge of the crosswalk band
      const roadAt = (x, y, horizontal) => ROADS.find((r) => isHorizontal(r) === horizontal &&
        (horizontal ? Math.abs(r[1] - y) < 0.5 && Math.min(r[0], r[2]) <= x && Math.max(r[0], r[2]) >= x
          : Math.abs(r[0] - x) < 0.5 && Math.min(r[1], r[3]) <= y && Math.max(r[1], r[3]) >= y));
      const DIRS = { n: { x: 0, z: 1 }, s: { x: 0, z: -1 }, e: { x: -1, z: 0 }, w: { x: 1, z: 0 } }; // travel direction per approach
      const signs = []; // { x, z, yaw }
      const place = (cx, cz, d, along, lateral) => {
        const right = { x: -d.z, z: d.x };
        signs.push({
          x: cx - d.x * along + right.x * lateral,
          z: cz - d.z * along + right.z * lateral,
          yaw: Math.atan2(-d.x, -d.z), // front (+z) toward the oncoming drivers
        });
      };
      for (const [px, py, approaches] of STOP_INTERSECTIONS) {
        const c = mapToWorld(px, py);
        const h = roadAt(px, py, true), v = roadAt(px, py, false);
        if (!h || !v) continue;
        for (const a of approaches) {
          const d = DIRS[a];
          const cross = d.x === 0 ? h : v;     // the street being crossed
          const own = d.x === 0 ? v : h;       // the approaching street
          const along = (roadHalfWidth(cross) + SIDEWALK_GAP_PX + SIDEWALK_WIDTH_PX) * MAP_SCALE + STOPLINE_M;
          place(c.x, c.z, d, along, roadHalfWidth(own) * MAP_SCALE + LATERAL_M);
        }
      }
      // 14th St's mall crosswalk ([815, 405], 9 px wide): northbound traffic
      // stops south of it, with a sign on each side of the street.
      {
        const c = mapToWorld(815, 405);
        const own = roadAt(815, 405, false);
        const d = { x: 0, z: -1 }; // northbound
        const along = 4.5 * MAP_SCALE + STOPLINE_M;
        const lateral = roadHalfWidth(own) * MAP_SCALE + LATERAL_M;
        place(c.x, c.z, d, along, lateral);  // right side
        place(c.x, c.z, d, along, -lateral); // left side
      }

      // The sign face: a canvas texture of the whole octagon (white border,
      // red field, condensed white STOP), mapped onto an octagon.
      const faceTexture = canvasTexture(512, 512, (ctx, w) => {
        const octagon = (r) => {
          ctx.beginPath();
          for (let k = 0; k < 8; k++) {
            const a = Math.PI / 8 + (k * Math.PI) / 4;
            const x = w / 2 + r * Math.cos(a), y = w / 2 - r * Math.sin(a);
            if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
          }
          ctx.closePath();
        };
        ctx.fillStyle = "#f4f4f2";
        octagon(w / 2);
        ctx.fill();
        ctx.fillStyle = "#b8141c";
        octagon(w / 2 * 0.93);
        ctx.fill();
        // a faint sheen gradient so the flat red isn't dead
        const grad = ctx.createLinearGradient(0, 0, w, w);
        grad.addColorStop(0, "rgba(255,255,255,0.07)");
        grad.addColorStop(1, "rgba(0,0,0,0.08)");
        ctx.fillStyle = grad;
        octagon(w / 2 * 0.93);
        ctx.fill();
        ctx.save();
        ctx.translate(w / 2, w / 2 + 6);
        ctx.scale(0.8, 1); // Highway Gothic is narrow
        ctx.fillStyle = "#f7f7f5";
        ctx.font = "bold 176px Arial, Helvetica, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("STOP", 0, 0);
        ctx.restore();
        // Solid swatches in the corners (outside the octagon) for the rest
        // of the sign's parts, so the whole sign is one geometry / one draw.
        ctx.fillStyle = "#a7acb0"; ctx.fillRect(0, 0, 64, 64);            // aluminum (back, rim)
        ctx.fillStyle = "#8e9499"; ctx.fillRect(w - 64, 0, 64, 64);       // galvanized post
        ctx.fillStyle = "#c9ccce"; ctx.fillRect(0, w - 64, 64, 64);       // bolts
      });
      faceTexture.anisotropy = maxAnisotropy;
      // One sign in its own space (front toward +z, post at the origin):
      // face, back, rim, post and two bolts merged into one geometry, the
      // non-face parts mapped onto the texture's solid corner swatches.
      const signOffset = POST_M / 2 + 0.006; // the sign is bolted to the post's front
      const swatch = { aluminum: [32 / 512, 1 - 32 / 512], post: [1 - 32 / 512, 1 - 32 / 512], bolt: [32 / 512, 32 / 512] };
      const partsGeo = [];
      const addPart = (g, dx, dy, dz, uv) => {
        g.translate(dx, dy, dz);
        const ng = g.index ? g.toNonIndexed() : g;
        if (uv) { const a = ng.attributes.uv.array; for (let i = 0; i < a.length; i += 2) { a[i] = uv[0]; a[i + 1] = uv[1]; } }
        partsGeo.push(ng);
      };
      addPart(new THREE.CircleGeometry(SIGN_R_M, 8, Math.PI / 8), 0, SIGN_CENTER_M, signOffset + 0.004);
      addPart(new THREE.CircleGeometry(SIGN_R_M, 8, Math.PI / 8).rotateY(Math.PI), 0, SIGN_CENTER_M, signOffset - 0.004, swatch.aluminum);
      addPart(new THREE.CylinderGeometry(SIGN_R_M, SIGN_R_M, 0.008, 8, 1, true, Math.PI / 8).rotateX(Math.PI / 2), 0, SIGN_CENTER_M, signOffset, swatch.aluminum);
      addPart(new THREE.BoxGeometry(POST_M, POST_TOP_M, POST_M), 0, POST_TOP_M / 2, 0, swatch.post);
      for (const dy of [0.3, -0.3]) addPart(new THREE.CylinderGeometry(0.012, 0.012, 0.012, 6).rotateX(Math.PI / 2), 0, SIGN_CENTER_M + dy, signOffset + 0.01, swatch.bolt);
      const signGeometry = new THREE.BufferGeometry();
      for (const name of ["position", "normal", "uv"]) {
        const size = name === "uv" ? 2 : 3;
        const arrays = partsGeo.map((g) => g.attributes[name].array);
        const out = new Float32Array(arrays.reduce((n, a) => n + a.length, 0));
        let o = 0;
        for (const a of arrays) { out.set(a, o); o += a.length; }
        signGeometry.setAttribute(name, new THREE.BufferAttribute(out, size));
      }
      const signMaterial = new THREE.MeshLambertMaterial({ map: faceTexture });
      const signMatrices = [];
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const yAxis = new THREE.Vector3(0, 1, 0);
      const one = new THREE.Vector3(1, 1, 1);
      for (const sgn of signs) {
        q.setFromAxisAngle(yAxis, sgn.yaw);
        signMatrices.push(m.compose(new THREE.Vector3(sgn.x, groundHeightAt(sgn.x, sgn.z), sgn.z), q, one).clone());
        const collider = makeCollider(sgn.x, sgn.z, POST_M, POST_M, POST_TOP_M, 0);
        collider.render = false;
        collider.seeThrough = true;
        const spx = sgn.x / MAP_SCALE + MAP_CENTER_X, spy = sgn.z / MAP_SCALE + MAP_CENTER_Y;
        zones[ZONES.indexOf(zoneAt(spx, spy))].colliders.push(collider);
      }
      if (signMatrices.length > 0) {
        const mesh = new THREE.InstancedMesh(signGeometry, signMaterial, signMatrices.length);
        signMatrices.forEach((mat, i) => mesh.setMatrixAt(i, mat));
        mesh.instanceMatrix.needsUpdate = true;
        mesh.frustumCulled = false; // a few dozen small signs across the map: one draw
        mesh.name = "StopSigns";
        root.add(mesh);
      }
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
    // ground (0, or a construction-pit step), a stair's ramp, or a
    // roof/step top. On a stair's ramp (stairRampAt) the ramp is the
    // surface: step tops are skipped, so neither that stair nor a flight
    // beside it pops you up a step.
    function supportHeightAt(x, z, radius, fromY) {
      let support = groundHeightAt(x, z);
      const stair = stairRampAt(x, z, fromY);
      if (stair) support = Math.max(support, stair.h);
      forEachColliderIn(x - radius, z - radius, x + radius, z + radius, (c) => {
        if (stair && c.stairRamp) return;
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
    // Climbable pieces (bleacher steps) don't block on their own -- only
    // where the line would have to climb more than a step at once (see
    // canClimbAlong), e.g. straight up the back of a grandstand.
    //
    // y1 / y2 (optional): the two ends' standing heights. When either end is
    // up off the ground floor, the check is floor-aware instead (see
    // segmentBlocked3D): slabs, ceilings and upper-floor walls count only
    // where the sight line actually passes through them. Ground to ground
    // it's exactly the plain check.
    function segmentBlocked(x1, z1, x2, z2, clearance = 0, includeFences = false, y1, y2) {
      if (y1 !== undefined && y2 !== undefined && (Math.max(y1, y2) > NAV_LEVEL_MARGIN_M + 0.5 || Math.abs(y1 - y2) > NAV_LEVEL_MARGIN_M)) {
        return segmentBlocked3D(x1, z1, y1 + SIGHT_EYE_M, x2, z2, y2 + SIGHT_EYE_M, clearance, includeFences);
      }
      const pad = clearance + 0.01;
      const climbables = [];
      const blocked = forEachColliderIn(Math.min(x1, x2) - pad, Math.min(z1, z2) - pad, Math.max(x1, x2) + pad, Math.max(z1, z2) + pad, (c) => {
        if (c.climbable) {
          climbables.push(c);
          return false;
        }
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
      if (blocked) return true;
      return climbables.length > 0 && !canClimbAlong(x1, z1, x2, z2, climbables);
    }

    // The same analytic sweep, in 3D: a collider blocks only if the sight
    // line (a-eye to b-eye) is within its height span where it crosses the
    // collider's footprint. Glass, fences, trees and non-colliding details
    // don't; stair steps do (they're solid).
    const SIGHT_EYE_M = 1.4;
    function segmentBlocked3D(x1, z1, ya, x2, z2, yb, clearance, includeFences) {
      const pad = clearance + 0.01;
      return forEachColliderIn(Math.min(x1, x2) - pad, Math.min(z1, z2) - pad, Math.max(x1, x2) + pad, Math.max(z1, z2) + pad, (c) => {
        if (c.isTree || (c.seeThrough && !includeFences)) return false;
        const a = toLocal(c, x1, z1);
        const b = toLocal(c, x2, z2);
        const hx = (c.shape === "cylinder" ? c.radius : c.halfX) + clearance, hz = (c.shape === "cylinder" ? c.radius : c.halfZ) + clearance;
        let t0 = 0, t1 = 1;
        const ddx = b.x - a.x, ddz = b.z - a.z;
        const clip = (p, q) => {
          if (Math.abs(p) < 1e-12) return q >= 0;
          const r = q / p;
          if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; } else { if (r < t0) return false; if (r < t1) t1 = r; }
          return true;
        };
        if (!(clip(-ddx, a.x + hx) && clip(ddx, hx - a.x) && clip(-ddz, a.z + hz) && clip(ddz, hz - a.z) && t0 <= t1)) return false;
        const yA = ya + (yb - ya) * t0, yB = ya + (yb - ya) * t1;
        return Math.max(yA, yB) >= (c.base || 0) && Math.min(yA, yB) <= c.height;
      });
    }

    // Top of the climbable stack at a point (the ground if none of `list`
    // covers it). No bucket query, so it's safe inside forEachColliderIn.
    function climbTopAt(x, z, list) {
      let h = groundHeightAt(x, z);
      for (const c of list) {
        if (c.height <= h) continue;
        const local = toLocal(c, x, z);
        if (Math.abs(local.x) <= c.halfX && Math.abs(local.z) <= c.halfZ) h = c.height;
      }
      return h;
    }

    // Can a body walk the straight line (x1, z1) -> (x2, z2) over the
    // climbable pieces in `list`? Never climbing more than STEP_UP_M between
    // samples closer together than any step is deep; dropping is fine.
    const CLIMB_SAMPLE_M = 0.25;
    function canClimbAlong(x1, z1, x2, z2, list) {
      const steps = Math.max(1, Math.ceil(Math.hypot(x2 - x1, z2 - z1) / CLIMB_SAMPLE_M));
      let h = climbTopAt(x1, z1, list);
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        const next = climbTopAt(x1 + (x2 - x1) * t, z1 + (z2 - z1) * t, list);
        if (next - h > STEP_UP_M + 0.01) return false;
        h = next;
      }
      return true;
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

    // ------------------------------------------------------------------
    // DECALS (realism pass): surface wear scattered deterministically over
    // the streets (cracks, sealed cracks, patches, oil, tire marks, worn
    // asphalt), the parking lots (oil stains, cracks, tire marks, old paint)
    // and the sidewalks/walks (cracks, stains, gum, bleached spots). All
    // from one small canvas atlas, baked into a handful of merged meshes --
    // two layers (street level; sidewalks and lots) per ~400 m block, hidden
    // past DECAL_DRAW_DISTANCE -- drawn in the ground's own paint order with
    // alpha blending (still in the opaque pass, like the ground layers).
    // Purely visual: nothing walks, collides or navigates differently.
    // ------------------------------------------------------------------
    const decalGroups = [];
    if ((ENV.DECAL_DENSITY ?? 1) > 0) {
      const density = ENV.DECAL_DENSITY ?? 1;
      const CELLS = 4; // atlas: 4 x 4 cells
      const atlas = canvasTexture(512, 512, (ctx, w) => {
        const cw = w / CELLS;
        const r = seededRandom(4242);
        const cell = (i, draw) => {
          ctx.save();
          ctx.translate((i % CELLS) * cw, Math.floor(i / CELLS) * cw);
          ctx.beginPath();
          ctx.rect(4, 4, cw - 8, cw - 8); // keep a clear margin (mip bleed)
          ctx.clip();
          draw(cw);
          ctx.restore();
        };
        const crack = (x, y, len, ang, width, alpha, depth) => {
          ctx.strokeStyle = `rgba(18,18,18,${alpha})`;
          ctx.lineWidth = width;
          ctx.lineCap = "round";
          ctx.beginPath();
          ctx.moveTo(x, y);
          for (let k = 0; k < 9; k++) {
            ang += (r() - 0.5) * 0.9;
            x += Math.cos(ang) * len / 9;
            y += Math.sin(ang) * len / 9;
            ctx.lineTo(x, y);
            if (depth < 2 && r() < 0.22) crack(x, y, len * 0.45, ang + (r() < 0.5 ? 1 : -1) * (0.6 + r() * 0.6), width * 0.7, alpha * 0.85, depth + 1);
          }
          ctx.stroke();
        };
        const blob = (x, y, rad, color0, color1) => {
          const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
          g.addColorStop(0, color0);
          g.addColorStop(1, color1);
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(x, y, rad, 0, Math.PI * 2);
          ctx.fill();
        };
        cell(0, (s) => crack(8, s * 0.55, s * 0.95, -0.15, 2.2, 0.6, 0));                 // crack
        cell(1, (s) => { for (let k = 0; k < 5; k++) crack(10 + r() * s * 0.6, 10 + r() * s * 0.8, s * 0.5, r() * 6.3, 1.6, 0.45, 1); }); // alligator cracking
        cell(2, (s) => { for (let k = 0; k < 6; k++) blob(s * (0.35 + r() * 0.3), s * (0.35 + r() * 0.3), s * (0.12 + r() * 0.2), "rgba(8,8,10,0.42)", "rgba(8,8,10,0)"); }); // oil stain
        cell(3, (s) => { // asphalt patch: a slightly darker, uneven rectangle with a soft sealed seam
          ctx.filter = "blur(1.5px)";
          ctx.fillStyle = "rgba(24,24,26,0.16)";
          ctx.fillRect(s * 0.14, s * 0.2, s * 0.72, s * 0.6);
          for (let k = 0; k < 6; k++) {
            ctx.fillStyle = `rgba(24,24,26,${0.03 + r() * 0.05})`;
            ctx.fillRect(s * (0.14 + r() * 0.4), s * (0.2 + r() * 0.3), s * 0.3, s * 0.25);
          }
          ctx.strokeStyle = "rgba(12,12,12,0.28)";
          ctx.lineWidth = 2;
          ctx.strokeRect(s * 0.14, s * 0.2, s * 0.72, s * 0.6);
          ctx.filter = "none";
        });
        cell(4, (s) => { // tire marks: two soft dark stripes along u
          for (const y of [0.3, 0.7]) {
            const g = ctx.createLinearGradient(0, s * (y - 0.08), 0, s * (y + 0.08));
            g.addColorStop(0, "rgba(10,10,10,0)"); g.addColorStop(0.5, "rgba(10,10,10,0.35)"); g.addColorStop(1, "rgba(10,10,10,0)");
            ctx.fillStyle = g;
            ctx.fillRect(0, s * (y - 0.08), s, s * 0.16);
          }
        });
        cell(5, (s) => { for (let k = 0; k < 7; k++) blob(s * (0.3 + r() * 0.4), s * (0.3 + r() * 0.4), s * (0.08 + r() * 0.16), "rgba(92,72,46,0.5)", "rgba(92,72,46,0)"); }); // mud
        cell(6, (s) => blob(s / 2, s / 2, s * 0.46, "rgba(255,252,245,0.16)", "rgba(255,252,245,0)")); // bleached spot
        cell(7, (s) => { // water stain: faint fill, darker tide line
          blob(s / 2, s / 2, s * 0.44, "rgba(30,30,30,0.1)", "rgba(30,30,30,0.16)");
          ctx.strokeStyle = "rgba(30,30,30,0.18)"; ctx.lineWidth = 3;
          ctx.beginPath(); ctx.arc(s / 2, s / 2, s * 0.42, 0, Math.PI * 2); ctx.stroke();
        });
        cell(8, (s) => { for (let k = 0; k < 14; k++) blob(s * (0.1 + r() * 0.8), s * (0.1 + r() * 0.8), 2 + r() * 3, "rgba(35,35,35,0.55)", "rgba(35,35,35,0.3)"); }); // gum spots
        cell(9, (s) => { for (let k = 0; k < 10; k++) { ctx.fillStyle = `rgba(210,210,205,${0.05 + r() * 0.07})`; ctx.fillRect(0, s * r(), s, 2 + r() * 6); } }); // worn asphalt
        cell(10, (s) => { for (let k = 0; k < 8; k++) { ctx.fillStyle = `rgba(236,236,230,${0.2 + r() * 0.25})`; ctx.fillRect(s * (k / 8), s * 0.46, s / 8 * (0.3 + r() * 0.6), s * 0.08); } }); // old paint
        cell(11, (s) => { // sealed crack ("tar snake")
          ctx.strokeStyle = "rgba(8,8,8,0.55)"; ctx.lineWidth = 5; ctx.lineCap = "round";
          ctx.beginPath(); ctx.moveTo(4, s / 2);
          for (let x = 4; x < s; x += s / 10) ctx.lineTo(x, s / 2 + (r() - 0.5) * s * 0.25);
          ctx.stroke();
        });
      });
      atlas.wrapS = atlas.wrapT = THREE.ClampToEdgeWrapping;
      const decalMaterial = new THREE.MeshLambertMaterial({ map: atlas });
      decalMaterial.blending = THREE.CustomBlending; // blended, but kept in the ground's paint order
      decalMaterial.blendSrc = THREE.SrcAlphaFactor;
      decalMaterial.blendDst = THREE.OneMinusSrcAlphaFactor;

      const rand = seededRandom(90210);
      const GROUP_M = 400;
      const groups = new Map(); // "layer gx,gz" -> { lift, geometries, cx, cz }
      // One decal: world center, size along/across, angle (radians, 0 = +x), atlas cell.
      const add = (layer, lift, x, z, len, wid, angle, cellIndex) => {
        const ux = Math.cos(angle), uz = Math.sin(angle);
        const vx = -uz, vz = ux;
        const hl = len / 2, hw = wid / 2;
        const u0 = (cellIndex % CELLS) / CELLS, u1 = u0 + 1 / CELLS;
        const v1 = 1 - Math.floor(cellIndex / CELLS) / CELLS, v0 = v1 - 1 / CELLS;
        const g = groundQuad(
          [{ x: x - ux * hl - vx * hw, z: z - uz * hl - vz * hw }, { x: x + ux * hl - vx * hw, z: z + uz * hl - vz * hw },
            { x: x + ux * hl + vx * hw, z: z + uz * hl + vz * hw }, { x: x - ux * hl + vx * hw, z: z - uz * hl + vz * hw }],
          [[u0, v0], [u1, v0], [u1, v1], [u0, v1]], lift);
        const gx = Math.floor(x / GROUP_M), gz = Math.floor(z / GROUP_M);
        const key = layer + " " + gx + "," + gz;
        if (!groups.has(key)) groups.set(key, { geometries: [], cx: (gx + 0.5) * GROUP_M, cz: (gz + 0.5) * GROUP_M });
        groups.get(key).geometries.push(g);
      };
      const pickOf = (table) => { let t = rand(); for (const [w, v] of table) if ((t -= w) < 0) return v; return table[table.length - 1][1]; };
      // Streets: street level, under the intersection patches and crosswalks.
      const streetLiftM = streetLift(LIFT.road) + 0.003;
      for (const rd of ROADS) {
        const a = mapToWorld(rd[0], rd[1]), b = mapToWorld(rd[2], rd[3]);
        const len = Math.hypot(b.x - a.x, b.z - a.z);
        const ux = (b.x - a.x) / len, uz = (b.z - a.z) / len, ang = Math.atan2(uz, ux);
        const half = roadHalfWidth(rd) * MAP_SCALE;
        if (half < 3) continue; // alleys
        for (let s = rand() * 6; s < len; s += (6 + rand() * 10) / density) {
          const kind = pickOf([[0.26, "crack"], [0.12, "seal"], [0.12, "patch"], [0.18, "oil"], [0.1, "tire"], [0.22, "wear"]]);
          const across = (rand() * 2 - 1) * (half - 1.2);
          const x = a.x + ux * s - uz * across, z = a.z + uz * s + ux * across;
          if (kind === "crack") add("street", streetLiftM, x, z, 1.4 + rand() * 2, 1 + rand() * 0.8, rand() * 6.28, rand() < 0.6 ? 0 : 1);
          else if (kind === "seal") add("street", streetLiftM, x, z, 3 + rand() * 4, 0.5, ang + (rand() - 0.5) * 0.5, 11);
          else if (kind === "patch") add("street", streetLiftM, x, z, 1.2 + rand() * 1.6, 0.9 + rand() * 0.8, ang, 3);
          else if (kind === "oil") add("street", streetLiftM, a.x + ux * s - uz * (rand() - 0.5) * 2 * (half * 0.5), a.z + uz * s + ux * (rand() - 0.5) * 2 * (half * 0.5), 0.9 + rand() * 0.8, 0.9 + rand() * 0.8, rand() * 6.28, 2);
          else if (kind === "tire") add("street", streetLiftM, x, z, 3 + rand() * 3, 1.3, ang + (rand() - 0.5) * 0.12, 4);
          else add("street", streetLiftM, x, z, 3 + rand() * 4, 2 + rand(), ang, 9);
        }
      }
      // Parking lots.
      for (const lot of LOTS) {
        const w = rectToWorld(lot);
        const area = (w.maxX - w.minX) * (w.maxZ - w.minZ);
        const count = Math.round(area / 85 * density);
        const rowsAlongZ = lot[4] === "z";
        for (let i = 0; i < count; i++) {
          const x = w.minX + 1.5 + rand() * (w.maxX - w.minX - 3), z = w.minZ + 1.5 + rand() * (w.maxZ - w.minZ - 3);
          const kind = pickOf([[0.5, "oil"], [0.18, "crack"], [0.1, "tire"], [0.1, "paint"], [0.12, "patch"]]);
          const along = rowsAlongZ ? Math.PI / 2 : 0;
          if (kind === "oil") add("ground", LIFT.lot + 0.004, x, z, 0.8 + rand() * 0.9, 0.8 + rand() * 0.9, rand() * 6.28, 2);
          else if (kind === "crack") add("ground", LIFT.lot + 0.004, x, z, 1.5 + rand() * 2.5, 1.2, rand() * 6.28, rand() < 0.5 ? 0 : 1);
          else if (kind === "tire") add("ground", LIFT.lot + 0.004, x, z, 2.5 + rand() * 2, 1.2, along + Math.PI / 2 + (rand() - 0.5) * 0.4, 4);
          else if (kind === "paint") add("ground", LIFT.lot + 0.004, x, z, 2 + rand() * 2, 0.5, along + (rand() < 0.5 ? 0 : Math.PI / 2), 10);
          else add("ground", LIFT.lot + 0.004, x, z, 1.5 + rand() * 1.5, 1 + rand(), along, 3);
        }
      }
      // Sidewalks and campus walks: along each strip, kept inside it.
      const walkStrips = [
        ...PATHS.map((p) => [p[0], p[1], p[2], p[3], p[4] || PATH_WIDTH_PX]),
        ...ROADS.flatMap((rd) => {
          const offset = roadHalfWidth(rd) + SIDEWALK_GAP_PX + SIDEWALK_WIDTH_PX / 2;
          return [-1, 1].map((side) => isHorizontal(rd)
            ? [rd[0], rd[1] + side * offset, rd[2], rd[3] + side * offset, SIDEWALK_WIDTH_PX]
            : [rd[0] + side * offset, rd[1], rd[2] + side * offset, rd[3], SIDEWALK_WIDTH_PX]);
        }),
      ];
      for (const st of walkStrips) {
        const a = mapToWorld(st[0], st[1]), b = mapToWorld(st[2], st[3]);
        const len = Math.hypot(b.x - a.x, b.z - a.z);
        if (len < 4) continue;
        const ux = (b.x - a.x) / len, uz = (b.z - a.z) / len, ang = Math.atan2(uz, ux);
        const halfW = st[4] * MAP_SCALE / 2;
        for (let s = rand() * 8; s < len; s += (9 + rand() * 14) / density) {
          const kind = pickOf([[0.35, "crack"], [0.2, "gum"], [0.25, "bleach"], [0.2, "stain"]]);
          const size = Math.min(halfW * 2 - 0.3, 0.8 + rand() * 1.2);
          const across = (rand() * 2 - 1) * Math.max(0, halfW - size / 2 - 0.1);
          const x = a.x + ux * s - uz * across, z = a.z + uz * s + ux * across;
          const cellIndex = kind === "crack" ? 0 : kind === "gum" ? 8 : kind === "bleach" ? 6 : 7;
          add("ground", LIFT.lot + 0.004, x, z, size * (kind === "crack" ? 1.4 : 1), size, kind === "crack" ? ang + Math.PI / 2 + (rand() - 0.5) * 0.6 : rand() * 6.28, cellIndex);
        }
      }
      for (const group of groups.values()) {
        const mesh = mergedMesh(group.geometries, decalMaterial);
        mesh.name = "Decals";
        root.add(mesh);
        decalGroups.push({ mesh, cx: group.cx, cz: group.cz });
      }
    }

    // ------------------------------------------------------------------
    // WINDOWS (realism pass): rows of windows on the campus's brick
    // buildings -- the plain brick blocks and the walk-in buildings'
    // exterior walls (FLOOR_PLAN_FACADES, skipping their doors) -- so at
    // night a few of them can glow. Each window is one instance of a single
    // quad in its block's instanced mesh (~400 m blocks, hidden once past
    // the fog), dark glass in a light frame by day; a lit one is emissive,
    // never a real light.
    // Every building draws how occupied it is (dark, a few lights, several)
    // and each window its own moment to switch on through dusk (and off
    // again at sunrise) from a seeded hash, so it's the same every visit.
    // Windows only go where the outside of the wall is open air (not
    // against a neighbouring block or a joined building).
    // ------------------------------------------------------------------
    // ------------------------------------------------------------------
    // PARKED VEHICLES (vehicle-models.js): parking spaces worked out from
    // the same stall grid the lot texture paints (STALL_WIDTH_M x
    // STALL_DEPTH_M stalls, rows back to back across STALL_MODULE_M: a row,
    // the aisle, a row -- anchored at each lot's corner, stalls along the
    // lot's u axis), so every car sits between the painted lines. A space
    // is dropped where anything else is on the lot: planted islands, walks
    // across it, driveways, plazas, paths, a street, or any collider (trees,
    // buildings, fences, barricades, signs). Each lot has a busyness profile
    // (LOT_PARKING_PROFILES; unlisted ones go by size). The cars are
    // scenery only: no colliders, so movement and navigation are untouched.
    // ------------------------------------------------------------------
    // [lot's x1, y1] -> profile (PARKED_VEHICLE_CONFIG.PARKING_OCCUPANCY)
    const LOT_PARKING_PROFILES = {
      "556,500": "busy",     // G-1, the big lot south of the mall
      "604,200": "busy",     // M-5 metered parking by Comstock
      "838,562": "busy",     // G-11
      "30,195": "normal",    // Lot F (north)
      "30,430": "normal",    // Lot F (south-west)
      "248,30": "residential", // 11th-12th St lot among the houses
      "1385,20": "normal",   // F-1 free parking
      "290,628": "quiet",    // W-G
      "256,512": "quiet",    // small lot between Bridges and Owens
      "993,490": "quiet",    // small lot east of Murray
      "1062,440": "quiet",   // G-10 (remote east lots)
      "1140,500": "quiet",
      "1164,420": "quiet",
      "1252,420": "quiet",   // by the Maintenance Building
    };
    const parkingSpaces = [];
    {
      const STALL_ROW_OFFSETS = [[0, -1], [STALL_MODULE_M - STALL_DEPTH_M, 1]]; // row start within the module, and which way its head is (-1 toward the module start)
      const pxRectHits = (r, list, pad = 0) => list.some((o) => r[0] < o[2] + pad && r[2] > o[0] - pad && r[1] < o[3] + pad && r[3] > o[1] - pad);
      const stripRects = (list, defaultWidth) => list.map((p) => {
        const w = (p[4] || defaultWidth) / 2;
        return [Math.min(p[0], p[2]) - w, Math.min(p[1], p[3]) - w, Math.max(p[0], p[2]) + w, Math.max(p[1], p[3]) + w];
      });
      // (diagonal paths get their bounding box -- conservative, fine for this)
      const blockersPx = [...GRASS_AREAS, ...DRIVEWAYS, ...PLAZAS, ...streetRectsPx, ...stripRects(LOT_WALKS, PATH_WIDTH_PX), ...stripRects(PATHS, PATH_WIDTH_PX)];
      const colliderHits = (w) => forEachColliderIn(w.minX, w.minZ, w.maxX, w.maxZ, (c) => {
        if (c.shape === "cylinder") {
          const dx = c.cx - Math.max(w.minX, Math.min(c.cx, w.maxX)), dz = c.cz - Math.max(w.minZ, Math.min(c.cz, w.maxZ));
          return dx * dx + dz * dz < c.radius * c.radius;
        }
        // box collider (possibly rotated): any footprint sample inside it, or its center inside the footprint
        if (c.cx > w.minX && c.cx < w.maxX && c.cz > w.minZ && c.cz < w.maxZ) return true;
        for (const fx of [0, 0.5, 1]) for (const fz of [0, 0.5, 1]) {
          const l = toLocal(c, w.minX + (w.maxX - w.minX) * fx, w.minZ + (w.maxZ - w.minZ) * fz);
          if (Math.abs(l.x) < c.halfX && Math.abs(l.z) < c.halfZ) return true;
        }
        return false;
      });
      LOTS.forEach((lot) => {
        const w = rectToWorld(lot);
        const uAxis = lot[4] || (w.maxX - w.minX >= w.maxZ - w.minZ ? "x" : "z");
        const key = lot[0] + "," + lot[1];
        const area = (w.maxX - w.minX) * (w.maxZ - w.minZ);
        const profile = LOT_PARKING_PROFILES[key] || (area > 9000 ? "busy" : area < 2500 ? "quiet" : "normal");
        const [u0, u1] = uAxis === "x" ? [w.minX, w.maxX] : [w.minZ, w.maxZ];
        const [v0, v1] = uAxis === "x" ? [w.minZ, w.maxZ] : [w.minX, w.maxX];
        for (let module = 0; v0 + module * STALL_MODULE_M < v1; module++) {
          for (const [rowStart, headDir] of STALL_ROW_OFFSETS) {
            const r0 = v0 + module * STALL_MODULE_M + rowStart, r1 = r0 + STALL_DEPTH_M;
            if (r1 > v1 + 0.01) continue; // a row cut off by the lot's far edge
            for (let k = 0; u0 + (k + 1) * STALL_WIDTH_M <= u1 + 0.01; k++) {
              const s0 = u0 + k * STALL_WIDTH_M, s1 = s0 + STALL_WIDTH_M;
              const cu = (s0 + s1) / 2, cv = (r0 + r1) / 2;
              const x = uAxis === "x" ? cu : cv, z = uAxis === "x" ? cv : cu;
              // footprint a little inside the stall's painted lines
              const hu = STALL_WIDTH_M / 2 - 0.2, hv = STALL_DEPTH_M / 2 - 0.1;
              const foot = uAxis === "x"
                ? { minX: x - hu, maxX: x + hu, minZ: z - hv, maxZ: z + hv }
                : { minX: x - hv, maxX: x + hv, minZ: z - hu, maxZ: z + hu };
              const footPx = [foot.minX / MAP_SCALE + MAP_CENTER_X, foot.minZ / MAP_SCALE + MAP_CENTER_Y, foot.maxX / MAP_SCALE + MAP_CENTER_X, foot.maxZ / MAP_SCALE + MAP_CENTER_Y];
              if (pxRectHits(footPx, blockersPx, 0.3) || colliderHits(foot)) continue;
              // heading of a car parked nose-in: toward the head of its row
              const yaw = uAxis === "x" ? (headDir < 0 ? -Math.PI / 2 : Math.PI / 2) : (headDir < 0 ? Math.PI : 0);
              parkingSpaces.push({ x, z, yaw, width: STALL_WIDTH_M, depth: STALL_DEPTH_M, lot: key, profile });
            }
          }
        }
      });
    }
    const vehicleSystem = window.createParkedVehicleSystem
      ? window.createParkedVehicleSystem(THREE, root, parkingSpaces, { groundHeightAt })
      : null;

    const windowGroups = [];
    if (ENV.WINDOWS_ENABLED !== false) {
      const WINDOW_W = 1.45, WINDOW_H = 1.55, WINDOW_PITCH = 3.3, STOREY_M = 3.8, SILL_M = 0.95;
      const lightShare = (ENV.WINDOW_LIGHT_PERCENTAGE ?? 0.22) / 0.22;
      const windowGeometry = new THREE.PlaneGeometry(1, 1);
      const windowMaterial = new THREE.MeshLambertMaterial({ color: 0xffffff });
      windowMaterial.onBeforeCompile = (shader) => {
        shader.uniforms.nightLights = environment.nightLights;
        shader.vertexShader = shader.vertexShader
          .replace("#include <common>", "#include <common>\nattribute vec4 windowData;\nvarying vec4 vWindowData;\nvarying vec2 vWindowUv;")
          .replace("#include <begin_vertex>", "#include <begin_vertex>\nvWindowData = windowData;\nvWindowUv = uv;");
        shader.fragmentShader = shader.fragmentShader
          .replace("#include <common>", "#include <common>\nuniform float nightLights;\nvarying vec4 vWindowData;\nvarying vec2 vWindowUv;\nfloat windowGlass = 0.0;")
          .replace("#include <color_fragment>", [
            "#include <color_fragment>",
            // frame (light aluminum) around, and one mullion down the middle
            "vec2 wUv = vWindowUv;",
            "float wFrame = max(step(wUv.x, 0.045), step(1.0 - wUv.x, 0.045));",
            "wFrame = max(wFrame, max(step(wUv.y, 0.05), step(1.0 - wUv.y, 0.05)));",
            "wFrame = max(wFrame, step(abs(wUv.x - 0.5), 0.018));",
            "windowGlass = 1.0 - wFrame;",
            // glass: dark, cool, lighter toward the top (the sky it reflects)
            "vec3 wGlass = mix(vec3(0.13, 0.16, 0.2), vec3(0.3, 0.36, 0.43), smoothstep(0.1, 1.0, wUv.y) * 0.8);",
            "diffuseColor.rgb = mix(vec3(0.7, 0.71, 0.72), wGlass, windowGlass);",
          ].join("\n"))
          .replace("#include <emissivemap_fragment>", [
            "#include <emissivemap_fragment>",
            "{",
            "  float lit = smoothstep(vWindowData.x, vWindowData.x + 0.1, nightLights);",
            // blinds: soft horizontal banding, different per window
            "  float blinds = 0.82 + 0.18 * sin(vWindowUv.y * (30.0 + 40.0 * vWindowData.w) + vWindowData.w * 10.0);",
            "  vec3 warm = mix(vec3(1.0, 0.72, 0.42), vec3(0.95, 0.88, 0.75), vWindowData.z);",
            "  totalEmissiveRadiance += warm * lit * vWindowData.y * windowGlass * blinds * " + (ENV.WINDOW_BRIGHTNESS ?? 1).toFixed(2) + ";",
            "}",
          ].join("\n"));
      };
      // Is (x, z) out in the open (no tall collider there)?
      const openAir = (x, z) => !forEachColliderIn(x - 0.05, z - 0.05, x + 0.05, z + 0.05, (c) => {
        if (c.height < 3 || c.shape === "cylinder") return false;
        const l = toLocal(c, x, z);
        return Math.abs(l.x) < c.halfX && Math.abs(l.z) < c.halfZ;
      });
      const hash = (a, b) => {
        let h = Math.imul(Math.round(a * 97) ^ 0x5bd1e995, 0x27d4eb2d) ^ Math.imul(Math.round(b * 131) + 7, 0x165667b1);
        h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
        return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
      };
      // How occupied a building is: dark, a few lights or several.
      const occupancy = (seedX, seedZ) => {
        const r = hash(seedX, seedZ);
        return (r < 0.25 ? 0 : r < 0.7 ? 0.13 : 0.4) * lightShare;
      };
      const matrix = new THREE.Matrix4();
      const quat = new THREE.Quaternion();
      const yAxis = new THREE.Vector3(0, 1, 0);
      // Windows along one wall face: from (ax, az) to (bx, bz), facing
      // (nx, nz), up to `top`; `skip(s, y0, y1)` rules out spots (doors).
      function addFace(list, ax, az, bx, bz, nx, nz, top, occ, skip) {
        const len = Math.hypot(bx - ax, bz - az);
        const count = Math.floor((len - 1.4) / WINDOW_PITCH);
        if (count < 1) return;
        const ux = (bx - ax) / len, uz = (bz - az) / len;
        const start = (len - (count - 1) * WINDOW_PITCH) / 2;
        const yaw = Math.atan2(nx, nz);
        quat.setFromAxisAngle(yAxis, yaw);
        for (let row = 0; ; row++) {
          const y0 = SILL_M + row * STOREY_M, y1 = y0 + WINDOW_H;
          if (y1 > top - 0.9) break;
          for (let i = 0; i < count; i++) {
            const s = start + i * WINDOW_PITCH;
            if (skip && skip(s, y0, y1)) continue;
            const x = ax + ux * s, z = az + uz * s;
            if (!openAir(x + nx * 0.6, z + nz * 0.6)) continue;
            const r = hash(x * 3.1 + row, z * 2.7 - row);
            const lit = r < occ ? 0.05 + 0.85 * hash(z, x) : 3; // when it switches on (3 = never)
            matrix.compose(new THREE.Vector3(x + nx * 0.012, (y0 + y1) / 2, z + nz * 0.012), quat, new THREE.Vector3(WINDOW_W, WINDOW_H, 1));
            list.push({ m: matrix.clone(), d: [lit, 0.55 + 0.6 * hash(x + 1.7, z), hash(z + 3, x), hash(x, z + 9)] });
          }
        }
      }
      // Instances go into ~400 m blocks (a draw or two near the player).
      const BLOCK_M = 400;
      const blocks = new Map();
      const blockList = (x, z) => {
        const key = Math.floor(x / BLOCK_M) + "," + Math.floor(z / BLOCK_M);
        if (!blocks.has(key)) blocks.set(key, { list: [], cx: (Math.floor(x / BLOCK_M) + 0.5) * BLOCK_M, cz: (Math.floor(z / BLOCK_M) + 0.5) * BLOCK_M });
        return blocks.get(key).list;
      };
      for (const zone of zones) {
        for (const c of zone.colliders) {
          if (c.floorPlan || c.render === false || c.glass || c.shape === "cylinder" || c.color !== undefined) continue;
          if (c.style !== "brick" || c.base || c.height < 5.5 || Math.min(c.halfX, c.halfZ) < 2) continue;
          const occ = occupancy(c.cx, c.cz);
          const X = { x: c.cos, z: -c.sin }, Z = { x: c.sin, z: c.cos }; // local axes in the world
          const corner = (sx, sz) => ({ x: c.cx + X.x * sx * c.halfX + Z.x * sz * c.halfZ, z: c.cz + X.z * sx * c.halfX + Z.z * sz * c.halfZ });
          const faces = [
            [corner(1, -1), corner(1, 1), X.x, X.z], [corner(-1, 1), corner(-1, -1), -X.x, -X.z],
            [corner(1, 1), corner(-1, 1), Z.x, Z.z], [corner(-1, -1), corner(1, -1), -Z.x, -Z.z],
          ];
          for (const [a, b, nx, nz] of faces) addFace(blockList(c.cx, c.cz), a.x, a.z, b.x, b.z, nx, nz, c.height, occ);
        }
      }
      for (const f of FLOOR_PLAN_FACADES) {
        const occ = occupancy(f.key.length * 13.7, f.a.x + f.a.z);
        const skip = (s, y0, y1) => f.gaps.some((g) => g.s0 - 0.5 < s + WINDOW_W / 2 && g.s1 + 0.5 > s - WINDOW_W / 2 && g.y0 < y1 && g.y1 > y0);
        addFace(blockList((f.a.x + f.b.x) / 2, (f.a.z + f.b.z) / 2), f.a.x, f.a.z, f.b.x, f.b.z, f.outX, f.outZ, f.top, occ, skip);
      }
      for (const block of blocks.values()) {
        const list = block.list;
        if (list.length === 0) continue;
        const g = windowGeometry.clone();
        const data = new Float32Array(list.length * 4);
        list.forEach((w, i) => data.set(w.d, i * 4));
        g.setAttribute("windowData", new THREE.InstancedBufferAttribute(data, 4));
        g.boundingSphere = new THREE.Sphere(new THREE.Vector3(block.cx, 10, block.cz), BLOCK_M * 0.75 + 30);
        const mesh = new THREE.InstancedMesh(g, windowMaterial, list.length);
        list.forEach((w, i) => mesh.setMatrixAt(i, w.m));
        mesh.instanceMatrix.needsUpdate = true;
        mesh.name = "Windows";
        root.add(mesh);
        windowGroups.push({ mesh, cx: block.cx, cz: block.cz });
      }
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

    const hollowRects = [...HOLLOW_BUILDINGS, ...FLOOR_PLAN_FLOORS_PX].map(rectToWorld);
    function isInsideHollowBuilding(x, z) {
      return hollowRects.some((r) => x > r.minX && x < r.maxX && z > r.minZ && z < r.maxZ) ||
        inFloorPlanQuad(x / MAP_SCALE + MAP_CENTER_X, z / MAP_SCALE + MAP_CENTER_Y);
    }

    // Footstep surface at a world point: "concrete" for anything hard --
    // streets, sidewalks, walks, plazas, lots, driveways, the running track,
    // indoors, or standing up on a structure (bleachers, steps, a roof) --
    // and "grass" for soft ground (grass, dirt, turf, the construction pit).
    // feetY: the body's feet, to tell standing on something from the ground.
    function surfaceAt(x, z, feetY = 0) {
      if (feetY > groundHeightAt(x, z) + 0.05 || isInsideHollowBuilding(x, z)) return "concrete";
      const px = x / MAP_SCALE + MAP_CENTER_X, py = z / MAP_SCALE + MAP_CENTER_Y;
      for (const r of GRASS_AREAS) if (inRect(px, py, r, 0)) return "grass"; // lawn islands inside lots
      for (const r of [...streetRectsPx, ...LOTS, ...PLAZAS, ...DRIVEWAYS, ...RUNWAYS]) if (inRect(px, py, r, 0)) return "concrete";
      for (const r of [...ROADS, ...CONSTRUCTION_ROADS]) { // the sidewalks along both sides
        const d = distToSegment(px, py, r[0], r[1], r[2], r[3]);
        if (Math.abs(d - ((r[4] || ROAD_WIDTH_PX) / 2 + SIDEWALK_GAP_PX + SIDEWALK_WIDTH_PX / 2)) <= SIDEWALK_WIDTH_PX / 2) return "concrete";
      }
      for (const p of [...PATHS, ...LOT_WALKS]) {
        if (distToSegment(px, py, p[0], p[1], p[2], p[3]) <= (p[4] || PATH_WIDTH_PX) / 2) return "concrete";
      }
      for (const a of [...PATH_ARCS, ...DRIVE_ARCS]) {
        if (Math.abs(Math.hypot(px - a[0], py - a[1]) - a[2]) > a[3] / 2) continue;
        const deg = ((Math.atan2(a[1] - py, px - a[0]) * 180) / Math.PI - a[4] + 720) % 360; // counterclockwise on the screenshot
        if (a[5] >= 360 || deg <= a[5]) return "concrete";
      }
      for (const r of TRACKS) { // the lanes only -- the infield is turf
        const cap = capsuleOf(r);
        const d = Math.hypot(x - cap.cx, z - Math.max(cap.zTop, Math.min(cap.zBottom, z)));
        if (d <= cap.radius && d >= cap.radius - TRACK_LANES * TRACK_LANE_WIDTH_M) return "concrete";
      }
      return "grass";
    }

    // Where 3D grass grows (see grass-system.js): only the lawn itself --
    // the base grass layer and the planted islands inside lots -- never
    // on anything laid over it (streets, sidewalks, walks, lots, driveways,
    // plazas, the track and its turf infield, turf and soccer fields,
    // pools, dirt, the construction pits) or under anything standing on it
    // (every building, house, bleacher, fence, prop and tree trunk -- the
    // same colliders movement uses) or inside a hollow building. Returns a
    // tester for points inside the given world box: (x, z) -> the ground
    // height the grass stands on there, or -1 for none. Every layout list
    // is cut down to the box once up front, so testing the ~1000 points of
    // a grass chunk stays cheap.
    const TRACK_CAPSULES = TRACKS.map(capsuleOf);
    const SPLASH_PAD = { c: mapToWorld(1789, 634), r: 5 * MAP_SCALE };
    const GRASS_EDGE_PAD_M = 0.12; // keep blades from spilling over edges and walls
    function grassTesterForArea(minX, minZ, maxX, maxZ) {
      const pad = 2; // px
      const pMinX = minX / MAP_SCALE + MAP_CENTER_X - pad, pMaxX = maxX / MAP_SCALE + MAP_CENTER_X + pad;
      const pMinY = minZ / MAP_SCALE + MAP_CENTER_Y - pad, pMaxY = maxZ / MAP_SCALE + MAP_CENTER_Y + pad;
      const rectHits = (r) => r[2] >= pMinX && r[0] <= pMaxX && r[3] >= pMinY && r[1] <= pMaxY;
      const segHits = (s, reach) => Math.max(s[0], s[2]) + reach >= pMinX && Math.min(s[0], s[2]) - reach <= pMaxX &&
        Math.max(s[1], s[3]) + reach >= pMinY && Math.min(s[1], s[3]) - reach <= pMaxY;
      const circleHits = (cx, cy, r) => cx + r >= pMinX && cx - r <= pMaxX && cy + r >= pMinY && cy - r <= pMaxY;
      const edgePx = GRASS_EDGE_PAD_M / MAP_SCALE;
      const islands = GRASS_AREAS.filter(rectHits);
      const coverRects = [...streetRectsPx, ...LOTS, ...PLAZAS, ...DRIVEWAYS, ...RUNWAYS, ...TURF_AREAS, ...SOCCER_FIELDS,
        ...POOLS, ...WADING_POOLS, ...DIRT_AREAS, ...pitRectsPx].filter(rectHits);
      const sidewalkReach = (r) => (r[4] || ROAD_WIDTH_PX) / 2 + SIDEWALK_GAP_PX + SIDEWALK_WIDTH_PX;
      const roads = [...ROADS, ...CONSTRUCTION_ROADS].filter((r) => segHits(r, sidewalkReach(r) + pad));
      const paths = [...PATHS, ...LOT_WALKS].filter((p) => segHits(p, (p[4] || PATH_WIDTH_PX) / 2 + pad));
      const arcs = [...PATH_ARCS, ...DRIVE_ARCS].filter((a) => circleHits(a[0], a[1], a[2] + a[3]));
      const dirtArcs = DIRT_ARCS.filter((a) => circleHits(a[0], a[1], a[3]));
      const dirtCircles = DIRT_CIRCLES.filter((d) => circleHits(d[0], d[1], d[2]));
      const hollows = hollowRects.filter((r) => r.maxX >= minX && r.minX <= maxX && r.maxZ >= minZ && r.minZ <= maxZ);
      const colliders = [];
      forEachColliderIn(minX - 1, minZ - 1, maxX + 1, maxZ + 1, (c) => {
        if (!c.base) colliders.push(c); // raised pieces (lintels, canopies) leave the ground under them alone
      });
      const tracks = TRACK_CAPSULES.filter((cap) => cap.cx + cap.radius >= minX && cap.cx - cap.radius <= maxX &&
        cap.zBottom + cap.radius >= minZ && cap.zTop - cap.radius <= maxZ);

      return (x, z) => {
        const px = x / MAP_SCALE + MAP_CENTER_X, py = z / MAP_SCALE + MAP_CENTER_Y;
        let height = 0;
        let island = false;
        for (const r of islands) if (inRect(px, py, r, -edgePx)) { island = true; break; }
        if (island) {
          height = LIFT.grassIsland;
        } else {
          for (const r of coverRects) if (inRect(px, py, r, edgePx)) return -1;
          for (const r of roads) {
            const d = distToSegment(px, py, r[0], r[1], r[2], r[3]);
            if (d <= sidewalkReach(r) + edgePx) {
              // the road itself, or the sidewalk -- the grass strip between them stays
              const half = (r[4] || ROAD_WIDTH_PX) / 2;
              if (d <= half + edgePx || Math.abs(d - (half + SIDEWALK_GAP_PX + SIDEWALK_WIDTH_PX / 2)) <= SIDEWALK_WIDTH_PX / 2 + edgePx) return -1;
            }
          }
          for (const p of paths) if (distToSegment(px, py, p[0], p[1], p[2], p[3]) <= (p[4] || PATH_WIDTH_PX) / 2 + edgePx) return -1;
          for (const a of arcs) {
            if (Math.abs(Math.hypot(px - a[0], py - a[1]) - a[2]) > a[3] / 2 + edgePx) continue;
            const deg = ((Math.atan2(a[1] - py, px - a[0]) * 180) / Math.PI - a[4] + 720) % 360;
            if (a[5] >= 360 || deg <= a[5]) return -1;
          }
          for (const d of dirtCircles) if (Math.hypot(px - d[0], py - d[1]) <= d[2] + edgePx) return -1;
          for (const a of dirtArcs) {
            const r = Math.hypot(px - a[0], py - a[1]);
            if (r < a[2] - edgePx || r > a[3] + edgePx) continue;
            const ang = (Math.atan2(a[1] - py, px - a[0]) * 180) / Math.PI; // flatArcWorld's: counterclockwise on the screenshot
            const rel = (((ang - a[4]) % 360) + 360) % 360;
            if (a[5] >= 360 || rel <= a[5]) return -1;
          }
          for (const cap of tracks) { // lanes and turf infield alike
            const d = Math.hypot(x - cap.cx, z - Math.max(cap.zTop, Math.min(cap.zBottom, z)));
            if (d <= cap.radius + GRASS_EDGE_PAD_M) return -1;
          }
          if (Math.hypot(x - SPLASH_PAD.c.x, z - SPLASH_PAD.c.z) <= SPLASH_PAD.r + GRASS_EDGE_PAD_M) return -1;
          if (groundHeightAt(x, z) !== 0) return -1; // a pit step or a street's curb ramp
        }
        for (const r of hollows) if (x > r.minX - GRASS_EDGE_PAD_M && x < r.maxX + GRASS_EDGE_PAD_M && z > r.minZ - GRASS_EDGE_PAD_M && z < r.maxZ + GRASS_EDGE_PAD_M) return -1;
        if (inFloorPlanQuad(px, py)) return -1; // angled floor pieces (the Sun Garden wing, Langseth's curved 104)
        for (const c of colliders) {
          if (c.shape === "cylinder") {
            if ((x - c.cx) ** 2 + (z - c.cz) ** 2 < (c.radius + GRASS_EDGE_PAD_M) ** 2) return -1;
            continue;
          }
          const local = toLocal(c, x, z);
          if (Math.abs(local.x) < c.halfX + GRASS_EDGE_PAD_M && Math.abs(local.z) < c.halfZ + GRASS_EDGE_PAD_M) return -1;
        }
        return height;
      };
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
    const NAV_CHUNK_CACHE_LIMIT = 400;    // ~1.6 MB worst case, oldest dropped first
    // Cells hold the height a body stands at there (ground, or the top of
    // a bleacher step), or NAV_BLOCKED. A move between neighbors may climb
    // at most NAV_MAX_CLIMB_M and drop at most NAV_MAX_DROP_M. Only
    // climbable pieces (bleachers, stepped at most STEP_UP_M) raise a cell,
    // so the climb limit is two steps: cells are 1 m apart, and a bleacher
    // step can be shallower than that.
    const NAV_BLOCKED = -1e9;
    const NAV_MAX_CLIMB_M = STEP_UP_M * 2 + 0.01;
    const NAV_MAX_DROP_M = 1.0;
    const navStepOk = (from, to) => to !== NAV_BLOCKED && to - from <= NAV_MAX_CLIMB_M && from - to <= NAV_MAX_DROP_M;
    const navChunks = new Map();

    function rasterizeNavChunk(chunkX, chunkZ) {
      const cells = new Float32Array(NAV_CHUNK_CELLS * NAV_CHUNK_CELLS);
      const x0 = chunkX * NAV_CHUNK_CELLS * NAV_CELL_M;
      const z0 = chunkZ * NAV_CHUNK_CELLS * NAV_CELL_M;
      const span = NAV_CHUNK_CELLS * NAV_CELL_M;
      const nearby = [];
      const climbables = [];
      forEachColliderIn(x0 - NAV_CLEARANCE_M, z0 - NAV_CLEARANCE_M, x0 + span + NAV_CLEARANCE_M, z0 + span + NAV_CLEARANCE_M, (c) => {
        if (c.climbable) climbables.push(c);
        else nearby.push(c);
      });
      for (let j = 0; j < NAV_CHUNK_CELLS; j++) {
        for (let i = 0; i < NAV_CHUNK_CELLS; i++) {
          const x = x0 + (i + 0.5) * NAV_CELL_M;
          const z = z0 + (j + 0.5) * NAV_CELL_M;
          let walkable = x > bounds.minX + NAV_CLEARANCE_M && x < bounds.maxX - NAV_CLEARANCE_M &&
            z > bounds.minZ + NAV_CLEARANCE_M && z < bounds.maxZ - NAV_CLEARANCE_M;
          const standY = climbTopAt(x, z, climbables);
          for (let k = 0; walkable && k < nearby.length; k++) {
            const c = nearby[k];
            if (!blocksBody(c, standY, true, 1.85)) continue;
            if (c.shape === "cylinder") {
              if ((x - c.cx) ** 2 + (z - c.cz) ** 2 < (c.radius + NAV_CLEARANCE_M) ** 2) walkable = false;
            } else {
              const local = toLocal(c, x, z);
              const dx = local.x - Math.max(-c.halfX, Math.min(local.x, c.halfX));
              const dz = local.z - Math.max(-c.halfZ, Math.min(local.z, c.halfZ));
              if (dx * dx + dz * dz < NAV_CLEARANCE_M * NAV_CLEARANCE_M) walkable = false;
            }
          }
          cells[j * NAV_CHUNK_CELLS + i] = walkable ? standY : NAV_BLOCKED;
        }
      }
      return cells;
    }

    function navCellHeight(cx, cz) {
      const chunkX = Math.floor(cx / NAV_CHUNK_CELLS);
      const chunkZ = Math.floor(cz / NAV_CHUNK_CELLS);
      const key = chunkZ * 100000 + chunkX;
      let cells = navChunks.get(key);
      if (!cells) {
        if (navChunks.size >= NAV_CHUNK_CACHE_LIMIT) navChunks.delete(navChunks.keys().next().value);
        cells = rasterizeNavChunk(chunkX, chunkZ);
        navChunks.set(key, cells);
      }
      return cells[(cz - chunkZ * NAV_CHUNK_CELLS) * NAV_CHUNK_CELLS + (cx - chunkX * NAV_CHUNK_CELLS)];
    }
    const navWalkableCell = (cx, cz) => navCellHeight(cx, cz) !== NAV_BLOCKED;

    // Upper-floor cells (a FLOOR_PLAN_LEVELS level): the same 1 m cells and
    // A*, but a cell stands on the highest surface at most a step above the
    // floor's height (a slab, a landing, a stair step) instead of the ground,
    // and only inside that building. Rasterized lazily, per level, only when
    // something up there needs a path -- the ground grid is untouched.
    const navLevelChunks = new Map(); // level key -> Map(chunk key -> cells)
    function rasterizeLevelChunk(chunkX, chunkZ, level) {
      const cells = new Float32Array(NAV_CHUNK_CELLS * NAV_CHUNK_CELLS).fill(NAV_BLOCKED);
      const x0 = chunkX * NAV_CHUNK_CELLS * NAV_CELL_M;
      const z0 = chunkZ * NAV_CHUNK_CELLS * NAV_CELL_M;
      const span = NAV_CHUNK_CELLS * NAV_CELL_M;
      const b = level.box;
      if (x0 > b.maxX || x0 + span < b.minX || z0 > b.maxZ || z0 + span < b.minZ) return cells;
      const nearby = [];
      forEachColliderIn(x0 - NAV_CLEARANCE_M, z0 - NAV_CLEARANCE_M, x0 + span + NAV_CLEARANCE_M, z0 + span + NAV_CLEARANCE_M, (c) => { nearby.push(c); });
      const reach = level.refY + STEP_UP_M + 0.01;
      for (let j = 0; j < NAV_CHUNK_CELLS; j++) {
        for (let i = 0; i < NAV_CHUNK_CELLS; i++) {
          const x = x0 + (i + 0.5) * NAV_CELL_M;
          const z = z0 + (j + 0.5) * NAV_CELL_M;
          if (!level.floors.some((f) => x > f.minX && x < f.maxX && z > f.minZ && z < f.maxZ)) continue;
          let standY = groundHeightAt(x, z);
          for (const c of nearby) {
            if (c.isTree || c.height > reach || c.height <= standY) continue;
            if (c.shape === "cylinder") { if ((x - c.cx) ** 2 + (z - c.cz) ** 2 < c.radius ** 2) standY = c.height; continue; }
            const local = toLocal(c, x, z);
            if (Math.abs(local.x) <= c.halfX && Math.abs(local.z) <= c.halfZ) standY = c.height;
          }
          if (standY < level.refY - NAV_LEVEL_MARGIN_M) continue; // not on this floor (a stairwell, an atrium)
          let walkable = true;
          for (let k = 0; walkable && k < nearby.length; k++) {
            const c = nearby[k];
            if (!blocksBody(c, standY, true, 1.85)) continue;
            if (c.shape === "cylinder") {
              if ((x - c.cx) ** 2 + (z - c.cz) ** 2 < (c.radius + NAV_CLEARANCE_M) ** 2) walkable = false;
            } else {
              const local = toLocal(c, x, z);
              const dx = local.x - Math.max(-c.halfX, Math.min(local.x, c.halfX));
              const dz = local.z - Math.max(-c.halfZ, Math.min(local.z, c.halfZ));
              if (dx * dx + dz * dz < NAV_CLEARANCE_M * NAV_CLEARANCE_M) walkable = false;
            }
          }
          if (walkable) cells[j * NAV_CHUNK_CELLS + i] = standY;
        }
      }
      return cells;
    }
    function navLevelCellHeight(cx, cz, level) {
      let chunks = navLevelChunks.get(level.key);
      if (!chunks) navLevelChunks.set(level.key, (chunks = new Map()));
      const chunkX = Math.floor(cx / NAV_CHUNK_CELLS);
      const chunkZ = Math.floor(cz / NAV_CHUNK_CELLS);
      const key = chunkZ * 100000 + chunkX;
      let cells = chunks.get(key);
      if (!cells) chunks.set(key, (cells = rasterizeLevelChunk(chunkX, chunkZ, level)));
      return cells[(cz - chunkZ * NAV_CHUNK_CELLS) * NAV_CHUNK_CELLS + (cx - chunkX * NAV_CHUNK_CELLS)];
    }

    const navWindowSize = NAV_WINDOW_CELLS * NAV_WINDOW_CELLS;
    const navG = new Float32Array(navWindowSize);
    const navFrom = new Int32Array(navWindowSize);
    const navState = new Uint8Array(navWindowSize); // 0 unseen, 1 open, 2 closed
    const navHeap = [];
    const NAV_NEIGHBORS = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];

    // Nearest walkable cell within a few cells of (cx, cz), or null.
    // nearY (optional): only cells a body standing at that height could step
    // onto -- never a stair step high above it just because it's close.
    function nearestWalkableCell(cx, cz, inWindow, cellHeight = navCellHeight, nearY) {
      for (let r = 0; r <= 3; r++) {
        for (let dz = -r; dz <= r; dz++) {
          for (let dx = -r; dx <= r; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
            if (!inWindow(cx + dx, cz + dz)) continue;
            const h = cellHeight(cx + dx, cz + dz);
            if (h !== NAV_BLOCKED && (nearY === undefined || Math.abs(h - nearY) <= NAV_MAX_CLIMB_M)) return { cx: cx + dx, cz: cz + dz };
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
    //
    // sy / gy (optional): the start's and goal's standing heights. When
    // either is up on a portal-linked floor, the route goes by stair portal
    // (see findPathAcrossLevels); otherwise -- and always without heights --
    // this is the ordinary ground navigation, exactly as before.
    function findPath(sx, sz, gx, gz, sy, gy) {
      if (sy !== undefined && FLOOR_PLAN_PORTALS.length > 0) {
        const routed = findPathAcrossLevels(sx, sz, sy, gx, gz, gy);
        if (routed !== undefined) return routed;
      }
      // A fence between here and the goal: route to (and through) a gate
      // first -- the next repath, once on the goal's side, goes straight on.
      const via = fenceWaypoint(sx, sz, gx, gz);
      if (via) {
        const toGate = findPathLocal(sx, sz, via.x, via.z, null, sy);
        if (toGate && via.through) toGate.push({ x: via.through.x, z: via.through.z });
        return toGate;
      }
      return findPathLocal(sx, sz, gx, gz, null, sy, gy);
    }

    // Floor-to-floor routing. Returns undefined when neither end is on an
    // upper floor (the caller carries on with ground navigation).
    //   same upper floor      -> A* on that floor's cells
    //   partway up a stair    -> the rest of that stair, toward the goal's floor
    //   different floors      -> A* to the best portal's near end, then its
    //                            stair line (the next repaths take over from
    //                            the far end)
    // Only runs at repath time, only when the ends are on different floors,
    // and only looks at portals reaching one of the two floors.
    function findPathAcrossLevels(sx, sz, sy, gx, gz, gy) {
      const from = navLevelAt(sx, sz, sy), to = navLevelAt(gx, gz, gy);
      // On a stair (or at either end of one that leads where we're going):
      // keep going along its line rather than re-planning to its end.
      let onStair = navPortalUnder(sx, sz, sy);
      if (!onStair && from !== to) {
        onStair = FLOOR_PLAN_PORTALS.find((p) => p.open && (p.level === from || p.level === to) &&
          sx > p.box.minX && sx < p.box.maxX && sz > p.box.minZ && sz < p.box.maxZ &&
          sy >= p.lowerH - 0.3 && sy <= p.upperH + 0.3) || null;
      }
      if (onStair && onStair.open && (from !== to || !from)) {
        const up = to === onStair.level;
        if (up || from === onStair.level || to !== onStair.level) {
          // the stair segment the body is on, then the rest of the line
          let best = 0, bestD = Infinity;
          for (let i = 0; i + 1 < onStair.line.length; i++) {
            const a = onStair.line[i], b = onStair.line[i + 1];
            const dx = b.x - a.x, dz = b.z - a.z, len2 = dx * dx + dz * dz || 1e-9;
            const t = Math.max(0, Math.min(1, ((sx - a.x) * dx + (sz - a.z) * dz) / len2));
            const d = Math.hypot(sx - (a.x + dx * t), sz - (a.z + dz * t)) + Math.abs(sy - (a.y + (b.y - a.y) * t));
            if (d < bestD) { bestD = d; best = i; }
          }
          const rest = up ? onStair.line.slice(best + 1) : onStair.line.slice(0, best + 1).reverse();
          const path = rest.map((q) => ({ x: q.x, z: q.z }));
          path.stairFrom = 0;
          return path;
        }
      }
      if (!from && !to) return undefined;
      if (from === to) return findPathLocal(sx, sz, gx, gz, from, sy, gy);
      // Different floors: down from `from` first if it's an upper floor, else up to `to`.
      const goingUp = !from;
      const level = goingUp ? to : from;
      const candidates = FLOOR_PLAN_PORTALS.filter((p) => p.open && p.level === level).map((p) => {
        const near = goingUp ? p.bottom : p.top, far = goingUp ? p.top : p.bottom;
        return { p, near, cost: Math.hypot(near.x - sx, near.z - sz) + Math.hypot(far.x - gx, far.z - gz) };
      }).sort((a, b) => a.cost - b.cost);
      for (const { p, near } of candidates.slice(0, 2)) {
        const leg = Math.hypot(near.x - sx, near.z - sz) < 1.2 ? [] : findPathLocal(sx, sz, near.x, near.z, from, sy, near.y);
        if (!leg) continue;
        const end = leg.length ? leg[leg.length - 1] : { x: sx, z: sz };
        if (Math.hypot(end.x - near.x, end.z - near.z) > 2.5) continue; // didn't reach the stair
        const stair = (goingUp ? p.line : p.line.slice().reverse()).slice(1);
        const path = [...leg, ...stair.map((q) => ({ x: q.x, z: q.z }))];
        path.stairFrom = leg.length;
        return path;
      }
      return null;
    }

    function findPathLocal(sx, sz, gx, gz, level = null, sy, gy) {
      const cellHeight = level ? (cx, cz) => navLevelCellHeight(cx, cz, level) : navCellHeight;
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
      const start = nearestWalkableCell(scx, scz, inWindow, cellHeight, sy) || nearestWalkableCell(scx, scz, inWindow, cellHeight);
      let goal = (span <= half * 2 && nearestWalkableCell(gcx, gcz, inWindow, cellHeight, gy)) || nearestWalkableCell(gcx, gcz, inWindow, cellHeight);
      // Goal inside a building (e.g. a far goal pulled in along the line):
      // back off toward the start until there's somewhere to stand.
      for (let k = 1; !goal && k <= 12; k++) {
        const t = 1 - k / 12;
        goal = nearestWalkableCell(scx + Math.round((gcx - scx) * t), scz + Math.round((gcz - scz) * t), inWindow, cellHeight);
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
          const hc = cellHeight(cx, cz);
          if (!navStepOk(hc, cellHeight(cx + dx, cz + dz))) continue;
          if (dx !== 0 && dz !== 0 && (!navStepOk(hc, cellHeight(cx + dx, cz)) || !navStepOk(hc, cellHeight(cx, cz + dz)))) continue;
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
    // views (optional): which way each viewer faces -- see vehicle-models.js.
    function updateVisibility(viewers, views) {
      for (const zone of zones) {
        let distance = Infinity;
        for (const v of viewers) distance = Math.min(distance, distanceToZone(zone, v.x, v.z));
        for (const mesh of zone.meshes) mesh.visible = distance <= RENDER_DISTANCE;
        for (const mesh of zone.treeMeshes) mesh.visible = distance <= TREE_DRAW_DISTANCE;
      }
      // Decal blocks (~160 m): drawn only near a viewer.
      const decalReach = (ENV.DECAL_DRAW_DISTANCE ?? 140) + 283; // + the block's half-diagonal
      for (const d of decalGroups) {
        let near = false;
        for (const v of viewers) if ((v.x - d.cx) ** 2 + (v.z - d.cz) ** 2 < decalReach * decalReach) { near = true; break; }
        d.mesh.visible = near;
      }
      // Window blocks: nothing past the fog is worth drawing.
      const windowReach = 130 + 283;
      for (const w of windowGroups) {
        let near = false;
        for (const v of viewers) if ((v.x - w.cx) ** 2 + (v.z - w.cz) ** 2 < windowReach * windowReach) { near = true; break; }
        w.mesh.visible = near;
      }
      if (treeSystem) treeSystem.updateVisibility(viewers);
      if (grassSystem) grassSystem.updateVisibility(viewers);
      if (vehicleSystem) vehicleSystem.update(viewers, views);
    }

    // 3D grass on the lawns (grass-system.js), chunked around the viewers
    // like the trees; where it grows comes from grassTesterForArea.
    const grassSystem = window.createGrassSystem
      ? window.createGrassSystem(THREE, root, environment, {
        testerForArea: grassTesterForArea,
        // detail plants: shrubs go along walls (see grass-system.js)
        nearBuilding: (x, z) => distanceToNearestBuilding(x, z, 3) < 2.2,
      })
      : null;

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
      navLevelAt: (x, z, y) => { const l = navLevelAt(x, z, y); return l ? l.key : null; },
      isOnStairPortal: (x, z, y) => !!navPortalUnder(x, z, y),
      stairPortals: FLOOR_PLAN_PORTALS, // (debug: each portal's walking line)
      navCellHeightAt: (x, z, y) => { // (debug) the nav grid's stand height for (x, z): ground grid, or the floor at y
        const level = navLevelAt(x, z, y);
        const cx = Math.floor(x / NAV_CELL_M), cz = Math.floor(z / NAV_CELL_M);
        const h = level ? navLevelCellHeight(cx, cz, level) : navCellHeight(cx, cz);
        return h === NAV_BLOCKED ? null : h;
      },
      distanceToNearestBuilding,
      isInsideHollowBuilding,
      surfaceAt,
      grassTesterForArea,
      spotsBehindBuildings,
      enclosureMask,
      isSameFenceSide,
      findPath,
      navChunkCount: () => navChunks.size,
      updateVisibility,
      distanceToZone,
      environment,
      treeDensityNear: (x, z, r) => (treeSystem ? treeSystem.treeDensityNear(x, z, r) : 0),
      treeStats: () => (treeSystem ? treeSystem.stats() : null),
      grassStats: () => (grassSystem ? grassSystem.stats() : null),
      vehicleStats: () => (vehicleSystem ? vehicleSystem.stats() : null),
      // Ground layers the weather darkens when wet (asphalt most, grass least).
      wetSurfaces: [
        { material: roadMaterial, darken: 0.38 },
        { material: oneWayRoadMaterial, darken: 0.38 },
        { material: plainAsphaltMaterial, darken: 0.38 },
        { material: lotMaterial, darken: 0.34 },
        { material: concreteMaterial, darken: 0.3 },
        { material: curbFaceMaterial, darken: 0.3 },
        { material: trackMaterial, darken: 0.28 },
        { material: dirtMaterial, darken: 0.32 },
        { material: laneLineMaterial, darken: 0.18 },
        { material: grassMaterial, darken: 0.16 },
        ...(grassSystem ? grassSystem.materials.map((material) => ({ material, darken: 0.16 })) : []),
        { material: turfMaterial, darken: 0.14 },
        { material: soccerMaterial, darken: 0.14 },
      ],
    };

  }

  window.buildCampusWorld = buildCampusWorld;
})();
