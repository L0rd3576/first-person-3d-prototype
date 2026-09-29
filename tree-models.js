// Tree models (explicit request): realistic, varied trees for the campus
// map, swaying in a cosmetic wind. VISUAL ONLY -- where trees stand, how
// big they are and their collision all still come from campus-world.js
// (its tree colliders are untouched); this file only decides what they
// look like.
//
//   - 13 tree types (10 broadleaf, 3 conifer), each grown procedurally from
//     a seed in TREE_BUILDS_PER_TYPE different builds -> 26 distinct shapes,
//     built once and reused. A type is a trunk (or several) that wanders a
//     little, major branches reaching into an irregular crown made of
//     several lobes, and clustered foliage: a small solid core plus
//     crossed alpha-tested leaf cards per cluster.
//   - Per tree, deterministic from its position (same look every run):
//     type, height/width scale, rotation, lean, foliage density, bark and
//     leaf tint, wind phase and stiffness.
//   - Trees are merged into TREE_CHUNK_M chunks: one bark + one leaf draw
//     per chunk, at one of three detail levels picked by distance (built
//     lazily; far full-detail builds are freed again). Beyond drawDistance
//     nothing is drawn (the fog has fully hidden them by then).
//   - Two shared materials for every tree: bark (one small tiling texture
//     + per-vertex tint) and leaves (one leaf-cluster atlas + tint).
//   - Wind is done entirely in the vertex shader from four shared
//     uniforms (time, strength, gust, direction) plus per-vertex data
//     baked at build time: how high up the tree (the crown sways, the
//     trunk barely moves), how far out a branch (small branches move more),
//     leaf flutter, and a per-tree phase/frequency/stiffness (small trees
//     move more and faster than big ones, and no two trees move in step).
//     No per-tree or per-branch work on the CPU per frame.
(function () {
  "use strict";

  const TREE_BUILDS_PER_TYPE = 2;
  const TREE_CHUNK_M = 40;
  const TRUNK_LIFT = 0.1; // extra bare trunk, as a fraction of a type's height (the whole tree ~10% taller)

  // Reference sizes in meters (every tree is scaled to the size campus-world
  // gave it). R = crown radius, Ry = crown's vertical radius / R, base =
  // where the crown starts (fraction of height). bark = allowed bark tints.
  const BROADLEAF_TYPES = [
    { name: "mature", H: 12.5, base: 0.3, R: 5.0, Ry: 0.62, trunkR: 0.34, trunks: 1, shape: "round", lobes: 5, clusters: 50, clusterR: 1.15, leaf: 0.85, branches: 6, bark: [1, 2], weight: 3 },
    { name: "tall-narrow", H: 13, base: 0.2, R: 2.3, Ry: 1.0, trunkR: 0.26, trunks: 1, shape: "column", lobes: 3, clusters: 38, clusterR: 0.85, leaf: 0.25, branches: 7, bark: [2, 0], weight: 1.5 },
    { name: "short-wide", H: 7.5, base: 0.32, R: 4.6, Ry: 0.5, trunkR: 0.3, trunks: 1, shape: "flat", lobes: 5, clusters: 42, clusterR: 1.0, leaf: 0.8, branches: 6, bark: [1, 3], weight: 2, small: true },
    { name: "young", H: 6.5, base: 0.42, R: 1.9, Ry: 0.9, trunkR: 0.11, trunks: 1, shape: "round", lobes: 2, clusters: 16, clusterR: 0.7, leaf: 0.2, branches: 4, sparse: true, bark: [0, 2], weight: 1.5, small: true },
    { name: "irregular", H: 10, base: 0.3, R: 4.0, Ry: 0.72, trunkR: 0.28, trunks: 1, shape: "irregular", lobes: 4, clusters: 40, clusterR: 1.0, leaf: 0.75, branches: 5, bark: [1, 3], weight: 2 },
    { name: "leaning", H: 9.5, base: 0.32, R: 3.6, Ry: 0.72, trunkR: 0.26, trunks: 1, lean: 0.17, shape: "round", lobes: 3, clusters: 34, clusterR: 0.95, leaf: 0.7, branches: 5, bark: [2, 1], weight: 1 },
    { name: "multi-trunk", H: 9, base: 0.35, R: 3.8, Ry: 0.72, trunkR: 0.15, trunks: 3, shape: "irregular", lobes: 4, clusters: 36, clusterR: 0.85, leaf: 0.2, branches: 3, bark: [4, 0], weight: 1.2 },
    { name: "vase", H: 12, base: 0.33, R: 4.8, Ry: 0.62, trunkR: 0.3, trunks: 1, shape: "vase", lobes: 5, clusters: 62, clusterR: 1.1, leaf: 0.3, branches: 5, bark: [2, 1], weight: 1.5 },
    { name: "ornamental", H: 5.5, base: 0.33, R: 2.6, Ry: 0.8, trunkR: 0.14, trunks: 1, shape: "round", lobes: 3, clusters: 24, clusterR: 0.75, leaf: 0.15, branches: 4, bark: [3, 1], weight: 1, small: true },
    { name: "open", H: 11, base: 0.3, R: 4.2, Ry: 0.75, trunkR: 0.27, trunks: 1, shape: "irregular", lobes: 5, clusters: 28, clusterR: 0.9, leaf: 0.85, branches: 7, sparse: true, bark: [0, 2], weight: 1 },
  ];
  const CONIFER_TYPES = [
    { name: "spruce", H: 11, base: 0.08, R: 2.6, trunkR: 0.25, tiers: 14, perTier: 6, droop: 0.42, fill: 1, weight: 2 },
    { name: "pine", H: 13, base: 0.42, R: 2.9, trunkR: 0.28, tiers: 8, perTier: 6, droop: -0.05, tufts: true, fill: 0, weight: 1 },
    { name: "fir", H: 10, base: 0.06, R: 1.9, trunkR: 0.22, tiers: 16, perTier: 5, droop: 0.3, fill: 1, weight: 1.5 },
  ];
  // Vertex tints (multiplied with the textures). Bark: light gray-brown,
  // dark brown, rough gray, reddish brown, pale (birch-like).
  const BARK_TINTS = [[0.95, 0.88, 0.78], [0.6, 0.45, 0.33], [0.8, 0.8, 0.76], [0.8, 0.52, 0.4], [1.2, 1.17, 1.1]];
  const LEAF_TINTS = [[1, 1, 0.95], [1.06, 1.08, 0.8], [0.86, 0.97, 0.92], [0.8, 0.86, 0.74], [1.08, 1.0, 0.78]];
  const CONIFER_TINTS = [[0.85, 0.95, 1.0], [0.78, 0.88, 0.82], [0.95, 1.0, 0.92]];

  function mulberry32(seed) {
    let a = seed | 0;
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  // Deterministic 0..1 from a tree's position (and a salt k).
  function hash01(x, z, k) {
    let h = Math.imul(Math.round(x * 64) | 0, 0x27d4eb2d) ^ Math.imul(Math.round(z * 64) | 0, 0x165667b1) ^ Math.imul(k + 1, 0x9e3779b1);
    h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }
  function pickWeighted(list, r, weightOf) {
    let total = 0;
    for (const item of list) total += weightOf(item);
    let x = r * total;
    for (const item of list) {
      x -= weightOf(item);
      if (x <= 0) return item;
    }
    return list[list.length - 1];
  }

  // Tiny vector helpers on [x, y, z].
  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
  const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const len = (a) => Math.hypot(a[0], a[1], a[2]);
  const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  function randomUnit(rand) {
    const z = rand() * 2 - 1, t = rand() * Math.PI * 2, r = Math.sqrt(1 - z * z);
    return [r * Math.cos(t), z, r * Math.sin(t)];
  }

  // A piece of geometry in a tree type's own space (base at the origin).
  // Leaves are kept as one piece per cluster/branch so a sparser tree can
  // simply leave some out (rank < density keeps it).
  class Part {
    constructor(phase = 0, rank = 0) {
      this.p = []; this.n = []; this.uv = []; this.s = []; this.w = []; this.i = [];
      this.phase = phase;
      this.rank = rank;
    }
    get count() { return this.p.length / 3; }
    // sway: 0 at the ground .. 1 at the treetop; flex: how much the local
    // branch bends; flutter: leaf jitter.
    add(p, n, u, v, shade, sway, flex, flutter) {
      this.p.push(p[0], p[1], p[2]);
      this.n.push(n[0], n[1], n[2]);
      this.uv.push(u, v);
      this.s.push(shade);
      this.w.push(sway, flex, flutter);
      return this.count - 1;
    }
    tri(a, b, c) { this.i.push(a, b, c); }
    quad(a, b, c, d) { this.i.push(a, b, c, a, c, d); }
  }

  function createTreeSystem(THREE, root, env, options = {}) {
    const LOD_NEAR_M = options.lodNear !== undefined ? options.lodNear : 45;
    const LOD_MID_M = options.lodMid !== undefined ? options.lodMid : 95;
    const DRAW_M = options.drawDistance !== undefined ? options.drawDistance : 150;
    const LOD_HYSTERESIS_M = 6;
    const BUILDS_PER_UPDATE = 2;        // detailed chunk builds per frame (walking into new areas)
    const FREE_LOD0_BEYOND_M = 200;     // full-detail builds this far away are freed
    const FREE_LOD1_BEYOND_M = 260;

    // --- Shared textures -------------------------------------------------
    function canvasTexture(w, h, draw) {
      const c = document.createElement("canvas");
      c.width = w; c.height = h;
      draw(c.getContext("2d"), w, h);
      return new THREE.CanvasTexture(c);
    }
    // Bark: gray fissured bark, tinted per tree by vertex color.
    const barkTexture = canvasTexture(64, 256, (ctx, w, h) => {
      const rand = mulberry32(5);
      ctx.fillStyle = "#9a9a9a";
      ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 900; i++) {
        const v = (115 + rand() * 90) | 0;
        ctx.fillStyle = `rgba(${v},${v},${v},0.35)`;
        ctx.fillRect(rand() * w, rand() * h, 1 + rand() * 2, 2 + rand() * 7);
      }
      for (let i = 0; i < 14; i++) { // fissures, wrapped across the seam
        let x = rand() * w;
        ctx.strokeStyle = `rgba(28,26,24,${0.35 + rand() * 0.35})`;
        ctx.lineWidth = 1 + rand() * 2.2;
        const pts = [];
        for (let y = 0; y <= h; y += 16) { pts.push([x, y]); x += (rand() - 0.5) * 5; }
        for (const shift of [-w, 0, w]) {
          ctx.beginPath();
          pts.forEach(([px, py], k) => (k ? ctx.lineTo(px + shift, py) : ctx.moveTo(px + shift, py)));
          ctx.stroke();
        }
      }
      for (let i = 0; i < 40; i++) {
        ctx.fillStyle = "rgba(40,38,36,0.35)";
        ctx.fillRect(rand() * w, rand() * h, 3 + rand() * 8, 1);
      }
    });
    barkTexture.wrapS = barkTexture.wrapT = THREE.RepeatWrapping;

    // Leaf atlas, 4 quadrants: broadleaf cluster card, small-leaf cluster
    // card, solid foliage fill (cluster cores, far crowns), needle spray.
    const Q_BROAD = [0, 0.5], Q_SMALL = [0.5, 0.5], Q_FILL = [0, 0], Q_NEEDLE = [0.5, 0]; // uv origin of each quadrant
    const leafTexture = canvasTexture(512, 512, (ctx) => {
      const rand = mulberry32(11);
      const leaf = (x, y, length, width, angle, color) => {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(angle);
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.quadraticCurveTo(length * 0.45, -width, length, 0);
        ctx.quadraticCurveTo(length * 0.45, width, 0, 0);
        ctx.fill();
        ctx.strokeStyle = "rgba(20,35,10,0.3)";
        ctx.lineWidth = 0.7;
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(length * 0.9, 0); ctx.stroke();
        ctx.restore();
      };
      const green = (l) => `hsl(${(76 + rand() * 34) | 0}, ${(36 + rand() * 24) | 0}%, ${l | 0}%)`;
      const clip = (x, y, draw) => { ctx.save(); ctx.beginPath(); ctx.rect(x + 2, y + 2, 252, 252); ctx.clip(); draw(); ctx.restore(); };
      // Clustered cards: a dense irregular middle, leaves spraying outward.
      const clusterCard = (ox, oy, count, lMin, lMax, wMin, wMax) => clip(ox, oy, () => {
        const cx = ox + 128, cy = oy + 128;
        for (let i = 0; i < 7; i++) {
          ctx.fillStyle = `hsl(${(88 + rand() * 20) | 0}, 40%, ${(15 + rand() * 6) | 0}%)`;
          ctx.beginPath();
          ctx.arc(cx + (rand() - 0.5) * 70, cy + (rand() - 0.5) * 70, 26 + rand() * 22, 0, Math.PI * 2);
          ctx.fill();
        }
        for (let i = 0; i < count; i++) {
          const length = lMin + rand() * (lMax - lMin);
          const r = (118 - length) * Math.sqrt(rand());
          const t = rand() * Math.PI * 2;
          leaf(cx + Math.cos(t) * r, cy + Math.sin(t) * r, length, wMin + rand() * (wMax - wMin),
            t + (rand() - 0.5) * 1.4, green(22 + 24 * (r / 110) + rand() * 8));
        }
      });
      clusterCard(0, 0, 95, 20, 34, 7, 12);    // Q_BROAD (canvas top-left)
      clusterCard(256, 0, 280, 9, 15, 3, 5.5); // Q_SMALL (top-right)
      clip(0, 256, () => {                     // Q_FILL (bottom-left): no transparency
        ctx.fillStyle = "hsl(95, 38%, 19%)";
        ctx.fillRect(0, 256, 256, 256);
        for (let i = 0; i < 520; i++) {
          leaf(rand() * 256, 256 + rand() * 256, 12 + rand() * 18, 4 + rand() * 7, rand() * Math.PI * 2, green(18 + rand() * 26));
        }
      });
      clip(256, 256, () => {                   // Q_NEEDLE (bottom-right): a spray along u
        for (let k = 0; k < 7; k++) {
          const y0 = 256 + 40 + k * 28 + (rand() - 0.5) * 10;
          const x0 = 256 + 6, x1 = 256 + 248;
          const sag = (rand() - 0.5) * 14;
          ctx.strokeStyle = "rgba(70,52,34,0.9)";
          ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(x0, y0); ctx.quadraticCurveTo((x0 + x1) / 2, y0 + sag, x1, y0 + sag * 0.4); ctx.stroke();
          for (let x = x0; x < x1; x += 2.5) {
            const f = (x - x0) / (x1 - x0);
            const y = y0 + sag * (4 * f * (1 - f)) * 0.9;
            const nl = 10 + rand() * 9 - f * 4;
            for (const side of [-1, 1]) {
              const a = side * (0.8 + rand() * 0.5) + 0.3;
              ctx.strokeStyle = `hsl(${(140 + rand() * 30) | 0}, ${(28 + rand() * 18) | 0}%, ${(17 + rand() * 17) | 0}%)`;
              ctx.lineWidth = 1.3;
              ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * nl, y + Math.sin(a) * nl); ctx.stroke();
            }
          }
        }
      });
    });

    // --- Materials + wind -----------------------------------------------
    const WIND_DECL = [
      "attribute vec4 windData;",
      "attribute float windFreq;",
      "uniform float envTime;",
      "uniform vec2 windDir;",
      "uniform float windStrength;",
      "uniform float windGust;",
    ].join("\n");
    // windData: x = crown sway (m at full wind, 0 at the ground), y = branch
    // flex (m), z = leaf flutter (0..1), w = phase. Positions are world space.
    const WIND_VERTEX = [
      "{",
      "  float ph = windData.w;",
      "  float t = envTime * windFreq;",
      "  float slow = sin(t * 0.9 + ph) * 0.6 + sin(t * 0.37 + ph * 1.9) * 0.4;",
      "  float gust = windGust * (0.65 + 0.35 * sin(t * 1.7 + ph));",
      "  float lean = windStrength * (0.55 + 0.45 * slow) + gust;",
      "  vec2 side = vec2(-windDir.y, windDir.x);",
      "  vec2 crown = windDir * lean * windData.x + side * windData.x * 0.25 * windStrength * sin(t * 0.7 + ph * 2.3);",
      "  float br = sin(t * 2.4 + ph * 2.3 + position.x * 0.35 + position.z * 0.41) * (0.35 * windStrength + 0.6 * gust) * windData.y;",
      "  float fa = windData.z * (0.012 + 0.045 * windStrength + 0.04 * gust);",
      "  vec3 fl = vec3(sin(envTime * 7.3 + ph * 3.0 + position.y * 2.9), 0.6 * sin(envTime * 6.1 + position.x * 2.3 + ph), sin(envTime * 8.1 + position.z * 3.1 + ph * 1.3)) * fa;",
      "  transformed.xz += crown + (windDir + side * 0.35) * br;",
      "  transformed.y -= dot(crown, crown) * 0.35;", // swaying tips dip a touch, not stretch
      "  transformed += fl;",
      "}",
    ].join("\n");
    // LOD cross-fade: while a chunk changes detail level, the incoming and
    // outgoing builds are both drawn with complementary ordered-dither
    // patterns (treeFade = how far along; treeFadeOut = the outgoing one),
    // so together they always cover each pixel exactly once -- a soft
    // dissolve, no holes, no double drawing. Done with a few pre-made
    // material copies per fade step (they share one shader program), so
    // nothing changes per frame except which material a fading mesh uses.
    const FADE_DECL = [
      "uniform float treeFade;",
      "uniform float treeFadeOut;",
      "float treeBayer2(vec2 a) { a = floor(a); return fract(a.x * 0.5 + a.y * a.y * 0.75); }",
      "float treeBayer4(vec2 a) { return treeBayer2(0.5 * a) * 0.25 + treeBayer2(a); }",
    ].join("\n");
    const FADE_FRAGMENT = [
      "if (treeFade < 0.999) {",
      "  float treeDither = treeBayer4(gl_FragCoord.xy);",
      "  if (treeFadeOut > 0.5 ? treeDither < treeFade : treeDither >= treeFade) discard;",
      "}",
    ].join("\n");
    function withWind(material, fade = 1, fadeOut = false) {
      const fadeUniforms = { treeFade: { value: fade }, treeFadeOut: { value: fadeOut ? 1 : 0 } };
      material.onBeforeCompile = (shader) => {
        shader.uniforms.treeFade = fadeUniforms.treeFade;
        shader.uniforms.treeFadeOut = fadeUniforms.treeFadeOut;
        shader.uniforms.envTime = env.envTime;
        shader.uniforms.windDir = env.windDir;
        shader.uniforms.windStrength = env.windStrength;
        shader.uniforms.windGust = env.windGust;
        shader.vertexShader = shader.vertexShader
          .replace("#include <common>", "#include <common>\n" + WIND_DECL)
          .replace("#include <begin_vertex>", "#include <begin_vertex>\n" + WIND_VERTEX);
        // Two-sided, but lit from the baked (outward) normals on both faces,
        // so a leaf card seen from behind isn't dark.
        shader.fragmentShader = shader.fragmentShader
          .replace("( gl_FrontFacing ) ? vLightFront : vLightBack", "vLightFront")
          .replace("( gl_FrontFacing ) ? vIndirectFront : vIndirectBack", "vIndirectFront")
          .replace("#include <common>", "#include <common>\n" + FADE_DECL)
          .replace("#include <clipping_planes_fragment>", "#include <clipping_planes_fragment>\n" + FADE_FRAGMENT);
      };
      return material;
    }
    const makeBarkMaterial = (fade, out) => withWind(new THREE.MeshLambertMaterial({ map: barkTexture, vertexColors: true, side: THREE.DoubleSide }), fade, out);
    const makeLeafMaterial = (fade, out) => withWind(new THREE.MeshLambertMaterial({ map: leafTexture, vertexColors: true, alphaTest: 0.42, side: THREE.DoubleSide }), fade, out);
    const barkMaterial = makeBarkMaterial();
    const leafMaterial = makeLeafMaterial();
    const LOD_FADE_TIME = 0.6;   // s
    const LOD_FADE_STEPS = 10;
    const fadeMaterials = new Map(); // "bark:3:in" -> material, made on first use
    function fadeMaterial(kind, step, out) {
      const key = kind + ":" + step + ":" + (out ? "out" : "in");
      if (!fadeMaterials.has(key)) {
        const f = step / LOD_FADE_STEPS;
        fadeMaterials.set(key, kind === "bark" ? makeBarkMaterial(f, out) : makeLeafMaterial(f, out));
      }
      return fadeMaterials.get(key);
    }

    // --- Tree type geometry ----------------------------------------------
    const swayAt = (y, H) => Math.pow(Math.max(0, y) / H, 1.7);

    // A tapered tube along a path (trunk, branch, twig).
    function addTube(part, pts, radii, flexes, sides, H, rough, seed) {
      const base = part.count;
      const dir = norm(sub(pts[pts.length - 1], pts[0]));
      const ref = Math.abs(dir[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
      const uRepeat = Math.max(1, Math.round((2 * Math.PI * radii[0]) / 0.45));
      let along = 0;
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        const t = norm(sub(pts[Math.min(pts.length - 1, i + 1)], pts[Math.max(0, i - 1)]));
        const nx = norm(cross(ref, t));
        const bx = cross(t, nx);
        if (i > 0) along += len(sub(p, pts[i - 1]));
        for (let j = 0; j <= sides; j++) {
          const a = (j / sides) * Math.PI * 2;
          const c = Math.cos(a), s = Math.sin(a);
          const d = [nx[0] * c + bx[0] * s, nx[1] * c + bx[1] * s, nx[2] * c + bx[2] * s];
          const bump = rough ? 1 + rough * (0.6 * Math.sin(a * 3 + i * 1.7 + seed) + 0.4 * Math.sin(a * 7 + i * 0.9 + seed * 2)) : 1;
          const r = radii[i] * bump;
          part.add([p[0] + d[0] * r, p[1] + d[1] * r, p[2] + d[2] * r], d, (j / sides) * uRepeat, along / 1.8,
            0.92 + 0.08 * Math.min(1, p[1] / 3), swayAt(p[1], H), flexes[i], 0);
        }
      }
      for (let i = 0; i < pts.length - 1; i++) {
        for (let j = 0; j < sides; j++) {
          const a = base + i * (sides + 1) + j;
          part.quad(a, a + sides + 1, a + sides + 2, a + 1);
        }
      }
    }
    const pointAlong = (pts, f) => {
      const x = f * (pts.length - 1), i = Math.min(pts.length - 2, Math.floor(x));
      return lerp3(pts[i], pts[i + 1], x - i);
    };
    const valueAlong = (vals, f) => {
      const x = f * (vals.length - 1), i = Math.min(vals.length - 2, Math.floor(x));
      return vals[i] + (vals[i + 1] - vals[i]) * (x - i);
    };
    const thin = (arr, keepEvery) => arr.filter((_, i) => i % keepEvery === 0 || i === arr.length - 1);

    // A blob of foliage fill (cluster core / far crown): an octahedron
    // (lod "core") or icosahedron (far crowns), jittered, with the fill texture.
    const ICO = (() => {
      const t = (1 + Math.sqrt(5)) / 2;
      const v = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map(norm);
      const f = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
        [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
      return { v, f };
    })();
    // Once-subdivided icosahedron (42 verts): rounder far crowns.
    const ICO1 = (() => {
      const v = ICO.v.slice(), f = [], mids = new Map();
      const mid = (a, b) => {
        const key = a < b ? a + "_" + b : b + "_" + a;
        if (!mids.has(key)) { v.push(norm(lerp3(v[a], v[b], 0.5))); mids.set(key, v.length - 1); }
        return mids.get(key);
      };
      for (const [a, b, c] of ICO.f) {
        const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
        f.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
      }
      return { v, f };
    })();
    const OCTA = {
      v: [[0, 1, 0], [1, 0, 0], [0, 0, 1], [-1, 0, 0], [0, 0, -1], [0, -1, 0]],
      f: [[0, 1, 2], [0, 2, 3], [0, 3, 4], [0, 4, 1], [5, 2, 1], [5, 3, 2], [5, 4, 3], [5, 1, 4]],
    };
    function addBlob(part, shape, center, radii, outward, jitter, shade, sway, flex, flutter, rand, uvScale = 1) {
      const base = part.count;
      const ou = rand() * 0.2, ov = rand() * 0.2;
      for (const d of shape.v) {
        const j = 1 + (rand() - 0.5) * jitter;
        const p = [center[0] + d[0] * radii[0] * j, center[1] + d[1] * radii[1] * j, center[2] + d[2] * radii[2] * j];
        const n = outward ? norm(add(mul(outward, 0.7), mul(d, 0.3))) : d;
        const u = Q_FILL[0] + 0.05 + 0.2 * (1 + (d[0] * 0.8 + d[2] * 0.4) * uvScale) * 0.9 + ou;
        const v = Q_FILL[1] + 0.05 + 0.2 * (1 + (d[1] * 0.8 - d[2] * 0.3) * uvScale) * 0.9 + ov;
        part.add(p, n, Math.min(0.48, u), Math.min(0.48, v), shade * (0.85 + 0.15 * (d[1] + 1) / 2), sway, flex, flutter);
      }
      for (const f of shape.f) part.tri(base + f[0], base + f[1], base + f[2]);
    }
    // A flat leaf card: center, facing normal, half size, atlas quadrant.
    function addCard(part, center, facing, lightNormal, half, quadrant, rot, shade, sway, flex, flutter) {
      const ref = Math.abs(facing[1]) < 0.95 ? [0, 1, 0] : [1, 0, 0];
      const t1 = norm(cross(facing, ref)), t2 = cross(facing, t1);
      const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
      const uvs = [[0, 0], [1, 0], [1, 1], [0, 1]];
      const base = part.count;
      corners.forEach(([a, b], k) => {
        const p = add(center, add(mul(t1, a * half), mul(t2, b * half)));
        const [u, v] = uvs[(k + rot) % 4];
        part.add(p, lightNormal, quadrant[0] + 0.004 + u * 0.492, quadrant[1] + 0.004 + v * 0.492, shade, sway, flex, flutter);
      });
      part.quad(base, base + 1, base + 2, base + 3);
    }

    function buildBroadleaf(spec, seed) {
      const rand = mulberry32(seed);
      // Trunk lift: the crown sits TRUNK_LIFT of the tree's height higher on
      // a longer trunk (the crown itself keeps its size).
      const lift = spec.H * TRUNK_LIFT;
      const H = spec.H + lift, R = spec.R, Ry = spec.R * spec.Ry;
      const crownBase = spec.base * spec.H + lift;
      const leanAz = rand() * Math.PI * 2;
      const lean = spec.lean || 0;
      const leanAt = (y) => [Math.cos(leanAz) * lean * y, 0, Math.sin(leanAz) * lean * y];

      // Crown: a few overlapping ellipsoid lobes -> an irregular silhouette.
      const lobes = [];
      const n = spec.lobes;
      const ring = (count, dist, y, size, sizeY, jit) => {
        const off = rand() * Math.PI * 2;
        for (let k = 0; k < count; k++) {
          const a = off + (k / count) * Math.PI * 2 + (rand() - 0.5) * jit;
          const d = dist * (0.8 + rand() * 0.4), s = size * (0.85 + rand() * 0.3);
          lobes.push({ c: [Math.cos(a) * d, y + (rand() - 0.5) * sizeY * 0.5, Math.sin(a) * d], r: [s, sizeY * (0.85 + rand() * 0.3), s * (0.85 + rand() * 0.3)] });
        }
      };
      if (spec.shape === "column") {
        const rv = (H - crownBase) / (n + 0.6);
        for (let k = 0; k < n; k++) {
          const f = n > 1 ? k / (n - 1) : 0;
          const rh = R * (0.95 - 0.35 * Math.abs(f - 0.35)) * (0.9 + rand() * 0.2);
          lobes.push({ c: [(rand() - 0.5) * R * 0.3, crownBase + rv * 0.9 + f * (H - crownBase - rv * 1.9), (rand() - 0.5) * R * 0.3], r: [rh, rv * 1.05, rh * (0.85 + rand() * 0.3)] });
        }
      } else if (spec.shape === "flat") {
        lobes.push({ c: [0, H - Ry, 0], r: [R * 0.8, Ry, R * 0.8] });
        ring(n - 1, R * 0.5, H - Ry * 1.15, R * 0.5, Ry * 0.8, 0.8);
      } else if (spec.shape === "vase") {
        lobes.push({ c: [0, H - Ry * 1.3, 0], r: [R * 0.45, Ry * 0.8, R * 0.45] });
        ring(n - 1, R * 0.58, H - Ry * 0.95, R * 0.48, Ry * 0.9, 0.6);
      } else if (spec.shape === "irregular") {
        const heavy = rand() * Math.PI * 2; // one side fuller, like a tree that grew toward the light
        lobes.push({ c: [Math.cos(heavy) * R * 0.15, H - Ry, Math.sin(heavy) * R * 0.15], r: [R * 0.7, Ry, R * 0.7] });
        for (let k = 1; k < n; k++) {
          const a = heavy + (rand() - 0.5) * 3.4;
          const d = R * (0.4 + rand() * 0.3), s = R * (0.38 + rand() * 0.3);
          lobes.push({ c: [Math.cos(a) * d, H - Ry * (0.9 + rand() * 0.6), Math.sin(a) * d], r: [s, Ry * (0.55 + rand() * 0.35), s * (0.8 + rand() * 0.4)] });
        }
      } else { // round
        lobes.push({ c: [0, H - Ry, 0], r: [R * 0.82, Ry, R * 0.82] });
        ring(n - 1, R * 0.42, H - Ry * 1.2, R * 0.58, Ry * 0.75, 0.9);
      }
      for (const l of lobes) {
        if (l.c[1] - l.r[1] < crownBase) l.c[1] = crownBase + l.r[1] * 0.85;
        if (l.c[1] + l.r[1] > H) l.r[1] = Math.max(0.5, H - l.c[1]);
        const shift = leanAt(l.c[1]);
        l.c[0] += shift[0]; l.c[2] += shift[2];
      }
      const cc = [0, 0, 0];
      let wsum = 0;
      for (const l of lobes) { const w = l.r[0] * l.r[1] * l.r[2]; cc[0] += l.c[0] * w; cc[1] += l.c[1] * w; cc[2] += l.c[2] * w; wsum += w; }
      cc[0] /= wsum; cc[1] /= wsum; cc[2] /= wsum;
      const crownNormal = (p) => norm(add(norm([(p[0] - cc[0]) / R, (p[1] - cc[1]) / Ry, (p[2] - cc[2]) / R]), [0, 0.35, 0]));

      // Trunk(s): wander a little on the way up, flare at the base, and
      // keep going (thinning) into the crown as the leader.
      const trunks = [];
      const leader = crownBase + (H - crownBase) * 0.55;
      for (let k = 0; k < spec.trunks; k++) {
        const multi = spec.trunks > 1;
        const az = (k / spec.trunks) * Math.PI * 2 + rand() * 0.8;
        const splay = multi ? 0.12 + rand() * 0.12 : 0;
        const top = leader * (multi ? 0.8 + rand() * 0.2 : 1);
        const pts = [], radii = [], flex = [];
        let wx = 0, wz = 0;
        const segs = 5;
        for (let i = 0; i <= segs; i++) {
          const f = i / segs, y = top * f;
          if (i > 0) { wx += (rand() - 0.5) * 0.28; wz += (rand() - 0.5) * 0.28; }
          const l = leanAt(y);
          pts.push([Math.cos(az) * (splay * y + (multi ? 0.1 : 0)) + l[0] + wx * f, y, Math.sin(az) * (splay * y + (multi ? 0.1 : 0)) + l[2] + wz * f]);
          radii.push(spec.trunkR * (1 - 0.72 * f) * (i === 0 ? 1.3 : 1));
          flex.push(f * f * 0.12);
        }
        trunks.push({ pts, radii, flex });
      }
      // Foliage clusters, mostly toward each lobe's surface.
      const clusters = [];
      const vol = lobes.map((l) => l.r[0] * l.r[1] * l.r[2]);
      for (let k = 0; k < Math.round(spec.clusters * 1.5); k++) {
        const li = lobes.indexOf(pickWeighted(lobes, rand(), (l) => vol[lobes.indexOf(l)]));
        const l = lobes[li];
        const d = randomUnit(rand);
        const f = spec.sparse ? 0.4 + 0.6 * Math.pow(rand(), 0.5) : 0.5 + 0.5 * Math.pow(rand(), 0.6);
        const pos = [l.c[0] + d[0] * l.r[0] * f, l.c[1] + d[1] * l.r[1] * f, l.c[2] + d[2] * l.r[2] * f];
        const size = spec.clusterR * (0.75 + rand() * 0.5) * Math.min(1.2, Math.max(0.7, l.r[0] / (R * 0.7)));
        pos[1] = Math.max(pos[1], crownBase + size * 0.4);
        const n = crownNormal(pos);
        const cards = [0, 1, 2].map(() => norm(add(mul(n, 0.6), mul(randomUnit(rand), 0.8))));
        const shade = Math.min(1, 0.5 + 0.34 * f + 0.2 * (pos[1] - crownBase) / (H - crownBase));
        clusters.push({
          pos, size, n, f, shade, cards, rank: rand(), phase: rand() * 2, rot: (rand() * 4) | 0,
          quadrant: rand() < spec.leaf ? Q_BROAD : Q_SMALL, seed: (rand() * 1e9) | 0,
        });
      }

      // Major branches from the upper trunk out into the lobes, each with a
      // couple of smaller branches (full detail only).
      const branches = [];
      for (let b = 0; b < spec.branches; b++) {
        const tr = trunks[b % trunks.length];
        const f0 = 0.5 + rand() * 0.42;
        const start = pointAlong(tr.pts, f0);
        const r0 = valueAlong(tr.radii, f0) * (0.5 + rand() * 0.15);
        const lobe = lobes[(b + 1) % lobes.length];
        const d = randomUnit(rand);
        const target = [lobe.c[0] + d[0] * lobe.r[0] * 0.55, lobe.c[1] + Math.abs(d[1]) * lobe.r[1] * 0.4, lobe.c[2] + d[2] * lobe.r[2] * 0.55];
        const pts = [start, lerp3(start, target, 0.34), lerp3(start, target, 0.68), target];
        pts[1] = [pts[1][0], start[1] + (target[1] - start[1]) * 0.22, pts[1][2]]; // arching: out first, then up
        pts[2] = [pts[2][0], start[1] + (target[1] - start[1]) * 0.6, pts[2][2]];
        const twigs = [];
        for (let k = 0; k < 2; k++) {
          const tf = 0.45 + rand() * 0.35;
          const ts = pointAlong(pts, tf);
          // ...ending inside a leaf cluster, never poking out bare.
          const near = clusters.filter((c) => len(sub(c.pos, target)) < lobe.r[0] * 1.2);
          const cl = near.length ? near[Math.floor(rand() * near.length)] : clusters[Math.floor(rand() * clusters.length)];
          const tt = lerp3(ts, cl.pos, 0.85);
          twigs.push({ pts: [ts, lerp3(ts, tt, 0.5), tt], radii: [r0 * 0.4, r0 * 0.22, 0.02], flex: [0.55, 0.8, 1] });
        }
        branches.push({ pts, radii: [r0, r0 * 0.7, r0 * 0.4, 0.035], flex: [f0 * 0.15, 0.4, 0.75, 1], twigs });
      }
      const lods = [0, 1, 2].map((lod) => {
        const bark = new Part();
        const leaves = [];
        for (const tr of trunks) {
          if (lod === 2) addTube(bark, [tr.pts[0], pointAlong(tr.pts, 0.7)], [tr.radii[0], valueAlong(tr.radii, 0.7)], [0, tr.flex[3]], 4, H, 0, 0);
          else if (lod === 1) addTube(bark, thin(tr.pts, 2), thin(tr.radii, 2), thin(tr.flex, 2), 5, H, 0, 0);
          else addTube(bark, tr.pts, tr.radii, tr.flex, 7, H, 0.1, seed % 7);
        }
        if (lod < 2) {
          for (const br of branches) {
            addTube(bark, lod === 0 ? br.pts : [br.pts[0], br.pts[2], br.pts[3]], lod === 0 ? br.radii : [br.radii[0], br.radii[2], br.radii[3]],
              lod === 0 ? br.flex : [br.flex[0], br.flex[2], br.flex[3]], lod === 0 ? 5 : 3, H, 0, 0);
            if (lod === 0) for (const tw of br.twigs) addTube(bark, tw.pts, tw.radii, tw.flex, 3, H, 0, 0);
          }
        }
        if (lod === 2) {
          // Far: one jittered blob per lobe.
          const r2 = mulberry32(seed + 99);
          for (const l of lobes) {
            const part = new Part(0, 0);
            addBlob(part, ICO1, l.c, mul(l.r, 0.95), null, 0.14, 0.78, swayAt(l.c[1], H), 0.3, 0.2, r2, 0.3);
            leaves.push(part);
          }
        } else {
          for (const cl of clusters) {
            if (lod === 1 && cl.rank > 0.55) continue;
            const part = new Part(cl.phase, lod === 1 ? cl.rank / 0.55 : cl.rank);
            const r = mulberry32(cl.seed);
            const s = cl.size * (lod === 1 ? 1.25 : 1);
            const sway = swayAt(cl.pos[1], H), flex = 0.45 + 0.55 * cl.f;
            addBlob(part, OCTA, cl.pos, [s * 0.65, s * 0.52, s * 0.65], cl.n, 0.3, cl.shade * 0.9, sway, flex, 0.35, r);
            const cardCount = lod === 0 ? 3 : 2;
            for (let c = 0; c < cardCount; c++) {
              addCard(part, add(cl.pos, mul(cl.n, s * 0.12)), cl.cards[c], cl.n, s * 1.2, cl.quadrant, (cl.rot + c) % 4, cl.shade, sway, flex, 1);
            }
            leaves.push(part);
          }
        }
        return { bark, leaves };
      });
      let crownR = 0;
      for (const l of lobes) crownR = Math.max(crownR, Math.hypot(l.c[0], l.c[2]) + l.r[0]);
      return { lods, H, crownR };
    }

    function buildConifer(spec, seed) {
      const rand = mulberry32(seed);
      const lift = spec.H * TRUNK_LIFT * 0.6; // conifers: a bit more bare trunk under the lowest branches
      const H = spec.H + lift, R = spec.R;
      const y0 = spec.base * spec.H + lift, yTop = H * 0.96;
      const tiers = [];
      for (let i = 0; i < spec.tiers; i++) {
        const t = i / (spec.tiers - 1);
        const y = y0 + (yTop - y0) * t + (rand() - 0.5) * 0.25;
        const r = (R * Math.pow(1 - t, 0.85) + 0.25) * (0.88 + rand() * 0.24);
        const count = Math.max(3, Math.round(spec.perTier * (1 - 0.45 * t)));
        const off = rand() * Math.PI * 2;
        const branches = [];
        for (let b = 0; b < count; b++) {
          branches.push({
            az: off + (b / count) * Math.PI * 2 + (rand() - 0.5) * 0.5, len: r * (0.85 + rand() * 0.3),
            droop: spec.droop * (0.7 + rand() * 0.6), width: 0.9 + rand() * 0.4, phase: rand() * 2, rank: rand(),
            tuft: randomUnit(rand), seed: (rand() * 1e9) | 0,
          });
        }
        tiers.push({ y, r, t, branches });
      }
      const trunkPts = [], trunkR = [], trunkFlex = [];
      let wx = 0, wz = 0;
      for (let i = 0; i <= 5; i++) {
        const f = i / 5;
        if (i > 0) { wx += (rand() - 0.5) * 0.12; wz += (rand() - 0.5) * 0.12; }
        trunkPts.push([wx * f, yTop * f, wz * f]);
        trunkR.push(spec.trunkR * (1 - 0.88 * f) * (i === 0 ? 1.3 : 1));
        trunkFlex.push(f * f * 0.1);
      }
      const upOut = (dir) => norm(add(mul(dir, 0.6), [0, 0.8, 0]));

      const branchCard = (part, tier, br, widthMul, tufts, lod) => {
        const dir = [Math.cos(br.az), 0, Math.sin(br.az)];
        const side = [-dir[2], 0, dir[0]];
        const root = [dir[0] * 0.05, tier.y, dir[2] * 0.05];
        const tip = [dir[0] * br.len, tier.y - br.droop * br.len, dir[2] * br.len];
        const w = br.len * 0.5 * br.width * widthMul * (tufts ? 0.45 : 1);
        const lift = br.len * 0.12;
        const n = upOut(dir);
        const sw0 = swayAt(root[1], H), sw1 = swayAt(tip[1], H);
        const base = part.count;
        const q = Q_NEEDLE;
        // A shallow V: the needle spray on both sides of the branch, tilted up.
        part.add(root, n, q[0] + 0.004, q[1] + 0.25, 0.55, sw0, 0.08, 0);
        part.add(tip, n, q[0] + 0.496, q[1] + 0.25, 0.95, sw1, 0.7, 0.45);
        part.add(add(root, add(mul(side, -0.12), [0, 0.04, 0])), n, q[0] + 0.004, q[1] + 0.004, 0.55, sw0, 0.08, 0);
        part.add(add(tip, add(mul(side, -w), [0, lift, 0])), n, q[0] + 0.496, q[1] + 0.004, 0.9, sw1, 0.7, 0.5);
        part.add(add(root, add(mul(side, 0.12), [0, 0.04, 0])), n, q[0] + 0.004, q[1] + 0.496, 0.55, sw0, 0.08, 0);
        part.add(add(tip, add(mul(side, w), [0, lift, 0])), n, q[0] + 0.496, q[1] + 0.496, 0.9, sw1, 0.7, 0.5);
        part.quad(base, base + 1, base + 3, base + 2);
        part.quad(base, base + 4, base + 5, base + 1);
        if (!tufts) {
          // ...and an upright spray along it, so it has depth from the side.
          const v0 = part.count, hgt = w * 0.55;
          part.add(add(root, [0, hgt * 0.6, 0]), n, q[0] + 0.004, q[1] + 0.496, 0.6, sw0, 0.08, 0);
          part.add(add(tip, [0, hgt * 0.5, 0]), n, q[0] + 0.496, q[1] + 0.496, 0.95, sw1, 0.7, 0.5);
          part.add(add(tip, [0, -hgt * 0.5, 0]), n, q[0] + 0.496, q[1] + 0.004, 0.75, sw1, 0.7, 0.5);
          part.add(add(root, [0, -hgt * 0.4, 0]), n, q[0] + 0.004, q[1] + 0.004, 0.5, sw0, 0.08, 0);
          part.quad(v0, v0 + 1, v0 + 2, v0 + 3);
        }
        if (tufts) {
          // Pine: a visible limb with a clump of needles at its end.
          addTube(part.bark, [root, lerp3(root, tip, 0.5), tip], [0.07, 0.05, 0.03], [0.05, 0.4, 0.7], 3, H, 0, 0);
          const r = mulberry32(br.seed);
          const s = 1.0 + r() * 0.45;
          const c = add(tip, [0, 0.2, 0]);
          addBlob(part, OCTA, c, [s * 0.6, s * 0.42, s * 0.6], n, 0.3, 0.65, sw1, 0.7, 0.4, r);
          const cards = lod === 0 ? 3 : 2;
          for (let k = 0; k < cards; k++) addCard(part, c, norm(add(br.tuft, [0.4 * k, 0.6 * k, -0.3 * k])), n, s * 1.05, Q_SMALL, k, 0.85, sw1, 0.7, 0.8);
        }
      };
      // Each tier's needle mass: an irregular cone skirt reaching up to
      // the tier above, so the tiers overlap into one conifer silhouette.
      const spacing = (yTop - y0) / (spec.tiers - 1);
      const fillCone = (part, tier, rMul, span) => {
        const r = tier.r * 0.82 * rMul;
        const yb = tier.y - Math.max(0.15, spec.droop) * tier.r * 0.55;
        const apexY = Math.min(H, tier.y + spacing * span);
        const apex = part.add([0, apexY, 0], [0, 1, 0], Q_FILL[0] + 0.25, Q_FILL[1] + 0.25, 0.55, swayAt(apexY, H), 0.1, 0);
        const base = part.count;
        const jr = mulberry32(Math.round(tier.y * 1000) + seed);
        const jit = [];
        for (let k = 0; k < 12; k++) jit.push(0.85 + jr() * 0.3);
        for (let k = 0; k <= 12; k++) {
          const a = (k / 12) * Math.PI * 2;
          const d = [Math.cos(a), 0, Math.sin(a)];
          const rr = r * jit[k % 12];
          part.add([d[0] * rr, yb + (jit[(k + 5) % 12] - 1) * 0.4, d[2] * rr], upOut(d), Q_FILL[0] + 0.25 + d[0] * 0.2, Q_FILL[1] + 0.25 + d[2] * 0.2, 0.8, swayAt(yb, H), 0.35, 0.15);
        }
        for (let k = 0; k < 12; k++) part.tri(apex, base + k, base + k + 1);
      };

      const lods = [0, 1, 2].map((lod) => {
        const bark = new Part();
        const leaves = [];
        if (lod === 2) {
          addTube(bark, [trunkPts[0], trunkPts[2]], [trunkR[0], trunkR[2]], [0, 0], 4, H, 0, 0);
          const part = new Part(0, 0);
          if (spec.tufts) {
            addBlob(part, ICO1, [0, y0 + (H - y0) * 0.55, 0], [R * 0.85, (H - y0) * 0.5, R * 0.85], null, 0.2, 0.72, 0.5, 0.2, 0.2, mulberry32(seed + 3), 0.3);
          } else {
            // One cone, base to tip.
            const apex = part.add([0, H, 0], [0, 1, 0], Q_FILL[0] + 0.25, Q_FILL[1] + 0.25, 0.9, 1, 0.2, 0);
            const base = part.count;
            for (let k = 0; k <= 8; k++) {
              const a = (k / 8) * Math.PI * 2;
              const d = [Math.cos(a), 0, Math.sin(a)];
              part.add([d[0] * R * 0.98, y0 - 0.2, d[2] * R * 0.98], upOut(d), Q_FILL[0] + 0.25 + d[0] * 0.22, Q_FILL[1] + 0.25 + d[2] * 0.22, 0.6, 0, 0.1, 0);
            }
            for (let k = 0; k < 8; k++) part.tri(apex, base + k, base + k + 1);
          }
          leaves.push(part);
          return { bark, leaves };
        }
        addTube(bark, lod === 0 ? trunkPts : thin(trunkPts, 2), lod === 0 ? trunkR : thin(trunkR, 2), lod === 0 ? trunkFlex : thin(trunkFlex, 2), lod === 0 ? 6 : 4, H, lod === 0 ? 0.08 : 0, seed % 5);
        tiers.forEach((tier, i) => {
          if (lod === 1 && i % 2 === 1 && i !== tiers.length - 1) return;
          if (spec.fill > 0) {
            const part = new Part(0, 0);
            fillCone(part, tier, lod === 1 ? 1.1 : 1, lod === 1 ? 2.6 : 1.5);
            leaves.push(part);
          }
          tier.branches.forEach((br, b) => {
            if (lod === 1 && b % 2 === 1) return;
            const part = new Part(br.phase, br.rank);
            part.bark = bark;
            branchCard(part, lod === 1 ? { y: tier.y, r: tier.r * 1.08 } : tier, br, lod === 1 ? 1.6 : 1, spec.tufts, lod);
            leaves.push(part);
          });
        });
        return { bark, leaves };
      });
      return { lods, H, crownR: R * 1.05 };
    }

    // Built on first use: TYPE -> [build 0, build 1].
    const builds = new Map();
    function typeBuild(spec, conifer, k) {
      const key = spec.name + "#" + k;
      if (!builds.has(key)) {
        const seed = 1000 + k * 7919 + spec.name.length * 131 + spec.name.charCodeAt(0) * 17;
        builds.set(key, conifer ? buildConifer(spec, seed) : buildBroadleaf(spec, seed));
      }
      return builds.get(key);
    }

    // --- Per tree ----------------------------------------------------------
    // tree: { x, z, evergreen, trunkHeight, canopyRadius, canopyHeight, maxCrownR? }
    function dressTree(tree) {
      const h = (k) => hash01(tree.x, tree.z, k);
      const conifer = !!tree.evergreen;
      // Its size as campus-world made it (height of the old trunk + canopy).
      const size = conifer ? tree.trunkHeight + tree.canopyHeight : tree.trunkHeight + tree.canopyHeight * 1.8;
      const small = size < 7.3;
      const forced = tree.forceType && [...BROADLEAF_TYPES, ...CONIFER_TYPES].find((s) => s.name === tree.forceType); // tests only
      // Old growth (the campus quad): only the big, full-crowned broadleaf types, and taller
      const OLD_TYPES = ["mature", "vase", "irregular", "open"];
      const old = !!tree.oldGrowth;
      const spec = forced || (conifer
        ? pickWeighted(CONIFER_TYPES, h(1), (s) => s.weight)
        : pickWeighted(BROADLEAF_TYPES, h(1), (s) => (old ? (OLD_TYPES.includes(s.name) ? s.weight : 0) : s.weight * (small && s.small ? 2.5 : 1))));
      const build = typeBuild(spec, CONIFER_TYPES.includes(spec), Math.floor(h(2) * TREE_BUILDS_PER_TYPE));
      let sh = (size / spec.H) * (0.85 + 0.35 * h(3));
      sh = (old ? Math.min(21, Math.max(14, sh * spec.H)) : Math.min(16, Math.max(4.5, sh * spec.H))) / spec.H;
      let sw = sh * (0.9 + 0.25 * h(4));
      // Near a walk-in building the crown was already shrunk to fit -- keep it that way.
      if (tree.maxCrownR !== undefined) sw = Math.min(sw, tree.maxCrownR / build.crownR);
      const height = build.H * sh;
      const leanAmount = h(6) * 0.05, leanAz = h(7) * Math.PI * 2;
      const tints = conifer ? CONIFER_TINTS : LEAF_TINTS;
      const leafTint = tints[Math.floor(h(8) * tints.length)];
      const leafBright = 0.88 + 0.22 * h(9);
      const barkChoices = conifer ? [1, 3] : spec.bark;
      const barkTint = BARK_TINTS[barkChoices[Math.floor(h(10) * barkChoices.length)]];
      const barkBright = 0.9 + 0.2 * h(11);
      // Wind response: small trees move more and quicker, big ones slower
      // and subtler; conifers are stiffer.
      const bigness = Math.min(1, Math.max(0, (height - 5) / 9));
      const stiff = conifer ? 0.7 : 1;
      return {
        x: tree.x, z: tree.z, build,
        sw, sh, rot: h(5) * Math.PI * 2,
        leanX: Math.cos(leanAz) * leanAmount, leanZ: Math.sin(leanAz) * leanAmount,
        density: conifer ? 0.85 + 0.15 * h(12) : 0.8 + 0.2 * h(12),
        leafTint: mul(leafTint, leafBright), barkTint: mul(barkTint, barkBright),
        sway: 0.45 * (1.25 - 0.6 * bigness) * stiff,
        flex: 0.18 * (1.2 - 0.4 * bigness) * stiff,
        freq: (1.3 - 0.5 * bigness) * (0.9 + 0.2 * h(13)),
        phase: h(14) * Math.PI * 2,
        height, radius: build.crownR * sw,
      };
    }

    // Merges the chosen pieces of many trees into one geometry.
    function mergeGeometry(items) {
      let vCount = 0, iCount = 0;
      for (const { part } of items) { vCount += part.count; iCount += part.i.length; }
      if (vCount === 0) return null;
      const pos = new Float32Array(vCount * 3), nrm = new Float32Array(vCount * 3), uv = new Float32Array(vCount * 2);
      const col = new Float32Array(vCount * 3), wind = new Float32Array(vCount * 4), freq = new Float32Array(vCount);
      const idx = vCount > 65535 ? new Uint32Array(iCount) : new Uint16Array(iCount);
      let v = 0, ii = 0;
      for (const { part, tree, tint } of items) {
        const c = Math.cos(tree.rot), s = Math.sin(tree.rot);
        const start = v;
        for (let k = 0; k < part.count; k++) {
          // scale -> lean (shear) -> rotate -> place
          const X0 = part.p[k * 3] * tree.sw, Y = part.p[k * 3 + 1] * tree.sh, Z0 = part.p[k * 3 + 2] * tree.sw;
          const X = X0 + Y * tree.leanX, Z = Z0 + Y * tree.leanZ;
          pos[v * 3] = tree.x + X * c - Z * s;
          pos[v * 3 + 1] = Y;
          pos[v * 3 + 2] = tree.z + X * s + Z * c;
          let nx = part.n[k * 3] / tree.sw, ny = part.n[k * 3 + 1] / tree.sh, nz = part.n[k * 3 + 2] / tree.sw;
          const nl = Math.hypot(nx, ny, nz) || 1;
          nx /= nl; ny /= nl; nz /= nl;
          nrm[v * 3] = nx * c - nz * s;
          nrm[v * 3 + 1] = ny;
          nrm[v * 3 + 2] = nx * s + nz * c;
          uv[v * 2] = part.uv[k * 2];
          uv[v * 2 + 1] = part.uv[k * 2 + 1];
          const shade = part.s[k];
          col[v * 3] = tint[0] * shade; col[v * 3 + 1] = tint[1] * shade; col[v * 3 + 2] = tint[2] * shade;
          wind[v * 4] = part.w[k * 3] * tree.sway;
          wind[v * 4 + 1] = part.w[k * 3 + 1] * tree.flex;
          wind[v * 4 + 2] = part.w[k * 3 + 2];
          wind[v * 4 + 3] = tree.phase + part.phase;
          freq[v] = tree.freq;
          v++;
        }
        for (const i of part.i) idx[ii++] = start + i;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      g.setAttribute("normal", new THREE.BufferAttribute(nrm, 3));
      g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
      g.setAttribute("color", new THREE.BufferAttribute(col, 3));
      g.setAttribute("windData", new THREE.BufferAttribute(wind, 4));
      g.setAttribute("windFreq", new THREE.BufferAttribute(freq, 1));
      g.setIndex(new THREE.BufferAttribute(idx, 1));
      g.computeBoundingSphere();
      g.boundingSphere.radius += 1; // room for the sway
      return g;
    }

    // --- Chunks + LOD --------------------------------------------------------
    const chunks = new Map();
    let chunkList = [];
    function addTrees(list) {
      for (const t of list) {
        const tree = dressTree(t);
        const key = Math.floor(tree.x / TREE_CHUNK_M) + "," + Math.floor(tree.z / TREE_CHUNK_M);
        if (!chunks.has(key)) chunks.set(key, { trees: [], cx: 0, cz: 0, lods: [null, null, null], shown: -1, fadeFrom: -1, fadeStart: -1e9 });
        chunks.get(key).trees.push(tree);
      }
      chunkList = [...chunks.values()];
      for (const ch of chunkList) {
        ch.cx = ch.trees.reduce((a, t) => a + t.x, 0) / ch.trees.length;
        ch.cz = ch.trees.reduce((a, t) => a + t.z, 0) / ch.trees.length;
      }
    }

    function buildChunkLod(ch, lod) {
      const barkItems = [], leafItems = [];
      for (const tree of ch.trees) {
        const g = tree.build.lods[lod];
        barkItems.push({ part: g.bark, tree, tint: tree.barkTint });
        for (const part of g.leaves) if (part.rank <= tree.density) leafItems.push({ part, tree, tint: tree.leafTint });
      }
      const meshes = [];
      for (const [items, material] of [[barkItems, barkMaterial], [leafItems, leafMaterial]]) {
        const geometry = mergeGeometry(items);
        if (!geometry) continue;
        const mesh = new THREE.Mesh(geometry, material);
        mesh.userData.kind = material === barkMaterial ? "bark" : "leaf";
        mesh.userData.baseMaterial = material;
        mesh.matrixAutoUpdate = false;
        mesh.visible = false;
        root.add(mesh);
        meshes.push(mesh);
      }
      ch.lods[lod] = meshes;
    }
    function freeChunkLod(ch, lod) {
      for (const mesh of ch.lods[lod]) { root.remove(mesh); mesh.geometry.dispose(); }
      ch.lods[lod] = null;
      if (ch.shown === lod) ch.shown = -1;
      if (ch.fadeFrom === lod) ch.fadeFrom = -1;
    }
    // step null = fully shown (base material); else a fade step in/out.
    function setMeshes(ch, lod, visible, step, out) {
      if (lod < 0 || !ch.lods[lod]) return;
      for (const m of ch.lods[lod]) {
        m.visible = visible;
        m.material = step === null ? m.userData.baseMaterial : fadeMaterial(m.userData.kind, step, out);
      }
    }
    // Switches a chunk to `lod` (-1 = none) with a short dithered
    // cross-fade (or a fade in/out at the draw-distance edge).
    function showChunk(ch, lod, now) {
      if (ch.shown !== lod) {
        // A fade still running is snapped to its end first.
        if (ch.fadeFrom !== -1) setMeshes(ch, ch.fadeFrom, false, null);
        ch.fadeFrom = ch.shown;
        ch.fadeStart = now;
        ch.fading = true;
        ch.shown = lod;
      }
      if (!ch.fading) return;
      const f = (now - ch.fadeStart) / LOD_FADE_TIME;
      if (f >= 1) {
        setMeshes(ch, ch.fadeFrom, false, null);
        setMeshes(ch, ch.shown, true, null);
        ch.fadeFrom = -1;
        ch.fading = false;
        return;
      }
      const step = Math.min(LOD_FADE_STEPS - 1, Math.max(1, Math.round(f * LOD_FADE_STEPS)));
      setMeshes(ch, ch.shown, true, step, false);
      setMeshes(ch, ch.fadeFrom, true, step, true);
    }

    // Per frame: picks each chunk's detail level from the nearest viewer.
    // lodScale (split screen): the LOD steps (not the draw distance) come
    // this many times sooner.
    function updateVisibility(viewers, lodScale = 1) {
      let budget = BUILDS_PER_UPDATE;
      const now = performance.now() / 1000;
      for (const ch of chunkList) {
        let d = Infinity;
        for (const v of viewers) d = Math.min(d, Math.hypot(v.x - ch.cx, v.z - ch.cz));
        // Hysteresis: a chunk keeps its current level a few meters past the line.
        const slack = (lod) => (ch.shown === lod ? LOD_HYSTERESIS_M : 0);
        const ld = d * lodScale;
        let want = ld < LOD_NEAR_M + slack(0) ? 0 : ld < LOD_MID_M + slack(1) ? 1 : d < DRAW_M + slack(2) ? 2 : -1;
        if (want >= 0 && !ch.lods[want]) {
          if (want === 2 || budget > 0 || ch.shown < 0) {
            if (want !== 2) budget--;
            buildChunkLod(ch, want);
          } else {
            want = ch.shown; // keep what it has until there's time to build the better one
          }
        }
        showChunk(ch, want, now);
        if (ch.lods[0] && d > FREE_LOD0_BEYOND_M) freeChunkLod(ch, 0);
        if (ch.lods[1] && d > FREE_LOD1_BEYOND_M) freeChunkLod(ch, 1);
      }
    }

    // How wooded it is around a point (0 none .. 1 among many trees) -- for
    // the rustling in the wind ambience.
    function treeDensityNear(x, z, radius = 22) {
      let count = 0;
      for (const ch of chunkList) {
        if (Math.abs(ch.cx - x) > radius + TREE_CHUNK_M || Math.abs(ch.cz - z) > radius + TREE_CHUNK_M) continue;
        for (const t of ch.trees) if ((t.x - x) ** 2 + (t.z - z) ** 2 < radius * radius) count++;
      }
      return Math.min(1, count / 8);
    }

    function stats() {
      let built = 0, verts = 0;
      for (const ch of chunkList) for (const l of ch.lods) if (l) { built++; for (const m of l) verts += m.geometry.attributes.position.count; }
      return { trees: chunkList.reduce((a, c) => a + c.trees.length, 0), chunks: chunkList.length, builtLods: built, verts, types: builds.size };
    }

    return { addTrees, updateVisibility, treeDensityNear, stats, barkMaterial, leafMaterial };
  }

  window.createTreeSystem = createTreeSystem;
})();
