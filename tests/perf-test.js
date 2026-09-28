// Frame-cost benchmark for the Campus map. Loaded only when the game is
// opened as index.html#perftest (see the test hooks at the end of
// index.html's script) -- it never runs in normal play.
//
// Stops the game's own loop, then drives frames itself, timing every
// per-frame system separately (plus the render with a gl.finish(), so GPU
// time counts too) at several enemy counts, and collects the renderer's
// draw-call/triangle counts and a census of the scene. Results land in
// window.__perfResults (JSON) once done.
(function () {
  "use strict";
  const H = window.__gameTestHooks;
  const DT = 1 / 60;
  const gl = H.renderer.getContext();
  const pixel = new Uint8Array(4);
  // gl.finish() doesn't block in Chrome; a 1-pixel read does, so the
  // render time includes the GPU actually finishing the frame.
  const syncGpu = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);

  function stats(list) {
    const sorted = list.slice().sort((a, b) => a - b);
    const avg = sorted.reduce((a, b) => a + b, 0) / Math.max(1, sorted.length);
    return { avg: +avg.toFixed(3), p95: +(sorted[Math.floor(sorted.length * 0.95)] || 0).toFixed(3), max: +(sorted[sorted.length - 1] || 0).toFixed(3) };
  }

  function census() {
    const out = { objects: 0, meshes: 0, visibleMeshes: 0, castShadow: 0, instanced: 0, skinned: 0, points: 0, lines: 0, lights: {}, materials: new Set(), geometries: new Set() };
    H.scene.traverse((o) => {
      out.objects++;
      if (o.isLight) out.lights[o.type] = (out.lights[o.type] || 0) + 1;
      if (o.isPoints) out.points++;
      if (o.isLine) out.lines++;
      if (!o.isMesh) return;
      out.meshes++;
      let v = true;
      for (let p = o; p; p = p.parent) if (!p.visible) { v = false; break; }
      if (v) {
        out.visibleMeshes++;
        if (o.castShadow) out.castShadow++;
      }
      if (o.isInstancedMesh) out.instanced++;
      if (o.isSkinnedMesh) out.skinned++;
      (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => out.materials.add(m.uuid));
      out.geometries.add(o.geometry.uuid);
    });
    out.materials = out.materials.size;
    out.geometries = out.geometries.size;
    return out;
  }

  const SYSTEMS = [
    ["movement", () => H.updateMovement(H.players[0], DT)],
    ["enemies", () => H.updateEnemiesOnly(DT)],
    ["waveManager", () => H.updateWaveManager(DT)],
    ["campusFrame", () => H.updateCampusFrame(DT)],
    ["particles", () => H.updateParticleBursts(DT)],
    ["bloodDecals", () => H.updateBloodDecals(DT)],
    ["dayNight", () => H.updateDayNightCycle(DT)],
    ["playerBodies", () => H.updatePlayerBodyMeshes(DT)],
    ["interactPrompts", () => H.updateInteractPrompts()],
    ["scope", () => H.updateScopeOverlays(DT)],
  ];

  function runFrames(label, frames, perFrame) {
    const times = {};
    for (const [name] of SYSTEMS) times[name] = [];
    times.renderCpu = [];
    times.renderGpu = [];
    times.total = [];
    let calls = 0, tris = 0;
    const player = H.players[0];
    for (let f = 0; f < frames; f++) {
      player.health = 1e6; // keep the camera alive through the swarm
      if (perFrame) perFrame(f);
      const frameStart = performance.now();
      for (const [name, fn] of SYSTEMS) {
        const t0 = performance.now();
        fn();
        times[name].push(performance.now() - t0);
      }
      const r0 = performance.now();
      H.renderFrame();
      const r1 = performance.now();
      syncGpu();
      const r2 = performance.now();
      times.renderCpu.push(r1 - r0);
      times.renderGpu.push(r2 - r1);
      times.total.push(r2 - frameStart);
      calls += H.renderer.info.render.calls;
      tris += H.renderer.info.render.triangles;
    }
    const result = { label, drawCalls: Math.round(calls / frames), triangles: Math.round(tris / frames) };
    for (const k in times) result[k] = stats(times[k]);
    return result;
  }

  function spawnRing(count, minR, maxR) {
    const p = H.players[0].camera.position;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      const r = minR + Math.random() * (maxR - minR);
      H.spawnEnemyAt({ x: p.x + Math.cos(a) * r, y: 0, z: p.z + Math.sin(a) * r }, i % 7 === 0 ? "green" : "normal");
    }
  }

  // The game's real loop, uncapped: pointer lock faked so the world runs,
  // recording every frame's interval (hitches included) for `seconds`.
  // window.__perfPhase lets the driver wrap it in a CPU profile.
  function runLive(seconds) {
    return new Promise((resolve) => {
      Object.defineProperty(document, "pointerLockElement", { configurable: true, get: () => H.renderer.domElement });
      H.haltLoop = false;
      window.__perfPhase = "live";
      const deltas = [];
      const slowFrames = [];
      // Time each render and note any programs/textures created in it.
      const realRender = H.renderer.render.bind(H.renderer);
      let renderMs = 0, programsMade = 0, texturesMade = 0;
      H.renderer.render = (s, c) => {
        const p0 = H.renderer.info.programs.length, t0 = H.renderer.info.memory.textures, r0 = performance.now();
        realRender(s, c);
        renderMs += performance.now() - r0;
        programsMade += H.renderer.info.programs.length - p0;
        texturesMade += H.renderer.info.memory.textures - t0;
      };
      // What gets uploaded/compiled in the first live frames (should be
      // nothing -- the pre-warm's job).
      const firstFrameUploads = [];
      const realTexImage2D = gl.texImage2D.bind(gl);
      const realLinkProgram = gl.linkProgram.bind(gl);
      gl.texImage2D = function (...args) {
        const src = args.find((a) => a && typeof a === "object" && ("width" in a));
        if (deltas.length < 3) firstFrameUploads.push(src ? (src.constructor.name + " " + src.width + "x" + src.height + " " + (src.src ? src.src.slice(0, 40) : "")) : "data " + args[3] + "x" + args[4]);
        return realTexImage2D(...args);
      };
      gl.linkProgram = function (program) {
        if (deltas.length < 3) firstFrameUploads.push("linkProgram " + new Error().stack.split("\n").slice(2, 9).map((l) => l.trim().replace(/^at /, "").replace(/\(.*[\\/]/, "(")).join(" < "));
        return realLinkProgram(program);
      };
      let last = performance.now();
      const start = last;
      function tick() {
        const now = performance.now();
        deltas.push(now - last);
        if (now - last > 25) slowFrames.push({ frame: deltas.length, ms: +(now - last).toFixed(1), renderMs: +renderMs.toFixed(1), programsMade, texturesMade });
        renderMs = 0; programsMade = 0; texturesMade = 0;
        last = now;
        H.players[0].health = 1e6;
        H.players[0].yaw += 0.01; // look around so everything gets drawn
        if (now - start < seconds * 1000) requestAnimationFrame(tick);
        else {
          window.__perfPhase = "liveDone";
          H.renderer.render = realRender;
          gl.texImage2D = realTexImage2D;
          gl.linkProgram = realLinkProgram;
          H.haltLoop = true;
          const s = stats(deltas);
          resolve({ label: "live loop (" + seconds + "s)", frames: deltas.length, frameMs: s,
            over16: deltas.filter((d) => d > 16.7).length, over33: deltas.filter((d) => d > 33).length,
            worst: deltas.slice().sort((a, b) => b - a).slice(0, 8).map((d) => +d.toFixed(1)), slowFrames: slowFrames.slice(0, 12), firstFrameUploads: firstFrameUploads.slice(0, 30) });
        }
      }
      requestAnimationFrame(tick);
    });
  }

  // Shoots a ray from the camera at each nearby zombie's head and chest:
  // the first hit must be that zombie's own Head / Torso box (checks the
  // hit boxes' on-demand world matrices -- see raycastEnemies).
  function hitProbe() {
    const THREE = window.THREE;
    const raycaster = new THREE.Raycaster();
    const origin = H.players[0].camera.position.clone();
    const out = { tried: 0, headOk: 0, torsoOk: 0, blocked: 0 };
    for (const e of H.enemies) {
      if (!e.zombie || e.dormant) continue;
      // A zombie standing on the (invincible) camera has it inside its boxes.
      if (Math.hypot(e.mesh.position.x - origin.x, e.mesh.position.z - origin.z) < 1.5) continue;
      const head = e.zombie.hitboxes.find((b) => b.name === "Head");
      const torso = e.zombie.hitboxes.find((b) => b.name === "Torso");
      head.parent.updateWorldMatrix(true, false);
      torso.parent.updateWorldMatrix(true, false);
      const headPos = new THREE.Vector3().setFromMatrixPosition(head.parent.matrixWorld.clone().multiply(head.matrix));
      const torsoPos = new THREE.Vector3().setFromMatrixPosition(torso.parent.matrixWorld.clone().multiply(torso.matrix));
      out.tried++;
      for (const [target, name, key] of [[headPos, "Head", "headOk"], [torsoPos, "Torso", "torsoOk"]]) {
        raycaster.set(origin, target.clone().sub(origin).normalize());
        const hits = H.raycastEnemies(raycaster);
        if (hits.length && hits[0].object.userData.enemyRef === e && hits[0].object.name === name) out[key]++;
        else if (hits.length && hits[0].object.userData.enemyRef !== e) {
          out.blocked++; // another zombie in front
          const other = hits[0].object.userData.enemyRef;
          const d = (p) => Math.hypot(p.x - origin.x, p.z - origin.z);
          if (other && d(other.mesh.position) > d(e.mesh.position) + 0.5) out.blockedByFartherZombie = (out.blockedByFartherZombie || 0) + 1;
          if (!other) out.hitWithoutRef = (out.hitWithoutRef || 0) + 1;
        } else if (hits.length) {
          out.sameZombieOtherBox = (out.sameZombieOtherBox || 0) + 1; // e.g. an arm in front of the chest
        } else {
          out.missed = (out.missed || 0) + 1; // should never happen
        }
      }
    }
    const dists = H.enemies.filter((e) => !e.dormant).map((e) => Math.hypot(e.mesh.position.x - origin.x, e.mesh.position.z - origin.z)).sort((a, b) => a - b);
    out.enemyDistances = dists.slice(0, 5).map((d) => +d.toFixed(1)).concat(["...", +dists[dists.length - 1].toFixed(1)]);
    return out;
  }

  async function run() {
    const results = { ok: true, info: {}, runs: [] };
    try {
      H.haltLoop = true;
      H.setMap("campus");
      H.startRun();
      H.prewarmRendererForRun(); // what animate() does before a run's first frame
      const dbg = gl.getExtension("WEBGL_debug_renderer_info");
      results.info.gpu = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : "unknown";
      results.info.canvas = [H.renderer.domElement.width, H.renderer.domElement.height];
      results.info.pixelRatio = H.renderer.getPixelRatio();
      results.info.shadowMap = H.renderer.shadowMap.enabled;

      runFrames("warmup", 60);
      results.census0 = census();
      results.runs.push(runFrames("campus, no enemies", 180));
      spawnRing(20, 8, 30);
      runFrames("warmup", 1);
      results.hitProbe = hitProbe(); // before they close in on the (invincible) camera
      runFrames("warmup", 29);
      results.runs.push(runFrames("campus, 20 enemies", 180));
      spawnRing(40, 8, 40);
      runFrames("warmup", 30);
      results.runs.push(runFrames("campus, ~60 enemies", 180));
      results.runs.push(runFrames("campus, ~60 enemies + gunfire bursts", 180, (f) => {
        const p = H.players[0].camera.position;
        H.spawnParticleBurst({ x: p.x + 2, y: 1.5, z: p.z + 2 }, { count: 12, color: 0x880000, size: 0.12, lifetime: 0.5, speedMin: 1, speedMax: 3, upwardBias: 1, gravityScale: 1 });
        if (f % 20 === 0) H.spawnBloodPoolDecal({ x: p.x + Math.random() * 6, y: 0, z: p.z + Math.random() * 6 });
      }));
      H.forceHeavyRainAtNight();
      runFrames("warmup", 60);
      results.runs.push(runFrames("campus, ~60 enemies, heavy rain, night", 180));
      results.census1 = census();
      window.__perfPhase = "preLive";
      await new Promise((r) => setTimeout(r, 1500)); // driver starts the profiler
      results.live = await runLive(10);
      results.info.programs = H.renderer.info.programs ? H.renderer.info.programs.length : null;
      results.info.textures = H.renderer.info.memory.textures;
      results.info.geometries = H.renderer.info.memory.geometries;
      results.enemies = H.enemies.length;
    } catch (e) {
      results.ok = false;
      results.error = String(e && e.stack || e);
    }
    window.__perfResults = JSON.stringify(results);
  }

  setTimeout(run, 1500); // let textures/fonts settle first
})();
