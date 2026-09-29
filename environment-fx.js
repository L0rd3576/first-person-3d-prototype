// Environment FX: the shared, purely cosmetic "environment state" every
// material and ambient effect reads -- one set of global parameters
// (cloud shadows, wetness, puddles, atmosphere, sun glow, night lights),
// written once per frame by index.html's ENVIRONMENT STATE (which derives
// them from the existing day/night cycle and WEATHER) and applied on the
// GPU. Nothing here touches gameplay.
//
//   - ENVIRONMENT_CONFIG: the tunables for everything in the realism pass
//     (index.html, campus-world.js and grass-system.js read them from here).
//   - install(): one shader patch applied to every built-in lit material
//     (Lambert / Phong / Standard / Basic), after the material's own
//     onBeforeCompile, so the world reacts as one system:
//       * cloud shadows: direct sunlight modulated by a slowly drifting,
//         tiling cloud-noise texture projected along the sun direction;
//       * atmosphere: distance haze that desaturates and softens toward the
//         fog color before the scene's existing linear fog (same fog, same
//         distances -- only its look), plus a glow toward the sun that
//         matches the sky dome's (the cheap stand-in for light shafts);
//       * per-surface response (set with setSurface): broad color
//         variation, wet darkening, a wet sheen that reflects the sky at
//         grazing angles, puddles with rain ripples (flat ground only).
//     Every term is a uniform-gated branch: off costs one comparison.
//   - createAmbientParticles(): pooled GPU particles around each camera --
//     wind-blown leaves/debris and daylight dust motes. Positions are
//     computed in the vertex shader (like the rain), so no CPU per particle.
//   - createContactShadows(): soft blob shadows under feet, one instanced draw.
(function () {
  "use strict";

  const ENVIRONMENT_CONFIG = {
    // Ambient occlusion (cheap, baked into materials -- no screen-space pass):
    AO_INTENSITY: 0.3,              // wall darkening at its foot (0..1)
    AO_RADIUS: 1.3,                 // m up the wall it fades out over
    // Cloud shadows (a drifting noise texture over the sunlight).
    CLOUD_SHADOW_STRENGTH: 0.5,     // share of direct sun a cloud blocks at partly-cloudy cover
    CLOUD_SHADOW_SPEED: 3.2,        // m/s drift at calm wind (more with wind)
    CLOUD_SHADOW_SCALE: 190,        // m -- one tile of the cloud pattern
    CLOUD_SHADOW_OPACITY: 1.0,      // overall multiplier (0 disables)
    // Wetness / puddles (the wetness value itself is WEATHER's).
    WETNESS_STRENGTH: 1.0,          // scales every wet response
    WETNESS_DRYING_SPEED: 1.0,      // >1 dries faster than WEATHER_CONFIG.WET_DRY_TIME
    PUDDLE_DENSITY: 1.0,            // 0..1.5 -- how much ground puddles can cover
    PUDDLE_FILL_TIME: 90,           // s of steady rain until puddles are full
    PUDDLE_FADE_TIME: 170,          // s for them to dry up after the rain
    // Atmosphere (on top of the existing fog, never changing its distances).
    ATMOSPHERE_HAZE_STRENGTH: 0.18, // max blend toward the haze color, by day
    ATMOSPHERE_NIGHT_STRENGTH: 0.12,
    ATMOSPHERE_DISTANCE: 90,        // m -- e-folding distance of the haze
    ATMOSPHERE_DESATURATION: 0.45,  // how much distant color loses saturation
    SUN_SCATTER: 0.55,              // glow toward the sun in the haze
    // Sunrise / sunset (the transitions' lengths are the day/night cycle's own).
    SUNRISE_WARMTH: 1.0,            // 0 = sunrise looks like the old reversed sunset
    DAY_GRADING: 1.0,               // cool morning / warm afternoon strength within the day
    // Night.
    MOON_INTENSITY: 1.0,            // scales the moonlight
    NIGHT_AMBIENT: 1.0,             // scales the night fill
    // Night windows and exterior lights.
    WINDOWS_ENABLED: true,
    WINDOW_LIGHT_PERCENTAGE: 0.22,  // average share of windows lit at night
    WINDOW_BRIGHTNESS: 1.0,
    // Vegetation detail (grass-system.js's detail layers).
    VEGETATION_DENSITY: 1.0,        // weeds, bushes, flowers
    VEGETATION_RANGE: 42,           // m -- detail plants fade out by here
    // Ambient particles.
    ENVIRONMENT_PARTICLE_DENSITY: 1.0, // daylight dust motes
    WIND_DEBRIS_DENSITY: 1.0,       // leaves / bits blown in strong wind
    WIND_DEBRIS_THRESHOLD: 0.42,    // wind strength (0..1) where debris starts
    // Decals / surface wear.
    DECAL_DENSITY: 1.0,
    SURFACE_VARIATION: 1.0,         // broad blotchy color variation on large surfaces
    // Contact shadows.
    CONTACT_SHADOW_STRENGTH: 0.42,
    CONTACT_SHADOW_DISTANCE: 45,    // m -- blobs past this aren't drawn
    // LOD distances for the new effects (m).
    RIPPLE_DISTANCE: 22,
    DECAL_DRAW_DISTANCE: 140,
    // Exposure / eye adaptation (tone-mapping exposure, per view).
    EXPOSURE_INDOOR_BOOST: 0.16,    // brighter after a moment indoors
    EXPOSURE_ADAPT_TO_DARK: 1.4,    // s (time constant) adjusting to a darker place
    EXPOSURE_ADAPT_TO_BRIGHT: 0.5,  // s back out into daylight
    // Camera motion (CAMERA RUNNING MOTION in index.html).
    CAMERA_MOVEMENT_STRENGTH: 1.0,
    // How often the slower environment values are recomputed (s).
    SLOW_UPDATE_INTERVAL: 0.25,
  };

  // ---------------------------------------------------------------- noise
  // One 256x256 tiling RGBA noise texture: R cloud fbm, G broad blotches,
  // B mid-scale blotches, A puddle noise. Built once, deterministically.
  function buildNoiseTexture(THREE) {
    const N = 256;
    const data = new Uint8Array(N * N * 4);
    const hash = (x, y, s) => {
      let h = (x * 374761393 + y * 668265263 + s * 2246822519) | 0;
      h = Math.imul(h ^ (h >>> 13), 1274126177);
      return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
    };
    // Periodic value noise: `period` lattice cells across the tile.
    const valueNoise = (u, v, period, seed) => {
      const x = u * period, y = v * period;
      const x0 = Math.floor(x), y0 = Math.floor(y);
      const fx = x - x0, fy = y - y0;
      const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
      const w = (i) => ((i % period) + period) % period;
      const a = hash(w(x0), w(y0), seed), b = hash(w(x0 + 1), w(y0), seed);
      const c = hash(w(x0), w(y0 + 1), seed), d = hash(w(x0 + 1), w(y0 + 1), seed);
      return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
    };
    const fbm = (u, v, period, octaves, seed) => {
      let sum = 0, amp = 0.5, norm = 0;
      for (let o = 0; o < octaves; o++) {
        sum += amp * valueNoise(u, v, period << o, seed + o * 17);
        norm += amp;
        amp *= 0.5;
      }
      return sum / norm;
    };
    // fbm bunches up around 0.5; stretch each channel so thresholds spread.
    const byte = (x, contrast) => Math.round(255 * Math.min(1, Math.max(0, (x - 0.5) * contrast + 0.5)));
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const u = i / N, v = j / N, k = (j * N + i) * 4;
        data[k] = byte(fbm(u, v, 4, 5, 1), 2.2);
        data[k + 1] = byte(fbm(u, v, 3, 3, 101), 1.8);
        data[k + 2] = byte(fbm(u, v, 11, 3, 211), 1.8);
        data[k + 3] = byte(fbm(u, v, 9, 3, 307), 2.0);
      }
    }
    const texture = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.generateMipmaps = true;
    texture.needsUpdate = true;
    return texture;
  }

  // ---------------------------------------------------------------- shader patch
  const VERTEX_DECL = "varying vec3 vEnvWorld;\nvarying vec3 vEnvFromCam;";
  const VERTEX_BODY = [
    "{",
    "  vec4 envWorld4 = vec4(transformed, 1.0);",
    "  #ifdef USE_INSTANCING",
    "  envWorld4 = instanceMatrix * envWorld4;",
    "  #endif",
    "  envWorld4 = modelMatrix * envWorld4;",
    "  vEnvWorld = envWorld4.xyz;",
    // The drawing camera's position from the view matrix (cameraPosition
    // isn't uploaded for every material type in this three.js).
    "  vec3 envT = viewMatrix[3].xyz;",
    "  vEnvFromCam = envWorld4.xyz + vec3(dot(viewMatrix[0].xyz, envT), dot(viewMatrix[1].xyz, envT), dot(viewMatrix[2].xyz, envT));",
    "}",
  ].join("\n");

  const FRAGMENT_DECL = [
    "varying vec3 vEnvWorld;",
    "varying vec3 vEnvFromCam;",
    "uniform sampler2D envNoise;",
    "uniform vec2 envCloudOffset;",
    "uniform vec4 envCloud;",       // x scale (1/m), y strength, z cover threshold, w softness
    "uniform vec4 envWet;",         // x wetness, y puddles, z rain, w time
    "uniform vec3 envSkyColor;",    // what wet ground reflects
    "uniform vec3 envSunDir;",      // toward the sun (or moon)
    "uniform vec3 envSunGlow;",     // the sky's glow color * strength around the sun
    "uniform vec3 envSunSpec;",     // sun glint color on wet ground
    "uniform vec4 envAtmos;",       // x strength, y distance, z desaturation, w sun scatter
    "uniform vec4 envSurface;",     // per material: x wet sheen, y puddles (2 = road edges), z variation, w wet darken
    "float envCloudShade() {",
    "  if (envCloud.y < 0.001) return 1.0;",
    // projected along the sunlight, so walls and roofs agree with the ground
    "  vec2 p = vEnvWorld.xz - envSunDir.xz * (vEnvWorld.y / max(envSunDir.y, 0.25));",
    "  float n = texture2D(envNoise, p * envCloud.x + envCloudOffset).r;",
    "  return 1.0 - envCloud.y * smoothstep(envCloud.z - envCloud.w, envCloud.z + envCloud.w, n);",
    "}",
  ].join("\n");

  // Surface response, after the material's own color (map, vertex colors).
  const FRAGMENT_SURFACE = [
    "float envWetK = 0.0;",
    "float envPuddleK = 0.0;",
    "if (envSurface.x + envSurface.y + envSurface.z + envSurface.w > 0.0) {",
    "  vec4 envN = texture2D(envNoise, vEnvWorld.xz * 0.021 + vec2(0.37, 0.11));", // one fetch: G broad, B mid, A puddles
    "  diffuseColor.rgb *= 1.0 + envSurface.z * ((envN.g - 0.5) * 0.55 + (envN.b - 0.5) * 0.3);",
    "  diffuseColor.rgb *= 1.0 - envSurface.w * envWet.x;",
    "  envWetK = envWet.x * envSurface.x;",
    "  if (envSurface.y > 0.0 && envWet.y > 0.002) {",
    "    float m = envN.a * 0.8 + envN.b * 0.2;",
    "    #ifdef USE_MAP",
    "    if (envSurface.y > 1.5) m += 0.12 * smoothstep(0.3, 0.47, abs(vUv.y - 0.5)) - 0.05;", // gathers along road edges
    "    #endif",
    "    float thr = 0.83 - 0.12 * envWet.y + (1.0 - min(envSurface.y, 1.0)) * 0.1;", // ~10% of the ground when full; < 1: fewer here
    "    envPuddleK = smoothstep(thr, thr + 0.025, m) * smoothstep(0.0, 0.35, envWet.y);",
    "    diffuseColor.rgb *= 1.0 - 0.3 * envPuddleK;",
    "  }",
    "}",
  ].join("\n");

  // Wet sheen / puddle reflection, added to the lit color. Flat ground only
  // (the reflection assumes an up-facing surface).
  const FRAGMENT_REFLECT = [
    "if (envWetK * 0.36 + envPuddleK * 0.8 > 0.015) {",
    "  vec3 envV = normalize(vEnvFromCam);",
    "  float envCos = clamp(-envV.y, 0.0, 1.0);",
    "  float envFres = 0.03 + 0.97 * pow(1.0 - envCos, 5.0);",
    "  float envRefl = clamp(envWetK * 0.36 + envPuddleK * 0.8, 0.0, 0.8) * envFres;",
    "  vec3 envR = reflect(envV, vec3(0.0, 1.0, 0.0));",
    "  float envGlint = 0.0;",
    "  if (envSunSpec.r + envSunSpec.g > 0.02) envGlint = pow(max(dot(envR, envSunDir), 0.0), 90.0) * (envWetK * 0.6 + envPuddleK);",
    "  vec3 envCol = envSkyColor * 0.85;",
    "  if (envPuddleK > 0.01 && envWet.z > 0.01) {",
    "    float envDist = length(vEnvFromCam);",
    "    if (envDist < " + ENVIRONMENT_CONFIG.RIPPLE_DISTANCE.toFixed(1) + ") {",
    "      vec2 envCell = floor(vEnvWorld.xz * 1.6);",
    "      vec2 envF = fract(vEnvWorld.xz * 1.6) - 0.5;",
    "      float envH = fract(sin(dot(envCell, vec2(12.9898, 78.233))) * 43758.5453);",
    "      float envPh = fract(envWet.w * (0.7 + 0.5 * envH) + envH * 7.0);",
    "      float envRr = length(envF - (vec2(envH, fract(envH * 7.13)) - 0.5) * 0.35);",
    "      float envRing = smoothstep(0.035, 0.0, abs(envRr - envPh * 0.42)) * (1.0 - envPh) * step(envH, 0.3 + 0.7 * envWet.z);",
    "      envCol += envCol * envRing * envPuddleK * 0.9 * (1.0 - envDist / " + ENVIRONMENT_CONFIG.RIPPLE_DISTANCE.toFixed(1) + ");",
    "    }",
    "  }",
    "  outgoingLight = mix(outgoingLight, envCol, envRefl) + envSunSpec * envGlint;",
    "}",
  ].join("\n");

  // Atmosphere: haze in front of the existing fog, and the sun's glow
  // carried into both (so fogged ground toward a low sun matches the sky).
  const FRAGMENT_ATMOS_BEFORE = [
    "#ifdef USE_FOG",
    "vec3 envGlowAdd = vec3(0.0);",
    "if (envAtmos.x > 0.001 && fogDepth > 6.0) {", // (nearer than this the haze is under 1%: skipped)
    "  float envA = envAtmos.x * fogDepth / (fogDepth + envAtmos.y);",
    "  float envLum = dot(gl_FragColor.rgb, vec3(0.299, 0.587, 0.114));",
    "  gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(envLum), envA * envAtmos.z);",
    "  vec3 envVd = normalize(vEnvFromCam);",
    "  float envToSun = max(dot(envVd, envSunDir), 0.0);",
    "  float envS2 = envToSun * envToSun, envS4 = envS2 * envS2, envS8 = envS4 * envS4, envS32 = envS8 * envS8; envS32 *= envS32;",
    "  vec3 envGlow = envSunGlow * envAtmos.w * (envS4 * envToSun * 0.75 + envS32 * 0.6);",
    "  gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor + envGlow, envA);",
    "  #ifdef FOG_EXP2",
    "  float envFog = 1.0 - exp(-fogDensity * fogDensity * fogDepth * fogDepth);",
    "  #else",
    "  float envFog = smoothstep(fogNear, fogFar, fogDepth);",
    "  #endif",
    "  envGlowAdd = envGlow * envFog;",
    "}",
    "#endif",
  ].join("\n");
  const FRAGMENT_ATMOS_AFTER = "#ifdef USE_FOG\ngl_FragColor.rgb += envGlowAdd;\n#endif";

  function createEnvironmentFX(THREE) {
    const noise = buildNoiseTexture(THREE);
    const uniforms = {
      envNoise: { value: noise },
      envCloudOffset: { value: new THREE.Vector2(Math.random(), Math.random()) },
      envCloud: { value: new THREE.Vector4(1 / ENVIRONMENT_CONFIG.CLOUD_SHADOW_SCALE, 0, 0.7, 0.08) },
      envWet: { value: new THREE.Vector4(0, 0, 0, 0) },
      envSkyColor: { value: new THREE.Color(0x9fc4e0) },
      envSunDir: { value: new THREE.Vector3(0.5, 0.7, 0.3).normalize() },
      envSunGlow: { value: new THREE.Color(0, 0, 0) },
      envSunSpec: { value: new THREE.Color(0, 0, 0) },
      envAtmos: { value: new THREE.Vector4(0, ENVIRONMENT_CONFIG.ATMOSPHERE_DISTANCE, ENVIRONMENT_CONFIG.ATMOSPHERE_DESATURATION, 0) },
    };

    const noop = function () {};
    // Per-material surface response (see envSurface). Call before the
    // material is first drawn. Values are 0..1:
    //   wet: sheen when wet, puddles: 0/1 (2 = gathers along road edges),
    //   variation: broad color blotches, wetDarken: darkening when wet (for
    //   surfaces WEATHER's registerWetSurface doesn't already darken).
    function setSurface(material, s) {
      material.userData.envSurface = [s.wet || 0, s.puddles || 0, (s.variation || 0) * ENVIRONMENT_CONFIG.SURFACE_VARIATION, s.wetDarken || 0];
    }

    function patch(shader, material) {
      if (material.isShaderMaterial || material.isRawShaderMaterial) return;
      if (!(material.isMeshLambertMaterial || material.isMeshPhongMaterial || material.isMeshStandardMaterial ||
        material.isMeshBasicMaterial || material.isMeshToonMaterial)) return;
      let vs = shader.vertexShader, fs = shader.fragmentShader;
      if (fs.indexOf("vEnvWorld") !== -1) return; // already patched
      if (vs.indexOf("#include <worldpos_vertex>") === -1 || vs.indexOf("#include <common>") === -1 ||
        fs.indexOf("#include <common>") === -1) return;
      vs = vs.replace("#include <common>", "#include <common>\n" + VERTEX_DECL)
        .replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\n" + VERTEX_BODY);
      fs = fs.replace("#include <common>", "#include <common>\n" + FRAGMENT_DECL);
      // Cloud shadows on the direct (sun) light.
      if (fs.indexOf("* getShadowMask();") !== -1) {
        fs = fs.replace("* getShadowMask();", "* getShadowMask() * envCloudShade();");
      } else if (fs.indexOf("#include <lights_fragment_end>") !== -1) {
        fs = fs.replace("#include <lights_fragment_end>", "#include <lights_fragment_end>\n{ float envCs = envCloudShade(); reflectedLight.directDiffuse *= envCs; reflectedLight.directSpecular *= envCs; }");
      }
      const surface = material.userData && material.userData.envSurface;
      if (surface && fs.indexOf("#include <color_fragment>") !== -1) {
        fs = fs.replace("#include <color_fragment>", "#include <color_fragment>\n" + FRAGMENT_SURFACE);
        const line = "gl_FragColor = vec4( outgoingLight, diffuseColor.a );";
        if (fs.indexOf(line) !== -1) fs = fs.replace(line, FRAGMENT_REFLECT + "\n" + line);
        shader.uniforms.envSurface = { value: new THREE.Vector4().fromArray(surface) };
      } else {
        shader.uniforms.envSurface = { value: new THREE.Vector4(0, 0, 0, 0) };
      }
      if (fs.indexOf("#include <fog_fragment>") !== -1) {
        fs = fs.replace("#include <fog_fragment>", FRAGMENT_ATMOS_BEFORE + "\n#include <fog_fragment>\n" + FRAGMENT_ATMOS_AFTER);
      }
      shader.vertexShader = vs;
      shader.fragmentShader = fs;
      for (const k in uniforms) shader.uniforms[k] = uniforms[k];
    }

    // Every material's onBeforeCompile runs its own code first, then the
    // environment patch. A material's own function is kept as-is (so its
    // program cache key -- the function's source -- still tells materials
    // with different code apart); the patch always adds the same code, and
    // a surface flag gets its own key.
    function install() {
      const proto = THREE.Material.prototype;
      if (proto.__envInstalled) return;
      proto.__envInstalled = true;
      Object.defineProperty(proto, "onBeforeCompile", {
        configurable: true,
        get() {
          const own = this.__envOwnOnBeforeCompile || noop;
          if (!this.__envWrapped || this.__envWrappedFor !== own) {
            const material = this;
            this.__envWrappedFor = own;
            this.__envWrapped = function (shader, renderer) {
              own.call(material, shader, renderer);
              patch(shader, material);
            };
            this.__envWrapped.__envOwn = own;
          }
          return this.__envWrapped;
        },
        set(fn) {
          // Assigning another material's (wrapped) function keeps just its own part.
          this.__envOwnOnBeforeCompile = fn && fn.__envOwn ? fn.__envOwn : fn;
        },
      });
      proto.customProgramCacheKey = function () {
        const own = this.__envOwnOnBeforeCompile || noop;
        return own.toString() + (this.userData && this.userData.envSurface ? "|envSurface" : "|env");
      };
    }

    return { uniforms, setSurface, install, noiseTexture: noise, config: ENVIRONMENT_CONFIG };
  }

  // ---------------------------------------------------------------- ambient particles
  // Two small pooled particle volumes that follow whichever camera is
  // drawing: leaves/debris (a box ~26 m across) and dust motes (~14 m).
  // Every particle's position is a pure function of time and its seed,
  // wrapped inside the box, so nothing is spawned or updated on the CPU;
  // amounts fade particles in and out by their own threshold (no popping).
  // cameraScale(camera) -> 0..1, optional: fades both out per view (indoors).
  function createAmbientParticles(THREE, scene, cameraScale, maxLeaves = 70, maxDust = 260) {
    const shared = {
      camPos: { value: new THREE.Vector3() },
      time: { value: 0 },
      windVel: { value: new THREE.Vector3(1, 0, 0) },
      light: { value: new THREE.Color(1, 1, 1) },
      sunDir: { value: new THREE.Vector3(0, 1, 0) },
      pixelScale: { value: 400 },
      floorY: { value: 0 },
    };
    function points(count, seedBase, vertex, fragment, extraUniforms, blending) {
      const seeds = new Float32Array(count * 3);
      const rnd = new Float32Array(count);
      let s = seedBase;
      const rand = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
      for (let i = 0; i < count; i++) {
        seeds[i * 3] = rand(); seeds[i * 3 + 1] = rand(); seeds[i * 3 + 2] = rand();
        rnd[i] = rand();
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(seeds, 3));
      g.setAttribute("rnd", new THREE.BufferAttribute(rnd, 1));
      const material = new THREE.ShaderMaterial({
        uniforms: Object.assign({}, shared, extraUniforms),
        vertexShader: vertex, fragmentShader: fragment,
        transparent: true, depthWrite: false, fog: false, blending,
      });
      const p = new THREE.Points(g, material);
      p.frustumCulled = false;
      p.renderOrder = 9;
      p.visible = false;
      p.onBeforeRender = (_r, _s, cam) => {
        cam.getWorldPosition(shared.camPos.value);
        const k = cameraScale ? cameraScale(cam) : 1;
        extraUniforms.amount.value = extraUniforms.amount.base * k;
      };
      scene.add(p);
      return p;
    }
    const leafUniforms = { amount: { value: 0, base: 0 } };
    const leaves = points(maxLeaves, 7, [
      "uniform vec3 camPos; uniform float time; uniform vec3 windVel; uniform float pixelScale; uniform float amount; uniform float floorY;",
      "attribute float rnd; varying float vA; varying float vRot; varying vec3 vTint;",
      "void main() {",
      "  vec3 box = vec3(26.0, 7.0, 26.0);",
      "  float sp = 0.6 + 0.8 * rnd;",
      "  vec3 vel = windVel * sp + vec3(0.0, -0.35 - 0.3 * rnd, 0.0);",
      "  vec3 p = position * box + vel * time;",
      "  p.y += sin(time * (1.3 + rnd) + rnd * 20.0) * 0.6;",   // fluttering lift
      "  p.x += sin(time * 2.1 + rnd * 40.0) * 0.35; p.z += cos(time * 1.7 + rnd * 30.0) * 0.35;",
      "  vec3 center = camPos + vec3(0.0, box.y * 0.5 - 1.2, 0.0);",
      "  vec3 rel = mod(p - center, box) - box * 0.5;",
      "  vec3 wp = center + rel;",
      "  wp.y = max(wp.y, floorY + 0.05);",
      "  float edge = 1.0 - smoothstep(0.6, 1.0, length(rel.xz) / (box.x * 0.5));",
      "  vA = edge * smoothstep(rnd - 0.12, rnd, amount);",
      "  vRot = time * (2.0 + 3.0 * rnd) + rnd * 6.28;",
      "  vTint = mix(vec3(0.42, 0.3, 0.16), vec3(0.55, 0.52, 0.2), fract(rnd * 7.7));",
      "  vec4 mv = viewMatrix * vec4(wp, 1.0);",
      "  gl_PointSize = pixelScale * (0.07 + 0.05 * fract(rnd * 3.3)) / -mv.z;",
      "  gl_Position = projectionMatrix * mv;",
      "}",
    ].join("\n"), [
      "uniform vec3 light; varying float vA; varying float vRot; varying vec3 vTint;",
      "void main() {",
      "  vec2 d = gl_PointCoord - 0.5;",
      "  float c = cos(vRot), s = sin(vRot);",
      "  d = vec2(c * d.x - s * d.y, s * d.x + c * d.y);",
      "  d.y *= 2.3 * (0.55 + 0.45 * abs(sin(vRot * 0.7)));", // tumbling: flattens as it turns edge-on
      "  float a = smoothstep(0.5, 0.38, length(d)) * vA;",
      "  if (a < 0.02) discard;",
      "  gl_FragColor = vec4(vTint * light, a);",
      "}",
    ].join("\n"), leafUniforms, THREE.NormalBlending);

    const dustUniforms = { amount: { value: 0, base: 0 } };
    const dust = points(maxDust, 13, [
      "uniform vec3 camPos; uniform float time; uniform vec3 windVel; uniform float pixelScale; uniform float amount; uniform vec3 sunDir;",
      "attribute float rnd; varying float vA;",
      "void main() {",
      "  vec3 box = vec3(14.0, 5.0, 14.0);",
      "  vec3 drift = windVel * 0.12 + vec3(sin(time * 0.13 + rnd * 9.0), sin(time * 0.21 + rnd * 5.0) * 0.4, cos(time * 0.17 + rnd * 7.0)) * 0.25;",
      "  vec3 p = position * box + drift * time * 0.5 + vec3(sin(time * 0.5 + rnd * 30.0), cos(time * 0.4 + rnd * 20.0), sin(time * 0.45 + rnd * 10.0)) * 0.3;",
      "  vec3 center = camPos + vec3(0.0, 0.4, 0.0);",
      "  vec3 rel = mod(p - center, box) - box * 0.5;",
      "  vec3 wp = center + rel;",
      "  vec3 toP = normalize(wp - camPos);",
      "  float backlit = 0.2 + 1.6 * pow(max(dot(toP, sunDir), 0.0), 6.0);", // only really shows looking toward the sun
      "  float edge = 1.0 - smoothstep(0.55, 1.0, length(rel) / (box.x * 0.5));",
      "  vec4 mv = viewMatrix * vec4(wp, 1.0);",
      "  float near = smoothstep(0.4, 1.4, -mv.z);",
      "  vA = edge * near * backlit * smoothstep(rnd - 0.1, rnd, amount) * (0.5 + 0.5 * sin(time * (0.8 + rnd) + rnd * 50.0));",
      "  gl_PointSize = max(1.5, pixelScale * 0.012 / -mv.z);",
      "  gl_Position = projectionMatrix * mv;",
      "}",
    ].join("\n"), [
      "uniform vec3 light; varying float vA;",
      "void main() {",
      "  float a = smoothstep(0.5, 0.1, length(gl_PointCoord - 0.5)) * vA * 0.35;",
      "  if (a < 0.004) discard;",
      "  gl_FragColor = vec4(light * a, 1.0);",
      "}",
    ].join("\n"), dustUniforms, THREE.AdditiveBlending);

    return {
      shared, leaves, dust,
      // leafAmount / dustAmount 0..1; wind (m/s vector); light: a color
      // for how lit things are; sunDir toward the sun.
      update(time, leafAmount, dustAmount, windX, windZ, light, sunDir, pixelScale, floorY) {
        shared.time.value = time;
        shared.windVel.value.set(windX, 0, windZ);
        shared.light.value.copy(light);
        shared.sunDir.value.copy(sunDir);
        shared.pixelScale.value = pixelScale;
        shared.floorY.value = floorY;
        leafUniforms.amount.base = leafUniforms.amount.value = leafAmount;
        dustUniforms.amount.base = dustUniforms.amount.value = dustAmount;
        leaves.visible = leafAmount > 0.005;
        dust.visible = dustAmount > 0.005;
      },
      hide() { leaves.visible = false; dust.visible = false; },
    };
  }

  // ---------------------------------------------------------------- contact shadows
  // Soft dark discs under feet (players, zombies): one instanced draw,
  // positions rewritten each frame for the handful that are near a camera.
  function createContactShadows(THREE, scene, max = 80) {
    const size = 64;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext("2d");
    const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grad.addColorStop(0, "rgba(0,0,0,1)");
    grad.addColorStop(0.45, "rgba(0,0,0,0.6)");
    grad.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
    const texture = new THREE.CanvasTexture(canvas);
    const geometry = new THREE.PlaneGeometry(1, 1);
    geometry.rotateX(-Math.PI / 2);
    const material = new THREE.MeshBasicMaterial({ map: texture, color: 0x000000, transparent: true, depthWrite: false, opacity: 0.4, fog: false });
    material.polygonOffset = true;
    material.polygonOffsetFactor = -2;
    material.polygonOffsetUnits = -2;
    const mesh = new THREE.InstancedMesh(geometry, material, max);
    mesh.frustumCulled = false;
    mesh.renderOrder = 2;
    mesh.count = 0;
    scene.add(mesh);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const v = new THREE.Vector3();
    const s = new THREE.Vector3();
    let n = 0;
    return {
      mesh,
      begin() { n = 0; },
      add(x, y, z, radius) {
        if (n >= max) return;
        s.set(radius * 2, 1, radius * 2);
        m.compose(v.set(x, y + 0.025, z), q, s);
        mesh.setMatrixAt(n++, m);
      },
      end(opacity) {
        mesh.count = n;
        mesh.visible = n > 0 && opacity > 0.01;
        material.opacity = opacity;
        if (n > 0) mesh.instanceMatrix.needsUpdate = true;
      },
    };
  }

  window.ENVIRONMENT_CONFIG = ENVIRONMENT_CONFIG;
  window.createEnvironmentFX = createEnvironmentFX;
  // One shared instance, its patch installed before any other script
  // creates a material (a material that sets onBeforeCompile before this
  // would shadow the patch).
  if (window.THREE) {
    window.environmentFX = createEnvironmentFX(window.THREE);
    window.environmentFX.install();
  }
  window.createAmbientParticles = createAmbientParticles;
  window.createContactShadows = createContactShadows;
})();
