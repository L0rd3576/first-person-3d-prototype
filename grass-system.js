// 3D grass (explicit request): low-poly grass clumps over the campus lawns,
// swaying in the same cosmetic wind as the trees. VISUAL ONLY -- nothing
// here collides or affects gameplay; where grass may grow comes from the
// world (campus-world.js's grassTesterForArea: lawns yes; streets,
// sidewalks, lots, fields, buildings, props... no).
//
//   - A clump is a handful of tapered, slightly curved blades leaning out
//     from a common root -- crossed at random angles, so it has volume from
//     every side. Two builds: NEAR (8 blades, 5 triangles each) and MID
//     (4 wider blades, 3 triangles each).
//   - Clumps are placed on a jittered grid per chunk, deterministically
//     from the chunk's coordinates: same grass every time you come back.
//     Each gets its own rotation, size, height, color and wind phase, and
//     low-frequency noise thins and tints the field in broad patches so it
//     never reads as a repeating tile.
//   - Two LOD layers, each its own chunk grid (NEAR: 16 m chunks, dense,
//     out to ~30 m; MID: 32 m chunks, sparse and wider, ~20 -> ~70 m).
//     Past that the ground's own grass texture is the far representation
//     (the fog is heavy there anyway). Chunks are built lazily when a
//     viewer comes near (a few per frame, nearest first), hidden past
//     their layer's range and freed further out.
//   - Every chunk is ONE draw: an instanced mesh whose per-clump data
//     (position, yaw, size, tint, phase) sits in two instance attributes.
//     No per-clump objects, no per-clump CPU work per frame.
//   - Distance fade is per clump, in the vertex shader, against the
//     camera actually drawing (each split-screen view fades its own
//     grass): clumps sink into the ground (and take on the ground's color)
//     across a band, with each clump's own threshold jittered -- no hard
//     ring where grass starts or stops, and the NEAR -> MID hand-over is
//     a cross-fade of the two layers.
//   - Wind is all on the GPU, from the shared weather uniforms (envTime,
//     windDir, windStrength, windGust -- see WEATHER in index.html): the
//     root never moves, the bend grows with height (squared) toward the
//     tip, and it layers a broad slow wave rolling downwind across the
//     field, a smaller faster flutter, and a per-clump phase -- the whole
//     field follows one wind, no two clumps quite in step. A light breeze
//     is always present, so the grass is never frozen on a calm day.
//     grassDisplace() in the shader is the single place to add other
//     pushes later (footsteps, explosions, vehicles) without touching the
//     rest of the system.
//   - No shadows cast or received (the campus ground receives none either).
//
// Usage: const grass = createGrassSystem(THREE, root, env, { testerForArea });
//   testerForArea(minX, minZ, maxX, maxZ) -> (x, z) => ground height, or -1 for no grass
//   grass.updateVisibility(viewers)   // once per frame, viewers = [{x, z}, ...]
//   grass.materials                   // for wet darkening
//   grass.stats()
(function () {
  "use strict";

  // Tunables (m unless noted). Density = 1 / spacing^2 clumps per m^2.
  const GRASS_SETTINGS = {
    bladeHeight: 0.34,       // nominal blade height before per-clump scale
    near: {
      chunk: 16, spacing: 0.4,
      fadeIn: [-100, -99],   // none: always full size up close (a real band -- a zero-width smoothstep is NaN on some GPUs)
      fadeOut: [21, 30],     // sinks into the ground across this band (MID takes over)
    },
    mid: {
      chunk: 32, spacing: 0.9,
      fadeIn: [17, 26],      // grows in as NEAR fades out
      fadeOut: [48, 68],     // into the ground texture before the fog closes in
    },
    fadeJitter: 3.5,         // +/- per-clump spread of every fade threshold
    hysteresis: 4,           // chunks stay a few meters past their range before hiding
    freeBeyond: 30,          // ...and are freed this much further out
    buildsPerFrame: 2,       // lazily built chunks per frame (beyond the immediate ring)
    immediateRange: 18,      // chunks this close to a viewer are built at once, never waited on
    breeze: 0.22,            // wind strength that's always present, on top of the weather's
    bend: 0.5,               // tip displacement per unit of sway, as a fraction of blade height
  };

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
  const hashSeed = (layer, cx, cz) => (Math.imul(cx, 73856093) ^ Math.imul(cz, 19349663) ^ Math.imul(layer + 1, 83492791)) >>> 0;
  // Smooth low-frequency value in 0..1 over the world, for patches.
  const patchNoise = (x, z) => 0.5 + 0.25 * Math.sin(x * 0.083 + Math.sin(z * 0.061) * 1.7) + 0.25 * Math.sin(z * 0.097 + Math.sin(x * 0.047 + 1.1) * 1.9);

  // The ground's grass color (campus-world's grass texture base, #6f9a4e) --
  // blades fade into it at a distance and are tinted around it.
  const GROUND = [0x6f / 255, 0x9a / 255, 0x4e / 255];

  function createGrassSystem(THREE, root, env, options) {
    const S = GRASS_SETTINGS;
    const testerForArea = options.testerForArea;

    // ---------------------------------------------------------------- clump geometry
    // One clump in its own space, root at the origin, height ~bladeHeight.
    // Per vertex: `grassBend` = how much of the wind bend it takes (0 at
    // the root, 1 at the tip -- squared, so the lower blade barely moves),
    // and a color from a dark base to a lighter, yellower tip.
    function buildClump(blades, rows, widthRange, seed) {
      const rand = mulberry32(seed);
      const pos = [], nrm = [], col = [], bend = [], idx = [];
      const H = S.bladeHeight;
      for (let b = 0; b < blades; b++) {
        const around = (b / blades) * Math.PI * 2 + rand() * 0.9;
        const rootR = 0.02 + rand() * 0.1;
        const rx = Math.cos(around) * rootR, rz = Math.sin(around) * rootR;
        const face = around + (rand() - 0.5) * 1.6;          // which way the blade's flat side turns
        const fx = Math.cos(face), fz = Math.sin(face);        // across the blade
        const lean = 0.05 + rand() * 0.25;                     // outward lean (radians)
        const curve = 0.08 + rand() * 0.24;                    // extra droop toward the tip
        const h = H * (0.7 + rand() * 0.4);
        const w = widthRange[0] + rand() * (widthRange[1] - widthRange[0]);
        const outX = Math.cos(around), outZ = Math.sin(around);
        const first = pos.length / 3;
        for (let r = 0; r <= rows; r++) {
          const t = r / rows;                                 // 0 root .. 1 tip
          const ang = lean + curve * t * t;
          const along = h * t;
          const out = Math.sin(ang) * along;
          const y = Math.cos(ang) * along;
          const cx = rx + outX * out, cz = rz + outZ * out;
          const half = r === rows ? 0 : (w / 2) * (1 - 0.72 * Math.pow(t, 1.3));
          // Mostly-up normals: lit like the lawn it grows from, with a
          // hint of the blade's facing so a clump isn't flat-shaded.
          const nx = -fz * 0.3, nz = fx * 0.3, ny = 0.95;
          const shade = 0.42 + 0.8 * Math.pow(t, 0.8);        // dark root -> light tip
          const yellow = 0.06 * t;
          const color = [GROUND[0] * shade * (1 + yellow * 2), GROUND[1] * shade, GROUND[2] * shade * (1 - yellow)];
          const k = Math.pow(t, 2);
          if (r === rows) {
            pos.push(cx, y, cz); nrm.push(nx, ny, nz); col.push(...color); bend.push(k);
          } else {
            pos.push(cx - fx * half, y, cz - fz * half, cx + fx * half, y, cz + fz * half);
            nrm.push(nx, ny, nz, nx, ny, nz);
            col.push(...color, ...color);
            bend.push(k, k);
          }
        }
        for (let r = 0; r < rows; r++) {
          const a = first + r * 2, bb = a + 1, c = a + 2, d = a + 3;
          if (r === rows - 1) idx.push(a, bb, c); // c is the tip
          else idx.push(a, bb, c, bb, d, c);
        }
      }
      return { pos: new Float32Array(pos), nrm: new Float32Array(nrm), col: new Float32Array(col), bend: new Float32Array(bend), idx: new Uint16Array(idx) };
    }
    const CLUMPS = {
      near: buildClump(8, 3, [0.026, 0.042], 11),
      mid: buildClump(4, 2, [0.05, 0.075], 23),
    };

    // ---------------------------------------------------------------- material
    // grassFade (vec4, per layer -- see makeMaterial): fade in start/end, fade out start/end (m).
    const DECL = [
      "attribute vec4 grassA;",   // world x, ground y, world z, yaw
      "attribute vec4 grassB;",   // size, height scale, tint (0..1), wind phase (0..2PI)
      "attribute float grassBend;",
      "uniform float envTime;",
      "uniform vec2 windDir;",
      "uniform float windStrength;",
      "uniform float windGust;",
      "const float GRASS_BREEZE = " + S.breeze.toFixed(3) + ";",
      "const float GRASS_BEND = " + S.bend.toFixed(3) + ";",
      "const float GRASS_JITTER = " + S.fadeJitter.toFixed(3) + ";",
      "const vec3 GRASS_GROUND = vec3(" + GROUND.map((c) => c.toFixed(4)).join(", ") + ");",
      // 1 = full size, 0 = sunk into the ground.
      // The drawing camera's world position, from the view matrix (this
      // three.js only uploads `cameraPosition` for some material types, not
      // Lambert). Per view, so each split-screen player fades their own grass.
      "vec2 grassCameraXZ() {",
      "  vec3 t = viewMatrix[3].xyz;",
      "  return -vec2(dot(viewMatrix[0].xyz, t), dot(viewMatrix[2].xyz, t));",
      "}",
      "float grassFadeAmount() {",
      "  float d = distance(grassCameraXZ(), grassA.xz) + (fract(grassB.w * 5.123) - 0.5) * 2.0 * GRASS_JITTER;",
      "  float fin = smoothstep(grassFade.x, grassFade.y, d);",
      "  return fin * (1.0 - smoothstep(grassFade.z, grassFade.w, d));",
      "}",
      // Wind: one field-wide wind with layered variation (see the header).
      "vec2 grassWind(vec2 w, float ph) {",
      "  float breeze = GRASS_BREEZE + windStrength;",
      "  float wave = sin(dot(w, windDir) * 0.15 - envTime * 1.25 + sin(dot(w, vec2(-windDir.y, windDir.x)) * 0.05) * 1.5);",
      "  float slow = 0.55 + 0.45 * wave;",
      "  float flutter = sin(envTime * 2.7 + ph + dot(w, vec2(1.3, 0.9))) * 0.5 + sin(envTime * 4.1 + ph * 1.7) * 0.25;",
      "  float sway = breeze * (0.62 * slow + 0.14 * flutter) + windGust * (0.55 + 0.45 * wave);",
      "  vec2 side = vec2(-windDir.y, windDir.x);",
      "  return windDir * sway + side * breeze * 0.16 * sin(envTime * 1.6 + ph);",
      "}",
      // Extra horizontal pushes (per unit of blade height) -- the hook for
      // footsteps, explosions, vehicles... Nothing yet.
      "vec2 grassDisplace(vec2 w) { return vec2(0.0); }",
    ].join("\n");
    const NORMAL = [
      "float grassC = cos(grassA.w), grassS = sin(grassA.w);",
      "objectNormal = vec3(objectNormal.x * grassC + objectNormal.z * grassS, objectNormal.y, -objectNormal.x * grassS + objectNormal.z * grassC);",
    ].join("\n");
    const VERTEX = [
      "vec3 transformed;",
      "{",
      "  float fade = grassFadeAmount();",
      "  float size = grassB.x;",
      "  float spread = smoothstep(0.0, 0.35, fade);", // gone entirely at 0, not left lying flat
      "  vec3 p = position * vec3(size * spread, size * grassB.y * fade, size * spread);",
      "  vec3 r = vec3(p.x * grassC + p.z * grassS, p.y, -p.x * grassS + p.z * grassC);",
      "  float bladeH = " + S.bladeHeight.toFixed(3) + " * size * grassB.y * fade;",
      "  vec2 push = (grassWind(grassA.xz, grassB.w) + grassDisplace(grassA.xz)) * GRASS_BEND * bladeH * grassBend;",
      "  r.xz += push;",
      "  r.y = sqrt(max(r.y * r.y - dot(push, push), 0.0));", // bend, don't stretch
      "  transformed = grassA.xyz + r;",
      "}",
    ].join("\n");
    const COLOR = [
      "{",
      "  float tint = grassB.z;",
      "  float bright = 0.87 + 0.26 * fract(tint * 13.7);",
      "  vec2 w = grassA.xz;",
      "  float patchy = 0.5 + 0.5 * sin(w.x * 0.071 + sin(w.y * 0.053) * 2.0) * sin(w.y * 0.089 + 1.3);",
      "  vec3 lush = vec3(0.88, 1.03, 0.86), dry = vec3(1.13, 1.05, 0.7);",
      "  vColor.xyz *= mix(lush, dry, clamp(tint * 0.5 + patchy * 0.5, 0.0, 1.0) * 0.75) * bright;",
      "  vColor.xyz = mix(GRASS_GROUND, vColor.xyz, grassFadeAmount());", // disappears into the lawn texture
      "}",
    ].join("\n");
    // The layer's fade band is baked into its own program as a constant
    // (with its own cache key): materials whose onBeforeCompile code is
    // identical share one program in this three.js, and then only one of
    // them gets its custom uniform values -- both layers would fade alike.
    function makeMaterial(name, fade) {
      const material = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true, side: THREE.DoubleSide });
      const fadeConst = "const vec4 grassFade = vec4(" + fade.map((f) => f.toFixed(3)).join(", ") + ");";
      material.customProgramCacheKey = () => "grass-" + name;
      material.onBeforeCompile = (shader) => {
        shader.uniforms.envTime = env.envTime;
        shader.uniforms.windDir = env.windDir;
        shader.uniforms.windStrength = env.windStrength;
        shader.uniforms.windGust = env.windGust;
        shader.vertexShader = shader.vertexShader
          .replace("#include <common>", "#include <common>\n" + fadeConst + "\n" + DECL)
          .replace("#include <color_vertex>", "#include <color_vertex>\n" + COLOR)
          .replace("#include <beginnormal_vertex>", "#include <beginnormal_vertex>\n" + NORMAL)
          .replace("#include <begin_vertex>", VERTEX);
        // Both faces lit like the front (the normals point up, not out of
        // a face), so a blade seen from behind isn't dark.
        shader.fragmentShader = shader.fragmentShader
          .replace("( gl_FrontFacing ) ? vLightFront : vLightBack", "vLightFront")
          .replace("( gl_FrontFacing ) ? vIndirectFront : vIndirectBack", "vIndirectFront");
      };
      return material;
    }

    // ---------------------------------------------------------------- layers + chunks
    const layers = ["near", "mid"].map((name, i) => {
      const cfg = S[name];
      return {
        name, index: i, cfg, clump: CLUMPS[name],
        material: makeMaterial(name, [cfg.fadeIn[0], cfg.fadeIn[1], cfg.fadeOut[0], cfg.fadeOut[1]]),
        // A chunk is wanted while any part of it is within the layer's range.
        drawM: cfg.fadeOut[1] + S.fadeJitter,
        chunks: new Map(), // "cx,cz" -> { cx, cz, mesh (null until built, or if no grass), count, built, shown }
      };
    });
    const group = new THREE.Group();
    group.name = "Grass";
    root.add(group);

    // Deterministic clumps for one chunk: a jittered grid over the chunk,
    // kept where the world says grass grows.
    function buildChunk(layer, chunk) {
      const cfg = layer.cfg;
      const size = cfg.chunk;
      const x0 = chunk.cx * size, z0 = chunk.cz * size;
      const cells = Math.max(1, Math.round(size / cfg.spacing));
      const step = size / cells;
      const rand = mulberry32(hashSeed(layer.index, chunk.cx, chunk.cz));
      const test = testerForArea(x0, z0, x0 + size, z0 + size);
      const a = new Float32Array(cells * cells * 4), b = new Float32Array(cells * cells * 4);
      let n = 0;
      const midScale = layer.name === "mid" ? 1.18 : 1;
      for (let j = 0; j < cells; j++) {
        for (let i = 0; i < cells; i++) {
          // Consume the same random numbers for every cell, kept or not,
          // so one cell's exclusion never reshuffles its neighbours.
          const jx = rand(), jz = rand(), yaw = rand() * Math.PI * 2, s = rand(), hs = rand(), tint = rand(), ph = rand(), keep = rand();
          const x = x0 + (i + jx) * step, z = z0 + (j + jz) * step;
          const patch = patchNoise(x, z);
          if (keep > 0.55 + 0.6 * patch) continue; // thinner in some patches, full in others
          const y = test(x, z);
          if (y < 0) continue;
          a[n * 4] = x; a[n * 4 + 1] = y; a[n * 4 + 2] = z; a[n * 4 + 3] = yaw;
          b[n * 4] = (0.72 + 0.5 * s) * midScale;
          b[n * 4 + 1] = (0.8 + 0.4 * hs) * (0.85 + 0.3 * patch); // taller where it grows thicker
          b[n * 4 + 2] = tint;
          b[n * 4 + 3] = ph * Math.PI * 2;
          n++;
        }
      }
      chunk.count = n;
      if (n === 0) return;
      const c = layer.clump;
      const geometry = new THREE.InstancedBufferGeometry();
      // Own copies of the (tiny) clump buffers, so disposing a chunk never
      // frees a buffer another chunk still draws with.
      geometry.setIndex(new THREE.BufferAttribute(c.idx.slice(), 1));
      geometry.setAttribute("position", new THREE.BufferAttribute(c.pos.slice(), 3));
      geometry.setAttribute("normal", new THREE.BufferAttribute(c.nrm.slice(), 3));
      geometry.setAttribute("color", new THREE.BufferAttribute(c.col.slice(), 3));
      geometry.setAttribute("grassBend", new THREE.BufferAttribute(c.bend.slice(), 1));
      geometry.setAttribute("grassA", new THREE.InstancedBufferAttribute(a.slice(0, n * 4), 4));
      geometry.setAttribute("grassB", new THREE.InstancedBufferAttribute(b.slice(0, n * 4), 4));
      geometry.instanceCount = n;
      // Culled as a whole chunk against the view frustum.
      geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(x0 + size / 2, 0.3, z0 + size / 2), size * 0.7072 + 0.8);
      geometry.boundingBox = new THREE.Box3(new THREE.Vector3(x0 - 0.5, -0.1, z0 - 0.5), new THREE.Vector3(x0 + size + 0.5, 0.8, z0 + size + 0.5));
      const mesh = new THREE.Mesh(geometry, layer.material);
      mesh.matrixAutoUpdate = false; // clumps are placed in world space by the shader
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.visible = false;
      mesh.name = "Grass " + layer.name + " " + chunk.cx + "," + chunk.cz;
      group.add(mesh);
      chunk.mesh = mesh;
    }
    const buildTimes = { count: 0, totalMs: 0, maxMs: 0 };
    function timedBuild(layer, chunk) {
      const t0 = performance.now();
      buildChunk(layer, chunk);
      chunk.built = true;
      const ms = performance.now() - t0;
      buildTimes.count++;
      buildTimes.totalMs += ms;
      buildTimes.maxMs = Math.max(buildTimes.maxMs, ms);
    }
    function freeChunk(layer, key, chunk) {
      if (chunk.mesh) {
        group.remove(chunk.mesh);
        chunk.mesh.geometry.dispose();
      }
      layer.chunks.delete(key);
    }

    // Distance from (x, z) to a chunk's square, 0 inside it.
    function chunkDistance(size, cx, cz, x, z) {
      const dx = Math.max(cx * size - x, 0, x - (cx + 1) * size);
      const dz = Math.max(cz * size - z, 0, z - (cz + 1) * size);
      return Math.hypot(dx, dz);
    }

    // Per frame: which chunks each layer wants from the nearest viewer;
    // build missing ones (the closest immediately, the rest a few per
    // frame), show/hide, and free far ones.
    const pending = [];
    function updateVisibility(viewers) {
      pending.length = 0;
      for (const layer of layers) {
        const size = layer.cfg.chunk;
        const reach = layer.drawM + S.hysteresis;
        for (const v of viewers) {
          const minCx = Math.floor((v.x - reach) / size), maxCx = Math.floor((v.x + reach) / size);
          const minCz = Math.floor((v.z - reach) / size), maxCz = Math.floor((v.z + reach) / size);
          for (let cz = minCz; cz <= maxCz; cz++) {
            for (let cx = minCx; cx <= maxCx; cx++) {
              const key = cx + "," + cz;
              if (layer.chunks.has(key)) continue;
              if (chunkDistance(size, cx, cz, v.x, v.z) > layer.drawM) continue;
              layer.chunks.set(key, { cx, cz, mesh: null, count: 0, built: false, shown: false });
            }
          }
        }
        for (const [key, chunk] of layer.chunks) {
          let d = Infinity;
          for (const v of viewers) d = Math.min(d, chunkDistance(size, chunk.cx, chunk.cz, v.x, v.z));
          if (d > layer.drawM + S.freeBeyond) { freeChunk(layer, key, chunk); continue; }
          const wanted = d <= layer.drawM + (chunk.shown ? S.hysteresis : 0);
          if (wanted && !chunk.built) {
            if (d <= S.immediateRange) timedBuild(layer, chunk);
            else pending.push({ layer, chunk, d });
          }
          chunk.shown = wanted;
          if (chunk.mesh) chunk.mesh.visible = wanted;
        }
      }
      if (pending.length) {
        pending.sort((p, q) => p.d - q.d);
        for (let i = 0; i < Math.min(S.buildsPerFrame, pending.length); i++) {
          const { layer, chunk } = pending[i];
          timedBuild(layer, chunk);
          if (chunk.mesh) chunk.mesh.visible = chunk.shown;
        }
      }
    }


    function stats() {
      const out = {};
      for (const layer of layers) {
        let built = 0, shown = 0, clumps = 0, shownClumps = 0;
        for (const c of layer.chunks.values()) {
          if (!c.mesh) continue;
          built++;
          clumps += c.count;
          if (c.mesh.visible) { shown++; shownClumps += c.count; }
        }
        out[layer.name] = { chunks: layer.chunks.size, built, shown, clumps, shownClumps, trianglesPerClump: layer.clump.idx.length / 3 };
      }
      out.builds = { count: buildTimes.count, avgMs: +(buildTimes.totalMs / Math.max(1, buildTimes.count)).toFixed(2), maxMs: +buildTimes.maxMs.toFixed(2) };
      return out;
    }

    return { group, updateVisibility, stats, materials: layers.map((l) => l.material), settings: S };
  }

  window.createGrassSystem = createGrassSystem;
  window.GRASS_SETTINGS = GRASS_SETTINGS;
})();
