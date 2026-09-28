// Automated check for the Campus map's procedural spawning. Loaded only
// when the game is opened as index.html#spawntest (see the test hooks at
// the end of index.html's script) -- it never runs in normal play.
//
// Runs the real enemy/wave/spawn code with a simulated clock (no
// rendering needed): walks the player around the whole campus at normal
// walking speed and records where and when enemies appear, how many there
// are, and what each simulated frame costs. Then runs the Classic (tiny)
// map briefly to confirm it still works the old way. Results are written
// as JSON into <pre id="spawn-test-results">.
(function () {
  "use strict";
  const H = window.__gameTestHooks;
  const results = { ok: true, errors: [] };
  const DT = 1 / 30;
  const WALK_SPEED = 4.85;

  function percentile(sorted, q) {
    return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] : 0;
  }

  function runCampus() {
    H.setMap("campus");
    H.startRun();
    const world = H.campusWorld;
    const spawner = H.campusSpawner;
    const player = H.players[0];
    if (!H.isCampusMap || !world || !world.root.visible) throw new Error("campus map did not activate");

    // Around the whole campus on its streets: along the mall to 17th St,
    // up to 6th Ave, west to 11th St (through the construction pit), back
    // down to the mall.
    const routePx = [[620, 405], [1290, 405], [1297, 175], [232, 175], [232, 405], [620, 405]];
    // Phases along the walk: a quiet start, then the walker "fights" (kills
    // anything that reaches 6 m, so waves progress), then a stress burst of
    // 100 extra enemies requested at once to check the active-enemy cap.
    const FIGHT_FROM = 60, STAND_UNTIL = 150, STRESS_AT = 330;
    let stressRequested = false;
    let kills = 0;
    const route = routePx.map(([x, y]) => world.mapToWorld(x, y));
    let leg = 0;
    let legT = 0;

    const seen = new WeakSet();
    const wasDormant = new WeakMap();
    const spawnEvents = [];
    const stepMs = [];
    const minuteStats = [];
    let maxActive = 0, maxTotal = 0, maxDormant = 0;
    let simTime = 0;
    let walked = 0;

    while (leg < route.length - 1) {
      // Walk the route at walking speed, facing the way we're going.
      const a = route[leg], b = route[leg + 1];
      const legLength = Math.hypot(b.x - a.x, b.z - a.z);
      // Stand and fight for a while (enemies walk slower than the player,
      // so a walker never gets caught), then carry on walking.
      const standing = simTime >= FIGHT_FROM && simTime < STAND_UNTIL;
      if (!standing) legT += (WALK_SPEED * DT) / legLength;
      if (legT >= 1) { legT = 0; leg++; continue; }
      player.camera.position.x = a.x + (b.x - a.x) * legT;
      player.camera.position.z = a.z + (b.z - a.z) * legT;
      player.yaw = Math.atan2(-(b.x - a.x), -(b.z - a.z));
      player.health = 1e9; // a test walker, not a fight
      if (!standing) walked += WALK_SPEED * DT;

      if (simTime >= FIGHT_FROM) {
        for (let i = H.enemies.length - 1; i >= 0; i--) {
          const e = H.enemies[i];
          if (e.dormant || e.boss) continue;
          if (Math.hypot(e.mesh.position.x - player.camera.position.x, e.mesh.position.z - player.camera.position.z) < 6) {
            H.damageEnemy(e, 1e6, e.mesh.position);
            kills++;
          }
        }
      }
      if (!stressRequested && simTime >= STRESS_AT) {
        stressRequested = true;
        for (let i = 0; i < 100; i++) H.spawnEnemyFromRandomSpawner("normal");
      }

      const t0 = performance.now();
      H.step(DT);
      stepMs.push(performance.now() - t0);
      simTime += DT;

      // New or just-woken enemies this step = spawns: where did they land?
      let active = 0, dormant = 0;
      for (const e of H.enemies) {
        if (e.dormant) { dormant++; wasDormant.set(e, true); continue; }
        active++;
        const isNew = !seen.has(e);
        const woke = wasDormant.get(e) === true;
        if (isNew || woke) {
          seen.add(e);
          wasDormant.set(e, false);
          if (e.boss) continue; // the boss has its own spawn rules
          const px = player.camera.position.x, pz = player.camera.position.z;
          const ex = e.mesh.position.x, ez = e.mesh.position.z;
          const distance = Math.hypot(ex - px, ez - pz);
          const fx = -Math.sin(player.yaw), fz = -Math.cos(player.yaw);
          const inView = ((ex - px) * fx + (ez - pz) * fz) / (distance || 1) >= Math.cos(Math.PI / 3);
          const visible = inView && !world.segmentBlocked(px, pz, ex, ez, 0);
          spawnEvents.push({ t: +simTime.toFixed(1), distance: +distance.toFixed(1), visible, relocated: woke });
        }
      }
      maxActive = Math.max(maxActive, active);
      maxDormant = Math.max(maxDormant, dormant);
      maxTotal = Math.max(maxTotal, H.enemies.length);
      if (Math.floor(simTime / 60) !== Math.floor((simTime - DT) / 60)) {
        minuteStats.push({ minute: Math.round(simTime / 60), active, dormant, queued: spawner.pendingCount(), navChunks: world.navChunkCount(), wave: H.waveNumber });
      }
    }

    const sorted = stepMs.slice().sort((x, y) => x - y);
    const firstHalf = stepMs.slice(0, stepMs.length >> 1);
    const secondHalf = stepMs.slice(stepMs.length >> 1);
    const avg = (arr) => arr.reduce((s, v) => s + v, 0) / (arr.length || 1);
    const regularSpawns = spawnEvents.filter((s) => !s.relocated);
    const relocations = spawnEvents.filter((s) => s.relocated);
    return {
      simulatedSeconds: +simTime.toFixed(0),
      kills,
      stressRequest: 100,
      metersWalked: +walked.toFixed(0),
      wavesReached: H.waveNumber,
      spawns: regularSpawns.length,
      relocations: relocations.length,
      closestSpawnMeters: Math.min(...spawnEvents.map((s) => s.distance)),
      farthestSpawnMeters: Math.max(...spawnEvents.map((s) => s.distance)),
      spawnsVisibleWhenTheyAppeared: spawnEvents.filter((s) => s.visible).length,
      spawnsCloserThanMin: spawnEvents.filter((s) => s.distance < spawner.config.minSpawnDistance - 1).length,
      maxActiveEnemies: maxActive,
      maxActiveAllowed: spawner.config.maxActiveEnemies,
      maxDormantEnemies: maxDormant,
      maxEnemiesTotal: maxTotal,
      stepMs: { avg: +avg(stepMs).toFixed(3), p50: +percentile(sorted, 0.5).toFixed(3), p99: +percentile(sorted, 0.99).toFixed(3), max: +sorted[sorted.length - 1].toFixed(2) },
      stepMsFirstHalfAvg: +avg(firstHalf).toFixed(3),
      stepMsSecondHalfAvg: +avg(secondHalf).toFixed(3),
      navChunksCached: world.navChunkCount(),
      recycler: Object.assign({}, H.campusRecycler.stats),
      spawnerStats: spawner.stats,
      perMinute: minuteStats,
    };
  }

  function runClassic() {
    H.setMap("classic");
    H.startRun();
    const player = H.players[0];
    if (H.isCampusMap) throw new Error("classic map did not activate");
    const campusHidden = !H.campusWorld || !H.campusWorld.root.visible;
    let maxEnemies = 0;
    let simTime = 0;
    for (let i = 0; i < 60 / DT; i++) {
      player.health = 1e9;
      H.step(DT);
      simTime += DT;
      maxEnemies = Math.max(maxEnemies, H.enemies.length);
    }
    // Pathfinding/line of sight still go through the tiny map's own grid:
    // a path from the player's spot to a spawner outside the building.
    // Paths from the player to every living enemy (some may be unreachable
    // for a moment, e.g. mid-knockback against a wall).
    const paths = H.enemies.map((e) => H.findGridPath(player.camera.position.x, player.camera.position.z, e.mesh.position.x, e.mesh.position.z));
    const path = paths.find((q) => Array.isArray(q));
    const pathsFound = paths.filter((q) => Array.isArray(q)).length + "/" + paths.length;
    return {
      campusHidden,
      simulatedSeconds: Math.round(simTime),
      wavesReached: H.waveNumber,
      maxEnemies,
      enemiesUsedFixedSpawners: maxEnemies > 0,
      tinyMapPathFound: Array.isArray(path),
      tinyMapPathsFound: pathsFound,
    };
  }

  // Fences and stuck enemies, on the campus.
  function runFencesAndStuck() {
    H.setMap("campus");
    H.startRun();
    const w = H.campusWorld;
    const player = H.players[0];
    const P = (x, y) => w.mapToWorld(x, y);
    const place = (px, py, yaw) => {
      const at = P(px, py);
      player.camera.position.set(at.x, H.EYE_HEIGHT, at.z);
      player.yaw = yaw;
    };
    const run = (seconds) => { for (let t = 0; t < seconds; t += DT) H.step(DT); };
    const out = {};

    // 1) Player on the 9th Ave sidewalk, just outside the softball fence;
    // a fast (green) and a regular enemy right against the inside of it.
    place(1500, 672, 0); // facing north, at the fence
    player.health = 100;
    const green = H.spawnEnemyAt(P(1500, 661), "green");
    const red = H.spawnEnemyAt(P(1506, 661), "normal");
    run(5);
    out.fence = {
      playerHealthAfter5s: player.health,
      greenExplodedThroughFence: green.isRemoved,
      enemiesStayedInside: [green, red].filter((e) => !e.isRemoved && w.enclosureMask(e.mesh.position.x, e.mesh.position.z) !== 0).length,
    };
    for (const e of [green, red]) if (!e.isRemoved) H.damageEnemy(e, 1e6, e.mesh.position);

    // 2) An enemy trapped inside the soccer field's fence (no gates) with the
    // player outside on 6th Ave -- it can never arrive, so it's stuck.
    place(1550, 181, 0); // facing north: it's in plain view (chain-link)
    player.health = 1e9;
    const trapped = H.spawnEnemyAt(P(1550, 110), "normal");
    const before = Object.assign({}, H.campusRecycler.stats);
    run(26);
    out.stuckInView = {
      recycledWhileInView: !!trapped.dormant,
      recoveryAttempts: H.campusRecycler.stats.recoveries - before.recoveries,
    };
    player.yaw = Math.PI; // turn around
    let trappedRecycled = false;
    for (let t = 0; t < 26; t += DT) {
      H.step(DT);
      if (trapped.dormant) trappedRecycled = true;
    }
    out.stuckOutOfView = {
      recycled: trappedRecycled,
      // after recycling it's handed to the spawn manager -- wherever it comes
      // back, it's on the player's side of the fence (or near a gate)
      backOnPlayersSide: trapped.dormant ||
        w.isSameFenceSide(player.camera.position.x, player.camera.position.z, trapped.mesh.position.x, trapped.mesh.position.z, 25),
    };
    return out;
  }

  // Directional spawning: walk east along 9th Ave for ~4 minutes, then
  // turn and walk back west, facing the way we walk. Record where every
  // recycled enemy comes back relative to the actual travel direction.
  // Run twice -- with the forward bias, and with it switched off -- so the
  // difference is measured, not assumed.
  function runDirectional(biasOn, routePx) {
    H.setMap("campus");
    H.startRun();
    const w = H.campusWorld, sp = H.campusSpawner, player = H.players[0];
    const cfg = sp.config;
    const saved = { b: cfg.forwardSpawnBias, f: cfg.forwardSampleFraction, r: cfg.rearSpawnWeight, v: cfg.aheadVisibleMinDistance };
    if (!biasOn) { cfg.forwardSpawnBias = 0; cfg.forwardSampleFraction = 0; cfg.rearSpawnWeight = 1; cfg.aheadVisibleMinDistance = Infinity; }
    const r = routePx || [[-30, 686], [1690, 686]];
    const A = w.mapToWorld(...r[0]), B = w.mapToWorld(...r[1]);
    const legs = [[A, B], [B, A]];
    const seenDormant = new WeakSet();
    const out = { ahead: 0, side: 0, behind: 0, forwardHemisphere: 0, total: 0, afterTurn: { ahead: 0, side: 0, behind: 0 } };
    let t = 0, leg = 0, legT = 0, kills = 0, turnAt = 0;
    while (leg < legs.length) {
      const [a, b] = legs[leg];
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      legT += (4.85 * DT) / len;
      if (legT >= 1) { legT = 0; leg++; turnAt = t; continue; }
      const ux = (b.x - a.x) / len, uz = (b.z - a.z) / len;
      player.camera.position.x = a.x + (b.x - a.x) * legT;
      player.camera.position.z = a.z + (b.z - a.z) * legT;
      player.yaw = Math.atan2(-ux, -uz);
      player.health = 1e9;
      // keep waves flowing: anything that reaches the walker dies
      for (let i = H.enemies.length - 1; i >= 0; i--) {
        const e = H.enemies[i];
        if (e.dormant || e.boss) continue;
        if (Math.hypot(e.mesh.position.x - player.camera.position.x, e.mesh.position.z - player.camera.position.z) < 5) {
          H.damageEnemy(e, 1e6, e.mesh.position); kills++;
        }
      }
      H.step(DT);
      t += DT;
      for (const e of H.enemies) {
        if (e.dormant) { seenDormant.add(e); continue; }
        if (!seenDormant.has(e)) continue;
        seenDormant.delete(e); // just woke up = a recycled respawn
        if (t < 8) continue;   // travel direction still warming up
        const dx = e.mesh.position.x - player.camera.position.x, dz = e.mesh.position.z - player.camera.position.z;
        const dot = (dx * ux + dz * uz) / (Math.hypot(dx, dz) || 1);
        const key = dot > 0.34 ? "ahead" : dot < -0.34 ? "behind" : "side";
        out[key]++; out.total++;
        const dist = Math.hypot(dx, dz);
        const fwd = { x: -Math.sin(player.yaw), z: -Math.cos(player.yaw) };
        const viewCos = (dx * fwd.x + dz * fwd.z) / (dist || 1);
        const hidden = w.segmentBlocked(player.camera.position.x, player.camera.position.z, e.mesh.position.x, e.mesh.position.z, 0);
        if (key === "ahead") out[hidden ? "aheadHidden" : "aheadVisible"] = (out[hidden ? "aheadHidden" : "aheadVisible"] || 0) + 1;
        if (viewCos >= Math.cos(Math.PI / 3) && !hidden) {
          out.inView = (out.inView || 0) + 1;
          out.inViewMinDist = Math.min(out.inViewMinDist || 1e9, dist);
          out.inViewMaxCenterCos = Math.max(out.inViewMaxCenterCos || -1, viewCos);
        }
        if (dot > 0) out.forwardHemisphere++;
        if (leg === 1 && t - turnAt < 20) out.afterTurn[key]++;
      }
    }
    Object.assign(cfg, { forwardSpawnBias: saved.b, forwardSampleFraction: saved.f, rearSpawnWeight: saved.r, aheadVisibleMinDistance: saved.v });
    const pct = (n) => Math.round((100 * n) / (out.total || 1)) + "%";
    return {
      simulatedSeconds: Math.round(t), kills, recycledRespawns: out.total,
      ahead: pct(out.ahead), side: pct(out.side), behind: pct(out.behind), forwardHemisphere: pct(out.forwardHemisphere),
      first20sAfterTurningAround: out.afterTurn,
      appearedInView: out.inView || 0,
      aheadHidden: out.aheadHidden || 0, aheadVisible: out.aheadVisible || 0,
      inViewClosestMeters: out.inView ? Math.round(out.inViewMinDist) : null,
      inViewMinDegreesOffCenter: out.inView ? Math.round(Math.acos(out.inViewMaxCenterCos) * 180 / Math.PI) : null,
      recycled: Object.assign({}, H.campusRecycler.stats),
    };
  }

  try {
    results.directional = {
      withBias: runDirectional(true),
      baseline: runDirectional(false),
      mallWithBias: runDirectional(true, [[245, 405], [1290, 405]]),
    };
  } catch (e) {
    results.ok = false;
    results.errors.push("directional: " + (e && e.stack || e));
  }
  try {
    results.fences = runFencesAndStuck();
  } catch (e) {
    results.ok = false;
    results.errors.push("fences: " + (e && e.stack || e));
  }
  try {
    results.campus = runCampus();
  } catch (e) {
    results.ok = false;
    results.errors.push("campus: " + (e && e.stack || e));
  }
  // index.html#spawntest-show: skip the Classic run and leave the campus
  // run on screen (title/overlays hidden) for a visual check.
  const showCampus = /spawntest-show/.test(window.location.hash);
  if (showCampus) {
    document.getElementById("title-screen").classList.add("hidden");
    document.getElementById("overlay").classList.add("hidden");
    // Look along the mall from just east of the library.
    const w = H.campusWorld, p = H.players[0];
    const at = /spawntest-show-east/.test(window.location.hash) ? w.mapToWorld(1830, 330) : w.mapToWorld(800, 405);
    p.camera.position.set(at.x, H.EYE_HEIGHT, at.z);
    p.yaw = Math.PI / 2; // facing west
    p.pitch = -0.05;
  } else try {
    results.classic = runClassic();
  } catch (e) {
    results.ok = false;
    results.errors.push("classic: " + (e && e.stack || e));
  }
  const pre = document.createElement("pre");
  pre.id = "spawn-test-results";
  pre.textContent = JSON.stringify(results, null, 2);
  document.body.appendChild(pre);
})();
