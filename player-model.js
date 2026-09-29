// Player model: the co-op players' third-person bodies -- a realistic,
// low-poly human (clothing -- a picked shirt and pants, see CLOTHING -- and
// a helmet over the head -- one of 16, from a paper bag to a motorcycle
// helmet, see HELMETS -- with the PNG face pasted on its front)
// on the same 19-bone rig
// layout as the zombies (zombie-model.js), with human locomotion (walk ->
// run -> sprint on one continuous gait), crouch/slide/jump, hit and death
// reactions, and a third-person weapon both hands actually hold (two-bone
// arm IK onto the weapon's grips). Purely visual: movement, combat and
// input all stay in index.html, which feeds update() the player's state
// every frame.
//
// Usage: const humans = createHumanSystem(THREE, { getFace });
//   const character = humans.createCharacter(humans.randomAppearance(i), faceKey, layer);
//   scene.add(character.root);   // root origin = the feet, +Z forward
//   humans.setFace(character, key); humans.setHelmet(character, helmetKey);
//   humans.setClothing(character, shirtKey, pantsKey);
//   humans.setWeapon(character, weaponId);
//   humans.update(character, dt, state);   // see update() for `state`
//
// PERFORMANCE: at most two players (plus two tiny setup-screen previews)
// ever exist, so each gets its own geometry (clothing baked in as vertex
// colors and shape) -- one shared skinned material, one shared matte face
// material per face picture, shared weapon geometry. Two model LODs, and
// animation LOD (fewer updates, no secondary springs) at range.
(function () {
  "use strict";

  function createHumanSystem(THREE, options) {
    const getFace = options.getFace;

    // ------------------------------------------------------------------
    // RIG -- same bone order/names as zombie-model.js. Absolute joint
    // positions in meters above the soles for an average build; each
    // character's height/build scales them (see jointsFor).
    // Local +Z is forward, +X is the character's own left.
    // ------------------------------------------------------------------
    const BONES = [
      { name: "hips", parent: -1, pos: [0, 0.97, 0] },
      { name: "spine", parent: 0, pos: [0, 1.1, 0] },
      { name: "chest", parent: 1, pos: [0, 1.28, 0.01] },
      { name: "neck", parent: 2, pos: [0, 1.475, 0] },
      { name: "head", parent: 3, pos: [0, 1.555, 0.01] },
      { name: "clavL", parent: 2, pos: [0.03, 1.45, 0] },
      { name: "upperArmL", parent: 5, pos: [0.185, 1.44, -0.015] },
      { name: "forearmL", parent: 6, pos: [0.19, 1.155, -0.02] },
      { name: "handL", parent: 7, pos: [0.19, 0.905, 0] },
      { name: "clavR", parent: 2, pos: [-0.03, 1.45, 0] },
      { name: "upperArmR", parent: 9, pos: [-0.185, 1.44, -0.015] },
      { name: "forearmR", parent: 10, pos: [-0.19, 1.155, -0.02] },
      { name: "handR", parent: 11, pos: [-0.19, 0.905, 0] },
      { name: "thighL", parent: 0, pos: [0.092, 0.93, 0] },
      { name: "shinL", parent: 13, pos: [0.092, 0.505, 0.005] },
      { name: "footL", parent: 14, pos: [0.092, 0.085, -0.03] },
      { name: "thighR", parent: 0, pos: [-0.092, 0.93, 0] },
      { name: "shinR", parent: 16, pos: [-0.092, 0.505, 0.005] },
      { name: "footR", parent: 17, pos: [-0.092, 0.085, -0.03] },
    ];
    const B = {};
    BONES.forEach((bone, i) => { B[bone.name] = i; });
    const BONE_COUNT = BONES.length;

    function jointsFor(ap) {
      return BONES.map((def, i) => {
        const [x, y, z] = def.pos;
        const armSide = i >= B.clavL && i <= B.handR;
        const legSide = i >= B.thighL;
        const sx = armSide ? ap.shoulders : legSide ? ap.hips : 1;
        return new THREE.Vector3(x * sx, y * ap.height, z);
      });
    }

    // ------------------------------------------------------------------
    // GEOMETRY. Every body part is a tube of rings along its bone, blended
    // into the neighbouring bones near the joints (smooth elbows, knees,
    // shoulders, waist). Clothing is part of the same tubes: a layer adds a
    // little radius where it covers, and its color; extra pieces (hood,
    // collar, pockets, laces-level detail stays in color) are small tubes.
    // ------------------------------------------------------------------
    const LOD_SPECS = [
      { torso: 14, limb: 10, hand: 6, foot: 8, headA: 16, headS: 12, detail: true },
      { torso: 8, limb: 6, hand: 4, foot: 5, headA: 10, headS: 7, detail: false },
    ];

    // `pat`: each vertex's cloth pattern id (see CLOTH PATTERNS) -- a color
    // callback sets g.nextPattern just before its vertex is pushed.
    function builder() {
      return { pos: [], col: [], skinIndex: [], skinWeight: [], index: [], pat: [], nextPattern: 0 };
    }
    function pushVertex(g, p, weights, color) {
      g.pos.push(p.x, p.y, p.z);
      g.col.push(color.r, color.g, color.b);
      g.pat.push(g.nextPattern || 0);
      g.nextPattern = 0;
      let sum = 0;
      for (let i = 0; i < 4 && i < weights.length; i++) sum += weights[i][1];
      for (let i = 0; i < 4; i++) {
        const w = weights[i];
        g.skinIndex.push(w ? w[0] : 0);
        g.skinWeight.push(w ? w[1] / sum : 0);
      }
      return g.pos.length / 3 - 1;
    }

    const tmpC = new THREE.Vector3(), tmpP = new THREE.Vector3(), tmpAxis = new THREE.Vector3();
    // spec: { bone, parent, child, a, b, u, v, rings: [[t, ru, rv, du, dv]], radial,
    //         capStart, capEnd, blend: [s, e], extra(t, ang) -> weights,
    //         radius(t, ang, x, y, z) -> extra meters, color(t, ang, point) -> THREE.Color }
    function addTube(g, spec) {
      const rings = spec.rings, radial = spec.radial;
      const [bs, be] = spec.blend || [0.18, 0.18];
      tmpAxis.subVectors(spec.b, spec.a);
      const axis = tmpAxis.clone();
      const weightsAt = (t, ang) => {
        const out = [];
        let wp = 0, wc = 0, we = 0;
        if (spec.parent !== undefined && t < bs) wp = 0.5 * (1 - t / bs);
        if (spec.child !== undefined && t > 1 - be) wc = 0.5 * (t - (1 - be)) / be;
        const extra = spec.extra ? spec.extra(t, ang) : null;
        if (extra) for (const e of extra) we += e[1];
        out.push([spec.bone, Math.max(0.001, 1 - wp - wc - we)]);
        if (wp > 0) out.push([spec.parent, wp]);
        if (wc > 0) out.push([spec.child, wc]);
        if (extra) for (const e of extra) if (e[1] > 0) out.push(e);
        return out;
      };
      const starts = [];
      for (const ring of rings) {
        const [t, ru, rv, du = 0, dv = 0] = ring;
        tmpC.copy(spec.a).addScaledVector(axis, t).addScaledVector(spec.u, du).addScaledVector(spec.v, dv);
        starts.push(g.pos.length / 3);
        for (let k = 0; k < radial; k++) {
          const ang = (k / radial) * Math.PI * 2;
          const cu = Math.cos(ang), sv = Math.sin(ang);
          tmpP.copy(tmpC).addScaledVector(spec.u, cu * ru).addScaledVector(spec.v, sv * rv);
          const add = spec.radius ? spec.radius(t, ang, tmpP) : 0;
          if (add) tmpP.addScaledVector(spec.u, cu * add).addScaledVector(spec.v, sv * add);
          pushVertex(g, tmpP, weightsAt(t, ang), spec.color(t, ang, tmpP));
        }
      }
      for (let r = 0; r < rings.length - 1; r++) {
        const a0 = starts[r], a1 = starts[r + 1];
        for (let k = 0; k < radial; k++) {
          const k1 = (k + 1) % radial;
          g.index.push(a0 + k, a1 + k, a0 + k1, a0 + k1, a1 + k, a1 + k1);
        }
      }
      const cap = (ri, reverse) => {
        const ring = rings[ri];
        tmpC.copy(spec.a).addScaledVector(axis, ring[0]).addScaledVector(spec.u, ring[3] || 0).addScaledVector(spec.v, ring[4] || 0);
        if (spec.capBulge) tmpC.addScaledVector(axis.clone().normalize(), reverse ? -spec.capBulge : spec.capBulge);
        const c = pushVertex(g, tmpC, weightsAt(ring[0], 0), spec.color(ring[0], 0, tmpC));
        const s = starts[ri];
        for (let k = 0; k < radial; k++) {
          const k1 = (k + 1) % radial;
          // Wound to face out of the tube, matching its sides (the start cap
          // faces back along the tube, the end cap forward).
          if (reverse) g.index.push(c, s + k, s + k1);
          else g.index.push(c, s + k1, s + k);
        }
      };
      if (spec.capStart) cap(0, true);
      if (spec.capEnd) cap(rings.length - 1, false);
    }

    // Paper bag over the head (head-bone local, origin at the skull base):
    // a brown kraft grocery bag pulled down over the head to the base of
    // the neck, a little crumpled, closed flat on top. Its front panel is
    // flat -- that's where the face picture is pasted (see FACE).
    const BAG = { w: 0.27, d: 0.25, bottom: -0.085, top: 0.3, cz: 0.012 };
    const BAG_KRAFT = new THREE.Color(0xb48a58);

    // ------------------------------------------------------------------
    // APPEARANCE (all real, everyday people -- no zombie tint)
    // ------------------------------------------------------------------
    const SKIN = [0xf1c9a5, 0xe0ac87, 0xc68a62, 0x9a6440, 0x6e4529, 0xe8b996, 0xb57b52];
    // Coordinated everyday outfits (explicit request: pleasant color
    // combinations) -- a player gets one whole outfit, with only a slight
    // brightness variation, instead of independently random pieces.
    //   shirt: kind + color (a jacket's third value is unused -- jackets are one solid color)
    //   pants: kind + color (+ accent: athletic side stripe)
    //   shoes: kind + color
    const OUTFITS = [
      { shirt: ["tee", 0xf2f0ea], pants: ["jeans", 0x3b5578], shoes: ["sneakers", 0xf2f2ee] },                     // white tee, blue jeans, white sneakers
      { shirt: ["tee", 0x1f2a44], pants: ["cargo", 0x8c7f62], shoes: ["sneakers", 0xf2f2ee] },                      // navy tee, khaki cargos
      { shirt: ["hoodie", 0x2a2a2d], pants: ["athletic", 0x55585e, 0xf2f2f2], shoes: ["sneakers", 0x1f1f1f] },      // black hoodie, gray joggers
      { shirt: ["hoodie", 0x8f9296], pants: ["jeans", 0x23262c], shoes: ["sneakers", 0xf2f2ee] },                   // heather gray hoodie, black jeans
      { shirt: ["jacket", 0x4b5234, 0xefede6], pants: ["jeans", 0x2f4868], shoes: ["boots", 0x5a3a22] },           // olive jacket over white tee, dark jeans, brown boots
      { shirt: ["jacket", 0x1c1d20, 0x7d8087], pants: ["jeans", 0x4a6286], shoes: ["boots", 0x2a1f18] },           // black jacket over gray tee, light jeans
      { shirt: ["sweatshirt", 0x6e1f2a], pants: ["jeans", 0x4a6286], shoes: ["sneakers", 0xf2f2ee] },               // maroon crewneck, light jeans
      { shirt: ["sweatshirt", 0xc59a3e], pants: ["jeans", 0x2a3446], shoes: ["sneakers", 0xf2f2ee] },               // mustard crewneck, dark jeans
      { shirt: ["longsleeve", 0x9fb6cc], pants: ["cargo", 0x6b6450], shoes: ["boots", 0x5a3a22] },                 // light blue long sleeve, olive-khaki cargos
      { shirt: ["tee", 0x2f5a3e], pants: ["shorts", 0x23262c], shoes: ["sneakers", 0xf2f2ee] },                    // forest green tee, black shorts
      { shirt: ["tee", 0xa8abb0], pants: ["shorts", 0x1f2a44], shoes: ["sneakers", 0x6d7076] },                    // gray tee, navy shorts
      { shirt: ["hoodie", 0x1f2a44], pants: ["athletic", 0x2b2d31, 0xf2f2f2], shoes: ["sneakers", 0xf2f2ee] },      // navy hoodie, charcoal joggers
      { shirt: ["longsleeve", 0xe8e2d4], pants: ["jeans", 0x3b5578], shoes: ["boots", 0x6b4a2b] },                 // cream long sleeve, blue jeans, tan boots
      { shirt: ["jacket", 0x3a2a20, 0x1f2a44], pants: ["cargo", 0x3c3f33], shoes: ["boots", 0x2a1f18] },           // brown jacket over navy tee, dark cargos
    ];

    // ------------------------------------------------------------------
    // CLOTHING (explicit request: picked on the co-op setup screens, one
    // shirt and one pants choice, kept separate). Each is a style of the
    // body's own clothing layers -- same tubes, same skeleton, baked into
    // the body geometry like the random outfits -- plus an optional cloth
    // pattern drawn in the body shader (no textures):
    //   kind: how it's cut (see buildBodyGeometry), color, under (the
    //   shirt under a jacket/vest), pattern: a CLOTH PATTERNS id.
    // ------------------------------------------------------------------
    const PATTERN = { none: 0, plaid: 1, camo: 2, hiVis: 3, zipper: 4, buttonUp: 5, kneePads: 6, crease: 7 };
    const SHIRTS = {
      tee: { name: "T-Shirt", kind: "tee", color: 0xe9e6de },
      hoodie: { name: "Hoodie", kind: "hoodie", color: 0x3b3e45 },
      flannel: { name: "Flannel", kind: "flannel", color: 0xa3302b, pattern: PATTERN.plaid },
      workShirt: { name: "Work Shirt", kind: "workshirt", color: 0x5f7f9f, pattern: PATTERN.buttonUp },
      constructionVest: { name: "Construction Vest", kind: "vest", color: 0xd4ef2e, under: 0x6d7076, pattern: PATTERN.hiVis },
      militaryJacket: { name: "Military Jacket", kind: "jacket", color: 0x5f6947, under: 0x3a3f2e, pattern: PATTERN.camo },
      rainJacket: { name: "Rain Jacket", kind: "rainjacket", color: 0xf0c020, pattern: PATTERN.zipper },
    };
    const PANTS = {
      jeans: { name: "Jeans", kind: "jeans", color: 0x3b5578 },
      army: { name: "Army Pants", kind: "cargo", color: 0x5f6847, pattern: PATTERN.camo },
      suit: { name: "Suit Pants", kind: "suit", color: 0x2a2e37, pattern: PATTERN.crease },
      work: { name: "Work Pants", kind: "work", color: 0x8b7048, pattern: PATTERN.kneePads },
      athletic: { name: "Athletic Pants", kind: "athletic", color: 0x2b2d31, accent: 0xf2f2f2 },
    };
    const SHIRT_KEYS = Object.keys(SHIRTS);
    const PANTS_KEYS = Object.keys(PANTS);

    // A copy of `ap` wearing that shirt and those pants (build, skin,
    // shoes and everything else kept).
    function dressAppearance(ap, shirtKey, pantsKey) {
      const shirt = SHIRTS[shirtKey] || SHIRTS.tee;
      const pants = PANTS[pantsKey] || PANTS.jeans;
      const layered = shirt.kind === "jacket" || shirt.kind === "vest";
      return {
        ...ap,
        shirtStyle: SHIRTS[shirtKey] ? shirtKey : "tee",
        pantsStyle: PANTS[pantsKey] ? pantsKey : "jeans",
        shirtKind: shirt.kind,
        shirt: new THREE.Color(layered ? shirt.under : shirt.color),
        outer: new THREE.Color(shirt.color),
        shirtPattern: shirt.pattern || 0,
        pantsKind: pants.kind,
        pants: new THREE.Color(pants.color),
        accent: new THREE.Color(pants.accent !== undefined ? pants.accent : 0xf2f2f2),
        pantsPattern: pants.pattern || 0,
      };
    }

    // Every player is athletic (explicit request -- never a heavy build):
    // broad shoulders tapering to a narrow waist (`waist` scales the waist
    // and hips' width), with some variety in how lean or strong.
    const BUILDS = {
      lean: { shoulders: 1.04, hips: 0.97, girth: 0.95, limb: 1.0, waist: 0.9 },
      athletic: { shoulders: 1.08, hips: 0.98, girth: 1.0, limb: 1.06, waist: 0.88 },
      strong: { shoulders: 1.12, hips: 1.0, girth: 1.05, limb: 1.12, waist: 0.9 },
    };

    function pick(list) { return list[Math.floor(Math.random() * list.length)]; }
    function rand(a, b) { return a + Math.random() * (b - a); }

    // `avoid` (optional): another appearance to look different from.
    function randomAppearance(avoid) {
      const vary = (hex) => new THREE.Color(hex).multiplyScalar(rand(0.93, 1.05));
      let outfitIndex;
      do { outfitIndex = Math.floor(Math.random() * OUTFITS.length); } while (avoid && outfitIndex === avoid.outfitIndex && OUTFITS.length > 1);
      const outfit = OUTFITS[outfitIndex];
      const buildKey = pick(["lean", "athletic", "athletic", "strong"]);
      const jacket = outfit.shirt[0] === "jacket";
      return {
        outfitIndex,
        buildKey,
        ...BUILDS[buildKey],
        height: rand(0.96, 1.05),
        skin: new THREE.Color(pick(SKIN)),
        shirtKind: outfit.shirt[0],
        // For a jacket, `outer` is the jacket and `shirt` the shirt under it.
        shirt: vary(jacket ? outfit.shirt[2] : outfit.shirt[1]),
        outer: vary(jacket ? outfit.shirt[1] : outfit.shirt[1]),
        pantsKind: outfit.pants[0],
        pants: vary(outfit.pants[1]),
        accent: new THREE.Color(outfit.pants[2] !== undefined ? outfit.pants[2] : 0xf2f2f2),
        shoeKind: outfit.shoes[0],
        shoe: vary(outfit.shoes[1]),
        seed: Math.random() * 1000,
      };
    }

    // Cheap value noise (fabric/skin mottling).
    function hash(i, seed) {
      let h = Math.imul(i | 0, 374761393) ^ Math.imul(seed | 0, 668265263);
      h = Math.imul(h ^ (h >>> 13), 1103515245);
      return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
    }

    const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);
    const cTmp = new THREE.Color();

    function buildBodyGeometry(ap, lod) {
      const g = builder();
      const J = jointsFor(ap);
      const H = ap.height, gt = ap.girth, gl = ap.limb;
      const at = (y) => new THREE.Vector3(0, y * H, 0);
      const seed = ap.seed | 0;
      let vi = 0;
      // Fabric/skin shade variation per vertex, very subtle.
      const shade = (color, amount = 0.03) => { vi++; return cTmp.copy(color).multiplyScalar(1 - amount + 2 * amount * hash(vi, seed)); };

      // (a vest is worn over a tee: its sleeves are the tee's)
      const shortSleeves = ap.shirtKind === "tee" || ap.shirtKind === "vest";
      const sleeveLen = shortSleeves ? 0.42 : 1.1; // fraction of the upper arm (1.1 = full length, wrist cuff on forearm)
      const torsoLoose = { tee: 0.006, longsleeve: 0.006, sweatshirt: 0.014, hoodie: 0.018, jacket: 0.024,
        flannel: 0.01, workshirt: 0.01, vest: 0.02, rainjacket: 0.026 }[ap.shirtKind];
      const outerColor = ap.shirtKind === "jacket" || ap.shirtKind === "vest" ? ap.outer : ap.shirt;
      const pantsLoose = { jeans: 0.006, cargo: 0.013, athletic: 0.01, shorts: 0.012, suit: 0.004, work: 0.014 }[ap.pantsKind];
      const beltColor = new THREE.Color(0x2a2420);
      // Cloth patterns (see CLOTH PATTERNS): tagged per vertex as the
      // shirt / pants colors are handed out.
      const shirtCloth = (color, amount) => { g.nextPattern = ap.shirtPattern || 0; return shade(color, amount); };
      const sleeveCloth = (color, amount) => { g.nextPattern = ap.shirtKind === "vest" ? 0 : ap.shirtPattern || 0; return shade(color, amount); };
      const pantsCloth = (color, amount) => { g.nextPattern = ap.pantsPattern || 0; return shade(color, amount); };
      const hooded = ap.shirtKind === "hoodie" || ap.shirtKind === "rainjacket";
      const collared = ap.shirtKind === "jacket" || ap.shirtKind === "workshirt" || ap.shirtKind === "flannel";

      // ---- Pelvis ----
      addTube(g, {
        bone: B.hips, child: B.spine, a: at(0.84), b: at(1.075), u: X, v: Z, radial: lod.torso,
        // Wide enough at the hips to wrap the tops of both thighs, so the
        // legs join the body instead of hanging beside it.
        rings: [[0, 0.158 * ap.hips, 0.092 * gt], [0.3, 0.172 * ap.hips, 0.108 * gt], [0.6, 0.174 * ap.hips, 0.112 * gt, 0, -0.008], [0.85, 0.162 * ap.hips, 0.104 * gt], [1, 0.155 * gt, 0.1 * gt]],
        capStart: true, capBulge: 0.008, blend: [0, 0.3],
        radius: () => pantsLoose,
        color: (t) => (t > 0.86 && ap.pantsKind !== "athletic" && ap.pantsKind !== "shorts" ? beltColor : pantsCloth(ap.pants)),
      });
      // ---- Abdomen (shirt; hoodie/sweatshirt ribbed hem low on the hips) ----
      addTube(g, {
        bone: B.spine, parent: B.hips, child: B.chest, a: at(0.99), b: at(1.28), u: X, v: Z, radial: lod.torso,
        // The athletic taper: narrowest at the natural waist, widening to the chest.
        rings: [[0, 0.155 * gt, 0.102 * gt], [0.4, 0.155 * gt * ap.waist, 0.096 * gt], [0.8, 0.162 * gt, 0.104 * gt], [1, 0.174 * gt, 0.11 * gt]],
        blend: [0.25, 0.25],
        radius: (t) => torsoLoose + (t < 0.12 ? 0.004 : 0),
        color: (t, ang, p) => {
          if ((ap.shirtKind === "hoodie" || ap.shirtKind === "sweatshirt") && t < 0.1) return shirtCloth(outerColor, 0.02).multiplyScalar(0.85); // ribbed hem
          if (ap.shirtKind === "hoodie" && p.z > 0.06 && t > 0.2 && t < 0.62 && Math.abs(p.x) < 0.1) return shirtCloth(outerColor).multiplyScalar(0.88); // kangaroo pocket
          return shirtCloth(outerColor);
        },
      });
      // ---- Chest: broad shoulders sloping into the neck (trapezius) ----
      addTube(g, {
        bone: B.chest, parent: B.spine, a: at(1.23), b: at(1.515), u: X, v: Z, radial: lod.torso,
        rings: [[0, 0.17 * gt, 0.11 * gt], [0.35, 0.185 * gt * ap.shoulders, 0.122 * gt, 0, 0.012], [0.7, 0.198 * gt * ap.shoulders, 0.114 * gt, 0, 0.004],
          [0.88, 0.16 * gt * ap.shoulders, 0.094 * gt], [1, 0.075, 0.068]],
        capEnd: true, blend: [0.2, 0],
        extra: (t, ang) => {
          if (t < 0.6) return null;
          const c = Math.cos(ang);
          const w = Math.min(0.55, Math.max(0, (Math.abs(c) - 0.35) * 1.1)) * Math.min(1, (t - 0.6) / 0.2);
          return w > 0 ? [[c > 0 ? B.clavL : B.clavR, w]] : null;
        },
        radius: (t) => (t < 0.95 ? torsoLoose : torsoLoose * 0.5),
        color: (t, ang, p) => {
          if (shortSleeves && t > 0.97) return shade(ap.skin, 0.012); // crew neck opening
          return shirtCloth(outerColor);
        },
      });
      // ---- Neck ----
      addTube(g, {
        bone: B.neck, parent: B.chest, child: B.head, a: at(1.44), b: at(1.6), u: X, v: Z, radial: Math.max(6, lod.limb - 2),
        rings: [[0, 0.064, 0.064], [0.5, 0.058, 0.06, 0, 0.004], [1, 0.054, 0.056, 0, 0.012]], blend: [0.3, 0.3],
        color: () => shade(ap.skin, 0.012),
      });
      // (The head itself is always covered by a helmet -- see HELMETS.)

      // ---- Hood (bunched on the upper back) / jacket collar ----
      if (lod.detail && hooded) {
        addTube(g, {
          bone: B.chest, a: new THREE.Vector3(0, 1.49 * H, -0.075), b: new THREE.Vector3(0, 1.36 * H, -0.125), u: X, v: Z, radial: 10,
          rings: [[0, 0.07, 0.035], [0.4, 0.105, 0.05], [1, 0.07, 0.03]], capStart: true, capEnd: true,
          color: () => shirtCloth(outerColor).multiplyScalar(0.92),
        });
        for (const side of ap.shirtKind === "hoodie" ? [1, -1] : []) { // drawstrings
          addTube(g, {
            bone: B.chest, a: new THREE.Vector3(0.025 * side, 1.47 * H, 0.1), b: new THREE.Vector3(0.03 * side, 1.34 * H, 0.13), u: X, v: Z, radial: 4,
            rings: [[0, 0.004, 0.004], [1, 0.004, 0.004]], color: () => cTmp.set(0xeeeeee),
          });
        }
      }
      if (lod.detail && collared) {
        addTube(g, {
          bone: B.chest, child: B.neck, a: at(1.46), b: at(1.53), u: X, v: Z, radial: 12,
          rings: [[0, 0.085, 0.078, 0, -0.01], [1, 0.078, 0.07, 0, -0.012]], blend: [0, 0.4],
          color: (t, ang) => shirtCloth(outerColor).multiplyScalar(Math.sin(ang) > 0.85 ? 0.6 : 1),
        });
      }

      for (const side of [1, -1]) {
        const L = side > 0;
        const cl = L ? B.clavL : B.clavR, ua = L ? B.upperArmL : B.upperArmR, fa = L ? B.forearmL : B.forearmR, hd = L ? B.handL : B.handR;
        const th = L ? B.thighL : B.thighR, sh = L ? B.shinL : B.shinR, ft = L ? B.footL : B.footR;
        const sleeveColor = ap.shirtKind === "jacket" ? ap.outer : ap.shirt; // (a vest's sleeves are the tee under it)
        // Upper arm: deltoid cap into the clavicle, bicep, taper to the elbow.
        addTube(g, {
          bone: ua, parent: cl, child: fa, a: J[ua].clone().add(new THREE.Vector3(-0.01 * side, 0.03, 0)), b: J[fa], u: X, v: Z, radial: lod.limb,
          rings: [[0, 0.058 * gl, 0.058 * gl], [0.15, 0.056 * gl, 0.06 * gl], [0.45, 0.046 * gl, 0.05 * gl], [0.8, 0.04 * gl, 0.042 * gl], [1, 0.037 * gl, 0.039 * gl]],
          blend: [0.3, 0.2], capStart: true, capBulge: 0.015,
          radius: (t) => (t < sleeveLen ? (ap.shirtKind === "vest" ? 0.006 : torsoLoose) * 0.7 + (shortSleeves && t > sleeveLen - 0.1 ? 0.004 : 0) : 0),
          color: (t) => (t < sleeveLen ? sleeveCloth(sleeveColor) : shade(ap.skin, 0.012)),
        });
        // Forearm: fuller below the elbow; sleeves end in a cuff at the wrist.
        const cuff = sleeveLen > 1;
        addTube(g, {
          bone: fa, parent: ua, child: hd, a: J[fa].clone().add(new THREE.Vector3(0, 0.02, 0)), b: J[hd], u: X, v: Z, radial: lod.limb,
          rings: [[0, 0.037 * gl, 0.039 * gl], [0.25, 0.041 * gl, 0.04 * gl], [0.7, 0.032 * gl, 0.028 * gl], [1, 0.027 * gl, 0.022 * gl]],
          blend: [0.2, 0.2],
          radius: (t) => (cuff && t < 0.93 ? torsoLoose * 0.6 : 0),
          color: (t) => (cuff && t < 0.93 ? (t > 0.84 ? sleeveCloth(sleeveColor).multiplyScalar(0.85) : sleeveCloth(sleeveColor)) : shade(ap.skin, 0.012)),
        });
        // Hand: a palm, then fingers curling in toward the palm (a gripping
        // hand -- players always hold a weapon or make a fist), and a thumb
        // wrapping round the other side. `palmIn` points the way the palm faces.
        const palmIn = -side;
        addTube(g, {
          bone: hd, parent: fa, a: J[hd], b: J[hd].clone().add(new THREE.Vector3(0, -0.095 * H, 0.008)), u: X, v: Z, radial: lod.hand,
          rings: [[0, 0.019, 0.03], [0.4, 0.022, 0.042, 0, 0.003], [1, 0.02, 0.041, 0.002 * palmIn, 0.006]],
          blend: [0.25, 0],
          color: () => shade(ap.skin, 0.012),
        });
        addTube(g, {
          bone: hd, a: J[hd].clone().add(new THREE.Vector3(0.002 * palmIn, -0.09 * H, 0.008)), b: J[hd].clone().add(new THREE.Vector3(0, -0.14 * H, 0.008)),
          u: X, v: Z, radial: lod.hand,
          rings: [[0, 0.017, 0.04], [0.45, 0.014, 0.038, 0.016 * palmIn, 0], [1, 0.011, 0.033, 0.036 * palmIn, 0]],
          capEnd: true, capBulge: 0.008,
          color: () => shade(ap.skin, 0.012),
        });
        if (lod.detail) {
          addTube(g, {
            bone: hd, a: J[hd].clone().add(new THREE.Vector3(0.012 * palmIn, -0.035 * H, 0.025)),
            b: J[hd].clone().add(new THREE.Vector3(0.03 * palmIn, -0.085 * H, 0.03)), u: X, v: Z, radial: 5,
            rings: [[0, 0.011, 0.012], [1, 0.008, 0.009]], capEnd: true, color: () => shade(ap.skin, 0.012),
          });
        }
        // Thigh: pants (cargo pockets on the outer side, shorts end above the knee).
        const shorts = ap.pantsKind === "shorts";
        addTube(g, {
          bone: th, parent: B.hips, child: sh, a: J[th].clone().add(new THREE.Vector3(0, 0.07, 0)), b: J[sh], u: X, v: Z, radial: lod.limb,
          rings: [[0, 0.086 * gl, 0.09 * gl], [0.2, 0.086 * gl, 0.09 * gl, 0, -0.004], [0.6, 0.068 * gl, 0.073 * gl], [1, 0.05 * gl, 0.054 * gl]],
          blend: [0.25, 0.2],
          radius: (t, ang) => {
            if (shorts && t > 0.55) return 0;
            let r = pantsLoose;
            if (ap.pantsKind === "cargo" && t > 0.42 && t < 0.66 && Math.cos(ang) * side > 0.55) r += 0.016;
            return r;
          },
          color: (t, ang) => {
            if (shorts && t > 0.55) return shade(ap.skin, 0.012);
            if (ap.pantsKind === "athletic" && Math.cos(ang) * side > 0.92) return cTmp.copy(ap.accent);
            if (ap.pantsKind === "cargo" && t > 0.42 && t < 0.66 && Math.cos(ang) * side > 0.55) return pantsCloth(ap.pants).multiplyScalar(0.9);
            return pantsCloth(ap.pants);
          },
        });
        // Shin: calf; pant hem over the shoe (or boot shaft).
        const boots = ap.shoeKind === "boots";
        addTube(g, {
          bone: sh, parent: th, child: ft, a: J[sh].clone().add(new THREE.Vector3(0, 0.03, 0)), b: J[ft].clone().add(new THREE.Vector3(0, -0.01, 0.02)), u: X, v: Z, radial: lod.limb,
          rings: [[0, 0.051 * gl, 0.055 * gl], [0.28, 0.054 * gl, 0.062 * gl, 0, -0.012], [0.8, 0.036 * gl, 0.038 * gl], [0.94, 0.034 * gl, 0.036 * gl], [1, 0.034 * gl, 0.036 * gl]],
          blend: [0.2, 0.15],
          radius: (t) => (shorts ? (boots && t > 0.75 ? 0.012 : 0) : boots && t > 0.75 ? 0.016 : pantsLoose + (t > 0.85 ? 0.006 : 0)),
          color: (t, ang) => {
            if (boots && t > 0.75) return shade(ap.shoe);
            if (shorts) return t > 0.9 ? cTmp.set(0xf2f2f2) : shade(ap.skin, 0.012); // socks
            if (ap.pantsKind === "athletic" && Math.cos(ang) * side > 0.92) return cTmp.copy(ap.accent);
            return pantsCloth(ap.pants);
          },
        });
        // Shoe: a one-color upper (rounded toe), a separate sole underneath
        // (its own piece, so the colors never smear into each other), and
        // an ankle collar that closes the shoe around the leg and bends with
        // the shin. Boots get a taller collar.
        const heel = new THREE.Vector3(J[ft].x, 0, J[ft].z - 0.065);
        const toe = new THREE.Vector3(J[ft].x + 0.01 * side, 0, J[ft].z + 0.205);
        const soleColor = new THREE.Color(ap.shoeKind === "sneakers" ? 0xf1f0ea : 0x2a2220);
        const ss = boots ? 1.08 : 1;
        addTube(g, {
          bone: ft, parent: sh, a: heel, b: toe, u: X, v: Y, radial: lod.foot,
          rings: [[0, 0.038 * ss, 0.034 * ss, 0, 0.05], [0.3, 0.046 * ss, 0.046 * ss, 0, 0.058], [0.72, 0.049 * ss, 0.03 * ss, 0, 0.044], [1, 0.037, 0.022, 0, 0.036]],
          blend: [0.15, 0], capStart: true, capEnd: true, capBulge: 0.016,
          color: () => shade(ap.shoe, 0.015),
        });
        addTube(g, {
          bone: ft, parent: sh, a: heel.clone().add(new THREE.Vector3(0, 0, -0.008)), b: toe.clone().add(new THREE.Vector3(0, 0, 0.014)), u: X, v: Y, radial: lod.foot,
          rings: [[0, 0.041 * ss, 0.011, 0, 0.011], [0.3, 0.049 * ss, 0.011, 0, 0.011], [0.72, 0.052 * ss, 0.011, 0, 0.011], [1, 0.039, 0.009, 0, 0.01]],
          blend: [0.15, 0], capStart: true, capEnd: true, capBulge: 0.01,
          color: () => soleColor,
        });
        addTube(g, {
          bone: ft, child: sh, a: new THREE.Vector3(J[ft].x, 0.04, J[ft].z - 0.02), b: new THREE.Vector3(J[ft].x, boots ? 0.2 : 0.125, J[ft].z - 0.005),
          u: X, v: Z, radial: lod.foot + 2,
          rings: [[0, 0.046 * ss, 0.056 * ss], [0.7, 0.043 * ss, 0.05 * ss], [1, 0.041 * ss, 0.047 * ss]],
          blend: [0, 0.6],
          color: (t) => (t > 0.85 && !boots ? shade(ap.shoe).multiplyScalar(0.8) : shade(ap.shoe, 0.015)),
        });
      }

      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(g.pos, 3));
      geometry.setAttribute("color", new THREE.Float32BufferAttribute(g.col, 3));
      geometry.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(g.skinIndex, 4));
      geometry.setAttribute("skinWeight", new THREE.Float32BufferAttribute(g.skinWeight, 4));
      geometry.setAttribute("clothPattern", new THREE.Float32BufferAttribute(g.pat, 1));
      geometry.setIndex(g.index);
      geometry.computeVertexNormals();
      geometry.computeBoundingSphere();
      geometry.boundingSphere.radius *= 1.4; // room for raised arms / poses
      return geometry;
    }

    // The bag: six grid panels. Every panel but the front's middle gets a
    // little crumple (deterministic per player), the bottom edge flares
    // and wrinkles where it bunches at the neck, and a few darker creases
    // and folds run across it. Rigid on the head bone.
    function addBag(g, lod, headJoint, ap) {
      const seed = (ap.seed | 0) + 17;
      const n = lod.detail ? 6 : 3;
      const hw = BAG.w / 2, hd = BAG.d / 2, y0 = BAG.bottom, y1 = BAG.top, cz = BAG.cz;
      const p = new THREE.Vector3();
      const color = new THREE.Color();
      const noise = (i, j, k) => hash(i * 7349 + j * 131 + k * 17, seed) - 0.5;
      // origin, u axis, v axis, outward normal, (u count, v count)
      const panels = [
        { name: "front", o: [-hw, y0, cz + hd], u: [BAG.w, 0, 0], v: [0, y1 - y0, 0], n: [0, 0, 1] },
        { name: "back", o: [hw, y0, cz - hd], u: [-BAG.w, 0, 0], v: [0, y1 - y0, 0], n: [0, 0, -1] },
        { name: "left", o: [hw, y0, cz + hd], u: [0, 0, -BAG.d], v: [0, y1 - y0, 0], n: [1, 0, 0] },
        { name: "right", o: [-hw, y0, cz - hd], u: [0, 0, BAG.d], v: [0, y1 - y0, 0], n: [-1, 0, 0] },
        { name: "top", o: [-hw, y1, cz + hd], u: [BAG.w, 0, 0], v: [0, 0, -BAG.d], n: [0, 1, 0] },
      ];
      panels.forEach((panel, pi) => {
        const start = g.pos.length / 3;
        for (let j = 0; j <= n; j++) {
          for (let i = 0; i <= n; i++) {
            const fu = i / n, fv = j / n;
            p.set(panel.o[0] + panel.u[0] * fu + panel.v[0] * fv,
              panel.o[1] + panel.u[1] * fu + panel.v[1] * fv,
              panel.o[2] + panel.u[2] * fu + panel.v[2] * fv);
            const edge = i === 0 || i === n || (panel.name !== "top" && (j === 0 || j === n)) || (panel.name === "top" && (j === 0 || j === n));
            // Crumple along the normal; the front panel's middle stays flat for the picture.
            const flatFront = panel.name === "front" && i > 0 && i < n && j > 0 && j < n;
            let push = flatFront ? 0 : noise(i, j, pi) * 0.012;
            // Bottom edge bunches outward and wrinkles at the neck.
            if (panel.name !== "top" && j === 0) push += 0.012 + noise(i, 9, pi) * 0.01;
            if (!edge || panel.name === "top") {
              p.x += panel.n[0] * push; p.y += panel.n[1] * push; p.z += panel.n[2] * push;
            } else {
              p.x += panel.n[0] * push * 0.6; p.y += panel.n[1] * push * 0.6; p.z += panel.n[2] * push * 0.6;
            }
            p.add(headJoint);
            // Kraft paper: mottled, darker along creases and the side gussets' fold.
            let shadeK = 0.93 + 0.12 * hash(start + i * 31 + j, seed);
            if ((panel.name === "left" || panel.name === "right") && i === Math.round(n / 2)) shadeK *= 0.82; // gusset fold
            if (panel.name !== "top" && j === 0) shadeK *= 0.88;
            if (panel.name === "top") shadeK *= 0.95;
            color.copy(BAG_KRAFT).multiplyScalar(shadeK);
            const w = j === 0 && panel.name !== "top" ? [[B.head, 0.85], [B.neck, 0.15]] : [[B.head, 1]];
            pushVertex(g, p, w, color);
          }
        }
        for (let j = 0; j < n; j++) {
          for (let i = 0; i < n; i++) {
            const a = start + j * (n + 1) + i, b = a + 1, c = a + n + 1, d = c + 1;
            g.index.push(a, b, c, b, d, c);
          }
        }
      });
    }

    // ------------------------------------------------------------------
    // FACE: the PNG pasted flat over the bag's front panel, filling it the
    // way CSS object-fit: cover does (cropped, never stretched). Lambert --
    // purely diffuse, like paper -- so it can't flare into a white spot in
    // the sun; its color sits slightly under 1 so bright photo backgrounds
    // don't clip in direct light.
    // ------------------------------------------------------------------
    const FACE_MARGIN = 0.012; // paper showing around the picture, m
    // Sized and placed for the helmet it's on (see HELMETS' `face`): bent
    // around a round helmet's front and leaned back with its slope.
    const faceGeometryCache = {};
    function getFaceGeometry(key, helmetKey) {
      const cacheKey = key + "|" + helmetKey;
      if (faceGeometryCache[cacheKey]) return faceGeometryCache[cacheKey];
      const face = getFace(key);
      const spot = HELMETS[helmetKey].face;
      const geometry = new THREE.PlaneGeometry(spot.w, spot.h, spot.curve ? 10 : 1, spot.curve ? 4 : 1);
      const panelAspect = spot.w / spot.h;
      const cropU = face.aspect > panelAspect ? panelAspect / face.aspect : 1;
      const cropV = face.aspect > panelAspect ? 1 : face.aspect / panelAspect;
      const uv = geometry.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, 0.5 + (uv.getX(i) - 0.5) * cropU, 0.5 + (uv.getY(i) - 0.5) * cropV);
      if (spot.curve) {
        // Wrap around the helmet: radius spot.curve at the picture's middle,
        // narrowing up a tapered helmet at the rate its side leans in.
        const pos = geometry.attributes.position;
        const taper = Math.tan(spot.tilt || 0);
        for (let i = 0; i < pos.count; i++) {
          const x = pos.getX(i), y = pos.getY(i);
          const r = spot.curve - taper * y;
          const a = x / r;
          pos.setXYZ(i, r * Math.sin(a), y, r * Math.cos(a) - r);
        }
        geometry.computeVertexNormals();
      }
      if (spot.tilt) geometry.rotateX(-spot.tilt);
      geometry.translate(0, spot.cy, spot.z + (spot.lift || 0.003));
      faceGeometryCache[cacheKey] = geometry;
      return geometry;
    }
    const faceMaterialCache = {};
    function getFaceMaterial(key) {
      if (faceMaterialCache[key]) return faceMaterialCache[key];
      const texture = getFace(key).texture;
      const material = new THREE.MeshLambertMaterial({
        map: texture, color: 0xd9d9d9, emissiveMap: texture, emissive: 0x0f0f0f,
        transparent: true, alphaTest: 0.05, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      });
      faceMaterialCache[key] = material;
      return material;
    }

    // ------------------------------------------------------------------
    // HELMETS (explicit request: picked on the co-op setup screen) -- what's
    // pulled over the head. Each is a rigid group on the head bone, in its
    // local frame (origin at the skull base, +Z forward), covering the whole
    // head down past the top of the neck. `face`: where the face picture
    // goes on its front -- size (w, h), center height (cy), the front
    // surface's z there, how far the surface leans back (tilt, radians), and
    // the radius to bend it around (curve; 0 = flat).
    // ------------------------------------------------------------------
    const helmetMaterialCache = {};
    function helmetMaterial(color, roughness = 0.8, metalness = 0) {
      const key = color + ":" + roughness + ":" + metalness;
      if (!helmetMaterialCache[key]) {
        // Double-sided: the open bottoms can be seen into from below.
        helmetMaterialCache[key] = new THREE.MeshStandardMaterial({ color, roughness, metalness, side: THREE.DoubleSide });
      }
      return helmetMaterialCache[key];
    }
    const hiddenMaterial = new THREE.MeshBasicMaterial({ visible: false });
    const bagMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0, side: THREE.DoubleSide });
    function helmetPart(group, geometry, material, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(x, y, z);
      mesh.rotation.set(rx, ry, rz);
      group.add(mesh);
      return mesh;
    }
    // Radius of a tapered helmet (bottom radius r0 at y0, top r1 at y1) at height y.
    const taperedRadius = (r0, r1, y0, y1, y) => r0 + (r1 - r0) * (y - y0) / (y1 - y0);

    // Every helmet's face picture is the paper bag's size (FACE_W x FACE_H,
    // explicit request), so the helmets are sized around it: the box is
    // tall enough to take it flat, and the bucket and cone are wide enough
    // (the cone also tall enough -- its taper is what forces the wrap)
    // that it only bends part way round them.
    const FACE_W = BAG.w - 2 * FACE_MARGIN;
    const FACE_H = BAG.top - BAG.bottom - 0.03 - 2 * FACE_MARGIN;
    const BUCKET = { r0: 0.18, r1: 0.15, y0: -0.1, y1: 0.28, cz: 0.012 };
    const BOX = { w: 0.3, h: 0.36, d: 0.3, y0: -0.095, cz: 0.012 };
    const CONE = { r0: 0.2, r1: 0.024, y0: -0.1, y1: 0.75, cz: 0.012 };
    // The 12 added helmets (explicit request). Round ones: bottom radius r0
    // (at the neck, y0) to top radius r1 (y1); boxes: width, depth, height.
    const TRASH = { r0: 0.19, r1: 0.176, y0: -0.1, y1: 0.38, cz: 0.012 };
    const PAINT = { r: 0.172, y0: -0.1, y1: 0.28, cz: 0.012 };
    const POT = { r: 0.186, y0: -0.1, y1: 0.27, cz: 0.012 };
    const MAILBOX = { w: 0.3, straight: 0.26, y0: -0.1, front: 0.2, back: -0.28, cz: 0.012 };
    const FLOWERPOT = { r0: 0.165, r1: 0.205, y0: -0.1, y1: 0.26, cz: 0.012 };
    const BARREL = { r: 0.215, y0: -0.1, y1: 0.37, cz: 0.012 };
    const COOLER = { w: 0.38, h: 0.4, d: 0.3, lid: 0.06, y0: -0.1, cz: 0.012 };
    const TOOLBOX = { w: 0.4, h: 0.34, d: 0.28, y0: -0.1, cz: 0.012 };
    const WELDER = { r: 0.195, y0: -0.1, y1: 0.27, cz: 0.012 };
    const GOALIE = { r: 0.18, y0: -0.1, y1: 0.27, cz: 0.012 };
    const KNIGHT = { r: 0.19, y0: -0.1, y1: 0.3, cz: 0.012 };
    const MOTO = { r: 0.19, y0: -0.09, y1: 0.29, cz: 0.012 };
    // Face spot on a round (possibly tapered) helmet, centered at height cy.
    const roundFace = (r0, r1, y0, y1, cz, cy, lift = 0.004) => ({
      w: FACE_W, h: FACE_H, cy, z: cz + taperedRadius(r0, r1, y0, y1, cy), lift,
      tilt: Math.atan((r0 - r1) / (y1 - y0)), curve: taperedRadius(r0, r1, y0, y1, cy),
    });
    // ...and on a flat front at z.
    const flatFace = (z, cy, lift = 0.003) => ({ w: FACE_W, h: FACE_H, cy, z, lift, tilt: 0, curve: 0 });
    // Ring lying flat around the helmet (a rim or rib) at height y.
    const flatRing = (group, r, tube, y, material, cz = 0.012) =>
      helmetPart(group, new THREE.TorusGeometry(r, tube, 6, 28), material, 0, y, cz, Math.PI / 2);
    // Arc of a ring around the front only (halfAngle either side of +Z).
    const frontArc = (group, r, tube, y, halfAngle, material, cz = 0.012) => {
      const g = new THREE.TorusGeometry(r, tube, 5, 14, 2 * halfAngle).rotateX(Math.PI / 2).rotateY(-(Math.PI / 2 - halfAngle));
      return helmetPart(group, g, material, 0, y, cz);
    };
    // Open-bottomed box (the head goes in from below): BoxGeometry face
    // order +x -x +y -y +z -z.
    const openBox = (group, w, h, d, material, x, y, z, topMaterial = material) =>
      helmetPart(group, new THREE.BoxGeometry(w, h, d), [material, material, topMaterial, hiddenMaterial, material, material], x, y, z);

    const HELMETS = {
      // Brown kraft grocery bag, crumpled a little (the original look).
      bag: {
        name: "Paper Bag",
        face: {
          w: FACE_W, h: FACE_H, // clear of the bunched bottom edge
          cy: (BAG.top + BAG.bottom + 0.03) / 2, z: BAG.cz + BAG.d / 2, tilt: 0, curve: 0,
        },
        build(ap) {
          const g = builder();
          addBag(g, LOD_SPECS[0], new THREE.Vector3(), ap);
          const geometry = new THREE.BufferGeometry();
          geometry.setAttribute("position", new THREE.Float32BufferAttribute(g.pos, 3));
          geometry.setAttribute("color", new THREE.Float32BufferAttribute(g.col, 3));
          geometry.setIndex(g.index);
          geometry.computeVertexNormals();
          const group = new THREE.Group();
          helmetPart(group, geometry, bagMaterial);
          return group;
        },
      },
      // A galvanized pail turned upside down: rolled rim at the bottom,
      // two pressed ridges, the bail handle hanging down the back.
      bucket: {
        name: "Bucket",
        face: (() => {
          const cy = 0.085; // between the rolled rim and the top
          return {
            w: FACE_W, h: FACE_H, cy, z: BUCKET.cz + taperedRadius(BUCKET.r0, BUCKET.r1, BUCKET.y0, BUCKET.y1, cy),
            lift: 0.007, // stands just proud of the pressed ridges it crosses
            tilt: Math.atan((BUCKET.r0 - BUCKET.r1) / (BUCKET.y1 - BUCKET.y0)),
            curve: taperedRadius(BUCKET.r0, BUCKET.r1, BUCKET.y0, BUCKET.y1, cy),
          };
        })(),
        build() {
          const group = new THREE.Group();
          const metal = helmetMaterial(0xa3a9ae, 0.42, 0.6);
          const dark = helmetMaterial(0x7d8388, 0.5, 0.6);
          const { r0, r1, y0, y1, cz } = BUCKET;
          helmetPart(group, new THREE.CylinderGeometry(r1, r0, y1 - y0, 28, 1, true), metal, 0, (y0 + y1) / 2, cz);
          helmetPart(group, new THREE.CircleGeometry(r1, 28), metal, 0, y1, cz, -Math.PI / 2);
          helmetPart(group, new THREE.TorusGeometry(r0 + 0.002, 0.008, 6, 28), dark, 0, y0, cz, Math.PI / 2);
          for (const y of [0.005, 0.175]) {
            helmetPart(group, new THREE.TorusGeometry(taperedRadius(r0, r1, y0, y1, y), 0.004, 4, 28), dark, 0, y, cz, Math.PI / 2);
          }
          // Handle: two ear lugs on the sides, the wire bail swung down against the back.
          const earY = 0.2, earR = taperedRadius(r0, r1, y0, y1, earY);
          for (const side of [1, -1]) helmetPart(group, new THREE.CylinderGeometry(0.014, 0.014, 0.012, 8), dark, side * (earR + 0.004), earY, cz, 0, 0, Math.PI / 2);
          helmetPart(group, new THREE.TorusGeometry(earR + 0.01, 0.0035, 4, 20, Math.PI), dark, 0, earY, cz - 0.01, 1.25, 0, Math.PI);
          return group;
        },
      },
      // A plain corrugated shipping box, open at the bottom, top flaps
      // sticking up and a strip of packing tape across them.
      box: {
        name: "Cardboard Box",
        face: { w: FACE_W, h: FACE_H, cy: BOX.y0 + BOX.h / 2, z: BOX.cz + BOX.d / 2, tilt: 0, curve: 0 },
        build() {
          const group = new THREE.Group();
          const kraft = helmetMaterial(0xae8250, 0.9);
          const kraftDark = helmetMaterial(0x93693d, 0.9);
          const tape = helmetMaterial(0xc9a36a, 0.5);
          const { w, h, d, y0, cz } = BOX;
          const top = y0 + h;
          // BoxGeometry face order: +x -x +y -y +z -z; the bottom (-y) is left open.
          helmetPart(group, new THREE.BoxGeometry(w, h, d), [kraft, kraft, kraftDark, hiddenMaterial, kraft, kraft], 0, y0 + h / 2, cz);
          // Flaps hinged along the top edges, bent up and out at uneven angles.
          const flap = (len, width, x, z, ry, lean) => {
            const hinge = new THREE.Group();
            hinge.position.set(x, top, z);
            hinge.rotation.order = "YXZ"; // turn to face out (y), then swing up about the hinge (x)
            hinge.rotation.set(lean, ry, 0);
            group.add(hinge);
            helmetPart(hinge, new THREE.BoxGeometry(width, 0.004, len), kraft, 0, 0, len / 2);
          };
          flap(d * 0.5, w, 0, cz + d / 2, 0, -1.05);            // front, leaning forward
          flap(d * 0.5, w, 0, cz - d / 2, Math.PI, -0.8);       // back
          flap(w * 0.5, d, w / 2, cz, Math.PI / 2, -1.25);      // left
          flap(w * 0.5, d, -w / 2, cz, -Math.PI / 2, -0.95);    // right
          helmetPart(group, new THREE.BoxGeometry(0.05, 0.002, d + 0.002), tape, 0, top + 0.001, cz);
          return group;
        },
      },
      // An orange traffic cone worn tip-up, two white reflective bands
      // above the picture and the black base frame around the neck.
      cone: {
        name: "Traffic Cone",
        face: (() => {
          const cy = 0.09; // just above the base frame, where the cone is widest
          return {
            w: FACE_W, h: FACE_H, cy, z: CONE.cz + taperedRadius(CONE.r0, CONE.r1, CONE.y0, CONE.y1, cy),
            tilt: Math.atan((CONE.r0 - CONE.r1) / (CONE.y1 - CONE.y0)),
            curve: taperedRadius(CONE.r0, CONE.r1, CONE.y0, CONE.y1, cy),
          };
        })(),
        build() {
          const group = new THREE.Group();
          const orange = helmetMaterial(0xf2661d, 0.55);
          const white = helmetMaterial(0xf4f4f0, 0.35);
          const black = helmetMaterial(0x1c1c1e, 0.8);
          const { r0, r1, y0, y1, cz } = CONE;
          helmetPart(group, new THREE.CylinderGeometry(r1, r0, y1 - y0, 28, 1, true), orange, 0, (y0 + y1) / 2, cz);
          helmetPart(group, new THREE.SphereGeometry(r1, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), orange, 0, y1, cz); // rounded tip
          for (const [a, b] of [[0.34, 0.42], [0.48, 0.54]]) {
            const ra = taperedRadius(r0, r1, y0, y1, a) + 0.0015, rb = taperedRadius(r0, r1, y0, y1, b) + 0.0015;
            helmetPart(group, new THREE.CylinderGeometry(rb, ra, b - a, 28, 1, true), white, 0, (a + b) / 2, cz);
          }
          // Square base frame (a ring, so it never cuts through the neck).
          const outer = 0.46, rim = 0.04, thick = 0.02;
          for (const [x, z, wx, wz] of [
            [0, (outer - rim) / 2, outer, rim], [0, -(outer - rim) / 2, outer, rim],
            [(outer - rim) / 2, 0, rim, outer - 2 * rim], [-(outer - rim) / 2, 0, rim, outer - 2 * rim],
          ]) helmetPart(group, new THREE.BoxGeometry(wx, thick, wz), black, x, y0 + thick / 2, cz + z);
          return group;
        },
      },

      // ---- The 12 added helmets. Each is sized around the same face
      // picture, pasted on its front (see `face`) the way the originals are.

      // A galvanized trash can upside down: its bottom on top, the rolled
      // opening at the neck, two pressed ribs and the side handles.
      trashCan: {
        name: "Trash Can",
        face: roundFace(TRASH.r0, TRASH.r1, TRASH.y0, TRASH.y1, TRASH.cz, 0.12, 0.008),
        build() {
          const group = new THREE.Group();
          const metal = helmetMaterial(0x8d9399, 0.45, 0.55);
          const dark = helmetMaterial(0x6f757b, 0.5, 0.55);
          const { r0, r1, y0, y1, cz } = TRASH;
          helmetPart(group, new THREE.CylinderGeometry(r1, r0, y1 - y0, 28, 1, true), metal, 0, (y0 + y1) / 2, cz);
          helmetPart(group, new THREE.CircleGeometry(r1, 28), dark, 0, y1, cz, -Math.PI / 2);
          flatRing(group, r0 + 0.004, 0.011, y0, dark);
          flatRing(group, r1 + 0.003, 0.008, y1 - 0.004, dark);
          for (const y of [0.02, 0.21]) flatRing(group, taperedRadius(r0, r1, y0, y1, y) + 0.001, 0.005, y, dark);
          for (const side of [1, -1]) {
            const r = taperedRadius(r0, r1, y0, y1, 0.3);
            helmetPart(group, new THREE.BoxGeometry(0.022, 0.018, 0.1), dark, side * (r + 0.018), 0.3, cz);
            for (const dz of [-0.04, 0.04]) helmetPart(group, new THREE.BoxGeometry(0.02, 0.012, 0.012), dark, side * (r + 0.008), 0.3, cz + dz);
          }
          return group;
        },
      },
      // A gallon paint can upside down, a label band round it, bright
      // paint spilled over the top and running down the sides, and the
      // wire bail handle.
      paintBucket: {
        name: "Paint Bucket",
        face: roundFace(PAINT.r, PAINT.r, PAINT.y0, PAINT.y1, PAINT.cz, 0.1, 0.006),
        build() {
          const group = new THREE.Group();
          const can = helmetMaterial(0xe9e8e2, 0.4, 0.35);
          const label = helmetMaterial(0x2f6fc2, 0.6);
          const paint = helmetMaterial(0x2a8fe0, 0.25);
          const wire = helmetMaterial(0x6d7176, 0.4, 0.6);
          const { r, y0, y1, cz } = PAINT;
          helmetPart(group, new THREE.CylinderGeometry(r, r, y1 - y0, 28, 1, true), can, 0, (y0 + y1) / 2, cz);
          helmetPart(group, new THREE.CylinderGeometry(r + 0.002, r + 0.002, 0.15, 28, 1, true), label, 0, 0.1, cz); // label band
          flatRing(group, r + 0.003, 0.008, y0, can);
          flatRing(group, r + 0.002, 0.007, y1, can);
          // spilled paint: a puddle over the top, drips down the back and sides
          helmetPart(group, new THREE.CylinderGeometry(r + 0.008, r + 0.008, 0.02, 28), paint, 0, y1 + 0.004, cz);
          [[2.2, 0.09], [2.7, 0.14], [3.3, 0.07], [3.9, 0.12], [4.4, 0.1], [1.7, 0.06], [1.2, 0.05], [5.0, 0.08]].forEach(([a, len]) => {
            const drip = new THREE.CylinderGeometry(0.011, 0.011, len, 6);
            helmetPart(group, drip, paint, Math.sin(a) * (r + 0.004), y1 - len / 2, cz + Math.cos(a) * (r + 0.004));
            helmetPart(group, new THREE.SphereGeometry(0.013, 6, 4), paint, Math.sin(a) * (r + 0.004), y1 - len, cz + Math.cos(a) * (r + 0.004));
          });
          for (const side of [1, -1]) helmetPart(group, new THREE.CylinderGeometry(0.013, 0.013, 0.012, 8), wire, side * (r + 0.004), 0.2, cz, 0, 0, Math.PI / 2);
          helmetPart(group, new THREE.TorusGeometry(r + 0.012, 0.003, 4, 20, Math.PI), wire, 0, 0.2, cz - 0.01, 1.25, 0, Math.PI);
          return group;
        },
      },
      // A stainless stock pot upside down: its bottom on top, the rolled
      // rim at the neck, two riveted loop handles low on the sides.
      cookingPot: {
        name: "Cooking Pot",
        face: roundFace(POT.r, POT.r, POT.y0, POT.y1, POT.cz, 0.085, 0.004),
        build() {
          const group = new THREE.Group();
          // (moderately metallic: with no environment to reflect, very
          // metallic materials render nearly black)
          const steel = helmetMaterial(0xd3d7db, 0.3, 0.45);
          const dark = helmetMaterial(0x9aa0a6, 0.35, 0.45);
          const handle = helmetMaterial(0x2b2b2d, 0.6);
          const { r, y0, y1, cz } = POT;
          helmetPart(group, new THREE.CylinderGeometry(r, r, y1 - y0, 28, 1, true), steel, 0, (y0 + y1) / 2, cz);
          helmetPart(group, new THREE.CylinderGeometry(r - 0.004, r, 0.012, 28), dark, 0, y1 + 0.006, cz); // thick base
          flatRing(group, r + 0.004, 0.009, y0, steel);
          for (const side of [1, -1]) {
            // loop handle standing out from the side, and its rivets
            helmetPart(group, new THREE.TorusGeometry(0.035, 0.009, 6, 12, Math.PI), handle, side * (r + 0.004), 0.0, cz, 0, side * Math.PI / 2, -Math.PI / 2);
            for (const dz of [-0.035, 0.035]) helmetPart(group, new THREE.SphereGeometry(0.006, 6, 4), dark, side * (r + 0.002), 0.0, cz + dz);
          }
          return group;
        },
      },
      // A curbside mailbox worn door-first: the rounded top, the long body
      // running back past the head, a latch over the door, the red flag up.
      mailbox: {
        name: "Mailbox",
        face: flatFace(MAILBOX.cz + MAILBOX.front + 0.006, 0.08),
        build() {
          const group = new THREE.Group();
          const body = helmetMaterial(0x8e949a, 0.45, 0.55);
          const door = helmetMaterial(0x7b8187, 0.45, 0.55);
          const red = helmetMaterial(0xc8221f, 0.5);
          const { w, straight, y0, front, back, cz } = MAILBOX;
          const len = front - back, r = w / 2, zMid = cz + (front + back) / 2;
          helmetPart(group, new THREE.BoxGeometry(w, straight, len), [body, body, hiddenMaterial, hiddenMaterial, body, body], 0, y0 + straight / 2, zMid);
          // rounded top: the upper half of a cylinder lying along z, ends capped
          helmetPart(group, new THREE.CylinderGeometry(r, r, len, 20, 1, false, Math.PI / 2, Math.PI), body, 0, y0 + straight, zMid, Math.PI / 2);
          // door: a panel standing just proud of the front, arched on top
          helmetPart(group, new THREE.BoxGeometry(w - 0.016, straight - 0.012, 0.006), door, 0, y0 + straight / 2 + 0.006, cz + front + 0.003);
          helmetPart(group, new THREE.CircleGeometry(r - 0.008, 16, 0, Math.PI), door, 0, y0 + straight, cz + front + 0.0035);
          helmetPart(group, new THREE.BoxGeometry(0.03, 0.02, 0.02), door, 0, y0 + straight + r - 0.02, cz + front + 0.012); // latch
          // the flag, up, on the right side
          helmetPart(group, new THREE.BoxGeometry(0.01, 0.2, 0.014), red, -(r + 0.008), y0 + 0.19, cz - 0.05);
          helmetPart(group, new THREE.BoxGeometry(0.006, 0.07, 0.11), red, -(r + 0.008), y0 + 0.26, cz - 0.1);
          return group;
        },
      },
      // A terracotta flower pot, flowers still growing out of the top.
      flowerPot: {
        name: "Flower Pot",
        face: roundFace(FLOWERPOT.r0, FLOWERPOT.r1, FLOWERPOT.y0, FLOWERPOT.y1, FLOWERPOT.cz, 0.085, 0.004),
        build() {
          const group = new THREE.Group();
          const clay = helmetMaterial(0xb95a32, 0.9);
          const clayDark = helmetMaterial(0xa24c29, 0.9);
          const soil = helmetMaterial(0x4a3222, 1);
          const stem = helmetMaterial(0x3f7a2e, 0.8);
          const leaf = helmetMaterial(0x4f9a3a, 0.7);
          const { r0, r1, y0, y1, cz } = FLOWERPOT;
          helmetPart(group, new THREE.CylinderGeometry(r1, r0, y1 - y0, 28, 1, true), clay, 0, (y0 + y1) / 2, cz);
          helmetPart(group, new THREE.CylinderGeometry(r1 + 0.018, r1 + 0.014, 0.07, 28), clayDark, 0, y1 + 0.035, cz); // rim
          helmetPart(group, new THREE.CircleGeometry(r1 + 0.006, 28), soil, 0, y1 + 0.072, cz, -Math.PI / 2);
          flatRing(group, r0 + 0.002, 0.006, y0, clayDark);
          // a few flowers: stem, two leaves, a bloom (petals round a center)
          const blooms = [[0.06, 0.05, 0.2, 0xe8434f], [-0.07, -0.02, 0.16, 0xf5c518], [0.0, -0.08, 0.22, 0xf08ac0], [-0.02, 0.08, 0.13, 0xf6f6f2]];
          for (const [x, z, h, color] of blooms) {
            const top = y1 + 0.072 + h;
            helmetPart(group, new THREE.CylinderGeometry(0.004, 0.005, h, 5), stem, x, top - h / 2, cz + z);
            for (const side of [1, -1]) {
              const l = helmetPart(group, new THREE.SphereGeometry(0.03, 6, 4), leaf, x + side * 0.02, top - h * 0.6, cz + z, 0, 0, side * 0.7);
              l.scale.set(1, 0.3, 0.55);
            }
            for (let k = 0; k < 6; k++) {
              const a = (k / 6) * Math.PI * 2;
              const petal = helmetPart(group, new THREE.SphereGeometry(0.02, 6, 4), helmetMaterial(color, 0.6), x + Math.cos(a) * 0.022, top, cz + z + Math.sin(a) * 0.022);
              petal.scale.set(1, 0.35, 1);
            }
            helmetPart(group, new THREE.SphereGeometry(0.012, 6, 4), helmetMaterial(0xf2b71c, 0.6), x, top + 0.004, cz + z);
          }
          return group;
        },
      },
      // An orange-and-white striped traffic barrel with the black rubber
      // ballast ring round the neck.
      trafficBarrel: {
        name: "Traffic Barrel",
        face: roundFace(BARREL.r, BARREL.r, BARREL.y0, BARREL.y1, BARREL.cz, 0.13, 0.005),
        build() {
          const group = new THREE.Group();
          const orange = helmetMaterial(0xf26a1b, 0.55);
          const white = helmetMaterial(0xf2f2ee, 0.35);
          const black = helmetMaterial(0x1c1c1e, 0.85);
          const { r, y0, y1, cz } = BARREL;
          const bands = 5, bh = (y1 - y0) / bands;
          for (let i = 0; i < bands; i++) {
            const white_ = i % 2 === 1;
            helmetPart(group, new THREE.CylinderGeometry(r + (white_ ? 0.001 : 0), r + (white_ ? 0.001 : 0), bh, 28, 1, true), white_ ? white : orange, 0, y0 + bh * (i + 0.5), cz);
          }
          helmetPart(group, new THREE.CylinderGeometry(r * 0.55, r, 0.05, 28), orange, 0, y1 + 0.025, cz); // domed top
          helmetPart(group, new THREE.CylinderGeometry(0.03, 0.03, 0.03, 10), orange, 0, y1 + 0.06, cz);   // lifting knob
          flatRing(group, r + 0.012, 0.022, y0 + 0.01, black);
          return group;
        },
      },
      // A picnic cooler: red body, white lid with its carry handle, grips
      // molded into the sides.
      cooler: {
        name: "Cooler",
        face: flatFace(COOLER.cz + COOLER.d / 2, COOLER.y0 + (COOLER.h - COOLER.lid) / 2 + 0.005),
        build() {
          const group = new THREE.Group();
          const red = helmetMaterial(0xc8322f, 0.55);
          const white = helmetMaterial(0xf1f0ec, 0.45);
          const gray = helmetMaterial(0x55585d, 0.6);
          const { w, h, d, lid, y0, cz } = COOLER;
          const bodyH = h - lid;
          openBox(group, w, bodyH, d, red, 0, y0 + bodyH / 2, cz);
          helmetPart(group, new THREE.BoxGeometry(w + 0.012, lid, d + 0.012), white, 0, y0 + bodyH + lid / 2, cz);
          // carry handle across the lid, on two posts
          helmetPart(group, new THREE.BoxGeometry(w * 0.55, 0.018, 0.035), white, 0, y0 + h + 0.05, cz);
          for (const side of [1, -1]) helmetPart(group, new THREE.BoxGeometry(0.02, 0.05, 0.03), white, side * w * 0.27, y0 + h + 0.025, cz);
          for (const side of [1, -1]) helmetPart(group, new THREE.BoxGeometry(0.012, 0.035, 0.14), gray, side * (w / 2 + 0.005), y0 + bodyH * 0.72, cz); // side grips
          helmetPart(group, new THREE.BoxGeometry(w - 0.02, 0.008, 0.006), white, 0, y0 + bodyH - 0.004, cz + d / 2 + 0.004); // lid seam
          return group;
        },
      },
      // A red steel toolbox: the tray lid, the black carry handle on top,
      // two chrome latches at the front corners.
      toolbox: {
        name: "Toolbox",
        face: flatFace(TOOLBOX.cz + TOOLBOX.d / 2, TOOLBOX.y0 + TOOLBOX.h / 2 - 0.005),
        build() {
          const group = new THREE.Group();
          const red = helmetMaterial(0xb8231f, 0.45, 0.35);
          const redDark = helmetMaterial(0x961b18, 0.45, 0.35);
          const chrome = helmetMaterial(0xd6d9dc, 0.2, 0.9);
          const black = helmetMaterial(0x1c1c1e, 0.7);
          const { w, h, d, y0, cz } = TOOLBOX;
          openBox(group, w, h, d, red, 0, y0 + h / 2, cz);
          helmetPart(group, new THREE.BoxGeometry(w + 0.008, 0.05, d + 0.008), redDark, 0, y0 + h + 0.025, cz); // lid
          helmetPart(group, new THREE.CylinderGeometry(0.014, 0.014, w * 0.6, 10), black, 0, y0 + h + 0.12, cz, 0, 0, Math.PI / 2);
          for (const side of [1, -1]) helmetPart(group, new THREE.BoxGeometry(0.02, 0.07, 0.02), chrome, side * w * 0.3, y0 + h + 0.085, cz);
          for (const side of [1, -1]) {
            helmetPart(group, new THREE.BoxGeometry(0.035, 0.045, 0.012), chrome, side * (w / 2 - 0.035), y0 + h - 0.01, cz + d / 2 + 0.006); // latches
          }
          return group;
        },
      },
      // A welding helmet: dark shell round the front, the pivot knobs on
      // the sides, the harness round the back of the head.
      weldingHelmet: {
        name: "Welding Helmet",
        face: roundFace(WELDER.r, WELDER.r, WELDER.y0, WELDER.y1, WELDER.cz, 0.085, 0.004),
        build() {
          const group = new THREE.Group();
          const shell = helmetMaterial(0x2a2c2f, 0.55, 0.1);
          const harness = helmetMaterial(0x151516, 0.8);
          const knob = helmetMaterial(0x6b6e72, 0.4, 0.6);
          const { r, y0, y1, cz } = WELDER;
          helmetPart(group, new THREE.CylinderGeometry(r, r, y1 - y0, 24, 1, true, -1.45, 2.9), shell, 0, (y0 + y1) / 2, cz); // the front shell
          helmetPart(group, new THREE.CylinderGeometry(r - 0.02, r - 0.02, y1 - y0 - 0.02, 20, 1, true), harness, 0, (y0 + y1) / 2, cz); // head under the harness
          const dome = helmetPart(group, new THREE.SphereGeometry(r, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2), shell, 0, y1, cz);
          dome.scale.set(1, 0.45, 1);
          frontArc(group, r + 0.004, 0.008, y0 + 0.005, 1.45, shell); // rolled bottom edge
          // the lens frame: a raised border round the picture (the visor)
          const frame = helmetMaterial(0x46494d, 0.45, 0.2);
          const half = (FACE_W / 2 + 0.012) / r, faceY = 0.085;
          frontArc(group, r + 0.008, 0.008, faceY + FACE_H / 2 + 0.012, half, frame);
          frontArc(group, r + 0.008, 0.008, faceY - FACE_H / 2 - 0.012, half, frame);
          for (const side of [1, -1]) {
            helmetPart(group, new THREE.CylinderGeometry(0.008, 0.008, FACE_H + 0.024, 6), frame,
              Math.sin(side * half) * (r + 0.008), faceY, cz + Math.cos(side * half) * (r + 0.008));
          }
          for (const side of [1, -1]) {
            helmetPart(group, new THREE.CylinderGeometry(0.03, 0.03, 0.02, 12), knob, side * (r + 0.005), 0.13, cz, 0, 0, Math.PI / 2);
            helmetPart(group, new THREE.BoxGeometry(0.012, 0.03, 0.18), harness, side * (r - 0.012), 0.13, cz - 0.07);
          }
          return group;
        },
      },
      // A goalie helmet: white shell, a colored stripe, and the wire cage
      // across the face.
      goalieMask: {
        name: "Hockey Goalie Mask",
        face: roundFace(GOALIE.r, GOALIE.r, GOALIE.y0, GOALIE.y1, GOALIE.cz, 0.085, 0.004),
        build() {
          const group = new THREE.Group();
          const shell = helmetMaterial(0xf3f3f0, 0.35);
          const stripe = helmetMaterial(0xc52a2a, 0.4);
          const cage = helmetMaterial(0x2a2a2c, 0.4, 0.6);
          const { r, y0, y1, cz } = GOALIE;
          helmetPart(group, new THREE.CylinderGeometry(r, r, y1 - y0, 28, 1, true), shell, 0, (y0 + y1) / 2, cz);
          const dome = helmetPart(group, new THREE.SphereGeometry(r, 24, 8, 0, Math.PI * 2, 0, Math.PI / 2), shell, 0, y1, cz);
          dome.scale.set(1, 0.55, 1);
          flatRing(group, r + 0.003, 0.01, y0 + 0.005, stripe);
          // a stripe over the top, front to back
          const band = helmetPart(group, new THREE.TorusGeometry(r + 0.002, 0.014, 4, 20, Math.PI), stripe, 0, y1, cz, 0, Math.PI / 2, 0);
          band.scale.set(1, 0.55, 1);
          // the cage: bars standing clear of the face
          const R = r + 0.035;
          for (const a of [-0.75, -0.25, 0.25, 0.75]) {
            helmetPart(group, new THREE.CylinderGeometry(0.004, 0.004, 0.3, 5), cage, Math.sin(a) * R, 0.09, cz + Math.cos(a) * R);
          }
          for (const y of [-0.04, 0.06, 0.16, 0.24]) frontArc(group, R, 0.004, y, 0.95, cage);
          for (const side of [1, -1]) helmetPart(group, new THREE.CylinderGeometry(0.012, 0.012, 0.03, 8), cage, side * Math.sin(0.95) * R, 0.24, cz + Math.cos(0.95) * R - 0.01, 0, 0, Math.PI / 2);
          return group;
        },
      },
      // A great helm: a steel bucket with a reinforcing band, rivets, a
      // pointed crown -- and a red plume.
      knightHelmet: {
        name: "Medieval Knight Helmet",
        face: roundFace(KNIGHT.r, KNIGHT.r, KNIGHT.y0, KNIGHT.y1, KNIGHT.cz, 0.085, 0.006),
        build() {
          const group = new THREE.Group();
          const steel = helmetMaterial(0xb9c0c6, 0.32, 0.45); // (see the pot's metalness note)
          const dark = helmetMaterial(0x858c92, 0.38, 0.45);
          const plume = helmetMaterial(0xb3202a, 0.8);
          const { r, y0, y1, cz } = KNIGHT;
          helmetPart(group, new THREE.CylinderGeometry(r, r, y1 - y0, 28, 1, true), steel, 0, (y0 + y1) / 2, cz);
          helmetPart(group, new THREE.CylinderGeometry(0.03, r, 0.08, 28), steel, 0, y1 + 0.04, cz); // crown
          flatRing(group, r + 0.004, 0.01, y0 + 0.006, dark);
          flatRing(group, r + 0.004, 0.009, y1 - 0.006, dark);
          // a reinforcing strip down the front over the brow, rivets round the band
          helmetPart(group, new THREE.BoxGeometry(0.03, 0.05, 0.01), dark, 0, y1 - 0.022, cz + r + 0.004);
          for (let k = 0; k < 16; k++) {
            const a = (k / 16) * Math.PI * 2;
            if (Math.abs(Math.sin(a)) < 0.45 && Math.cos(a) > 0) continue; // not over the face
            helmetPart(group, new THREE.SphereGeometry(0.007, 5, 3), dark, Math.sin(a) * (r + 0.008), y1 - 0.006, cz + Math.cos(a) * (r + 0.008));
          }
          // breathing holes low on each cheek
          for (const side of [1, -1]) for (let k = 0; k < 3; k++) {
            const a = side * (0.95 + k * 0.12);
            helmetPart(group, new THREE.CircleGeometry(0.008, 6), helmetMaterial(0x1a1a1c, 0.9), Math.sin(a) * (r + 0.001), 0.0, cz + Math.cos(a) * (r + 0.001), 0, a, 0);
          }
          const p = helmetPart(group, new THREE.ConeGeometry(0.05, 0.22, 8), plume, 0, y1 + 0.18, cz - 0.02, -0.25, 0, 0);
          p.scale.set(0.7, 1, 1.2);
          return group;
        },
      },
      // A full-face motorcycle helmet: glossy shell, dark chin bar and
      // visor trim, visor pivot screws.
      motorcycleHelmet: {
        name: "Motorcycle Helmet",
        face: roundFace(MOTO.r, MOTO.r, MOTO.y0, MOTO.y1, MOTO.cz, 0.085, 0.005),
        build() {
          const group = new THREE.Group();
          const shell = helmetMaterial(0xc21d25, 0.22, 0.15);
          const trim = helmetMaterial(0x1a1a1c, 0.5);
          const vent = helmetMaterial(0x3a3c40, 0.5);
          const { r, y0, y1, cz } = MOTO;
          helmetPart(group, new THREE.CylinderGeometry(r, r, y1 - y0, 28, 1, true), shell, 0, (y0 + y1) / 2, cz);
          const dome = helmetPart(group, new THREE.SphereGeometry(r, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2), shell, 0, y1, cz);
          dome.scale.set(1, 0.6, 1);
          flatRing(group, r + 0.002, 0.012, y0, trim);
          // visor trim above and below the picture, the chin bar's vent
          frontArc(group, r + 0.006, 0.007, 0.26, 1.05, trim);
          frontArc(group, r + 0.006, 0.007, -0.086, 1.05, trim);
          helmetPart(group, new THREE.BoxGeometry(0.07, 0.012, 0.012), vent, 0, y0 + 0.012, cz + r + 0.004);
          for (const side of [1, -1]) {
            helmetPart(group, new THREE.CylinderGeometry(0.022, 0.022, 0.012, 12), trim, side * (r + 0.004), 0.17, cz + 0.02, 0, 0, Math.PI / 2);
          }
          // spoiler at the back
          helmetPart(group, new THREE.BoxGeometry(0.12, 0.012, 0.05), shell, 0, y1 + 0.06, cz - r * 0.75, -0.5, 0, 0);
          return group;
        },
      },
    };
    const HELMET_KEYS = Object.keys(HELMETS);
    const DEFAULT_HELMET = "bag";

    // Clothing/skin: moderately rough (fabric and skin aren't mirror-like).
    const bodyMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0, skinning: true });
    // CLOTH PATTERNS (see PATTERN): drawn per pixel from the body's rest
    // (bind) position, so they move with the cloth. Worked on top of the
    // vertex color: plaid, camo, hi-vis reflective stripes, a zipper line,
    // a button-up placket with chest pockets, knee patches, a front crease.
    bodyMaterial.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nattribute float clothPattern;\nvarying float vClothPattern;\nvarying vec3 vClothPos;")
        .replace("#include <begin_vertex>", "#include <begin_vertex>\nvClothPattern = clothPattern;\nvClothPos = position;");
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", [
          "#include <common>",
          "varying float vClothPattern;",
          "varying vec3 vClothPos;",
          "float clothHash(vec3 p) { return fract(sin(dot(p, vec3(17.1, 31.7, 11.3))) * 43758.5453); }",
          "float clothNoise(vec3 p) {",
          "  vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);",
          "  return mix(mix(mix(clothHash(i), clothHash(i + vec3(1, 0, 0)), f.x), mix(clothHash(i + vec3(0, 1, 0)), clothHash(i + vec3(1, 1, 0)), f.x), f.y),",
          "    mix(mix(clothHash(i + vec3(0, 0, 1)), clothHash(i + vec3(1, 0, 1)), f.x), mix(clothHash(i + vec3(0, 1, 1)), clothHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);",
          "}",
        ].join("\n"))
        .replace("#include <color_fragment>", [
          "#include <color_fragment>",
          "{",
          "  float cp = floor(vClothPattern + 0.5);",
          "  vec3 q = vClothPos;",
          "  float front = step(0.0, q.z);",
          "  if (cp > 0.5 && cp < 1.5) {", // plaid
          "    float u = (q.x + q.z) * 11.0, v = q.y * 11.0;",
          "    float a = step(0.5, fract(u)), b = step(0.5, fract(v));",
          "    float thin = max(step(0.93, fract(u * 2.0 + 0.3)), step(0.93, fract(v * 2.0 + 0.3)));",
          "    diffuseColor.rgb *= 1.0 - 0.26 * a - 0.26 * b;",
          "    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.82, 0.72), thin * 0.4);",
          "  } else if (cp > 1.5 && cp < 2.5) {", // camo
          "    float n1 = clothNoise(q * 7.0), n2 = clothNoise(q * 14.0 + 3.1);",
          "    float dark = step(0.56, n1 * 0.7 + n2 * 0.3);",
          "    vec3 c = diffuseColor.rgb;",
          "    c = mix(c, c * vec3(0.52, 0.56, 0.48), dark);",
          "    c = mix(c, c * vec3(1.18, 0.98, 0.72), step(0.68, n2) * (1.0 - dark));",
          "    diffuseColor.rgb = c;",
          "  } else if (cp > 2.5 && cp < 3.5) {", // hi-vis vest: two bands and braces over the shoulders
          "    float band = max(step(abs(q.y - 1.09), 0.022), step(abs(q.y - 1.25), 0.022));",
          "    float braces = step(abs(abs(q.x) - 0.085), 0.02) * step(1.25, q.y);",
          "    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.78, 0.8, 0.82), max(band, braces));",
          "  } else if (cp > 3.5 && cp < 4.5) {", // zipper down the front
          "    diffuseColor.rgb *= 1.0 - 0.5 * step(abs(q.x), 0.007) * front;",
          "  } else if (cp > 4.5 && cp < 5.5) {", // button-up: placket, buttons, two chest pockets
          "    float placket = step(abs(q.x), 0.014) * front;",
          "    float button = placket * step(fract(q.y * 12.5), 0.12);",
          "    vec2 pk = vec2(abs(q.x) - 0.085, q.y - 1.33);",
          "    float pocket = front * step(abs(pk.x), 0.045) * step(abs(pk.y), 0.05);",
          "    float inner = step(abs(pk.x), 0.038) * step(abs(pk.y), 0.043);",
          "    diffuseColor.rgb *= 1.0 - 0.12 * placket - 0.2 * pocket * (1.0 - inner);",
          "    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.9, 0.88, 0.84), button * 0.8);",
          "  } else if (cp > 5.5 && cp < 6.5) {", // work pants: knee patches
          "    diffuseColor.rgb *= 1.0 - 0.3 * step(abs(q.y - 0.5), 0.075) * step(0.02, q.z);",
          "  } else if (cp > 6.5) {", // suit pants: a pressed crease down each leg
          "    diffuseColor.rgb *= 1.0 + 0.14 * step(abs(abs(q.x) - 0.095), 0.004) * step(0.02, q.z);",
          "  }",
          "}",
        ].join("\n"));
    };

    // ------------------------------------------------------------------
    // THIRD-PERSON WEAPONS: simple shared low-poly shapes, true-to-size.
    // Weapon-local frame: origin = the right hand's grip, +Z = muzzle
    // (forward), +Y = up. `support`: where the left hand goes. Melee
    // weapons point along +Y from the grip instead.
    // ------------------------------------------------------------------
    const WEAPON_PARTS = (() => {
      const box = (w, h, d, x, y, z, color, rx = 0) => ({ geo: [w, h, d], pos: [x, y, z], color, rx });
      const cyl = (r0, r1, len, x, y, z, color, axis = "z") => ({ cyl: [r0, r1, len], pos: [x, y, z], color, axis });
      const BLK = 0x1e1f21, STEEL = 0x3a3c40, WOOD = 0x6b3e1f, TAN = 0x8a7a5a;
      return {
        pistol: { hold: "pistol", support: [0.035, -0.035, 0.0], parts: [box(0.03, 0.034, 0.2, 0, 0.045, 0.07, STEEL), box(0.028, 0.02, 0.16, 0, 0.02, 0.06, BLK), box(0.027, 0.11, 0.045, 0, -0.03, -0.005, BLK, -0.25)] },
        glock: { hold: "pistol", support: [0.035, -0.035, 0.0], parts: [box(0.029, 0.033, 0.19, 0, 0.044, 0.07, BLK), box(0.028, 0.022, 0.16, 0, 0.02, 0.06, 0x2a2b2d), box(0.027, 0.115, 0.047, 0, -0.032, -0.008, 0x2a2b2d, -0.3)] },
        smg: { hold: "rifle", support: [0.0, -0.035, 0.2], parts: [box(0.045, 0.07, 0.3, 0, 0.04, 0.08, BLK), cyl(0.012, 0.012, 0.16, 0, 0.055, 0.3, STEEL), box(0.028, 0.14, 0.036, 0, -0.06, 0.13, BLK, 0.15), box(0.03, 0.1, 0.045, 0, -0.03, -0.01, BLK, -0.25), box(0.03, 0.05, 0.22, 0, 0.035, -0.17, STEEL)] },
        shotgun: { hold: "rifle", support: [0.0, -0.02, 0.36], parts: [cyl(0.014, 0.014, 0.62, 0, 0.05, 0.42, STEEL), cyl(0.015, 0.015, 0.5, 0, 0.022, 0.36, BLK), box(0.045, 0.06, 0.2, 0, 0.035, 0.04, BLK), box(0.05, 0.05, 0.14, 0, 0.018, 0.36, WOOD), box(0.04, 0.09, 0.32, 0, -0.005, -0.2, WOOD, 0.12)] },
        ak47: { hold: "rifle", support: [0.0, -0.03, 0.3], parts: [box(0.05, 0.07, 0.32, 0, 0.04, 0.08, BLK), cyl(0.011, 0.011, 0.42, 0, 0.06, 0.42, STEEL), box(0.05, 0.05, 0.2, 0, 0.035, 0.32, WOOD), box(0.03, 0.17, 0.05, 0, -0.07, 0.15, 0x3a2a1a, 0.35), box(0.03, 0.1, 0.045, 0, -0.03, -0.01, WOOD, -0.25), box(0.04, 0.07, 0.26, 0, 0.01, -0.2, WOOD, 0.1)] },
        sniper: { hold: "rifle", support: [0.0, -0.03, 0.34], parts: [box(0.05, 0.07, 0.4, 0, 0.035, 0.1, TAN), cyl(0.012, 0.01, 0.62, 0, 0.055, 0.6, STEEL), cyl(0.022, 0.022, 0.3, 0, 0.125, 0.08, BLK), box(0.045, 0.1, 0.3, 0, 0.0, -0.22, TAN, 0.08), box(0.03, 0.1, 0.045, 0, -0.035, -0.02, TAN, -0.25)] },
        bat: { hold: "melee", support: [0, -0.1, 0], parts: [cyl(0.014, 0.017, 0.2, 0, 0.0, 0, 0x2a2a2a, "y"), cyl(0.018, 0.034, 0.62, 0, 0.42, 0, 0xb8894a, "y"), cyl(0.02, 0.02, 0.02, 0, -0.1, 0, 0x2a2a2a, "y")] },
        katana: { hold: "melee", support: [0, -0.1, 0], parts: [cyl(0.015, 0.015, 0.26, 0, -0.02, 0, 0x2a1d1d, "y"), cyl(0.04, 0.04, 0.008, 0, 0.12, 0, 0x8a7a4a, "y"), box(0.006, 0.7, 0.03, 0, 0.47, 0, 0xd0d4d8)] },
      };
    })();
    const weaponGeometryCache = {};
    const weaponMaterialCache = {};
    function weaponMaterial(color) {
      if (!weaponMaterialCache[color]) weaponMaterialCache[color] = new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.2 });
      return weaponMaterialCache[color];
    }
    // Game-supplied held objects (e.g. the deployable turret): { hold,
    // support, build() -> Object3D in weapon-local space, handRot? }.
    function registerWeapon(id, def) {
      WEAPON_PARTS[id] = def;
    }
    function buildWeaponGroup(id, layer) {
      const def = WEAPON_PARTS[id];
      if (def.build) {
        const built = def.build();
        built.traverse((o) => {
          if (o.isMesh) o.castShadow = true;
          if (layer !== undefined) o.layers.set(layer);
        });
        return built;
      }
      const group = new THREE.Group();
      def.parts.forEach((part, i) => {
        const key = id + ":" + i;
        let geo = weaponGeometryCache[key];
        if (!geo) {
          if (part.geo) geo = new THREE.BoxGeometry(...part.geo);
          else {
            geo = new THREE.CylinderGeometry(part.cyl[1], part.cyl[0], part.cyl[2], 10);
            if (part.axis === "z") geo.rotateX(Math.PI / 2);
          }
          weaponGeometryCache[key] = geo;
        }
        const mesh = new THREE.Mesh(geo, weaponMaterial(part.color));
        mesh.position.set(...part.pos);
        if (part.rx) mesh.rotation.x = part.rx;
        mesh.castShadow = true;
        if (layer !== undefined) mesh.layers.set(layer);
        group.add(mesh);
      });
      return group;
    }

    // ------------------------------------------------------------------
    // CHARACTER
    // ------------------------------------------------------------------
    function createCharacter(ap, faceKey, layer) {
      const root = new THREE.Group();
      root.name = "PlayerCharacter";
      const rig = new THREE.Group();
      root.add(rig);
      const bones = BONES.map((def) => {
        const bone = new THREE.Bone();
        bone.name = def.name;
        bone.matrixAutoUpdate = false;
        return bone;
      });
      BONES.forEach((def, i) => { if (def.parent >= 0) bones[def.parent].add(bones[i]); });
      rig.add(bones[0]);
      const skeleton = new THREE.Skeleton(bones, BONES.map(() => new THREE.Matrix4()));
      const face = new THREE.Mesh(getFaceGeometry(faceKey, DEFAULT_HELMET), getFaceMaterial(faceKey));
      face.name = "PlayerFace";
      bones[B.head].add(face);
      // Weapon socket: positioned every frame in the character's space (see
      // poseWeapon); both hands are solved onto it.
      const socket = new THREE.Group();
      socket.name = "WeaponSocket";
      root.add(socket);
      const character = {
        root, rig, bones, skeleton, face, socket, layer,
        meshes: [], appearance: null, faceKey,
        helmetKey: null, helmets: {},
        lod: 0, weaponId: null, weapons: {},
        anim: createAnimState(),
        restLocal: [], restAbs: [],
      };
      if (layer !== undefined) face.layers.set(layer);
      applyAppearance(character, ap);
      setHelmet(character, DEFAULT_HELMET);
      return character;
    }

    function applyAppearance(character, ap) {
      character.appearance = ap;
      const J = jointsFor(ap);
      character.restAbs = J;
      character.restLocal = J.map((j, i) => (BONES[i].parent < 0 ? j.clone() : j.clone().sub(J[BONES[i].parent])));
      character.bones.forEach((bone, i) => {
        bone.position.copy(character.restLocal[i]);
        bone.rotation.set(0, 0, 0);
        bone.updateMatrix();
        character.skeleton.boneInverses[i].makeTranslation(-J[i].x, -J[i].y, -J[i].z);
      });
      for (const mesh of character.meshes) {
        character.rig.remove(mesh);
        mesh.geometry.dispose();
      }
      if (character.clothing) {
        for (const geometries of character.clothing.values()) geometries.forEach((geometry) => geometry.dispose());
        character.clothing.clear();
      }
      character.meshes = LOD_SPECS.map((lod, i) => {
        const mesh = new THREE.SkinnedMesh(buildBodyGeometry(ap, lod), bodyMaterial);
        mesh.bind(character.skeleton, new THREE.Matrix4());
        mesh.castShadow = true;
        mesh.receiveShadow = i === 0;
        mesh.visible = i === character.lod;
        if (character.layer !== undefined) mesh.layers.set(character.layer);
        character.rig.add(mesh);
        return mesh;
      });
      character.anim.legLength = (J[B.thighL].y - J[B.footL].y);
    }

    // Changes what the character wears (one of SHIRT_KEYS / PANTS_KEYS),
    // swapping only the body geometry -- the skeleton, face, helmet and
    // weapon stay as they are. Each outfit's geometry is kept (a few per
    // character) so flipping back and forth on the setup screen is instant.
    const CLOTHING_CACHE_SIZE = 6;
    function setClothing(character, shirtKey, pantsKey) {
      const current = character.appearance;
      const ap = dressAppearance(current, shirtKey, pantsKey);
      if (current.shirtStyle === ap.shirtStyle && current.pantsStyle === ap.pantsStyle) return;
      const cache = character.clothing || (character.clothing = new Map());
      const keyOf = (a) => (a.shirtStyle || "?") + "|" + (a.pantsStyle || "?") + "|" + (a.shirtKind + a.pantsKind);
      if (!cache.has(keyOf(current))) cache.set(keyOf(current), character.meshes.map((m) => m.geometry));
      const key = keyOf(ap);
      let geometries = cache.get(key);
      if (geometries) cache.delete(key); // (re-inserted below: most recent last)
      else geometries = LOD_SPECS.map((lod) => buildBodyGeometry(ap, lod));
      cache.set(key, geometries);
      character.appearance = ap;
      character.meshes.forEach((mesh, i) => { mesh.geometry = geometries[i]; });
      while (cache.size > CLOTHING_CACHE_SIZE) {
        const [oldKey, old] = cache.entries().next().value;
        cache.delete(oldKey);
        old.forEach((geometry) => geometry.dispose());
      }
    }

    function setFace(character, key) {
      character.faceKey = key;
      character.face.geometry = getFaceGeometry(key, character.helmetKey || DEFAULT_HELMET);
      character.face.material = getFaceMaterial(key);
    }

    // Swaps what's over the character's head (one of HELMET_KEYS; anything
    // else falls back to the paper bag), moving the face picture onto it.
    // Each helmet is built the first time it's worn, then just shown/hidden.
    function setHelmet(character, key) {
      if (!HELMETS[key]) key = DEFAULT_HELMET;
      if (character.helmetKey === key) return;
      if (character.helmetKey) character.helmets[character.helmetKey].visible = false;
      character.helmetKey = key;
      if (!character.helmets[key]) {
        const helmet = HELMETS[key].build(character.appearance);
        helmet.name = "Helmet:" + key;
        helmet.traverse((o) => {
          if (!o.isMesh) return;
          o.castShadow = true;
          if (character.layer !== undefined) o.layers.set(character.layer);
        });
        character.bones[B.head].add(helmet);
        character.helmets[key] = helmet;
      }
      character.helmets[key].visible = true;
      character.face.geometry = getFaceGeometry(character.faceKey, key);
    }

    function setWeapon(character, weaponId) {
      const id = weaponId && WEAPON_PARTS[weaponId] ? weaponId : null;
      if (character.weaponId === id) return;
      if (character.weaponId) character.weapons[character.weaponId].visible = false;
      character.weaponId = id;
      if (!id) return;
      if (!character.weapons[id]) {
        const group = buildWeaponGroup(id, character.layer);
        character.socket.add(group);
        character.weapons[id] = group;
      }
      character.weapons[id].visible = true;
    }

    function setLod(character, lod) {
      character.lod = lod;
      character.meshes.forEach((m, i) => { m.visible = i === Math.min(lod, character.meshes.length - 1); });
    }

    // ------------------------------------------------------------------
    // ANIMATION
    // Locomotion is one continuous gait parameter g -- 0 idle, 1 walk,
    // 2 run, 3 sprint -- driven by ground speed, smoothed, with every cycle
    // parameter interpolated along it (stride, leg swing, knee drive, arm
    // swing, lean, bob). The phase advances by distance travelled over the
    // current stride, so feet stay planted and speed changes never snap.
    // Strafing/backpedalling turns the lower body toward the move direction
    // while the upper body keeps facing where the player looks.
    // ------------------------------------------------------------------
    const GAIT = {
      //            idle   walk   run    sprint
      stride:      [1.4,   1.45,  2.6,   4.1],   // m per full cycle (two steps)
      thighAmp:    [0,     0.42,  0.72,  0.95],
      thighBias:   [0,     0.02,  0.12,  0.2],   // forward knee drive
      kneeLift:    [0,     0.65,  1.35,  1.75],
      kneeStance:  [0.04,  0.08,  0.22,  0.28],
      heelToe:     [0,     0.28,  0.35,  0.45],
      lean:        [0.0,   0.03,  0.12,  0.24],
      hipTwist:    [0,     0.09,  0.14,  0.18],
      chestTwist:  [0,     0.07,  0.12,  0.17],
      armSwing:    [0.03,  0.33,  0.72,  1.0],
      elbow:       [-0.12, -0.28, -1.25, -1.5],
      bob:         [0,     0.022, 0.045, 0.06],
      flight:      [0,     0,     1,     1],     // 0 = walk bob (low at double support), 1 = run bob (low mid-stance)
    };
    function gaitValue(key, g) {
      const arr = GAIT[key];
      const i = Math.min(2, Math.floor(g));
      const f = Math.min(1, g - i);
      return arr[i] + (arr[i + 1] - arr[i]) * f;
    }
    function gaitForSpeed(speed) {
      if (speed < 0.15) return 0;
      if (speed < 1.8) return speed / 1.8;
      if (speed < 4.85) return 1 + (speed - 1.8) / 3.05;
      return Math.min(3, 2 + (speed - 4.85) / 3.6);
    }

    function createAnimState() {
      return {
        pose: new Float32Array(BONE_COUNT * 3),
        hips: new THREE.Vector3(),
        hipsTarget: new THREE.Vector3(),
        phase: Math.random() * Math.PI * 2,
        g: 0,
        lowerYaw: 0,
        time: Math.random() * 50,
        crouch: 0, slide: 0, air: 0, dead: 0, deadTime: 0, aim: 0, sprintHold: 0,
        downed: 0, crawlPhase: 0, crawlMove: 0, diedProne: false,
        flinch: null,
        springs: new Float32Array(10),
        accum: 0, frame: 0,
        legLength: 0.85,
      };
    }

    function set(pose, b, x, y, z) { pose[b * 3] = x; pose[b * 3 + 1] = y; pose[b * 3 + 2] = z; }
    function add(pose, b, x, y, z) { pose[b * 3] += x; pose[b * 3 + 1] += y; pose[b * 3 + 2] += z; }
    function smooth01(t) { const c = Math.min(1, Math.max(0, t)); return c * c * (3 - 2 * c); }
    function approach(v, target, rate, dt) { return v + (target - v) * Math.min(1, rate * dt); }
    function spring(anim, i, target, freq, damp, dt, enabled) {
      const sp = anim.springs, k = i * 2;
      if (!enabled) { sp[k] = target; sp[k + 1] = 0; return target; }
      const w = 2 * Math.PI * freq;
      const steps = Math.min(4, Math.ceil(dt * 60));
      const h = dt / steps;
      let x = sp[k], v = sp[k + 1];
      for (let n = 0; n < steps; n++) { v += (w * w * (target - x) - 2 * damp * w * v) * h; x += v * h; }
      sp[k] = x; sp[k + 1] = v;
      return x;
    }

    // One leg's pose on the cycle: theta = pi/2 is heel strike (leg fully
    // forward), stance runs to 3pi/2 (toe-off), then the swing.
    function legPose(pose, thighB, shinB, footB, theta, g, amp, crouchBend) {
      const s = Math.sin(theta), c = Math.cos(theta);
      const thigh = -amp * s - gaitValue("thighBias", g) * Math.max(0, c) - crouchBend;
      const knee = gaitValue("kneeStance", g) + gaitValue("kneeLift", g) * Math.pow(Math.max(0, c), 1.4) * (amp > 0 ? 1 : 0) + 2 * crouchBend;
      // Flat foot, plus heel-to-toe: toes up into the heel strike, rolling
      // through, pushing off onto the toes as the leg leaves the ground.
      const ht = gaitValue("heelToe", g);
      const toesUp = -ht * Math.max(0, s) * smooth01((c + 0.2) / 0.6);
      const pushOff = ht * 1.4 * Math.max(0, -s) * smooth01((c + 0.3) / 0.6);
      set(pose, thighB, thigh, 0, 0);
      set(pose, shinB, knee, 0, 0);
      set(pose, footB, -(thigh + knee) + toesUp + pushOff - crouchBend * 0.0, 0, 0);
      return thigh;
    }

    // state: { vx, vz, yaw, pitch, grounded, crouch, sliding, aim, reload,
    //   kickZ, kickPitch, weaponDelta {px,py,pz,rx,ry,rz}, melee: {kind, t, fist} | null,
    //   dead, downed, hurt, distance }
    // downed: low on hands and knees, crawling (velocity drives the crawl
    // cycle). Dying while downed flops flat onto the stomach instead of
    // playing the standing topple.
    function update(character, deltaSeconds, st) {
      const anim = character.anim;
      // LOD by distance to the viewing player.
      const d = st.distance || 0;
      let lod = d > 30 ? 2 : d > 12 ? 1 : 0;
      if (lod !== character.lod) setLod(character, lod);
      anim.accum += deltaSeconds;
      anim.frame++;
      const interval = lod === 2 ? 3 : lod === 1 ? 2 : 1;
      const busy = st.melee || st.reload !== null && st.reload !== undefined || anim.flinch;
      if (!busy && anim.frame % interval !== 0) { poseWeapon(character, st, 0); return; }
      const dt = anim.accum;
      anim.accum = 0;
      anim.time += dt;
      const secondary = lod === 0;
      const pose = anim.pose;
      pose.fill(0);

      // ---- Movement, in the character's own frame ----
      const fwdX = Math.sin(st.yaw), fwdZ = Math.cos(st.yaw);
      const fs = st.vx * fwdX + st.vz * fwdZ;          // forward speed
      const ls = st.vx * fwdZ - st.vz * fwdX;           // toward the character's left (+X)
      const speed = st.grounded ? Math.hypot(st.vx, st.vz) : 0;
      anim.g = approach(anim.g, gaitForSpeed(speed) * (1 - 0.35 * anim.crouch), 5, dt);
      const g = anim.g;
      let moveAngle = Math.atan2(ls, fs);
      let dir = 1;
      if (Math.abs(moveAngle) > Math.PI / 2 + 0.1) { moveAngle -= Math.sign(moveAngle) * Math.PI; dir = -1; }
      const turnLower = speed > 0.3 ? Math.max(-1.0, Math.min(1.0, moveAngle * 0.85)) : 0;
      anim.lowerYaw = approach(anim.lowerYaw, turnLower, 6, dt);
      const stride = gaitValue("stride", Math.max(1, g));
      anim.phase = (anim.phase + dir * (speed * dt / stride) * Math.PI * 2) % (Math.PI * 2);
      const p = anim.phase;
      const gw = Math.min(1, g);                        // idle -> walk weight

      anim.crouch = approach(anim.crouch, st.crouch || 0, 10, dt);
      anim.slide = approach(anim.slide, st.sliding ? 1 : 0, 10, dt);
      anim.air = approach(anim.air, st.grounded ? 0 : 1, 10, dt);
      anim.aim = st.aim || 0;
      anim.dead = approach(anim.dead, st.dead ? 1 : 0, st.dead ? 1.8 : 6, dt);
      if (!st.dead) anim.diedProne = false;
      else if (anim.downed > 0.5) anim.diedProne = true;
      anim.downed = approach(anim.downed, st.downed || anim.diedProne ? 1 : 0, 3, dt);
      const crawlSpeed = Math.hypot(st.vx, st.vz);
      anim.crawlMove = approach(anim.crawlMove, st.downed && !st.dead ? Math.min(1, crawlSpeed / 0.4) : 0, 6, dt);
      anim.crawlPhase = (anim.crawlPhase + (fs < -0.05 ? -1 : 1) * (crawlSpeed * dt / 0.7) * Math.PI * 2) % (Math.PI * 2); // one arm-over-arm cycle per 0.7 m
      if (st.hurt && !st.dead) anim.flinch = { t: 0, side: Math.random() < 0.5 ? -1 : 1 };

      // ---- Legs ----
      const amp = gaitValue("thighAmp", g) * gw;
      // Crouch: bend at hip/knee/ankle so the hips drop and the feet stay put.
      const L = anim.legLength;
      const crouchDrop = 0.36 * anim.crouch;
      const crouchBend = Math.acos(Math.max(0.2, Math.min(1, 1 - crouchDrop / L)));
      legPose(pose, B.thighL, B.shinL, B.footL, p, g, amp, crouchBend);
      legPose(pose, B.thighR, B.shinR, B.footR, p + Math.PI, g, amp, crouchBend);

      // ---- Weight: bob, compression, lateral shift over the planted leg ----
      const s = Math.sin(p), c = Math.cos(p);
      const bob = gaitValue("bob", g) * gw;
      const flight = gaitValue("flight", g);
      const walkBob = -bob * (s * s);                                    // low at double support
      const runBob = -bob * (1 - s * s) + bob * 0.3;                     // low mid-stance, up in flight
      const land = 0.5 + 0.5 * Math.cos(2 * (p - Math.PI / 2) - 0.5);    // just after each footfall
      let hipsY = walkBob * (1 - flight) + runBob * flight - 0.012 * land * gw * (1 - flight) - L * (1 - Math.cos(crouchBend));
      const breathe = Math.sin(anim.time * 1.6);
      anim.hipsTarget.set(-0.02 * Math.cos(p - 0.3) * gw * (1 - 0.6 * flight) + 0.012 * Math.sin(anim.time * 0.35) * (1 - gw), hipsY, 0.01 * gw);

      // ---- Pelvis / spine / chest: twist, counter-twist, lean ----
      const hipTwist = gaitValue("hipTwist", g) * gw;
      const chestTwist = gaitValue("chestTwist", g) * gw;
      const lean = gaitValue("lean", g) * (dir > 0 ? 1 : -0.4) + 0.32 * anim.crouch;
      set(pose, B.hips, 0.03 * anim.crouch, anim.lowerYaw - hipTwist * Math.sin(p - 0.15), 0.03 * Math.cos(p - 0.2) * gw);
      const roll = spring(anim, 0, -0.03 * Math.cos(p - 0.45) * gw, 2.2, 0.5, dt, secondary);
      // Upper body keeps facing the look direction: undo the lower-body turn.
      set(pose, B.spine, lean * 0.45 + 0.012 * land * gw, -anim.lowerYaw * 0.55 + chestTwist * 0.6 * Math.sin(p - 0.35), roll);
      set(pose, B.chest, lean * 0.35 + 0.012 * breathe * (1 - gw), -anim.lowerYaw * 0.45 + chestTwist * Math.sin(p - 0.6), -0.4 * roll);
      // Look pitch spread up the spine; head keeps level-ish with the eyes.
      const pitch = Math.max(-1.2, Math.min(1.2, st.pitch || 0));
      add(pose, B.spine, -pitch * 0.18, 0, 0);
      add(pose, B.chest, -pitch * 0.24, 0, 0);
      const headYaw = spring(anim, 1, -(chestTwist * Math.sin(p - 0.6)) * 0.8, 3.2, 0.6, dt, secondary);
      const headPitch = spring(anim, 2, 0.02 * land * gw, 3.4, 0.5, dt, secondary);
      set(pose, B.neck, -lean * 0.3 - pitch * 0.25, headYaw * 0.4, 0);
      set(pose, B.head, -lean * 0.45 - pitch * 0.33 + headPitch + (secondary ? 0.02 * Math.sin(anim.time * 0.4) * (1 - gw) : 0), headYaw * 0.6, -0.4 * roll);
      set(pose, B.clavL, 0, -0.04 * Math.sin(p - 0.8) * gw, 0.02 * land * gw);
      set(pose, B.clavR, 0, -0.04 * Math.sin(p - 0.8) * gw, -0.02 * land * gw);

      // ---- Arms (free swing -- overridden by IK when a hand is on a weapon) ----
      const armAmp = gaitValue("armSwing", g) * gw;
      const elbowBase = gaitValue("elbow", g);
      for (const side of [1, -1]) {
        const Lft = side > 0;
        const ua = Lft ? B.upperArmL : B.upperArmR, fa = Lft ? B.forearmL : B.forearmR, hd = Lft ? B.handL : B.handR;
        const legTheta = Lft ? p : p + Math.PI;
        const target = armAmp * Math.sin(legTheta - 0.25) - 0.05 * (1 - gw);        // opposite its own leg
        const swing = spring(anim, Lft ? 3 : 4, target, 2.4, 0.55, dt, secondary);
        const vel = secondary ? anim.springs[(Lft ? 3 : 4) * 2 + 1] : 0;
        set(pose, ua, swing, side * 0.05 * swing, side * (0.08 + 0.02 * breathe * (1 - gw)));
        set(pose, fa, elbowBase - 0.18 * Math.max(0, -swing) * (g < 1.8 ? 1 : 0.3) + Math.max(-0.2, Math.min(0.1, 0.06 * vel)), 0, 0);
        set(pose, hd, 0.1 + Math.max(-0.2, Math.min(0.2, -0.04 * vel)), 0, -side * 0.06);
      }

      // ---- Fists: a guard, and a straight punch from the swinging side ----
      if (!character.weaponId && (st.melee || (st.aim || 0) > 0.05)) {
        const guard = st.melee ? 1 : smooth01(st.aim);
        for (const side of [1, -1]) {
          const ua = side > 0 ? B.upperArmL : B.upperArmR, fa = side > 0 ? B.forearmL : B.forearmR;
          pose[ua * 3] += (-0.9 - pose[ua * 3]) * guard;
          pose[ua * 3 + 2] += (side * 0.25 - pose[ua * 3 + 2]) * guard;
          pose[fa * 3] += (-1.9 - pose[fa * 3]) * guard;
        }
        if (st.melee) {
          const t = st.melee.t;
          const out = Math.sin(Math.PI * Math.min(1, t / 0.6));      // extend, then retract
          const side = st.melee.fist === "left" ? 1 : -1;
          const ua = side > 0 ? B.upperArmL : B.upperArmR, fa = side > 0 ? B.forearmL : B.forearmR;
          add(pose, ua, -0.6 * out, 0, -side * 0.2 * out);
          add(pose, fa, 1.6 * out, 0, 0);
          add(pose, B.chest, 0, -side * 0.35 * out, 0);
          add(pose, B.spine, 0.05 * out, -side * 0.15 * out, 0);
        }
      }

      // ---- Airborne: tuck the legs, arms out for balance ----
      if (anim.air > 0.01) {
        const a = anim.air;
        for (const [th, sh, ft, k] of [[B.thighL, B.shinL, B.footL, 1], [B.thighR, B.shinR, B.footR, 0.6]]) {
          pose[th * 3] = pose[th * 3] * (1 - a) + (-0.55 * k) * a;
          pose[sh * 3] = pose[sh * 3] * (1 - a) + (0.95 * k) * a;
          pose[ft * 3] = pose[ft * 3] * (1 - a) + (0.1) * a;
        }
        add(pose, B.upperArmL, -0.2 * a, 0, 0.25 * a);
        add(pose, B.upperArmR, -0.2 * a, 0, -0.25 * a);
      }
      // ---- Slide: lead leg out front, trailing leg folded, leaning back ----
      if (anim.slide > 0.01) {
        const k = anim.slide;
        const blendTo = (b, x, y, z) => { pose[b * 3] += (x - pose[b * 3]) * k; pose[b * 3 + 1] += (y - pose[b * 3 + 1]) * k; pose[b * 3 + 2] += (z - pose[b * 3 + 2]) * k; };
        blendTo(B.thighL, -1.35, 0, 0.05); blendTo(B.shinL, 0.25, 0, 0); blendTo(B.footL, 0.3, 0, 0);
        blendTo(B.thighR, -0.35, 0, -0.25); blendTo(B.shinR, 1.9, 0, 0); blendTo(B.footR, 0.4, 0, 0);
        blendTo(B.spine, -0.25, 0, 0); blendTo(B.chest, -0.1, 0, 0);
        anim.hipsTarget.y = anim.hipsTarget.y * (1 - k) - 0.55 * k;
      }
      // ---- Downed: low on hands and knees -- knees planted under the hips,
      // hands pressed into the ground ahead of the shoulders (elbows soft),
      // back and hips raised, torso tipped forward, head up to look ahead.
      // Crawls diagonal limbs together (left hand with right knee).
      // Bleeding out from here flops flat onto the stomach (limp). ----
      const pk = smooth01(anim.downed);
      if (pk > 0.001) {
        const blendTo = (b, x, y, z) => { pose[b * 3] += (x - pose[b * 3]) * pk; pose[b * 3 + 1] += (y - pose[b * 3 + 1]) * pk; pose[b * 3 + 2] += (z - pose[b * 3 + 2]) * pk; };
        const m = anim.crawlMove, cp = anim.crawlPhase;
        const limp = anim.diedProne;
        const sway = Math.sin(cp) * m;
        const pitchUp = Math.max(-0.5, Math.min(0.5, st.pitch || 0));
        if (limp) {
          blendTo(B.hips, 1.55, 0, 0);                 // lying face down
          blendTo(B.spine, 0, 0, 0); blendTo(B.chest, 0, 0, 0);
          blendTo(B.neck, -0.2, 0.3, 0);
          blendTo(B.head, -0.2, 1.1, 0.1);             // cheek on the ground
          for (const side of [1, -1]) {
            const Lft = side > 0;
            blendTo(Lft ? B.clavL : B.clavR, 0, 0, 0);
            blendTo(Lft ? B.upperArmL : B.upperArmR, -0.1, 0, side * 0.2);
            blendTo(Lft ? B.forearmL : B.forearmR, -0.15, 0, 0);
            blendTo(Lft ? B.handL : B.handR, 0, 0, 0);
            blendTo(Lft ? B.thighL : B.thighR, -0.08, 0, side * 0.1);
            blendTo(Lft ? B.shinL : B.shinR, 0.1, 0, 0);
            blendTo(Lft ? B.footL : B.footR, 0.9, 0, 0);
          }
          anim.hipsTarget.set(anim.hipsTarget.x * (1 - pk), anim.hipsTarget.y * (1 - pk) - 0.83 * pk, anim.hipsTarget.z * (1 - pk));
        } else {
          // Hips tipped forward 1.45 rad; the thighs undo it (hanging
          // straight down to the knees) and the shins fold back flat.
          blendTo(B.hips, 1.45, 0.08 * sway, 0.04 * sway);
          blendTo(B.spine, -0.03, -0.05 * sway, -0.03 * sway);
          blendTo(B.chest, -0.02, -0.04 * sway, 0);
          blendTo(B.neck, -0.6 - pitchUp * 0.2, 0, 0);          // head raised, eyes ahead
          blendTo(B.head, -0.7 - pitchUp * 0.3, 0.05 * sway, 0);
          for (const side of [1, -1]) {
            const Lft = side > 0;
            const arm = Math.sin(Lft ? cp : cp + Math.PI) * m;   // +1 = this hand planted furthest ahead
            const armLift = Math.max(0, Math.cos(Lft ? cp : cp + Math.PI)) * m; // swinging forward: hand clears the ground
            const leg = Math.sin(Lft ? cp + Math.PI : cp) * m;   // the opposite knee moves with it
            blendTo(Lft ? B.clavL : B.clavR, 0, 0, 0);
            blendTo(Lft ? B.upperArmL : B.upperArmR, -1.65 - 0.28 * arm, 0, side * 0.12);
            blendTo(Lft ? B.forearmL : B.forearmR, -0.3 - 0.35 * armLift, 0, 0);   // elbows slightly bent
            blendTo(Lft ? B.handL : B.handR, -1.0, 0, 0);                          // palm flat, fingers ahead
            blendTo(Lft ? B.thighL : B.thighR, -1.45 - 0.22 * leg, 0, side * 0.06);
            blendTo(Lft ? B.shinL : B.shinR, 1.57, 0, 0);
            blendTo(Lft ? B.footL : B.footR, 1.2, 0, 0);          // tops of the feet on the ground
          }
          // Hips at thigh height above the planted knees.
          anim.hipsTarget.set(anim.hipsTarget.x * (1 - pk), anim.hipsTarget.y * (1 - pk) + (-0.435 + 0.015 * Math.abs(sway)) * pk, anim.hipsTarget.z * (1 - pk));
        }
      }
      // ---- Hit flinch ----
      if (anim.flinch) {
        const f = anim.flinch;
        f.t += dt;
        const k = f.t < 0.05 ? f.t / 0.05 : Math.exp(-(f.t - 0.05) * 9);
        add(pose, B.spine, -0.1 * k, 0.12 * f.side * k, 0);
        add(pose, B.chest, -0.16 * k, 0.08 * f.side * k, 0);
        add(pose, B.head, -0.22 * k, -0.12 * f.side * k, 0.06 * f.side * k);
        anim.hipsTarget.z -= 0.03 * k;
        if (f.t > 0.5) anim.flinch = null;
      }
      // ---- Death: knees give, then a forward topple (the whole rig pivots at the feet) ----
      const dk = anim.diedProne ? 0 : smooth01(anim.dead);
      if (dk > 0.001) {
        const blendTo = (b, x, y, z) => { pose[b * 3] += (x - pose[b * 3]) * dk; pose[b * 3 + 1] += (y - pose[b * 3 + 1]) * dk; pose[b * 3 + 2] += (z - pose[b * 3 + 2]) * dk; };
        blendTo(B.thighL, -0.9, 0, 0.1); blendTo(B.shinL, 1.4, 0, 0); blendTo(B.thighR, -0.5, 0, -0.1); blendTo(B.shinR, 0.9, 0, 0);
        blendTo(B.spine, 0.3, 0.1, 0.05); blendTo(B.chest, 0.2, 0, 0); blendTo(B.head, 0.35, 0.3, 0.1);
        blendTo(B.upperArmL, -0.8, 0, 0.5); blendTo(B.upperArmR, -1.1, 0, -0.3); blendTo(B.forearmL, -0.4, 0, 0); blendTo(B.forearmR, -0.2, 0, 0);
        anim.hipsTarget.y = anim.hipsTarget.y * (1 - dk) - 0.35 * dk;
      }
      // Death topples the rig forward about the feet. Downed, the bones do
      // all the work; the rig only slides back so the raised head sits
      // near the player's actual position.
      const topple = anim.diedProne ? 0 : smooth01((anim.dead - 0.35) / 0.65);
      character.rig.rotation.x = 1.35 * topple;
      character.rig.position.z = 0.25 * topple - 0.45 * pk;

      // ---- Apply to bones (quick easing; the timing is in the pose) ----
      const blend = 1 - Math.exp(-18 * dt);
      const bones = character.bones;
      for (let i = 0; i < BONE_COUNT; i++) {
        const r = bones[i].rotation;
        r.x += (pose[i * 3] - r.x) * blend;
        r.y += (pose[i * 3 + 1] - r.y) * blend;
        r.z += (pose[i * 3 + 2] - r.z) * blend;
      }
      anim.hips.lerp(anim.hipsTarget, blend);
      bones[0].position.copy(character.restLocal[0]).add(anim.hips);
      for (let i = 0; i < BONE_COUNT; i++) bones[i].updateMatrix();

      poseWeapon(character, st, dt);
    }

    // ------------------------------------------------------------------
    // WEAPON HOLD: the socket goes where the weapon should be for the
    // current hold (low ready / aimed down the look direction / sprint
    // carry / melee), riding along with the chest, plus the game's own
    // recoil, reload and melee offsets (the same values the first-person
    // gun uses). Then each hand is solved onto its grip with a two-bone
    // IK, so the hands can't miss the weapon.
    // ------------------------------------------------------------------
    const HOLDS = {
      //        [position m (x = the character's left), rotation (x: + tips the muzzle down, y: + turns it left)]
      rifle: {
        low: [[-0.1, 1.1, 0.27], [0.5, 0.3, 0]],
        aim: [[-0.08, 1.4, 0.24], [0, 0.03, 0]],
        sprint: [[-0.02, 1.2, 0.2], [-0.4, 0.95, 0.5]],
      },
      pistol: {
        low: [[-0.06, 1.05, 0.3], [0.75, 0.15, 0]],
        aim: [[-0.03, 1.4, 0.44], [0, 0.03, 0]],
        sprint: [[-0.17, 0.98, 0.1], [1.1, 0.1, 0]],
      },
      // Carrying something bulky in both hands (the turret), held against the stomach.
      carry: {
        low: [[-0.11, 1.02, 0.36], [0.1, 0, 0]],
        aim: [[-0.11, 1.02, 0.36], [0.1, 0, 0]],
        sprint: [[-0.11, 1.0, 0.33], [0.15, 0, 0]],
      },
      melee: {
        low: [[-0.14, 1.1, 0.2], [-0.75, 0, 0.45]],   // bat resting back over the right shoulder
        aim: [[-0.1, 1.2, 0.3], [-0.2, 0, 0.3]],
        sprint: [[-0.16, 1.05, 0.15], [-0.9, 0, 0.55]],
      },
    };
    const vA = new THREE.Vector3(), vB = new THREE.Vector3(), eA = new THREE.Euler(), eB = new THREE.Euler();
    const qA = new THREE.Quaternion(), qB = new THREE.Quaternion(), qC = new THREE.Quaternion();
    const chestRest = new THREE.Vector3(), chestNow = new THREE.Vector3(), mTmp = new THREE.Matrix4();

    function poseWeapon(character, st, dt) {
      const id = character.weaponId;
      const anim = character.anim;
      const root = character.root;
      root.updateMatrixWorld(true);
      if (!id || anim.dead > 0.5) {
        character.socket.visible = false;
        return;
      }
      character.socket.visible = true;
      const def = WEAPON_PARTS[id];
      const hold = HOLDS[def.hold];
      // Sprint carry weight follows the gait past a run.
      anim.sprintHold = approach(anim.sprintHold, anim.g > 2.4 && !st.melee && !(st.aim > 0.1) && st.reload == null ? 1 : 0, 8, dt || 0.016);
      const aimW = def.hold === "melee" || def.hold === "carry" ? 0 : smooth01(st.aim || 0);
      const sprintW = smooth01(anim.sprintHold) * (1 - aimW);
      const pitch = Math.max(-1.2, Math.min(1.2, st.pitch || 0));
      // Blend position/rotation of low -> aim -> sprint.
      vA.fromArray(hold.low[0]).lerp(vB.fromArray(hold.aim[0]), aimW).lerp(vB.fromArray(hold.sprint[0]), sprintW);
      qA.setFromEuler(eA.set(...hold.low[1], "YXZ"));
      qB.setFromEuler(eB.set(...hold.aim[1], "YXZ"));
      qA.slerp(qB, aimW);
      qB.setFromEuler(eB.set(...hold.sprint[1], "YXZ"));
      qA.slerp(qB, sprintW);
      // Aimed: follow the look pitch (the gun points where the camera does).
      qB.setFromEuler(eB.set(-pitch * (def.hold === "carry" ? 0.1 : 0.35 + 0.65 * aimW), 0, 0, "YXZ"));
      qA.premultiply(qB);
      if (aimW > 0) vA.y += Math.sin(pitch) * 0.12 * aimW;
      // Ride along with the chest (bob, lean, crouch, twist).
      const chestBone = character.bones[B.chest];
      chestBone.getWorldPosition(chestNow);
      root.worldToLocal(chestNow);
      chestRest.copy(character.restAbs[B.chest]);
      vA.add(chestNow.sub(chestRest).multiplyScalar(0.9));
      // The game's own weapon motion (camera space -> character space:
      // camera x right = our -X, camera +z = toward the player = our -Z).
      const w = st.weaponDelta;
      if (w) {
        vA.x -= w.px * 0.55; vA.y += w.py * 0.55; vA.z -= w.pz * 0.55;
        qB.setFromEuler(eB.set(-w.rx * 0.8, w.ry * 0.8, -w.rz * 0.8, "YXZ"));
        qA.multiply(qB);
      }
      // Melee swings (bat/katana: a big diagonal chop; guns: a butt-stroke;
      // fists handled by the arms, no weapon).
      if (st.melee && def.hold === "melee") {
        const t = st.melee.t;
        const wind = smooth01(t / 0.3), strike = smooth01((t - 0.3) / 0.25), back = smooth01((t - 0.7) / 0.3);
        vA.x += -0.05 * wind + 0.35 * strike - 0.3 * back;
        vA.y += 0.25 * wind - 0.35 * strike + 0.1 * back;
        vA.z += 0.25 * strike - 0.25 * back;
        qB.setFromEuler(eB.set(-0.6 * wind + 2.1 * strike - 1.5 * back, 0.6 * wind - 1.3 * strike + 0.7 * back, 0.3 * wind - 0.6 * strike + 0.3 * back, "YXZ"));
        qA.multiply(qB);
      }
      character.socket.position.copy(vA);
      character.socket.quaternion.copy(qA);
      character.socket.updateMatrixWorld(true);

      // Hands onto the grips (IK), skipped far away (the arms still follow
      // the socket closely enough at that range).
      if (character.lod >= 2) return;
      solveHand(character, false, vB.set(0, 0, 0), 1, def.handRot && def.handRot.right);
      let supportW = def.hold === "pistol" ? 1 - sprintW : 1;
      const support = vA.fromArray(def.support);
      if (st.reload != null && def.hold !== "melee") {
        // Reload: the support hand goes to the magazine, down to the belt
        // for a fresh one, and back.
        const t = st.reload;
        const magWell = [0, -0.1, def.hold === "rifle" ? 0.12 : 0.0];
        const k1 = smooth01(t / 0.25), k2 = smooth01((t - 0.25) / 0.2), k3 = smooth01((t - 0.5) / 0.2), k4 = smooth01((t - 0.8) / 0.2);
        const mw = new THREE.Vector3().fromArray(magWell);
        const belt = new THREE.Vector3(0.14, 0.95, 0.06);
        character.socket.worldToLocal(root.localToWorld(belt));
        support.lerp(mw, k1).lerp(belt, k2 * (1 - k3)).lerp(mw, k3 * (1 - k4)).lerp(vB.fromArray(def.support), k4);
      }
      if (def.hold === "melee" || def.hold === "carry") supportW = 1;
      if (supportW > 0.01) solveHand(character, true, support, supportW, def.handRot && def.handRot.left);
    }

    // Two-bone IK: rotates the upper arm and forearm so the hand reaches
    // `target` (weapon-socket space), elbow bending down and out.
    const S = new THREE.Vector3(), E = new THREE.Vector3(), W = new THREE.Vector3(), T = new THREE.Vector3(), P = new THREE.Vector3();
    const d1 = new THREE.Vector3(), d2 = new THREE.Vector3(), Enew = new THREE.Vector3();
    const qWorld = new THREE.Quaternion(), qParent = new THREE.Quaternion(), qDelta = new THREE.Quaternion(), qOld = new THREE.Quaternion();
    function rotateBoneToward(bone, from, to, weight) {
      qDelta.setFromUnitVectors(from, to);
      bone.getWorldQuaternion(qWorld);
      qOld.copy(bone.quaternion);
      qWorld.premultiply(qDelta);
      bone.parent.getWorldQuaternion(qParent);
      bone.quaternion.copy(qParent.invert().multiply(qWorld));
      if (weight < 1) bone.quaternion.copy(qOld.slerp(bone.quaternion, weight));
      bone.updateMatrix();
      bone.updateMatrixWorld(true);
    }
    function solveHand(character, left, targetLocal, weight, handRot) {
      const bones = character.bones;
      const ua = bones[left ? B.upperArmL : B.upperArmR], fa = bones[left ? B.forearmL : B.forearmR], hd = bones[left ? B.handL : B.handR];
      // Hand orientation on the grip first: fingers wrap it (right) /
      // cradle the handguard from below (left)...
      character.socket.getWorldQuaternion(qWorld);
      if (handRot) qC.setFromEuler(eA.set(handRot[0], handRot[1], handRot[2], "YXZ"));
      else qC.setFromEuler(eA.set(left ? 0.3 : -0.25, 0, left ? -1.3 : 0, "YXZ"));
      qWorld.multiply(qC);
      // ...then aim the wrist so the PALM sits on the grip: back up the hand
      // (its local +Y) and away from the palm side.
      T.set(left ? 0.022 : -0.022, 0.07, 0).applyQuaternion(qWorld);
      W.copy(targetLocal);
      character.socket.localToWorld(W);
      T.add(W);
      ua.getWorldPosition(S); fa.getWorldPosition(E); hd.getWorldPosition(W);
      const a = S.distanceTo(E), b = E.distanceTo(W);
      const toT = d1.subVectors(T, S);
      const dist = Math.min(a + b - 0.001, Math.max(0.02, toT.length()));
      toT.normalize();
      const cosA = Math.max(-1, Math.min(1, (a * a + dist * dist - b * b) / (2 * a * dist)));
      const sinA = Math.sqrt(1 - cosA * cosA);
      // Pole: elbow down, out to its own side and a little back.
      P.set(left ? 0.6 : -0.6, -0.8, -0.25);
      character.root.localToWorld(P.add(character.root.worldToLocal(S.clone())));
      P.sub(S);
      P.addScaledVector(toT, -P.dot(toT)).normalize();
      Enew.copy(S).addScaledVector(toT, a * cosA).addScaledVector(P, a * sinA);
      rotateBoneToward(ua, d2.subVectors(E, S).normalize(), d1.subVectors(Enew, S).normalize(), weight);
      fa.getWorldPosition(E); hd.getWorldPosition(W);
      rotateBoneToward(fa, d2.subVectors(W, E).normalize(), d1.subVectors(T, E).normalize(), weight);
      character.socket.getWorldQuaternion(qWorld);
      qWorld.multiply(qC);
      hd.parent.getWorldQuaternion(qParent);
      qOld.copy(hd.quaternion);
      hd.quaternion.copy(qParent.invert().multiply(qWorld));
      if (weight < 1) hd.quaternion.copy(qOld.slerp(hd.quaternion, weight));
      hd.updateMatrix();
      hd.updateMatrixWorld(true);
    }

    return {
      createCharacter,
      applyAppearance,
      randomAppearance,
      setFace,
      setHelmet,
      setClothing,
      dressAppearance,
      helmetKeys: HELMET_KEYS,
      helmetName: (key) => (HELMETS[key] || HELMETS[DEFAULT_HELMET]).name,
      shirtKeys: SHIRT_KEYS,
      shirtName: (key) => (SHIRTS[key] || SHIRTS.tee).name,
      pantsKeys: PANTS_KEYS,
      pantsName: (key) => (PANTS[key] || PANTS.jeans).name,
      setWeapon,
      registerWeapon,
      update,
      bodyMaterial,
      weaponIds: Object.keys(WEAPON_PARTS),
    };
  }

  window.createHumanSystem = createHumanSystem;
})();
