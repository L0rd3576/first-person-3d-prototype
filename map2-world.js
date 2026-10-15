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
  const MAP2_M_PER_PX = CAMPUS_ROAD_M * MAP2_SCALE_MULT / MAP2_ROAD_PX;  // 0.1975 m per image px
  const MAP2_ORIGIN_PX = { x: 177.5, y: 411 };       // centre of the 11th St / 4th Ave intersection
  const BARRIER_HEIGHT_M = 200;

  function mapToWorld(px, py) {
    return { x: (px - MAP2_ORIGIN_PX.x) * MAP2_M_PER_PX, z: (py - MAP2_ORIGIN_PX.y) * MAP2_M_PER_PX };
  }
  const pxOfWorld = (x, z) => ({ x: x / MAP2_M_PER_PX + MAP2_ORIGIN_PX.x, y: z / MAP2_M_PER_PX + MAP2_ORIGIN_PX.y });
  const inRect = (px, py, r) => px >= r[0] && px <= r[2] && py >= r[1] && py <= r[3];

  // ---- layout, image px ------------------------------------------------
  const ROAD_11TH = [142, -300, 213, 890];
  const ROAD_4TH = [-300, 372, 940, 450];
  const ASPHALT = [ROAD_11TH, ROAD_4TH, [55, 128, 105, 195]];  // + the west parking pad
  const SIDEWALKS = [
    [112, -300, 128, 890], [232, -300, 248, 890], [-300, 330, 940, 346], [-300, 482, 940, 498],
  ];
  const DRIVEWAYS = [
    [245, 125, 300, 160], [540, 280, 556, 372], [420, 498, 445, 590], [528, 450, 555, 590],
    // aprons across the boulevards where a drive meets the road
    [420, 450, 445, 498], [540, 346, 556, 372], [245, 98, 300, 125],
  ];
  const FRONT_WALKS = [[325, 272, 333, 338], [493, 275, 500, 338], [85, 240, 112, 247], [403, 275, 411, 338], [330, 338, 338, 346]];
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
  const HOUSES = [
    ["1104", [300, 188, 363, 272], "S", { storeys: 1.5, form: "gable-ns", wall: 0xe6dcc0, roof: 0x6f747a, porch: "deck", number: "1104" }],
    ["1104w", [298, 150, 345, 188], "S", { storeys: 1, form: "gable-ew", wall: 0xe6dcc0, roof: 0x4e5258, nodoor: true }],
    ["1108", [383, 210, 450, 275], "S", { storeys: 1, form: "gable-ew", wall: 0xe3d6a8, roof: 0x8a7c6c, porch: "stoop", number: "1108" }],
    ["1114", [466, 210, 540, 272], "S", { storeys: 1, form: "gable-ew", wall: 0xf1f1ee, roof: 0x7a5a48, porch: "stoop", number: "1114", chimney: [-0.22, -0.1], shutters: true }],
    ["1118", [595, 195, 640, 268], "S", { storeys: 2, form: "gable-ns", wall: 0xecebe6, roof: 0x7d8186, porch: "porch", number: "1118" }],
    ["1118w", [570, 175, 630, 195], "S", { storeys: 1, form: "gable-ew", wall: 0xecebe6, roof: 0x6a6e73, nodoor: true }],
    ["320", [302, 15, 372, 97], "W", { storeys: 1.5, form: "hip", wall: 0xf0efea, roof: 0x8a8f96, porch: "stoop", number: "320" }],
    ["321", [38, 205, 85, 262], "E", { storeys: 1, form: "gable-ns", wall: 0xeeede8, roof: 0x6c7886, porch: "stoop", number: "321" }],
    ["1101", [272, 522, 338, 590], "N", { storeys: 1, form: "gable-ew", wall: 0xe8dfc4, roof: 0x70757b, porch: "stoop", number: "1101" }],
    ["1109", [355, 522, 415, 590], "N", { storeys: 1, form: "gable-ew", wall: 0xb9bcbf, roof: 0x5b4a40, porch: "stoop", number: "1109", chimney: [-0.25, 0.1] }],
    ["1105", [462, 528, 528, 590], "N", { storeys: 1.5, form: "gable-ns", wall: 0xf1f1ee, roof: 0x9a3b33, porch: "stoop", number: "1105" }],
    ["1115", [565, 530, 620, 590], "N", { storeys: 1, form: "gable-ew", wall: 0xcfd2d4, roof: 0x73777c, porch: "stoop", number: "1115" }],
    ["garageW", [40, 115, 62, 137], "E", { height: 3.4, form: "gable-ew", wall: 0xf0efea, roof: 0x4a4d52, nodoor: true }],
    ["garageN", [455, 5, 480, 35], "S", { height: 3.4, form: "gable-ew", wall: 0xb9bcbf, roof: 0x4a4d52, nodoor: true }],
    ["houseNE", [618, 20, 640, 70], "W", { storeys: 1, form: "gable-ns", wall: 0xaeb2b5, roof: 0x6d7176, nodoor: true }],
    // backdrop: outside the playable polygon, drawn but not solid
    ["311", [0, 15, 75, 75], "E", { storeys: 1.5, form: "gable-ns", wall: 0xcdb892, roof: 0x5a3c36, backdrop: true, nodoor: true }],
    ["church", [-60, 512, 50, 590], "E", { storeys: 2, form: "gable-ew", wall: 0x8c5a44, roof: 0x5e4a40, backdrop: true, nodoor: true }],
  ];

  // [px, py, canopy radius px, flowering]
  const TREES = [
    [222, 285, 48], [455, 192, 45], [470, 100, 45], [365, 145, 32], [530, 30, 40], [600, 30, 35],
    [603, 118, 35], [405, 70, 30], [68, 292, 28], [72, 352, 30, true], [262, 103, 24], [552, 205, 22],
    [572, 272, 20], [630, 300, 22], [310, 462, 28, true], [255, 508, 30], [597, 462, 25], [630, 522, 20],
    [18, 112, 30], [15, 280, 25], [182, 80, 22],
  ];

  // [px, py, heading] -- campus convention: 0 = +x east, PI/2 = +z south
  const CARS = [
    [440, 383, Math.PI], [585, 383, Math.PI], [82, 137, Math.PI], [80, 157, Math.PI], [72, 180, Math.PI],
    [272, 143, 0], [548, 298, -Math.PI / 2], [548, 322, -Math.PI / 2], [540, 560, Math.PI / 2], [151, 250, Math.PI / 2],
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

    mergedPlanes([[-400, -400, 400, 400]], 0, 6, grassMaterial);
    mergedPlanes(SIDEWALKS.map(worldRect).concat(DRIVEWAYS.map(worldRect), FRONT_WALKS.map(worldRect)), 0.012, 1.5, concreteMaterial);
    mergedPlanes(ASPHALT.map(worldRect), 0.024, 6, asphaltMaterial);
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
    const lists = { prop: [], siding: [], gable: [], hip: [], gableEnd: [] };
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
    const roofMaterial = new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide });
    const endMaterial = new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide, map: sidingTexture });

    const PITCH = Math.tan(35 * Math.PI / 180);
    const OVERHANG = 0.3;
    const FLOOR_H = 2.9;
    const houseRecords = [];
    const plates = [];  // { text, x, y, z, yaw }

    const FACE = { N: { x: 0, z: -1 }, S: { x: 0, z: 1 }, E: { x: 1, z: 0 }, W: { x: -1, z: 0 } };
    const WOOD = 0x8a6a4a, WHITE = 0xf4f3ee, DARK = 0x3a3d40, FOUNDATION = 0x5a5d60, BRICK = 0x8c4a3a;

    function buildHouse([name, rectPx, front, o]) {
      const a = mapToWorld(rectPx[0], rectPx[1]), b = mapToWorld(rectPx[2], rectPx[3]);
      const cx = (a.x + b.x) / 2, cz = (a.z + b.z) / 2;
      const W = Math.abs(b.x - a.x), D = Math.abs(b.z - a.z);
      const wallH = o.height || (o.storeys > 1 ? 5.8 : 3.2);
      const out = FACE[front];
      const long = Math.abs(out.x) === 1 ? D : W; // facade length of the front
      const form = o.form;
      // walls (siding), on a dark foundation band
      put("siding", cx, 0.5 + (wallH - 0.5) / 2, cz, W, wallH - 0.5, D, 0, o.wall);
      box(cx, 0, cz, W + 0.08, 0.5, D + 0.08, 0, FOUNDATION);
      // roof
      const ridgeNS = form === "gable-ns";
      let roofTop = wallH;
      if (form === "hip") {
        const rise = Math.min(W, D) / 2 * PITCH + 0.3;
        put("hip", cx, wallH - OVERHANG * PITCH, cz, W + OVERHANG * 2, rise, D + OVERHANG * 2, 0, o.roof);
        roofTop = wallH - OVERHANG * PITCH + rise;
      } else {
        const span = ridgeNS ? W : D, len = ridgeNS ? D : W;
        const rise = (span / 2 + OVERHANG) * PITCH;
        const yaw = ridgeNS ? Math.PI / 2 : 0; // gable prism ridge runs along local x
        put("gable", cx, wallH - OVERHANG * PITCH, cz, len + OVERHANG * 2, rise, span + OVERHANG * 2, yaw, o.roof);
        put("gableEnd", cx, wallH, cz, len, span / 2 * PITCH, span, yaw, o.wall);
        roofTop = wallH - OVERHANG * PITCH + rise;
        if (o.crossGable) {
          // a small gable on the front (ridge across the main ridge), centred
          const cw = o.crossGable;
          const crise = (cw / 2 + OVERHANG) * PITCH;
          const depth = Math.min(span / 2, 3.2) + 0.6;
          const fx = cx + out.x * (Math.abs(out.x) ? W / 2 - depth / 2 + OVERHANG : 0), fz = cz + out.z * (Math.abs(out.z) ? D / 2 - depth / 2 + OVERHANG : 0);
          const cyaw = Math.abs(out.z) === 1 ? Math.PI / 2 : 0;
          put("gable", fx, wallH - OVERHANG * PITCH + 0.08, fz, depth + OVERHANG, crise, cw + OVERHANG * 2, cyaw, o.roof);
        }
      }
      if (o.chimney) {
        const hx = cx + o.chimney[0] * W, hz = cz + o.chimney[1] * D;
        box(hx, roofTop - 1.6, hz, 0.8, 2.2, 0.8, 0, BRICK);
        box(hx, roofTop + 0.6, hz, 0.95, 0.12, 0.95, 0, 0x6b6e70);
      }
      // collider: the whole footprint, up to the ridge
      if (!o.backdrop) {
        const c = makeCollider(cx, cz, W / 2, D / 2, roofTop, 0);
        c.style = "house";
        addCollider(c);
        houseRecords.push({ name, x: cx, z: cz, halfX: W / 2, halfZ: D / 2, height: roofTop });
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
        const us = [];
        if (isFront && !o.nodoor) {
          for (const k of [-1, 1]) for (let i = 1; Math.abs(doorU + k * i * 2.7) < L / 2 - 0.9 && i <= 2; i++) us.push(doorU + k * i * 2.7);
        } else {
          const count = Math.max(1, Math.floor((L - 1.2) / 3.4));
          for (let i = 0; i < count; i++) us.push((i + 0.5) * (L / count) - L / 2);
        }
        const floors = o.storeys > 1 ? 2 : 1;
        for (const u of us) {
          for (let f = 0; f < floors; f++) {
            if (o.height && f > 0) continue;
            const wy = (o.height ? 1.4 : 1.15) + f * FLOOR_H;
            const wh = o.height ? 1.0 : 1.35;
            const px = cx + n.x * half + along.x * u, pz = cz + n.z * half + along.z * u;
            box(px + n.x * 0.03, wy - 0.1, pz + n.z * 0.03, 1.3 * Math.abs(along.x) + 0.07 * Math.abs(n.x), 1.55, 1.3 * Math.abs(along.z) + 0.07 * Math.abs(n.z), 0, WHITE);
            box(px + n.x * 0.06, wy, pz + n.z * 0.06, 1.1 * Math.abs(along.x) + 0.05 * Math.abs(n.x), wh, 1.1 * Math.abs(along.z) + 0.05 * Math.abs(n.z), 0, 0x39495a);
            if (o.shutters && isFront) {
              for (const k of [-1, 1]) {
                box(px + along.x * k * 0.78 + n.x * 0.06, wy, pz + along.z * k * 0.78 + n.z * 0.06, 0.36 * Math.abs(along.x) + 0.06 * Math.abs(n.x), wh, 0.36 * Math.abs(along.z) + 0.06 * Math.abs(n.z), 0, 0x1c1c1e);
              }
            }
          }
        }
        if (!isFront || o.nodoor) continue;
        // door + trim
        const dx = cx + n.x * half + along.x * doorU, dz = cz + n.z * half + along.z * doorU;
        box(dx + n.x * 0.05, 0, dz + n.z * 0.05, 1.05 * Math.abs(along.x) + 0.1 * Math.abs(n.x), 2.1, 1.05 * Math.abs(along.z) + 0.1 * Math.abs(n.z), 0, o.doorColor || 0xf6f6f2);
        box(dx + n.x * 0.04, 2.1, dz + n.z * 0.04, 1.3 * Math.abs(along.x) + 0.08 * Math.abs(n.x), 0.14, 1.3 * Math.abs(along.z) + 0.08 * Math.abs(n.z), 0, WHITE);
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
        }
        const sc = makeCollider(sx0, sz0, (slabW * nz + slabD * nx) / 2, (slabW * nx + slabD * nz) / 2, slabH, 0);
        sc.render = false; sc.seeThrough = true; sc.fx = "wood";
        addCollider(sc);
        // railings: along both sides and the front edge (leaving the steps open)
        const railColor = kind === "stoop" ? 0xe8e8e4 : 0x7a5c3e;
        for (const k of [-1, 1]) {
          const rx = dx + along.x * k * (slabW / 2 - 0.05) + n.x * (slabD / 2), rz = dz + along.z * k * (slabW / 2 - 0.05) + n.z * (slabD / 2);
          box(rx, slabH, rz, 0.05 * nz + (slabD - 0.1) * nx, 0.9, 0.05 * nx + (slabD - 0.1) * nz, 0, railColor);
        }
        if (kind !== "stoop") {
          for (const k of [-1, 1]) {
            const rx = dx + along.x * k * (slabW / 2 - 0.6 + 0.0) * 1.0 + n.x * (slabD - 0.05), rz = dz + along.z * k * (slabW / 2 - 0.6) + n.z * (slabD - 0.05);
            box(rx, slabH, rz, (slabW / 2 - 1.0) * nz + 0.05 * nx, 0.9, (slabW / 2 - 1.0) * nx + 0.05 * nz, 0, railColor);
          }
        }
        if (kind === "porch") {
          for (const k of [-1, 1]) box(dx + along.x * k * (slabW / 2 - 0.12) + n.x * (slabD - 0.12), slabH, dz + along.z * k * (slabW / 2 - 0.12) + n.z * (slabD - 0.12), 0.14, 2.5, 0.14, 0, WHITE);
          box(sx0, slabH + 2.5, sz0, slabW * nz + slabD * nx, 0.14, slabW * nx + slabD * nz, 0, o.roof);
        }
      }
    }
    for (const h of HOUSES) buildHouse(h);

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
    fenceEdge("h", 98, [[36, 105], [248, 302]], [[128, 142], [213, 232]]);   // A-B
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
      mapToWorld, groundHeightAt: () => 0, makeCollider, canvasTexture, mapScale: MAP2_M_PER_PX, sidewalkWidthPx: 16, mapCenter,
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
    const parkingSpaces = CARS.map(([px, py, yaw], i) => {
      const p = mapToWorld(px, py);
      return { x: p.x, z: p.z, yaw, width: 2.7, depth: 5.9, lot: "map2-car-" + i, occupancy: 1, noBackIn: true };
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
    flush("gable", gableGeo, roofMaterial);
    flush("hip", hipGeo, roofMaterial);
    flush("gableEnd", gableEndGeo, endMaterial);

    // ---- world queries -------------------------------------------------------
    const pxRectsWorldCheck = (px, py, rects) => rects.some((r) => inRect(px, py, r));
    const concreteRects = [...SIDEWALKS, ...DRIVEWAYS, ...FRONT_WALKS];
    function groundMaterialAt(x, z, feetY = 0) {
      const p = pxOfWorld(x, z);
      if (feetY > 0.05) return "floor";
      if (pxRectsWorldCheck(p.x, p.y, ASPHALT)) return "asphalt";
      if (pxRectsWorldCheck(p.x, p.y, concreteRects)) return "concrete";
      return "grass";
    }
    function surfaceAt(x, z, feetY = 0) {
      if (feetY > 0.05) return "concrete";
      const m = groundMaterialAt(x, z, feetY);
      return m === "grass" ? "grass" : "concrete";
    }

    const queries = window.createColliderQueries({ colliders, bounds, groundHeightAt: () => 0, stepUpHeight: STEP_UP_M, groundMaterialAt });
    const cars = window.createCarQueries(vehicleSystem, queries);

    // ---- spawns ---------------------------------------------------------------
    const pvpSpawnPoints = SPAWNS_PX.map(([px, py, yaw]) => {
      let p = mapToWorld(px, py);
      const ok = (q) => queries.isWalkable(q.x, q.z, 0.8) && insidePlayableEdge(q.x, q.z, 2);
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

    const roadRectsWorld = [ROAD_11TH, ROAD_4TH].map(worldRect).map(([x1, z1, x2, z2]) => ({
      minX: Math.max(x1, bounds.minX - 10), maxX: Math.min(x2, bounds.maxX + 10), minZ: Math.max(z1, bounds.minZ - 10), maxZ: Math.min(z2, bounds.maxZ + 10),
    }));

    function updateVisibility(viewers, views, lodScale = 1) {
      if (treeSystem) treeSystem.updateVisibility(viewers, lodScale);
      if (vehicleSystem) vehicleSystem.update(viewers, views, lodScale);
    }

    const sp = pvpSpawnPoints[0];
    return {
      id: "map2",
      root,
      bounds,
      zones: [],
      mapToWorld,
      spawn: { x: sp[0], z: sp[1] },
      stepUpHeight: STEP_UP_M,
      renderDistance: 450,
      groundHeightAt: () => 0,
      resolveCircle: queries.resolveCircle,
      supportHeightAt: queries.supportHeightAt,
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
      pvpFinalZone: (() => { const p = mapToWorld(462, 245); return { x: p.x, z: p.z, radius: 78 * MAP2_M_PER_PX }; })(),
      pvpPickupSpots: [pvpSpawnPoints[6], [0, 0], (() => { const p = mapToWorld(420, 250); return [p.x, p.z]; })()],
      closures: {
        roads: closureResult.rows.map((r) => ({ x: r.x, z: r.z, axis: r.axis, length: r.length })),
        sidewalks: closureResult.sidewalkSigns.map((s) => ({ x: s.x, z: s.z, axis: s.axis })),
      },
      playablePolygon: polygon,
      houses: houseRecords,
      minimapRoads: () => roadRectsWorld,
      pxOfWorld,
      constants: { MAP2_SCALE_MULT, MAP2_M_PER_PX, MAP2_ORIGIN_PX },
    };
  }

  window.buildMap2World = buildMap2World;
  window.MAP2_PX = { toWorld: mapToWorld, fromWorld: pxOfWorld, MAP2_SCALE_MULT, MAP2_M_PER_PX };
})();
