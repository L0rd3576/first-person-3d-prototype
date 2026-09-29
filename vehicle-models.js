// Parked vehicles: static scenery cars in the parking lots. VISUAL ONLY --
// no colliders, physics, lights or per-car logic; nothing in gameplay
// (movement, zombies, navigation, spawning) knows they exist.
//
//   - PARKED_VEHICLE_CONFIG: every tunable (occupancy per lot profile,
//     model and color weights, variation, LOD and cull distances, seed).
//   - Ten procedural everyday models (hatchback, compact / midsize /
//     full-size sedans, an older economy sedan, crossover, compact and
//     midsize SUVs, midsize pickup, minivan), built from real-world
//     dimensions: each body is a loft of cross-sections along its length
//     (bumpers, hood, windshield, roof, rear window, trunk or hatch, wheel
//     arches, tumblehome), with wheels, rims, lights, grille, plates,
//     mirrors, door seams and handles as small separate pieces.
//   - Four LODs: LOD0 (near) has everything; LOD1 drops mirrors, seams,
//     handles and hubs and uses fewer sections; LOD2 (far) is one coarse
//     shape per body class (sedan, two-box, pickup) scaled to each model.
//     Past VEHICLE_SIMPLE_DISTANCE every car is LOD3, one very simple
//     shared shape (body, cabin, roof, wheels) scaled to each car -- never
//     removed for distance, only when out of every player's view.
//   - One shared Phong material for every car: a per-vertex part id picks
//     the surface (paint, glass, rubber, rim, trim, chrome, lights, plate,
//     dark) and per-instance data carries the paint color, gloss, age,
//     glass tint and rim finish -- no per-car materials or textures.
//   - Every model x LOD is one InstancedMesh; each car is an instance.
//     LOD assignment runs a few times a second from the viewers'
//     positions; a car changing LOD cross-fades over VEHICLE_LOD_FADE_TIME
//     with a screen-space dither (no popping, no transparency sorting).
//   - A soft shadow under every drawn car, all in one instanced draw.
//
// Usage: const v = createParkedVehicleSystem(THREE, root, spaces, options);
//   spaces: [{ x, z, yaw, width, depth, lot, occupancy | profile }] -- yaw =
//   the direction a car parked nose-in faces (radians, 0 = +x); lot = a lot
//   key; occupancy = the exact share of the lot's spaces taken, or else
//   profile = a key of PARKING_OCCUPANCY (a share drawn per lot); bias
//   (optional) = "west": the taken spaces lean toward the lot's west side;
//   count (optional) = exactly this many cars in the lot instead of a
//   share; noBackIn = never backed in (street parking faces the traffic).
//   options.groundHeightAt(x, z)
//   v.update(viewers, views)   // once per frame, viewers = [{x, z}, ...];
//     views (optional) = [{x, z, fx, fz, cos}] -- see cullToViews
//   v.stats()
(function () {
  "use strict";

  const PARKED_VEHICLE_CONFIG = {
    SEED: 1987,
    VEHICLE_DENSITY: 1.0,           // multiplies every lot's occupancy
    // Occupancy per lot profile: each lot draws its own share in [min, max].
    PARKING_OCCUPANCY: {
      busy: [0.72, 0.9],            // big central lots
      normal: [0.5, 0.8],
      quiet: [0.3, 0.62],           // small side lots, remote lots
      residential: [0.7, 0.88],
    },
    BACKED_IN_SHARE: 0.12,          // cars that reversed into their space
    VEHICLE_MODEL_WEIGHTS: {
      compactSedan: 14, midsizeSedan: 16, fullsizeSedan: 6, hatchback: 8, olderEconomy: 5,
      crossover: 12, compactSUV: 16, midsizeSUV: 10, pickup: 9, minivan: 5,
    },
    // Paint categories: [weight, [shades...]] -- realistic automotive colors.
    VEHICLE_COLOR_WEIGHTS: {
      white: [18, [0xe9e8e3, 0xdedcd5, 0xf0efeb, 0xe4e2da]],
      black: [20, [0x131416, 0x1b1c1f, 0x17181b]],
      gray: [20, [0x5b5f63, 0x3d4145, 0x74787c, 0x4a4e52]],
      silver: [15, [0xb4b8bc, 0xa3a8ac, 0xc3c5c7]],
      darkBlue: [7, [0x1f2d4a, 0x2a3a5c, 0x243553]],
      red: [5, [0x7a1b1e, 0x93242a, 0x5f1619]],
      darkGreen: [3, [0x203c2d, 0x2d4735]],
      tan: [3, [0xb8a988, 0xa59878]],
      brown: [2, [0x4f3b2c, 0x5e4737]],
      other: [3, [0x355f70, 0x9c7a35, 0x5c3048, 0x4d6784]],
    },
    AGE_WEIGHTS: { newer: 35, middle: 45, older: 20 },
    VEHICLE_VARIATION_AMOUNT: 1.0,  // 0 = identical cars of a color; 1 = the designed subtle spread
    PARKING_JITTER_M: 0.12,         // how far off center a car may sit (sideways; forward is limited by the space)
    PARKING_JITTER_DEG: 1.4,        // max heading error
    VEHICLE_LOD_DISTANCES: [20, 60], // LOD0 -> LOD1, LOD1 -> LOD2 (m)
    VEHICLE_SIMPLE_DISTANCE: 115,   // past this, every car is the simple LOD3 shape (never culled by distance)
    VEHICLE_LOD_FADE_TIME: 0.35,    // s cross-fade between LODs
    LOD_UPDATE_INTERVAL: 0.15,      // s between LOD re-assignments
    SHADOW_OPACITY: 0.5,
  };

  // Real-world dimensions (m). L length, W width, H height, clr ground
  // clearance, r wheel radius, fo / ro front / rear overhang. The profile
  // (all along the length from the front bumper): nose = bumper-top height,
  // hoodF = hood height at the front, cowl = where the hood meets the
  // windshield (x, height), aTop = top of the windshield (x), roofEnd = rear
  // end of the roof (x), deck = where the rear window meets the trunk / the
  // hatch bottom (x, height), tail = height at the rear bumper top; belt =
  // window line (front, rear); tumble = roof width / body width.
  const MODELS = {
    hatchback: { L: 4.2, W: 1.76, H: 1.47, clr: 0.15, r: 0.315, fo: 0.86, ro: 0.72, cls: "twobox",
      nose: 0.68, hoodF: 0.8, cowl: [1.3, 0.98], aTop: 2.15, roofEnd: 3.72, deck: [4.05, 0.98], tail: 0.95, belt: [0.97, 1.02], tumble: 0.8 },
    compactSedan: { L: 4.45, W: 1.76, H: 1.44, clr: 0.15, r: 0.315, fo: 0.9, ro: 0.95, cls: "sedan",
      nose: 0.66, hoodF: 0.77, cowl: [1.35, 0.96], aTop: 2.2, roofEnd: 3.2, deck: [3.78, 1.02], tail: 0.95, belt: [0.96, 1.02], tumble: 0.79 },
    midsizeSedan: { L: 4.88, W: 1.84, H: 1.45, clr: 0.15, r: 0.33, fo: 0.95, ro: 1.1, cls: "sedan",
      nose: 0.68, hoodF: 0.79, cowl: [1.58, 0.98], aTop: 2.42, roofEnd: 3.5, deck: [4.1, 1.03], tail: 0.97, belt: [0.97, 1.03], tumble: 0.79 },
    fullsizeSedan: { L: 5.1, W: 1.89, H: 1.48, clr: 0.14, r: 0.34, fo: 1.0, ro: 1.15, cls: "sedan",
      nose: 0.71, hoodF: 0.82, cowl: [1.72, 1.0], aTop: 2.55, roofEnd: 3.62, deck: [4.25, 1.05], tail: 1.0, belt: [0.99, 1.05], tumble: 0.8 },
    olderEconomy: { L: 4.45, W: 1.7, H: 1.4, clr: 0.16, r: 0.3, fo: 0.88, ro: 1.0, cls: "sedan", old: true,
      nose: 0.64, hoodF: 0.74, cowl: [1.3, 0.9], aTop: 1.98, roofEnd: 3.1, deck: [3.55, 0.96], tail: 0.94, belt: [0.9, 0.93], tumble: 0.86 },
    crossover: { L: 4.35, W: 1.8, H: 1.6, clr: 0.19, r: 0.34, fo: 0.88, ro: 0.82, cls: "twobox",
      nose: 0.78, hoodF: 0.9, cowl: [1.35, 1.08], aTop: 2.12, roofEnd: 3.92, deck: [4.2, 1.1], tail: 1.05, belt: [1.07, 1.12], tumble: 0.82 },
    compactSUV: { L: 4.6, W: 1.85, H: 1.7, clr: 0.2, r: 0.36, fo: 0.92, ro: 0.9, cls: "twobox",
      nose: 0.82, hoodF: 0.94, cowl: [1.45, 1.13], aTop: 2.2, roofEnd: 4.18, deck: [4.45, 1.12], tail: 1.08, belt: [1.12, 1.18], tumble: 0.84 },
    midsizeSUV: { L: 4.98, W: 1.99, H: 1.78, clr: 0.21, r: 0.38, fo: 0.96, ro: 1.0, cls: "twobox",
      nose: 0.86, hoodF: 1.0, cowl: [1.6, 1.2], aTop: 2.35, roofEnd: 4.6, deck: [4.84, 1.18], tail: 1.12, belt: [1.2, 1.24], tumble: 0.86 },
    pickup: { L: 5.35, W: 1.9, H: 1.8, clr: 0.24, r: 0.39, fo: 0.92, ro: 1.2, cls: "pickup",
      nose: 0.95, hoodF: 1.08, cowl: [1.55, 1.2], aTop: 2.2, roofEnd: 3.2, deck: [3.26, 1.2], tail: 1.15, belt: [1.2, 1.22], tumble: 0.86, bedRail: 1.2 },
    minivan: { L: 5.1, W: 1.99, H: 1.77, clr: 0.16, r: 0.34, fo: 0.95, ro: 1.05, cls: "twobox",
      nose: 0.76, hoodF: 0.9, cowl: [1.2, 1.12], aTop: 2.05, roofEnd: 4.78, deck: [4.98, 1.1], tail: 1.05, belt: [1.1, 1.14], tumble: 0.88, sliding: true },
  };

  // Surface ids (per vertex): the shader picks the look.
  const P = { paint: 0, glass: 1, rubber: 2, rim: 3, trim: 4, chrome: 5, headlight: 6, taillight: 7, plate: 8, dark: 9 };

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const lerp = (a, b, t) => a + (b - a) * t;
  // Piecewise-linear lookup in [[x, y], ...] (sorted by x).
  const piecewise = (pts, x) => {
    if (x <= pts[0][0]) return pts[0][1];
    for (let i = 1; i < pts.length; i++) {
      if (x <= pts[i][0]) return lerp(pts[i - 1][1], pts[i][1], (x - pts[i - 1][0]) / (pts[i][0] - pts[i - 1][0] || 1));
    }
    return pts[pts.length - 1][1];
  };

  // ------------------------------------------------------------------ geometry
  // A mesh under construction: triangles with a surface id each. Pieces
  // built with shared (indexed) vertices get smooth normals along them;
  // everything is merged into one non-indexed geometry at the end.
  function meshBuilder() {
    const pieces = [];
    return {
      // Indexed piece: verts [[x,y,z], ...], tris [[a,b,c], ...], one part id;
      // `inside` = a point the faces should point away from (or a function
      // of a triangle's centroid giving that point).
      piece(verts, tris, part, insideAt) {
        const pos = verts.flat();
        const idx = [];
        for (const [a, b, c] of tris) {
          const A = verts[a], B = verts[b], C = verts[c];
          const ux = B[0] - A[0], uy = B[1] - A[1], uz = B[2] - A[2];
          const vx = C[0] - A[0], vy = C[1] - A[1], vz = C[2] - A[2];
          const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
          const cen = [(A[0] + B[0] + C[0]) / 3, (A[1] + B[1] + C[1]) / 3, (A[2] + B[2] + C[2]) / 3];
          const inside = typeof insideAt === "function" ? insideAt(cen) : insideAt;
          const cx = cen[0] - inside[0], cy = cen[1] - inside[1], cz = cen[2] - inside[2];
          if (nx * nx + ny * ny + nz * nz < 1e-14) continue; // degenerate
          if (nx * cx + ny * cy + nz * cz < 0) idx.push(a, c, b); else idx.push(a, b, c);
        }
        if (idx.length) pieces.push({ pos, idx, part });
      },
      // An axis-aligned box piece (flat faces).
      box(cx, cy, cz, sx, sy, sz, part) {
        const x0 = cx - sx / 2, x1 = cx + sx / 2, y0 = cy - sy / 2, y1 = cy + sy / 2, z0 = cz - sz / 2, z1 = cz + sz / 2;
        const quads = [
          [[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]], [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]],
          [[x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]], [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]],
          [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], [[x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0]],
        ];
        for (const q of quads) this.piece(q, [[0, 1, 2], [0, 2, 3]], part, [cx, cy, cz]);
      },
      // A flat quad facing along `normal` (a detail decal on a surface).
      quad(corners, part, normal) {
        const c = corners.reduce((s, p) => [s[0] + p[0] / 4, s[1] + p[1] / 4, s[2] + p[2] / 4], [0, 0, 0]);
        this.piece(corners, [[0, 1, 2], [0, 2, 3]], part, [c[0] - normal[0], c[1] - normal[1], c[2] - normal[2]]);
      },
      // A wheel-like cylinder along z at (x, y, z): radius, width, segments.
      cylinderZ(x, y, z, radius, width, segments, sidePart, capPart, capOnlyOuter) {
        const ring = (zz) => Array.from({ length: segments }, (_, i) => {
          const a = (i / segments) * Math.PI * 2;
          return [x + Math.cos(a) * radius, y + Math.sin(a) * radius, zz];
        });
        const z0 = z - width / 2, z1 = z + width / 2;
        const r0 = ring(z0), r1 = ring(z1);
        const verts = [...r0, ...r1];
        const tris = [];
        for (let i = 0; i < segments; i++) {
          const j = (i + 1) % segments;
          tris.push([i, j, segments + j], [i, segments + j, segments + i]);
        }
        this.piece(verts, tris, sidePart, [x, y, z]);
        const outer = z >= 0 ? z1 : z0;
        for (const zz of capOnlyOuter ? [outer] : [z0, z1]) {
          const cap = [[x, y, zz], ...ring(zz)];
          const ct = [];
          for (let i = 0; i < segments; i++) ct.push([0, 1 + i, 1 + ((i + 1) % segments)]);
          this.piece(cap, ct, capPart, [x, y, zz === z1 ? zz - 1 : zz + 1]);
        }
      },
      // One indexed geometry (vertices shared within each piece, so the
      // GPU shades each once, not once per triangle).
      build(THREE) {
        const pos = [], nrm = [], part = [], index = [];
        for (const pc of pieces) {
          const g = new THREE.BufferGeometry();
          g.setAttribute("position", new THREE.Float32BufferAttribute(pc.pos, 3));
          g.setIndex(pc.idx);
          g.computeVertexNormals();
          const base = pos.length / 3;
          pos.push(...g.attributes.position.array);
          nrm.push(...g.attributes.normal.array);
          for (let i = 0; i < g.attributes.position.count; i++) part.push(pc.part);
          for (const i of pc.idx) index.push(base + i);
        }
        const out = new THREE.BufferGeometry();
        out.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
        out.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
        out.setAttribute("carPart", new THREE.Float32BufferAttribute(part, 1));
        out.setIndex(index);
        out.computeBoundingSphere();
        return out;
      },
    };
  }

  // One car body at a given detail: `m` a MODELS entry, lod 0 / 1 / 2.
  // Car space: +x forward (front bumper at +L/2), +y up, z across.
  function buildCar(THREE, m, lod) {
    const b = meshBuilder();
    const L = m.L, half = m.W / 2;
    const ax = [m.fo, L - m.ro]; // axles, from the front
    const pickup = m.cls === "pickup";
    // Top line along the length (x from the front bumper).
    const top = [
      [0, m.nose], [0.14, m.hoodF], [m.cowl[0], m.cowl[1]], [m.aTop, m.H], [m.roofEnd, m.H - 0.02],
      ...(pickup ? [[m.roofEnd + 0.02, m.bedRail], [L - 0.06, m.bedRail]] : [[m.deck[0], m.deck[1]], [L - 0.12, m.tail + 0.02]]),
      [L, m.tail],
    ];
    const topAt = (x) => piecewise(top, x);
    const beltAt = (x) => {
      const t = Math.min(1, Math.max(0, (x - m.cowl[0]) / (m.deck[0] - m.cowl[0])));
      return Math.min(topAt(x), lerp(m.belt[0], m.belt[1], t));
    };
    // Wheel arches in the body's lower edge.
    const archR = m.r * 1.12;
    const bottomAt = (x) => {
      let y = m.clr;
      for (const a of ax) {
        const d = Math.abs(x - a) / archR;
        if (d < 1) y = Math.max(y, m.clr + (m.r * 2 + 0.04 - m.clr) * Math.sqrt(1 - d * d));
      }
      return y;
    };
    // Rounded corners in plan, and the roof narrower than the body.
    const halfAt = (x) => {
      const e = Math.min(x, L - x);
      return half * (0.9 + 0.1 * Math.min(1, e / 0.38) ** 0.6);
    };
    // Stations along the length (more for nearer LODs).
    const xs = new Set([0, L, m.cowl[0], m.aTop, m.roofEnd, m.deck[0]]);
    if (lod < 2) {
      for (const x of lod === 0 ? [0.14, 0.4, L - 0.14, L - 0.4, (m.cowl[0] + m.aTop) / 2, (m.aTop + m.roofEnd) / 2, (m.roofEnd + m.deck[0]) / 2] : [0.14, L - 0.14]) xs.add(x);
      const archPts = lod === 0 ? [-1, -0.85, -0.55, -0.2, 0.2, 0.55, 0.85, 1] : [-1, -0.5, 0.5, 1];
      for (const a of ax) for (const t of archPts) xs.add(a + t * archR);
      if (pickup) { xs.add(m.roofEnd + 0.02); xs.add(L - 0.06); }
    }
    // B pillar: a short stretch of body color in the side window.
    const bx = (m.aTop + m.roofEnd) / 2 + (m.cls === "sedan" ? 0.05 : -0.1);
    if (lod < 2) { xs.add(bx - 0.06); xs.add(bx + 0.06); }
    const stations = [...xs].filter((x) => x >= 0 && x <= L).sort((p, q) => p - q);

    const bottomOf = lod === 2 ? () => m.clr + 0.08 : bottomAt;
    const ring = (x) => {
      const w = halfAt(x);
      const y0 = bottomOf(x);
      const yt = topAt(x);
      const yb = Math.max(y0 + 0.05, Math.min(beltAt(x), yt));
      const yr = Math.min(yb, y0 + 0.12);
      const green = yt - yb > 0.04;
      const wg = green ? w * m.tumble : w * 0.97;
      return [
        [x, y0, w * 0.94], [x, yr, w], [x, yb, w], [x, yt, wg],
        [x, yt, -wg], [x, yb, -w], [x, yr, -w], [x, y0, -w * 0.94],
      ];
    };
    const rings = stations.map(ring);
    const zoneOf = (x) => {
      if (x < m.cowl[0]) return "hood";
      if (x < m.aTop) return "windshield";
      if (x < m.roofEnd) return "roof";
      if (pickup) return x < m.roofEnd + 0.02 ? "backlight" : "bed";
      if (x < m.deck[0]) return "backlight";
      return "deck";
    };
    // Side glass runs from just behind the A pillar to just ahead of the C
    // pillar, broken by the B pillar.
    const sideGlass = (x) => {
      const z = zoneOf(x);
      if (!(z === "windshield" || z === "roof" || z === "backlight")) return false;
      if (x < m.cowl[0] + (m.aTop - m.cowl[0]) * 0.3) return false;
      if (Math.abs(x - bx) < 0.06) return false;
      const cEnd = m.cls === "sedan" ? m.roofEnd + (m.deck[0] - m.roofEnd) * 0.2 : m.roofEnd - 0.12;
      return x < cEnd;
    };
    const edgePart = (e, xm) => {
      if (e === 7) return P.dark;                       // underside / wheel wells
      if (e === 0 || e === 6) return P.trim;            // rocker trim
      if (e === 1 || e === 5) return P.paint;           // body sides
      if (e === 2 || e === 4) return sideGlass(xm) ? P.glass : P.paint;
      const z = zoneOf(xm);                              // e === 3: the top
      if (z === "windshield" || z === "backlight") return P.glass;
      if (z === "bed") return P.dark;
      return P.paint;
    };
    const center = [L / 2, (m.clr + m.H) / 2, 0];
    // Each of the 8 ring edges is a strip along the length, split where its
    // surface changes, so it's smooth lengthwise and sharp at the creases.
    for (let e = 0; e < 8; e++) {
      let run = [0];
      const flush = () => {
        if (run.length < 2) return;
        const verts = [], tris = [];
        for (const i of run) verts.push(rings[i][e], rings[i][(e + 1) % 8]);
        for (let k = 0; k + 1 < run.length; k++) tris.push([2 * k, 2 * k + 1, 2 * k + 3], [2 * k, 2 * k + 3, 2 * k + 2]);
        const xm = (stations[run[0]] + stations[run[1]]) / 2;
        // outward = away from the middle of the cross-section at that point
        b.piece(verts, tris, edgePart(e, xm), (c) => [c[0], (bottomOf(c[0]) + topAt(c[0])) / 2, 0]);
      };
      for (let i = 1; i < stations.length; i++) {
        const prev = edgePart(e, (stations[i - 1] + stations[i]) / 2);
        const next = i + 1 < stations.length ? edgePart(e, (stations[i] + stations[i + 1]) / 2) : null;
        run.push(i);
        if (next !== prev) { flush(); run = [i]; }
      }
    }
    // End caps (bumper faces).
    for (const [i, out] of [[0, -1], [stations.length - 1, 1]]) {
      const r = rings[i];
      b.piece(r, [[0, 1, 2], [0, 2, 3], [0, 3, 4], [0, 4, 5], [0, 5, 6], [0, 6, 7]], P.paint, [r[0][0] - out, center[1], 0]);
    }

    // Front and rear details: small quads just proud of the bumper faces.
    const front = (y0, y1, z0, z1, part) => b.quad([[-0.006, y0, z0], [-0.006, y0, z1], [-0.006, y1, z1], [-0.006, y1, z0]], part, [-1, 0, 0]);
    const rear = (y0, y1, z0, z1, part) => b.quad([[L + 0.006, y0, z0], [L + 0.006, y1, z0], [L + 0.006, y1, z1], [L + 0.006, y0, z1]], part, [1, 0, 0]);
    const fw = halfAt(0), rw = halfAt(L);
    const nose = m.nose;
    // headlights, grille, lower intake, plate, bumper
    front(nose - 0.15, nose - 0.02, fw - 0.4, fw - 0.06, P.headlight);
    front(nose - 0.15, nose - 0.02, -fw + 0.06, -fw + 0.4, P.headlight);
    front(nose - 0.2, nose - 0.03, -fw + 0.46, fw - 0.46, P.dark);
    if (lod < 2) {
      front(m.clr + 0.08, m.clr + 0.2, -fw * 0.55, fw * 0.55, P.dark);
      front(m.clr + 0.24, m.clr + 0.39, -0.26, 0.26, P.plate);
      front(m.clr + 0.02, m.clr + 0.08, -fw + 0.05, fw - 0.05, P.trim);
    }
    // taillights, plate, rear bumper strip
    const tl = m.tail;
    const tlH = m.cls === "twobox" ? 0.28 : 0.14;
    rear(tl - 0.04 - tlH, tl - 0.04, rw - 0.3, rw - 0.04, P.taillight);
    rear(tl - 0.04 - tlH, tl - 0.04, -rw + 0.04, -rw + 0.3, P.taillight);
    if (lod < 2) {
      rear(tl - 0.34, tl - 0.19, -0.26, 0.26, P.plate);
      rear(m.clr + 0.02, m.clr + 0.12, -rw + 0.05, rw - 0.05, P.trim);
    }

    // Wheels: tire, rim face (outer side), hub.
    const seg = lod === 0 ? 14 : lod === 1 ? 8 : 6;
    for (const a of ax) {
      for (const s of [-1, 1]) {
        const wz = s * (half * 0.94 - 0.12);
        b.cylinderZ(a, m.r, wz, m.r, 0.23, seg, P.rubber, P.rubber, lod === 2);
        if (lod < 2) {
          const rimZ = wz + s * 0.118;
          const rimR = m.r * 0.64;
          const verts = [[a, m.r, rimZ]], tris = [];
          for (let i = 0; i < seg; i++) {
            const t = (i / seg) * Math.PI * 2;
            verts.push([a + Math.cos(t) * rimR, m.r + Math.sin(t) * rimR, rimZ]);
          }
          for (let i = 0; i < seg; i++) tris.push([0, 1 + i, 1 + ((i + 1) % seg)]);
          b.piece(verts, tris, P.rim, [a, m.r, rimZ - s]);
          if (lod === 0) b.box(a, m.r, rimZ + s * 0.004, 0.09, 0.09, 0.01, P.chrome);
        }
      }
    }

    if (lod === 0) {
      // Mirrors on short stalks at the base of the A pillars.
      const mx = m.cowl[0] + 0.12, my = beltAt(mx) + 0.1, mw = halfAt(mx);
      for (const s of [-1, 1]) {
        b.box(mx, my, s * (mw + 0.09), 0.12, 0.13, 0.16, P.paint);
        b.box(mx - 0.062, my, s * (mw + 0.1), 0.004, 0.1, 0.12, P.dark);
        b.box(mx + 0.02, my - 0.02, s * (mw + 0.02), 0.06, 0.04, 0.06, P.trim);
      }
      // Door seams (thin dark lines on the body side) and handles.
      const doorFront = m.cowl[0] + 0.02;
      const doorRearEnd = m.cls === "sedan" ? m.roofEnd + 0.05 : Math.min(m.roofEnd - 0.1, ax[1] - archR - 0.02);
      const seams = pickup ? [doorFront, bx + 0.02, m.roofEnd - 0.01] : m.sliding ? [doorFront, bx - 0.02, doorRearEnd] : [doorFront, bx + 0.02, doorRearEnd];
      for (const sx of seams) {
        const w = halfAt(sx);
        const y0 = Math.max(bottomAt(sx) + 0.12, m.clr + 0.14), y1 = beltAt(sx) - 0.01;
        for (const s of [-1, 1]) {
          const z = s * (w + 0.003);
          b.quad([[sx - 0.006, y0, z], [sx + 0.006, y0, z], [sx + 0.006, y1, z], [sx - 0.006, y1, z]], P.dark, [0, 0, s]);
        }
      }
      for (const hx of [bx - 0.28, seams[2] - 0.22]) {
        const w = halfAt(hx), hy = beltAt(hx) - 0.1;
        for (const s of [-1, 1]) {
          const z = s * (w + 0.005);
          b.quad([[hx - 0.09, hy - 0.018, z], [hx + 0.09, hy - 0.018, z], [hx + 0.09, hy + 0.018, z], [hx - 0.09, hy + 0.018, z]], P.chrome, [0, 0, s]);
        }
      }
    }

    // Center it: +x forward, the car's middle at the origin.
    const g = b.build(THREE);
    const p = g.attributes.position.array;
    for (let i = 0; i < p.length; i += 3) p[i] = L / 2 - p[i];
    const n = g.attributes.normal.array;
    for (let i = 0; i < n.length; i += 3) n[i] = -n[i];
    // x was mirrored: flip each triangle's winding back so faces still point out.
    const idx = g.index.array;
    for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
    g.computeBoundingSphere();
    return g;
  }

  // The farthest LOD (LOD3): one very simple car for every model -- a
  // painted body box, a glass cabin with a painted roof, and a dark strip
  // under each axle for the wheels -- at unit size (1 long, 1 tall, 1 wide),
  // scaled to each car. Car space as above: +x forward, middle at origin.
  function buildSimpleCar(THREE) {
    const b = meshBuilder();
    b.box(0, 0.36, 0, 1, 0.4, 0.97, P.paint);                // body
    b.box(-0.04, 0.745, 0, 0.5, 0.37, 0.84, P.glass);       // cabin (windows)
    b.box(-0.04, 0.965, 0, 0.46, 0.07, 0.8, P.paint);       // roof
    for (const x of [-0.31, 0.31]) b.box(x, 0.11, 0, 0.15, 0.22, 0.92, P.rubber); // wheels
    const g = b.build(THREE);
    g.computeBoundingSphere();
    return g;
  }

  // ------------------------------------------------------------------ material
  // One shared material. Per vertex: carPart. Per instance: carPaint (rgb),
  // carMisc (gloss, age, glass tint, dark rims), carFade (LOD cross-fade:
  // > 0 fading in, < 0 fading out, 1 = solid).
  function makeCarMaterial(THREE) {
    // Lambert (lit per vertex -- cheap for cars filling the screen), plus
    // the sun's highlight and the sky's sheen worked out per vertex.
    const material = new THREE.MeshLambertMaterial({ color: 0xffffff });
    material.customProgramCacheKey = () => "parked-vehicle";
    material.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", [
          "#include <common>",
          "attribute float carPart; attribute vec3 carPaint; attribute vec4 carMisc; attribute float carFade;",
          "varying float vCarPart; varying vec3 vCarPaint; varying vec4 vCarMisc; varying float vCarFade; varying vec3 vCarShine;",
        ].join("\n"))
        .replace("#include <begin_vertex>", "#include <begin_vertex>\nvCarPart = carPart; vCarPaint = carPaint; vCarMisc = carMisc; vCarFade = carFade;")
        .replace("#include <project_vertex>", [
          "#include <project_vertex>",
          "{",
          "  vec3 cn = normalize(transformedNormal);",
          "  vec3 cv = normalize(-mvPosition.xyz);",
          "  float cf = pow(1.0 - abs(dot(cn, cv)), 3.0);",
          "  vCarShine = vec3(0.55, 0.62, 0.7) * (0.12 + cf) * (ambientLightColor.b + 0.05);", // sky at grazing angles
          "  #if NUM_DIR_LIGHTS > 0",
          "  vec3 ch = normalize(directionalLights[0].direction + cv);",
          "  vCarShine += directionalLights[0].color * pow(max(dot(cn, ch), 0.0), 36.0) * 0.6;", // the sun's highlight
          "  #endif",
          "}",
        ].join("\n"));
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", "#include <common>\nvarying float vCarPart; varying vec3 vCarPaint; varying vec4 vCarMisc; varying float vCarFade; varying vec3 vCarShine;")
        .replace("#include <clipping_planes_fragment>", [
          "#include <clipping_planes_fragment>",
          // LOD cross-fade: complementary screen-space dither
          "if (vCarFade < 0.999) {",
          "  float cd = fract(sin(dot(floor(gl_FragCoord.xy), vec2(12.9898, 78.233))) * 43758.5453);",
          "  if (vCarFade >= 0.0 ? cd >= vCarFade : cd < -vCarFade) discard;",
          "}",
        ].join("\n"))
        .replace("#include <color_fragment>", [
          "#include <color_fragment>",
          "float carPartId = floor(vCarPart + 0.5);",
          "float carGloss = vCarMisc.x, carAge = vCarMisc.y;",
          "float carSpec = 0.15;",
          "vec3 carCol = vCarPaint;",
          "if (carPartId < 0.5) { carSpec = carGloss; }",                                                                                     // paint
          "else if (carPartId < 1.5) { carCol = mix(vec3(0.07, 0.08, 0.09), vec3(0.12, 0.13, 0.14), vCarMisc.z); carSpec = 1.4; }",       // glass
          "else if (carPartId < 2.5) { carCol = vec3(0.045); carSpec = 0.05; }",                                                              // tires
          "else if (carPartId < 3.5) { carCol = mix(vec3(0.62, 0.63, 0.64), vec3(0.12, 0.12, 0.13), vCarMisc.w); carSpec = 0.8; }",         // rims
          "else if (carPartId < 4.5) { carCol = mix(vec3(0.075), vec3(0.11, 0.11, 0.105), carAge); carSpec = 0.12; }",                      // black trim (grayer with age)
          "else if (carPartId < 5.5) { carCol = vec3(0.7, 0.71, 0.72); carSpec = 1.0; }",                                                     // chrome
          "else if (carPartId < 6.5) { carCol = mix(vec3(0.82, 0.84, 0.85), vec3(0.72, 0.7, 0.62), carAge * 0.6); carSpec = 1.0; }",         // headlight lenses (yellowing with age)
          "else if (carPartId < 7.5) { carCol = vec3(0.62, 0.06, 0.05); carSpec = 1.0; }",                                                   // taillights
          "else if (carPartId < 8.5) { carCol = vec3(0.86, 0.86, 0.8); carSpec = 0.2; }",                                                    // plates
          "else { carCol = vec3(0.035); carSpec = 0.05; }",                                                                                   // grille, wells, bed
          "diffuseColor.rgb = carCol;",
        ].join("\n"))
        .replace("#include <emissivemap_fragment>", [
          "#include <emissivemap_fragment>",
          // glass and glossy paint catch the sun and the sky (vCarShine)
          "totalEmissiveRadiance += vCarShine * (carPartId > 0.5 && carPartId < 1.5 ? 1.0 : carSpec * 0.45);",
        ].join("\n"));
    };
    return material;
  }

  // Soft shadow under a car: a rounded rectangle fading at its edges.
  function makeShadowTexture(THREE) {
    const w = 128, h = 64;
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    const img = ctx.createImageData(w, h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const u = Math.abs(x / (w - 1) * 2 - 1), v = Math.abs(y / (h - 1) * 2 - 1);
        const d = Math.max(0, Math.hypot(Math.max(0, u - 0.72) / 0.28, Math.max(0, v - 0.55) / 0.45));
        const a = Math.max(0, 1 - d) ** 1.6 * (1 - 0.25 * Math.max(u, v));
        img.data[(y * w + x) * 4 + 3] = Math.round(255 * a);
      }
    }
    ctx.putImageData(img, 0, 0);
    return new THREE.CanvasTexture(canvas);
  }

  // ------------------------------------------------------------------ system
  function createParkedVehicleSystem(THREE, root, spaces, options = {}) {
    const C = PARKED_VEHICLE_CONFIG;
    const groundHeightAt = options.groundHeightAt || (() => 0);
    const names = Object.keys(MODELS);
    const material = makeCarMaterial(THREE);
    // Geometry per model per LOD; LOD2 is shared per body class (built at
    // the class's first model's size and scaled to each model).
    const geometries = {};
    const classBase = {};
    for (const name of names) {
      const m = MODELS[name];
      if (!classBase[m.cls]) classBase[m.cls] = name;
      geometries[name] = [buildCar(THREE, m, 0), buildCar(THREE, m, 1)];
    }
    const farGeometries = {};
    for (const cls in classBase) farGeometries[cls] = buildCar(THREE, MODELS[classBase[cls]], 2);

    // ---- placement: occupancy per lot, then a model, color, age per car.
    const rand = mulberry32(C.SEED);
    const pickWeighted = (weights, r) => {
      const total = Object.values(weights).reduce((s, w) => s + (Array.isArray(w) ? w[0] : w), 0);
      let t = r * total;
      for (const k in weights) { t -= Array.isArray(weights[k]) ? weights[k][0] : weights[k]; if (t < 0) return k; }
      return Object.keys(weights)[0];
    };
    const lotOccupancy = new Map();
    const cars = [];
    const color = new THREE.Color();
    const hsl = { h: 0, s: 0, l: 0 };
    const V = C.VEHICLE_VARIATION_AMOUNT;
    // Occupancy varies a little across a lot (people bunch near the ends
    // they walk to), from a smooth field -- never a regular pattern.
    const bunching = (sp) => 0.85 + 0.3 * Math.sin(sp.x * 0.045 + Math.sin(sp.z * 0.037) * 2.1) * Math.cos(sp.z * 0.041 - 0.7);
    // Spaces with an exact `occupancy` (share of their lot's spaces): that
    // many of the lot's spaces are taken, the best-placed ones by the
    // bunching field plus a seeded shuffle (its own random stream).
    const taken = new Set();
    {
      const rTake = mulberry32(C.SEED + 7);
      const byLot = new Map();
      for (const sp of spaces) {
        const score = rTake() / bunching(sp);
        if (sp.occupancy === undefined) continue;
        if (!byLot.has(sp.lot)) byLot.set(sp.lot, []);
        byLot.get(sp.lot).push({ sp, score });
      }
      for (const list of byLot.values()) {
        const share = Math.min(1, list[0].sp.occupancy * C.VEHICLE_DENSITY);
        if (list[0].sp.bias === "west") {
          // Denser toward the lot's west side, thinning out east: the score
          // grows across the lot (x runs west -> east), randomness kept.
          let minX = Infinity, maxX = -Infinity;
          for (const e of list) { minX = Math.min(minX, e.sp.x); maxX = Math.max(maxX, e.sp.x); }
          for (const e of list) e.score *= 0.25 + 1.5 * ((e.sp.x - minX) / Math.max(1, maxX - minX));
        }
        list.sort((a, b) => a.score - b.score);
        const n = list[0].sp.count !== undefined ? Math.min(list.length, list[0].sp.count) : Math.floor(list.length * share + 1e-6);
        for (let i = 0; i < n; i++) taken.add(list[i].sp);
      }
    }
    for (const sp of spaces) {
      // (every space draws the same random numbers, used or not, so one
      // space's outcome never reshuffles the rest)
      const rOcc = rand(), rModel = rand(), rColor = rand(), rShade = rand(), rAge = rand(), rVar = [rand(), rand(), rand(), rand(), rand(), rand(), rand()];
      if (sp.occupancy !== undefined) {
        if (!taken.has(sp)) continue;
      } else {
        if (!lotOccupancy.has(sp.lot)) {
          const [lo, hi] = C.PARKING_OCCUPANCY[sp.profile] || C.PARKING_OCCUPANCY.normal;
          lotOccupancy.set(sp.lot, Math.min(0.98, (lo + (hi - lo) * rand()) * C.VEHICLE_DENSITY));
        }
        if (rOcc > lotOccupancy.get(sp.lot) * bunching(sp)) continue;
      }
      // A model that fits the space.
      let name = null;
      for (let k = 0; k < 6 && !name; k++) {
        const cand = pickWeighted(C.VEHICLE_MODEL_WEIGHTS, k === 0 ? rModel : rand());
        const m = MODELS[cand];
        if (m.L <= sp.depth - 0.12 && m.W <= sp.width - 0.5) name = cand;
      }
      if (!name) name = "hatchback";
      const m = MODELS[name];
      if (m.L > sp.depth - 0.05 || m.W > sp.width - 0.3) continue;
      // Paint.
      const cat = C.VEHICLE_COLOR_WEIGHTS[pickWeighted(C.VEHICLE_COLOR_WEIGHTS, rColor)];
      color.setHex(cat[1][Math.floor(rShade * cat[1].length) % cat[1].length]);
      const ageKey = m.old ? "older" : pickWeighted(C.AGE_WEIGHTS, rAge);
      const age = ageKey === "newer" ? 0.05 * rVar[0] : ageKey === "middle" ? 0.3 + 0.25 * rVar[0] : 0.65 + 0.35 * rVar[0];
      color.getHSL(hsl);
      // subtle value spread, and older paint slightly faded (less saturated, a touch lighter if dark)
      hsl.l = Math.min(0.95, Math.max(0.02, hsl.l * (1 + (rVar[1] - 0.5) * 0.12 * V) + age * 0.035 * V));
      hsl.s *= 1 - age * 0.25 * V;
      color.setHSL(hsl.h, hsl.s, hsl.l);
      const gloss = (ageKey === "newer" ? 1.0 : ageKey === "middle" ? 0.65 : 0.32) * (0.85 + 0.3 * rVar[2] * V);
      const glassTint = rVar[3] * V;
      const darkRims = rVar[4] < 0.3 ? 1 : 0;
      // Pose: nose in (mostly) or backed in, a little off center / square.
      const backed = !sp.noBackIn && rVar[5] < C.BACKED_IN_SHARE;
      const yaw = sp.yaw + (backed ? Math.PI : 0) + (rVar[6] - 0.5) * 2 * (C.PARKING_JITTER_DEG * Math.PI / 180) * V;
      // drivers pull up toward the head of the space (either way round)
      const slackAlong = Math.max(0, (sp.depth - m.L) / 2 - 0.08);
      const along = slackAlong * (0.35 + 0.5 * (rand() - 0.5));
      const side = (rand() - 0.5) * 2 * Math.min(C.PARKING_JITTER_M, Math.max(0, (sp.width - m.W) / 2 - 0.25));
      const fx = Math.cos(sp.yaw), fz = Math.sin(sp.yaw);
      const x = sp.x + fx * along - fz * side, z = sp.z + fz * along + fx * side;
      cars.push({ name, m, lot: sp.lot, x, z, y: groundHeightAt(x, z), yaw, paint: [color.r, color.g, color.b], misc: [gloss, age, glassTint, darkRims], lod: -1, from: -1, t: 1 });
    }

    // ---- instanced meshes: per model LOD0 / LOD1, per class LOD2, shadows.
    const byName = {};
    for (const c of cars) (byName[c.name] || (byName[c.name] = [])).push(c);
    const meshes = []; // { mesh, attrs, n }
    const makeMesh = (geometry, capacity) => {
      const g = geometry.clone();
      const paint = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
      const misc = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
      const fade = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
      for (const a of [paint, misc, fade]) a.setUsage(THREE.DynamicDrawUsage);
      g.setAttribute("carPaint", paint);
      g.setAttribute("carMisc", misc);
      g.setAttribute("carFade", fade);
      const mesh = new THREE.InstancedMesh(g, material, capacity);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.count = 0;
      mesh.frustumCulled = false; // instances span the map; distance culling below
      mesh.visible = false;
      mesh.name = "ParkedVehicles";
      root.add(mesh);
      const entry = { mesh, paint, misc, fade, n: 0 };
      meshes.push(entry);
      return entry;
    };
    const lodMeshes = {}; // name -> [lod0, lod1]
    for (const name in byName) lodMeshes[name] = [makeMesh(geometries[name][0], byName[name].length), makeMesh(geometries[name][1], byName[name].length)];
    const farMeshes = {};
    for (const cls in farGeometries) {
      const count = cars.filter((c) => c.m.cls === cls).length;
      if (count) farMeshes[cls] = makeMesh(farGeometries[cls], count);
    }
    const simpleMesh = makeMesh(buildSimpleCar(THREE), Math.max(1, cars.length)); // LOD3, every car
    const shadowMaterial = new THREE.MeshBasicMaterial({ map: makeShadowTexture(THREE), color: 0x000000, transparent: true, depthWrite: false, opacity: C.SHADOW_OPACITY, fog: false });
    shadowMaterial.polygonOffset = true;
    shadowMaterial.polygonOffsetFactor = -2;
    shadowMaterial.polygonOffsetUnits = -2;
    const shadowGeometry = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const shadowMesh = new THREE.InstancedMesh(shadowGeometry, shadowMaterial, Math.max(1, cars.length));
    shadowMesh.count = 0;
    shadowMesh.frustumCulled = false;
    shadowMesh.renderOrder = 2;
    shadowMesh.name = "ParkedVehicleShadows";
    root.add(shadowMesh);

    // Each car's instance matrices, computed once: its own model's (LOD0/1),
    // the class shape scaled to it (LOD2), the simple car scaled to it
    // (LOD3), and its shadow.
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), yAxis = new THREE.Vector3(0, 1, 0);
    for (const c of cars) {
      // three's yaw turns +x toward -z; a heading angle `yaw` in the x/z
      // plane (0 = +x, +pi/2 = +z) is a rotation of -yaw.
      q.setFromAxisAngle(yAxis, -c.yaw);
      const at = new THREE.Vector3(c.x, c.y, c.z);
      c.matrix = m4.compose(at, q, new THREE.Vector3(1, 1, 1)).toArray();
      const base = MODELS[classBase[c.m.cls]];
      c.farMatrix = m4.compose(at, q, new THREE.Vector3(c.m.L / base.L, c.m.H / base.H, c.m.W / base.W)).toArray();
      c.simpleMatrix = m4.compose(at, q, new THREE.Vector3(c.m.L, c.m.H, c.m.W)).toArray();
      c.shadowMatrix = m4.compose(new THREE.Vector3(c.x, c.y + 0.02, c.z), q, new THREE.Vector3(c.m.L + 0.45, 1, c.m.W + 0.4)).toArray();
    }

    // ---- LOD assignment (a few times a second) and buffer rebuilds.
    let timer = 0, last = performance.now(), dirty = true, fading = false;
    const [lod01, lod12] = C.VEHICLE_LOD_DISTANCES;
    function targetLod(c, d) {
      const hys = c.lod >= 0 ? 3 : 0; // a little hysteresis around each boundary
      const edge = (limit, cur) => limit + (cur ? hys : -hys);
      if (d < edge(lod01, c.lod === 0)) return 0;
      if (d < edge(lod12, c.lod === 1)) return 1;
      if (d < edge(C.VEHICLE_SIMPLE_DISTANCE, c.lod === 2)) return 2;
      return 3; // the simple car, however far: only leaving the view hides it
    }
    const push = (entry, c, matrix, fade) => {
      const i = entry.n++;
      entry.mesh.instanceMatrix.array.set(matrix, i * 16);
      entry.paint.array.set(c.paint, i * 3);
      entry.misc.array.set(c.misc, i * 4);
      entry.fade.array[i] = fade;
    };
    const target = (c, lod) => (lod === 3 ? simpleMesh : lod === 2 ? farMeshes[c.m.cls] : lodMeshes[c.name][lod]);
    const matrixFor = (c, lod) => (lod === 3 ? c.simpleMatrix : lod === 2 ? c.farMatrix : c.matrix);
    // Cars in draw order: nearest first (re-sorted at each LOD update), so
    // the depth test rejects the hidden parts of the cars behind early.
    let drawOrder = [];
    function rebuild() {
      for (const e of meshes) e.n = 0;
      let shadows = 0;
      for (const c of drawOrder) {
        if (c.hidden) continue;
        const fadeIn = c.t < 1 ? Math.max(0.001, c.t) : 1;
        if (c.lod >= 0) push(target(c, c.lod), c, matrixFor(c, c.lod), fadeIn);
        if (c.t < 1 && c.from >= 0) push(target(c, c.from), c, matrixFor(c, c.from), -Math.max(0.001, c.t));
        // (no soft shadow under the simple far cars)
        if ((c.lod >= 0 && c.lod < 3) || (c.t < 1 && c.from >= 0 && c.from < 3)) shadowMesh.instanceMatrix.array.set(c.shadowMatrix, 16 * shadows++);
      }
      for (const e of meshes) {
        e.mesh.count = e.n;
        e.mesh.visible = e.n > 0;
        if (e.n > 0) {
          // (upload only the instances in use, not the whole capacity)
          for (const a of [e.mesh.instanceMatrix, e.paint, e.misc, e.fade]) {
            a.updateRange.offset = 0;
            a.updateRange.count = e.n * a.itemSize;
            a.needsUpdate = true;
          }
        }
      }
      shadowMesh.count = shadows;
      shadowMesh.visible = shadows > 0;
      if (shadows > 0) {
        shadowMesh.instanceMatrix.updateRange.offset = 0;
        shadowMesh.instanceMatrix.updateRange.count = shadows * 16;
        shadowMesh.instanceMatrix.needsUpdate = true;
      }
    }

    // views (optional): per viewer { x, z, fx, fz, cos } -- where it stands,
    // which way it faces (unit, horizontal) and the cosine of its half
    // field of view (with a margin). A car is drawn only if some part of it
    // can be inside a view: the angle to its middle, less the angle its
    // own size spans from there, within the view's half-angle (checked
    // every frame -- turning never shows a missing car). Only a car right
    // beside a viewer (its footprint around them) always stays.
    let hiddenCount = -1;
    const CAR_RADIUS_M = 2.8; // middle to corner, the biggest model
    const viewHalf = [];
    function cullToViews(views) {
      for (let i = 0; i < views.length; i++) viewHalf[i] = Math.acos(Math.max(-1, Math.min(1, views[i].cos)));
      let hidden = 0;
      for (const c of drawOrder) {
        let seen = false;
        for (let i = 0; i < views.length; i++) {
          const v = views[i];
          const dx = c.x - v.x, dz = c.z - v.z;
          const d = Math.hypot(dx, dz);
          if (d < CAR_RADIUS_M + 0.5) { seen = true; break; }
          const angle = Math.acos(Math.max(-1, Math.min(1, (dx * v.fx + dz * v.fz) / d)));
          if (angle - Math.asin(CAR_RADIUS_M / d) < viewHalf[i]) { seen = true; break; }
        }
        if (c.hidden === seen) dirty = true;
        c.hidden = !seen;
        if (!seen) hidden++;
      }
      if (hidden !== hiddenCount) { hiddenCount = hidden; dirty = true; }
    }

    function update(viewers, views) {
      const now = performance.now();
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      timer -= dt;
      if (timer <= 0) {
        timer = C.LOD_UPDATE_INTERVAL;
        drawOrder = [];
        for (const c of cars) {
          let d = Infinity;
          for (const v of viewers) d = Math.min(d, Math.hypot(v.x - c.x, v.z - c.z));
          c.d = d;
          const lod = targetLod(c, d);
          if (lod !== c.lod) {
            // (culling in or out happens deep in the fog: no fade needed)
            const fade = c.lod >= 0 && lod >= 0 && C.VEHICLE_LOD_FADE_TIME > 0;
            c.from = fade ? c.lod : -1;
            c.lod = lod;
            c.t = fade ? 0 : 1;
          }
          if (c.lod >= 0 || c.t < 1) drawOrder.push(c);
        }
        drawOrder.sort((p, q) => p.d - q.d);
        dirty = true;
      }
      if (fading) {
        fading = false;
        for (const c of cars) {
          if (c.t < 1) {
            c.t = Math.min(1, c.t + dt / C.VEHICLE_LOD_FADE_TIME);
            fading = true;
          }
        }
        dirty = true;
      } else if (dirty) {
        fading = cars.some((c) => c.t < 1);
      }
      if (views && views.length) cullToViews(views);
      else if (hiddenCount !== 0) { for (const c of drawOrder) c.hidden = false; hiddenCount = 0; dirty = true; }
      if (dirty) {
        rebuild();
        dirty = false;
      }
    }

    // cars / spaces per lot
    function lotStats() {
      const out = {};
      for (const sp of spaces) (out[sp.lot] || (out[sp.lot] = { spaces: 0, cars: 0 })).spaces++;
      for (const c of cars) out[c.lot].cars++;
      for (const k in out) out[k].share = +(out[k].cars / out[k].spaces).toFixed(3);
      return out;
    }
    function stats() {
      const drawn = meshes.reduce((s, e) => s + e.n, 0);
      const models = {};
      for (const c of cars) models[c.name] = (models[c.name] || 0) + 1;
      return { spaces: spaces.length, cars: cars.length, drawnInstances: drawn, draws: meshes.filter((e) => e.n > 0).length + (shadowMesh.count > 0 ? 1 : 0), models,
        lots: lotStats() };
    }

    return { update, stats, cars, material };
  }

  window.PARKED_VEHICLE_CONFIG = PARKED_VEHICLE_CONFIG;
  window.PARKED_VEHICLE_MODELS = MODELS;
  window.createParkedVehicleSystem = createParkedVehicleSystem;
})();
