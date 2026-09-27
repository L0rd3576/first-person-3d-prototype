// Procedural enemy spawn manager: picks spawn spots around the player(s)
// instead of using fixed spawn points. It knows nothing about any
// particular map -- the game hands it a few cheap hooks (bounds check,
// walkability, line of sight) and asks it to place enemies.
//
// Pipeline per spawn attempt (only when there's something queued, and only
// every config.updateInterval seconds -- never per frame):
//
//   queue a request  ->  sample a few candidates on a ring around a player
//   -> cheap validation, cheapest check first (bounds, distance to every
//      player, recent-spot memory, walkability, then one line-of-sight
//      test only for candidates inside a player's view cone)
//   -> weighted pick (behind > sides > occluded-in-front, bonuses for
//      spots near buildings / on the player's recent trail)
//   -> hooks.spawn(request, position)
//
// Candidates that pass are kept for a moment and reused while the player
// hasn't moved much, so a burst of spawns doesn't redo the work.
(function () {
  "use strict";

  const DEFAULT_CONFIG = {
    minSpawnDistance: 35,        // m -- never closer than this to any player
    maxSpawnDistance: 70,        // m -- ring's outer edge
    candidatesPerAttempt: 6,     // samples per spawn attempt
    updateInterval: 0.35,        // s between spawn attempts
    spawnsPerUpdate: 2,          // most enemies placed per attempt
    maxActiveEnemies: 40,        // active (not dormant) enemies, map-wide
    nearbyRadius: 60,            // m -- "already enough enemies around the player" check
    maxNearbyEnemies: 30,
    viewHalfAngleDeg: 60,        // a player's view cone, for the "don't pop in on screen" rule
    candidateJitter: 3,          // m of random offset on each candidate
    recentSpawnMemory: 16,       // how many recent spawn spots are remembered
    recentSpawnRadius: 10,       // m -- a new spawn can't land this close to a remembered one
    reuseMoveThreshold: 8,       // m -- cached good candidates are dropped once a player moves this far
    candidateClearance: 0.8,     // m -- walkability radius for a spawn spot
    trailSampleInterval: 2,      // s between breadcrumbs of each player's recent path
    trailLength: 8,              // breadcrumbs kept per player
    trailRadius: 15,             // m -- "near where the player recently was"
    weights: {
      behind: 1.0,               // more than ~110 degrees off the player's facing
      side: 0.6,                 // between the view cone and "behind"
      occludedFront: 0.45,       // inside the view cone but hidden behind a building
      nearBuilding: 0.35,        // bonus: within nearBuildingDistance of a building
      openArea: 0.1,             // bonus: nothing within nearBuildingDistance
      recentTrail: 0.4,          // bonus: near where the player was a few seconds ago
    },
    nearBuildingDistance: 12,    // m
    // ---- Directional spawning for recycled enemies (requests marked
    // `directional: true`). Uses each player's actual world-space travel
    // direction (not where they look), smoothed, so a player crossing the
    // map finds recycled enemies waiting along their route instead of
    // watching them respawn behind. All of it is only computed when a spawn
    // spot is actually being chosen; direction tracking is a cheap sample
    // every travelSampleInterval seconds.
    forwardSpawnBias: 2.5,          // FORWARD_SPAWN_BIAS -- extra weight (x confidence) for spots ahead
    forwardSpawnAngleDeg: 75,       // FORWARD_SPAWN_ANGLE -- half-angle of "ahead" around the travel direction
    forwardSampleFraction: 0.6,     // share of candidates sampled inside that ahead arc (x confidence)
    rearSpawnWeight: 0.12,          // REAR_SPAWN_WEIGHT -- weight multiplier behind the player at full confidence
    movementDirectionSmoothing: 1.5, // MOVEMENT_DIRECTION_SMOOTHING -- s, time constant of the smoothed direction
    minTravelSpeed: 1.5,            // MINIMUM_TRAVEL_SPEED_FOR_DIRECTIONAL_SPAWNING -- m/s; slower counts as standing
    travelConfidenceTime: 4,        // s of steady travel for the forward preference to reach full strength
    predictionDistance: 25,         // PREDICTION_DISTANCE -- m ahead; spots near there score a bit higher
    // A player running forward looks where they're going, so "ahead" is
    // mostly in view. Directional (recycled) spawns may appear in view only
    // this far out and at least this far off the center of the view -- in
    // the periphery, in the fog. Set aheadVisibleMinDistance to Infinity to
    // keep them strictly out of sight.
    aheadVisibleMinDistance: 48,    // m
    aheadVisibleCenterClearDeg: 22, // degrees off the view center
    directionalExtraBatches: 2,     // extra small sample batches a directional spawn may try for a spot ahead
    // Ahead-and-hidden beats ahead-and-visible: spots ahead behind something
    // that blocks line of sight get this bonus, and visible ones (the far,
    // off-center exception above) only this fraction, so a visible spawn is
    // the fallback when nothing ahead is hidden.
    occludedAheadBonus: 2.5,
    visibleAheadWeight: 0.3,
    occludedSpotsPerAttempt: 4,     // spots behind buildings ahead, suggested by hooks.findOccludedSpots
    travelSampleInterval: 0.25,     // s between travel-direction samples
    debug: false,
  };

  function mergeConfig(base, overrides) {
    const out = Object.assign({}, base, overrides || {});
    out.weights = Object.assign({}, base.weights, (overrides && overrides.weights) || {});
    return out;
  }

  // hooks:
  //   getPlayers()            -> [{ x, z, yaw }] living players (yaw 0 = facing -z)
  //   isInsideBounds(x, z)    -> playable area check (cheap math)
  //   isWalkable(x, z, r)     -> can an enemy stand here
  //   isSightBlocked(ax, az, bx, bz) -> is the straight line between two points blocked
  //   findOccludedSpots(px, pz, dirX, dirZ, minR, maxR, halfAngle, count) -> optional:
  //                            a few spots ahead that sit behind something blocking sight
  //   isReachable(px, pz, x, z) -> optional: can an enemy at (x, z) get to the player
  //                            at (px, pz) without crossing a fence
  //   distanceToNearestBuilding(x, z, max) -> optional, for weighting
  //   countActiveEnemies()    -> active enemies right now
  //   countEnemiesNear(x, z, r) -> active enemies within r of a point
  //   spawn(request, position) -> actually create / relocate the enemy
  function createProceduralSpawnManager(configOverrides, hooks) {
    const config = mergeConfig(DEFAULT_CONFIG, configOverrides);
    const queue = [];
    const recentSpawns = [];          // rolling list, capped at recentSpawnMemory
    const trails = [];                // per player: rolling breadcrumbs
    let trailTimer = 0;
    let updateTimer = 0;
    let cachedCandidates = [];        // validated, still-good candidates
    let cacheAnchors = [];            // player positions the cache was built for
    const stats = { attempts: 0, candidatesTested: 0, accepted: 0, rejected: {}, lastAttemptMs: 0, directional: { ahead: 0, side: 0, behind: 0 } };
    const debugLog = [];              // recent candidates for the debug overlay

    const viewCos = Math.cos((config.viewHalfAngleDeg * Math.PI) / 180);
    const behindCos = Math.cos((110 * Math.PI) / 180);
    const forwardCos = Math.cos((config.forwardSpawnAngleDeg * Math.PI) / 180);
    const centerClearCos = Math.cos((config.aheadVisibleCenterClearDeg * Math.PI) / 180);

    // Per player: last sampled position, smoothed unit travel direction and
    // a 0..1 confidence (how long they've kept going roughly that way).
    const travel = [];
    let travelTimer = 0;
    function updateTravel(deltaSeconds, players) {
      travelTimer -= deltaSeconds;
      if (travelTimer > 0) return;
      const interval = config.travelSampleInterval - travelTimer;
      travelTimer = config.travelSampleInterval;
      players.forEach((p, i) => {
        const t = travel[i] || (travel[i] = { x: p.x, z: p.z, dx: 0, dz: 0, confidence: 0 });
        const mx = p.x - t.x, mz = p.z - t.z;
        const dist = Math.hypot(mx, mz);
        t.x = p.x;
        t.z = p.z;
        if (dist > 50) { // teleport/respawn -- start over
          t.dx = 0; t.dz = 0; t.confidence = 0;
          return;
        }
        const step = interval / config.travelConfidenceTime;
        if (dist / interval < config.minTravelSpeed) {
          t.confidence = Math.max(0, t.confidence - step * 2); // standing: fade back to radial
          return;
        }
        const ux = mx / dist, uz = mz / dist;
        const agreement = t.dx * ux + t.dz * uz; // with the direction so far
        const a = 1 - Math.exp(-interval / config.movementDirectionSmoothing);
        let nx = t.dx + (ux - t.dx) * a, nz = t.dz + (uz - t.dz) * a;
        const nl = Math.hypot(nx, nz) || 1;
        t.dx = nx / nl;
        t.dz = nz / nl;
        // steady travel builds confidence; a real turn spends it, so the
        // old direction stops being favoured quickly
        t.confidence = agreement > 0.7 ? Math.min(1, t.confidence + step)
          : Math.max(0, t.confidence - step * (agreement < 0 ? 3 : 1));
      });
      travel.length = players.length;
    }
    // Travel info for player i, or null when they aren't really travelling.
    function travelOf(i) {
      const t = travel[i];
      return t && t.confidence > 0.05 && (t.dx || t.dz) ? t : null;
    }
    // Weight multiplier for a candidate relative to that player's travel:
    // ahead (inside the forward arc) up to 1 + forwardSpawnBias, sides 1,
    // behind down to rearSpawnWeight -- all scaled by confidence -- plus a
    // small bonus for being near where the player will be shortly.
    function directionalMultiplier(c) {
      const t = travelOf(c.playerIndex);
      if (!t) return 1;
      const p = travel[c.playerIndex];
      const dx = c.x - p.x, dz = c.z - p.z;
      const d = Math.hypot(dx, dz) || 1;
      const dot = (dx * t.dx + dz * t.dz) / d;
      let m;
      if (dot >= forwardCos) m = 1 + config.forwardSpawnBias * t.confidence;
      else if (dot >= 0) m = 1 + config.forwardSpawnBias * t.confidence * (dot / forwardCos) * 0.5;
      else m = 1 + (config.rearSpawnWeight - 1) * t.confidence * Math.min(1, -dot / 0.5);
      const px = p.x + t.dx * config.predictionDistance, pz = p.z + t.dz * config.predictionDistance;
      const nearPredicted = Math.max(0, 1 - Math.hypot(c.x - px, c.z - pz) / config.maxSpawnDistance);
      // hidden beats visible for spots ahead
      if (dot > 0) {
        if (c.facing === "visibleFront") m *= config.visibleAheadWeight;
        else if (c.facing === "occludedFront") m *= 1 + config.occludedAheadBonus * t.confidence;
      }
      return m * (1 + 0.5 * t.confidence * nearPredicted);
    }

    function reject(reason) {
      stats.rejected[reason] = (stats.rejected[reason] || 0) + 1;
      return null;
    }

    // Angle class of a point relative to a player's facing: "front" (in the
    // view cone), "side" or "behind". Pure dot products, no trig per call.
    function facingClass(player, x, z) {
      const fx = -Math.sin(player.yaw), fz = -Math.cos(player.yaw);
      const dx = x - player.x, dz = z - player.z;
      const len = Math.hypot(dx, dz) || 1;
      const cos = (dx * fx + dz * fz) / len;
      if (cos >= viewCos) return "front";
      if (cos <= behindCos) return "behind";
      return "side";
    }

    // Cheapest checks first; returns a scored candidate or null.
    function evaluate(x, z, players, directional = false) {
      stats.candidatesTested++;
      if (!hooks.isInsideBounds(x, z)) return reject("bounds");
      for (const p of players) {
        const d = Math.hypot(x - p.x, z - p.z);
        if (d < config.minSpawnDistance) return reject("tooClose");
      }
      let nearestDistance = Infinity;
      for (const p of players) nearestDistance = Math.min(nearestDistance, Math.hypot(x - p.x, z - p.z));
      if (nearestDistance > config.maxSpawnDistance + config.candidateJitter) return reject("tooFar");
      for (const r of recentSpawns) {
        if ((x - r.x) ** 2 + (z - r.z) ** 2 < config.recentSpawnRadius ** 2) return reject("recent");
      }
      if (!hooks.isWalkable(x, z, config.candidateClearance)) return reject("notWalkable");
      // Optional: must be able to reach the nearest player without climbing
      // a fence (same side, or close to a gate) -- see hooks.isReachable.
      if (hooks.isReachable) {
        let nearest = players[0], best = Infinity;
        for (const p of players) {
          const d = (x - p.x) ** 2 + (z - p.z) ** 2;
          if (d < best) { best = d; nearest = p; }
        }
        if (!hooks.isReachable(nearest.x, nearest.z, x, z)) return reject("fencedOff");
      }

      // Visibility: only candidates inside some player's view cone get a
      // (single) line-of-sight test; anything a player could see is out.
      let weight = 0;
      let bestClass = "behind";
      for (const p of players) {
        const cls = facingClass(p, x, z);
        if (cls === "front") {
          if (!hooks.isSightBlocked(p.x, p.z, x, z)) {
            // directional exception: far out, off to the side of the view
            const d = Math.hypot(x - p.x, z - p.z) || 1;
            const cos = ((x - p.x) * -Math.sin(p.yaw) + (z - p.z) * -Math.cos(p.yaw)) / d;
            if (!(directional && d >= config.aheadVisibleMinDistance && cos < centerClearCos)) return reject("visible");
            bestClass = "visibleFront";
          } else if (bestClass !== "visibleFront") {
            bestClass = "occludedFront";
          }
        } else if (cls === "side" && bestClass === "behind") {
          bestClass = "side";
        }
      }
      weight = bestClass === "behind" ? config.weights.behind
        : bestClass === "side" ? config.weights.side : config.weights.occludedFront; // (visibleFront too)

      if (hooks.distanceToNearestBuilding) {
        const near = hooks.distanceToNearestBuilding(x, z, config.nearBuildingDistance) < config.nearBuildingDistance;
        weight += near ? config.weights.nearBuilding : config.weights.openArea;
      }
      for (const trail of trails) {
        if (trail && trail.some((b) => (x - b.x) ** 2 + (z - b.z) ** 2 < config.trailRadius ** 2)) {
          weight += config.weights.recentTrail;
          break;
        }
      }
      return { x, z, weight, facing: bestClass };
    }

    // A handful of random points on the ring around a random living player.
    function sampleCandidates(players, directional) {
      const out = [];
      for (let i = 0; i < config.candidatesPerAttempt; i++) {
        const playerIndex = Math.floor(Math.random() * players.length);
        const p = players[playerIndex];
        let angle = Math.random() * Math.PI * 2;
        const t = directional ? travelOf(playerIndex) : null;
        const forwardSample = !!t && Math.random() < config.forwardSampleFraction * t.confidence;
        if (forwardSample) {
          // inside the forward arc, spread across it (not on the travel line)
          const half = (config.forwardSpawnAngleDeg * Math.PI) / 180;
          angle = Math.atan2(t.dz, t.dx) + (Math.random() * 2 - 1) * half;
        }
        // sqrt for an even spread over the ring's area rather than bunching at its inner edge
        const r2min = config.minSpawnDistance ** 2, r2max = config.maxSpawnDistance ** 2;
        let radius = Math.sqrt(r2min + Math.random() * (r2max - r2min));
        if (forwardSample && radius < config.aheadVisibleMinDistance && Math.random() < 0.5) {
          radius = config.aheadVisibleMinDistance + Math.random() * Math.max(0, config.maxSpawnDistance - config.aheadVisibleMinDistance);
        }
        const jx = (Math.random() * 2 - 1) * config.candidateJitter;
        const jz = (Math.random() * 2 - 1) * config.candidateJitter;
        out.push({ x: p.x + Math.cos(angle) * radius + jx, z: p.z + Math.sin(angle) * radius + jz, playerIndex });
      }
      // Plus a few spots just behind buildings ahead (one cheap map query).
      if (directional && hooks.findOccludedSpots) {
        players.forEach((p, playerIndex) => {
          const t = travelOf(playerIndex);
          if (!t) return;
          for (const spot of hooks.findOccludedSpots(p.x, p.z, t.dx, t.dz, config.minSpawnDistance,
            config.maxSpawnDistance, (config.forwardSpawnAngleDeg * Math.PI) / 180, config.occludedSpotsPerAttempt)) {
            out.push({ x: spot.x, z: spot.z, playerIndex });
          }
        });
      }
      return out;
    }

    function pickWeighted(list, directional) {
      const weights = list.map((c) => c.weight * (directional ? directionalMultiplier(c) : 1));
      const total = weights.reduce((sum, w) => sum + w, 0);
      let roll = Math.random() * total;
      for (let i = 0; i < list.length; i++) {
        roll -= weights[i];
        if (roll <= 0) return list[i];
      }
      return list[list.length - 1];
    }

    function playersMovedFromCache(players) {
      if (cacheAnchors.length !== players.length) return true;
      return players.some((p, i) => Math.hypot(p.x - cacheAnchors[i].x, p.z - cacheAnchors[i].z) > config.reuseMoveThreshold);
    }

    function findSpawnPosition(players, directional) {
      if (playersMovedFromCache(players)) {
        cachedCandidates = [];
        cacheAnchors = players.map((p) => ({ x: p.x, z: p.z }));
      }
      // Reuse still-valid cached spots first (re-checked cheaply: they may
      // have drifted into view or too close since they were found).
      cachedCandidates = cachedCandidates.filter((c) => evaluate(c.x, c.z, players, directional));
      const travelling = directional && players.some((_, i) => travelOf(i));
      const hasAhead = () => cachedCandidates.some((c) => directionalMultiplier(c) > 1.5);
      // A directional request with nothing ahead in the cache samples fresh
      // (forward-biased) batches -- at most 1 + directionalExtraBatches small
      // ones -- before settling for whatever valid spot there is.
      const batches = cachedCandidates.length === 0 ? 1 + (travelling ? config.directionalExtraBatches : 0)
        : travelling && !hasAhead() ? 1 + config.directionalExtraBatches : 0;
      for (let b = 0; b < batches; b++) {
        for (const c of sampleCandidates(players, directional)) {
          const scored = evaluate(c.x, c.z, players, directional);
          if (config.debug) debugLog.push({ x: c.x, z: c.z, ok: !!scored });
          if (scored) {
            scored.playerIndex = c.playerIndex;
            cachedCandidates.push(scored);
          }
        }
        if (debugLog.length > 48) debugLog.splice(0, debugLog.length - 48);
        if (cachedCandidates.length > 0 && (!travelling || hasAhead())) break;
      }
      if (cachedCandidates.length === 0) return null;
      const chosen = pickWeighted(cachedCandidates, directional);
      cachedCandidates.splice(cachedCandidates.indexOf(chosen), 1);
      return chosen;
    }

    function updateTrails(deltaSeconds, players) {
      trailTimer -= deltaSeconds;
      if (trailTimer > 0) return;
      trailTimer = config.trailSampleInterval;
      players.forEach((p, i) => {
        const trail = trails[i] || (trails[i] = []);
        trail.push({ x: p.x, z: p.z });
        if (trail.length > config.trailLength) trail.shift();
      });
      trails.length = players.length;
    }

    return {
      config,
      stats,
      debugLog,
      // Ask for an enemy; `request` is passed back to hooks.spawn untouched
      // (e.g. { variant: "brute" } or { enemy: dormantEnemyToRelocate }).
      request(request) {
        queue.push(request);
      },
      pendingCount() {
        return queue.length;
      },
      clear() {
        queue.length = 0;
        recentSpawns.length = 0;
        trails.length = 0;
        cachedCandidates = [];
        cacheAnchors = [];
        debugLog.length = 0;
        updateTimer = 0;
        travel.length = 0;
      },
      recentSpawns,
      // Smoothed travel direction of player i (for debug/tests), or null.
      travelDirection(i = 0) {
        const t = travelOf(i);
        return t ? { x: t.dx, z: t.dz, confidence: t.confidence } : null;
      },
      update(deltaSeconds) {
        const players = hooks.getPlayers();
        if (players.length === 0) return;
        updateTrails(deltaSeconds, players);
        updateTravel(deltaSeconds, players);
        if (queue.length === 0) return;                 // nothing wanted -- no work at all
        updateTimer -= deltaSeconds;
        if (updateTimer > 0) return;
        updateTimer = config.updateInterval;
        const t0 = performance.now();
        stats.attempts++;
        for (let n = 0; n < config.spawnsPerUpdate && queue.length > 0; n++) {
          if (hooks.countActiveEnemies() >= config.maxActiveEnemies) break;
          if (players.every((p) => hooks.countEnemiesNear(p.x, p.z, config.nearbyRadius) >= config.maxNearbyEnemies)) break;
          const directional = !!queue[0].directional;
          const spot = findSpawnPosition(players, directional);
          if (!spot) break;                              // try again next interval
          const request = queue.shift();
          if (directional) {
            // record where it landed relative to the player's travel (tuning/tests)
            const t = travelOf(spot.playerIndex || 0);
            const p = players[spot.playerIndex || 0];
            if (t && t.confidence > 0.5) {
              const d = Math.hypot(spot.x - p.x, spot.z - p.z) || 1;
              const dot = ((spot.x - p.x) * t.dx + (spot.z - p.z) * t.dz) / d;
              const key = dot > 0.34 ? "ahead" : dot < -0.34 ? "behind" : "side";
              stats.directional[key]++;
            }
          }
          recentSpawns.push({ x: spot.x, z: spot.z });
          if (recentSpawns.length > config.recentSpawnMemory) recentSpawns.shift();
          stats.accepted++;
          hooks.spawn(request, spot);
        }
        stats.lastAttemptMs = performance.now() - t0;
      },
    };
  }

  // ------------------------------------------------------------------
  // Enemy recycler: keeps the active population where the player is.
  // Every checkInterval seconds it looks at the next batchSize active
  // enemies (so each one is visited roughly every
  // checkInterval * enemies / batchSize seconds -- never all of them every
  // frame) and recycles an enemy that is
  //   - far: beyond recycleDistance from every living player, or
  //   - stuck: has barely moved (minimumMovement) and made no progress
  //     toward the player (minimumProgress) for stuckTimeThreshold seconds,
  //     or has moved about without ever getting closer for
  //     noProgressTimeThreshold seconds -- while not busy (attacking, hit, special move -- see
  //     hooks.isBusy).
  // Recycling never happens where a player could see it (inside their view
  // cone, within visibleDistance, not hidden behind a building); a stuck
  // enemy in plain view gets one recovery attempt (a forced repath) first
  // and is recycled later, once out of view.
  //
  // "Recycle" is hooks.recycle(enemy): the game parks the enemy (pooled,
  // not destroyed) and queues it with the spawn manager, which places it
  // near the player under the usual spawn rules and the usual population
  // cap -- this module never positions enemies itself.
  // ------------------------------------------------------------------
  const RECYCLER_DEFAULTS = {
    checkInterval: 0.25,        // s between batches
    batchSize: 8,               // enemies looked at per batch
    recycleDistance: 130,       // m -- ENEMY_RECYCLE_DISTANCE
    stuckTimeThreshold: 6,      // s of no movement (and no progress) before "stuck"
    noProgressTimeThreshold: 18, // s of moving about without ever getting closer (e.g. sliding along a fence)
    minimumMovement: 1.5,       // m an enemy must move between its checkpoints...
    minimumProgress: 1.0,       // ...or get this much closer to the player
    playerMoveReset: 25,        // m -- the player moving this far gives stuck enemies a fresh start
    visibleDistance: 110,       // m -- beyond this (the fog) nothing is visible anyway
    viewHalfAngleDeg: 65,       // a player's view cone, plus a little margin
  };

  // hooks:
  //   getPlayers()         -> [{ x, z, yaw }] living players (yaw 0 = facing -z)
  //   getEnemies()         -> the enemy list (parked ones are skipped via isActive)
  //   isActive(enemy)      -> not parked/dormant
  //   position(enemy)      -> { x, z }
  //   isBusy(enemy, nearestPlayerDistance) -> attacking / hit / mid special move
  //   isSightBlocked(ax, az, bx, bz)
  //   recover(enemy)       -> try to get it moving again (e.g. force a repath)
  //   recycle(enemy, reason)
  function createEnemyRecycler(configOverrides, hooks) {
    const config = Object.assign({}, RECYCLER_DEFAULTS, configOverrides || {});
    const state = new WeakMap(); // enemy -> one small rolling checkpoint
    let timer = 0;
    let clock = 0;
    let cursor = 0;
    const stats = { far: 0, stuck: 0, recoveries: 0, deferredVisible: 0 };
    const viewCos = Math.cos((config.viewHalfAngleDeg * Math.PI) / 180);

    function visibleToAnyPlayer(players, x, z) {
      for (const p of players) {
        const dx = x - p.x, dz = z - p.z;
        const d = Math.hypot(dx, dz);
        if (d > config.visibleDistance) continue;
        if (d < 3) return true; // right on top of them
        const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
        if ((dx * fx + dz * fz) / d < viewCos) continue;    // outside the view cone
        if (hooks.isSightBlocked(p.x, p.z, x, z)) continue; // behind a building
        return true;
      }
      return false;
    }

    function nearestPlayer(players, x, z) {
      let best = null, bestD = Infinity;
      for (const p of players) {
        const d = Math.hypot(x - p.x, z - p.z);
        if (d < bestD) { bestD = d; best = p; }
      }
      return { player: best, distance: bestD };
    }

    function checkEnemy(enemy, players) {
      const pos = hooks.position(enemy);
      const { player, distance } = nearestPlayer(players, pos.x, pos.z);
      enemy.recyclerNearestDistance = distance; // cached for the game's level-of-detail decisions
      let s = state.get(enemy);
      if (!s) {
        s = { x: pos.x, z: pos.z, dist: distance, px: player.x, pz: player.z, lastCheck: clock, stuckTime: 0, noProgressTime: 0, recovered: false };
        state.set(enemy, s);
        return;
      }
      const elapsed = clock - s.lastCheck;
      s.lastCheck = clock;

      // Far away: recycle once nobody can see it.
      if (distance > config.recycleDistance) {
        if (hooks.isBusy(enemy, distance)) return;
        if (visibleToAnyPlayer(players, pos.x, pos.z)) { stats.deferredVisible++; return; }
        state.delete(enemy);
        stats.far++;
        hooks.recycle(enemy, "far");
        return;
      }

      // Stuck detection. Getting closer, being busy, or the player having
      // moved on resets everything; merely moving resets only the
      // "standing still" timer, not the (longer) "never gets closer" one.
      const moved = Math.hypot(pos.x - s.x, pos.z - s.z);
      const progress = s.dist - distance;
      const playerMoved = Math.hypot(player.x - s.px, player.z - s.pz);
      if (progress >= config.minimumProgress || playerMoved >= config.playerMoveReset || hooks.isBusy(enemy, distance)) {
        s.x = pos.x; s.z = pos.z; s.dist = distance; s.px = player.x; s.pz = player.z;
        s.stuckTime = 0;
        s.noProgressTime = 0;
        s.recovered = false;
        return;
      }
      s.noProgressTime += elapsed;
      if (moved >= config.minimumMovement) {
        s.x = pos.x; s.z = pos.z;
        s.stuckTime = 0;
      } else {
        s.stuckTime += elapsed;
      }
      if (s.stuckTime < config.stuckTimeThreshold && s.noProgressTime < config.noProgressTimeThreshold) return;

      if (visibleToAnyPlayer(players, pos.x, pos.z)) {
        // In plain view: nudge it once rather than make it vanish.
        if (!s.recovered) {
          s.recovered = true;
          s.stuckTime = config.stuckTimeThreshold / 2;
          s.noProgressTime = config.noProgressTimeThreshold / 2;
          stats.recoveries++;
          hooks.recover(enemy);
        } else {
          stats.deferredVisible++;
        }
        return;
      }
      state.delete(enemy);
      stats.stuck++;
      hooks.recycle(enemy, "stuck");
    }

    return {
      config,
      stats,
      reset() {
        timer = 0;
        cursor = 0;
        for (const k of Object.keys(stats)) stats[k] = 0;
      },
      update(deltaSeconds) {
        clock += deltaSeconds;
        timer -= deltaSeconds;
        if (timer > 0) return;
        timer = config.checkInterval;
        const players = hooks.getPlayers();
        if (players.length === 0) return;
        const enemies = hooks.getEnemies();
        if (enemies.length === 0) return;
        // Next batch, round-robin over the list (recycling doesn't remove an
        // enemy from it -- parked enemies are just skipped).
        let visited = 0;
        for (let n = 0; n < enemies.length && visited < config.batchSize; n++) {
          if (cursor >= enemies.length) cursor = 0;
          const enemy = enemies[cursor++];
          if (!hooks.isActive(enemy)) continue;
          visited++;
          checkEnemy(enemy, players);
        }
      },
    };
  }

  window.createEnemyRecycler = createEnemyRecycler;
  window.ENEMY_RECYCLER_DEFAULTS = RECYCLER_DEFAULTS;
  window.createProceduralSpawnManager = createProceduralSpawnManager;
  window.PROCEDURAL_SPAWN_DEFAULTS = DEFAULT_CONFIG;
})();
