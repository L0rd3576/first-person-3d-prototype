// Map 2 -- "Residential": the 4th Ave S & 11th St S intersection and the
// houses around it, a small PVP-only arena. Traced from the aerial
// "5 nights at kise/making the second map/topdownview.png" (640 x 590 px;
// every [x1, y1, x2, y2] below is in those pixels) and the ground-level
// "streetview1.png". See MAP2_PLAN.md / MAP2_SPEC.md / MAP2_NOTES.md.
//
// window.buildMap2World(THREE, scene, renderer, options) returns the same
// shape of object as buildCampusWorld (campus-world.js), so index.html can
// treat either one as its `currentWorld`. Colliders, line of sight and
// raycasts come from world-queries.js; the ROAD CLOSED / SIDEWALK CLOSED
// barricades are the campus's own builder (window.campusKit).
(function () {
  "use strict";

  const MAP2_SCALE_MULT = 1.25;                      // streets / sidewalks / lots vs campus widths
  const CAMPUS_ROAD_M = 17 * 0.66;                   // campus ROAD_WIDTH_PX * MAP_SCALE: 11.22 m curb to curb
  const MAP2_ROAD_PX = 71;                           // 11th St S curb to curb in topdownview.png
  const MAP2_BASE_M_PER_PX = CAMPUS_ROAD_M * MAP2_SCALE_MULT / MAP2_ROAD_PX;  // 0.1975 m per image px: the street scale
  const MAP2_LOT_SCALE = 1.12;                       // houses, lots, yards, trees: this much bigger than the street scale
  const MAP2_M_PER_PX = MAP2_BASE_M_PER_PX * MAP2_LOT_SCALE;  // metres per image px for everything off the street
  const MAP2_ORIGIN_PX = { x: 177.5, y: 411 };       // centre of the 11th St / 4th Ave intersection
  const BARRIER_HEIGHT_M = 200;
  const MAP2_FINAL_ZONE_SCALE = 1.15;               // final storm circle vs the pink circle's radius on the annotation image

  // The street band (road + boulevard strip + sidewalks, as px offsets from each street's centre line) keeps the base
  // scale, so the streets are exactly as wide as before; everything farther out is scaled by MAP2_LOT_SCALE.
  const WARP_X = { neg: 65.5, pos: 70.5 };   // 11th St S: west sidewalk outer edge x 112, east x 248
  const WARP_Z = { neg: 81, pos: 87 };       // 4th Ave S: north sidewalk outer edge y 330, south y 498
  function warpAxis(u, band) {
    const edge = u >= 0 ? band.pos : band.neg, a = Math.abs(u);
    const m = MAP2_BASE_M_PER_PX * (Math.min(a, edge) + MAP2_LOT_SCALE * Math.max(0, a - edge));
    return u >= 0 ? m : -m;
  }
  function unwarpAxis(w, band) {
    const edge = w >= 0 ? band.pos : band.neg, a = Math.abs(w) / MAP2_BASE_M_PER_PX;
    const u = a <= edge ? a : edge + (a - edge) / MAP2_LOT_SCALE;
    return w >= 0 ? u : -u;
  }
  function mapToWorld(px, py) {
    return { x: warpAxis(px - MAP2_ORIGIN_PX.x, WARP_X), z: warpAxis(py - MAP2_ORIGIN_PX.y, WARP_Z) };
  }
  const pxOfWorld = (x, z) => ({ x: unwarpAxis(x, WARP_X) + MAP2_ORIGIN_PX.x, y: unwarpAxis(z, WARP_Z) + MAP2_ORIGIN_PX.y });
  const inRect = (px, py, r) => px >= r[0] && px <= r[2] && py >= r[1] && py <= r[3];

  // ---- layout, image px ------------------------------------------------
  const ROAD_11TH = [142, -300, 213, 890];
  const ROAD_4TH = [-300, 372, 940, 450];
  const ASPHALT = [ROAD_11TH, ROAD_4TH, [55, 128, 105, 195]];  // + the west parking pad
  const SIDEWALKS = [
    [112, -300, 128, 890], [232, -300, 248, 890], [-300, 330, 940, 346], [-300, 482, 940, 498],
  ];
  const DRIVEWAYS = [
    [540, 280, 556, 372], [420, 498, 445, 590], [528, 450, 555, 590],
    // aprons across the boulevards where a drive meets the road
    [420, 450, 445, 498], [540, 346, 556, 372],
    [300, 98, 428, 122],   // back alley: east from 320/1104's drive, north of the orange garage, ending at the door apron of the purple garage
  ];
  // Access driveway off 11th St S (secondalleywayview.png): a narrow dark lane tilted north-east along the grass strip, parked-car
  // side, leading past the orange garage's north-west corner to the back alley, and a wide light apron in front of the garage's
  // door whose south edge leaves a grass wedge along the tall fence. Quads [TL, TR, BR, BL] (vertical ends), px; they cross the
  // boulevard and the sidewalk and count as concrete. The lane is drawn darker.
  const LANE_Q = [[213, 133.5], [300, 114.1], [300, 130.1], [213, 149.6]];
  const APRON_Q = [[213, 149.6], [300, 130.1], [300, 180], [213, 172]];
  const DRIVE_QUADS = [LANE_Q, APRON_Q];
  const FRONT_WALKS = [[325, 272, 333, 338], [493, 275, 500, 338], [85, 240, 112, 247], [330, 338, 338, 346]];
  // curved concrete footpaths (flat, walkable, no collider): [px width, [px points...]]. 1108's walk leaves the front
  // sidewalk, bends up to its front step; a narrow branch peels off west along the front wall and curls up the west side.
  const FOOTPATHS = [
    [6.8, [[394.8, 331], [396.2, 326], [401.4, 314.4], [404.5, 305.6], [409.3, 296.8], [413.8, 289.6], [415.5, 285]]],
    [4.6, [[409.8, 291.2], [402.3, 287.9], [393.4, 284.0], [383.7, 280.0], [378.9, 275.6], [377.1, 270.7]]],
  ];
  // Sealed yard (west fence x 247.5 .. orange garage east wall x 357, y 181.9 .. 1104's front line 269.2): spawns, respawns
  // and pickups never use it. The fences and walls above make it physically unreachable too.
  const EXCLUSION_PX = [[246, 181, 358, 269.2]];
  const PLAYABLE_PX = [[36, 98], [302, 98], [302, 8], [634, 8], [634, 584], [250, 584], [250, 535], [36, 535]];

  // ORANGE: ROAD CLOSED rows [px, py, axis, widthPx, options]; PURPLE: the
  // SIDEWALK CLOSED spots next to each (two per row).
  const CLOSURES = [
    [177.5, 98, "x", 71, { barrier: false, swWidthScale: MAP2_SCALE_MULT, sidewalks: [[120, 98], [240, 96]] }],
    [50, 411, "z", 78, { barrier: false, swWidthScale: MAP2_SCALE_MULT, sidewalks: [[54, 338], [52, 490]] }],
    [177.5, 535, "x", 71, { barrier: false, swWidthScale: MAP2_SCALE_MULT, sidewalks: [[118, 533], [238, 528]] }],
    [619, 411, "z", 78, { barrier: false, swWidthScale: MAP2_SCALE_MULT, sidewalks: [[604, 338], [608, 490]] }],
  ];

  // [name, px rect, front side (toward the street), options]
  // form: "gable-ns"/"gable-ew" (ridge direction) or "hip"; storeys 1 / 1.5 / 2.
  // Options: wallH (eave height, m), pitch (roof tan), height (garages: eave height + single window row),
  // noSides ("NE": no windows on those faces, they are shared walls), ceilH (hollow houses: interior ceiling).
  // 1104 / 1114 / the garages are traced from 'topdowncloseup.png' (coloured outlines), registered onto topdownview.png
  // px with one isotropic scale (closeup px = 2.83 x topdown px, closeup (60,60) = topdown (225.6,114.8), NCC 0.935).
  const TALL_H = 5.4, LOW_H = 3.0, TALL_PITCH = 0.55;
  const HOLLOW_EAVE_H = 3.9, HOLLOW_CEIL_H = 3.7; // hollow buildings: the ceiling clears a full jump (floor 0.34 + 1.85 body + 1.36 apex); eaves sit just above it
  const ROOF_STEP_M = 0.38; // roof colliders are stairs: each step is lower than the 0.5 m step-up, so a roof can be walked
  // Basements under 1108 and 1114 (the same footprint as their ground floors), a dirt tunnel between them, and the
  // stairs down. STAIRS px are the stairwell openings in the ground floor (annotated blue outlines on topdowncloseup.png);
  // the stair keeps going under the floor slab until it reaches the basement floor. top = the end that is level with the
  // ground floor (the stair descends away from it).
  const BASEMENT_DEPTH = 2.6, STAIR_SLOPE = 0.68, STAIR_LANDING = 0.45, TUNNEL_H = 2.4; // STAIR_LANDING: the flat 0.45 m at the top, so the floor does not step down while the body's circle is still over the slab
  const BASEMENT_WALL_COLOR = 0x8a8c8e, BASEMENT_FLOOR_COLOR = 0x5b5d60, BASEMENT_CEIL_COLOR = 0xd9d5c9, DIRT_COLOR = 0x6e5136, DIRT_DARK = 0x5a4029;
  const TUNNEL_PX = [450, 239.5, 466.4, 248.0]; // the red line between the houses: 1108's east wall to 1114's west wing
  const STAIRS = [
    { region: "h1108", px: [390.6, 239.5, 409.6, 250.8], top: "W" }, // beside 1108's new west doorway, descends east toward the tunnel
    { region: "h1114", px: [508, 237.0, 527, 246.6], top: "E" },     // beside the back door, descends west toward the tunnel
  ];
  const GARAGE_DOOR_H = 2.4;   // sectional garage door height; 'h' of its opening = how far it is raised (80% / 85% open)
  const HOUSES = [
    // 1104 (black outline): L-shaped, 2 storeys for the back block and the east wing, 1 storey for the front-west
    // wing (L1) and the porch wing (L2, carries the door); the notch at the front-left is open yard.
    ["1104", [300, 195.5, 361.6, 245.5], "S", { wallH: TALL_H, storeys: 2, pitch: TALL_PITCH, form: "gable-ew", wall: 0xd8d1bc, roof: 0x55585c, nodoor: true, noSides: "S" }],
    ["1104e", [340, 245.5, 361.6, 268.5], "S", { wallH: TALL_H, storeys: 2, pitch: TALL_PITCH, form: "gable-ns", wall: 0xd8d1bc, roof: 0x4d5054, nodoor: true, noSides: "NW" }],
    ["1104w", [300, 245.5, 340, 259.5], "W", { wallH: LOW_H, storeys: 1, pitch: TALL_PITCH, form: "gable-ew", wall: 0xd8d1bc, roof: 0x45484c, nodoor: true, noSides: "NES" }],
    ["1104p", [317.1, 259.5, 340, 268.5], "S", { wallH: LOW_H, storeys: 1, pitch: TALL_PITCH, form: "gable-ew", wall: 0xd8d1bc, roof: 0x45484c, porch: "deck", number: "1104", noSides: "NE" }],
    ["1108", [383, 210, 450, 275], "S", { region: "h1108", floorY: 0.34, openings: [{ door: true, face: "S", w: 1.4, h: 2.2 }, { px: [380.8, 240.9, 385.6, 250.1], h: 2.2, jambs: true, face: "W" }], steps: [{ px: [383, 245.5], face: "W" }], wallH: HOLLOW_EAVE_H, ceilH: HOLLOW_CEIL_H, storeys: 1, form: "gable-ew", wall: 0xe3d6a8, roof: 0x8a7c6c, porch: "stoop", number: "1108", hollow: true }],
    // 1114 (pink outline): L-shaped, 2 storeys outside, only the main floor (H) is hollow; the east wing (E1) is
    // 1 storey; the yellow garage shares the wall at H's north-east corner but has no way in.
    ["1114", [489.2, 209.5, 527.5, 272.4], "S", { region: "h1114", floorY: 0.34, openings: [{ door: true, face: "S", w: 1.4, h: 2.2 }], wallH: TALL_H, ceilH: HOLLOW_CEIL_H, storeys: 2, pitch: TALL_PITCH, form: "gable-ns", wall: 0xf1f1ee, roof: 0x7a5a48, porch: "stoop", number: "1114", chimney: [-0.2, -0.1], shutters: true, hollow: true, doorU: -2.38, noSides: "WE" }],
    ["1114w", [466.4, 209.5, 489.2, 265.9], "S", { region: "h1114", floorY: 0.34, ceilH: HOLLOW_CEIL_H, wallH: TALL_H, storeys: 2, pitch: TALL_PITCH, form: "gable-ns", wall: 0xf1f1ee, roof: 0x6f5042, nodoor: true, noSides: "E" }],
    ["1114e", [527.5, 237.1, 540.4, 272.4], "S", { region: "h1114", floorY: 0.34, ceilH: HOLLOW_CEIL_H, openings: [{ px: [531, 234.5, 537.2, 239.8], h: 2.2, jambs: true, face: "N" }], steps: [{ px: [534.1, 237.1], face: "N" }], wallH: HOLLOW_EAVE_H, storeys: 1, pitch: TALL_PITCH, form: "gable-ns", wall: 0xf1f1ee, roof: 0x7a5a48, nodoor: true, noSides: "WN" }],
    ["1118", [595, 195, 640, 268], "S", { storeys: 2, form: "gable-ns", wall: 0xecebe6, roof: 0x7d8186, porch: "porch", number: "1118" }],
    ["1118w", [570, 175, 630, 195], "S", { storeys: 1, form: "gable-ew", wall: 0xecebe6, roof: 0x6a6e73, nodoor: true }],
    ["320", [302, 15, 372, 97], "W", { storeys: 1.5, form: "hip", wall: 0xbfa886, roof: 0x5b4e44, porch: "stoop", number: "320" }],
    ["321", [38, 205, 85, 262], "E", { storeys: 1, form: "gable-ns", wall: 0xeeede8, roof: 0x6c7886, porch: "stoop", number: "321" }],
    ["1101", [272, 522, 338, 590], "N", { storeys: 1, form: "gable-ew", wall: 0xe8dfc4, roof: 0x70757b, porch: "stoop", number: "1101" }],
    ["1109", [355, 522, 415, 590], "N", { storeys: 1, form: "gable-ew", wall: 0xb9bcbf, roof: 0x5b4a40, porch: "stoop", number: "1109", chimney: [-0.25, 0.1] }],
    ["1105", [462, 528, 528, 590], "N", { storeys: 1.5, form: "gable-ns", wall: 0xf1f1ee, roof: 0x9a3b33, porch: "stoop", number: "1105" }],
    ["1115", [565, 530, 620, 590], "N", { storeys: 1, form: "gable-ew", wall: 0xcfd2d4, roof: 0x73777c, porch: "stoop", number: "1115" }],
    ["garageW", [40, 115, 62, 137], "E", { height: 3.4, form: "gable-ew", wall: 0xf0efea, roof: 0x4a4d52, nodoor: true }],
    // solid 1-storey garages (no way in): ORANGE behind 1104 (door on the west face, onto the yellow car's drive),
    // PURPLE in 1108's back yard (door on the north face, at the end of the back alley), YELLOW on 1114's NE corner
    ["garageE", [298.7, 130.9, 357, 182.5], "W", { height: 2.7, pitch: 0.3, form: "gable-ew", wall: 0x8d968a, roof: 0x60666c, nodoor: true, garageDoor: true, garageDoorW: 7.2, doorU: -0.4 }],
    ["garageP", [392.9, 121.9, 440.1, 164.8], "W", { height: HOLLOW_EAVE_H, ceilH: HOLLOW_CEIL_H, pitch: 0.3, form: "hip", wall: 0xc9c2ae, roof: 0x4a4d52, nodoor: true, garageDoor: true, region: "garageP", openings: [{ px: [390, 127.9, 397, 160.7], h: GARAGE_DOOR_H * 0.8, leaf: true, face: "W" }] }],
    ["garageY", [526.8, 182.5, 557.6, 224.5], "S", { height: HOLLOW_EAVE_H, ceilH: HOLLOW_CEIL_H, pitch: 0.3, form: "gable-ns", wall: 0xe2dccb, roof: 0x6b5f52, nodoor: true, garageDoor: true, noSides: "W", region: "garageY", openings: [{ px: [534.8, 221, 554.6, 227], h: GARAGE_DOOR_H * 0.85, leaf: true, face: "S" }, { px: [524, 196.8, 531, 207.4], h: 2.1, face: "W" }] }],
    ["garageN", [455, 5, 480, 35], "S", { height: 3.4, form: "gable-ew", wall: 0xb9bcbf, roof: 0x4a4d52, nodoor: true }],
    ["houseNE", [618, 20, 640, 70], "W", { storeys: 1, form: "gable-ns", wall: 0xaeb2b5, roof: 0x6d7176, nodoor: true }],
    // backdrop: outside the playable polygon, drawn but not solid
    ["311", [0, 15, 75, 75], "E", { storeys: 1.5, form: "gable-ns", wall: 0xcdb892, roof: 0x5a3c36, backdrop: true, nodoor: true }],
    ["church", [-60, 512, 50, 590], "E", { storeys: 2, form: "gable-ew", wall: 0x8c5a44, roof: 0x5e4a40, backdrop: true, nodoor: true }],
  ];

  // [px, py, canopy radius px, flowering]
  const TREES = [
    [222, 285, 48], [455, 192, 45], [470, 100, 45], [366, 147, 27], [530, 30, 40], [600, 30, 35],
    [603, 118, 35], [405, 70, 30], [68, 292, 28], [72, 352, 30, true], [262, 103, 24], [576, 214, 22],
    [572, 272, 20], [630, 300, 22], [310, 462, 28, true], [255, 508, 30], [597, 462, 25], [630, 522, 20],
    [18, 112, 30], [15, 280, 25], [182, 80, 22],
  ];

  // [px, py, heading] -- campus convention: 0 = +x east, PI/2 = +z south
  const CARS = [
    [440, 383, Math.PI], [585, 383, Math.PI], [82, 137, Math.PI], [80, 157, Math.PI], [72, 180, Math.PI],
    [274, 144, 0, { paint: 0xe3b81c, model: "hatchback" }], [240, 134.5, -0.22, { paint: 0x23262d, model: "midsizeSedan" }], [548, 298, -Math.PI / 2], [548, 322, -Math.PI / 2], [540, 560, Math.PI / 2], [151, 250, Math.PI / 2],
  ];

  // [px, py, yaw] -- the red dot (S1) faces north-northeast like the streetview
  const SPAWNS_PX = [
    [432, 408, -0.11], [100, 300, -Math.PI / 2], [520, 140, Math.PI], [460, 510, 0],
    [80, 470, -Math.PI / 4], [600, 290, Math.PI / 2], [372, 300, Math.PI], [300, 500, -Math.PI / 4],
  ];

  function buildMap2World(THREE, scene, renderer, options = {}) {
    const root = new THREE.Group();
    root.name = "Map2World";
    scene.add(root);
    const TREE_DRAW_DISTANCE = options.treeDrawDistance !== undefined ? options.treeDrawDistance : 260;
    const STEP_UP_M = options.stepUpHeight !== undefined ? options.stepUpHeight : 0.5;
    const environment = {
      envTime: { value: 0 },
      windDir: { value: new THREE.Vector2(1, 0) },
      windStrength: { value: 0 },
      windGust: { value: 0 },
      heatHaze: { value: 0 },
      hazeColor: { value: new THREE.Color(0xc9d6e0) },
      hazeNear: { value: 18 },
      hazeFar: { value: 95 },
      nightLights: { value: 0 },
      grassPushers: { value: Array.from({ length: 8 }, () => new THREE.Vector4(0, 0, 1, 0)) },
      grassPushBox: { value: new THREE.Vector4(1e6, 1e6, -1e6, -1e6) },
    };

    const { makeCollider, makeCylinderCollider } = window.worldColliderKit;
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
    function seededRandom(seed) {
      let t = seed >>> 0;
      return () => {
        t += 0x6d2b79f5;
        let r = Math.imul(t ^ (t >>> 15), 1 | t);
        r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
        return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
      };
    }
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

    // ---- bounds, playable polygon ------------------------------------
    const polygon = PLAYABLE_PX.map(([x, y]) => mapToWorld(x, y));
    const bounds = {
      minX: Math.min(...polygon.map((p) => p.x)), maxX: Math.max(...polygon.map((p) => p.x)),
      minZ: Math.min(...polygon.map((p) => p.z)), maxZ: Math.max(...polygon.map((p) => p.z)),
    };
    const mapCenter = { x: (bounds.minX + bounds.maxX) / 2, z: (bounds.minZ + bounds.maxZ) / 2 };
    // signed distance to the polygon boundary: positive inside
    function polygonSignedDistance(x, z) {
      let inside = false, best = Infinity;
      for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const a = polygon[j], b = polygon[i];
        if ((a.z > z) !== (b.z > z) && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
        const dx = b.x - a.x, dz = b.z - a.z;
        const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz)));
        best = Math.min(best, Math.hypot(x - (a.x + dx * t), z - (a.z + dz * t)));
      }
      return inside ? best : -best;
    }
    const insidePlayableEdge = (x, z, margin = 0) => polygonSignedDistance(x, z) >= margin;

    const colliders = [];
    const addCollider = (c) => { colliders.push(c); return c; };

    // ---- ground: merged flat layers, one mesh per material -------------
    const grassTexture = canvasTexture(128, 128, (ctx, w, h) => speckle(ctx, w, h, "#6b9a46", 2400, 0.12, 21));
    const asphaltTexture = canvasTexture(128, 128, (ctx, w, h) => speckle(ctx, w, h, "#55565a", 3200, 0.16, 22));
    const concreteTexture = canvasTexture(64, 64, (ctx, w, h) => {
      speckle(ctx, w, h, "#cfccc4", 500, 0.1, 23);
      ctx.fillStyle = "rgba(0,0,0,0.22)";
      ctx.fillRect(0, 0, 1, h);
      ctx.fillRect(0, 0, w, 1);
    });
    const grassMaterial = new THREE.MeshLambertMaterial({ map: grassTexture });
    const asphaltMaterial = new THREE.MeshLambertMaterial({ map: asphaltTexture });
    const concreteMaterial = new THREE.MeshLambertMaterial({ map: concreteTexture });
    const paintMaterial = new THREE.MeshLambertMaterial({ color: 0xe8e8e4 });
    const yellowPaintMaterial = new THREE.MeshLambertMaterial({ color: 0xd8b83a });
    const curbMaterial = new THREE.MeshLambertMaterial({ color: 0xcfccc4 });

    function mergedPlanes(rectsWorld, y, tile, material, renderOrder) {
      const pos = [], uv = [], idx = [];
      for (const [x1, z1, x2, z2] of rectsWorld) {
        const base = pos.length / 3;
        pos.push(x1, y, z1, x2, y, z1, x2, y, z2, x1, y, z2);
        uv.push(x1 / tile, z1 / tile, x2 / tile, z1 / tile, x2 / tile, z2 / tile, x1 / tile, z2 / tile);
        idx.push(base, base + 2, base + 1, base, base + 3, base + 2); // faces up
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx);
      g.computeVertexNormals();
      const mesh = new THREE.Mesh(g, material);
      mesh.frustumCulled = false;
      mesh.renderOrder = renderOrder || 0;
      root.add(mesh);
      return mesh;
    }
    const worldRect = (r) => { const a = mapToWorld(r[0], r[1]), b = mapToWorld(r[2], r[3]); return [a.x, a.z, b.x, b.z]; };

    {
      // the lawn plane, minus the stairwell openings (so you can see down them)
      let rects = [[-400, -400, 400, 400]];
      for (const st of STAIRS) {
        const a = mapToWorld(st.px[0], st.px[1]), b = mapToWorld(st.px[2], st.px[3]);
        const h = [Math.min(a.x, b.x), Math.min(a.z, b.z), Math.max(a.x, b.x), Math.max(a.z, b.z)], next = [];
        for (const r of rects) {
          if (h[2] <= r[0] || h[0] >= r[2] || h[3] <= r[1] || h[1] >= r[3]) { next.push(r); continue; }
          if (h[0] > r[0]) next.push([r[0], r[1], h[0], r[3]]);
          if (h[2] < r[2]) next.push([h[2], r[1], r[2], r[3]]);
          const mx0 = Math.max(h[0], r[0]), mx1 = Math.min(h[2], r[2]);
          if (h[1] > r[1]) next.push([mx0, r[1], mx1, h[1]]);
          if (h[3] < r[3]) next.push([mx0, h[3], mx1, r[3]]);
        }
        rects = next;
      }
      mergedPlanes(rects, 0, 6, grassMaterial);
    }
    mergedPlanes(SIDEWALKS.map(worldRect).concat(DRIVEWAYS.map(worldRect), FRONT_WALKS.map(worldRect)), 0.012, 1.5, concreteMaterial);
    mergedPlanes(ASPHALT.map(worldRect), 0.024, 6, asphaltMaterial);
    {
      // the access drive: convex quads, one concrete mesh; the lane gets a darker weathered overlay except where the sidewalk crosses it
      const quadY = (q, x) => { const k = (x - q[0][0]) / (q[1][0] - q[0][0]); return [q[0][1] + (q[1][1] - q[0][1]) * k, q[3][1] + (q[2][1] - q[3][1]) * k]; };
      const clipQuad = (q, x0, x1) => { const a = quadY(q, x0), b = quadY(q, x1); return [[x0, a[0]], [x1, b[0]], [x1, b[1]], [x0, a[1]]]; };
      const quadMesh = (quads, y, material) => {
        const pos = [], uv = [], idx = [];
        for (const q of quads) {
          const base = pos.length / 3;
          for (const [px, py] of q) { const w = mapToWorld(px, py); pos.push(w.x, y, w.z); uv.push(w.x / 1.5, w.z / 1.5); }
          idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
        g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
        g.setIndex(idx);
        g.computeVertexNormals();
        const mesh = new THREE.Mesh(g, material);
        mesh.frustumCulled = false;
        root.add(mesh);
      };
      quadMesh(DRIVE_QUADS, 0.012, concreteMaterial);
      quadMesh([clipQuad(LANE_Q, 213, 232), clipQuad(LANE_Q, 248, 300)], 0.016, new THREE.MeshLambertMaterial({ map: concreteTexture, color: 0x8c8a86 }));
    }
    // curved footpaths: one flat ribbon per path (concrete texture, no collider, so they are just ground)
    const footpaths = FOOTPATHS.map(([wPx, pts]) => ({ half: (wPx * MAP2_M_PER_PX) / 2, pts: pts.map(([x, y]) => mapToWorld(x, y)) }));
    {
      const pos = [], uv = [], idx = [], tile = 1.5, y = 0.016;
      for (const { half, pts } of footpaths) {
        const base = pos.length / 3;
        pts.forEach((p, i) => {
          const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
          let tx = b.x - a.x, tz = b.z - a.z; const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
          const w = half * (1 - 0.25 * (i / (pts.length - 1))) * (i === 0 ? 1.25 : 1); // flares slightly where it meets the sidewalk
          for (const k of [-1, 1]) { const x = p.x - tz * w * k, z = p.z + tx * w * k; pos.push(x, y, z); uv.push(x / tile, z / tile); }
        });
        for (let i = 0; i < pts.length - 1; i++) { const q = base + i * 2; idx.push(q, q + 1, q + 3, q, q + 3, q + 2); }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx);
      g.computeVertexNormals();
      for (let i = 0; i < g.attributes.normal.count; i++) if (g.attributes.normal.getY(i) < 0) g.attributes.normal.setY(i, -g.attributes.normal.getY(i));
      const mesh = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ map: concreteTexture, side: THREE.DoubleSide }));
      mesh.frustumCulled = false;
      root.add(mesh);
    }
    {
      // paint: crosswalk bars (west leg), stop bar (east leg), dashed centre lines
      const paint = [];
      for (let y = 377; y <= 437; y += 9) paint.push([110, y, 128, y + 4]);
      paint.push([255, 372, 258, 411]);
      mergedPlanes(paint.map(worldRect), 0.036, 1, paintMaterial);
      const dashes = [];
      const centerX = mapToWorld(177.5, 0).x, centerZ = 0;
      for (let z = -100; z < 60; z += 9) if (Math.abs(z) > 9) dashes.push([centerX - 0.07, z, centerX + 0.07, z + 3]);
      for (let x = -60; x < 110; x += 9) if (Math.abs(x) > 9) dashes.push([x, centerZ - 0.07, x + 3, centerZ + 0.07]);
      mergedPlanes(dashes, 0.036, 1, yellowPaintMaterial);
    }

    // ---- instanced box props ------------------------------------------
    const unitBox = new THREE.BoxGeometry(1, 1, 1);
    const propMaterial = new THREE.MeshLambertMaterial({ color: 0xffffff });
    const sidingTexture = canvasTexture(8, 32, (ctx, w, h) => {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "rgba(0,0,0,0.13)";
      for (let y = 0; y < h; y += 4) ctx.fillRect(0, y, w, 1);
    });
    const sidingMaterial = new THREE.MeshLambertMaterial({ color: 0xffffff, map: sidingTexture });
    const lists = { prop: [], siding: [], gable: [], hip: [], gableEnd: [], interior: [] };
    const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpS = new THREE.Vector3(), tmpP = new THREE.Vector3();
    const yUp = new THREE.Vector3(0, 1, 0);
    const color = new THREE.Color();
    function put(list, x, y, z, sx, sy, sz, yaw, hex) {
      tmpQ.setFromAxisAngle(yUp, yaw || 0);
      tmpM.compose(tmpP.set(x, y, z), tmpQ, tmpS.set(sx, sy, sz));
      lists[list].push({ m: tmpM.clone(), c: new THREE.Color(hex) });
    }
    const box = (x, y0, z, sx, sy, sz, yaw, hex) => put("prop", x, y0 + sy / 2, z, sx, sy, sz, yaw, hex); // y0 = bottom

    // gable prism: ridge along x, eaves at y 0, ridge at y 1, span along z
    const gableGeo = (() => {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute([
        -0.5, 0, -0.5, 0.5, 0, -0.5, 0.5, 1, 0, -0.5, 1, 0,   // north slope
        -0.5, 0, 0.5, 0.5, 0, 0.5, 0.5, 1, 0, -0.5, 1, 0,     // south slope
      ], 3));
      g.setIndex([0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7]);
      g.computeVertexNormals();
      return g;
    })();
    const gableEndGeo = (() => {
      const g = new THREE.BufferGeometry();
      // triangles at x = -0.5 and +0.5 spanning z -0.5..0.5, apex at y 1
      g.setAttribute("position", new THREE.Float32BufferAttribute([
        -0.5, 0, -0.5, -0.5, 0, 0.5, -0.5, 1, 0,
        0.5, 0, -0.5, 0.5, 1, 0, 0.5, 0, 0.5,
      ], 3));
      g.setIndex([0, 1, 2, 3, 4, 5]);
      g.computeVertexNormals();
      return g;
    })();
    const hipGeo = (() => {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute([
        -0.5, 0, -0.5, 0.5, 0, -0.5, 0, 1, 0,
        0.5, 0, -0.5, 0.5, 0, 0.5, 0, 1, 0,
        0.5, 0, 0.5, -0.5, 0, 0.5, 0, 1, 0,
        -0.5, 0, 0.5, -0.5, 0, -0.5, 0, 1, 0,
      ], 3));
      g.setIndex([0, 2, 1, 3, 5, 4, 6, 8, 7, 9, 11, 10].map((v) => v));
      g.computeVertexNormals();
      return g;
    })();
    // hollow-house interiors: a little emissive so the rooms never go pitch black under the shadowless map lighting
    const interiorMaterial = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x2e2a24 });
    const roofMaterial = new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide });
    const endMaterial = new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide, map: sidingTexture });

    const PITCH = Math.tan(35 * Math.PI / 180);
    const OVERHANG = 0.3;
    const FLOOR_H = 2.9;
    const houseRecords = [];
    const pits = []; // below-ground volumes: { x0,x1,z0,z1, floorAt(x,z), stair?: true, hole?: rect }
    const accessTargets = []; // buildings whose roof gets a crate staircase (see addRoofAccess)
    // A roof you can stand on: nested boxes shrinking toward the ridge, each ROOF_STEP_M higher than the one outside
    // it (so the union is a staircase that follows the slope; the step-up walks it). base = eave height, so they
    // never block anything under the roof and never show on the minimap. form: "gable-ns" | "gable-ew" | "hip".
    function addRoofColliders(cx, cz, W, D, wallH, pitch, form) {
      const ridgeNS = form === "gable-ns";
      const halfSpan = form === "hip" ? Math.min(W, D) / 2 : (ridgeNS ? W : D) / 2;
      const n = Math.max(1, Math.ceil((halfSpan * pitch) / ROOF_STEP_M));
      const stepW = halfSpan / n;
      for (let k = 0; k < n; k++) {
        const inset = k * stepW, h = wallH + pitch * (inset + stepW / 2);
        const hx = form === "hip" ? W / 2 - inset : (ridgeNS ? W / 2 - inset : W / 2);
        const hz = form === "hip" ? D / 2 - inset : (ridgeNS ? D / 2 : D / 2 - inset);
        const c = makeCollider(cx, cz, hx, hz, h, 0);
        c.base = wallH; c.style = "house"; c.roof = true;
        c.ceiling = true; // shots only: bodies use the smooth ramp below
        addCollider(c);
      }
      // the walkable surface: a continuous slope from the eave up to the ridge (hip: to the nearest edge)
      const ridgeH = wallH + pitch * halfSpan;
      const ramp = makeCollider(cx, cz, W / 2, D / 2, ridgeH, 0);
      ramp.base = wallH; ramp.style = "house"; ramp.ramp = true; ramp.bodyOnly = true; ramp.fx = "wood";
      ramp.rampHeight = (x, z) => {
        const dx = W / 2 - Math.abs(x - cx), dz = D / 2 - Math.abs(z - cz);
        const d = form === "hip" ? Math.min(dx, dz) : ridgeNS ? dx : dz;
        return wallH + pitch * Math.min(halfSpan, Math.max(0, d));
      };
      addCollider(ramp);
    }
    const plates = [];  // { text, x, y, z, yaw }

    const HOLLOW_WALL_T = 0.3, HOLLOW_DOOR_W = 1.4, HOLLOW_DOOR_H = 2.2;
    const HOLLOW_FLOOR_Y = 0.34; // = the stoop slab height, so the doorway is level
    const HOLLOW_WALL_COLOR = 0xe9e3d3, HOLLOW_FLOOR_COLOR = 0x7d6244, HOLLOW_CEIL_COLOR = 0xf1eee6;
    const FACE = { N: { x: 0, z: -1 }, S: { x: 0, z: 1 }, E: { x: 1, z: 0 }, W: { x: -1, z: 0 } };
    const WOOD = 0x8a6a4a, WHITE = 0xf4f3ee, DARK = 0x3a3d40, FOUNDATION = 0x5a5d60, BRICK = 0x8c4a3a;

    // Every solid building's volume (walls to the eave + roof), so a window can be refused where it would end up inside a
    // neighbouring wall or roof, under the building's own eave, or in a doorway.
    const houseVolumes = HOUSES.filter((h) => !h[3].backdrop).map(([nm, r, fr, op]) => {
      const a = mapToWorld(r[0], r[1]), b = mapToWorld(r[2], r[3]);
      const wH = op.wallH || op.height || (op.storeys > 1 ? 5.8 : 3.2), pt = op.pitch || PITCH;
      return { name: nm, x0: Math.min(a.x, b.x), x1: Math.max(a.x, b.x), z0: Math.min(a.z, b.z), z1: Math.max(a.z, b.z), wallH: wH, pitch: pt, form: op.form };
    });
    function volumeTopAt(v, x, z) { // height of the building's solid at a point (-Infinity outside its footprint + eave overhang)
      const dx = Math.max(v.x0 - x, x - v.x1, 0), dz = Math.max(v.z0 - z, z - v.z1, 0), out = Math.max(dx, dz);
      if (out > OVERHANG) return -Infinity;
      if (out > 0) return v.wallH - v.pitch * out;
      const cx = (v.x0 + v.x1) / 2, cz = (v.z0 + v.z1) / 2, hx = (v.x1 - v.x0) / 2 - Math.abs(x - cx), hz = (v.z1 - v.z0) / 2 - Math.abs(z - cz);
      const d = v.form === "hip" ? Math.min(hx, hz) : v.form === "gable-ns" ? hx : hz;
      const span = v.form === "hip" ? Math.min(hx + Math.abs(x - cx), hz + Math.abs(z - cz)) : v.form === "gable-ns" ? (v.x1 - v.x0) / 2 : (v.z1 - v.z0) / 2;
      return v.wallH + v.pitch * Math.min(span, Math.max(0, d));
    }
    // a window (centre on the wall face, width 1.3, rows wy..wy+wh) is fine if its corners are clear of every other building
    function windowFits(self, px, pz, n, along, wy, wh, openings) {
      if (wy + wh + 0.1 > self.wallH - 0.2) return false; // would run into its own eave / roof line
      for (const o of openings) { // a doorway on this face
        const oc = { x: (o.x0 + o.x1) / 2, z: (o.z0 + o.z1) / 2 }, ox = (o.x1 - o.x0) / 2 + 0.85, oz = (o.z1 - o.z0) / 2 + 0.85;
        if (Math.abs(px - oc.x) < ox && Math.abs(pz - oc.z) < oz && o.h > wy - 0.3) return false;
      }
      for (const v of houseVolumes) {
        if (v.name === self.name) continue;
        for (const k of [-0.75, 0, 0.75]) for (const y of [wy - 0.1, wy + wh + 0.1]) {
          const sx = px + along.x * k + n.x * 0.12, sz = pz + along.z * k + n.z * 0.12;
          if (sx > v.x0 - 0.05 && sx < v.x1 + 0.05 && sz > v.z0 - 0.05 && sz < v.z1 + 0.05 && y < volumeTopAt(v, sx, sz) + 0.05) return false;
        }
      }
      return true;
    }

    function buildHouse([name, rectPx, front, o]) {
      const a = mapToWorld(rectPx[0], rectPx[1]), b = mapToWorld(rectPx[2], rectPx[3]);
      const cx = (a.x + b.x) / 2, cz = (a.z + b.z) / 2;
      const W = Math.abs(b.x - a.x), D = Math.abs(b.z - a.z);
      const wallH = o.wallH || o.height || (o.storeys > 1 ? 5.8 : 3.2);
      const pitch = o.pitch || PITCH;
      const out = FACE[front];
      const long = Math.abs(out.x) === 1 ? D : W; // facade length of the front
      const form = o.form;
      // walls (siding), on a dark foundation band
      const hollow = !!o.hollow;
      const region = !!o.region; // walls/floor/openings are built per region by buildRegion (hollow, any footprint)
      if (!hollow && !region) {
        put("siding", cx, 0.5 + (wallH - 0.5) / 2, cz, W, wallH - 0.5, D, 0, o.wall);
        box(cx, 0, cz, W + 0.08, 0.5, D + 0.08, 0, FOUNDATION);
      }
      // roof
      const ridgeNS = form === "gable-ns";
      let roofTop = wallH;
      if (form === "hip") {
        const rise = Math.min(W, D) / 2 * pitch + 0.3;
        put("hip", cx, wallH - OVERHANG * pitch, cz, W + OVERHANG * 2, rise, D + OVERHANG * 2, 0, o.roof);
        roofTop = wallH - OVERHANG * pitch + rise;
      } else {
        const span = ridgeNS ? W : D, len = ridgeNS ? D : W;
        const rise = (span / 2 + OVERHANG) * pitch;
        const yaw = ridgeNS ? Math.PI / 2 : 0; // gable prism ridge runs along local x
        put("gable", cx, wallH - OVERHANG * pitch, cz, len + OVERHANG * 2, rise, span + OVERHANG * 2, yaw, o.roof);
        put("gableEnd", cx, wallH, cz, len, span / 2 * pitch, span, yaw, o.wall);
        roofTop = wallH - OVERHANG * pitch + rise;
        if (o.crossGable) {
          // a small gable on the front (ridge across the main ridge), centred
          const cw = o.crossGable;
          const crise = (cw / 2 + OVERHANG) * pitch;
          const depth = Math.min(span / 2, 3.2) + 0.6;
          const fx = cx + out.x * (Math.abs(out.x) ? W / 2 - depth / 2 + OVERHANG : 0), fz = cz + out.z * (Math.abs(out.z) ? D / 2 - depth / 2 + OVERHANG : 0);
          const cyaw = Math.abs(out.z) === 1 ? Math.PI / 2 : 0;
          put("gable", fx, wallH - OVERHANG * pitch + 0.08, fz, depth + OVERHANG, crise, cw + OVERHANG * 2, cyaw, o.roof);
        }
      }
      if (o.chimney) {
        const hx = cx + o.chimney[0] * W, hz = cz + o.chimney[1] * D;
        box(hx, roofTop - 1.6, hz, 0.8, 2.2, 0.8, 0, BRICK);
        box(hx, roofTop + 0.6, hz, 0.95, 0.12, 0.95, 0, 0x6b6e70);
      }
      // collider: the whole footprint, up to the ridge (hollow houses: wall ring + floor + roof slab instead)
      const record = { name, x: cx, z: cz, halfX: W / 2, halfZ: D / 2, height: roofTop, wallH, hollow: hollow || region, door: null };
      if (region) {
        const spec = regionSpecs[o.region] || (regionSpecs[o.region] = { rects: [], openings: [], steps: [] });
        spec.rects.push({ x0: cx - W / 2, z0: cz - D / 2, x1: cx + W / 2, z1: cz + D / 2, wallH, ceilH: o.ceilH || wallH, floorY: o.floorY || 0, wall: o.wall });
        for (const op of o.openings || []) if (op.door) { // a door: centred on the house's doorU, through the front wall
          const n = FACE[front], nxa = Math.abs(n.x), T = HOLLOW_WALL_T, dirv = nxa ? n.x : n.z;
          const edge = nxa ? cx + n.x * W / 2 : cz + n.z * D / 2, along = (nxa ? cz : cx) + (o.doorU || 0), w = op.w || 1.4;
          const lo = Math.min(edge - dirv * (T + 0.02), edge + dirv * 0.02), hi = Math.max(edge - dirv * (T + 0.02), edge + dirv * 0.02);
          spec.openings.push(nxa ? { x0: lo, x1: hi, z0: along - w / 2, z1: along + w / 2, h: op.h, face: front, jambs: true }
                                  : { x0: along - w / 2, x1: along + w / 2, z0: lo, z1: hi, h: op.h, face: front, jambs: true });
        }
        for (const op of (o.openings || []).filter((q) => !q.door)) {
          const p0 = mapToWorld(op.px[0], op.px[1]), p1 = mapToWorld(op.px[2], op.px[3]);
          spec.openings.push({ x0: Math.min(p0.x, p1.x), x1: Math.max(p0.x, p1.x), z0: Math.min(p0.z, p1.z), z1: Math.max(p0.z, p1.z), h: op.h, leaf: !!op.leaf, jambs: !!op.jambs, face: op.face });
        }
        for (const st of o.steps || []) spec.steps.push({ ...st, p: mapToWorld(st.px[0], st.px[1]) });
        addRoofColliders(cx, cz, W, D, wallH, pitch, form);
        accessTargets.push({ name, x: cx, z: cz, halfX: W / 2, halfZ: D / 2, wallH, front, region: o.region });
      } else if (hollow) buildHollowShell();
      else if (!o.backdrop) {
        const c = makeCollider(cx, cz, W / 2, D / 2, wallH, 0);
        c.style = "house";
        addCollider(c);
        addRoofColliders(cx, cz, W, D, wallH, pitch, form);
        accessTargets.push({ name, x: cx, z: cz, halfX: W / 2, halfZ: D / 2, wallH, front });
      }
      if (!o.backdrop) houseRecords.push(record);

      // Hollow house: a 0.3 m wall ring (front doorway left open, lintel above it), a real floor flush with the
      // stoop, a ceiling and lined interior walls. The roof is a ceiling-flagged slab (shots only, no head-bump).
      function buildHollowShell() {
        const T = HOLLOW_WALL_T, fl = HOLLOW_FLOOR_Y, DW = HOLLOW_DOOR_W, DH = HOLLOW_DOOR_H;
        const ceilH = o.ceilH || wallH; // interior ceiling; a 2-storey shell keeps its tall solid walls above it (no upstairs)
        const doorU0 = o.doorU || 0;
        function wallPiece(side, u0, u1, y0, y1) {
          const n = FACE[side], nxa = Math.abs(n.x), nza = Math.abs(n.z);
          const al = nxa ? { x: 0, z: 1 } : { x: 1, z: 0 };
          const half = nxa ? W / 2 : D / 2, um = (u0 + u1) / 2, len = u1 - u0;
          const px = cx + n.x * (half - T / 2) + al.x * um, pz = cz + n.z * (half - T / 2) + al.z * um;
          const sx = nxa * T + al.x * len, sz = nza * T + al.z * len;
          const ys = Math.max(y0, 0.5);
          if (y1 > ys) put("siding", px, (ys + y1) / 2, pz, sx, y1 - ys, sz, 0, o.wall);
          if (y0 < 0.5) box(px + n.x * 0.02, 0, pz + n.z * 0.02, sx + nxa * 0.04, Math.min(y1, 0.5), sz + nza * 0.04, 0, FOUNDATION); // proud of the outside only
          const c = makeCollider(px, pz, sx / 2, sz / 2, y1, 0);
          if (y0 > 0) c.base = y0;
          c.style = "house";
          addCollider(c);
          const yi = Math.max(y0, fl), yt = Math.min(y1, ceilH);
          if (yt > yi) put("interior", cx + n.x * (half - T - 0.02) + al.x * um, (yi + yt) / 2, cz + n.z * (half - T - 0.02) + al.z * um, nxa * 0.04 + al.x * len, yt - yi, nza * 0.04 + al.z * len, 0, HOLLOW_WALL_COLOR);
        }
        for (const side of ["N", "S", "E", "W"]) {
          const n = FACE[side], L = Math.abs(n.x) === 1 ? D - 2 * T : W;
          if (side !== front) { wallPiece(side, -L / 2, L / 2, 0, wallH); continue; }
          wallPiece(side, -L / 2, doorU0 - DW / 2, 0, wallH);   // either side of the doorway
          wallPiece(side, doorU0 + DW / 2, L / 2, 0, wallH);
          wallPiece(side, doorU0 - DW / 2, doorU0 + DW / 2, DH, wallH); // lintel (sight passes under/over it, a jump hits it)
          const al = Math.abs(n.x) === 1 ? { x: 0, z: 1 } : { x: 1, z: 0 };
          const half = Math.abs(n.x) === 1 ? W / 2 : D / 2;
          for (const k of [-1, 1]) { // white door jambs on the wall ends, proud of both faces
            const u = doorU0 + k * (DW / 2 + 0.05);
            box(cx + n.x * (half - T / 2) + al.x * u, fl, cz + n.z * (half - T / 2) + al.z * u, Math.abs(n.x) * (T + 0.06) + al.x * 0.1, DH - fl, Math.abs(n.z) * (T + 0.06) + al.z * 0.1, 0, WHITE);
          }
          // threshold through the wall thickness, flush with the stoop and the floor
          const sill = makeCollider(cx + n.x * (half - T / 2) + al.x * doorU0, cz + n.z * (half - T / 2) + al.z * doorU0, (Math.abs(n.x) * T + al.x * DW) / 2, (Math.abs(n.z) * T + al.z * DW) / 2, fl, 0);
          sill.render = false; sill.seeThrough = true; sill.fx = "wood";
          addCollider(sill);
          put("interior", cx + n.x * (half - T / 2) + al.x * doorU0, fl / 2, cz + n.z * (half - T / 2) + al.z * doorU0, Math.abs(n.x) * T + al.x * DW, fl, Math.abs(n.z) * T + al.z * DW, 0, HOLLOW_FLOOR_COLOR);
        }
        // floor + ceiling
        put("interior", cx, fl / 2, cz, W - 2 * T, fl, D - 2 * T, 0, HOLLOW_FLOOR_COLOR);
        put("interior", cx, ceilH - 0.05, cz, W - 2 * T, 0.1, D - 2 * T, 0, HOLLOW_CEIL_COLOR);
        const floor = makeCollider(cx, cz, (W - 2 * T) / 2, (D - 2 * T) / 2, fl, 0);
        floor.render = false; floor.seeThrough = true; floor.fx = "wood";
        addCollider(floor);
        // roof slab on top of the walls: solid to shots, never pushes a body under it
        if (wallH - ceilH > 0.05) { // the air between the ceiling and the eave: shots only
          const gap = makeCollider(cx, cz, W / 2, D / 2, wallH, 0);
          gap.base = ceilH; gap.ceiling = true; gap.style = "house";
          addCollider(gap);
        }
        addRoofColliders(cx, cz, W, D, wallH, pitch, form);
        accessTargets.push({ name, x: cx, z: cz, halfX: W / 2, halfZ: D / 2, wallH, front });
      }
      // windows on every facade; door + steps on the front
      const doorU = o.doorU || 0;
      for (const side of ["N", "S", "E", "W"]) {
        const n = FACE[side];
        const along = Math.abs(n.x) === 1 ? { x: 0, z: 1 } : { x: 1, z: 0 };
        const L = Math.abs(n.x) === 1 ? D : W;
        const half = Math.abs(n.x) === 1 ? W / 2 : D / 2;
        const yaw = Math.abs(n.x) === 1 ? Math.PI / 2 : 0;
        const faceYaw = Math.atan2(n.x, n.z);
        const isFront = side === front;
        if (o.noSides && o.noSides.includes(side)) continue;
        if (o.garageDoor && isFront && region) continue; // the raised door panel is drawn by buildRegion
        if (o.garageDoor && isFront) {
          // white double sectional door on the gable end, with panel seams
          const dw = o.garageDoorW || L * 0.8, gu = o.doorU || 0, dxg = cx + n.x * half + along.x * gu, dzg = cz + n.z * half + along.z * gu;
          const sxg = dw * Math.abs(along.x) + 0.1 * Math.abs(n.x), szg = dw * Math.abs(along.z) + 0.1 * Math.abs(n.z);
          box(dxg + n.x * 0.04, 0, dzg + n.z * 0.04, sxg, 2.4, szg, 0, 0xf2f1ec);
          for (let r = 1; r < 4; r++) box(dxg + n.x * 0.1, r * 0.6, dzg + n.z * 0.1, sxg * (Math.abs(n.x) ? 0.5 : 1) + 0.02 * Math.abs(n.z), 0.03, szg * (Math.abs(n.z) ? 0.5 : 1) + 0.02 * Math.abs(n.x), 0, 0xb9b8b2);
          box(dxg + n.x * 0.12, 0, dzg + n.z * 0.12, 0.05 * Math.abs(along.x) + 0.04 * Math.abs(n.x), 2.4, 0.05 * Math.abs(along.z) + 0.04 * Math.abs(n.z), 0, 0xb9b8b2);
          continue;
        }
        const us = [];
        if (isFront && !o.nodoor) {
          for (const k of [-1, 1]) for (let i = 1; Math.abs(doorU + k * i * 2.7) < L / 2 - 0.9 && i <= 2; i++) us.push(doorU + k * i * 2.7);
        } else {
          const count = Math.max(1, Math.floor((L - 1.2) / 3.4));
          for (let i = 0; i < count; i++) us.push((i + 0.5) * (L / count) - L / 2);
        }
        const floors = o.storeys > 1 ? 2 : 1;
        const floorH = o.wallH && floors === 2 ? o.wallH / 2 : FLOOR_H;
        for (const u of us) {
          for (let f = 0; f < floors; f++) {
            if (o.height && f > 0) continue;
            const wy = (o.height ? 1.4 : 1.15) + f * floorH;
            const wh = o.height ? 1.0 : 1.35;
            const px = cx + n.x * half + along.x * u, pz = cz + n.z * half + along.z * u;
            const spec = o.region ? regionSpecs[o.region] : null;
            if (!windowFits(houseVolumes.find((q) => q.name === name) || { name, wallH }, px, pz, n, along, wy, wh, spec ? spec.openings : [])) continue;
            box(px + n.x * 0.03, wy - 0.1, pz + n.z * 0.03, 1.3 * Math.abs(along.x) + 0.07 * Math.abs(n.x), 1.55, 1.3 * Math.abs(along.z) + 0.07 * Math.abs(n.z), 0, WHITE);
            box(px + n.x * 0.06, wy, pz + n.z * 0.06, 1.1 * Math.abs(along.x) + 0.05 * Math.abs(n.x), wh, 1.1 * Math.abs(along.z) + 0.05 * Math.abs(n.z), 0, 0x39495a);
            if ((hollow || region) && f === 0) { // inside faces of the (still solid) window
              const ix = cx + n.x * (half - HOLLOW_WALL_T - 0.055) + along.x * u, iz = cz + n.z * (half - HOLLOW_WALL_T - 0.055) + along.z * u;
              box(ix, wy - 0.1, iz, 1.3 * Math.abs(along.x) + 0.07 * Math.abs(n.x), 1.55, 1.3 * Math.abs(along.z) + 0.07 * Math.abs(n.z), 0, WHITE);
              box(ix - n.x * 0.025, wy, iz - n.z * 0.025, 1.1 * Math.abs(along.x) + 0.05 * Math.abs(n.x), wh, 1.1 * Math.abs(along.z) + 0.05 * Math.abs(n.z), 0, 0x39495a);
            }
            if (o.shutters && isFront) {
              for (const k of [-1, 1]) {
                box(px + along.x * k * 0.78 + n.x * 0.06, wy, pz + along.z * k * 0.78 + n.z * 0.06, 0.36 * Math.abs(along.x) + 0.06 * Math.abs(n.x), wh, 0.36 * Math.abs(along.z) + 0.06 * Math.abs(n.z), 0, 0x1c1c1e);
              }
            }
          }
        }
        if (!isFront || o.nodoor) continue;
        // door + trim (hollow houses: just the open doorway)
        const dx = cx + n.x * half + along.x * doorU, dz = cz + n.z * half + along.z * doorU;
        if (!hollow) box(dx + n.x * 0.05, 0, dz + n.z * 0.05, 1.05 * Math.abs(along.x) + 0.1 * Math.abs(n.x), 2.1, 1.05 * Math.abs(along.z) + 0.1 * Math.abs(n.z), 0, o.doorColor || 0xf6f6f2);
        if (!hollow) box(dx + n.x * 0.04, 2.1, dz + n.z * 0.04, 1.3 * Math.abs(along.x) + 0.08 * Math.abs(n.x), 0.14, 1.3 * Math.abs(along.z) + 0.08 * Math.abs(n.z), 0, WHITE);
        if (o.number) plates.push({ text: o.number, x: dx + along.x * 0.95 + n.x * 0.05, y: 1.7, z: dz + along.z * 0.95 + n.z * 0.05, yaw: faceYaw });
        // porch / deck / stoop in front of the door
        const kind = o.porch;
        if (!kind) continue;
        const slabW = kind === "deck" ? 4.4 : kind === "porch" ? 3.4 : 1.9;
        const slabD = kind === "deck" ? 2.7 : kind === "porch" ? 2.2 : 1.3;
        const slabH = kind === "deck" ? 0.45 : 0.34;
        const sx0 = dx + n.x * (slabD / 2), sz0 = dz + n.z * (slabD / 2);
        const nx = Math.abs(n.x), nz = Math.abs(n.z);
        const slabColor = kind === "stoop" ? 0x8f8c85 : WOOD;
        box(sx0, 0, sz0, slabW * nz + slabD * nx, slabH, slabW * nx + slabD * nz, 0, slabColor);
        // steps down to the lawn (two risers)
        for (let s = 1; s <= 2; s++) {
          const sh = slabH * (1 - s / 3);
          const stepD = 0.32;
          const stx = dx + n.x * (slabD + stepD * (s - 0.5)), stz = dz + n.z * (slabD + stepD * (s - 0.5));
          box(stx, 0, stz, 1.3 * nz + stepD * nx, sh, 1.3 * nx + stepD * nz, 0, slabColor);
          const stc = makeCollider(stx, stz, (1.3 * nz + stepD * nx) / 2, (1.3 * nx + stepD * nz) / 2, sh, 0); // walkable riser
          stc.render = false; stc.seeThrough = true; stc.fx = "wood";
          addCollider(stc);
        }
        record.door = { x: dx, z: dz, nx: n.x, nz: n.z, kind, slabD, slabW, slabH };
        const sc = makeCollider(sx0, sz0, (slabW * nz + slabD * nx) / 2, (slabW * nx + slabD * nz) / 2, slabH, 0);
        sc.render = false; sc.seeThrough = true; sc.fx = "wood";
        addCollider(sc);
        // railings: along both sides and the front edge (leaving the steps open)
        const railColor = kind === "stoop" ? 0xe8e8e4 : 0x7a5c3e;
        // thin solid rail: blocks bodies and shots (not sight, like the low fences) but can be vaulted and never carries you
        const addRailCollider = (rx, rz, sx, sz) => {
          const rc = makeCollider(rx, rz, Math.max(sx, 0.08) / 2, Math.max(sz, 0.08) / 2, slabH + 0.9, 0);
          rc.render = false; rc.seeThrough = true; rc.noStand = true; rc.fx = "wood";
          addCollider(rc);
        };
        for (const k of [-1, 1]) {
          const rx = dx + along.x * k * (slabW / 2 - 0.05) + n.x * (slabD / 2), rz = dz + along.z * k * (slabW / 2 - 0.05) + n.z * (slabD / 2);
          box(rx, slabH, rz, 0.05 * nz + (slabD - 0.1) * nx, 0.9, 0.05 * nx + (slabD - 0.1) * nz, 0, railColor);
          addRailCollider(rx, rz, 0.05 * nz + (slabD - 0.1) * nx, 0.05 * nx + (slabD - 0.1) * nz);
        }
        if (kind !== "stoop") {
          for (const k of [-1, 1]) {
            const rx = dx + along.x * k * (slabW / 2 - 0.6 + 0.0) * 1.0 + n.x * (slabD - 0.05), rz = dz + along.z * k * (slabW / 2 - 0.6) + n.z * (slabD - 0.05);
            box(rx, slabH, rz, (slabW / 2 - 1.0) * nz + 0.05 * nx, 0.9, (slabW / 2 - 1.0) * nx + 0.05 * nz, 0, railColor);
            addRailCollider(rx, rz, (slabW / 2 - 1.0) * nz + 0.05 * nx, (slabW / 2 - 1.0) * nx + 0.05 * nz);
          }
        }
        if (kind === "porch") {
          for (const k of [-1, 1]) box(dx + along.x * k * (slabW / 2 - 0.12) + n.x * (slabD - 0.12), slabH, dz + along.z * k * (slabW / 2 - 0.12) + n.z * (slabD - 0.12), 0.14, 2.5, 0.14, 0, WHITE);
          box(sx0, slabH + 2.5, sz0, slabW * nz + slabD * nx, 0.14, slabW * nx + slabD * nz, 0, o.roof);
        }
      }
    }
    const regionSpecs = {};
    for (const h of HOUSES) buildHouse(h);

    // ---- hollow regions: garages and the L-shaped 1114 -------------------------------------------------
    // A region is a union of footprint rects. Its walls are the band of thickness T just inside the union's outline
    // (so shared edges between rects have NO wall: one open interior), cut by openings (a doorway, or a garage door
    // raised to height h: the wall above it stays as a lintel carrying the raised door panel). The grid is the
    // compressed coordinates of every edge and edge +/- T, so corners and notches come out exact.
    const tunnelW = (() => { const a = mapToWorld(TUNNEL_PX[0], TUNNEL_PX[1]), b = mapToWorld(TUNNEL_PX[2], TUNNEL_PX[3]); return { x0: Math.min(a.x, b.x), x1: Math.max(a.x, b.x), z0: Math.min(a.z, b.z), z1: Math.max(a.z, b.z) }; })();
    const stairHoleW = (st) => { const a = mapToWorld(st.px[0], st.px[1]), b = mapToWorld(st.px[2], st.px[3]); return { x0: Math.min(a.x, b.x), x1: Math.max(a.x, b.x), z0: Math.min(a.z, b.z), z1: Math.max(a.z, b.z) }; };
    function buildRegion(name, spec) {
      const T = HOLLOW_WALL_T, R = spec.rects, E = 1e-4, DEP = BASEMENT_DEPTH;
      const stairDef = STAIRS.find((q) => q.region === name) || null;
      const hasBasement = !!stairDef;
      // stairs: hole = the opening in the ground floor; the run continues under the floor to the basement floor
      let hole = null, stair = null;
      if (stairDef) {
        hole = stairHoleW(stairDef);
        const dir = stairDef.top === "W" ? 1 : -1, topX = stairDef.top === "W" ? hole.x0 : hole.x1;
        const run = (HOLLOW_FLOOR_Y + DEP) / STAIR_SLOPE + STAIR_LANDING, botX = topX + dir * run;
        stair = { dir, topX, botX, run, x0: Math.min(topX, botX), x1: Math.max(topX, botX), z0: hole.z0, z1: hole.z1 };
        stair.floorAt = (x) => Math.max(-DEP, HOLLOW_FLOOR_Y - STAIR_SLOPE * Math.max(0, dir * (x - topX) - STAIR_LANDING));
      }
      const inRect = (r, x, z) => x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1;
      const inUnion = (x, z) => R.some((r) => inRect(r, x, z));
      const squareInUnion = (x, z, h) => { for (const dx of [-h, 0, h]) for (const dz of [-h, 0, h]) if (!inUnion(x + dx, z + dz)) return false; return true; };
      const uniq = (a) => { a.sort((p, q) => p - q); return a.filter((v, i) => i === 0 || v - a[i - 1] > 1e-3); };
      const extraX = hole ? [hole.x0, hole.x1] : [], extraZ = hole ? [hole.z0, hole.z1] : [];
      const xs = uniq(R.flatMap((r) => [r.x0, r.x1, r.x0 + T, r.x1 - T]).concat(spec.openings.flatMap((o) => [o.x0, o.x1]), extraX));
      const zs = uniq(R.flatMap((r) => [r.z0, r.z1, r.z0 + T, r.z1 - T]).concat(spec.openings.flatMap((o) => [o.z0, o.z1]), extraZ, hasBasement ? [tunnelW.z0, tunnelW.z1] : []));
      const NX = xs.length - 1, NZ = zs.length - 1;
      const cell = (j, i) => ({ x: (xs[i] + xs[i + 1]) / 2, z: (zs[j] + zs[j + 1]) / 2 });
      const grid = () => Array.from({ length: NZ }, () => new Array(NX).fill(null));
      const wallM = grid(), floorM = grid(), ceilM = grid(), intM = grid(), opM = grid(), bwM = grid(), bfM = grid();
      for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
        const c = cell(j, i);
        if (!inUnion(c.x, c.z)) continue;
        const here = R.filter((r) => inRect(r, c.x, c.z));
        const top = Math.max(...here.map((r) => r.wallH)), ceilH = Math.min(...here.map((r) => r.ceilH)), fl = Math.max(...here.map((r) => r.floorY));
        const op = spec.openings.find((o) => c.x > o.x0 && c.x < o.x1 && c.z > o.z0 && c.z < o.z1);
        opM[j][i] = op || null;
        const inHole = hole && c.x > hole.x0 && c.x < hole.x1 && c.z > hole.z0 && c.z < hole.z1;
        if (squareInUnion(c.x, c.z, T - E)) { // a room cell
          intM[j][i] = true;
          if (!inHole) floorM[j][i] = fl.toFixed(3);
          ceilM[j][i] = ceilH.toFixed(3) + "_" + top.toFixed(3);
          if (hasBasement) bfM[j][i] = "f";
        } else { // a wall cell, cut by an opening (the part above it stays as a lintel / carries the raised door)
          const y0 = op ? op.h : 0;
          if (y0 < top) wallM[j][i] = y0.toFixed(3) + "_" + top.toFixed(3) + "_" + here[0].wall;
          if (op) floorM[j][i] = fl.toFixed(3); // threshold under the opening
          if (hasBasement) { // the basement wall under it; the tunnel mouth is open up to the tunnel's ceiling
            const toTunnel = c.x > tunnelW.x0 - T - 0.04 && c.x < tunnelW.x1 + T + 0.04 && c.z > tunnelW.z0 && c.z < tunnelW.z1;
            bwM[j][i] = toTunnel ? "L" : "W";
          }
        }
      }
      // greedy merge of equal-key cells into boxes
      function merge(m) {
        const open = new Map(), boxes = [];
        for (let j = 0; j < NZ; j++) {
          const next = new Map();
          for (let i = 0; i < NX;) {
            const key = m[j][i];
            if (!key) { i++; continue; }
            let i1 = i; while (i1 + 1 < NX && m[j][i1 + 1] === key) i1++;
            const rk = i + "_" + i1 + "_" + key, prev = open.get(rk);
            if (prev) { prev.j1 = j; next.set(rk, prev); } else { const bx = { i0: i, i1, j0: j, j1: j, key }; boxes.push(bx); next.set(rk, bx); }
            i = i1 + 1;
          }
          open.clear(); for (const [k, v] of next) open.set(k, v);
        }
        return boxes;
      }
      const dims = (bx) => { const x0 = xs[bx.i0], x1 = xs[bx.i1 + 1], z0 = zs[bx.j0], z1 = zs[bx.j1 + 1]; return { x0, x1, z0, z1, cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, sx: x1 - x0, sz: z1 - z0 }; };
      // walls (with a basement the ground-floor walls start just above the ground: a body in the basement passes beneath them)
      for (const bx of merge(wallM)) {
        const [y0s, y1s, col] = bx.key.split("_"), y0 = parseFloat(y0s), y1 = parseFloat(y1s), d = dims(bx), ys = Math.max(y0, 0.5);
        if (y1 > ys) put("siding", d.cx, (ys + y1) / 2, d.cz, d.sx, y1 - ys, d.sz, 0, parseInt(col, 10));
        if (y0 < 0.5) box(d.cx, 0, d.cz, d.sx + 0.04, Math.min(y1, 0.5), d.sz + 0.04, 0, FOUNDATION);
        const c = makeCollider(d.cx, d.cz, d.sx / 2, d.sz / 2, y1, 0);
        if (y0 > 0) c.base = y0; else if (hasBasement) c.base = 0.02;
        c.style = "house";
        addCollider(c);
      }
      // floors (rooms + the threshold under every opening): flush with the door steps
      for (const bx of merge(floorM)) {
        const fl = parseFloat(bx.key), d = dims(bx);
        if (fl > 0.01) {
          put("interior", d.cx, fl / 2, d.cz, d.sx, fl, d.sz, 0, HOLLOW_FLOOR_COLOR);
          const fc = makeCollider(d.cx, d.cz, d.sx / 2, d.sz / 2, fl, 0);
          fc.render = false; fc.fx = "wood";
          if (hasBasement) { fc.base = -0.01; fc.slab = true; } // over a basement: a slab (a floor above, a ceiling below, never a wall), solid to sight and shots
          else fc.seeThrough = true;
          addCollider(fc);
        } else put("interior", d.cx, 0.02, d.cz, d.sx, 0.04, d.sz, 0, 0x8d8b86);
      }
      // ceilings (one continuous plate over every room cell) + the sealed air gap up to the eave (shots only)
      for (const bx of merge(ceilM)) {
        const [cs, ts] = bx.key.split("_"), ceilH = parseFloat(cs), top = parseFloat(ts), d = dims(bx);
        put("interior", d.cx, ceilH - 0.05, d.cz, d.sx, 0.1, d.sz, 0, HOLLOW_CEIL_COLOR);
        if (top - ceilH > 0.05) {
          const gap = makeCollider(d.cx, d.cz, d.sx / 2, d.sz / 2, top, 0);
          gap.base = ceilH; gap.ceiling = true; gap.style = "house";
          addCollider(gap);
        }
      }
      // interior lining: a plaster panel + dark baseboard on every wall face that looks into a room
      const isRoom = (j, i) => j >= 0 && j < NZ && i >= 0 && i < NX && intM[j][i];
      for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
        if (!wallM[j][i] && !opM[j][i]) continue;
        const [y0s] = wallM[j][i] ? wallM[j][i].split("_") : [String(opM[j][i].h)];
        const d = dims({ i0: i, i1: i, j0: j, j1: j });
        for (const [dj, di] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
          if (!isRoom(j + dj, i + di)) continue;
          const fl = HOLLOW_FLOOR_Y, ceilH = parseFloat(ceilM[j + dj][i + di].split("_")[0]);
          const yLow = Math.max(parseFloat(y0s), fl), h = ceilH - yLow;
          if (h <= 0.05) continue;
          const px = di === -1 ? d.x0 - 0.02 : di === 1 ? d.x1 + 0.02 : d.cx, pz = dj === -1 ? d.z0 - 0.02 : dj === 1 ? d.z1 + 0.02 : d.cz;
          const len = [di ? 0.04 : d.sx, h, dj ? 0.04 : d.sz];
          put("interior", px, yLow + h / 2, pz, len[0], len[1], len[2], 0, HOLLOW_WALL_COLOR);
          if (yLow <= fl + 0.01) put("interior", px + di * 0.02, fl + 0.07, pz + dj * 0.02, di ? 0.08 : d.sx, 0.14, dj ? 0.08 : d.sz, 0, 0x6b5a45);
        }
      }
      // openings: raised garage door panel above the clear height; white jambs on doors
      for (const op of spec.openings) {
        const ocx = (op.x0 + op.x1) / 2, ocz = (op.z0 + op.z1) / 2;
        const r = R.find((q) => ocx > q.x0 - 1 && ocx < q.x1 + 1 && ocz > q.z0 - 1 && ocz < q.z1 + 1);
        if (!r || !op.face) continue;
        const n = FACE[op.face], nxa = Math.abs(n.x), nza = Math.abs(n.z);
        const edge = op.face === "W" ? r.x0 : op.face === "E" ? r.x1 : op.face === "N" ? r.z0 : r.z1;
        const px0 = nxa ? edge : ocx, pz0 = nza ? edge : ocz;
        const len = nxa ? op.z1 - op.z0 : op.x1 - op.x0;
        if (op.leaf) {
          const top = Math.min(GARAGE_DOOR_H, r.wallH - 0.05), ph = top - op.h;
          if (ph > 0.05) {
            box(px0 + n.x * 0.05, op.h, pz0 + n.z * 0.05, nxa * 0.1 + nza * len, ph, nza * 0.1 + nxa * len, 0, 0xf2f1ec);
            for (let k = 1; k * 0.6 < ph; k++) box(px0 + n.x * 0.1, op.h + k * 0.6, pz0 + n.z * 0.1, nxa * 0.04 + nza * len, 0.03, nza * 0.04 + nxa * len, 0, 0xb9b8b2);
          }
          for (const k of [-1, 1]) box(px0 + n.x * 0.1 + nza * k * len / 2, 0, pz0 + n.z * 0.1 + nxa * k * len / 2, nxa * 0.1 + nza * 0.08, op.h, nza * 0.1 + nxa * 0.08, 0, 0xb9b8b2);
        }
        if (op.jambs) {
          const fl = r.floorY;
          for (const k of [-1, 1]) {
            const jx = px0 - n.x * (T / 2) + nza * k * (len / 2 + 0.04), jz = pz0 - n.z * (T / 2) + nxa * k * (len / 2 + 0.04);
            box(jx, fl, jz, nxa * (T + 0.06) + nza * 0.07, op.h - fl - 0.1, nza * (T + 0.06) + nxa * 0.07, 0, WHITE); // 0.07 wide, its far face 0.005 inside the wall: nothing coplanar
          }
          box(px0 - n.x * (T / 2), op.h - 0.1, pz0 - n.z * (T / 2), nxa * (T + 0.06) + nza * (len + 0.06), 0.1, nza * (T + 0.06) + nxa * (len + 0.06), 0, WHITE); // head trim under the lintel
        }
      }
      // steps up to a raised door (a landing, then two risers; walkable colliders like the porch steps)
      for (const st of spec.steps) {
        const n = FACE[st.face], nxa = Math.abs(n.x), nza = Math.abs(n.z), slabH = HOLLOW_FLOOR_Y, landD = 0.9, wd = 1.7, stepD = 0.3;
        const addStep = (cx, cz, along, depth, h) => {
          box(cx, 0, cz, along * nza + depth * nxa, h, along * nxa + depth * nza, 0, 0x8f8c85);
          const c = makeCollider(cx, cz, (along * nza + depth * nxa) / 2, (along * nxa + depth * nza) / 2, h, 0);
          c.render = false; c.seeThrough = true; c.fx = "wood";
          addCollider(c);
        };
        addStep(st.p.x + n.x * landD / 2, st.p.z + n.z * landD / 2, wd, landD, slabH);
        for (let k = 1; k <= 2; k++) addStep(st.p.x + n.x * (landD + stepD * (k - 0.5)), st.p.z + n.z * (landD + stepD * (k - 0.5)), 1.3, stepD, slabH * (1 - k / 3));
      }
      if (!hasBasement) return;

      // ---------------------------------------------------------------- the basement
      // below-ground volumes for the level-aware floor (see levelBaseAt): one pit per footprint rect, then the stair
      for (const r of R) pits.push({ x0: r.x0, x1: r.x1, z0: r.z0, z1: r.z1, floorAt: () => -DEP });
      pits.push({ x0: stair.x0, x1: stair.x1, z0: stair.z0, z1: stair.z1, floorAt: (x) => stair.floorAt(x), stair: true, hole });
      const basementCol = (cx, cz, hx, hz, topY, baseY, fx) => { const c = makeCollider(cx, cz, hx, hz, topY, 0); c.base = baseY; c.render = false; c.style = "house"; if (fx) c.fx = fx; return addCollider(c); };
      // floor: concrete slab (a collider top at -DEP so shots and impacts land on it; the level floor itself is levelBaseAt)
      for (const bx of merge(bfM)) {
        const d = dims(bx);
        put("interior", d.cx, -DEP - 0.05, d.cz, d.sx, 0.1, d.sz, 0, BASEMENT_FLOOR_COLOR);
        basementCol(d.cx, d.cz, d.sx / 2, d.sz / 2, -DEP, -DEP - 0.6, "concrete");
      }
      // ceiling lining: the underside of the ground-floor slab
      for (const bx of merge(floorM)) { const d = dims(bx); put("interior", d.cx, -0.03, d.cz, d.sx, 0.04, d.sz, 0, BASEMENT_CEIL_COLOR); }
      // walls: concrete ring under the ground-floor walls (collider top = ground level, so it never stops anyone above)
      for (const bx of merge(bwM)) {
        const d = dims(bx);
        if (bx.key === "W") {
          put("interior", d.cx, -DEP / 2 - 0.0025, d.cz, d.sx, DEP - 0.005, d.sz, 0, BASEMENT_WALL_COLOR);
          basementCol(d.cx, d.cz, d.sx / 2, d.sz / 2, 0, -DEP - 0.6, "concrete");
        } else { // the tunnel mouth: dirt lintel above the opening
          const y0 = -DEP + TUNNEL_H;
          put("interior", d.cx, (y0 - 0.005) / 2, d.cz, d.sx, -y0 - 0.005, d.sz, 0, DIRT_DARK);
        }
      }
      // stairs: solid treads sampled from the ramp the support function follows, side walls, a rear wall at the top
      const runSteps = stair.run - STAIR_LANDING, nSteps = Math.max(8, Math.round(runSteps / 0.28)), tread = runSteps / nSteps, zc = (stair.z0 + stair.z1) / 2, zw = stair.z1 - stair.z0;
      put("interior", stair.topX + stair.dir * STAIR_LANDING / 2, (HOLLOW_FLOOR_Y - DEP) / 2, zc, STAIR_LANDING, HOLLOW_FLOOR_Y + DEP, zw, 0, HOLLOW_FLOOR_COLOR); // the flat landing at the top
      for (let k = 0; k < nSteps; k++) {
        const along = STAIR_LANDING + (k + 0.5) * tread, x = stair.topX + stair.dir * along, hTop = stair.floorAt(x);
        if (hTop <= -DEP + 0.02) continue;
        put("interior", x, (hTop - DEP) / 2, zc, tread + 0.004, hTop + DEP, zw, 0, k % 2 ? 0x82694c : 0x8f7352);
      }
      for (const side of [-1, 1]) {
        const z = side < 0 ? stair.z0 - 0.05 : stair.z1 + 0.05, cx = (stair.x0 + stair.x1) / 2, hx = (stair.x1 - stair.x0) / 2;
        put("interior", cx, -DEP / 2, z, stair.x1 - stair.x0, DEP, 0.12, 0, BASEMENT_WALL_COLOR);
        basementCol(cx, z, hx, 0.06, 0, -DEP - 0.6, "concrete");
        // the open stairwell above the floor: a low guard rail along it (vaultable, never a floor)
        const rx0 = Math.max(hole.x0, stair.x0), rx1 = Math.min(hole.x1, stair.x1);
        const rc = makeCollider((rx0 + rx1) / 2, z, (rx1 - rx0) / 2, 0.05, HOLLOW_FLOOR_Y + 0.95, 0);
        rc.base = HOLLOW_FLOOR_Y; rc.render = false; rc.seeThrough = true; rc.noStand = true; rc.fx = "wood";
        addCollider(rc);
        box((rx0 + rx1) / 2, HOLLOW_FLOOR_Y + 0.9, z, rx1 - rx0, 0.05, 0.06, 0, 0x7a5c3e);
        for (let q = 0; q <= 4; q++) box(rx0 + (rx1 - rx0) * q / 4, HOLLOW_FLOOR_Y, z, 0.06, 0.9, 0.06, 0, 0x7a5c3e);
      }
      { // rear of the stair (under the floor behind the top step) + the guard rail across the deep end of the opening
        const rearX = stair.topX - stair.dir * 0.06;
        basementCol(rearX, zc, 0.06, zw / 2, HOLLOW_FLOOR_Y, -DEP - 0.6, "concrete");
        put("interior", rearX, (HOLLOW_FLOOR_Y - 0.01 - DEP) / 2, zc, 0.12, HOLLOW_FLOOR_Y - 0.01 + DEP, zw, 0, BASEMENT_WALL_COLOR);
        const farX = stair.dir > 0 ? hole.x1 : hole.x0, ry = HOLLOW_FLOOR_Y;
        const rc = makeCollider(farX, zc, 0.05, zw / 2, ry + 0.95, 0);
        rc.base = ry; rc.render = false; rc.seeThrough = true; rc.noStand = true; rc.fx = "wood";
        addCollider(rc);
        box(farX, ry + 0.9, zc, 0.06, 0.05, zw, 0, 0x7a5c3e);
        for (let q = 0; q <= 3; q++) box(farX, ry, hole.z0 + (hole.z1 - hole.z0) * q / 3, 0.06, 0.9, 0.06, 0, 0x7a5c3e);
      }
    }
    // the dirt tunnel between the two basements: floor, side walls (solid below ground level only), a low ceiling of earth
    function buildTunnel() {
      const DEP = BASEMENT_DEPTH, T = HOLLOW_WALL_T, x0 = tunnelW.x0 - T, x1 = tunnelW.x1 + T, z0 = tunnelW.z0, z1 = tunnelW.z1;
      const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, ceilY = -DEP + TUNNEL_H;
      pits.push({ x0: tunnelW.x0, x1: tunnelW.x1, z0, z1, floorAt: () => -DEP });
      put("interior", cx, -DEP - 0.05, cz, x1 - x0, 0.1, z1 - z0, 0, DIRT_COLOR);
      put("interior", cx, (ceilY - 0.03) / 2, cz, x1 - x0, -0.03 - ceilY, z1 + 0.6 - z0 + 0.0, 0, DIRT_DARK); // earth roof: wider than the tunnel, resting on the walls (a hair under the lawn)
      for (const side of [-1, 1]) {
        const z = side < 0 ? z0 - 0.15 : z1 + 0.15;
        // visible dirt walls only between the house walls (inside the wall thickness they would share faces with the concrete)
        put("interior", (tunnelW.x0 + tunnelW.x1) / 2, (-DEP + ceilY) / 2, z, tunnelW.x1 - tunnelW.x0, DEP + ceilY, 0.3, 0, DIRT_COLOR);
        const c = makeCollider(cx, z, (x1 - x0) / 2, 0.15, 0, 0);
        c.base = -DEP - 0.6; c.render = false; c.fx = "concrete";
        addCollider(c);
      }
      const fl = makeCollider(cx, cz, (x1 - x0) / 2, (z1 - z0) / 2, -DEP, 0);
      fl.base = -DEP - 0.6; fl.render = false; fl.seeThrough = true; fl.fx = "concrete";
      addCollider(fl);
      const lid = makeCollider(cx, cz, (x1 - x0) / 2, (z1 - z0) / 2, 0, 0); // the earth over the tunnel: the head bumps it, the lawn above is still the floor
      lid.base = ceilY; lid.slab = true; lid.render = false; lid.fx = "concrete";
      addCollider(lid);
    }
    for (const [name, spec] of Object.entries(regionSpecs)) buildRegion(name, spec);
    buildTunnel();

    // ---- roof access: a staircase of wooden crates against low buildings, so anyone who wants to can jump up onto them.
    // Each crate is CRATE_STEP higher than the one before (a jump clears 1.36 m); the last one sits against the wall and
    // its top + a jump reaches the eave. Buildings taller than REACH_MAX (the 2-storey blocks) get none.
    const CRATE_STEP = 0.95, CRATE_W = 1.3, CRATE_D = 0.95, REACH_MAX = 4.3, FENCE_CLEAR = 4.5; // FENCE_CLEAR: a crate top (1.9+ m) + a jump would clear a 1.8 m fence
    const crateWood = [0xa07a4a, 0x8f6b3e];
    function addRoofAccess() {
      const asphaltPx = ASPHALT.concat(SIDEWALKS, DRIVEWAYS, [[213, 114, 300, 150]]);
      const blocked = (x0, z0, x1, z1) => {
        for (const c of colliders) if (c.maxX > x0 && c.minX < x1 && c.maxZ > z0 && c.minZ < z1) return true;
        for (const [qx, qz] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1], [(x0 + x1) / 2, (z0 + z1) / 2]]) {
          const p = pxOfWorld(qx, qz);
          if (!insidePlayableEdge(qx, qz, 0.8) || asphaltPx.some((r) => inRect(p.x, p.y, r))) return true;
        }
        return false;
      };
      const done = new Set();
      const ex = EXCLUSION_PX[0], exA = mapToWorld(ex[0], ex[1]), exB = mapToWorld(ex[2], ex[3]);
      const fences = colliders.filter((c) => c.fx === "wood" && c.height >= 1.3 && c.height <= 2.3 && !c.base && Math.max(c.halfX, c.halfZ) > 1.5); // long runs only: not crates
      const nearFence = (x0, z0, x1, z1) => fences.some((c) => c.maxX > x0 - FENCE_CLEAR && c.minX < x1 + FENCE_CLEAR && c.maxZ > z0 - FENCE_CLEAR && c.minZ < z1 + FENCE_CLEAR);
      for (const t of accessTargets) {
        const key = t.region || t.name;
        if (done.has(key) || t.wallH > REACH_MAX) continue;
        if (t.x > exA.x && t.x < exB.x && t.z > exA.z && t.z < exB.z) continue; // the sealed yard: nobody gets in or out, so no stairs there
        if (t.region && t.wallH < 3.5) continue; // (low parts of a hollow region are handled through their tallest low part)
        const k = Math.max(1, Math.ceil((t.wallH + 0.45 - 1.36 - STEP_UP_M) / CRATE_STEP)); // crates needed: top + jump apex + step-up must clear the eave and the first roof step
        const frontSide = t.front, order = ["N", "E", "W", "S"].filter((q) => q !== frontSide); // never on the door side: it would block the steps
        let placed = false;
        for (const side of order) {
          const n = FACE[side], nxa = Math.abs(n.x), along = nxa ? { x: 0, z: 1 } : { x: 1, z: 0 };
          const half = nxa ? t.halfX : t.halfZ, L = nxa ? t.halfZ * 2 : t.halfX * 2;
          for (const u of [0, 1.5, -1.5, 3, -3, 4.5, -4.5]) {
            if (Math.abs(u) > L / 2 - CRATE_W / 2 - 0.2) continue;
            const depth = k * CRATE_D, gap = 0.12;
            const cx0 = t.x + n.x * (half + gap + depth / 2) + along.x * u, cz0 = t.z + n.z * (half + gap + depth / 2) + along.z * u;
            // test area: the crate footprint plus 0.5 m of clearance on the three open sides (none on the wall side)
            const hx = (nxa ? depth : CRATE_W) / 2, hz = (nxa ? CRATE_W : depth) / 2;
            const ax0 = cx0 - hx - (n.x < 0 || !nxa ? 0.5 : 0) + (n.x > 0 ? 0.02 : 0) - (nxa ? 0 : 0.0), ax1 = cx0 + hx + (n.x > 0 || !nxa ? 0.5 : 0) - (n.x < 0 ? 0.02 : 0);
            const az0 = cz0 - hz - (n.z < 0 || nxa ? 0.5 : 0) + (n.z > 0 ? 0.02 : 0), az1 = cz0 + hz + (n.z > 0 || nxa ? 0.5 : 0) - (n.z < 0 ? 0.02 : 0);
            if (blocked(ax0, az0, ax1, az1) || nearFence(ax0, az0, ax1, az1)) continue;
            for (let i = 0; i < k; i++) { // i = 0 is the lowest, farthest from the wall
              const h = CRATE_STEP * (i + 1), off = half + gap + (k - 1 - i) * CRATE_D + CRATE_D / 2;
              const x = t.x + n.x * off + along.x * u, z = t.z + n.z * off + along.z * u;
              const sx = nxa ? CRATE_D : CRATE_W, sz = nxa ? CRATE_W : CRATE_D;
              box(x, 0, z, sx, h, sz, 0, crateWood[i % 2]);
              for (let b = 1; b * 0.32 < h; b++) box(x, b * 0.32 - 0.02, z, sx + 0.04, 0.04, sz + 0.04, 0, 0x5a4026); // plank seams
              for (const [ex, ez] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) box(x + ex * (sx / 2 - 0.035), 0, z + ez * (sz / 2 - 0.035), 0.09, h + 0.02, 0.09, 0, 0x5a4026); // corner posts, proud of the planks by 1 cm
              const c = makeCollider(x, z, sx / 2, sz / 2, h, 0);
              c.fx = "wood";
              addCollider(c);
            }
            accessSteps.push({ name: key, side, u, crates: k, x: cx0, z: cz0 });
            placed = true;
            break;
          }
          if (placed) break;
        }
        if (placed) done.add(key);
      }
    }
    const accessSteps = [];
    addRoofAccess();

    // ---- fences and hedges on the polygon, curbs ----------------------
    const fenceRuns = [];
    const addRun = (x1, y1, x2, y2, kind) => {
      const a = mapToWorld(x1, y1), b = mapToWorld(x2, y2);
      fenceRuns.push({ a, b, kind });
    };
    const fenceEdge = (axis, fixed, ranges, hedges) => {
      for (const [lo, hi] of ranges) axis === "h" ? addRun(lo, fixed, hi, fixed, "fence") : addRun(fixed, lo, fixed, hi, "fence");
      for (const [lo, hi] of hedges || []) axis === "h" ? addRun(lo, fixed, hi, fixed, "hedge") : addRun(fixed, lo, fixed, hi, "hedge");
    };
    fenceEdge("h", 98, [[36, 105]], [[128, 142], [213, 232]]);              // A-B (248..302 is the solid dark fence below)
    fenceEdge("v", 302, [[8, 15]]);                                         // B-C
    fenceEdge("h", 8, [[302, 634]]);                                        // C-D
    fenceEdge("v", 634, [[8, 584]]);                                        // D-E
    fenceEdge("h", 584, [[338, 355], [415, 462], [528, 565], [620, 634]]);  // E-F
    fenceEdge("v", 250, [[535, 584]]);                                      // F-G
    fenceEdge("h", 535, [[36, 108], [248, 250]], [[128, 142], [213, 232]]); // G-H
    fenceEdge("v", 36, [[98, 330], [498, 535]], [[346, 372], [450, 482]]);  // H-A
    for (const { a, b, kind } of fenceRuns) {
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      const yaw = Math.atan2(-(b.z - a.z), b.x - a.x);
      const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
      if (kind === "fence") {
        box(mx, 0, mz, len, 1.85, 0.08, yaw, 0x9a7a55);
        for (let t = 0; t <= len; t += 2.4) {
          const px = a.x + ((b.x - a.x) * t) / len, pz = a.z + ((b.z - a.z) * t) / len;
          box(px, 0, pz, 0.14, 2.0, 0.14, yaw, 0x7a5c3e);
        }
      } else {
        box(mx, 0, mz, len, 1.25, 0.9, yaw, 0x3f6a34);
      }
    }
    // ---- solid wooden fences: real colliders, one merged mesh per style --
    // tall: 1.8 m tan privacy fence round the 1104 side yard (streeview2);
    // low: 1.5 m brown horizontal-board fence on the north side of the back alley (secondalleywayview.png);
    // slat: the shorter (1.4 m) pale vertical-slat section at its east end.
    // All stay above the jump apex (~1.36 m), so they cannot be climbed.
    const FENCE_STYLES = {
      tall: { h: 1.8, thick: 0.1, tileU: 1, tileV: 1.8, post: 0x8a6a48 },
      low: { h: 1.5, thick: 0.1, tileU: 2, tileV: 1.44, post: 0x4a3324 },
      slat: { h: 1.4, thick: 0.08, tileU: 1.2, tileV: 1.4, post: 0x7b6347 },
    };
    FENCE_STYLES.tall.material = new THREE.MeshLambertMaterial({
      map: canvasTexture(64, 64, (ctx, w, h) => {
        const rand = seededRandom(31);
        for (let i = 0; i < 8; i++) {
          const k = 0.86 + rand() * 0.26;
          ctx.fillStyle = `rgb(${Math.round(184 * k)},${Math.round(140 * k)},${Math.round(94 * k)})`;
          ctx.fillRect(i * 8, 0, 8, h);
          ctx.fillStyle = "rgba(70,40,15,0.5)";
          ctx.fillRect(i * 8, 0, 1, h);
          for (let g = 0; g < 5; g++) { ctx.fillStyle = "rgba(90,55,25,0.18)"; ctx.fillRect(i * 8 + 1 + Math.floor(rand() * 6), 0, 1, h); }
        }
      }),
    });
    FENCE_STYLES.low.material = new THREE.MeshLambertMaterial({
      map: canvasTexture(64, 64, (ctx, w, h) => {
        const rand = seededRandom(32);
        for (let i = 0; i < 8; i++) {
          const k = 0.85 + rand() * 0.3;
          ctx.fillStyle = `rgb(${Math.round(114 * k)},${Math.round(78 * k)},${Math.round(55 * k)})`;
          ctx.fillRect(0, i * 8, w, 8);
          ctx.fillStyle = "rgba(20,10,5,0.55)";
          ctx.fillRect(0, i * 8, w, 1);
        }
      }),
    });
    FENCE_STYLES.slat.material = new THREE.MeshLambertMaterial({
      map: canvasTexture(64, 64, (ctx, w, h) => {
        const rand = seededRandom(33);
        for (let i = 0; i < 10; i++) {
          const k = 0.88 + rand() * 0.2;
          ctx.fillStyle = `rgb(${Math.round(150 * k)},${Math.round(116 * k)},${Math.round(82 * k)})`;
          ctx.fillRect(i * 6.4, 0, 5.6, h);
          ctx.fillStyle = "rgba(25,15,8,0.6)";
          ctx.fillRect(i * 6.4 + 5.6, 0, 0.8, h);
        }
      }),
    });
    const solidRuns = { tall: [], low: [], slat: [] };
    const addSolidFence = (x1, y1, x2, y2, style) => {
      const a = mapToWorld(x1, y1), b = mapToWorld(x2, y2), S = FENCE_STYLES[style];
      const len = Math.hypot(b.x - a.x, b.z - a.z), yaw = Math.atan2(-(b.z - a.z), b.x - a.x);
      solidRuns[style].push({ a, b, len, yaw });
      const c = makeCollider((a.x + b.x) / 2, (a.z + b.z) / 2, len / 2, S.thick / 2 + 0.03, S.h, yaw);
      c.render = false; c.fx = "wood";   // opaque: blocks sight and shots, shown on the minimap like a wall
      addCollider(c);
    };
    // The fenced yard west of 1104 (topdowncloseup.png): west fence, north fence along the driveway's south edge to the
    // orange garage, south fence across the front of the yard to the porch wing, and a cross fence closing the gap
    // between the orange garage and 1104 at the garage's east wall. The yard, the gap and the notch of 1104 are
    // sealed (EXCLUSION_PX): nobody can enter, nothing spawns there.
    addSolidFence(247.5, 181.9, 247.5, 269.2, "tall");   // west side
    addSolidFence(247.5, 181.9, 299.2, 181.9, "tall");   // north side, to the orange garage's south-west corner
    addSolidFence(247.5, 269.2, 317.5, 269.2, "tall");   // south side, across the front of the yard and the notch, to the porch wing
    addSolidFence(357, 181.9, 357, 196.4, "tall");       // east end of the gap between the orange garage and 1104
    addSolidFence(248, 98, 302, 98, "low");      // alley north side, west of house 320 (on the map edge)
    addSolidFence(372, 98, 404, 98, "slat");     // alley north side, east of house 320: the lower slat section at the fence's east end
    for (const style of Object.keys(solidRuns)) {
      const S = FENCE_STYLES[style], pos = [], nor = [], uv = [], idx = [];
      for (const { a, b, len, yaw } of solidRuns[style]) {
        const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
        const g = new THREE.BoxGeometry(len, S.h, S.thick);
        const guv = g.attributes.uv;
        for (let i = 0; i < guv.count; i++) {
          if (i >= 16) guv.setXY(i, guv.getX(i) * len / S.tileU, guv.getY(i) * S.h / S.tileV); // the two long faces tile the boards
          else guv.setXY(i, 0.06, 0.5);
        }
        g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(mx, S.h / 2, mz), new THREE.Quaternion().setFromAxisAngle(yUp, yaw), new THREE.Vector3(1, 1, 1)));
        const base = pos.length / 3;
        pos.push(...g.attributes.position.array);
        nor.push(...g.attributes.normal.array);
        uv.push(...g.attributes.uv.array);
        for (const i of g.index.array) idx.push(base + i);
        const posts = Math.ceil(len / 2.4);
        for (let i = 0; i <= posts; i++) {
          const k = i / posts;
          box(a.x + (b.x - a.x) * k, 0, a.z + (b.z - a.z) * k, 0.14, S.h + 0.1, 0.14, yaw, S.post);
        }
        box(mx, S.h, mz, len, 0.06, S.thick + 0.06, yaw, S.post); // top rail
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
      geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
      geo.setIndex(idx);
      const mesh = new THREE.Mesh(geo, S.material);
      mesh.frustumCulled = false;
      root.add(mesh);
    }
    {
      // street furniture from secondalleywayview.png: a grey wheeled bin at the curb beside the drive, and a wooden pallet
      // leaning on the tall fence's apron side (slats stepped to lean; a low see-through collider that can be vaulted but
      // never stood on, so nobody gets a launch pad over the 1.8 m sealed-yard fence)
      const bin = mapToWorld(218.5, 179);
      box(bin.x, 0.08, bin.z, 0.6, 0.86, 0.56, 0, 0x6a6e72);
      box(bin.x, 0.94, bin.z, 0.66, 0.09, 0.62, 0, 0x4f5458);
      box(bin.x + 0.34, 0, bin.z, 0.1, 0.16, 0.5, 0, 0x2c2e30);   // wheels at the back
      const binC = makeCollider(bin.x, bin.z, 0.34, 0.32, 1.03, 0);
      binC.render = false; binC.fx = "metal";
      addCollider(binC);
      const pal = mapToWorld(262, 181.9), faceZ = pal.z - 0.05;
      for (let i = 0; i < 5; i++) {
        const y = 0.04 + i * 0.22, lean = 0.07 + 0.3 * (1 - y / 1.1);
        box(pal.x, y, faceZ - lean - 0.07, 1.2, 0.12, 0.14, 0, 0xb39a6e);
        for (const dx of [-0.52, 0, 0.52]) box(pal.x + dx, y - 0.02, faceZ - lean - 0.2, 0.1, 0.2, 0.1, 0, 0x9d8559);
      }
      const palC = makeCollider(pal.x, faceZ - 0.2, 0.62, 0.2, 1.1, 0);
      palC.render = false; palC.fx = "wood"; palC.seeThrough = true; palC.noStand = true;
      addCollider(palC);
    }
    {
      // curbs along every road edge (cosmetic lip, no collider)
      const curb = (x1, y1, x2, y2) => {
        const a = mapToWorld(x1, y1), b = mapToWorld(x2, y2);
        const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
        box(mx, 0, mz, Math.max(Math.abs(b.x - a.x), 0.25), 0.14, Math.max(Math.abs(b.z - a.z), 0.25), 0, 0xcfccc4);
      };
      const gap = (lo, hi, cuts) => { // segments of [lo, hi] minus the cut ranges
        const out = [];
        let at = lo;
        for (const [c0, c1] of cuts.slice().sort((p, q) => p[0] - q[0])) { if (c0 > at) out.push([at, c0]); at = Math.max(at, c1); }
        if (at < hi) out.push([at, hi]);
        return out;
      };
      for (const [x, cuts] of [[142, [[372, 450]]], [213, [[372, 450]]]]) for (const [lo, hi] of gap(-60, 700, cuts)) curb(x - 0.6, lo, x, hi);
      for (const [y, cuts] of [[372, [[142, 213]]], [450, [[142, 213]]]]) for (const [lo, hi] of gap(-60, 900, cuts)) curb(lo, y - 0.6, hi, y);
    }

    // ---- trees ---------------------------------------------------------
    const treeSystem = window.createTreeSystem
      ? window.createTreeSystem(THREE, root, environment, { drawDistance: TREE_DRAW_DISTANCE })
      : null;
    const trees = [];
    {
      const rand = seededRandom(404);
      for (const [px, py, r, flowering] of TREES) {
        const p = mapToWorld(px, py);
        const canopyRadius = r * MAP2_M_PER_PX;
        const trunkHeight = 2.5 + rand() * 1.0;
        const canopyHeight = Math.max(canopyRadius * 1.8, 3);
        trees.push({ x: p.x, z: p.z, evergreen: false, trunkHeight, canopyRadius, canopyHeight, shade: flowering ? 1.25 : 0.9 + rand() * 0.2 });
        const c = makeCylinderCollider(p.x, p.z, 0.35, 6);
        c.render = false;
        c.isTree = true;
        if (insidePlayableEdge(p.x, p.z, -6)) addCollider(c);
        if (r >= 30) {
          // the aerial's big crowns are wider than one tree model grows: two companions overlapping it
          for (const k of [-1, 1]) {
            const a = rand() * Math.PI * 2, d = canopyRadius * 0.5;
            const cr = canopyRadius * 0.7;
            trees.push({ x: p.x + Math.cos(a) * d * k, z: p.z + Math.sin(a) * d * k, evergreen: false, trunkHeight: 3 + rand(), canopyRadius: cr, canopyHeight: cr * 1.8, shade: 1 });
          }
        }
      }
      if (treeSystem) treeSystem.addTrees(trees);
    }

    // ---- bus stop sign (11th St west boulevard) ------------------------
    {
      const bp = mapToWorld(131, 310);
      box(bp.x, 0, bp.z, 0.07, 2.4, 0.07, 0, 0x8d9296);
      const tex = canvasTexture(128, 160, (ctx, w, h) => {
        ctx.fillStyle = "#f4f4f2";
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = "#1f5fa8";
        ctx.fillRect(6, 6, w - 12, h - 12);
        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 26px Arial";
        ctx.textAlign = "center";
        ctx.fillText("BUS STOP", w / 2, 40);
        ctx.fillRect(22, 62, 84, 52);                 // bus body
        ctx.fillStyle = "#1f5fa8";
        for (let i = 0; i < 4; i++) ctx.fillRect(28 + i * 20, 68, 14, 18);
        ctx.fillStyle = "#ffffff";
        ctx.beginPath(); ctx.arc(40, 118, 8, 0, 7); ctx.arc(88, 118, 8, 0, 7); ctx.fill();
      });
      const side = new THREE.MeshLambertMaterial({ color: 0xe8e8e8 });
      const plate = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.75, 0.6), [new THREE.MeshLambertMaterial({ map: tex }), side, side, side, side, side]);
      plate.position.set(bp.x + 0.06, 2.0, bp.z);
      root.add(plate);
      const c = makeCylinderCollider(bp.x, bp.z, 0.08, 2.4);
      c.render = false; c.seeThrough = true; c.fx = "metal";
      addCollider(c);
    }

    // ---- ROAD CLOSED / SIDEWALK CLOSED barricades (campus builder) -------
    const closureResult = window.campusKit.buildClosureBarricades(THREE, root, CLOSURES, {
      mapToWorld, groundHeightAt: () => 0, makeCollider, canvasTexture, mapScale: MAP2_BASE_M_PER_PX, sidewalkWidthPx: 16, mapCenter,
      barrierHeight: BARRIER_HEIGHT_M,
      addCollider: (c) => addCollider(c),
    });

    // ---- invisible polygon walls (the real seal) ------------------------
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i], b = polygon[(i + 1) % polygon.length];
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      const wall = makeCollider((a.x + b.x) / 2, (a.z + b.z) / 2, len / 2 + 0.3, 0.3, BARRIER_HEIGHT_M, Math.atan2(-(b.z - a.z), b.x - a.x));
      wall.render = false; wall.seeThrough = true; wall.noImpact = true;
      addCollider(wall);
    }

    // ---- parked cars -----------------------------------------------------
    const parkingSpaces = CARS.map(([px, py, yaw, extra], i) => {
      const p = mapToWorld(px, py);
      return { x: p.x, z: p.z, yaw, width: 2.7, depth: 5.9, lot: "map2-car-" + i, occupancy: 1, noBackIn: true, ...extra };
    });
    const vehicleSystem = window.createParkedVehicleSystem
      ? window.createParkedVehicleSystem(THREE, root, parkingSpaces, { groundHeightAt: () => 0 })
      : null;

    // ---- house number plates (one atlas, one merged mesh) -----------------
    if (plates.length) {
      const names = [...new Set(plates.map((p) => p.text))];
      const cols = 4, rowsN = Math.ceil(names.length / cols);
      const atlas = canvasTexture(cols * 128, rowsN * 64, (ctx, w, h) => {
        ctx.fillStyle = "#f2f0e6";
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = "#1a1a1a";
        ctx.font = "bold 40px Arial";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        names.forEach((t, i) => ctx.fillText(t, (i % cols) * 128 + 64, Math.floor(i / cols) * 64 + 34));
      });
      const pos = [], uv = [], idx = [];
      for (const p of plates) {
        const i = names.indexOf(p.text), u0 = (i % cols) / cols, v0 = 1 - (Math.floor(i / cols) + 1) / rowsN;
        const hw = 0.28, hh = 0.14, c = Math.cos(p.yaw), s = Math.sin(p.yaw);
        const base = pos.length / 3;
        for (const [lx, ly] of [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]]) pos.push(p.x + lx * c + 0.0, p.y + ly, p.z - lx * s);
        uv.push(u0, v0, u0 + 1 / cols, v0, u0 + 1 / cols, v0 + 1 / rowsN, u0, v0 + 1 / rowsN);
        idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx);
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ map: atlas, side: THREE.DoubleSide }));
      m.frustumCulled = false;
      root.add(m);
    }

    // ---- flush the instanced lists -----------------------------------------
    function flush(list, geometry, material) {
      const items = lists[list];
      if (!items.length) return;
      const mesh = new THREE.InstancedMesh(geometry, material, items.length);
      items.forEach((it, i) => { mesh.setMatrixAt(i, it.m); mesh.setColorAt(i, it.c); });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.frustumCulled = false;
      root.add(mesh);
    }
    flush("prop", unitBox, propMaterial);
    flush("siding", unitBox, sidingMaterial);
    flush("interior", unitBox, interiorMaterial);
    flush("gable", gableGeo, roofMaterial);
    flush("hip", hipGeo, roofMaterial);
    flush("gableEnd", gableEndGeo, endMaterial);

    // ---- world queries -------------------------------------------------------
    const pxRectsWorldCheck = (px, py, rects) => rects.some((r) => inRect(px, py, r));
    const concreteRects = [...SIDEWALKS, ...DRIVEWAYS, ...FRONT_WALKS];
    function pxInQuad(px, py, q) {
      if (px < q[0][0] || px > q[1][0]) return false;
      const k = (px - q[0][0]) / (q[1][0] - q[0][0]);
      return py >= q[0][1] + (q[1][1] - q[0][1]) * k && py <= q[3][1] + (q[2][1] - q[3][1]) * k;
    }
    function onFootpath(x, z) {
      for (const { half, pts } of footpaths) {
        for (let i = 0; i < pts.length - 1; i++) {
          const a = pts[i], b = pts[i + 1], dx = b.x - a.x, dz = b.z - a.z;
          const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz)));
          if (Math.hypot(x - (a.x + dx * t), z - (a.z + dz * t)) <= half) return true;
        }
      }
      return false;
    }
    function groundMaterialAt(x, z, feetY = 0) {
      const p = pxOfWorld(x, z);
      if (feetY > 0.05) return "floor";
      if (pxRectsWorldCheck(p.x, p.y, ASPHALT)) return "asphalt";
      if (pxRectsWorldCheck(p.x, p.y, concreteRects)) return "concrete";
      if (DRIVE_QUADS.some((q) => pxInQuad(p.x, p.y, q))) return "concrete";
      if (onFootpath(x, z)) return "concrete";
      return "grass";
    }
    function surfaceAt(x, z, feetY = 0) {
      if (feetY > 0.05) return "concrete";
      const m = groundMaterialAt(x, z, feetY);
      return m === "grass" ? "grass" : "concrete";
    }

    // Level-aware floor: the lawn is 0, a basement/tunnel is -BASEMENT_DEPTH, a stair is a smooth slope. A point inside a stair
    // volume only has the stair under it; elsewhere the floor is the highest level at or below the body's reach (fromY), and
    // the lawn counts only for bodies at ground level or higher (so someone in a basement never gets lifted onto the grass).
    function levelBaseAt(x, z, fromY) {
      let best = -Infinity, lowest = Infinity, any = false;
      for (const p of pits) {
        if (x < p.x0 || x > p.x1 || z < p.z0 || z > p.z1) continue;
        const f = p.floorAt(x, z);
        if (p.stair) return f; // the stair volume: only the stair is under you
        any = true;
        if (f < lowest) lowest = f;
        if (f <= fromY + 0.01 && f > best) best = f;
      }
      if (!any) return 0;
      if (fromY >= -0.01 && best < 0) best = 0; // ground level or above: the lawn / the slab above is the floor
      return best === -Infinity ? lowest : best;
    }
    // The visible surface at a point (rays, impacts): the lawn, or the stair seen down an open stairwell.
    function surfaceHeightAt(x, z) {
      for (const p of pits) if (p.stair && p.hole && x > p.hole.x0 && x < p.hole.x1 && z > p.hole.z0 && z < p.hole.z1) return p.floorAt(x, z);
      return 0;
    }
    const queries = window.createColliderQueries({ colliders, bounds, groundHeightAt: surfaceHeightAt, levelBaseAt, stepUpHeight: STEP_UP_M, groundMaterialAt });
    const cars = window.createCarQueries(vehicleSystem, queries);

    // ---- spawn rules: exclusion region, reachability, house interiors -----------------
    const exclusionRects = EXCLUSION_PX.map((r) => {
      const a = mapToWorld(r[0], r[1]), b = mapToWorld(r[2], r[3]);
      return { minX: Math.min(a.x, b.x), maxX: Math.max(a.x, b.x), minZ: Math.min(a.z, b.z), maxZ: Math.max(a.z, b.z) };
    });
    const isSpawnExcluded = (x, z, margin = 0) => exclusionRects.some((r) => x > r.minX - margin && x < r.maxX + margin && z > r.minZ - margin && z < r.maxZ + margin);
    // true inside the walls of a hollow house (its rooms: walkable, but not somewhere to spawn)
    const isInsideHouseInterior = (x, z, margin = 0) => houseRecords.some((h) => h.hollow && Math.abs(x - h.x) < h.halfX + margin && Math.abs(z - h.z) < h.halfZ + margin);

    // ---- spawns ---------------------------------------------------------------
    const pvpSpawnPoints = SPAWNS_PX.map(([px, py, yaw]) => {
      let p = mapToWorld(px, py);
      const ok = (q) => queries.isWalkable(q.x, q.z, 0.8) && insidePlayableEdge(q.x, q.z, 2) && !isSpawnExcluded(q.x, q.z, 0.5) && !isInsideHouseInterior(q.x, q.z, 0.5);
      if (!ok(p)) {
        // nudge toward the map centre, 0.5 m at a time, up to 6 m
        const dx = mapCenter.x - p.x, dz = mapCenter.z - p.z, d = Math.hypot(dx, dz) || 1;
        let found = null;
        for (let s = 0.5; s <= 6 && !found; s += 0.5) {
          for (const k of [0, 1, -1, 2, -2]) {
            const ang = Math.atan2(dz, dx) + k * 0.6;
            const q = { x: p.x + Math.cos(ang) * s, z: p.z + Math.sin(ang) * s };
            if (ok(q)) { found = q; break; }
          }
        }
        if (found) { console.warn("map2: nudged spawn", px, py); p = found; } else console.warn("map2: spawn blocked", px, py);
      }
      return [p.x, p.z, yaw];
    });

    // ---- reachability (flood fill from the first fixed spawn) ---------------------------
    // Flood fill over walkable ground (0.4 m cells, 0.4 m body) from the first fixed spawn: cells it cannot reach (the sealed
    // yard, garage interiors, pockets behind fences) are never valid spawn / pickup points. Built on first use.
    let reach = null;
    function buildReach() {
      const cell = 0.4, R = 0.4;
      const nx = Math.ceil((bounds.maxX - bounds.minX) / cell) + 1, nz = Math.ceil((bounds.maxZ - bounds.minZ) / cell) + 1;
      const open = new Uint8Array(nx * nz), seen = new Uint8Array(nx * nz);
      const at = (i, j) => ({ x: bounds.minX + i * cell, z: bounds.minZ + j * cell });
      for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
        const p = at(i, j);
        open[j * nx + i] = insidePlayableEdge(p.x, p.z, 0.4) && queries.isWalkable(p.x, p.z, R) ? 1 : 0;
      }
      const s0 = pvpSpawnPoints[0];
      let si = Math.round((s0[0] - bounds.minX) / cell), sj = Math.round((s0[1] - bounds.minZ) / cell);
      const queue = [];
      if (open[sj * nx + si]) { queue.push(sj * nx + si); seen[sj * nx + si] = 1; }
      for (let h = 0; h < queue.length; h++) {
        const k = queue[h], i = k % nx, j = (k - i) / nx;
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const a = i + di, b = j + dj;
          if (a < 0 || b < 0 || a >= nx || b >= nz) continue;
          const q = b * nx + a;
          if (open[q] && !seen[q]) { seen[q] = 1; queue.push(q); }
        }
      }
      reach = { cell, nx, nz, seen, open, count: queue.length };
      return reach;
    }
    const reachState = () => reach || buildReach();
    function isReachable(x, z) {
      const r = reachState();
      const i = Math.round((x - bounds.minX) / r.cell), j = Math.round((z - bounds.minZ) / r.cell);
      return i >= 0 && j >= 0 && i < r.nx && j < r.nz && r.seen[j * r.nx + i] === 1;
    }
    // every reachable cell centre on a coarser lattice (for 'nearest valid point' searches), outside the exclusion and house interiors
    let reachablePointsCache = null;
    function reachablePoints() {
      if (reachablePointsCache) return reachablePointsCache;
      const r = reachState(), out = [], stride = 3;
      for (let j = 0; j < r.nz; j += stride) for (let i = 0; i < r.nx; i += stride) {
        if (!r.seen[j * r.nx + i]) continue;
        const x = bounds.minX + i * r.cell, z = bounds.minZ + j * r.cell;
        if (isSpawnExcluded(x, z) || isInsideHouseInterior(x, z, 0.3) || !queries.isWalkable(x, z, 0.8) || !insidePlayableEdge(x, z, 2)) continue;
        out.push({ x, z });
      }
      return (reachablePointsCache = out);
    }

    const roadRectsWorld = [ROAD_11TH, ROAD_4TH].map(worldRect).map(([x1, z1, x2, z2]) => ({
      minX: Math.max(x1, bounds.minX - 10), maxX: Math.min(x2, bounds.maxX + 10), minZ: Math.max(z1, bounds.minZ - 10), maxZ: Math.min(z2, bounds.maxZ + 10),
    }));

    function updateVisibility(viewers, views, lodScale = 1) {
      if (treeSystem) treeSystem.updateVisibility(viewers, lodScale);
      if (vehicleSystem) vehicleSystem.update(viewers, views, lodScale);
    }

    // ---- indoor spawns: ground floors, garages and basements of the hollow buildings ---------------------------------
    // A 1.5 m lattice inside every hollow room (floor height from the region's floorY) and inside every basement pit (floor -DEP).
    // A candidate is kept when a 0.5 m body stands there unmoved, the floor under it is the expected one (so stairwell holes
    // and stair treads drop out) and there is at least 2.4 m of headroom. Built on first use.
    let interiorSpawnsCache = null;
    function interiorSpawns() {
      if (interiorSpawnsCache) return interiorSpawnsCache;
      const out = [], R = 0.5, STEP = 1.5, tmp = { x: 0, y: 0, z: 0 };
      const tryAdd = (x, z, feet, cx, cz) => {
        if (isSpawnExcluded(x, z, 0.5)) return;
        tmp.x = x; tmp.z = z;
        queries.resolveCircle(tmp, R, feet + 0.05, true, 1.85);
        if (Math.abs(tmp.x - x) > 1e-4 || Math.abs(tmp.z - z) > 1e-4) return;
        const floor = queries.supportHeightAt(x, z, R, feet + 0.05);
        if (Math.abs(floor - feet) > 0.05) return;
        if (queries.ceilingAt(x, z, R, feet + 1.4) < feet + 2.4) return;
        out.push([x, z, Math.atan2(-(cx - x), -(cz - z)), feet]); // faces the room's middle
      };
      const lattice = (x0, z0, x1, z1, feet) => {
        const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, m = 1.0;
        for (let x = x0 + m; x <= x1 - m + 1e-6; x += STEP) for (let z = z0 + m; z <= z1 - m + 1e-6; z += STEP) tryAdd(x, z, feet, cx, cz);
      };
      for (const spec of Object.values(regionSpecs)) for (const r of spec.rects) lattice(r.x0, r.z0, r.x1, r.z1, r.floorY || 0);
      for (const p of pits) if (!p.stair && p.x0 !== tunnelW.x0) lattice(p.x0, p.z0, p.x1, p.z1, p.floorAt(0, 0));
      return (interiorSpawnsCache = out);
    }

    // ZONE mode hill: below ground inside any basement, stairwell or the tunnel
    const isUnderground = (x, z, feetY) => feetY < -1.0 && pits.some((p) => x > p.x0 && x < p.x1 && z > p.z0 && z < p.z1);
    const sp = pvpSpawnPoints[0];
    return {
      id: "map2",
      isUnderground,
      interiorSpawns,
      root,
      bounds,
      zones: [],
      mapToWorld,
      spawn: { x: sp[0], z: sp[1] },
      stepUpHeight: STEP_UP_M,
      renderDistance: 450,
      groundHeightAt: surfaceHeightAt,
      levelBaseAt, pits, stairs: STAIRS, tunnel: tunnelW,
      resolveCircle: queries.resolveCircle,
      supportHeightAt: queries.supportHeightAt,
      ceilingAt: queries.ceilingAt,
      segmentBlocked: queries.segmentBlocked,
      isWalkable: queries.isWalkable,
      raycast: queries.raycast,
      distanceToNearestBuilding: queries.distanceToNearestBuilding,
      minimapFootprints: queries.minimapFootprints,
      insidePlayableEdge,
      vehicleBlocksShot: cars.vehicleBlocksShot,
      carAt: cars.carAt, carClimbSlots: cars.carClimbSlots, clampToCarTop: cars.clampToCarTop, carRecords: cars.carRecords,
      groundMaterialAt,
      surfaceAt,
      updateStreetLights: () => {},
      prepareLights: () => {},
      streetLightCount: () => 0,
      prewarmObjects: () => [],
      prepareView: () => {},
      endViews: () => {},
      navLevelAt: () => null,
      isOnStairPortal: () => false,
      isInsideHollowBuilding: () => false,
      spotsBehindBuildings: () => [],
      enclosureMask: () => 0,
      isSameFenceSide: () => true,
      findPath: () => null,
      navChunkCount: () => 0,
      distanceToZone: () => 0,
      updateVisibility,
      environment,
      treeDensityNear: (x, z, r) => (treeSystem ? treeSystem.treeDensityNear(x, z, r) : 0),
      treeStats: () => (treeSystem ? treeSystem.stats() : null),
      grassStats: () => null,
      vehicleStats: () => (vehicleSystem ? vehicleSystem.stats() : null),
      wetSurfaces: [
        { material: asphaltMaterial, darken: 0.38 },
        { material: concreteMaterial, darken: 0.3 },
        { material: curbMaterial, darken: 0.3 },
        { material: yellowPaintMaterial, darken: 0.18 },
        { material: grassMaterial, darken: 0.16 },
        { material: sidingMaterial, darken: 0.12 },
        { material: roofMaterial, darken: 0.2 },
      ],
      // map2-only
      pvpSpawnPoints,
      pvpSpawnTuning: { MIN_DISTANCE: 15, DISTANCE_CAP: 60 },
      // Final storm circle: the pink circle on 'topdownview - annotations.png' (px centre 462,245, radius ~78 px = ~15.4 m)
      pvpFinalZone: (() => { const p = mapToWorld(462, 245); return { x: p.x, z: p.z, radius: 78 * MAP2_M_PER_PX * MAP2_FINAL_ZONE_SCALE }; })(),
      pvpPickupSpots: [pvpSpawnPoints[6], [0, 0], (() => { const p = mapToWorld(420, 300); return [p.x, p.z]; })()],  // on the 1108 front lawn (never inside a house)
      pvpExclusionRects: exclusionRects,
      isSpawnExcluded, isInsideHouseInterior, isReachable, reachablePoints,
      reachInfo: () => { const r = reachState(); return { cell: r.cell, cells: r.nx * r.nz, open: r.open.reduce((a, v) => a + v, 0), reached: r.count }; },
      closures: {
        roads: closureResult.rows.map((r) => ({ x: r.x, z: r.z, axis: r.axis, length: r.length })),
        sidewalks: closureResult.sidewalkSigns.map((s) => ({ x: s.x, z: s.z, axis: s.axis })),
      },
      playablePolygon: polygon,
      houses: houseRecords,
      debugLists: lists,
      debugColliders: colliders,
      get openingRects() { return Object.values(regionSpecs).flatMap((sp) => sp.openings); },
      roofAccess: accessSteps,
      minimapRoads: () => roadRectsWorld,
      pxOfWorld,
      constants: { MAP2_SCALE_MULT, MAP2_M_PER_PX, MAP2_BASE_M_PER_PX, MAP2_LOT_SCALE, MAP2_FINAL_ZONE_SCALE, MAP2_ORIGIN_PX },
    };
  }

  window.buildMap2World = buildMap2World;
  window.MAP2_PX = { toWorld: mapToWorld, fromWorld: pxOfWorld, MAP2_SCALE_MULT, MAP2_M_PER_PX };
})();
