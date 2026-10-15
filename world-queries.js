// Collider queries for the smaller maps (map2-world.js): a static bucket grid
// of oriented boxes / cylinders and everything the game asks of a world
// without touching the whole map -- resolveCircle, supportHeightAt,
// segmentBlocked, isWalkable, raycast, distanceToNearestBuilding -- plus the
// parked-car hitboxes (createCarQueries).
//
// This is a trimmed copy of the matching block in campus-world.js (stairs,
// nav levels and climbables dropped; the maps using this have none). The
// campus keeps its own copy: rewiring it onto this module was judged too
// risky for the campus. A collider is { cx, cz, halfX, halfZ, height, yaw,
// cos, sin, minX..maxZ } (campus-world.js makeCollider) plus optional
// shape: "cylinder" + radius, base, seeThrough, isTree, noImpact, fx, vehicle,
// noStand (blocks bodies, never a floor: railings), ceiling (shots only: hollow-house roof).
(function () {
  "use strict";

  function makeCollider(cx, cz, halfX, halfZ, height, yaw) {
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    const extentX = Math.abs(cos) * halfX + Math.abs(sin) * halfZ;
    const extentZ = Math.abs(sin) * halfX + Math.abs(cos) * halfZ;
    return {
      cx, cz, halfX, halfZ, height, yaw, cos, sin,
      minX: cx - extentX, maxX: cx + extentX, minZ: cz - extentZ, maxZ: cz + extentZ,
    };
  }

  function makeCylinderCollider(cx, cz, radius, height) {
    const c = makeCollider(cx, cz, radius, radius, height, 0);
    c.shape = "cylinder";
    c.radius = radius;
    return c;
  }

  function createColliderQueries({ colliders, bounds, groundHeightAt, stepUpHeight = 0.5, margin = 20, groundMaterialAt }) {
    const STEP_UP_M = stepUpHeight;
    const SIGHT_MIN_HEIGHT_M = 1.2;  // shorter than this doesn't block line of sight (curbs, low steps)
    const SIGHT_MAX_BASE_M = 1.6;
    const SIGHT_EYE_M = 1.4;
    const worldColliders = colliders.filter((c) => c.collide !== false);
    const BUCKET_M = 12;
    const originX = bounds.minX - margin, originZ = bounds.minZ - margin;
    const cols = Math.ceil((bounds.maxX - bounds.minX + margin * 2) / BUCKET_M);
    const rows = Math.ceil((bounds.maxZ - bounds.minZ + margin * 2) / BUCKET_M);
    const buckets = new Array(cols * rows);
    const colOf = (x) => Math.min(cols - 1, Math.max(0, Math.floor((x - originX) / BUCKET_M)));
    const rowOf = (z) => Math.min(rows - 1, Math.max(0, Math.floor((z - originZ) / BUCKET_M)));

    function addCollider(c) {
      c.stamp = 0;
      worldColliders.push(c);
      for (let row = rowOf(c.minZ); row <= rowOf(c.maxZ); row++) {
        for (let col = colOf(c.minX); col <= colOf(c.maxX); col++) {
          const i = row * cols + col;
          (buckets[i] || (buckets[i] = [])).push(c);
        }
      }
    }
    worldColliders.length = 0;
    for (const c of colliders.filter((k) => k.collide !== false)) addCollider(c);

    let queryStamp = 0;
    function forEachColliderIn(minX, minZ, maxX, maxZ, visit) {
      queryStamp++;
      for (let row = rowOf(minZ); row <= rowOf(maxZ); row++) {
        for (let col = colOf(minX); col <= colOf(maxX); col++) {
          const list = buckets[row * cols + col];
          if (!list) continue;
          for (const c of list) {
            if (c.stamp === queryStamp) continue;
            c.stamp = queryStamp;
            if (c.maxX < minX || c.minX > maxX || c.maxZ < minZ || c.minZ > maxZ) continue;
            if (visit(c) === true) return true;
          }
        }
      }
      return false;
    }

    const toLocal = (c, x, z) => {
      const dx = x - c.cx, dz = z - c.cz;
      return { x: dx * c.cos - dz * c.sin, z: dx * c.sin + dz * c.cos };
    };
    const toWorld = (c, lx, lz) => ({ x: c.cx + lx * c.cos + lz * c.sin, z: c.cz - lx * c.sin + lz * c.cos });

    function blocksBody(c, feetY, grounded, bodyHeight) {
      if (c.ceiling) return false; // hollow-house roof slab: solid to shots, never a head-bump / push-out for bodies under it
      if (feetY >= c.height - 0.01) return false;
      if (c.base && feetY + bodyHeight <= c.base) return false;
      if (grounded && c.height - feetY <= STEP_UP_M) return false;
      return true;
    }

    function resolveCircle(body, radius, feetY = 0, grounded = true, bodyHeight = 1.85) {
      for (let pass = 0; pass < 2; pass++) {
        forEachColliderIn(body.x - radius, body.z - radius, body.x + radius, body.z + radius, (c) => {
          if (!blocksBody(c, feetY, grounded, bodyHeight)) return;
          if (c.shape === "cylinder") {
            const dx = body.x - c.cx, dz = body.z - c.cz;
            const minDist = c.radius + radius;
            const distSq = dx * dx + dz * dz;
            if (distSq >= minDist * minDist) return;
            const dist = Math.sqrt(distSq);
            if (dist < 1e-6) { body.x = c.cx + minDist; return; }
            body.x = c.cx + (dx / dist) * minDist;
            body.z = c.cz + (dz / dist) * minDist;
            return;
          }
          const local = toLocal(c, body.x, body.z);
          const qx = Math.max(-c.halfX, Math.min(local.x, c.halfX));
          const qz = Math.max(-c.halfZ, Math.min(local.z, c.halfZ));
          const dx = local.x - qx, dz = local.z - qz;
          const distSq = dx * dx + dz * dz;
          if (distSq >= radius * radius) return;
          let out;
          if (distSq > 1e-8) {
            const dist = Math.sqrt(distSq);
            out = { x: qx + (dx / dist) * radius, z: qz + (dz / dist) * radius };
          } else {
            const pushes = [
              { d: local.x + c.halfX, x: -c.halfX - radius, z: local.z },
              { d: c.halfX - local.x, x: c.halfX + radius, z: local.z },
              { d: local.z + c.halfZ, x: local.x, z: -c.halfZ - radius },
              { d: c.halfZ - local.z, x: local.x, z: c.halfZ + radius },
            ];
            pushes.sort((a, b) => a.d - b.d);
            out = pushes[0];
          }
          const w = toWorld(c, out.x, out.z);
          body.x = w.x;
          body.z = w.z;
        });
      }
    }

    function supportHeightAt(x, z, radius, fromY) {
      let support = groundHeightAt(x, z);
      forEachColliderIn(x - radius, z - radius, x + radius, z + radius, (c) => {
        if (c.ceiling || c.noStand || c.height > fromY + 0.01 || c.height <= support) return; // railings / roof slabs block but never carry you
        if (c.shape === "cylinder") {
          const r = c.radius + radius;
          if ((x - c.cx) ** 2 + (z - c.cz) ** 2 < r * r) support = c.height;
          return;
        }
        const local = toLocal(c, x, z);
        const dx = local.x - Math.max(-c.halfX, Math.min(local.x, c.halfX));
        const dz = local.z - Math.max(-c.halfZ, Math.min(local.z, c.halfZ));
        if (dx * dx + dz * dz < radius * radius) support = c.height;
      });
      return support;
    }

    const blocksSight = (c) => !c.isTree && !c.seeThrough && c.height >= SIGHT_MIN_HEIGHT_M && !(c.base > SIGHT_MAX_BASE_M);

    // Liang-Barsky clip of the segment a->b (collider frame) against the box grown by hx/hz.
    function clipsBox(a, b, hx, hz) {
      let t0 = 0, t1 = 1;
      const ddx = b.x - a.x, ddz = b.z - a.z;
      const clip = (p, q) => {
        if (Math.abs(p) < 1e-12) return q >= 0;
        const r = q / p;
        if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; } else { if (r < t0) return false; if (r < t1) t1 = r; }
        return true;
      };
      return clip(-ddx, a.x + hx) && clip(ddx, hx - a.x) && clip(-ddz, a.z + hz) && clip(ddz, hz - a.z) && t0 <= t1 ? { t0, t1 } : null;
    }

    function segmentBlocked3D(x1, z1, ya, x2, z2, yb, clearance, includeFences) {
      const pad = clearance + 0.01;
      return forEachColliderIn(Math.min(x1, x2) - pad, Math.min(z1, z2) - pad, Math.max(x1, x2) + pad, Math.max(z1, z2) + pad, (c) => {
        if (c.isTree || (c.seeThrough && !includeFences)) return false;
        const r = c.shape === "cylinder" ? c.radius : null;
        const hit = clipsBox(toLocal(c, x1, z1), toLocal(c, x2, z2), (r ?? c.halfX) + clearance, (r ?? c.halfZ) + clearance);
        if (!hit) return false;
        const yA = ya + (yb - ya) * hit.t0, yB = ya + (yb - ya) * hit.t1;
        return Math.max(yA, yB) >= (c.base || 0) && Math.min(yA, yB) <= c.height;
      });
    }

    function segmentBlocked(x1, z1, x2, z2, clearance = 0, includeFences = false, y1, y2) {
      if (y1 !== undefined && y2 !== undefined && (Math.max(y1, y2) > 0.5 || Math.abs(y1 - y2) > 0.3)) {
        return segmentBlocked3D(x1, z1, y1 + SIGHT_EYE_M, x2, z2, y2 + SIGHT_EYE_M, clearance, includeFences);
      }
      const pad = clearance + 0.01;
      return forEachColliderIn(Math.min(x1, x2) - pad, Math.min(z1, z2) - pad, Math.max(x1, x2) + pad, Math.max(z1, z2) + pad, (c) => {
        if (!blocksSight(c) && !(includeFences && c.seeThrough && c.height >= SIGHT_MIN_HEIGHT_M)) return false;
        if (c.shape === "cylinder") {
          const dx = x2 - x1, dz = z2 - z1;
          const len2 = dx * dx + dz * dz || 1e-9;
          const t = Math.max(0, Math.min(1, ((c.cx - x1) * dx + (c.cz - z1) * dz) / len2));
          return Math.hypot(c.cx - (x1 + dx * t), c.cz - (z1 + dz * t)) < c.radius + clearance;
        }
        return !!clipsBox(toLocal(c, x1, z1), toLocal(c, x2, z2), c.halfX + clearance, c.halfZ + clearance);
      });
    }

    function isWalkable(x, z, radius = 0.4) {
      if (x < bounds.minX + radius || x > bounds.maxX - radius || z < bounds.minZ + radius || z > bounds.maxZ - radius) return false;
      return !forEachColliderIn(x - radius, z - radius, x + radius, z + radius, (c) => {
        if (!blocksBody(c, 0, true, 1.85)) return false;
        if (c.shape === "cylinder") return (x - c.cx) ** 2 + (z - c.cz) ** 2 < (c.radius + radius) ** 2;
        const local = toLocal(c, x, z);
        const dx = local.x - Math.max(-c.halfX, Math.min(local.x, c.halfX));
        const dz = local.z - Math.max(-c.halfZ, Math.min(local.z, c.halfZ));
        return dx * dx + dz * dz < radius * radius;
      });
    }

    function distanceToNearestBuilding(x, z, maxDistance) {
      let best = maxDistance;
      forEachColliderIn(x - maxDistance, z - maxDistance, x + maxDistance, z + maxDistance, (c) => {
        if (!blocksSight(c)) return;
        let d;
        if (c.shape === "cylinder") {
          d = Math.hypot(x - c.cx, z - c.cz) - c.radius;
        } else {
          const local = toLocal(c, x, z);
          d = Math.hypot(local.x - Math.max(-c.halfX, Math.min(local.x, c.halfX)), local.z - Math.max(-c.halfZ, Math.min(local.z, c.halfZ)));
        }
        if (d < best) best = d;
      });
      return Math.max(0, best);
    }

    function colliderMaterial(c, ny) {
      if (c.fx) return c.fx;
      if (c.glass) return "glass";
      if (c.isTree) return "wood";
      if (c.vehicle) return c.vehicleCabin && Math.abs(ny) < 0.5 ? "glass" : "metal";
      if (c.seeThrough) return "metal";
      if (c.style === "house") return "plaster";
      return "concrete";
    }

    const RAY_STEP_M = 14;
    function raycast(ox, oy, oz, dx, dy, dz, maxDistance = 150) {
      let best = maxDistance, hit = null;
      if (dy < -1e-4) {
        let t = (oy - groundHeightAt(ox, oz)) / -dy;
        for (let i = 0; i < 3 && t > 0; i++) t = (oy - groundHeightAt(ox + dx * t, oz + dz * t)) / -dy;
        if (t > 0 && t < best) { best = t; hit = { distance: t, nx: 0, ny: 1, nz: 0, ground: true }; }
      }
      const test = (c) => {
        if (c.noImpact) return;
        const a = toLocal(c, ox, oz);
        const ldx = dx * c.cos - dz * c.sin, ldz = dx * c.sin + dz * c.cos;
        const bottom = c.base !== undefined ? c.base : (c.groundY !== undefined ? c.groundY : -2);
        if (c.shape === "cylinder") {
          const qa = ldx * ldx + ldz * ldz;
          if (qa < 1e-9) return;
          const qb = 2 * (a.x * ldx + a.z * ldz), qc = a.x * a.x + a.z * a.z - c.radius * c.radius;
          const disc = qb * qb - 4 * qa * qc;
          if (disc < 0 || qc <= 0) return;
          const t = (-qb - Math.sqrt(disc)) / (2 * qa);
          if (t <= 0 || t >= best) return;
          const y = oy + dy * t;
          if (y < bottom || y > (c.isTree ? Math.min(c.height, 2.8) : c.height)) return;
          const hx = ox + dx * t - c.cx, hz = oz + dz * t - c.cz, hl = Math.hypot(hx, hz) || 1;
          best = t;
          hit = { distance: t, nx: hx / hl, ny: 0, nz: hz / hl, collider: c };
          return;
        }
        let t0 = -Infinity, t1 = Infinity, axis = -1, sign = 0;
        const slab = (o, d, lo, hi, ax) => {
          if (Math.abs(d) < 1e-12) return o >= lo && o <= hi;
          let ta = (lo - o) / d, tb = (hi - o) / d, s = -1;
          if (ta > tb) { const tmp = ta; ta = tb; tb = tmp; s = 1; }
          if (ta > t0) { t0 = ta; axis = ax; sign = s; }
          if (tb < t1) t1 = tb;
          return t0 <= t1;
        };
        if (!slab(a.x, ldx, -c.halfX, c.halfX, 0) || !slab(a.z, ldz, -c.halfZ, c.halfZ, 2) || !slab(oy, dy, bottom, c.height, 1)) return;
        if (t0 <= 0 || t0 >= best) return;
        let nx = 0, ny = 0, nz = 0;
        if (axis === 1) ny = sign;
        else if (axis === 0) { nx = sign * c.cos; nz = -sign * c.sin; }
        else { nx = sign * c.sin; nz = sign * c.cos; }
        best = t0;
        hit = { distance: t0, nx, ny, nz, collider: c };
      };
      for (let s = 0; s < best; s += RAY_STEP_M) {
        const e = Math.min(best, s + RAY_STEP_M);
        const x1 = ox + dx * s, z1 = oz + dz * s, x2 = ox + dx * e, z2 = oz + dz * e;
        forEachColliderIn(Math.min(x1, x2) - 0.5, Math.min(z1, z2) - 0.5, Math.max(x1, x2) + 0.5, Math.max(z1, z2) + 0.5, test);
        if (hit && hit.distance <= e) break;
      }
      if (!hit) return null;
      hit.x = ox + dx * hit.distance;
      hit.y = oy + dy * hit.distance;
      hit.z = oz + dz * hit.distance;
      hit.material = hit.collider ? colliderMaterial(hit.collider, hit.ny) : (groundMaterialAt ? groundMaterialAt(hit.x, hit.z, hit.y) : "grass");
      return hit;
    }

    function minimapFootprints() {
      const out = [];
      forEachColliderIn(bounds.minX - margin, bounds.minZ - margin, bounds.maxX + margin, bounds.maxZ + margin, (c) => { if (blocksSight(c)) out.push(c); return false; });
      return out;
    }

    return {
      addCollider, forEachColliderIn, resolveCircle, supportHeightAt, segmentBlocked, isWalkable, raycast,
      distanceToNearestBuilding, blocksSight, minimapFootprints,
    };
  }

  // Parked-car hitboxes + the zombie car-climb records, built from the
  // vehicle system's cars exactly like campus-world.js does.
  function createCarQueries(vehicleSystem, queries) {
    const colliders = [];
    const carRecords = [];
    const CAR_BUCKET_M = 16;
    const carBuckets = new Map();
    if (vehicleSystem) {
      vehicleSystem.cars.forEach((car, id) => {
        const m = car.m;
        const fx = Math.cos(car.yaw), fz = Math.sin(car.yaw);
        const bodyTop = car.y + Math.max(m.belt[0], m.belt[1]);
        const body = makeCollider(car.x, car.z, m.L / 2, m.W / 2, bodyTop, -car.yaw);
        const cabFront = m.cowl[0], cabBack = m.cls === "pickup" ? m.roofEnd : m.deck[0];
        const cabMid = m.L / 2 - (cabFront + cabBack) / 2;
        const cabin = makeCollider(car.x + fx * cabMid, car.z + fz * cabMid, (cabBack - cabFront) / 2, m.W * 0.45, car.y + m.H, -car.yaw);
        for (const c of [body, cabin]) {
          c.render = false; c.seeThrough = true; c.vehicle = true; c.groundY = car.y;
          colliders.push(c);
          queries.addCollider(c);
        }
        cabin.vehicleCabin = true;
        const rec = {
          id, name: car.name, cls: m.cls, x: car.x, z: car.z, yaw: car.yaw, fx, fz, halfL: m.L / 2, halfW: m.W / 2,
          groundY: car.y, bodyTop, roofY: car.y + m.H, climbers: 0, slots: null,
        };
        carRecords.push(rec);
        const reach = rec.halfL + 1;
        for (let bx = Math.floor((rec.x - reach) / CAR_BUCKET_M); bx <= Math.floor((rec.x + reach) / CAR_BUCKET_M); bx++) {
          for (let bz = Math.floor((rec.z - reach) / CAR_BUCKET_M); bz <= Math.floor((rec.z + reach) / CAR_BUCKET_M); bz++) {
            const key = bx + "," + bz;
            (carBuckets.get(key) || carBuckets.set(key, []).get(key)).push(rec);
          }
        }
      });
    }
    function carAt(x, z, pad = 0) {
      const list = carBuckets.get(Math.floor(x / CAR_BUCKET_M) + "," + Math.floor(z / CAR_BUCKET_M));
      if (!list) return null;
      for (const c of list) {
        const dx = x - c.x, dz = z - c.z;
        if (Math.abs(dx * c.fx + dz * c.fz) <= c.halfL + pad && Math.abs(-dx * c.fz + dz * c.fx) <= c.halfW + pad) return c;
      }
      return null;
    }
    function carClimbSlots(c) {
      if (c.slots) return c.slots;
      const slots = [];
      const add = (side, u, v, nu, nv) => {
        const nx = nu * c.fx + nv * -c.fz, nz = nu * c.fz + nv * c.fx;
        slots.push({ side, u, v, nx, nz, ex: c.x + u * c.fx + v * -c.fz, ez: c.z + u * c.fz + v * c.fx, owner: null });
      };
      for (const v of [-0.4, 0.4]) { add("front", c.halfL, v * c.halfW, 1, 0); add("rear", -c.halfL, v * c.halfW, -1, 0); }
      for (const u of [-0.55, 0, 0.55]) { add("right", u * c.halfL, c.halfW, 0, 1); add("left", u * c.halfL, -c.halfW, 0, -1); }
      c.slots = slots;
      return slots;
    }
    function clampToCarTop(c, pos, inset) {
      const dx = pos.x - c.x, dz = pos.z - c.z;
      let u = dx * c.fx + dz * c.fz, v = -dx * c.fz + dz * c.fx;
      const hu = Math.max(0.1, c.halfL - inset), hv = Math.max(0.1, c.halfW - inset);
      u = Math.max(-hu, Math.min(hu, u));
      v = Math.max(-hv, Math.min(hv, v));
      pos.x = c.x + u * c.fx + v * -c.fz;
      pos.z = c.z + u * c.fz + v * c.fx;
    }
    function vehicleBlocksShot(ax, ay, az, bx, by, bz) {
      if (!colliders.length) return false;
      return queries.forEachColliderIn(Math.min(ax, bx), Math.min(az, bz), Math.max(ax, bx), Math.max(az, bz), (c) => {
        if (!c.vehicle) return false;
        const ca = c.cos, sa = c.sin;
        const a = { x: (ax - c.cx) * ca - (az - c.cz) * sa, z: (ax - c.cx) * sa + (az - c.cz) * ca };
        const b = { x: (bx - c.cx) * ca - (bz - c.cz) * sa, z: (bx - c.cx) * sa + (bz - c.cz) * ca };
        let t0 = 0, t1 = 1;
        const clip = (p, q) => {
          if (Math.abs(p) < 1e-12) return q >= 0;
          const r = q / p;
          if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; } else { if (r < t0) return false; if (r < t1) t1 = r; }
          return true;
        };
        const dx = b.x - a.x, dz = b.z - a.z, dy = by - ay;
        return clip(-dx, a.x + c.halfX) && clip(dx, c.halfX - a.x) && clip(-dz, a.z + c.halfZ) && clip(dz, c.halfZ - a.z) &&
          clip(-dy, ay - c.groundY) && clip(dy, c.height - ay) && t0 <= t1;
      });
    }
    return { carRecords, carAt, carClimbSlots, clampToCarTop, vehicleBlocksShot, colliders };
  }

  window.createColliderQueries = createColliderQueries;
  window.createCarQueries = createCarQueries;
  window.worldColliderKit = { makeCollider, makeCylinderCollider };
})();
