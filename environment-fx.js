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
//   - Visual polish pass:
//       * local lights (streetlights) in the same patch: the nearest few
//         lit lamps per view, from a tiny float texture (setLocalLights);
//       * createEffectParticles(): one pooled GPU particle ring per blend
//         mode (dust/chips/droplets/blood; sparks) -- written once per
//         particle, moved in the vertex shader;
//       * createDecals(): bullet holes, blood, scuffs, glass cracks,
//         ripples -- one instanced draw, fading in the shader;
//       * createShellCasings(): pooled brass / shotgun hulls, simple bounces;
//       * createSurfaceEffects(): what each material does when shot or
//         stepped on, out of the pools above.
(function () {
  "use strict";

  const ENVIRONMENT_CONFIG = {
    // Ambient occlusion (cheap, baked into materials -- no screen-space pass):
    AO_INTENSITY: 0.3,              // wall darkening at its foot (0..1)
    AO_RADIUS: 1.3,                 // m up the wall it fades out over
    // Cloud shadows (a drifting noise texture over the sunlight).
    CLOUD_SHADOWS_ENABLED: true,
    CLOUD_SHADOW_STRENGTH: 0.5,     // share of direct sun a cloud blocks at partly-cloudy cover
    CLOUD_SHADOW_SPEED: 3.2,        // m/s drift at calm wind (more with wind)
    CLOUD_SHADOW_SCALE: 190,        // m -- one tile of the cloud pattern
    CLOUD_SHADOW_SOFTNESS: 1.0,     // edge width multiplier (bigger = softer edges)
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

    // ---- Visual polish pass (all cosmetic; none of it touches gameplay).
    // Grass bending around players and zombies (grass-system.js).
    GRASS_INTERACTION_ENABLED: true,
    GRASS_INTERACTION_RADIUS: 0.85,         // m around a body's feet
    GRASS_INTERACTION_STRENGTH: 0.6,
    GRASS_INTERACTION_RECOVERY_SPEED: 1.1,  // 1/s -- how fast flattened grass stands back up
    GRASS_INTERACTION_RANGE: 16,            // m from a camera -- bodies further out don't bend grass
    // Bullet impacts, footstep puffs, shell casings (pooled, strict caps).
    IMPACT_EFFECTS_ENABLED: true,
    MAX_EFFECT_PARTICLES: 900,              // shared pool (dust, chips, droplets, blood)
    MAX_SPARK_PARTICLES: 240,               // additive pool (sparks, flashes)
    MAX_IMPACTS_PER_FRAME: 8,               // a shotgun blast shows at most this many
    IMPACT_EFFECT_DISTANCE: 70,             // m -- no particles past this (decals still)
    FOOTSTEP_PARTICLES_ENABLED: true,
    FOOTSTEP_PARTICLE_DISTANCE: 24,         // m from a camera
    SHELL_EJECTION_ENABLED: true,
    MAX_SHELL_CASINGS: 36,
    SHELL_CASING_LIFETIME: 6,               // s on the ground before they're gone
    // Decals: bullet holes, blood (gore setting), scuffs, glass cracks.
    MAX_DECALS: 80,
    DECAL_LIFETIME: 40,                     // s (fades over its last quarter)
    BLOOD_DECAL_LIFETIME: 28,
    // Streetlights (campus-world.js) and the local light they cast.
    STREETLIGHTS_ENABLED: true,
    STREETLIGHT_BRIGHTNESS: 1.0,
    STREETLIGHT_FLICKER_SHARE: 0.05,        // share of lamps that flicker now and then
    STREETLIGHT_BROKEN_SHARE: 0.04,         // share that never come on
    LOCAL_LIGHTS_ENABLED: true,             // lamps light the ground/walls/bodies around them (per pixel)
    LOCAL_LIGHT_INTENSITY: 1.0,             // scales every lamp's light on the world
    // Windows at night (beyond WINDOW_LIGHT_PERCENTAGE / _BRIGHTNESS above).
    WINDOW_SWITCH_SHARE: 0.12,              // share of windows that switch on/off now and then
    // Sun rays when the sun is low (screen-space, single-view only).
    SUN_RAYS_ENABLED: true,
    SUN_RAYS_STRENGTH: 0.32,
    // Subtle color grading (0 = off).
    COLOR_GRADING_STRENGTH: 1.0,
    // Leaves drifting down near trees even without strong wind.
    LEAF_FALL_DENSITY: 1.0,
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
    // Two layers at unrelated scales and drift speeds (the second slightly
    // rotated), so the clouds slowly change shape and never read as a tile.
    "  float n = texture2D(envNoise, p * envCloud.x + envCloudOffset).r * 0.68;",
    "  n += texture2D(envNoise, mat2(0.8, -0.6, 0.6, 0.8) * p * (envCloud.x * 2.37) + envCloudOffset * 1.61 + vec2(0.29, 0.53)).r * 0.32;",
    "  return 1.0 - envCloud.y * smoothstep(envCloud.z - envCloud.w, envCloud.z + envCloud.w, n);",
    "}",
  ].join("\n");

  // Local lights (streetlights; any future lamp): the few nearest lit ones
  // to the drawing camera, picked on the CPU (campus-world.js) and added
  // per pixel to every lit material -- no three.js lights, so no shader
  // recompiles and no per-light cost when none are on. Facet normals from
  // screen derivatives (WebGL2); a flat "up" on WebGL1.
  const LOCAL_LIGHT_COUNT = 4;
  // The lights live in a tiny float texture (row 0: xyz + radius, row 1:
  // color x intensity) rather than uniform arrays -- three.js re-uploads
  // uniform arrays on every material switch, a texture binding it caches.
  // Pixels outside the lit lamps' box (envLampBox: minX, minZ, maxX, maxZ)
  // skip the loop entirely.
  const FRAGMENT_LOCAL_LIGHT_DECL = [
    "uniform sampler2D envLampTex;",
    "uniform float envLampCount;",
    "uniform vec4 envLampBox;",
    "vec3 envLocalLight() {",
    "  vec3 sum = vec3(0.0);",
    "  #if __VERSION__ >= 300",
    // derivatives first, while every pixel of the quad is still here
    // (they're undefined inside per-pixel branches)
    "  vec3 envDx = dFdx(vEnvWorld), envDy = dFdy(vEnvWorld);",
    "  if (envLampCount < 0.5 || vEnvWorld.x < envLampBox.x || vEnvWorld.z < envLampBox.y || vEnvWorld.x > envLampBox.z || vEnvWorld.z > envLampBox.w) return sum;",
    "  if (dot(vEnvFromCam, vEnvFromCam) > 3600.0) return sum;", // past 60 m the fog has it
    "  vec3 n = vec3(0.0);",
    "  bool haveN = false;",
    "  for (int i = 0; i < " + LOCAL_LIGHT_COUNT + "; i++) {",
    "    if (float(i) >= envLampCount) break;",
    "    vec4 L = texelFetch(envLampTex, ivec2(i, 0), 0);",
    "    vec3 d = L.xyz - vEnvWorld;",
    "    float d2 = dot(d, d);",
    "    if (d2 >= L.w * L.w) continue;", // out of its reach: one fetch and done
    "    if (!haveN) {", // the facet normal, only once some lamp reaches this pixel
    "      n = normalize(cross(envDx, envDy));",
    "      if (dot(n, vEnvFromCam) > 0.0) n = -n;",
    "      haveN = true;",
    "    }",
    "    float fall = 1.0 - d2 / (L.w * L.w);",
    // soft window falloff times an inverse-square-ish core, wrapped diffuse
    "    float att = fall * fall / (1.0 + d2 * 0.012);",
    "    float ndl = max(dot(n, d * inversesqrt(max(d2, 1e-4))), 0.0) * 0.75 + 0.25;",
    "    sum += texelFetch(envLampTex, ivec2(i, 1), 0).rgb * (att * ndl);",
    "  }",
    "  #endif",
    "  return sum;",
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
    const lampData = new Float32Array(LOCAL_LIGHT_COUNT * 2 * 4);
    const lampTexture = new THREE.DataTexture(lampData, LOCAL_LIGHT_COUNT, 2, THREE.RGBAFormat, THREE.FloatType);
    lampTexture.magFilter = lampTexture.minFilter = THREE.NearestFilter;
    lampTexture.generateMipmaps = false;
    lampTexture.needsUpdate = true;
    const uniforms = {
      envLampTex: { value: lampTexture },
      envLampCount: { value: 0 },
      envLampBox: { value: new THREE.Vector4(1e6, 1e6, -1e6, -1e6) },
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
      // (materials can opt out of the local lights: userData.noLocalLight)
      const lit = !material.isMeshBasicMaterial && !(material.userData && material.userData.noLocalLight);
      fs = fs.replace("#include <common>", "#include <common>\n" + FRAGMENT_DECL + (lit ? "\n" + FRAGMENT_LOCAL_LIGHT_DECL : ""));
      // Streetlights and other local lights, on top of the scene's own.
      if (lit && fs.indexOf("#include <aomap_fragment>") !== -1) {
        fs = fs.replace("#include <aomap_fragment>", "#include <aomap_fragment>\nreflectedLight.indirectDiffuse += diffuseColor.rgb * envLocalLight();");
      }
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
        return own.toString() + (this.userData && this.userData.envSurface ? "|envSurface" : "|env") + (this.userData && this.userData.noLocalLight ? "|nolamp" : "");
      };
    }

    // The puddle mask the shader draws (FRAGMENT_SURFACE), sampled on the
    // CPU from the same noise, so splashes land exactly in the puddles you
    // see. puddles: the shader's envWet.y (0..1.5). Flat ground only.
    const noiseData = noise.image.data;
    function puddleAt(x, z, puddles) {
      if (!(puddles > 0.002)) return 0;
      const sample = (u, v, ch) => {
        const N = 256;
        const fu = (u - Math.floor(u)) * N - 0.5, fv = (v - Math.floor(v)) * N - 0.5;
        const i0 = Math.floor(fu), j0 = Math.floor(fv), tx = fu - i0, ty = fv - j0;
        const at = (i, j) => noiseData[((((j % N) + N) % N) * N + (((i % N) + N) % N)) * 4 + ch] / 255;
        return (at(i0, j0) * (1 - tx) + at(i0 + 1, j0) * tx) * (1 - ty) + (at(i0, j0 + 1) * (1 - tx) + at(i0 + 1, j0 + 1) * tx) * ty;
      };
      const u = x * 0.021 + 0.37, v = z * 0.021 + 0.11;
      const m = sample(u, v, 3) * 0.8 + sample(u, v, 2) * 0.2;
      const thr = 0.83 - 0.12 * puddles;
      const s = Math.min(1, Math.max(0, (m - thr) / 0.025));
      const fill = Math.min(1, puddles / 0.35);
      return s * s * (3 - 2 * s) * fill * fill * (3 - 2 * fill);
    }

    // Local lights for the next draw(s): lights = [{ x, y, z, intensity,
    // r, g, b, radius }] (nearest first, at most LOCAL_LIGHT_COUNT used).
    // Re-uploaded only when something actually changed.
    function setLocalLights(lights, count) {
      count = ENVIRONMENT_CONFIG.LOCAL_LIGHTS_ENABLED === false ? 0 : Math.min(count, LOCAL_LIGHT_COUNT);
      uniforms.envLampCount.value = count;
      const box = uniforms.envLampBox.value.set(1e6, 1e6, -1e6, -1e6);
      if (count === 0) return;
      let changed = false;
      const put = (k, v) => { if (lampData[k] !== v) { lampData[k] = v; changed = true; } };
      for (let i = 0; i < count; i++) {
        const l = lights[i], a = i * 4, b = (LOCAL_LIGHT_COUNT + i) * 4;
        put(a, l.x); put(a + 1, l.y); put(a + 2, l.z); put(a + 3, l.radius);
        put(b, l.r * l.intensity); put(b + 1, l.g * l.intensity); put(b + 2, l.b * l.intensity);
        box.x = Math.min(box.x, l.x - l.radius); box.y = Math.min(box.y, l.z - l.radius);
        box.z = Math.max(box.z, l.x + l.radius); box.w = Math.max(box.w, l.z + l.radius);
      }
      if (changed) lampTexture.needsUpdate = true;
    }

    return { uniforms, setSurface, install, puddleAt, setLocalLights, noiseTexture: noise, config: ENVIRONMENT_CONFIG, LOCAL_LIGHT_COUNT };
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
      "  vec3 vel = windVel * 0.22 * sp + vec3(0.0, -0.22 - 0.18 * rnd, 0.0);", // a gentle drift, not the full wind speed
      "  vec3 p = position * box + vel * time;",
      "  p.y += sin(time * (0.7 + 0.5 * rnd) + rnd * 20.0) * 0.4;",   // fluttering lift
      "  p.x += sin(time * 1.1 + rnd * 40.0) * 0.25; p.z += cos(time * 0.9 + rnd * 30.0) * 0.25;",
      "  vec3 center = camPos + vec3(0.0, box.y * 0.5 - 1.2, 0.0);",
      "  vec3 rel = mod(p - center, box) - box * 0.5;",
      "  vec3 wp = center + rel;",
      "  wp.y = max(wp.y, floorY + 0.05);",
      "  float edge = 1.0 - smoothstep(0.6, 1.0, length(rel.xz) / (box.x * 0.5));",
      "  vA = edge * smoothstep(rnd - 0.12, rnd, amount);",
      "  vRot = time * (1.0 + 1.5 * rnd) + rnd * 6.28;",
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

  // ---------------------------------------------------------------- effect particles
  // One shared, pooled particle system for every short-lived effect (bullet
  // impacts, footstep puffs, splashes, blood): a fixed ring buffer of
  // points in ONE draw, whose motion (drag, gravity, the floor) is worked
  // out in the vertex shader from each particle's spawn values -- the CPU
  // only writes a particle once, when it's spawned, and uploads just the
  // slots written that frame. When the ring is full the oldest is reused,
  // so the count can never grow. `additive` makes the glowing variant
  // (sparks, flashes), unlit.
  function createEffectParticles(THREE, scene, max, additive) {
    const start = new Float32Array(max * 3).fill(0);
    const vel = new Float32Array(max * 3);
    const timing = new Float32Array(max * 4);   // birth, life, size (< 0 = puff that grows), gravity scale
    const color = new Float32Array(max * 4);    // rgb, alpha
    const misc = new Float32Array(max * 3);     // floor y, drag, shape (0 soft, 1 chip)
    for (let i = 0; i < max; i++) timing[i * 4] = -1e6;
    const g = new THREE.BufferGeometry();
    const attrs = [
      ["position", start, 3], ["fxVel", vel, 3], ["fxTime", timing, 4], ["fxColor", color, 4], ["fxMisc", misc, 3],
    ].map(([name, array, size]) => {
      const a = new THREE.BufferAttribute(array, size);
      a.setUsage(THREE.DynamicDrawUsage);
      g.setAttribute(name, a);
      return a;
    });
    const uniforms = {
      time: { value: 0 },
      pixelScale: { value: 400 },
      light: { value: new THREE.Color(1, 1, 1) },
    };
    const material = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: [
        "uniform float time; uniform float pixelScale;",
        "attribute vec3 fxVel; attribute vec4 fxTime; attribute vec4 fxColor; attribute vec3 fxMisc;",
        "varying vec4 vCol; varying float vShape;",
        "void main() {",
        "  float t = time - fxTime.x;",
        "  if (t < 0.0 || t > fxTime.y) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; vCol = vec4(0.0); return; }",
        "  float k = fxMisc.y;",
        "  float f = k > 0.001 ? (1.0 - exp(-k * t)) / k : t;",
        "  vec3 p = position + fxVel * f;",
        "  p.y -= 4.9 * fxTime.w * t * t;",
        "  p.y = max(p.y, fxMisc.x);",
        "  float age = t / fxTime.y;",
        "  vec4 mv = viewMatrix * vec4(p, 1.0);",
        "  float s = fxTime.z < 0.0 ? -fxTime.z * (1.0 + 2.2 * age) : fxTime.z;",
        "  gl_PointSize = clamp(pixelScale * s / max(-mv.z, 0.05), 1.0, 96.0);",
        "  vCol = vec4(fxColor.rgb, fxColor.a * (1.0 - smoothstep(0.5, 1.0, age)) * (fxTime.z < 0.0 ? (1.0 - age * 0.5) : 1.0));",
        "  vShape = fxMisc.z;",
        "  gl_Position = projectionMatrix * mv;",
        "}",
      ].join("\n"),
      fragmentShader: [
        "uniform vec3 light; varying vec4 vCol; varying float vShape;",
        "void main() {",
        "  vec2 d = gl_PointCoord - 0.5;",
        "  float a = vShape > 0.5 ? step(max(abs(d.x), abs(d.y * 1.4)), 0.36) : smoothstep(0.5, 0.12, length(d));",
        "  a *= vCol.a;",
        "  if (a < 0.01) discard;",
        additive ? "  gl_FragColor = vec4(vCol.rgb * a, 1.0);" : "  gl_FragColor = vec4(vCol.rgb * light, a);",
        "}",
      ].join("\n"),
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      fog: false,
    });
    const points = new THREE.Points(g, material);
    points.frustumCulled = false;
    points.renderOrder = 8;
    scene.add(points);
    let next = 0, dirtyMin = Infinity, dirtyMax = -1, clock = 0, liveUntil = -1;
    return {
      points,
      // One particle. o: x, y, z, vx, vy, vz, life, size, gravity, r, g, b, a, floor, drag, chip.
      emit(o) {
        const i = next;
        next = (next + 1) % max;
        start[i * 3] = o.x; start[i * 3 + 1] = o.y; start[i * 3 + 2] = o.z;
        vel[i * 3] = o.vx || 0; vel[i * 3 + 1] = o.vy || 0; vel[i * 3 + 2] = o.vz || 0;
        timing[i * 4] = clock; timing[i * 4 + 1] = o.life; timing[i * 4 + 2] = o.size; timing[i * 4 + 3] = o.gravity || 0;
        color[i * 4] = o.r; color[i * 4 + 1] = o.g; color[i * 4 + 2] = o.b; color[i * 4 + 3] = o.a === undefined ? 1 : o.a;
        misc[i * 3] = o.floor === undefined ? -1e4 : o.floor; misc[i * 3 + 1] = o.drag || 0; misc[i * 3 + 2] = o.chip ? 1 : 0;
        if (i < dirtyMin) dirtyMin = i;
        if (i > dirtyMax) dirtyMax = i;
        liveUntil = Math.max(liveUntil, clock + o.life);
      },
      // Once per frame: advance the clock (world time, so it pauses) and
      // upload whatever was written.
      update(dt, light, pixelScale) {
        clock += dt;
        uniforms.time.value = clock;
        uniforms.pixelScale.value = pixelScale;
        if (light) uniforms.light.value.copy(light);
        if (dirtyMax >= 0) {
          for (const a of attrs) {
            a.updateRange.offset = dirtyMin * a.itemSize;
            a.updateRange.count = (dirtyMax - dirtyMin + 1) * a.itemSize;
            a.needsUpdate = true;
          }
          dirtyMin = Infinity; dirtyMax = -1;
        }
        points.visible = clock <= liveUntil;
      },
      clear() {
        for (let i = 0; i < max; i++) timing[i * 4] = -1e6;
        dirtyMin = 0; dirtyMax = max - 1;
        liveUntil = -1;
      },
    };
  }

  // ---------------------------------------------------------------- decals
  // Bullet holes, blood, scuffs, glass cracks, ripples: one instanced quad
  // per decal in ONE draw, from a small canvas atlas (4 x 2 tiles), each
  // with its own tile, tint, size, lifetime and fade -- the fade runs in the
  // shader off a clock uniform, so an aging decal costs no CPU. A fixed
  // ring of MAX_DECALS: the oldest is reused, never more.
  const DECAL_TILE = { hole: 0, blood: 1, scuff: 2, crack: 3, ripple: 4, spatter: 5, mud: 6 };
  function buildDecalAtlas(THREE) {
    const T = 128;
    const canvas = document.createElement("canvas");
    canvas.width = T * 4;
    canvas.height = T * 2;
    const ctx = canvas.getContext("2d");
    let seed = 91;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const tile = (i, draw) => {
      ctx.save();
      ctx.translate((i % 4) * T + T / 2, Math.floor(i / 4) * T + T / 2);
      ctx.beginPath();
      ctx.rect(-T / 2 + 3, -T / 2 + 3, T - 6, T - 6); // keep off the tile edges (mipmaps)
      ctx.clip();
      draw();
      ctx.restore();
    };
    const blob = (x, y, r, alpha, shade) => {
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, "rgba(" + shade + "," + shade + "," + shade + "," + alpha + ")");
      g.addColorStop(0.7, "rgba(" + shade + "," + shade + "," + shade + "," + alpha * 0.8 + ")");
      g.addColorStop(1, "rgba(" + shade + "," + shade + "," + shade + ",0)");
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    };
    // 0 bullet hole: a dark core in a lighter chipped ring
    tile(0, () => {
      for (let k = 0; k < 9; k++) {
        const a = rnd() * Math.PI * 2, d = 10 + rnd() * 14;
        blob(Math.cos(a) * d, Math.sin(a) * d, 9 + rnd() * 10, 0.35, 150);
      }
      blob(0, 0, 30, 0.55, 120);
      blob(0, 0, 15, 1, 20);
      blob(0, 0, 8, 1, 0);
    });
    // 1 blood splat: a body with lobes and droplets (white -- tinted)
    tile(1, () => {
      blob(0, 0, 26, 1, 255);
      for (let k = 0; k < 10; k++) {
        const a = rnd() * Math.PI * 2, d = 12 + rnd() * 22;
        blob(Math.cos(a) * d, Math.sin(a) * d, 7 + rnd() * 12, 0.95, 255);
      }
      for (let k = 0; k < 16; k++) {
        const a = rnd() * Math.PI * 2, d = 34 + rnd() * 24;
        blob(Math.cos(a) * d, Math.sin(a) * d, 2 + rnd() * 4, 0.9, 255);
      }
    });
    // 2 scuff: a soft irregular smudge
    tile(2, () => {
      for (let k = 0; k < 12; k++) blob((rnd() - 0.5) * 36, (rnd() - 0.5) * 36, 12 + rnd() * 18, 0.25, 255);
    });
    // 3 glass crack: a small hole with radial and ring cracks
    tile(3, () => {
      ctx.strokeStyle = "rgba(255,255,255,0.9)";
      ctx.lineWidth = 1.4;
      for (let k = 0; k < 11; k++) {
        let a = (k / 11) * Math.PI * 2 + rnd() * 0.4, x = 0, y = 0;
        ctx.beginPath(); ctx.moveTo(0, 0);
        const len = 30 + rnd() * 30;
        for (let s = 0; s < 5; s++) { a += (rnd() - 0.5) * 0.5; x += Math.cos(a) * len / 5; y += Math.sin(a) * len / 5; ctx.lineTo(x, y); }
        ctx.stroke();
      }
      ctx.lineWidth = 1;
      for (const r of [11, 22]) { ctx.beginPath(); ctx.arc(0, 0, r + rnd() * 3, 0, Math.PI * 2); ctx.stroke(); }
      blob(0, 0, 6, 1, 255);
    });
    // 4 ripple: a thin ring (expands in the shader)
    tile(4, () => {
      ctx.strokeStyle = "rgba(255,255,255,0.85)";
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(0, 0, 52, 0, Math.PI * 2); ctx.stroke();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = "rgba(255,255,255,0.4)";
      ctx.beginPath(); ctx.arc(0, 0, 40, 0, Math.PI * 2); ctx.stroke();
    });
    // 5 spatter: a spray of droplets thrown one way (white -- tinted)
    tile(5, () => {
      blob(-30, 0, 12, 1, 255);
      for (let k = 0; k < 26; k++) {
        const d = rnd() * 80 - 30, spread = (rnd() - 0.5) * (10 + d * 0.5);
        blob(d, spread, Math.max(1.5, 7 - d * 0.07) * (0.5 + rnd() * 0.7), 0.95, 255);
      }
    });
    // 6 mud: a dark clod mark with thrown bits
    tile(6, () => {
      blob(0, 0, 22, 0.8, 255);
      for (let k = 0; k < 14; k++) {
        const a = rnd() * Math.PI * 2, d = 16 + rnd() * 30;
        blob(Math.cos(a) * d, Math.sin(a) * d, 3 + rnd() * 6, 0.7, 255);
      }
    });
    const texture = new THREE.CanvasTexture(canvas);
    texture.generateMipmaps = true;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    return texture;
  }

  function createDecals(THREE, scene, max) {
    const geometry = new THREE.PlaneGeometry(1, 1);
    const data = new Float32Array(max * 4); // tile, birth, life, alpha (< 0 = ripple: grows)
    for (let i = 0; i < max; i++) data[i * 4 + 1] = -1e6;
    const dataAttr = new THREE.InstancedBufferAttribute(data, 4);
    dataAttr.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute("decalData", dataAttr);
    const timeUniform = { value: 0 };
    const material = new THREE.MeshLambertMaterial({
      map: buildDecalAtlas(THREE), transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    });
    material.onBeforeCompile = (shader) => {
      shader.uniforms.decalTime = timeUniform;
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nattribute vec4 decalData;\nuniform float decalTime;\nvarying float vDecalA;")
        .replace("#include <uv_vertex>", [
          "#include <uv_vertex>",
          "vUv = vUv * vec2(0.25, 0.5) + vec2(mod(decalData.x, 4.0) * 0.25, 0.5 - floor(decalData.x / 4.0) * 0.5);",
        ].join("\n"))
        .replace("#include <begin_vertex>", [
          "#include <begin_vertex>",
          "float decalAge = decalTime - decalData.y;",
          "float decalK = decalAge / max(decalData.z, 0.001);",
          "vDecalA = abs(decalData.w) * step(0.0, decalAge) * (1.0 - smoothstep(0.75, 1.0, decalK));",
          "if (decalData.w < 0.0) { transformed.xy *= 0.25 + 0.75 * sqrt(clamp(decalK, 0.0, 1.0)); vDecalA *= 1.0 - decalK; }",
          "if (vDecalA <= 0.0) transformed = vec3(0.0);", // retired: collapse it
        ].join("\n"));
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", "#include <common>\nvarying float vDecalA;")
        .replace("#include <map_fragment>", "#include <map_fragment>\ndiffuseColor.a *= vDecalA;\nif (diffuseColor.a < 0.01) discard;");
    };
    const mesh = new THREE.InstancedMesh(geometry, material, max);
    mesh.frustumCulled = false;
    mesh.renderOrder = 3;
    mesh.count = 0;
    mesh.name = "Decals";
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < max; i++) {
      mesh.setMatrixAt(i, zero);
      mesh.setColorAt(i, new THREE.Color(1, 1, 1));
    }
    scene.add(mesh);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), q2 = new THREE.Quaternion();
    const pos = new THREE.Vector3(), scl = new THREE.Vector3(), z = new THREE.Vector3(0, 0, 1), n = new THREE.Vector3();
    const col = new THREE.Color();
    let next = 0, clock = 0, dirty = false;
    return {
      mesh,
      // tile: DECAL_TILE name; at: {x,y,z}; normal: {x,y,z} (unit); size m;
      // color hex/Color; life s; alpha 0..1; ripple: grows and fades.
      add(tile, at, normal, size, colorValue, life, alpha = 1, ripple = false) {
        const i = next;
        next = (next + 1) % max;
        n.set(normal.x, normal.y, normal.z);
        q.setFromUnitVectors(z, n);
        q2.setFromAxisAngle(n, Math.random() * Math.PI * 2);
        q.premultiply(q2);
        pos.set(at.x + n.x * 0.012, at.y + n.y * 0.012, at.z + n.z * 0.012);
        scl.set(size, size, 1);
        m.compose(pos, q, scl);
        mesh.setMatrixAt(i, m);
        mesh.setColorAt(i, col.set(colorValue));
        data[i * 4] = DECAL_TILE[tile] || 0;
        data[i * 4 + 1] = clock;
        data[i * 4 + 2] = life;
        data[i * 4 + 3] = ripple ? -alpha : alpha;
        mesh.count = Math.max(mesh.count, i + 1);
        dirty = true;
      },
      update(dt) {
        clock += dt;
        timeUniform.value = clock;
        if (dirty) {
          mesh.instanceMatrix.needsUpdate = true;
          if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
          dataAttr.needsUpdate = true;
          dirty = false;
        }
        mesh.visible = mesh.count > 0;
      },
      clear() {
        for (let i = 0; i < max; i++) { data[i * 4 + 1] = -1e6; mesh.setMatrixAt(i, zero); }
        mesh.count = 0;
        next = 0;
        dirty = true;
      },
    };
  }

  // ---------------------------------------------------------------- shell casings
  // Spent brass and shotgun hulls: a small fixed pool, two instanced draws
  // (brass; red hulls with a brass head), dead-simple physics -- gravity,
  // tumbling, a couple of damped bounces on the floor they were thrown
  // over, then lying still until their lifetime is up (shrinking away).
  // types: { pistol, smg, rifle, sniper, shotgun } -> radius / length (m).
  const CASING_TYPES = {
    pistol: { r: 0.0049, len: 0.019, shell: false },
    smg: { r: 0.0049, len: 0.02, shell: false },
    rifle: { r: 0.0056, len: 0.039, shell: false },
    sniper: { r: 0.0066, len: 0.066, shell: false },
    shotgun: { r: 0.0104, len: 0.066, shell: true },
  };
  function createShellCasings(THREE, scene, max) {
    const brassGeometry = new THREE.CylinderGeometry(1, 1, 1, 8);
    const brass = new THREE.InstancedMesh(brassGeometry,
      new THREE.MeshLambertMaterial({ color: 0xc8a14a, emissive: 0x2a1c05 }), max);
    // Shotgun hull: red plastic body, brass head at one end (vertex colors).
    const shellGeometry = new THREE.CylinderGeometry(1, 1, 1, 8, 4);
    {
      const p = shellGeometry.attributes.position, c = [];
      for (let i = 0; i < p.count; i++) {
        const head = p.getY(i) < -0.2;
        c.push(...(head ? [0.86, 0.68, 0.32] : [0.62, 0.1, 0.09]));
      }
      shellGeometry.setAttribute("color", new THREE.Float32BufferAttribute(c, 3));
    }
    const shells = new THREE.InstancedMesh(shellGeometry, new THREE.MeshLambertMaterial({ vertexColors: true }), max);
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (const mesh of [brass, shells]) {
      mesh.frustumCulled = false;
      mesh.castShadow = false;
      mesh.count = 0;
      for (let i = 0; i < max; i++) mesh.setMatrixAt(i, zero);
      scene.add(mesh);
    }
    const pool = [];
    for (let i = 0; i < max; i++) {
      pool.push({ active: false, mesh: brass, pos: new THREE.Vector3(), vel: new THREE.Vector3(), rot: new THREE.Euler(0, 0, 0, "YXZ"),
        spin: new THREE.Vector3(), age: 0, life: 0, floor: 0, type: null, resting: false, bounces: 0 });
    }
    let next = 0;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    function place(c, i) {
      const t = c.type;
      const shrink = Math.min(1, (c.life - c.age) / 0.4);
      q.setFromEuler(c.rot);
      s.set(t.r * shrink, t.len * shrink, t.r * shrink);
      m.compose(c.pos, q, s);
      c.mesh.setMatrixAt(i, m);
    }
    return {
      // at / velocity: Vector3 (world); floor: the y they land on.
      eject(typeName, at, velocity, floor, life) {
        const type = CASING_TYPES[typeName] || CASING_TYPES.pistol;
        const i = next;
        next = (next + 1) % max;
        const c = pool[i];
        if (c.active && c.mesh !== (type.shell ? shells : brass)) c.mesh.setMatrixAt(i, zero);
        c.active = true;
        c.mesh = type.shell ? shells : brass;
        c.type = type;
        c.pos.copy(at);
        c.vel.copy(velocity);
        c.rot.set(Math.random() * 6.28, Math.random() * 6.28, Math.random() * 6.28);
        c.spin.set(18 + Math.random() * 20, (Math.random() - 0.5) * 10, 10 + Math.random() * 16);
        c.age = 0;
        c.life = life;
        c.floor = floor;
        c.resting = false;
        c.bounces = 0;
        brass.count = shells.count = max;
      },
      meshes: [brass, shells],
      update(dt) {
        let any = false;
        for (let i = 0; i < max; i++) {
          const c = pool[i];
          if (!c.active) continue;
          any = true;
          c.age += dt;
          if (c.age >= c.life) {
            c.active = false;
            c.mesh.setMatrixAt(i, zero);
            continue;
          }
          if (!c.resting) {
            c.vel.y -= 9.8 * dt;
            c.pos.addScaledVector(c.vel, dt);
            c.rot.x += c.spin.x * dt; c.rot.y += c.spin.y * dt; c.rot.z += c.spin.z * dt;
            const rest = c.floor + c.type.r;
            if (c.pos.y <= rest) {
              c.pos.y = rest;
              if (c.vel.y < -0.7 && c.bounces < 3) {
                c.vel.y *= -0.3;
                c.vel.x *= 0.5; c.vel.z *= 0.5;
                c.spin.multiplyScalar(0.45);
                c.bounces++;
              } else {
                // settles on its side, a little roll along the ground
                c.resting = true;
                c.rot.set(Math.PI / 2, c.rot.y, 0);
              }
            }
          }
          place(c, i);
        }
        brass.instanceMatrix.needsUpdate = shells.instanceMatrix.needsUpdate = true;
        brass.visible = shells.visible = any;
      },
      clear() {
        for (let i = 0; i < max; i++) { pool[i].active = false; brass.setMatrixAt(i, zero); shells.setMatrixAt(i, zero); }
        brass.instanceMatrix.needsUpdate = shells.instanceMatrix.needsUpdate = true;
        brass.visible = shells.visible = false;
      },
    };
  }

  // ---------------------------------------------------------------- impact / footstep looks
  // What each surface does when a round hits it, or a foot lands on it,
  // out of the shared particle pools and decals above. Counts are small on
  // purpose; `lod` (0..1, from the caller's distance) trims them further.
  function createSurfaceEffects(particles, sparks, decals) {
    const cfg = ENVIRONMENT_CONFIG;
    const R = Math.random;
    const rs = (a) => (R() - 0.5) * 2 * a;
    // Surface looks: dust color (0..1 rgb), chip color, decal.
    const LOOKS = {
      concrete: { dust: [0.72, 0.7, 0.66], chip: [0.62, 0.61, 0.58], hole: 0x3a3a38 },
      asphalt: { dust: [0.5, 0.5, 0.5], chip: [0.2, 0.2, 0.21], hole: 0x1c1c1c },
      brick: { dust: [0.66, 0.46, 0.38], chip: [0.55, 0.28, 0.2], hole: 0x3a2622 },
      plaster: { dust: [0.82, 0.8, 0.76], chip: [0.78, 0.76, 0.72], hole: 0x4a4744 },
      wood: { dust: [0.6, 0.5, 0.36], chip: [0.66, 0.5, 0.3], hole: 0x2e2216 },
      metal: { dust: [0.5, 0.5, 0.52], chip: [0.55, 0.56, 0.58], hole: 0x2a2b2d },
      glass: { dust: [0.85, 0.9, 0.95], chip: [0.78, 0.88, 0.95], hole: 0xf2f6ff },
      dirt: { dust: [0.52, 0.42, 0.3], chip: [0.4, 0.3, 0.2], hole: 0x3d2c1c },
      gravel: { dust: [0.6, 0.57, 0.52], chip: [0.5, 0.48, 0.45], hole: 0x3a3632 },
      grass: { dust: [0.5, 0.45, 0.33], chip: [0.32, 0.46, 0.2], hole: 0x2e2a1e },
      snow: { dust: [0.95, 0.96, 0.98], chip: [0.95, 0.96, 0.98], hole: 0xcfd4dc },
    };
    const look = (m) => LOOKS[m] || LOOKS.concrete;
    // rgb 0..1 -> hex, brightened (the hole texture's chipped rim is gray,
    // its core black, so a light tint gives a fresh, lighter broken edge)
    const hex = (c, k = 1) => c.reduce((a, v, i) => a | (Math.min(255, Math.round(v * k * 255)) << (16 - 8 * i)), 0);
    // Soft growing puff.
    function puff(p, n, c, count, size, alpha, speed, life) {
      for (let i = 0; i < count; i++) {
        const sp = speed * (0.4 + R() * 0.6);
        particles.emit({
          x: p.x + rs(0.03), y: p.y + rs(0.03), z: p.z + rs(0.03),
          vx: n.x * sp + rs(speed * 0.5), vy: n.y * sp + rs(speed * 0.4) + 0.15, vz: n.z * sp + rs(speed * 0.5),
          life: life * (0.7 + R() * 0.5), size: -size * (0.7 + R() * 0.6), gravity: -0.02, drag: 3.2,
          r: c[0], g: c[1], b: c[2], a: alpha,
        });
      }
    }
    // Hard little bits thrown out, falling to the floor.
    function chips(p, n, c, count, size, speed, life, floor, gravity = 1, alpha = 1) {
      for (let i = 0; i < count; i++) {
        const sp = speed * (0.45 + R() * 0.55);
        const shade = 0.8 + R() * 0.35;
        particles.emit({
          x: p.x, y: p.y, z: p.z,
          vx: n.x * sp + rs(speed * 0.55), vy: n.y * sp + rs(speed * 0.45) + speed * 0.25, vz: n.z * sp + rs(speed * 0.55),
          life: life * (0.6 + R() * 0.6), size: size * (0.6 + R() * 0.8), gravity, drag: 1.2,
          r: c[0] * shade, g: c[1] * shade, b: c[2] * shade, a: alpha, floor, chip: true,
        });
      }
    }
    function sparkBurst(p, dir, n, count, power) {
      // around the ricochet direction
      const d = dir.x * n.x + dir.y * n.y + dir.z * n.z;
      const rx = dir.x - 2 * d * n.x, ry = dir.y - 2 * d * n.y, rz = dir.z - 2 * d * n.z;
      for (let i = 0; i < count; i++) {
        const sp = (2.5 + R() * 4) * power;
        const bx = rx * 0.6 + n.x * 0.4, by = ry * 0.6 + n.y * 0.4, bz = rz * 0.6 + n.z * 0.4;
        sparks.emit({
          x: p.x, y: p.y, z: p.z,
          vx: bx * sp + rs(sp * 0.6), vy: by * sp + rs(sp * 0.5) + 0.5, vz: bz * sp + rs(sp * 0.6),
          life: 0.14 + R() * 0.2, size: 0.018 + R() * 0.014, gravity: 0.7, drag: 2.2,
          r: 1.0, g: 0.72 + R() * 0.2, b: 0.32, a: 1, floor: p.y - 3,
        });
      }
      sparks.emit({ x: p.x + n.x * 0.03, y: p.y + n.y * 0.03, z: p.z + n.z * 0.03, life: 0.05, size: 0.16 * power, r: 1, g: 0.85, b: 0.55, a: 0.9 });
    }

    return {
      LOOKS,
      // A round hitting a surface. p: point, n: surface normal, dir: shot
      // direction (all {x,y,z}); power ~0.6 (pellet) .. 2 (sniper);
      // lod 0..1 (1 = close); floor: the ground under the point; wet 0..1.
      impact(material, p, n, dir, power, lod, floor, wet = 0) {
        const L = look(material);
        const k = Math.max(0.25, lod) * Math.min(1.6, power);
        const showParticles = lod > 0;
        const holeSize = 0.085 + 0.045 * Math.min(2, power);
        switch (material) {
          case "metal":
            if (showParticles) {
              sparkBurst(p, dir, n, Math.round(5 + 4 * k), Math.min(1.4, 0.7 + power * 0.3));
              if (R() < 0.5) puff(p, n, [0.45, 0.45, 0.46], 1, 0.08, 0.35, 0.4, 0.7);
            }
            decals.add("hole", p, n, holeSize * 0.7, 0xc4c8cc, cfg.DECAL_LIFETIME, 0.9); // bright bare metal round the dent
            break;
          case "glass":
            if (showParticles) chips(p, { x: dir.x * 0.6 + n.x * 0.4, y: dir.y * 0.6 + n.y * 0.4, z: dir.z * 0.6 + n.z * 0.4 }, L.chip, Math.round(4 + 4 * k), 0.018, 2.2, 0.7, floor, 1, 0.75);
            decals.add("crack", p, n, 0.28 + 0.12 * Math.min(2, power), 0xeef4ff, cfg.DECAL_LIFETIME * 1.5, 0.7);
            break;
          case "wood":
            if (showParticles) {
              chips(p, n, L.chip, Math.round(4 + 3 * k), 0.028, 2.4, 0.6, floor);
              puff(p, n, L.dust, 1 + Math.round(k), 0.07, 0.35, 0.6, 0.6);
            }
            decals.add("hole", p, n, holeSize * 0.85, hex(L.chip, 1.35), cfg.DECAL_LIFETIME, 0.95);
            break;
          case "dirt":
          case "gravel":
            if (showParticles) {
              chips(p, n, L.chip, Math.round(5 + 4 * k), material === "gravel" ? 0.026 : 0.022, 2.8, 0.7, floor);
              puff(p, n, L.dust, 1 + Math.round(1.5 * k), 0.11, 0.45 * (1 - 0.6 * wet), 0.9, 0.8);
            }
            decals.add(material === "dirt" ? "mud" : "scuff", p, n, 0.16 + 0.05 * power, L.hole, cfg.DECAL_LIFETIME, 0.5);
            break;
          case "grass":
            if (showParticles) {
              chips(p, n, L.chip, Math.round(3 + 2 * k), 0.02, 1.8, 0.55, floor, 0.8);
              puff(p, n, L.dust, 1, 0.08, 0.22 * (1 - 0.7 * wet), 0.6, 0.6);
            }
            break;
          case "water":
            if (showParticles) {
              chips(p, { x: 0, y: 1, z: 0 }, [0.78, 0.82, 0.86], Math.round(6 + 4 * k), 0.016, 2.6, 0.5, floor, 1.1, 0.6);
              puff(p, { x: 0, y: 1, z: 0 }, [0.85, 0.88, 0.9], 1, 0.08, 0.25, 0.5, 0.4);
            }
            decals.add("ripple", p, { x: 0, y: 1, z: 0 }, 0.5 + 0.2 * power, 0xdfe8ee, 0.9, 0.55, true);
            break;
          default: // concrete, asphalt, brick, plaster
            if (showParticles) {
              puff(p, n, L.dust, 1 + Math.round(1.5 * k), 0.1, 0.5 * (1 - 0.6 * wet), 0.8, 0.7);
              chips(p, n, L.chip, Math.round(3 + 3 * k), 0.02, 2.6, 0.5, floor);
            }
            decals.add("hole", p, n, holeSize, hex(L.dust, 1.3), cfg.DECAL_LIFETIME, 0.95);
            if (material !== "asphalt" && R() < 0.35) decals.add("scuff", p, n, holeSize * 3.2, hex(L.dust), cfg.DECAL_LIFETIME, 0.35);
        }
      },
      // A round (or a blade) going into a zombie: blood out of the entry
      // and a mist -- the sizes grow with the weapon's power.
      flesh(p, dir, power, lod) {
        if (lod <= 0) return;
        const k = Math.max(0.3, lod) * Math.min(1.8, power);
        const back = { x: -dir.x, y: -dir.y + 0.2, z: -dir.z };
        const through = { x: dir.x, y: dir.y + 0.15, z: dir.z };
        chips(p, back, [0.45, 0.04, 0.04], Math.round(3 + 3 * k), 0.022, 1.6, 0.5, p.y - 2, 1);
        chips(p, through, [0.38, 0.03, 0.03], Math.round(2 + 4 * k), 0.026, 2.4 * Math.min(1.5, power), 0.55, p.y - 2, 1);
        puff(p, through, [0.42, 0.05, 0.05], 1 + Math.round(k), 0.07 + 0.03 * power, 0.45, 0.8, 0.45);
      },
      // A foot landing. surface: grass / dirt / gravel / concrete /
      // asphalt / snow / floor (indoors); strength ~0.4 (crouch) .. 1.3
      // (sprint); wet 0..1; puddle 0..1 (standing in one).
      footstep(surface, p, strength, wet, puddle, floor) {
        const up = { x: 0, y: 1, z: 0 };
        if (surface === "floor") return;
        if (puddle > 0.3) {
          chips(p, up, [0.8, 0.84, 0.88], Math.round(3 + 4 * strength), 0.014, 1.3 * strength + 0.4, 0.4, floor, 1.1, 0.55);
          decals.add("ripple", p, up, 0.55 + 0.25 * strength, 0xdfe8ee, 1.0, 0.45, true);
          return;
        }
        const paved = surface === "concrete" || surface === "asphalt";
        if (paved && wet > 0.35) {
          chips(p, up, [0.8, 0.84, 0.88], Math.round(1 + 2.5 * strength * wet), 0.012, 0.7 * strength + 0.3, 0.3, floor, 1.1, 0.45);
          return;
        }
        const L = look(surface);
        const dry = 1 - Math.min(1, wet * 1.5);
        if (surface === "grass") {
          if (dry > 0.2 && R() < 0.7) puff(p, up, L.dust, 1 + Math.round(strength), 0.05, 0.14 * dry, 0.35, 0.7);
        } else if (surface === "dirt") {
          puff(p, up, L.dust, 1 + Math.round(1.5 * strength), 0.07, 0.3 * (0.3 + 0.7 * dry), 0.45, 0.8);
          chips(p, up, L.chip, Math.round(1 + 2 * strength), 0.012, 0.9 * strength, 0.4, floor);
        } else if (surface === "gravel") {
          chips(p, up, L.chip, Math.round(2 + 2 * strength), 0.013, 1.0 * strength, 0.35, floor);
          if (dry > 0.3) puff(p, up, L.dust, 1, 0.06, 0.16 * dry, 0.35, 0.6);
        } else if (surface === "snow") {
          puff(p, up, L.dust, 2 + Math.round(strength), 0.07, 0.5, 0.5, 0.7);
        } else if (paved && dry > 0.5 && R() < 0.35 * strength) {
          puff(p, up, L.dust, 1, 0.045, 0.08 * dry, 0.3, 0.55);
        }
      },
    };
  }

  window.ENVIRONMENT_CONFIG = ENVIRONMENT_CONFIG;
  window.createEnvironmentFX = createEnvironmentFX;
  window.createEffectParticles = createEffectParticles;
  window.createDecals = createDecals;
  window.createShellCasings = createShellCasings;
  window.createSurfaceEffects = createSurfaceEffects;
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
