// Customization smoke test (shirts / pants / headgear), no browser needed:
//   node tests/customize-test.js
// Loads three.js and player-model.js in Node and applies every option.
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
global.window = global;
const THREE = require(path.join(root, "vendor/three.min.js"));
global.THREE = THREE;
require(path.join(root, "player-model.js"));
const hs = window.createHumanSystem(THREE, { getFace: () => ({ texture: new THREE.Texture(), aspect: 1, fillHead: false }) });

let failed = 0;
const check = (name, ok, detail = "") => { if (!ok) failed++; console.log((ok ? "PASS " : "FAIL ") + name + (detail ? " -- " + detail : "")); };

check("new shirt keys exist", ["naked", "suitTie", "msumJersey"].every((k) => hs.shirtKeys.includes(k)));
check("new pants keys exist", ["naked", "shorts", "msumShorts"].every((k) => hs.pantsKeys.includes(k)));
check("names", hs.shirtName("naked") === "Naked" && hs.shirtName("suitTie") === "Suit Coat & Tie" && hs.shirtName("msumJersey") === "MSUM Jersey" &&
  hs.pantsName("naked") === "Naked" && hs.pantsName("shorts") === "Shorts" && hs.pantsName("msumShorts") === "MSUM Shorts");
check("random shirt keys skip Naked", !hs.shirtRandomKeys.includes("naked") && hs.shirtRandomKeys.length === hs.shirtKeys.length - 1);
check("random pants keys skip Naked", !hs.pantsRandomKeys.includes("naked") && hs.pantsRandomKeys.length === hs.pantsKeys.length - 1);
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
check("index.html random picks use the skip-Naked lists", /pickCustomizeKey\(humanSystem\.shirtRandomKeys/.test(html) && /pickCustomizeKey\(humanSystem\.pantsRandomKeys/.test(html));

const ap = hs.randomAppearance();
const ch = hs.createCharacter(ap, "f", undefined);
let threw = null;
try {
  for (const h of hs.helmetKeys) { hs.setHelmet(ch, h); }
  for (const s of hs.shirtKeys) for (const p of hs.pantsKeys) {
    hs.setClothing(ch, s, p);
    const a = ch.appearance;
    if (a.shirtStyle !== s || a.pantsStyle !== p) throw new Error("style not applied " + s + "/" + p);
    for (const m of ch.meshes) {
      const pos = m.geometry.attributes.position.array;
      for (let i = 0; i < pos.length; i++) if (!Number.isFinite(pos[i])) throw new Error("NaN vertex " + s + "/" + p);
    }
  }
} catch (e) { threw = e; }
check("every helmet x shirt x pants combination applies, geometry finite", !threw, threw && threw.message);

// Naked uses the character's own skin tone
hs.setClothing(ch, "naked", "naked");
const skin = ch.appearance.skin;
check("naked top/bottom colors equal skin", ch.appearance.shirt.equals(skin) && ch.appearance.pants.equals(skin));
const col = ch.meshes[0].geometry.attributes.color.array;
check("body geometry has colors", col.length > 0);
console.log(failed ? `${failed} FAILED` : "ALL PASSED");
process.exit(failed ? 1 : 0);
