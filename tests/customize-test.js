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
check("names", hs.shirtName("naked") === "Naked" && hs.shirtName("suitTie") === "Suit Coat" && hs.shirtName("msumJersey") === "MSUM Jersey" &&
  hs.pantsName("naked") === "Naked" && hs.pantsName("shorts") === "Shorts" && hs.pantsName("msumShorts") === "MSUM Shorts");
check("random shirt keys skip Naked", !hs.shirtRandomKeys.includes("naked") && hs.shirtRandomKeys.length === hs.shirtKeys.length - 1);
check("random pants keys skip Naked", !hs.pantsRandomKeys.includes("naked") && hs.pantsRandomKeys.length === hs.pantsKeys.length - 1);
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
check("index.html random picks use the skip-Naked lists", /pickCustomizeKey\(humanSystem\.shirtRandomKeys/.test(html) && /pickCustomizeKey\(humanSystem\.pantsRandomKeys/.test(html));

// Shoes
check("shoe keys", ["sneakersWhite", "sneakersBlack", "running", "boots", "combat", "dress", "sandals", "barefoot"].every((k) => hs.shoeKeys.includes(k)) && hs.shoeKeys.length === 8);
check("shoe names", hs.shoeName("sneakersWhite") === "Sneakers (white)" && hs.shoeName("running") === "Running Shoes" && hs.shoeName("combat") === "Combat Boots" &&
  hs.shoeName("dress") === "Dress Shoes" && hs.shoeName("sandals") === "Sandals" && hs.shoeName("barefoot") === "Barefoot" && hs.shoeName("boots") === "Boots");
check("random shoe keys skip Barefoot", !hs.shoeRandomKeys.includes("barefoot") && hs.shoeRandomKeys.length === hs.shoeKeys.length - 1);
check("index.html has the Shoes category", /CUSTOMIZE_CATEGORIES = \["face", "headgear", "shirt", "pants", "shoes"\]/.test(html) && /shoeKey/.test(html));

const ap = hs.randomAppearance();
check("outfit shoe is a listed key (or the hidden gray sneaker)", ap.shoeStyle === ap.outfitShoeStyle && /^(sneakersWhite|sneakersBlack|sneakersGray|boots)$/.test(ap.shoeStyle), ap.shoeStyle);
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

// Every shoe on every outfit, every LOD: geometry finite; default shoe untouched until changed
{
  let err = null;
  const c2 = hs.createCharacter(hs.randomAppearance(), "f", undefined);
  const outfitShoe = c2.appearance.shoeStyle, outfitHex = c2.appearance.shoe.getHexString();
  try {
    for (const k of hs.shoeKeys) for (const p of hs.pantsKeys) {
      hs.setShoes(c2, k); hs.setClothing(c2, "tee", p);
      if (c2.appearance.shoeStyle !== k) throw new Error("shoe not applied " + k);
      for (const m of c2.meshes) { // (every cached LOD's geometry, not just the visible one)
        const pos = m.geometry.attributes.position.array;
        for (let i = 0; i < pos.length; i++) if (!Number.isFinite(pos[i])) throw new Error("NaN vertex " + k + "/" + p);
      }
    }
  } catch (e) { err = e; }
  check("every shoe x pants applies, geometry finite", !err, err && err.message);
  hs.setShoes(c2, "barefoot");
  check("barefoot shoe color is the skin", c2.appearance.shoe.equals(c2.appearance.skin));
  hs.setShoes(c2, outfitShoe);
  check("going back to the outfit's shoe restores its exact color", c2.appearance.shoe.getHexString() === outfitHex, outfitHex + " vs " + c2.appearance.shoe.getHexString());
  const verts = (k) => { hs.setShoes(c2, k); return c2.meshes[0].geometry.attributes.position.count; };
  check("shoes change the geometry", verts("combat") !== verts("barefoot"));
}

// MSUM singlet + shorts (barefoot, so nothing else is white): red and skin only -- no white collar/hem/stripe vertices
{
  const c3 = hs.createCharacter(hs.randomAppearance(), "f", undefined);
  hs.setClothing(c3, "msumJersey", "msumShorts"); hs.setShoes(c3, "barefoot");
  const col = c3.meshes[0].geometry.attributes.color.array;
  let whites = 0;
  for (let i = 0; i < col.length; i += 3) if (Math.min(col[i], col[i + 1], col[i + 2]) > 0.8) whites++;
  check("MSUM singlet + shorts have no white vertices", whites === 0, whites + " white vertices");
  check("singlet is sleeveless (arms are skin)", c3.appearance.shirtKind === "jersey");
  const html2 = fs.readFileSync(path.join(root, "player-model.js"), "utf8");
  check("singlet pattern (armholes/neckline cut) is wired", /singlet: 9/.test(html2) && /discard/.test(html2));
}

// Naked uses the character's own skin tone
hs.setClothing(ch, "naked", "naked");
const skin = ch.appearance.skin;
check("naked top/bottom colors equal skin", ch.appearance.shirt.equals(skin) && ch.appearance.pants.equals(skin));
const col = ch.meshes[0].geometry.attributes.color.array;
check("body geometry has colors", col.length > 0);
console.log(failed ? `${failed} FAILED` : "ALL PASSED");
process.exit(failed ? 1 : 0);
