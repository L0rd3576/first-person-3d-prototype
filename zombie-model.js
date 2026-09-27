// Zombie model: the enemies' body -- one shared 19-bone rig, procedural
// low-poly skinned meshes, a curved face surface on the head, randomized
// appearance, and the zombie animation set (walk / idle / attacks, plus a
// mapping for the older boss/brute clips). Purely visual: movement,
// collision and AI still live in index.html and only read the root
// Group's position/rotation, exactly like before.
//
// Usage: const zombies = createZombieSystem(THREE, options);
//   options.feetY            -- model-local y of the soles (the root Group
//                               sits at the body's center, see ENEMY_SIZE)
//   options.getFace(key)     -- { texture, aspect, fillHead } for a face key
//
//   const model = zombies.acquire();               // pooled
//   zombies.applyAppearance(model, zombies.randomAppearance("normal", faceKey));
//   root.add(model.rig);                           // root = the enemy's Group
//   zombies.update(model, dt, context) every frame; zombies.release(model).
//
// PERFORMANCE NOTES
//   - Every zombie shares ONE body material (vertex colors + GPU skinning)
//     and, per body shape and LOD, one set of vertex buffers (position,
//     normal, skin weights, index). A zombie only owns a small color
//     buffer per LOD and its bones -- 2 draw calls per zombie (body + face)
//     instead of the old 7 box meshes.
//   - Three LODs (~1100 / ~450 / ~170 triangles) swapped by camera
//     distance; the far one casts no shadow and has no hands.
//   - Animation LOD: full rate up close, every 2nd frame at medium range,
//     every 4th far away (with the skipped time carried over, so motion
//     slows in update rate but never freezes), and the secondary motion
//     (twitches, head wander, shoulder bounce) only runs up close.
//   - Hits use 10 invisible boxes on the bones (head / torso / arms /
//     legs) -- the skinned mesh itself is never raycast.
//   - Models are pooled: a killed or reset zombie's model is reused (and
//     re-dressed) by the next spawn, so nothing is rebuilt or leaked.
(function () {
  "use strict";

  function createZombieSystem(THREE, options) {
    const FEET_Y = options.feetY;
    // Movement speeds the base strides are tuned for (normal walker / green
    // sprinter at the easiest difficulty). Faster zombies lengthen their
    // stride rather than only stepping faster -- see strideFor.
    const WALK_REF_SPEED = options.walkRefSpeed || 3;
    const SPRINT_REF_SPEED = options.sprintRefSpeed || 6.9;
    const getFace = options.getFace;

    // ------------------------------------------------------------------
    // RIG. Bone order is fixed (index = skin index). Joint positions are
    // absolute, in meters above the soles, for the "normal" shape; the
    // other shapes scale them (see SHAPES). Local +Z is forward and +X is
    // the zombie's own left, same as the old model -- so a NEGATIVE
    // rotation.x swings a hanging limb forward.
    // ------------------------------------------------------------------
    const BONES = [
      { name: "hips", parent: -1, pos: [0, 0.95, 0] },
      { name: "spine", parent: 0, pos: [0, 1.08, 0] },
      { name: "chest", parent: 1, pos: [0, 1.26, 0] },
      { name: "neck", parent: 2, pos: [0, 1.47, 0] },
      { name: "head", parent: 3, pos: [0, 1.555, 0.01] },
      { name: "clavL", parent: 2, pos: [0.035, 1.43, 0] },
      { name: "upperArmL", parent: 5, pos: [0.2, 1.42, -0.01] },
      { name: "forearmL", parent: 6, pos: [0.2, 1.12, -0.01] },
      { name: "handL", parent: 7, pos: [0.2, 0.87, 0] },
      { name: "clavR", parent: 2, pos: [-0.035, 1.43, 0] },
      { name: "upperArmR", parent: 9, pos: [-0.2, 1.42, -0.01] },
      { name: "forearmR", parent: 10, pos: [-0.2, 1.12, -0.01] },
      { name: "handR", parent: 11, pos: [-0.2, 0.87, 0] },
      { name: "thighL", parent: 0, pos: [0.1, 0.92, 0] },
      { name: "shinL", parent: 13, pos: [0.1, 0.5, 0] },
      { name: "footL", parent: 14, pos: [0.1, 0.085, -0.02] },
      { name: "thighR", parent: 0, pos: [-0.1, 0.92, 0] },
      { name: "shinR", parent: 16, pos: [-0.1, 0.5, 0] },
      { name: "footR", parent: 17, pos: [-0.1, 0.085, -0.02] },
    ];
    const B = {};
    BONES.forEach((bone, i) => { B[bone.name] = i; });
    const BONE_COUNT = BONES.length;

    // Region tags drive per-zombie coloring (clothes vs skin, sleeves...).
    const R = { HEAD: 0, NECK: 1, CHEST: 2, BELLY: 3, PELVIS: 4, UPPERARM: 5, FOREARM: 6, HAND: 7, THIGH: 8, SHIN: 9, FOOT: 10 };

    // Body shapes: the variants' silhouettes. hs = height, ws = shoulder/
    // hip width, gt = torso girth, gl = limb girth, belly = forward belly.
    const SHAPES = {
      normal: { hs: 1.0, ws: 1.03, gt: 1.1, gl: 1.12, belly: 0 },
      tall: { hs: 1.07, ws: 0.98, gt: 0.99, gl: 1.0, belly: 0 },
      heavy: { hs: 0.98, ws: 1.18, gt: 1.36, gl: 1.3, belly: 0.05 },
      thin: { hs: 1.02, ws: 0.94, gt: 0.88, gl: 0.87, belly: -0.01 },
    };
    const SHAPE_KEYS = Object.keys(SHAPES);

    // Per LOD: radial segments (torso / limbs / hands / feet), head grid,
    // whether hands exist, and whether in-between rings are kept.
    const LODS = [
      { torso: 10, limb: 8, hand: 6, foot: 6, headA: 12, headS: 9, hands: true, allRings: true },
      { torso: 7, limb: 5, hand: 4, foot: 4, headA: 8, headS: 6, hands: true, allRings: true },
      { torso: 5, limb: 4, hand: 0, foot: 4, headA: 6, headS: 4, hands: false, allRings: false },
    ];
    // Camera distance (m) where each LOD ends, with hysteresis.
    const LOD_DISTANCES = [20, 42];
    const LOD_HYSTERESIS = 2;
    const LOD_UPDATE_INTERVAL = [1, 2, 4]; // animate every Nth frame

    function jointOf(shape, index) {
      const p = BONES[index].pos;
      // Arms/legs spread with width; everything scales with height.
      const sideScale = index >= B.clavL && index <= B.handR ? shape.ws : index >= B.thighL ? (1 + (shape.ws - 1) * 0.6) : 1;
      return new THREE.Vector3(p[0] * sideScale, p[1] * shape.hs, p[2]);
    }

    // ------------------------------------------------------------------
    // GEOMETRY BUILDER. Every body part is a tube of elliptical rings
    // along a bone, skinned rigidly to it except near the ends, where the
    // weights blend 50/50 into the neighbouring bone -- so elbows, knees,
    // shoulders and the waist bend as one continuous surface instead of
    // separate boxes.
    // ------------------------------------------------------------------
    function createBuilder() {
      return { pos: [], skinIndex: [], skinWeight: [], index: [], region: [], side: [], t: [], ang: [] };
    }

    function pushVertex(g, p, weights, region, side, t, ang) {
      g.pos.push(p.x, p.y + FEET_Y, p.z);
      // Up to 4 influences, normalized.
      const w = weights.slice(0, 4);
      let sum = 0;
      for (const [, v] of w) sum += v;
      for (let i = 0; i < 4; i++) {
        g.skinIndex.push(w[i] ? w[i][0] : 0);
        g.skinWeight.push(w[i] ? w[i][1] / sum : 0);
      }
      g.region.push(region);
      g.side.push(side);
      g.t.push(t);
      g.ang.push(ang);
      return g.pos.length / 3 - 1;
    }

    const tmpCenter = new THREE.Vector3();
    const tmpPoint = new THREE.Vector3();

    // spec: { bone, parent, child, a, b, u, v, rings: [[t, ru, rv, du, dv]],
    //         radial, capStart, capEnd, region, side, blend: [start, end],
    //         extra(t, ang) -> additional [bone, weight] pairs }
    function addTube(g, lod, spec) {
      let rings = spec.rings;
      if (!lod.allRings && rings.length > 3) {
        rings = [rings[0], rings[Math.floor(rings.length / 2)], rings[rings.length - 1]];
      }
      const radial = spec.radial;
      const blendStart = spec.blend ? spec.blend[0] : 0.18;
      const blendEnd = spec.blend ? spec.blend[1] : 0.18;
      const axis = new THREE.Vector3().subVectors(spec.b, spec.a);

      function weightsAt(t, ang) {
        const out = [];
        let wParent = 0, wChild = 0;
        if (spec.parent !== undefined && t < blendStart) wParent = 0.5 * (1 - t / blendStart);
        if (spec.child !== undefined && t > 1 - blendEnd) wChild = 0.5 * (t - (1 - blendEnd)) / blendEnd;
        const extra = spec.extra ? spec.extra(t, ang) : null;
        let wExtra = 0;
        if (extra) for (const e of extra) wExtra += e[1];
        out.push([spec.bone, Math.max(0.001, 1 - wParent - wChild - wExtra)]);
        if (wParent > 0) out.push([spec.parent, wParent]);
        if (wChild > 0) out.push([spec.child, wChild]);
        if (extra) for (const e of extra) if (e[1] > 0) out.push(e);
        return out;
      }

      const ringStarts = [];
      for (const ring of rings) {
        const [t, ru, rv, du = 0, dv = 0] = ring;
        tmpCenter.copy(spec.a).addScaledVector(axis, t).addScaledVector(spec.u, du).addScaledVector(spec.v, dv);
        ringStarts.push(g.pos.length / 3);
        for (let k = 0; k < radial; k++) {
          const ang = (k / radial) * Math.PI * 2;
          const jitter = spec.jitter ? spec.jitter(t, ang) : 1;
          tmpPoint.copy(tmpCenter)
            .addScaledVector(spec.u, Math.cos(ang) * ru * jitter)
            .addScaledVector(spec.v, Math.sin(ang) * rv * jitter);
          pushVertex(g, tmpPoint, weightsAt(t, ang), spec.region, spec.side || 0, t, ang);
        }
      }
      for (let r = 0; r < rings.length - 1; r++) {
        const a0 = ringStarts[r], a1 = ringStarts[r + 1];
        for (let k = 0; k < radial; k++) {
          const k1 = (k + 1) % radial;
          g.index.push(a0 + k, a1 + k, a0 + k1, a0 + k1, a1 + k, a1 + k1);
        }
      }
      const capAt = (ringIndex, reverse) => {
        const ring = rings[ringIndex];
        tmpCenter.copy(spec.a).addScaledVector(axis, ring[0]).addScaledVector(spec.u, ring[3] || 0).addScaledVector(spec.v, ring[4] || 0);
        if (spec.capBulge) tmpCenter.addScaledVector(axis.clone().normalize(), reverse ? -spec.capBulge : spec.capBulge);
        const c = pushVertex(g, tmpCenter, weightsAt(ring[0], 0), spec.region, spec.side || 0, ring[0], 0);
        const s = ringStarts[ringIndex];
        for (let k = 0; k < radial; k++) {
          const k1 = (k + 1) % radial;
          // Wound to face out of the tube, matching its sides (the start cap
          // faces back along the tube, the end cap forward) -- toes and
          // fingertips were culled into holes before.
          if (reverse) g.index.push(c, s + k, s + k1);
          else g.index.push(c, s + k1, s + k);
        }
      };
      if (spec.capStart) capAt(0, true);
      if (spec.capEnd) capAt(rings.length - 1, false);
    }

    // Head: a deformed ellipsoid -- rounded skull and back of the head, a
    // flatter face, narrower jaw and a slightly forward chin. Head-bone
    // local coordinates (origin at the skull base). s: 0 chin -> 1 crown,
    // a: 0 = straight ahead.
    const HEAD = { w: 0.32, h: 0.385, d: 0.34, cy: 0.17, cz: 0.02 };
    function headPoint(a, s, out) {
      const phi = s * Math.PI;
      let y = -Math.cos(phi);
      const r = Math.sin(phi);
      let x = Math.sin(a) * r;
      let z = Math.cos(a) * r;
      const lower = Math.max(0, Math.min(1, -y / 0.9));
      x *= 1 - 0.28 * lower * lower;                                    // jaw narrows toward the chin
      if (z < 0) z *= 1 - 0.38 * Math.max(0, Math.min(1, (0.1 - y) / 1.0)); // slim nape
      if (z < 0 && y > -0.2) z *= 1.08;                                 // rounded back of the skull
      const front = Math.max(0, Math.cos(a));
      if (y > -0.6 && y < 0.7) z = z > 0 ? z * (1 - 0.2 * front) : z;   // flat face/cheeks
      if (y < -0.5 && z > 0) z += 0.03 * front * Math.min(1, (-0.5 - y) / 0.35); // chin
      if (y > 0.8) y = 0.8 + (y - 0.8) * 0.8;                           // flatter crown
      return out.set(x * HEAD.w / 2, HEAD.cy + y * HEAD.h / 2, HEAD.cz + z * HEAD.d / 2);
    }

    function addHead(g, lod, shape, headJoint) {
      const A = lod.headA, S = lod.headS;
      const p = new THREE.Vector3();
      const bottom = pushVertex(g, headPoint(0, 0, p).add(headJoint), [[B.head, 0.6], [B.neck, 0.4]], R.HEAD, 0, 0, 0);
      const rowStart = [];
      for (let si = 1; si < S; si++) {
        const s = si / S;
        rowStart.push(g.pos.length / 3);
        for (let ai = 0; ai < A; ai++) {
          const a = (ai / A) * Math.PI * 2;
          headPoint(a, s, p).add(headJoint);
          const w = s < 0.25 ? [[B.head, 0.75], [B.neck, 0.25]] : [[B.head, 1]];
          pushVertex(g, p, w, R.HEAD, 0, s, a);
        }
      }
      const top = pushVertex(g, headPoint(0, 1, p).add(headJoint), [[B.head, 1]], R.HEAD, 0, 1, 0);
      for (let ai = 0; ai < A; ai++) {
        const a1 = (ai + 1) % A;
        g.index.push(bottom, rowStart[0] + a1, rowStart[0] + ai);
        const last = rowStart[rowStart.length - 1];
        g.index.push(top, last + ai, last + a1);
      }
      for (let r = 0; r < rowStart.length - 1; r++) {
        for (let ai = 0; ai < A; ai++) {
          const a1 = (ai + 1) % A;
          const r0 = rowStart[r], r1 = rowStart[r + 1];
          g.index.push(r0 + ai, r0 + a1, r1 + ai, r0 + a1, r1 + a1, r1 + ai);
        }
      }
    }

    // Deterministic per-geometry wobble for ragged clothing edges.
    function wobble(t, ang, seed) {
      return 1 + 0.06 * Math.sin(ang * 3 + seed) * Math.sin(ang * 5 + seed * 1.7);
    }

    function buildBodyGeometry(shape, lod) {
      const g = createBuilder();
      const J = BONES.map((_, i) => jointOf(shape, i));
      const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);
      const gt = shape.gt, gl = shape.gl, hs = shape.hs;
      const at = (y) => new THREE.Vector3(0, y * hs, 0);

      // Pelvis (hips bone): closed at the crotch.
      addTube(g, lod, {
        bone: B.hips, child: B.spine, a: at(0.83), b: at(1.07), u: X, v: Z, radial: lod.torso, region: R.PELVIS,
        rings: [[0, 0.1 * gt, 0.08 * gt], [0.25, 0.155 * gt, 0.11 * gt], [0.7, 0.168 * gt, 0.118 * gt], [1, 0.158 * gt, 0.112 * gt]],
        capStart: true, capBulge: 0.02, blend: [0, 0.3],
      });
      // Belly (spine bone): the shirt hangs loose and untucked over the
      // pelvis, with a ragged hem.
      addTube(g, lod, {
        bone: B.spine, parent: B.hips, child: B.chest, a: at(0.98), b: at(1.28), u: X, v: Z, radial: lod.torso, region: R.BELLY,
        rings: [[0, 0.178 * gt, 0.13 * gt, 0, shape.belly * 0.4], [0.3, 0.165 * gt, 0.125 * gt + shape.belly, 0, shape.belly * 0.7],
          [0.65, 0.162 * gt, 0.12 * gt + shape.belly * 0.6, 0, shape.belly * 0.4], [1, 0.172 * gt, 0.118 * gt]],
        jitter: (t, ang) => (t === 0 ? wobble(t, ang, 1.3) : 1), blend: [0.25, 0.25],
      });
      // Chest (chest bone): broad at the shoulders, sloping into the neck.
      // The top outer vertices follow the clavicles, so shrugs deform it.
      addTube(g, lod, {
        bone: B.chest, parent: B.spine, a: at(1.22), b: at(1.5), u: X, v: Z, radial: lod.torso, region: R.CHEST,
        rings: [[0, 0.172 * gt, 0.118 * gt], [0.4, 0.188 * gt * shape.ws, 0.126 * gt, 0, 0.01], [0.78, 0.2 * gt * shape.ws, 0.112 * gt, 0, 0.005],
          [0.93, 0.15 * gt * shape.ws, 0.09 * gt], [1, 0.075, 0.07]],
        capEnd: true, blend: [0.2, 0],
        extra: (t, ang) => {
          if (t < 0.6) return null;
          const c = Math.cos(ang);
          const w = Math.min(0.55, Math.max(0, (Math.abs(c) - 0.35) * 1.1)) * Math.min(1, (t - 0.6) / 0.2);
          return w > 0 ? [[c > 0 ? B.clavL : B.clavR, w]] : null;
        },
      });
      // Neck.
      addTube(g, lod, {
        bone: B.neck, parent: B.chest, child: B.head, a: at(1.43), b: at(1.61), u: X, v: Z, radial: Math.max(4, lod.limb - 1), region: R.NECK,
        rings: [[0, 0.065, 0.062], [0.5, 0.055, 0.055, 0, 0.005], [1, 0.05, 0.052, 0, 0.01]], blend: [0.3, 0.3],
      });
      addHead(g, lod, shape, J[B.head]);

      for (const side of [1, -1]) {
        const L = side > 0;
        const cl = L ? B.clavL : B.clavR, ua = L ? B.upperArmL : B.upperArmR, fa = L ? B.forearmL : B.forearmR, hd = L ? B.handL : B.handR;
        const th = L ? B.thighL : B.thighR, sh = L ? B.shinL : B.shinR, ft = L ? B.footL : B.footR;
        // Upper arm: a shoulder mass at the top blending into the clavicle.
        addTube(g, lod, {
          bone: ua, parent: cl, child: fa, a: J[ua].clone().add(new THREE.Vector3(-0.01 * side, 0.03, 0)), b: J[fa], u: X, v: Z, radial: lod.limb,
          region: R.UPPERARM, side,
          rings: [[0, 0.064 * gl, 0.062 * gl], [0.22, 0.059 * gl, 0.057 * gl], [0.7, 0.047 * gl, 0.046 * gl], [1, 0.042 * gl, 0.041 * gl]],
          blend: [0.3, 0.2], capStart: true, capBulge: 0.015,
        });
        // Forearm: thicker below the elbow, thin at the wrist.
        addTube(g, lod, {
          bone: fa, parent: ua, child: lod.hands ? hd : undefined, a: J[fa], b: J[hd], u: X, v: Z, radial: lod.limb, region: R.FOREARM, side,
          rings: [[0, 0.042 * gl, 0.041 * gl], [0.28, 0.044 * gl, 0.043 * gl], [1, 0.03 * gl, 0.027 * gl]],
          blend: [0.2, 0.2], capEnd: !lod.hands,
        });
        if (lod.hands) {
          // Hand: a flat, slightly cupped paddle (palm facing the body).
          const handEnd = J[hd].clone().add(new THREE.Vector3(0, -0.18 * hs, 0.015));
          addTube(g, lod, {
            bone: hd, parent: fa, a: J[hd], b: handEnd, u: X, v: Z, radial: lod.hand, region: R.HAND, side,
            rings: [[0, 0.021, 0.034], [0.35, 0.024, 0.047, 0, 0.004], [0.75, 0.018, 0.045, 0.004 * side, 0.008], [1, 0.011, 0.03, 0.006 * side, 0.01]],
            blend: [0.25, 0], capEnd: true, capBulge: 0.006,
          });
        }
        // Thigh.
        addTube(g, lod, {
          bone: th, parent: B.hips, child: sh, a: J[th].clone().add(new THREE.Vector3(0, 0.04, 0)), b: J[sh], u: X, v: Z, radial: lod.limb,
          region: R.THIGH, side,
          rings: [[0, 0.088 * gl, 0.092 * gl], [0.18, 0.09 * gl, 0.093 * gl], [0.62, 0.071 * gl, 0.076 * gl], [1, 0.056 * gl, 0.06 * gl]],
          blend: [0.25, 0.2],
        });
        // Shin: calf bulge behind, trouser cuff flaring at the ankle.
        addTube(g, lod, {
          bone: sh, parent: th, child: ft, a: J[sh], b: J[ft].clone().add(new THREE.Vector3(0, -0.01, 0.02)), u: X, v: Z, radial: lod.limb,
          region: R.SHIN, side,
          rings: [[0, 0.057 * gl, 0.061 * gl], [0.3, 0.058 * gl, 0.066 * gl, 0, -0.012], [0.78, 0.042 * gl, 0.045 * gl], [0.95, 0.05 * gl, 0.052 * gl], [1, 0.047 * gl, 0.05 * gl]],
          blend: [0.2, 0.15], jitter: (t, ang) => (t > 0.9 ? wobble(t, ang, 2.1 + side) : 1),
        });
        // Foot/shoe: heel to toe along +Z, flat on the ground.
        const heel = new THREE.Vector3(J[ft].x, 0, J[ft].z - 0.06);
        const toe = new THREE.Vector3(J[ft].x + 0.012 * side, 0, J[ft].z + 0.2);
        addTube(g, lod, {
          bone: ft, parent: sh, a: heel, b: toe, u: X, v: Y, radial: lod.foot, region: R.FOOT, side,
          rings: [[0, 0.04, 0.042, 0, 0.047], [0.3, 0.047, 0.05, 0, 0.055], [0.72, 0.05, 0.034, 0, 0.038], [1, 0.036, 0.024, 0, 0.028]],
          blend: [0.15, 0], capStart: true, capEnd: true, capBulge: 0.01,
        });
      }

      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(g.pos, 3));
      geometry.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(g.skinIndex, 4));
      geometry.setAttribute("skinWeight", new THREE.Float32BufferAttribute(g.skinWeight, 4));
      geometry.setIndex(g.index);
      geometry.computeVertexNormals();
      geometry.computeBoundingSphere();
      geometry.boundingSphere.radius *= 1.35; // room for raised arms / lunges
      return {
        geometry,
        meta: {
          region: Uint8Array.from(g.region),
          side: Int8Array.from(g.side),
          t: Float32Array.from(g.t),
          ang: Float32Array.from(g.ang),
        },
      };
    }

    // Per shape: rest joints, bone inverses, and the three LOD geometries.
    const shapeData = {};
    for (const key of SHAPE_KEYS) {
      const shape = SHAPES[key];
      const joints = BONES.map((_, i) => jointOf(shape, i));
      const boneInverses = joints.map((j) => new THREE.Matrix4().makeTranslation(-j.x, -(j.y + FEET_Y), -j.z));
      const localRest = joints.map((j, i) => {
        const parent = BONES[i].parent;
        return parent < 0 ? new THREE.Vector3(j.x, j.y + FEET_Y, j.z) : j.clone().sub(joints[parent]);
      });
      shapeData[key] = { shape, joints, boneInverses, localRest, lods: LODS.map((lod) => buildBodyGeometry(shape, lod)) };
    }

    // ------------------------------------------------------------------
    // FACE: a curved patch lifted just off the front of the head, built
    // from the same head surface, so the picture wraps around the face
    // and cheeks instead of floating as a flat card. The horizontal wrap
    // angle follows each picture's aspect ratio. Cached per face key.
    // ------------------------------------------------------------------
    const FACE_S0 = 0.2, FACE_S1 = 0.84;
    const faceGeometryCache = {};
    function getFaceGeometry(key) {
      if (faceGeometryCache[key]) return faceGeometryCache[key];
      const face = getFace(key);
      const heightM = HEAD.h / 2 * (Math.cos(FACE_S0 * Math.PI) - Math.cos(FACE_S1 * Math.PI));
      const radius = HEAD.w / 2 * 0.95;
      let halfAngle = (face.aspect * heightM) / (2 * radius);
      let cropU = 1, cropV = 1;
      if (face.fillHead) {
        halfAngle = 1.35;
        const patchAspect = (2 * halfAngle * radius) / heightM;
        if (face.aspect > patchAspect) cropU = patchAspect / face.aspect;
        else cropV = face.aspect / patchAspect;
      }
      halfAngle = Math.min(1.45, Math.max(0.55, halfAngle));
      const NA = 12, NS = 12;
      const positions = [], uvs = [], patchUvs = [], index = [];
      const p = new THREE.Vector3();
      const center = new THREE.Vector3(0, HEAD.cy, HEAD.cz);
      for (let si = 0; si <= NS; si++) {
        const s = FACE_S0 + (FACE_S1 - FACE_S0) * (si / NS);
        for (let ai = 0; ai <= NA; ai++) {
          const a = -halfAngle + 2 * halfAngle * (ai / NA);
          headPoint(a, s, p);
          p.sub(center).multiplyScalar(1.018).add(center); // just proud of the skin
          positions.push(p.x, p.y, p.z);
          // a runs from the zombie's right (-) to its left (+); seen from the
          // front that's left-to-right, so u follows a directly.
          uvs.push(0.5 + (ai / NA - 0.5) * cropU, 0.5 + (si / NS - 0.5) * cropV);
          patchUvs.push(ai / NA, si / NS);
        }
      }
      for (let si = 0; si < NS; si++) {
        for (let ai = 0; ai < NA; ai++) {
          const i0 = si * (NA + 1) + ai, i1 = i0 + 1, i2 = i0 + NA + 1, i3 = i2 + 1;
          index.push(i0, i1, i2, i1, i3, i2);
        }
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
      geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
      geometry.setAttribute("faceUv", new THREE.Float32BufferAttribute(patchUvs, 2));
      geometry.setIndex(index);
      geometry.computeVertexNormals();
      geometry.computeBoundingSphere();
      faceGeometryCache[key] = geometry;
      return geometry;
    }
    const faceMaterialCache = {};
    function getFaceMaterial(key) {
      if (faceMaterialCache[key]) return faceMaterialCache[key];
      const texture = getFace(key).texture;
      // Matte and lit exactly like the body's skin (same fully rough
      // standard shading), toned down slightly so bright photo backgrounds
      // don't blow out in direct sun, plus a faint self-light from the
      // picture so faces stay readable at night.
      const material = new THREE.MeshStandardMaterial({
        map: texture, color: 0xd0d0d0, roughness: 1, metalness: 0,
        emissiveMap: texture, emissive: 0x121212, transparent: true, alphaTest: 0.05,
        polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      });
      // Feathered edges: the picture fades out toward the patch border, so
      // it blends into the head instead of ending in a hard-edged card.
      material.onBeforeCompile = (shader) => {
        shader.vertexShader = shader.vertexShader
          .replace("#include <common>", "#include <common>\nattribute vec2 faceUv;\nvarying vec2 vFaceUv;")
          .replace("#include <uv_vertex>", "#include <uv_vertex>\nvFaceUv = faceUv;");
        shader.fragmentShader = shader.fragmentShader
          .replace("#include <common>", "#include <common>\nvarying vec2 vFaceUv;")
          .replace("#include <map_fragment>", "#include <map_fragment>\n" +
            "diffuseColor.a *= smoothstep(0.0, 0.16, vFaceUv.x) * smoothstep(1.0, 0.84, vFaceUv.x) * smoothstep(0.0, 0.1, vFaceUv.y) * smoothstep(1.0, 0.88, vFaceUv.y);");
      };
      faceMaterialCache[key] = material;
      return material;
    }

    // ------------------------------------------------------------------
    // SHARED MATERIALS
    // ------------------------------------------------------------------
    const bodyMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0, skinning: true });
    const hitboxMaterial = new THREE.MeshBasicMaterial({ visible: false }); // raycast-only
    const unitBox = new THREE.BoxGeometry(1, 1, 1);
    const noRaycast = () => {};

    // Hit regions: [name, bone, size xyz, center offset xyz in bone space].
    // Slightly generous around the thin limbs, like loose clothing.
    const HITBOXES = [
      ["Head", B.head, [0.36, 0.42, 0.38], [0, 0.17, 0.02]],
      ["Torso", B.chest, [0.44, 0.32, 0.3], [0, 0.1, 0.01]],
      ["Torso", B.hips, [0.4, 0.4, 0.28], [0, 0.07, 0]],
      ["LeftArm", B.upperArmL, [0.15, 0.34, 0.15], [0, -0.14, 0]],
      ["LeftArm", B.forearmL, [0.13, 0.46, 0.13], [0, -0.2, 0.01]],
      ["RightArm", B.upperArmR, [0.15, 0.34, 0.15], [0, -0.14, 0]],
      ["RightArm", B.forearmR, [0.13, 0.46, 0.13], [0, -0.2, 0.01]],
      ["LeftLeg", B.thighL, [0.21, 0.46, 0.21], [0, -0.2, 0]],
      ["LeftLeg", B.shinL, [0.17, 0.5, 0.26], [0, -0.21, 0.03]],
      ["RightLeg", B.thighR, [0.21, 0.46, 0.21], [0, -0.2, 0]],
      ["RightLeg", B.shinR, [0.17, 0.5, 0.26], [0, -0.21, 0.03]],
    ];

    // ------------------------------------------------------------------
    // MODEL (pooled)
    // ------------------------------------------------------------------
    const pool = [];
    let modelSerial = 0;

    function createModel() {
      const rig = new THREE.Group();
      rig.name = "ZombieRig";
      const bones = BONES.map((def) => {
        const bone = new THREE.Bone();
        bone.name = def.name;
        bone.matrixAutoUpdate = false; // posed and updateMatrix()'d by the animation only when it runs
        return bone;
      });
      BONES.forEach((def, i) => { if (def.parent >= 0) bones[def.parent].add(bones[i]); });
      rig.add(bones[0]);
      const skeleton = new THREE.Skeleton(bones, shapeData.normal.boneInverses.map((m) => m.clone()));
      const identity = new THREE.Matrix4();
      const lodMeshes = LODS.map((lod, i) => {
        const mesh = new THREE.SkinnedMesh(shapeData.normal.lods[i].geometry, bodyMaterial);
        mesh.name = "ZombieBody";
        mesh.bind(skeleton, identity);
        mesh.raycast = noRaycast;
        mesh.castShadow = i < 2;
        mesh.receiveShadow = i === 0;
        mesh.visible = i === 0;
        rig.add(mesh);
        return mesh;
      });
      const face = new THREE.Mesh(getFaceGeometry(options.defaultFaceKey), getFaceMaterial(options.defaultFaceKey));
      face.name = "ZombieFace";
      face.raycast = noRaycast;
      bones[B.head].add(face);
      const hitboxes = HITBOXES.map(([name, bone, size, offset]) => {
        const box = new THREE.Mesh(unitBox, hitboxMaterial);
        box.name = name;
        box.userData.baseSize = size;
        box.userData.baseOffset = offset;
        bones[bone].add(box);
        return box;
      });
      const model = {
        rig, bones, skeleton, lodMeshes, face, hitboxes,
        // Per shape key: this model's own geometry wrapper per LOD (shared
        // buffers + its own color buffer), built the first time it's needed.
        geometries: {},
        shapeKey: null,
        appearance: null,
        lod: 0,
        anim: createAnimState(modelSerial++),
      };
      return model;
    }

    function acquire() {
      return pool.pop() || createModel();
    }

    function release(model) {
      if (model.rig.parent) model.rig.parent.remove(model.rig);
      for (const box of model.hitboxes) box.userData.enemyRef = null;
      pool.push(model);
    }

    function geometryFor(model, shapeKey, lodIndex) {
      let perShape = model.geometries[shapeKey];
      if (!perShape) perShape = model.geometries[shapeKey] = [];
      if (!perShape[lodIndex]) {
        const base = shapeData[shapeKey].lods[lodIndex].geometry;
        const geometry = new THREE.BufferGeometry();
        for (const name of ["position", "normal", "skinIndex", "skinWeight"]) geometry.setAttribute(name, base.attributes[name]);
        geometry.setIndex(base.index);
        geometry.setAttribute("color", new THREE.BufferAttribute(new Float32Array(base.attributes.position.count * 3), 3));
        geometry.boundingSphere = base.boundingSphere;
        perShape[lodIndex] = geometry;
      }
      return perShape[lodIndex];
    }

    // ------------------------------------------------------------------
    // APPEARANCE
    // ------------------------------------------------------------------
    const PALETTES = {
      // Normal zombies keep to reds/browns/grays so the special variants'
      // colors (green = fast, blue = brute, orange = boss) still read.
      normal: {
        shirts: [0x6e1a1a, 0x8b1c1c, 0x7a2e22, 0x5e1616, 0x8a4a2a, 0x5a4030, 0x9a8466, 0x5c5c5c, 0x2e2e30, 0xb3aa98, 0x8f7a2e, 0x7a3040],
        pants: [0x3a3a3c, 0x4a3a2a, 0x6d624a, 0x222224, 0x4a4d52, 0x5a3a2a],
      },
      green: { shirts: [0x2f7a2a, 0x3d8b2f, 0x256b2a, 0x4a7a22], pants: [0x2a4a22, 0x33502a, 0x3a3f2a] },
      brute: { shirts: [0x1f4fbf, 0x2456b0, 0x1a3f9a], pants: [0x1c2f66, 0x223a7a, 0x1a2550] },
      boss: { shirts: [0xa84300, 0x9a3c00, 0xb04a08], pants: [0x5a2400, 0x4a2008] },
    };
    const SKIN_TONES = [0xe0b89a, 0xcf9f7c, 0xb07c58, 0x8d5a3c, 0x6b4028, 0xd8a888];
    const ZOMBIE_SKIN_TINT = new THREE.Color(0x7d8a68);
    const GREEN_SKIN_TINT = new THREE.Color(0x6f9a4a);
    const BLOOD = new THREE.Color(0x3d0a0a);
    const DIRT = new THREE.Color(0x3b3024);
    const SHOE_COLORS = [0x1e1e1e, 0x3a2a1c, 0x5a5a5a, 0x2a2420];

    function pick(list) { return list[Math.floor(Math.random() * list.length)]; }
    function rand(min, max) { return min + Math.random() * (max - min); }

    // Visual archetypes (all on the same rig): normal, tall, heavy, thin,
    // damaged (torn clothes, more wounds), and "casual" (a different
    // clothing mix -- tank top/shorts/jacket). Special variants lean on the
    // body type that suits them.
    const ARCHETYPES = ["normal", "tall", "heavy", "thin", "damaged", "casual"];

    function randomAppearance(variant, faceKey, extra = {}) {
      const archetype = variant === "brute" || variant === "boss" ? "heavy" : variant === "green" ? pick(["thin", "normal", "tall", "damaged"]) : pick(ARCHETYPES);
      const shapeKey = archetype === "damaged" || archetype === "casual" ? pick(["normal", "normal", "thin", "tall"]) : archetype;
      const palette = PALETTES[variant] || PALETTES.normal;
      const skinBase = new THREE.Color(pick(SKIN_TONES));
      const decay = rand(0.3, 0.55);
      const skin = skinBase.lerp(variant === "green" ? GREEN_SKIN_TINT : ZOMBIE_SKIN_TINT, variant === "green" ? decay + 0.15 : decay).multiplyScalar(rand(0.8, 0.95));
      const casual = archetype === "casual";
      return {
        variant,
        archetype,
        shapeKey,
        faceKey,
        skin,
        shirt: new THREE.Color(pick(palette.shirts)).multiplyScalar(rand(0.8, 1.05)),
        under: new THREE.Color(pick([0xa8a090, 0x5c5c5c, 0x8a7a60])).multiplyScalar(rand(0.75, 1)),
        pants: new THREE.Color(pick(palette.pants)).multiplyScalar(rand(0.8, 1.05)),
        shoes: new THREE.Color(pick(SHOE_COLORS)),
        barefoot: Math.random() < 0.1,
        sleeves: casual ? pick(["none", "short", "long"]) : pick(["long", "long", "short"]),
        jacket: casual ? Math.random() < 0.5 : Math.random() < 0.15,
        shorts: casual ? Math.random() < 0.5 : false,
        tornSleeveSide: archetype === "damaged" ? pick([1, -1]) : Math.random() < 0.15 ? pick([1, -1]) : 0,
        damage: archetype === "damaged" ? rand(0.7, 1) : rand(0.1, 0.45),
        seed: Math.random() * 1000,
        heightScale: rand(0.96, 1.04),
        widthScale: rand(0.95, 1.06),
        headScale: extra.headScale || 1,
      };
    }

    // Cheap 3D value noise for wear patterns.
    function hash3(x, y, z, seed) {
      let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 1440662683) ^ Math.imul(seed | 0, 1274126177);
      h = Math.imul(h ^ (h >>> 13), 1103515245);
      return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
    }
    function noise3(x, y, z, seed) {
      const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
      const xf = x - xi, yf = y - yi, zf = z - zi;
      const sx = xf * xf * (3 - 2 * xf), sy = yf * yf * (3 - 2 * yf), sz = zf * zf * (3 - 2 * zf);
      let v = 0;
      for (let dz = 0; dz < 2; dz++) for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
        const w = (dx ? sx : 1 - sx) * (dy ? sy : 1 - sy) * (dz ? sz : 1 - sz);
        v += w * hash3(xi + dx, yi + dy, zi + dz, seed);
      }
      return v;
    }

    const tmpColor = new THREE.Color();
    function paintGeometry(geometry, meta, ap) {
      const pos = geometry.attributes.position.array;
      const col = geometry.attributes.color.array;
      const seed = ap.seed | 0;
      const holeThreshold = 0.86 - 0.14 * ap.damage;
      const woundThreshold = 0.84 - 0.12 * ap.damage;
      for (let i = 0; i < meta.region.length; i++) {
        const region = meta.region[i], side = meta.side[i], t = meta.t[i], ang = meta.ang[i];
        const x = pos[i * 3], y = pos[i * 3 + 1] - FEET_Y, z = pos[i * 3 + 2];
        const jag = 0.08 * Math.sin(ang * 4 + ap.seed) + 0.05 * Math.sin(ang * 9 + ap.seed * 2);
        let clothing = null; // null = skin
        switch (region) {
          case R.CHEST:
          case R.BELLY:
            clothing = ap.shirt;
            // Open jacket: the undershirt shows down the front.
            if (ap.jacket && z > 0 && Math.abs(x) < 0.05) clothing = ap.under;
            if (ap.sleeves === "none" && region === R.CHEST && t > 0.5 && Math.abs(Math.cos(ang)) > 0.75) clothing = null; // tank top
            break;
          case R.PELVIS:
            clothing = ap.pants;
            break;
          case R.UPPERARM: {
            const torn = ap.tornSleeveSide === side;
            const sleeve = torn ? "none" : ap.sleeves;
            if (sleeve === "long" || (sleeve === "short" && t < 0.5 + jag) || (sleeve === "none" && torn && t < 0.12 + jag)) clothing = ap.shirt;
            break;
          }
          case R.FOREARM:
            if (ap.sleeves === "long" && ap.tornSleeveSide !== side && t < 0.78 + jag) clothing = ap.shirt;
            break;
          case R.THIGH:
            clothing = !ap.shorts || t < 0.55 + jag ? ap.pants : null;
            break;
          case R.SHIN:
            clothing = !ap.shorts && t < 0.97 + jag * 0.5 ? ap.pants : null;
            break;
          case R.FOOT:
            clothing = ap.barefoot ? null : ap.shoes;
            break;
        }
        if (clothing) {
          tmpColor.copy(clothing);
          // Holes worn through the clothes, showing skin.
          if (region !== R.FOOT && noise3(x * 14, y * 14, z * 14, seed) > holeThreshold) tmpColor.copy(ap.skin).multiplyScalar(0.85);
          // Grime collecting toward the ground.
          if (y < 0.7) tmpColor.lerp(DIRT, 0.35 * (1 - y / 0.7));
        } else {
          tmpColor.copy(ap.skin);
          // Mottled, uneven skin.
          tmpColor.multiplyScalar(0.88 + 0.2 * noise3(x * 9, y * 9, z * 9, seed + 7));
          if (region === R.HAND || region === R.FOOT) tmpColor.lerp(DIRT, 0.25);
        }
        // Wounds and blood (more on damaged zombies); bloodier around the mouth/chin.
        const wound = noise3(x * 11 + 5, y * 11, z * 11, seed + 3);
        if (wound > woundThreshold) tmpColor.lerp(BLOOD, Math.min(0.85, (wound - woundThreshold) * 6));
        if (region === R.CHEST && z > 0.05 && y > 1.3 && noise3(x * 6, y * 6, 1, seed + 11) > 0.55) tmpColor.lerp(BLOOD, 0.45);
        // Slight per-vertex variation so flat colors read as fabric/skin.
        tmpColor.multiplyScalar(0.94 + 0.12 * hash3(i, seed, 3, 5));
        col[i * 3] = tmpColor.r;
        col[i * 3 + 1] = tmpColor.g;
        col[i * 3 + 2] = tmpColor.b;
      }
      geometry.attributes.color.needsUpdate = true;
    }

    function applyAppearance(model, ap) {
      model.appearance = ap;
      const data = shapeData[ap.shapeKey];
      if (model.shapeKey !== ap.shapeKey) {
        model.shapeKey = ap.shapeKey;
        for (let i = 0; i < BONE_COUNT; i++) model.skeleton.boneInverses[i].copy(data.boneInverses[i]);
      }
      model.lodMeshes.forEach((mesh, i) => {
        mesh.geometry = geometryFor(model, ap.shapeKey, i);
        paintGeometry(mesh.geometry, data.lods[i].meta, ap);
      });
      // Height/width variation within the shape: a scale on the whole rig.
      model.rig.scale.set(ap.widthScale, ap.heightScale, ap.widthScale);
      model.rig.position.y = FEET_Y * (1 - ap.heightScale); // keep the soles on the ground
      // Bones back to rest.
      model.bones.forEach((bone, i) => {
        bone.position.copy(data.localRest[i]);
        bone.rotation.set(0, 0, 0);
        bone.scale.set(1, 1, 1);
        bone.updateMatrix();
      });
      model.bones[B.head].scale.setScalar(ap.headScale);
      model.bones[B.head].updateMatrix();
      model.face.geometry = getFaceGeometry(ap.faceKey);
      model.face.material = getFaceMaterial(ap.faceKey);
      // Hit boxes follow the shape's girth.
      const girth = data.shape.gl;
      for (const box of model.hitboxes) {
        const s = box.userData.baseSize, o = box.userData.baseOffset;
        const isTorso = box.name === "Torso";
        const k = box.name === "Head" ? 1 : isTorso ? data.shape.gt : girth;
        box.scale.set(s[0] * Math.max(1, k), s[1], s[2] * Math.max(1, k));
        box.position.set(o[0], o[1], o[2]);
      }
      resetAnimState(model.anim, ap);
      setLod(model, 0);
    }

    function setLod(model, lod) {
      model.lod = lod;
      model.lodMeshes.forEach((mesh, i) => { mesh.visible = i === lod; });
    }

    // ------------------------------------------------------------------
    // ANIMATION. Each frame builds a target pose (per-bone rotations plus
    // a hips offset) from the current clip, then eases the bones toward
    // it. Per-zombie personality -- limp side, arm style, hunch, head
    // tilt, dropped shoulder, playback speed, idle choice -- is rolled
    // once per spawn, so a crowd never moves in lockstep.
    // ------------------------------------------------------------------
    function createAnimState(serial) {
      const pose = new Float32Array(BONE_COUNT * 3);
      return {
        pose, // target rotations, xyz per bone
        hipsOffset: new THREE.Vector3(),
        hipsOffsetTarget: new THREE.Vector3(),
        walkPhase: 0,
        time: 0,
        frame: serial % 4,
        accum: 0,
        walkBlend: 0,
        windup: 0,
        windupTarget: 0,
        attack: null,
        idleIndex: 0,
        idleTimer: 0,
        twitchTimer: 0,
        twitch: null,
        idlePose: new Float32Array(BONE_COUNT * 3), // blended with the walk while starting/stopping
        idleHips: new THREE.Vector3(),
        // Secondary-motion springs, [position, velocity] pairs -- see SPRING_*.
        springs: new Float32Array(SPRING_COUNT * 2),
        prevYaw: null,
        turnRate: 0,
        prevWalkBlend: 0,
        posture: new Float32Array(3),       // current slow posture shift: shoulder, head tilt, lean
        postureTarget: new Float32Array(3),
        postureTimer: 0,
        flinch: null,
      };
    }

    function resetAnimState(anim, ap) {
      anim.walkPhase = Math.random() * Math.PI * 2;
      anim.time = Math.random() * 100;
      anim.accum = 0;
      anim.walkBlend = 0;
      anim.windup = 0;
      anim.windupTarget = 0;
      anim.attack = null;
      anim.pose.fill(0);
      anim.hipsOffset.set(0, 0, 0);
      anim.speed = rand(0.85, 1.15);           // playback speed variation
      // Most zombies walk fairly normally; about 1 in 5 favours one leg.
      anim.limpSide = ap.variant !== "green" && Math.random() < 0.2 ? pick([1, -1]) : 0;
      anim.limp = rand(0.72, 0.82);
      anim.armStyle = pick(["hang", "hang", "hang", "reach", "half"]);
      anim.armSide = pick([1, -1]);
      anim.hunch = rand(0.14, 0.3) + (ap.archetype === "damaged" ? 0.06 : 0);
      anim.headTilt = rand(-0.14, 0.14);
      anim.shoulderDrop = Math.random() < 0.5 ? pick([1, -1]) * rand(0.06, 0.16) : 0;
      anim.strideWarp = anim.limpSide ? rand(0.12, 0.18) : rand(0, 0.03); // the limp's quick step on the bad leg
      anim.swayPhase = Math.random() * Math.PI * 2;
      anim.idleIndex = Math.floor(Math.random() * 4);
      anim.idleTimer = rand(5, 12);
      anim.twitchTimer = rand(3, 9);
      anim.twitch = null;
      // Green (fast) zombies sprint: a longer stride keeps their cadence
      // believable at their speed. Walkers match ENEMY_WALK_STRIDE_LENGTH.
      anim.gait = ap.variant === "green" ? "sprint" : "walk";
      // Walk personality, fixed for this zombie's life (deterministic, never
      // re-rolled per frame): uneven arm swings, how loose the elbows and
      // torso are, how fast the head settles, and a slightly different stride.
      anim.armSwingL = rand(0.7, 1.25);
      anim.armSwingR = rand(0.7, 1.25);
      anim.elbowLoose = rand(0.7, 1.3);
      anim.torsoSway = rand(0.75, 1.3);
      anim.headFreq = rand(2.6, 3.6);   // Hz -- lower = more head lag
      anim.armFreq = rand(2.2, 3.0);    // Hz -- lower = looser, laggier arms
      anim.strideJitter = rand(0.94, 1.06);
      anim.springs.fill(0);
      anim.prevYaw = null;
      anim.turnRate = 0;
      anim.prevWalkBlend = 0;
      anim.posture.fill(0);
      anim.postureTarget.fill(0);
      anim.postureTimer = rand(4, 10);
      anim.flinch = null;
      // Full cycle (two steps) at the reference speed: a long, even lurch for
      // walkers (~3 steps/s at 3 m/s), a real sprint stride for greens.
      anim.baseStride = (anim.gait === "sprint" ? 3.0 : 1.9) * anim.strideJitter;
      anim.stride = anim.baseStride;
      anim.legLength = 0.87 * SHAPES[ap.shapeKey].hs;
    }

    // Pose helpers: write target rotations.
    function set(pose, bone, x, y, z) { pose[bone * 3] = x; pose[bone * 3 + 1] = y; pose[bone * 3 + 2] = z; }
    function add(pose, bone, x, y, z) { pose[bone * 3] += x; pose[bone * 3 + 1] += y; pose[bone * 3 + 2] += z; }

    function smooth01(t) { const c = Math.min(1, Math.max(0, t)); return c * c * (3 - 2 * c); }

    // Base posture shared by idle and walk: hunched, head up to look
    // ahead, shoulders rolled forward, one maybe dropped, head tilted.
    function basePosture(anim, pose, detail) {
      const h = anim.hunch;
      set(pose, B.spine, h * 0.5, 0, 0);
      set(pose, B.chest, h * 0.6, 0, 0);
      set(pose, B.neck, -h * 0.4, 0, 0);
      set(pose, B.head, -h * 0.45, 0, anim.headTilt);
      const dropL = anim.shoulderDrop > 0 ? -anim.shoulderDrop : 0;
      const dropR = anim.shoulderDrop < 0 ? anim.shoulderDrop : 0;
      set(pose, B.clavL, 0, -0.15, 0.05 + dropL);
      set(pose, B.clavR, 0, 0.15, -(0.05 + dropR));
    }

    function armPose(anim, pose, swingL, swingR, raiseScale, t, detail) {
      const style = anim.armStyle;
      const side = anim.armSide;
      for (const s of [1, -1]) {
        const L = s > 0;
        const ua = L ? B.upperArmL : B.upperArmR, fa = L ? B.forearmL : B.forearmR, hd = L ? B.handL : B.handR;
        const swing = L ? swingL : swingR;
        let raise = 0, bend = -0.28, droop = 0.2, out = 0.1;
        if ((style === "reach" && s === side) || style === "half") {
          raise = (style === "reach" ? -1.2 : s === side ? -0.85 : -0.6) * raiseScale;
          bend = style === "reach" ? -0.35 : -0.6;
          droop = 0.45;
          out = 0.14;
        }
        const bob = detail ? 0.06 * Math.sin(t * 2.3 + s) : 0;
        set(pose, ua, raise - 0.08 + swing + bob, 0, s * out);
        set(pose, fa, bend - 0.12 * Math.max(0, Math.sin(anim.walkPhase + 1 + s)), 0, 0);
        set(pose, hd, droop, 0, -s * 0.1);
      }
    }

    // ------------------------------------------------------------------
    // WALK. One base cycle (the legs, locked to distance travelled so the
    // feet stay planted) plus coordinated offsets that all read that same
    // cycle, each a little later than the part below it -- legs -> hips ->
    // spine -> chest -> shoulders -- so motion ripples up the body instead
    // of everything peaking at once. The arms, head and a torso roll ride
    // on cheap springs (SPRING_*): they follow their target with a lag and
    // a little overshoot, which is what reads as loose, heavy limbs.
    // `level`: 0 full detail, 1 reduced, 2 far (base cycle only).
    // ------------------------------------------------------------------
    const SPRING_ARM_L = 0, SPRING_ARM_R = 1, SPRING_HEAD_YAW = 2, SPRING_HEAD_PITCH = 3, SPRING_TORSO_ROLL = 4;
    const SPRING_COUNT = 5;
    // Damped spring toward `target` (freq Hz, damping ratio), substepped so
    // the slower update rates of the animation LOD stay stable.
    function spring(anim, index, target, freq, damping, dt, level) {
      const sp = anim.springs;
      const i = index * 2;
      if (level >= 2) { sp[i] = target; sp[i + 1] = 0; return target; }
      const w = 2 * Math.PI * freq;
      const steps = Math.min(4, Math.ceil(dt * 60));
      const h = dt / steps;
      let x = sp[i], v = sp[i + 1];
      for (let k = 0; k < steps; k++) {
        v += (w * w * (target - x) - 2 * damping * w * v) * h;
        x += v * h;
      }
      sp[i] = x;
      sp[i + 1] = v;
      return x;
    }
    const springVel = (anim, index) => anim.springs[index * 2 + 1];

    // gaitAmp: 0..1 -- how far into walking (idle -> walk ramps it up, so the
    // first steps are small and the last ones settle).
    function walkPose(anim, pose, level, dt, gaitAmp) {
      const p = anim.walkPhase;
      const pw = p + anim.strideWarp * Math.sin(p); // uneven rhythm (limpers most)
      const s = Math.sin(pw), c = Math.cos(pw);
      basePosture(anim, pose, level === 0);
      // --- Legs (the base cycle) ---
      const legAmp = Math.min(0.6, Math.asin(Math.min(0.9, anim.stride / 4 / anim.legLength))) * (0.35 + 0.65 * gaitAmp);
      const ampL = anim.limpSide > 0 ? anim.limp : 1;
      const ampR = anim.limpSide < 0 ? anim.limp : 1;
      const thighL = -legAmp * s * ampL - 0.06;
      const thighR = legAmp * s * ampR - 0.06;
      const kneeL = 0.1 + 0.65 * Math.pow(Math.max(0, c), 1.3) * ampL * ampL * gaitAmp;
      const kneeR = 0.1 + 0.65 * Math.pow(Math.max(0, -c), 1.3) * ampR * ampR * gaitAmp;
      set(pose, B.thighL, thighL, 0, 0.02);
      set(pose, B.thighR, thighR, 0, -0.02);
      set(pose, B.shinL, kneeL, 0, 0);
      set(pose, B.shinR, kneeR, 0, 0);
      set(pose, B.footL, -(thighL + kneeL) * 0.85 + (anim.limpSide > 0 ? 0.18 * Math.max(0, c) : 0), 0, 0);
      set(pose, B.footR, -(thighR + kneeR) * 0.85 + (anim.limpSide < 0 ? 0.18 * Math.max(0, -c) : 0), 0, 0);

      // --- Weight ---
      // A foot lands at each leg's forward extreme (s = +/-1). `land` peaks
      // just after each landing: the body sinks into the planted leg, then
      // rises through push-off into the next stride.
      const land = 0.5 + 0.5 * Math.cos(2 * (pw - Math.PI / 2) - 0.6);
      const landLate = 0.5 + 0.5 * Math.cos(2 * (pw - Math.PI / 2) - 1.2); // the torso feels it a beat later
      const spread = Math.max(Math.abs(thighL), Math.abs(thighR));
      let dip = -0.3 * anim.legLength * (1 - Math.cos(spread)) - 0.006 - 0.02 * land * gaitAmp + 0.006 * (1 - land) * gaitAmp;
      if (anim.limpSide) dip -= 0.035 * Math.max(0, anim.limpSide > 0 ? -c : c) * gaitAmp;
      // Hips drift over the planted leg (it's the left one around pw = pi),
      // lagging the legs; the free side's hip sags a little -- unsteady hips.
      const hipLag = pw - 0.25;
      anim.hipsOffsetTarget.set(-0.03 * Math.cos(hipLag) * gaitAmp, dip, 0.015 + 0.01 * land * gaitAmp);
      set(pose, B.hips, 0.02, -0.09 * Math.sin(hipLag) * gaitAmp,
        (0.045 * Math.cos(hipLag - 0.1) + (anim.limpSide ? 0.05 * anim.limpSide * Math.max(0, anim.limpSide > 0 ? -c : c) : 0)) * gaitAmp);

      // --- Torso: counter-twist and side-sway, rippling upward ---
      const sway = anim.torsoSway * gaitAmp;
      const roll = spring(anim, SPRING_TORSO_ROLL, -0.04 * Math.cos(pw - 0.5) * sway, 2.2, 0.5, dt, level);
      add(pose, B.spine, 0.02 * landLate * gaitAmp, 0.07 * Math.sin(pw - 0.45) * sway, roll);
      add(pose, B.chest, 0.025 * landLate * gaitAmp, 0.05 * Math.sin(pw - 0.75) * sway, -0.5 * roll);
      // Shoulders roll with the chest and drop as the weight lands.
      const shoulderRoll = 0.07 * Math.sin(pw - 0.95) * sway;
      add(pose, B.clavL, 0, -shoulderRoll, -0.03 * landLate * gaitAmp);
      add(pose, B.clavR, 0, -shoulderRoll, 0.03 * landLate * gaitAmp);

      // --- Head: settles on a spring, lagging the body, eyes kept ahead ---
      const chestYaw = 0.05 * Math.sin(pw - 0.75) * sway + 0.07 * Math.sin(pw - 0.45) * sway;
      const turnLead = Math.max(-0.35, Math.min(0.35, anim.turnRate * 0.22));
      const headYaw = spring(anim, SPRING_HEAD_YAW, -0.6 * chestYaw + turnLead, anim.headFreq, 0.55, dt, level);
      const headPitch = spring(anim, SPRING_HEAD_PITCH, 0.035 * landLate * gaitAmp, anim.headFreq, 0.45, dt, level);
      add(pose, B.head, headPitch, headYaw, -0.4 * roll);
      add(pose, B.neck, 0, 0.3 * headYaw, 0);

      // --- Arms: loose, uneven, trailing the shoulders ---
      walkArms(anim, pose, pw, land, gaitAmp, level, dt);
    }

    // Each arm's swing is a spring chasing the walk (opposite its leg, a
    // beat behind the shoulders), so it lags and overshoots like a dead
    // weight. Elbows fold as the arm swings forward and hands flop behind
    // the forearm -- both driven by that arm's own swing velocity, so they
    // react to the arm's motion rather than a separate wave.
    function walkArms(anim, pose, pw, land, gaitAmp, level, dt) {
      const style = anim.armStyle;
      const side = anim.armSide;
      for (const sgn of [1, -1]) {
        const L = sgn > 0;
        const ua = L ? B.upperArmL : B.upperArmR, fa = L ? B.forearmL : B.forearmR, hd = L ? B.handL : B.handR;
        const raised = (style === "reach" && sgn === side) || style === "half";
        let raise = 0, bend = -0.28, droop = 0.2, out = 0.1;
        if (raised) {
          raise = style === "reach" ? -1.2 : sgn === side ? -0.85 : -0.6;
          bend = style === "reach" ? -0.35 : -0.6;
          droop = 0.45;
          out = 0.14;
        }
        const amount = (L ? anim.armSwingL : anim.armSwingR) * (raised ? 0.4 : 1) * gaitAmp;
        // Left leg forward (sin > 0) -> left arm back (+x). Weight landing
        // throws the hanging arms forward a little.
        const target = sgn * 0.26 * amount * Math.sin(pw - 0.9) - 0.05 * land * gaitAmp;
        const swing = spring(anim, L ? SPRING_ARM_L : SPRING_ARM_R, target, anim.armFreq, 0.4, dt, level);
        const vel = level >= 2 ? 0 : springVel(anim, L ? SPRING_ARM_L : SPRING_ARM_R);
        const elbow = Math.max(-0.3, Math.min(0.12, 0.12 * vel)) * anim.elbowLoose;
        const flop = level === 0 ? Math.max(-0.25, Math.min(0.25, -0.1 * vel)) : 0;
        set(pose, ua, raise - 0.08 + swing, sgn * 0.12 * swing, sgn * (out + 0.03 * land * gaitAmp));
        set(pose, fa, bend + elbow, 0, 0);
        set(pose, hd, droop + flop, 0, -sgn * 0.1);
      }
    }

    // Sprint (green zombies): leaning into it, high knees, long reaching
    // strides with a flight phase, arms pumping hard with bent elbows --
    // still a little ragged (uneven arm pump, tilted head) so it reads as
    // a frenzied zombie rather than an athlete.
    function sprintPose(anim, pose, detail) {
      const p = anim.walkPhase;
      const s = Math.sin(p), c = Math.cos(p);
      set(pose, B.spine, 0.32, 0.14 * s, 0);
      set(pose, B.chest, 0.14, 0.1 * s, 0);
      set(pose, B.neck, -0.25, 0, 0);
      set(pose, B.head, -0.32 + 0.05 * Math.sin(2 * p), -0.08 * s, anim.headTilt * 0.5);
      set(pose, B.clavL, 0, -0.1 + 0.08 * s, 0.05);
      set(pose, B.clavR, 0, 0.1 + 0.08 * s, -0.05);
      const amp = 0.85;
      // Left leg forward while s > 0; a forward bias so the knees drive up.
      const thighL = -amp * s - 0.25;
      const thighR = amp * s - 0.25;
      // The recovering (forward-swinging) leg folds tight under the hips.
      const kneeL = 0.3 + 1.5 * Math.pow(Math.max(0, c), 1.2);
      const kneeR = 0.3 + 1.5 * Math.pow(Math.max(0, -c), 1.2);
      set(pose, B.thighL, thighL, 0, 0.03);
      set(pose, B.thighR, thighR, 0, -0.03);
      set(pose, B.shinL, kneeL, 0, 0);
      set(pose, B.shinR, kneeR, 0, 0);
      set(pose, B.footL, -(thighL + kneeL) * 0.6 + 0.15, 0, 0);
      set(pose, B.footR, -(thighR + kneeR) * 0.6 + 0.15, 0, 0);
      // Lowest at mid-stance, airborne between strides; hips twist with the legs.
      anim.hipsOffsetTarget.set(-0.015 * c, -0.07 + 0.06 * s * s, 0.05);
      set(pose, B.hips, 0.05, -0.18 * s, 0.04 * c);
      // Arms pump opposite the legs, elbows bent near 90 degrees.
      set(pose, B.upperArmL, 0.85 * s - 0.1, 0, 0.12);
      set(pose, B.upperArmR, -0.7 * s - 0.1, 0, -0.12);
      set(pose, B.forearmL, -1.35 - 0.35 * Math.max(0, -s), 0, 0);
      set(pose, B.forearmR, -1.35 - 0.35 * Math.max(0, s), 0, 0);
      set(pose, B.handL, 0.25, 0, -0.1);
      set(pose, B.handR, 0.25, 0, 0.1);
      if (detail) add(pose, B.head, 0, 0.06 * Math.sin(anim.time * 3.1 + anim.swayPhase), 0);
    }

    function idlePose(anim, pose, detail, dt) {
      const t = anim.time;
      basePosture(anim, pose, detail);
      set(pose, B.thighL, -0.07, 0, 0.03);
      set(pose, B.thighR, -0.05, 0, -0.03);
      set(pose, B.shinL, 0.14, 0, 0);
      set(pose, B.shinR, 0.12, 0, 0);
      set(pose, B.footL, -0.07, 0, 0);
      set(pose, B.footR, -0.07, 0, 0);
      anim.hipsOffsetTarget.set(0, -0.015, 0);
      // Slow heavy breathing.
      const breathe = Math.sin(t * 1.7);
      add(pose, B.chest, 0.025 * breathe, 0, 0);
      armPose(anim, pose, 0.04 * Math.sin(t * 1.1), -0.04 * Math.sin(t * 1.3), 0.7, t, detail);
      if (!detail) return;
      anim.idleTimer -= dt;
      if (anim.idleTimer <= 0) {
        anim.idleTimer = rand(6, 14);
        anim.idleIndex = Math.floor(Math.random() * 4);
      }
      switch (anim.idleIndex) {
        case 0: // heavier, ragged breathing
          add(pose, B.chest, 0.035 * breathe, 0, 0);
          add(pose, B.clavL, 0, 0, 0.04 * breathe);
          add(pose, B.clavR, 0, 0, -0.04 * breathe);
          break;
        case 1: // head slowly looking around
          add(pose, B.head, 0.1 * Math.sin(t * 0.23), 0.45 * Math.sin(t * 0.33), 0);
          add(pose, B.neck, 0, 0.15 * Math.sin(t * 0.33), 0);
          break;
        case 2: { // a shoulder sagging, body swaying, arms dangling
          const sag = anim.armSide > 0 ? B.clavL : B.clavR;
          add(pose, sag, 0, 0, -anim.armSide * 0.14);
          add(pose, B.spine, 0, 0, 0.07 * Math.sin(t * 0.4));
          add(pose, B.upperArmL, 0.1 * Math.sin(t * 0.8), 0, 0);
          add(pose, B.upperArmR, 0.1 * Math.sin(t * 0.8 + 1), 0, 0);
          break;
        }
        case 3: { // weight shifting from leg to leg
          const w = Math.sin(t * 0.45);
          anim.hipsOffsetTarget.x = 0.04 * w;
          add(pose, B.hips, 0, 0, -0.04 * w);
          add(pose, B.shinL, 0.15 * Math.max(0, -w), 0, 0);
          add(pose, B.shinR, 0.15 * Math.max(0, w), 0, 0);
          add(pose, B.thighL, -0.08 * Math.max(0, -w), 0, 0);
          add(pose, B.thighR, -0.08 * Math.max(0, w), 0, 0);
          break;
        }
      }
    }

    // Occasional twitch: a quick jerk of the head, a shoulder or the chest.
    function applyTwitch(anim, pose, dt) {
      anim.twitchTimer -= dt;
      if (anim.twitchTimer <= 0) {
        anim.twitchTimer = rand(4, 11);
        const bone = pick([B.head, B.head, B.clavL, B.clavR, B.chest]);
        anim.twitch = { bone, axis: Math.floor(Math.random() * 3), amount: rand(-0.35, 0.35), t: 0 };
      }
      const tw = anim.twitch;
      if (!tw) return;
      tw.t += dt;
      const k = tw.t < 0.06 ? tw.t / 0.06 : Math.exp(-(tw.t - 0.06) * 12);
      pose[tw.bone * 3 + tw.axis] += tw.amount * k;
      if (tw.t > 0.6) anim.twitch = null;
    }

    // ATTACKS: anticipation -> fast strike -> follow-through -> recovery.
    // Anticipation comes from windup (set while closing in on a target
    // with the hit cooldown nearly up); the strike itself starts on the
    // game's own damage event (triggerAttack), so it lands with the hit.
    // Keys: [bone, x, y, z] (sideways values mirrored by `side`).
    const ATTACKS = {
      swipe: {
        windup: (s) => [[s > 0 ? B.upperArmL : B.upperArmR, -1.9, 0, s * 0.6], [s > 0 ? B.forearmL : B.forearmR, -1.2, 0, 0], [s > 0 ? B.handL : B.handR, -0.2, 0, 0],
          [B.chest, 0.15, s * 0.45, 0], [B.spine, 0.15, s * 0.2, 0], [B.head, -0.3, -s * 0.2, 0]],
        strike: (s) => [[s > 0 ? B.upperArmL : B.upperArmR, -1.15, 0, -s * 0.35], [s > 0 ? B.forearmL : B.forearmR, -0.3, 0, 0], [s > 0 ? B.handL : B.handR, 0.35, 0, 0],
          [B.chest, 0.35, -s * 0.5, 0], [B.spine, 0.3, -s * 0.25, 0], [B.head, -0.25, s * 0.1, 0]],
        follow: (s) => [[s > 0 ? B.upperArmL : B.upperArmR, -0.55, 0, -s * 0.55], [s > 0 ? B.forearmL : B.forearmR, -0.5, 0, 0], [s > 0 ? B.handL : B.handR, 0.4, 0, 0],
          [B.chest, 0.4, -s * 0.6, 0], [B.spine, 0.32, -s * 0.3, 0]],
        lunge: 0.08,
      },
      grab: {
        windup: () => [[B.upperArmL, -1.45, 0, 0.6], [B.upperArmR, -1.45, 0, -0.6], [B.forearmL, -0.9, 0, 0], [B.forearmR, -0.9, 0, 0],
          [B.chest, 0.0, 0, 0], [B.spine, 0.05, 0, 0], [B.head, -0.3, 0, 0]],
        strike: () => [[B.upperArmL, -1.45, 0, 0.05], [B.upperArmR, -1.45, 0, -0.05], [B.forearmL, -0.25, 0, 0], [B.forearmR, -0.25, 0, 0],
          [B.handL, 0.1, 0, 0], [B.handR, 0.1, 0, 0], [B.chest, 0.3, 0, 0], [B.spine, 0.35, 0, 0], [B.head, -0.35, 0, 0]],
        follow: () => [[B.upperArmL, -1.2, 0, -0.05], [B.upperArmR, -1.2, 0, 0.05], [B.forearmL, -0.7, 0, 0], [B.forearmR, -0.7, 0, 0],
          [B.chest, 0.4, 0, 0], [B.spine, 0.4, 0, 0]],
        lunge: 0.12,
      },
      downswing: {
        windup: () => [[B.upperArmL, -2.75, 0, 0.25], [B.upperArmR, -2.75, 0, -0.25], [B.forearmL, -0.7, 0, 0], [B.forearmR, -0.7, 0, 0],
          [B.chest, -0.15, 0, 0], [B.spine, -0.05, 0, 0], [B.head, -0.1, 0, 0], [B.shinL, 0.2, 0, 0], [B.shinR, 0.2, 0, 0]],
        strike: () => [[B.upperArmL, -0.95, 0, 0.12], [B.upperArmR, -0.95, 0, -0.12], [B.forearmL, -0.2, 0, 0], [B.forearmR, -0.2, 0, 0],
          [B.chest, 0.4, 0, 0], [B.spine, 0.45, 0, 0], [B.head, 0.1, 0, 0], [B.shinL, 0.4, 0, 0], [B.shinR, 0.35, 0, 0],
          [B.thighL, -0.3, 0, 0.03], [B.thighR, -0.25, 0, -0.03]],
        follow: () => [[B.upperArmL, -0.45, 0, 0.12], [B.upperArmR, -0.45, 0, -0.12], [B.forearmL, -0.35, 0, 0], [B.forearmR, -0.35, 0, 0],
          [B.chest, 0.45, 0, 0], [B.spine, 0.5, 0, 0], [B.shinL, 0.35, 0, 0], [B.shinR, 0.3, 0, 0], [B.thighL, -0.25, 0, 0], [B.thighR, -0.2, 0, 0]],
        lunge: 0.05,
        drop: 0.08,
      },
      lunge: {
        windup: (s) => [[B.upperArmL, -0.9, 0, 0.2], [B.upperArmR, -0.9, 0, -0.2], [B.forearmL, -1.0, 0, 0], [B.forearmR, -1.0, 0, 0],
          [B.spine, 0.05, 0, 0], [B.shinL, 0.45, 0, 0], [B.shinR, 0.45, 0, 0], [B.thighL, -0.3, 0, 0], [B.thighR, -0.3, 0, 0], [B.head, -0.4, 0, 0]],
        strike: (s) => [[B.upperArmL, -1.5, 0, 0.1], [B.upperArmR, -1.5, 0, -0.1], [B.forearmL, -0.15, 0, 0], [B.forearmR, -0.15, 0, 0],
          [B.spine, 0.4, 0, 0], [B.chest, 0.25, 0, 0], [s > 0 ? B.thighL : B.thighR, -0.55, 0, 0], [s > 0 ? B.shinL : B.shinR, 0.5, 0, 0],
          [s > 0 ? B.thighR : B.thighL, 0.3, 0, 0], [s > 0 ? B.shinR : B.shinL, 0.15, 0, 0], [B.head, -0.45, 0, 0]],
        follow: (s) => [[B.upperArmL, -1.1, 0, 0.1], [B.upperArmR, -1.1, 0, -0.1], [B.forearmL, -0.6, 0, 0], [B.forearmR, -0.6, 0, 0],
          [B.spine, 0.45, 0, 0], [B.chest, 0.3, 0, 0], [s > 0 ? B.thighL : B.thighR, -0.45, 0, 0], [s > 0 ? B.shinL : B.shinR, 0.45, 0, 0]],
        lunge: 0.2,
        drop: 0.06,
      },
    };
    const ATTACK_TYPES = Object.keys(ATTACKS);
    const ATTACK_TIMES = { strike: 0.09, follow: 0.22, recover: 0.5 };

    function triggerAttack(model, type, timeScale = 1) {
      const anim = model.anim;
      anim.attack = {
        type: type || anim.nextAttackType || pick(ATTACK_TYPES),
        side: anim.nextAttackSide || pick([1, -1]),
        t: 0,
        scale: timeScale,
      };
      anim.nextAttackType = null;
    }

    function blendKeys(pose, keys, weight) {
      if (weight <= 0) return;
      for (const [bone, x, y, z] of keys) {
        const i = bone * 3;
        pose[i] += (x - pose[i]) * weight;
        pose[i + 1] += (y - pose[i + 1]) * weight;
        pose[i + 2] += (z - pose[i + 2]) * weight;
      }
    }

    function applyAttack(anim, pose, dt) {
      // Anticipation: the next attack's type/side is chosen as soon as
      // the wind-up begins, so the strike continues the same motion.
      anim.windup += (anim.windupTarget - anim.windup) * Math.min(1, dt * 6);
      anim.windupTarget = 0; // re-armed every frame by the game while it still applies
      const atk = anim.attack;
      if (!atk) {
        if (anim.windup > 0.01) {
          if (!anim.nextAttackType) {
            anim.nextAttackType = pick(ATTACK_TYPES);
            anim.nextAttackSide = pick([1, -1]);
          }
          const def = ATTACKS[anim.nextAttackType];
          blendKeys(pose, def.windup(anim.nextAttackSide), anim.windup * 0.85);
          anim.hipsOffsetTarget.z -= 0.03 * anim.windup;
        } else {
          anim.nextAttackType = null;
        }
        return 0;
      }
      atk.t += dt / atk.scale;
      const def = ATTACKS[atk.type];
      const s = atk.side;
      const T = ATTACK_TIMES;
      let smoothing = 30;
      if (atk.t < T.strike) {
        const k = smooth01(atk.t / T.strike);
        blendKeys(pose, def.windup(s), 1);
        blendKeys(pose, def.strike(s), k);
        anim.hipsOffsetTarget.z += def.lunge * k;
      } else if (atk.t < T.follow) {
        const k = smooth01((atk.t - T.strike) / (T.follow - T.strike));
        blendKeys(pose, def.strike(s), 1);
        blendKeys(pose, def.follow(s), k);
        anim.hipsOffsetTarget.z += def.lunge;
        anim.hipsOffsetTarget.y -= (def.drop || 0) * k;
      } else if (atk.t < T.recover) {
        const k = 1 - smooth01((atk.t - T.follow) / (T.recover - T.follow));
        blendKeys(pose, def.follow(s), k);
        anim.hipsOffsetTarget.z += def.lunge * k;
        anim.hipsOffsetTarget.y -= (def.drop || 0) * k;
        smoothing = 14;
      } else {
        anim.attack = null;
        smoothing = 12;
      }
      return smoothing;
    }

    // The older clips (boss slam/grab/throw, brute pickup/hold/throw,
    // carried/thrown) are authored for the old 6-part body: head, torso,
    // arms and legs. Mapped onto the new rig, with natural elbow/knee bends.
    function applyLegacyPose(anim, pose, legacy) {
      basePosture(anim, pose, false);
      pose.fill(0, B.thighL * 3); // legs straight unless the clip says otherwise
      set(pose, B.upperArmL, legacy.leftArm.x, legacy.leftArm.y, legacy.leftArm.z);
      set(pose, B.upperArmR, legacy.rightArm.x, legacy.rightArm.y, legacy.rightArm.z);
      set(pose, B.forearmL, -0.3, 0, 0);
      set(pose, B.forearmR, -0.3, 0, 0);
      set(pose, B.handL, 0.1, 0, 0);
      set(pose, B.handR, 0.1, 0, 0);
      set(pose, B.thighL, legacy.leftLeg.x, legacy.leftLeg.y, legacy.leftLeg.z);
      set(pose, B.thighR, legacy.rightLeg.x, legacy.rightLeg.y, legacy.rightLeg.z);
      set(pose, B.shinL, 0.1 + Math.max(0, -legacy.leftLeg.x) * 0.6, 0, 0);
      set(pose, B.shinR, 0.1 + Math.max(0, -legacy.rightLeg.x) * 0.6, 0, 0);
      add(pose, B.spine, legacy.torso.x * 0.5, legacy.torso.y, legacy.torso.z);
      add(pose, B.chest, legacy.torso.x * 0.5, 0, 0);
      add(pose, B.head, legacy.head.x, legacy.head.y, legacy.head.z);
      anim.hipsOffsetTarget.set(0, 0, 0);
    }

    // Occasional slow posture shifts while moving (a shoulder sags, the head
    // tilts, the lean changes), eased in over a couple of seconds.
    function applyPostureShift(anim, pose, dt) {
      anim.postureTimer -= dt;
      if (anim.postureTimer <= 0) {
        anim.postureTimer = rand(6, 15);
        anim.postureTarget[0] = rand(-0.07, 0.07);
        anim.postureTarget[1] = rand(-0.09, 0.09);
        anim.postureTarget[2] = rand(-0.03, 0.06);
      }
      const k = Math.min(1, dt * 0.8);
      for (let i = 0; i < 3; i++) anim.posture[i] += (anim.postureTarget[i] - anim.posture[i]) * k;
      add(pose, B.clavL, 0, 0, Math.min(0, anim.posture[0]));
      add(pose, B.clavR, 0, 0, -Math.max(0, anim.posture[0]));
      add(pose, B.head, 0, 0, anim.posture[1]);
      add(pose, B.spine, anim.posture[2], 0, 0);
    }

    // Hit reaction: a quick jolt back and a twist toward the hit side, over
    // in about half a second, layered on whatever the zombie is doing.
    function flinch(model, side = 0) {
      model.anim.flinch = { t: 0, side: side || (Math.random() < 0.5 ? -1 : 1) };
    }
    function applyFlinch(anim, pose, dt) {
      const f = anim.flinch;
      if (!f) return false;
      f.t += dt;
      const k = f.t < 0.06 ? f.t / 0.06 : Math.exp(-(f.t - 0.06) * 8);
      add(pose, B.spine, -0.12 * k, 0.2 * f.side * k, 0);
      add(pose, B.chest, -0.22 * k, 0.1 * f.side * k, 0);
      add(pose, B.head, -0.3 * k, -0.15 * f.side * k, 0.1 * f.side * k);
      add(pose, B.upperArmL, 0.25 * k, 0, 0.15 * k);
      add(pose, B.upperArmR, 0.25 * k, 0, -0.15 * k);
      anim.hipsOffsetTarget.z -= 0.05 * k;
      if (f.t > 0.55) anim.flinch = null;
      return true;
    }

    // Faster zombies (harder difficulties, fast variants) take longer strides
    // instead of just stepping faster: cadence only grows with the cube root
    // of the extra speed, so they stride out smoothly rather than scurry.
    function strideFor(anim, speed) {
      if (!speed) return anim.baseStride;
      const ref = anim.gait === "sprint" ? SPRINT_REF_SPEED : WALK_REF_SPEED;
      const ratio = Math.min(2.2, Math.max(0.6, speed / ref));
      return anim.baseStride * Math.pow(ratio, 0.66);
    }

    // context: { movedDistance, isWalking, sizeScale, speed, yaw, distance, legacyPose, legacySmoothing }
    function update(model, deltaSeconds, context) {
      const anim = model.anim;

      // Model LOD by distance to the nearest viewer.
      const d = context.distance;
      let lod = model.lod;
      if (lod === 0 && d > LOD_DISTANCES[0] + LOD_HYSTERESIS) lod = 1;
      if (lod === 1 && d < LOD_DISTANCES[0] - LOD_HYSTERESIS) lod = 0;
      if (lod === 1 && d > LOD_DISTANCES[1] + LOD_HYSTERESIS) lod = 2;
      if (lod === 2 && d < LOD_DISTANCES[1] - LOD_HYSTERESIS) lod = 1;
      if (lod !== model.lod) setLod(model, lod);

      // Walk phase always advances with the real distance moved (feet stay
      // planted whatever the update rate).
      if (context.isWalking) {
        anim.stride = strideFor(anim, context.speed);
        anim.walkPhase = (anim.walkPhase + (context.movedDistance / (anim.stride * context.sizeScale)) * Math.PI * 2) % (Math.PI * 2);
      }

      // Animation LOD: skip frames at range, carrying the time over.
      anim.accum += deltaSeconds;
      anim.frame++;
      const busy = anim.attack || context.legacyPose || anim.flinch;
      const interval = busy ? 1 : LOD_UPDATE_INTERVAL[lod];
      if (anim.frame % interval !== 0) return;
      const dt = anim.accum;
      anim.accum = 0;
      anim.time += dt * anim.speed;

      const detail = lod === 0;
      const level = lod; // secondary-motion level: 0 full, 1 reduced, 2 base only
      const pose = anim.pose;

      // Turn rate (rad/s, smoothed) -- the head leads into turns, see walkPose.
      if (context.yaw !== undefined) {
        if (anim.prevYaw !== null && dt > 0) {
          let dy = context.yaw - anim.prevYaw;
          dy = ((dy + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
          anim.turnRate += (dy / dt - anim.turnRate) * Math.min(1, dt * 6);
        }
        anim.prevYaw = context.yaw;
      }

      // The walk carries its own timing (lags, springs), so the final
      // per-bone easing only needs to be quick; transitions come from walkBlend.
      let smoothing = anim.gait === "sprint" && anim.walkBlend > 0.5 ? 24 : 20;
      pose.fill(0);
      if (context.legacyPose) {
        applyLegacyPose(anim, pose, context.legacyPose);
        smoothing = context.legacySmoothing || 12;
        anim.attack = null;
        anim.windup = 0;
      } else {
        // Idle <-> walk: both poses are built and cross-faded while the zombie
        // starts or stops (never a hard switch), and the stride's size ramps
        // with it -- small first steps, settling last steps.
        anim.walkBlend += ((context.isWalking ? 1 : 0) - anim.walkBlend) * Math.min(1, dt * 4);
        if (anim.walkBlend > 0.995) anim.walkBlend = 1;
        if (anim.walkBlend < 0.005) anim.walkBlend = 0;
        const wb = smooth01(anim.walkBlend);
        if (wb < 1) {
          anim.idlePose.fill(0);
          idlePose(anim, anim.idlePose, detail, dt);
          anim.idleHips.copy(anim.hipsOffsetTarget);
        }
        if (wb > 0) {
          if (anim.gait === "sprint") sprintPose(anim, pose, detail);
          else walkPose(anim, pose, level, dt, wb);
          if (wb < 1) {
            const ip = anim.idlePose;
            for (let i = 0; i < pose.length; i++) pose[i] = ip[i] + (pose[i] - ip[i]) * wb;
            anim.hipsOffsetTarget.lerp(anim.idleHips, 1 - wb);
          }
          // Getting going leans into the first step; pulling up rocks back.
          const rising = anim.walkBlend - anim.prevWalkBlend;
          add(pose, B.spine, Math.sign(rising) * 0.12 * 4 * anim.walkBlend * (1 - anim.walkBlend), 0, 0);
          // Leaning into turns.
          add(pose, B.spine, 0, 0, -Math.max(-0.08, Math.min(0.08, anim.turnRate * 0.04)) * wb);
        } else {
          pose.set(anim.idlePose);
        }
        anim.prevWalkBlend = anim.walkBlend;
        if (level <= 1 && wb > 0) applyPostureShift(anim, pose, dt);
        if (detail) applyTwitch(anim, pose, dt);
        const attackSmoothing = applyAttack(anim, pose, dt);
        if (attackSmoothing) smoothing = attackSmoothing;
        if (applyFlinch(anim, pose, dt)) smoothing = Math.max(smoothing, 24);
      }

      const blend = 1 - Math.exp(-smoothing * dt);
      const bones = model.bones;
      for (let i = 0; i < BONE_COUNT; i++) {
        const r = bones[i].rotation;
        r.x += (pose[i * 3] - r.x) * blend;
        r.y += (pose[i * 3 + 1] - r.y) * blend;
        r.z += (pose[i * 3 + 2] - r.z) * blend;
      }
      anim.hipsOffset.lerp(anim.hipsOffsetTarget, blend);
      const rest = shapeData[model.shapeKey].localRest[0];
      bones[0].position.copy(rest).add(anim.hipsOffset);
      for (let i = 0; i < BONE_COUNT; i++) bones[i].updateMatrix();
    }

    function setWindup(model, active) {
      if (active) model.anim.windupTarget = 1;
    }

    return {
      acquire,
      release,
      randomAppearance,
      applyAppearance,
      update,
      triggerAttack,
      setWindup,
      flinch,
      bodyMaterial,
      stats: () => ({ pooled: pool.length, shapes: SHAPE_KEYS.length }),
      triangleCounts: () => SHAPE_KEYS.map((k) => shapeData[k].lods.map((l) => l.geometry.index.count / 3)),
    };
  }

  window.createZombieSystem = createZombieSystem;
})();
