// First-person bare hands: what a player sees when their active weapon
// slot is empty. Two jointed human hands on forearms that run off the
// bottom of the screen -- palm, thenar pad, five articulated fingers
// (three segments each, the thumb its own opposable chain) -- built from
// rounded, tapered segments rather than one mesh, so fingers can
// actually curl into a fist. Purely visual: index.html feeds update()
// the player's movement/melee state every frame; nothing here decides
// gameplay.
//
// Usage: const hands = createFirstPersonHands(THREE, { material });
//   viewModelRoot.add(hands.group);        // origin = camera space (see rootOffset)
//   hands.show();                          // eases up into view
//   hands.update(dt, state);               // see update() for `state`
//
// SPACE: each arm is posed in "right-hand space" -- camera space for the
// right arm (+X right, +Y up, looking down -Z). The left arm is the same
// rig under a group mirrored in X, so its poses use the same numbers
// (deliberately NOT identical ones -- see READY_L etc.) and come out as a
// mirror image. Hand frame at the wrist: fingers along -Z, back of the
// hand +Y, palm -Y, thumb on -X.
//
// POSE: { w: wrist position [x,y,z], yaw/pitch: forearm direction (yaw >0
// angles it inward, pitch >0 up), roll: forearm twist (0 = palm down),
// flex/dev: wrist bend (flex <0 bends the hand toward the palm) and side
// deviation, curl[4]: index..pinky, 0 = relaxed, 1 = fist, thumb: 0..1
// relaxed..across the fist, spread: finger splay }. The elbow is placed
// FOREARM behind the wrist along that direction, so forearm length never
// changes and the hand never detaches from it.
(function () {
  "use strict";

  function createFirstPersonHands(THREE, options) {
    const material = options.material;
    const FOREARM = 0.25; // m, elbow to wrist

    const FOREARM_UPPER_LEN = 0.5; // m of upper arm drawn back from the elbow -- always runs off-screen
    const skinMaterial = material.clone();
    skinMaterial.skinning = true;
    skinMaterial.vertexColors = true; // crease/knuckle/nail tints (see skinTint)

    // ---------------------------------------------------------------- skinned mesh
    // Each arm -- upper arm, forearm, palm, fingers and thumb -- is ONE
    // skinned mesh, so the skin bends smoothly through every joint instead
    // of showing separate pieces: each ring of vertices near a joint is
    // weighted across the two bones it sits between. Built in the bind
    // pose: every joint at rest (fingers and thumb straight out along -Z),
    // the upper arm and forearm in one straight line through the elbow.
    const smooth01 = (x) => { const c = Math.max(0, Math.min(1, x)); return c * c * (3 - 2 * c); };
    function meshBuilder() { return { pos: [], idx: [], si: [], sw: [], col: [] }; }
    const WHITE = [1, 1, 1];
    // col: a tint multiplied into the skin color (creases, knuckles, nails).
    function pushVertex(g, x, y, z, w, col = WHITE) {
      g.pos.push(x, y, z);
      g.col.push(col[0], col[1], col[2]);
      const a = w[0], b = w[1] || [a[0], 0];
      g.si.push(a[0], b[0], 0, 0);
      g.sw.push(a[1], b[1], 0, 0);
    }
    // Weights along a limb: `joints` = [{ at, b (half-width of the blend), bone }]
    // in order; before the first joint the limb belongs to `firstBone`.
    function limbWeights(firstBone, joints) {
      return (s) => {
        let bone = firstBone;
        for (const j of joints) {
          if (s < j.at - j.b) return [[bone, 1]];
          if (s <= j.at + j.b) {
            const t = smooth01((s - (j.at - j.b)) / (2 * j.b));
            return [[bone, 1 - t], [j.bone, t]];
          }
          bone = j.bone;
        }
        return [[bone, 1]];
      };
    }
    // A tube from (x0, y0, z0) along +Z (dir 1) or -Z (dir -1): rings
    // [s (distance along), radius, sx (width), sy (thickness)], rounded
    // caps on both ends; weights(s) skins each ring. detail(s, dors, lat),
    // optional, returns [radius offset, tint] per vertex -- dors is +1 on
    // the back of the limb (+Y) and -1 on the palm side, lat the side
    // component -- or null for none.
    function tube(g, x0, y0, z0, dir, rings, weights, radial = 10, capSteps = 4, detail = null) {
      const all = [];
      const first = rings[0], last = rings[rings.length - 1];
      for (let i = 0; i < capSteps; i++) {
        const phi = (Math.PI / 2) * (i / capSteps);
        all.push([first[0] - first[1] * Math.cos(phi), Math.max(1e-4, first[1] * Math.sin(phi)), first[2], first[3], first[0]]);
      }
      for (const r of rings) all.push([r[0], r[1], r[2], r[3], r[0]]);
      for (let i = capSteps - 1; i >= 0; i--) {
        const phi = (Math.PI / 2) * (i / capSteps);
        all.push([last[0] + last[1] * Math.cos(phi), Math.max(1e-4, last[1] * Math.sin(phi)), last[2], last[3], last[0]]);
      }
      const base = g.pos.length / 3;
      for (let ri = 0; ri < all.length; ri++) {
        const [along, r, sx, sy, ws] = all[ri];
        const w = weights(ws);
        const onCap = ri < capSteps || ri >= all.length - capSteps;
        for (let k = 0; k < radial; k++) {
          const a = (k / radial) * Math.PI * 2;
          const cos = Math.cos(a), sin = Math.sin(a);
          const d = detail ? detail(ws, sin, cos) : null; // caps take the end ring's tint, not its shape
          const rr = d && !onCap ? r + d[0] : r;
          pushVertex(g, x0 + cos * rr * sx, y0 + sin * rr * sy, z0 + dir * along, w, d ? d[1] : WHITE);
        }
      }
      for (let i = 0; i < all.length - 1; i++) {
        for (let k = 0; k < radial; k++) {
          const a = base + i * radial + k, b = base + i * radial + ((k + 1) % radial);
          const c = a + radial, d = b + radial;
          if (dir < 0) g.idx.push(a, c, b, b, c, d);
          else g.idx.push(a, b, c, b, d, c);
        }
      }
    }
    // Radius profile through [s, r] keys (linear), with a slight swelling
    // at each joint the way real finger joints are a touch thicker.
    function profile(keys, jointsAt, bulge) {
      return (s) => {
        let r = keys[keys.length - 1][1];
        for (let i = 0; i < keys.length - 1; i++) {
          if (s <= keys[i + 1][0]) {
            const t = (s - keys[i][0]) / (keys[i + 1][0] - keys[i][0]);
            r = keys[i][1] + (keys[i + 1][1] - keys[i][1]) * Math.max(0, Math.min(1, t));
            break;
          }
        }
        for (const j of jointsAt) r *= 1 + bulge * Math.exp(-(((s - j) / 0.005) ** 2));
        return r;
      };
    }
    // A rounded box (superellipsoid) centered at c, half extents h,
    // squareness p (1 = ellipsoid, lower = boxier), optional shape(v)
    // nudge (which may return a tint for the vertex) and Y rotation;
    // weigh(v) skins each vertex (v in the same space as c). res:
    // [around, down] sphere segments; poleZ puts the sphere's poles at
    // the blob's ends in Z, so its broad top and bottom get the even
    // vertex spacing instead of pinched poles.
    function blob(g, c, h, p, weigh, shape, rotY = 0, res = [28, 20], poleZ = false) {
      const sphere = new THREE.SphereGeometry(1, res[0], res[1]);
      const pos = sphere.attributes.position;
      const base = g.pos.length / 3;
      const v = new THREE.Vector3(), yAxis = new THREE.Vector3(0, 1, 0);
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i);
        if (poleZ) v.set(v.x, -v.z, v.y);
        v.set(Math.sign(v.x) * Math.pow(Math.abs(v.x), p) * h[0], Math.sign(v.y) * Math.pow(Math.abs(v.y), p) * h[1], Math.sign(v.z) * Math.pow(Math.abs(v.z), p) * h[2]);
        const tint = shape ? shape(v) : null;
        if (rotY) v.applyAxisAngle(yAxis, rotY);
        v.add(c);
        pushVertex(g, v.x, v.y, v.z, weigh(v), tint || WHITE);
      }
      for (const i of sphere.index.array) g.idx.push(base + i);
      sphere.dispose();
    }
    // Normals averaged across vertices that share a position (sphere
    // seams, tube poles), so no shading seam shows where they meet.
    function smoothSharedNormals(geometry) {
      const pos = geometry.attributes.position, nrm = geometry.attributes.normal;
      const sums = new Map();
      const key = (i) => `${Math.round(pos.getX(i) * 1e5)},${Math.round(pos.getY(i) * 1e5)},${Math.round(pos.getZ(i) * 1e5)}`;
      for (let i = 0; i < pos.count; i++) {
        const k = key(i);
        const acc = sums.get(k) || [0, 0, 0];
        acc[0] += nrm.getX(i); acc[1] += nrm.getY(i); acc[2] += nrm.getZ(i);
        sums.set(k, acc);
      }
      for (let i = 0; i < pos.count; i++) {
        const acc = sums.get(key(i));
        const len = Math.hypot(acc[0], acc[1], acc[2]) || 1;
        nrm.setXYZ(i, acc[0] / len, acc[1] / len, acc[2] / len);
      }
    }

    // Ring list resampled `sub` times finer along a Catmull-Rom curve
    // through every column, so a limb's silhouette bends smoothly instead
    // of kinking at each hand-placed ring.
    function smoothRings(rings, sub) {
      const out = [];
      const at = (i) => rings[Math.max(0, Math.min(rings.length - 1, i))];
      for (let i = 0; i < rings.length - 1; i++) {
        const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
        for (let k = 0; k < sub; k++) {
          const t = k / sub, t2 = t * t, t3 = t2 * t;
          out.push(p1.map((_, c) => 0.5 * (2 * p1[c] + (p2[c] - p0[c]) * t + (2 * p0[c] - 5 * p1[c] + 4 * p2[c] - p3[c]) * t2 + (3 * p1[c] - p0[c] - 3 * p2[c] + p3[c]) * t3)));
        }
      }
      out.push(rings[rings.length - 1].slice());
      return out;
    }
    // Sample positions from s0 to s1: `step` apart, packed `fine` apart
    // within `half` of each of `dense` (where creases need the rings).
    function ringStations(s0, s1, step, dense, half = 0.0045, fine = 0.0006) {
      const out = [];
      let s = s0;
      while (s < s1) {
        out.push(s);
        s += dense.some((d) => Math.abs(s - d) < half) ? fine : step;
      }
      return out;
    }

    // ---------------------------------------------------------------- skin detail
    // Tints multiplied into the skin color: `dark` for creases, `red` for
    // knuckles, fingertips and palms (blood closer to the surface), `nail`
    // and `edge` for the nail plate and its paler free edge.
    const gauss = (x) => Math.exp(-x * x);
    function skinTint(dark, red, nail = 0, edge = 0, palm = 0) {
      const k = 1 - Math.min(0.6, dark);
      return [
        k * (1 + 0.07 * nail + 0.1 * edge + 0.03 * palm),
        k * (1 - red) * (1 + 0.06 * nail + 0.2 * edge),
        k * (1 - 1.35 * red) * (1 + 0.24 * nail + 0.4 * edge - 0.02 * palm),
      ];
    }
    // A finger or thumb: flexion creases on the palm side, wrinkles over
    // the knuckle on the back, a nail plate with its cuticle and side
    // grooves, and redder pads and knuckles. s runs from the base joint;
    // l = segment lengths; creases/wrinkles: s positions.
    function digitDetail(l, creases, wrinkles, knuckle) {
      const total = l[0] + l[1] + l[2], dip = l[0] + l[1];
      const nailStart = total - l[2] * 0.62, nailEnd = total - 0.0006;
      return (s, dors) => {
        const palm = Math.max(0, -dors), back = Math.max(0, dors);
        let dr = 0, dark = 0, red = 0;
        for (const at of creases) {
          const k = gauss((s - at) / 0.0009) * palm * palm;
          dr -= 0.0006 * k; dark += 0.28 * k;
        }
        for (const [at, depth] of wrinkles) {
          const k = gauss((s - at) / 0.00055) * back * back * depth;
          dr -= 0.00022 * k; dark += 0.13 * k;
        }
        red += 0.07 * gauss((s - knuckle) / 0.0045) * back;
        red += 0.05 * smooth01((s - dip) / l[2]) * (0.4 + 0.6 * palm); // pinker toward the tip, most on the pad
        // Nail: a flatter, slightly raised plate on the back of the last
        // segment, a cuticle line at its base and grooves down its sides.
        const across = smooth01((dors - 0.5) / 0.16);
        const along = smooth01((s - nailStart) / 0.0012) * smooth01((nailEnd - s) / 0.0008);
        const nail = along * across;
        const edge = nail * smooth01((s - (total - 0.0022)) / 0.0012);
        dr += nail * (0.00012 - 0.0011 * (dors - 0.55) ** 2);
        const inRange = s > nailStart - 0.002 && s < nailEnd;
        dark += 0.22 * gauss((s - nailStart) / 0.0006) * across; // cuticle
        if (inRange) dark += 0.16 * gauss((dors - 0.5) / 0.07) * smooth01((s - nailStart) / 0.001);
        red *= 1 - nail;
        return [dr, skinTint(dark, red, nail, edge, palm)];
      };
    }
    // Distance from (x, z) to a polyline [[x, z], ...].
    function polylineDistance(x, z, pts) {
      let best = Infinity;
      for (let i = 0; i < pts.length - 1; i++) {
        const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
        const dx = bx - ax, dz = bz - az;
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
        best = Math.min(best, Math.hypot(x - ax - dx * t, z - az - dz * t));
      }
      return best;
    }
    // Palm lines in the palm blob's own space (x: thumb side -, z:
    // knuckles -0.047 .. heel +0.047): heart, head and life lines.
    const PALM_LINES = [
      [[0.036, -0.021], [0.018, -0.026], [0.0, -0.031], [-0.013, -0.038]],
      [[-0.033, -0.019], [-0.012, -0.014], [0.008, -0.008], [0.026, 0.001]],
      [[-0.033, -0.019], [-0.025, -0.008], [-0.019, 0.008], [-0.016, 0.026], [-0.017, 0.042]],
    ];

    // ---------------------------------------------------------------- anatomy
    // Knuckle (MCP) positions fan along a slight arc -- middle furthest
    // forward, pinky set back and a touch lower; lengths vary finger to
    // finger (middle longest, pinky much shorter). [x, y, z].
    const FINGERS = [
      { name: "index",  mcp: [-0.0265, 0.0025, -0.0915], len: [0.041, 0.025, 0.020], r: [0.0098, 0.0089, 0.0080, 0.0068], splay: 0.07 },
      { name: "middle", mcp: [-0.0078, 0.0035, -0.0965], len: [0.046, 0.028, 0.022], r: [0.0102, 0.0092, 0.0083, 0.0070], splay: 0.0 },
      { name: "ring",   mcp: [0.0108, 0.0025, -0.0935], len: [0.043, 0.026, 0.021], r: [0.0095, 0.0086, 0.0078, 0.0066], splay: -0.06 },
      { name: "pinky",  mcp: [0.0275, -0.0005, -0.0855], len: [0.033, 0.020, 0.018], r: [0.0084, 0.0076, 0.0069, 0.0059], splay: -0.14 },
    ];
    // Joint flexion (radians, toward the palm) relaxed -> fist, per finger.
    // Relaxed cascades: index nearly straight, pinky most curled.
    const RELAXED = { mcp: [0.26, 0.34, 0.44, 0.54], pip: [0.42, 0.52, 0.6, 0.68], dip: [0.2, 0.26, 0.3, 0.34] };
    const FIST = { mcp: [1.38, 1.46, 1.52, 1.58], pip: [1.78, 1.84, 1.84, 1.8], dip: [0.86, 0.9, 0.94, 0.95] };
    // Thumb: base (CMC) on the heel of the palm, thumb side.
    const THUMB = { cmc: [-0.0255, -0.0065, -0.0195], len: [0.042, 0.031, 0.026], r: [0.0138, 0.0116, 0.0104, 0.0086] };
    // [yaw, pitch, roll] at the CMC (Euler YXZ), then MCP and IP flexion
    // (rolled ~90 deg, so negative flexion curls it across the palm).
    // Relaxed: out beside the index finger, pad turned toward it. Fist:
    // folded down across the front of the index and middle fingers.
    // Fitted numerically: the fist against target joint positions (IP
    // over the index finger, tip over the middle one, resting on them),
    // the relaxed pose so that the whole closing path -- fingers leading,
    // thumb folding over last -- stays clear of the fingers.
    const THUMB_RELAXED = { cmc: [0.787, -0.697, -0.644], mcp: -0.414, ip: 0.105 };
    const THUMB_FIST = { cmc: [0.157, -0.811, -1.432], mcp: -0.146, ip: -1.137 };

    // One arm's skinned geometry (bone indices through I); built once and
    // shared by both arms.
    let armGeometry = null;
    function buildArmGeometry(I, bones) {
      const { upperArm, forearm, wrist, fingers, cmc, tmcp, tip } = bones;
      const g = meshBuilder();
      const W = -FOREARM; // the wrist's z in the bind pose
      // Upper arm, from the elbow back past the shoulder; shares the elbow
      // with the forearm (both halves weighted across it).
      const elbowBlend = 0.035;
      tube(g, 0, 0, 0, 1, smoothRings([[0, 0.041, 1.04, 0.96], [0.06, 0.043, 1.05, 0.97], [0.2, 0.047, 1.06, 0.98], [FOREARM_UPPER_LEN, 0.05, 1.06, 0.98]], 2),
        (s) => { const t = 0.5 + 0.5 * smooth01(s / elbowBlend); return [[I(upperArm), t], [I(forearm), 1 - t]]; }, 18);
      // Forearm into the wrist and on into the heel of the palm: thick below
      // the elbow, slimming and flattening to the wrist, then widening again,
      // with two faint creases across the inside of the wrist.
      const WRIST_CREASES = [FOREARM - 0.006, FOREARM - 0.0015];
      const forearmRings = smoothRings([
        [0, 0.041, 1.04, 0.96], [0.03, 0.041, 1.06, 0.95], [0.08, 0.038, 1.08, 0.93], [0.13, 0.033, 1.12, 0.9],
        [0.18, 0.028, 1.15, 0.86], [0.225, 0.0245, 1.18, 0.82], [0.25, 0.0235, 1.25, 0.76], [0.265, 0.025, 1.36, 0.68], [0.282, 0.026, 1.42, 0.64],
      ], 4);
      // Extra rings through the creases, interpolated between their neighbours.
      for (const c of WRIST_CREASES) {
        for (let k = -2; k <= 2; k++) {
          const at = c + k * 0.0008;
          const i = forearmRings.findIndex((ring) => ring[0] > at);
          const a = forearmRings[i - 1], b = forearmRings[i], t = (at - a[0]) / (b[0] - a[0]);
          forearmRings.splice(i, 0, a.map((v, j) => v + (b[j] - v) * t));
        }
      }
      tube(g, 0, 0, 0, -1, forearmRings, (s) => {
        if (s < elbowBlend) { const t = 0.5 + 0.5 * smooth01(s / elbowBlend); return [[I(forearm), t], [I(upperArm), 1 - t]]; }
        return limbWeights(I(forearm), [{ at: FOREARM, b: 0.014, bone: I(wrist) }])(s);
      }, 24, 4, (s, dors) => {
        const palm = Math.max(0, -dors) ** 2;
        const k = (gauss((s - WRIST_CREASES[0]) / 0.0009) + 0.8 * gauss((s - WRIST_CREASES[1]) / 0.0009)) * palm;
        return k > 0.01 ? [-0.0004 * k, skinTint(0.2 * k, 0)] : null;
      });
      // Palm: narrower at the heel, a slight arch across the back. Its
      // front edge bends a little with each finger (knuckles), its heel a
      // little with the forearm.
      blob(g, new THREE.Vector3(-0.001, 0, W - 0.048), [0.037, 0.0145, 0.047], 0.55, (v) => {
        const lz = v.z - W;
        if (lz < -0.07) {
          let best = null, bestD = Infinity;
          FINGERS.forEach((f, i) => { const d = Math.abs(v.x - f.mcp[0]); if (d < bestD) { bestD = d; best = i; } });
          const w = 0.55 * Math.max(0, 1 - bestD / 0.013) * smooth01((-0.07 - lz) / 0.022);
          return [[I(wrist), 1 - w], [I(fingers[best].mcp), w]];
        }
        if (lz > -0.014) {
          const w = 0.35 * smooth01((lz + 0.014) / 0.02);
          return [[I(wrist), 1 - w], [I(forearm), w]];
        }
        return [[I(wrist), 1]];
      }, (v) => {
        const t = (v.z + 0.047) / 0.094; // 0 at the knuckles, 1 at the heel
        v.x *= 1 - 0.13 * t;
        if (v.y > 0) v.y += 0.0035 * (1 - (v.x / 0.037) ** 2);
        // Back of the hand: a raised knuckle over each finger, and the
        // extensor tendons fanning back from them toward the wrist.
        let red = 0, dark = 0;
        const top = smooth01(v.y / 0.008);
        if (top > 0) {
          FINGERS.forEach((f) => {
            const kx = f.mcp[0] + 0.001, kz = f.mcp[2] + 0.048;
            const bump = gauss((v.x - kx) / 0.0058) * gauss((v.z - kz - 0.004) / 0.0065) * top;
            v.y += 0.0019 * bump;
            red += 0.06 * bump;
            const d = polylineDistance(v.x, v.z, [[kx, kz + 0.004], [kx * 0.4, 0.04]]);
            v.y += 0.00055 * gauss(d / 0.0022) * smooth01((0.04 - v.z) / 0.05) * top;
          });
        }
        // Palm: slightly pinker, with its three main lines.
        const under = smooth01(-v.y / 0.008);
        if (under > 0) {
          let line = 0;
          for (const pts of PALM_LINES) line = Math.max(line, gauss(polylineDistance(v.x, v.z, pts) / 0.0017));
          v.y += 0.0005 * line * under;
          dark += 0.22 * line * under;
          red += 0.03 * under;
        }
        return skinTint(dark, red, 0, 0, under);
      }, 0, [72, 44], true);
      // Thenar pad (the fleshy base of the thumb), moving partly with it.
      blob(g, new THREE.Vector3(-0.021, -0.0065, W - 0.034), [0.0145, 0.0115, 0.026], 0.9, (v) => {
        const w = 0.45 * smooth01((-(v.z - W) - 0.02) / 0.03);
        return [[I(wrist), 1 - w], [I(cmc), w]];
      }, null, 0.35);
      // Hypothenar edge along the pinky side.
      blob(g, new THREE.Vector3(0.029, -0.004, W - 0.04), [0.009, 0.0105, 0.03], 0.9, () => [[I(wrist), 1]]);
      // Fingers: one tube each from inside the palm to the tip.
      FINGERS.forEach((f, i) => {
        const [l0, l1, l2] = f.len, total = l0 + l1 + l2;
        const r = profile([[-0.012, f.r[0] * 1.05], [0, f.r[0]], [l0, f.r[1]], [l0 + l1, f.r[2]], [total, f.r[3]]], [l0, l0 + l1], 0.06);
        // Palm side: the crease where the finger meets the palm, a double
        // one at the middle joint, one at the end joint. Back: wrinkles
        // over the middle knuckle, fainter ones over the end joint.
        const creases = [0.42 * l0, l0 - 0.0012, l0 + 0.001, l0 + l1 + 0.0004];
        const wrinkles = [[l0 - 0.0034, 0.7], [l0 - 0.0017, 1], [l0, 1], [l0 + 0.0016, 0.8], [l0 + l1 - 0.0008, 0.6], [l0 + l1 + 0.0007, 0.5]];
        const rings = ringStations(-0.012, total, 0.0022, [...creases, l0, l0 + l1, total - l2 * 0.62])
          .map((s2) => [s2, r(s2), 1.0, 0.9 - 0.04 * Math.max(0, s2 - l0 - l1) / l2]);
        rings.push([total, f.r[3], 1.0, 0.86]);
        const fb = fingers[i];
        tube(g, f.mcp[0], f.mcp[1], W + f.mcp[2], -1, rings, limbWeights(I(wrist), [
          { at: 0, b: f.r[0] * 0.75, bone: I(fb.mcp) },
          { at: l0, b: f.r[1] * 0.6, bone: I(fb.pip) },
          { at: l0 + l1, b: f.r[2] * 0.55, bone: I(fb.dip) },
        ]), 16, 7, digitDetail(f.len, creases, wrinkles, l0));
      });
      // Thumb: grows out of the thenar pad.
      {
        const [l0, l1, l2] = THUMB.len, total = l0 + l1 + l2;
        const r = profile([[-0.014, 0.014], [0, THUMB.r[0]], [l0, THUMB.r[1]], [l0 + l1, THUMB.r[2]], [total, THUMB.r[3]]], [l0, l0 + l1], 0.05);
        // Creases at its two joints on the pad side, wrinkles over the
        // end joint on the back.
        const creases = [l0 - 0.001, l0 + l1 - 0.0008, l0 + l1 + 0.0012];
        const wrinkles = [[l0 + l1 - 0.0028, 0.7], [l0 + l1 - 0.0011, 1], [l0 + l1 + 0.0006, 0.9], [l0 + l1 + 0.0022, 0.6], [l0, 0.5]];
        const rings = ringStations(-0.014, total, 0.0024, [...creases, l0 + l1, total - l2 * 0.62])
          .map((s2) => [s2, r(s2), 1.05, 0.92 - 0.06 * Math.max(0, s2 - l0 - l1) / l2]);
        rings.push([total, THUMB.r[3], 1.05, 0.86]);
        tube(g, THUMB.cmc[0], THUMB.cmc[1], W + THUMB.cmc[2], -1, rings, limbWeights(I(wrist), [
          { at: 0, b: 0.009, bone: I(cmc) },
          { at: l0, b: THUMB.r[1] * 0.6, bone: I(tmcp) },
          { at: l0 + l1, b: THUMB.r[2] * 0.55, bone: I(tip) },
        ]), 16, 7, digitDetail(THUMB.len, creases, wrinkles, l0 + l1));
      }

      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(g.pos, 3));
      geometry.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(g.si, 4));
      geometry.setAttribute("skinWeight", new THREE.Float32BufferAttribute(g.sw, 4));
      geometry.setAttribute("color", new THREE.Float32BufferAttribute(g.col, 3));
      geometry.setIndex(g.idx);
      geometry.computeVertexNormals();
      smoothSharedNormals(geometry);
      return geometry;
    }

    // shoulder: where this arm's upper arm heads back to (right-hand space,
    // behind and below the camera -- never on screen).
    function buildArm(mirrored, shoulder) {
      const side = new THREE.Group();
      if (mirrored) side.scale.x = -1;
      const bones = [];
      const bone = (parent, x, y, z) => {
        const b = new THREE.Bone();
        b.position.set(x, y, z);
        (parent || side).add(b);
        bones.push(b);
        return b;
      };
      const upperArm = bone(null, 0, 0, 0); // at the elbow, +Z back toward the shoulder
      const forearm = bone(null, 0, 0, 0);  // at the elbow, -Z toward the wrist
      const wrist = bone(forearm, 0, 0, -FOREARM);
      wrist.rotation.order = "YXZ";
      const fingers = FINGERS.map((f) => {
        const mcp = bone(wrist, ...f.mcp);
        const pip = bone(mcp, 0, 0, -f.len[0]);
        const dip = bone(pip, 0, 0, -f.len[1]);
        return { mcp, pip, dip };
      });
      const cmc = bone(wrist, ...THUMB.cmc);
      cmc.rotation.order = "YXZ";
      const tmcp = bone(cmc, 0, 0, -THUMB.len[0]);
      const tip = bone(tmcp, 0, 0, -THUMB.len[1]);
      const I = (b) => bones.indexOf(b);

      // Both arms share one geometry (same bones in the same order; the
      // left is just mirrored by its group), so it's built once.
      const geometry = armGeometry || (armGeometry = buildArmGeometry(I, { upperArm, forearm, wrist, fingers, cmc, tmcp, tip }));
      const mesh = new THREE.SkinnedMesh(geometry, skinMaterial);
      mesh.frustumCulled = false; // its bind-pose bounds don't follow the bones
      side.add(mesh);
      side.updateMatrixWorld(true);
      mesh.bind(new THREE.Skeleton(bones));
      return { side, mesh, upperArm, forearm, shoulder: new THREE.Vector3(...shoulder), hand: { wrist, fingers, thumb: { cmc, mcp: tmcp, ip: tip } } };
    }

    // ---------------------------------------------------------------- poses
    const pose = (w, yaw, pitch, roll, flex, dev, curl, thumb, spread) => ({ w, yaw, pitch, roll, flex, dev, curl, thumb, spread });
    // Ready: forearms rising in from the bottom corners, hands loose, palms
    // turned in -- each side a little different (height, depth, angles).
    const READY_R = pose([0.150, -0.172, -0.372], 0.36, 0.42, -0.95, -0.22, 0.10, [0.10, 0.06, 0.14, 0.20], 0.08, 0.55);
    const READY_L = pose([0.138, -0.186, -0.352], 0.42, 0.36, -1.05, -0.30, 0.06, [0.06, 0.12, 0.18, 0.24], 0.12, 0.42);
    // Running carriage: a trained distance runner's arm swing, built joint
    // by joint -- shoulder -> upper arm -> elbow -> forearm -> wrist -> hand
    // -- so the hand only ever moves because the arm above it did. Carried
    // low: at a distance pace only the knuckles reach the bottom edge of the
    // screen at the front of each swing (about 6% of its height at the
    // game's 75 deg FOV) and the wrist never shows; a sprint swings bigger
    // and a little higher (about 13%). Right-hand space; m and radians.
    //   shoulder: the joint -- it travels fore/aft `shoulderTravel` with the
    //     swing (the shoulders' counter-rotation); upper: upper-arm length;
    //   abduct: elbow out from the side; inward: the swing plane turned in
    //     (the hand comes toward the midline in front but never across it,
    //     the elbow drifts out behind); forearmIn: the forearm angled in more;
    //   swing*: upper arm from hanging straight down (+ = forward), mostly
    //     behind the body -- hip to lower chest, not a marching swing;
    //   elbow*: flexion around 90 deg -- closing at the front, opening as the
    //     hand passes the hip; elbowLead: its cycle leads the swing a little;
    //   roll/flex/dev: thumb up, palm in, turning slightly palm-down at the
    //     front; the wrist trails the forearm. Hands loosely cupped.
    const RUN_CARRIAGE = {
      shoulder: [0.17, -0.175, 0.03], upper: 0.27, abduct: 0.14, inward: 0.14, forearmIn: 0.3,
      swingCenter: -0.1, swingAmp: 0.42, elbowCenter: 1.6, elbowAmp: 0.16, elbowLead: 0.5, shoulderTravel: 0.012,
      roll: -1.3, rollAmp: 0.1, flex: -0.06, flexAmp: 0.07, dev: 0.04,
      curl: [0.34, 0.42, 0.5, 0.58], thumb: 0.38, spread: 0.05,
    };
    const SPRINT_CARRIAGE = {
      shoulder: [0.175, -0.215, 0.03], upper: 0.27, abduct: 0.1, inward: 0.08, forearmIn: 0.22,
      swingCenter: -0.1, swingAmp: 0.56, elbowCenter: 1.55, elbowAmp: 0.24, elbowLead: 0.45, shoulderTravel: 0.018,
      roll: -1.35, rollAmp: 0.14, flex: -0.04, flexAmp: 0.1, dev: 0.05,
      curl: [0.4, 0.48, 0.55, 0.62], thumb: 0.42, spread: 0.04,
    };
    // Punch: chambered fist, then the arm driven out to the screen center
    // with the forearm turning palm-down on the way.
    const WINDUP_R = pose([0.166, -0.192, -0.334], 0.33, 0.30, -0.70, 0.0, 0.0, [1, 1, 1, 1], 1, 0);
    const WINDUP_L = pose([0.158, -0.200, -0.326], 0.37, 0.28, -0.78, 0.0, 0.0, [1, 1, 1, 1], 1, 0);
    const IMPACT_R = pose([0.030, -0.070, -0.575], 0.10, 0.10, -0.12, 0.05, -0.05, [1, 1, 1, 1], 1, 0);
    const IMPACT_L = pose([0.040, -0.064, -0.566], 0.12, 0.12, -0.18, 0.04, -0.04, [1, 1, 1, 1], 1, 0);
    // phase: where this arm's swing sits in the gait cycle (arm-leg
    // opposition -- see update()); amp: the left swings a touch smaller.
    const BASES = {
      right: { ready: READY_R, windup: WINDUP_R, impact: IMPACT_R, phase: Math.PI, amp: 1, idle: 0 },
      left: { ready: READY_L, windup: WINDUP_L, impact: IMPACT_L, phase: 0.05, amp: 0.96, idle: 2.3 },
    };

    const clone = (p) => ({ ...p, w: p.w.slice(), curl: p.curl.slice() });
    function lerpPose(a, b, t, out) {
      for (let i = 0; i < 3; i++) out.w[i] = a.w[i] + (b.w[i] - a.w[i]) * t;
      for (const k of ["yaw", "pitch", "roll", "flex", "dev", "thumb", "spread"]) out[k] = a[k] + (b[k] - a[k]) * t;
      for (let i = 0; i < 4; i++) out.curl[i] = a.curl[i] + (b.curl[i] - a.curl[i]) * t;
      return out;
    }
    function approachPose(cur, target, rate, dt) {
      const k = 1 - Math.exp(-rate * dt);
      return lerpPose(cur, target, k, cur);
    }
    const clamp01 = (x) => Math.max(0, Math.min(1, x));
    const smooth = (x) => { const c = clamp01(x); return c * c * (3 - 2 * c); };
    const easeOutCubic = (x) => 1 - Math.pow(1 - clamp01(x), 3);
    const easeInOutCubic = (x) => { const c = clamp01(x); return c < 0.5 ? 4 * c * c * c : 1 - Math.pow(-2 * c + 2, 3) / 2; };

    // Distance pace -> sprint: t = 0..1 blends the two carriages (a little
    // past 1 for a tactical sprint).
    const carriage = { ...RUN_CARRIAGE, shoulder: RUN_CARRIAGE.shoulder.slice(), curl: RUN_CARRIAGE.curl.slice() };
    function blendCarriage(t) {
      for (const k in RUN_CARRIAGE) {
        const a = RUN_CARRIAGE[k], b = SPRINT_CARRIAGE[k];
        if (Array.isArray(a)) for (let i = 0; i < a.length; i++) carriage[k][i] = a[i] + (b[i] - a[i]) * t;
        else carriage[k] = a + (b - a) * t;
      }
      return carriage;
    }
    // One arm of the carriage at `phase` (0 = hand furthest forward), swing
    // scaled by `amp`; writes the pose into `out` and the (travelling)
    // shoulder into `shoulderOut`.
    const uArm = new THREE.Vector3(), fArm = new THREE.Vector3();
    const turnIn = (v, a) => { const x = v.x * Math.cos(a) + v.z * Math.sin(a); v.z = -v.x * Math.sin(a) + v.z * Math.cos(a); v.x = x; return v; };
    function carriagePose(C, phase, amp, shoulderOut, out) {
      // A touch of second harmonic so the swing isn't a pure sine: it
      // lingers slightly at the front and whips through the bottom.
      const swing = (Math.cos(phase) + 0.08 * Math.cos(2 * phase)) * amp;
      const th = C.swingCenter + C.swingAmp * swing;
      const el = C.elbowCenter + C.elbowAmp * Math.cos(phase - C.elbowLead) * amp;
      shoulderOut.set(C.shoulder[0], C.shoulder[1] + 0.004 * swing, C.shoulder[2] - C.shoulderTravel * swing);
      uArm.set(Math.sin(C.abduct), -Math.cos(th) * Math.cos(C.abduct), -Math.sin(th) * Math.cos(C.abduct));
      turnIn(uArm, C.inward);
      fArm.set(0, -Math.cos(th + el), -Math.sin(th + el));
      turnIn(fArm, C.inward + C.forearmIn);
      for (let i = 0; i < 3; i++) out.w[i] = shoulderOut.getComponent(i) + C.upper * uArm.getComponent(i) + FOREARM * fArm.getComponent(i);
      out.yaw = Math.atan2(-fArm.x, -fArm.z);
      out.pitch = Math.asin(Math.max(-1, Math.min(1, fArm.y)));
      out.roll = C.roll + C.rollAmp * swing;
      out.flex = C.flex + C.flexAmp * Math.cos(phase - 0.9) * amp;
      out.dev = C.dev * Math.cos(phase - 0.6) * amp;
      // The fingers loosen a hair as the hand drops back past the hip.
      for (let i = 0; i < 4; i++) out.curl[i] = C.curl[i] + 0.035 * swing;
      out.thumb = C.thumb;
      out.spread = C.spread;
      return out;
    }

    // Punch timeline over t = 0..1: short wind-up (fist forms, pinky
    // first), a fast decelerating strike, a brief hold at impact, then a
    // smooth recovery with the fist relaxing late.
    const PUNCH = { windup: 0.16, strike: 0.36, hold: 0.46 };
    function punchPose(base, t, out) {
      if (t < PUNCH.windup) {
        lerpPose(base.ready, base.windup, easeInOutCubic(t / PUNCH.windup), out);
      } else if (t < PUNCH.strike) {
        lerpPose(base.windup, base.impact, easeOutCubic((t - PUNCH.windup) / (PUNCH.strike - PUNCH.windup)), out);
      } else if (t < PUNCH.hold) {
        lerpPose(base.impact, base.impact, 0, out);
        out.w[2] += 0.006 * Math.sin(((t - PUNCH.strike) / (PUNCH.hold - PUNCH.strike)) * Math.PI); // the hit pushes back a hair
      } else {
        lerpPose(base.impact, base.ready, easeInOutCubic((t - PUNCH.hold) / (1 - PUNCH.hold)), out);
      }
      // Fist: the fingers close first in a cascade (pinky leading) and the
      // thumb folds over them last; opening late in the recovery runs the
      // other way -- thumb off first, fingers following it -- so the thumb
      // never passes through a finger.
      const thumbIn = smooth((t - 0.10) / 0.13); // starts once the fingers are about half closed
      const thumbOut = smooth((t - 0.56) / 0.3);
      const thumbClose = thumbIn * (1 - thumbOut);
      for (let i = 0; i < 4; i++) {
        const close = t < 0.5 ? smooth((t - 0.012 * (3 - i)) / (PUNCH.windup * 0.9)) : smooth(1.5 * thumbClose);
        out.curl[i] = base.ready.curl[i] + (1 - base.ready.curl[i]) * close;
      }
      out.thumb = base.ready.thumb + (1 - base.ready.thumb) * thumbClose;
      out.spread = base.ready.spread * (1 - thumbClose);
      return out;
    }

    // ---------------------------------------------------------------- rig
    const group = new THREE.Group();
    const rootOffset = new THREE.Vector3(); // set by the caller so children sit in camera space
    const arms = { right: buildArm(false, [0.2, -0.34, 0.06]), left: buildArm(true, [0.19, -0.35, 0.05]) };
    group.add(arms.right.side, arms.left.side);

    const st = {
      time: Math.random() * 20,
      raise: 0,
      walk: 0, run: 0, effort: 0, swingAmp: 1, air: 0, lower: 0,
      wasGrounded: true, lastVy: 0,
      land: { right: { x: 0, v: 0 }, left: { x: 0, v: 0 } },
      current: { right: clone(READY_R), left: clone(READY_L) },
      target: { right: clone(READY_R), left: clone(READY_L) },
      scratch: clone(READY_R),
      running: clone(READY_R), // one arm's carriage pose, this frame
      twist: 0,
    };
    // Where each upper arm heads back to: the rig's resting shoulder,
    // blended toward the carriage's travelling one while running.
    const runShoulder = new THREE.Vector3();
    for (const key of ["right", "left"]) arms[key].liveShoulder = arms[key].shoulder.clone();
    const punchBases = {
      right: { ready: clone(READY_R), windup: WINDUP_R, impact: IMPACT_R },
      left: { ready: clone(READY_L), windup: WINDUP_L, impact: IMPACT_L },
    };

    function show() {
      st.raise = 0;
      st.current.right = clone(READY_R);
      st.current.left = clone(READY_L);
    }

    const dir = new THREE.Vector3(), elbow = new THREE.Vector3(), wristV = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0), m = new THREE.Matrix4(), qRoll = new THREE.Quaternion(), zAxis = new THREE.Vector3(0, 0, 1);
    function applyArm(arm, p) {
      dir.set(-Math.sin(p.yaw) * Math.cos(p.pitch), Math.sin(p.pitch), -Math.cos(p.yaw) * Math.cos(p.pitch));
      wristV.set(p.w[0], p.w[1], p.w[2]);
      elbow.copy(wristV).addScaledVector(dir, -FOREARM);
      arm.forearm.position.copy(elbow);
      m.lookAt(elbow, wristV, up); // -Z from the elbow to the wrist
      arm.forearm.quaternion.setFromRotationMatrix(m);
      qRoll.setFromAxisAngle(zAxis, p.roll);
      arm.forearm.quaternion.multiply(qRoll);
      // Upper arm: from the elbow back toward the shoulder, so a forearm
      // driven out in a punch is always attached to something. Ends just
      // past the shoulder (behind the camera) -- drawn at full length, a
      // running arm swung back would poke it forward into view.
      arm.upperArm.position.copy(elbow);
      m.lookAt(arm.liveShoulder, elbow, up); // +Z from the elbow to the shoulder
      arm.upperArm.quaternion.setFromRotationMatrix(m);
      arm.upperArm.scale.z = Math.min(1, (elbow.distanceTo(arm.liveShoulder) + 0.06) / FOREARM_UPPER_LEN);
      arm.hand.wrist.rotation.set(p.flex, p.dev, 0);
      arm.hand.fingers.forEach((f, i) => {
        const c = clamp01(p.curl[i]);
        f.mcp.rotation.set(-(RELAXED.mcp[i] + (FIST.mcp[i] - RELAXED.mcp[i]) * c), FINGERS[i].splay * (0.35 + 0.9 * p.spread) * (1 - 0.7 * c), 0);
        f.pip.rotation.x = -(RELAXED.pip[i] + (FIST.pip[i] - RELAXED.pip[i]) * c);
        f.dip.rotation.x = -(RELAXED.dip[i] + (FIST.dip[i] - RELAXED.dip[i]) * c);
      });
      const t = clamp01(p.thumb), th = arm.hand.thumb;
      const a = THUMB_RELAXED, b = THUMB_FIST;
      th.cmc.rotation.set(a.cmc[1] + (b.cmc[1] - a.cmc[1]) * t, a.cmc[0] + (b.cmc[0] - a.cmc[0]) * t, a.cmc[2] + (b.cmc[2] - a.cmc[2]) * t);
      th.mcp.rotation.x = -(a.mcp + (b.mcp - a.mcp) * t);
      th.ip.rotation.x = -(a.ip + (b.ip - a.ip) * t);
    }

    // state: {
    //   speed: horizontal m/s (smoothed), walkSpeed,
    //   gaitPhase: radians, one full stride (two steps) per 2*PI -- the
    //     right foot lands at 0, the left at PI (see index.html's GAIT),
    //   run: 0..1 -- 0 walking/crouching/sliding, 1 at a running pace,
    //   effort: 0 distance pace .. 1 sprint (a little more for a tactical sprint),
    //   grounded, verticalVelocity,
    //   punch: { side: "right" | "left", t: 0..1 } | null }
    function update(dt, s) {
      dt = Math.min(dt, 0.05);
      const ease = (rate) => 1 - Math.exp(-rate * dt);
      st.time += dt;
      st.raise = Math.min(1, st.raise + dt / 0.22);
      const moving = s.grounded ? Math.min(1.3, s.speed / s.walkSpeed) : 0;
      // Running carriage vs the ready guard: held through a jump, so a
      // running jump keeps its arms low instead of lifting them to the guard.
      if (s.grounded) st.run += (s.run - st.run) * ease(5);
      st.effort += (s.effort - st.effort) * ease(4);
      // In the air the swing freezes where it was (the gait phase stops)
      // and eases halfway back to center.
      st.swingAmp += ((s.grounded ? 1 : 0.45) - st.swingAmp) * ease(6);
      const run = smooth(st.run);
      st.walk += (moving * (1 - run) - st.walk) * ease(8);
      st.air += ((s.grounded ? 0 : 1) - st.air) * ease(9);
      // Landing: a small damped dip, scaled by how fast they came down.
      if (s.grounded && !st.wasGrounded) {
        const impact = Math.min(1, Math.max(0, -st.lastVy) / 9);
        st.land.right.v -= 0.9 * impact;
        st.land.left.v -= 0.75 * impact;
      }
      st.wasGrounded = s.grounded;
      st.lastVy = s.verticalVelocity;
      for (const key of ["right", "left"]) {
        const L = st.land[key];
        L.v += (-160 * L.x - 18 * L.v) * dt;
        L.x += L.v * dt;
      }

      const rise = clamp01(s.verticalVelocity / 5) * st.air;
      const fall = clamp01(-s.verticalVelocity / 8) * st.air;
      const punch = s.punch;
      const env = punch ? Math.sin(Math.PI * clamp01(punch.t)) : 0;
      st.twist += ((punch ? (punch.side === "right" ? 0.05 : -0.05) * env : 0) - st.twist) * ease(20);
      group.rotation.y = st.twist; // a little shoulder turn into the punch
      const C = blendCarriage(Math.min(1.25, st.effort));
      // Walking (not running -- the carriage keeps its own low swing), the
      // hands drop out of view below the screen; a punch brings them back
      // up, and so does stopping.
      st.lower += ((punch ? 0 : smooth((st.walk - 0.1) / 0.4)) - st.lower) * ease(punch ? 14 : 5);
      const lower = smooth(st.lower);

      for (const key of ["right", "left"]) {
        const base = BASES[key];
        const arm = arms[key];
        const target = st.target[key];
        const punching = punch && punch.side === key;
        const quiet = punching ? 0.25 : 1; // a punch overrides that arm's other motion
        const t = st.time;
        // Arm-leg opposition: each arm is furthest forward just after the
        // OTHER foot lands (the left arm at the right foot's strike, gait
        // phase 0), trailing it by a hair.
        const armPhase = s.gaitPhase - 0.15 + base.phase;
        // Guard pose, with a small counter-swing from the shoulder while
        // walking -- the hand goes forward and a touch up, the forearm
        // tips and the wrist rolls with it.
        lerpPose(base.ready, base.ready, 0, target);
        const swing = Math.cos(armPhase);
        const wk = st.walk * base.amp * quiet;
        target.w[2] -= 0.012 * swing * wk;
        target.w[1] += (0.004 * swing + 0.004 * Math.cos(2 * s.gaitPhase + base.idle)) * wk;
        target.pitch += 0.035 * swing * wk;
        target.roll += 0.04 * swing * wk;
        target.flex += 0.05 * Math.sin(2 * s.gaitPhase + 1 + base.idle) * wk;
        // Running: the carriage, its swing breathing slightly in size from
        // stride to stride so no two cycles are quite the same.
        if (run > 0.001) {
          const vary = 1 + 0.04 * Math.sin(t * 0.53 + base.idle) + 0.025 * Math.sin(t * 1.31 + base.idle * 1.7);
          carriagePose(C, armPhase, base.amp * st.swingAmp * vary, runShoulder, st.running);
          lerpPose(target, st.running, run, target);
          arm.liveShoulder.copy(arm.shoulder).lerp(runShoulder, run);
        } else {
          arm.liveShoulder.copy(arm.shoulder);
        }
        if (punching) {
          // The punch starts from (and returns to) wherever the arm's
          // movement pose is right now, so it blends in from a walk or run.
          const pb = punchBases[key];
          lerpPose(target, target, 0, pb.ready);
          punchPose(pb, punch.t, st.scratch);
          lerpPose(st.scratch, st.scratch, 0, target);
        }
        // Idle life: breathing, tiny wrist and finger drift (mostly gone
        // while running -- the swing is life enough).
        const idle = (1 - 0.75 * run) * (punching ? 0.2 : 1);
        target.w[1] += 0.0018 * Math.sin(t * 1.25 + base.idle) * idle;
        target.w[2] += 0.0012 * Math.sin(t * 0.85 + base.idle * 0.7) * idle;
        target.flex += (0.02 * Math.sin(t * 0.6 + base.idle * 2.1) + 0.01 * Math.sin(t * 1.7 + base.idle)) * idle;
        target.dev += 0.014 * Math.sin(t * 0.45 + base.idle) * idle;
        target.roll += 0.02 * Math.sin(t * 0.5 + base.idle * 0.7) * idle;
        for (let i = 0; i < 4; i++) target.curl[i] += 0.03 * Math.sin(t * 0.8 + i * 1.3 + base.idle * 2) * idle;
        // Air: going up the hands lag low; coming down they lift, drift
        // out and the fingers open a little.
        target.w[1] += (-0.018 * rise + 0.022 * fall) * quiet;
        target.w[0] += 0.012 * fall * quiet;
        target.pitch += (-0.08 * rise + 0.05 * fall) * quiet;
        target.spread += 0.4 * fall * quiet;
        for (let i = 0; i < 4; i++) target.curl[i] -= 0.15 * fall * quiet;
        target.flex -= 0.1 * fall * quiet;
        // Landing dip.
        const L = st.land[key].x;
        target.w[1] += 0.05 * L;
        target.pitch += 0.12 * L;
        for (let i = 0; i < 4; i++) target.curl[i] += 0.25 * Math.abs(L);
        // The other hand tightens its guard and draws back while one punches.
        if (punch && !punching) {
          target.w[1] -= 0.01 * env;
          target.w[2] += 0.02 * env;
          target.roll -= 0.1 * env;
          for (let i = 0; i < 4; i++) target.curl[i] += 0.25 * env;
          target.thumb += 0.2 * env;
        }
        // Raise into view after a switch to bare hands; walking, they're
        // carried down below the bottom of the screen (see st.lower).
        const r = smooth(st.raise);
        target.w[1] -= 0.15 * (1 - r) + 0.28 * lower;
        target.w[2] += 0.08 * lower;
        target.pitch -= 0.35 * (1 - r) + 0.6 * lower;

        // Follow the target: fast enough for a punch to read as a strike
        // and for the running swing to keep its full size and timing, soft
        // otherwise so nothing ever snaps.
        approachPose(st.current[key], target, punching ? 60 : 20 + 30 * run, dt);
        applyArm(arm, st.current[key]);
      }
    }

    return { group, rootOffset, arms, show, update, applyArm, poses: { READY_R, READY_L, WINDUP_R, IMPACT_R }, RUN_CARRIAGE, SPRINT_CARRIAGE, carriagePose, FINGERS, THUMB };
  }

  window.createFirstPersonHands = createFirstPersonHands;
})();
