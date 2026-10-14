# Customization rework notes

Render harness (not in the repo): a standalone three.js page that loads `vendor/three.min.js` + `player-model.js`,
builds one character per option and renders front / 3-4 / side / back views into a contact sheet, screenshot via
headless Edge (`--use-angle=swiftshader`). Tests: `node tests/customize-test.js` (no browser).

## Before -> after (quality pass)
- **Shirt/pants hems and sleeve ends**: colors/radii used to blend between two far-apart rings, so every hem, sleeve
  end, cuff and boot top was a long gradient. New `withEdges()` inserts a ring pair at each edge -> crisp hems.
- **Tee/shirts at the waist**: the pelvis (pants) poked through the shirt hem and z-fought (white/blue speckles), and
  shirts stopped as a cropped, tight ring. Shirts now drape from y=0.935 with a slight flare over the hips; the pelvis
  sinks inside it. The chest/abdomen seam (a visible horizontal shading line) now matches radii at the joint.
- **Pelvis shading**: the bottom cap's flat normal darkened the whole hip band; caps can now own their ring (`capSplit`).
- **Athletic pants stripe**: was a blurry one-vertex gradient; now a crisp stripe with hard edges (`stripeAngles`).
- **Shorts**: proper hem (folded band, flare), socks at the ankle; no more shorts/boots gradients.
- **Headgear** (was already tidy; no clipping found): Knight Helmet got a horse-hair crest (replaces the thin spike) and a
  brow band; Motorcycle Helmet got a white racing stripe over the top.

## New options
- Shirt: **Naked** (key `naked`, never a random pick), **Suit Coat** (`suitTie`, was "Suit Coat & Tie"), **MSUM Jersey** (`msumJersey`).
- Pants: **Naked** (`naked`, never random), **Shorts** (`shorts`, knee-length chino), **MSUM Shorts** (`msumShorts`, short, all red).
- Suit coat: open jacket (two open tubes with per-vertex placed front edge and lapel facings), white shirt, stand collar,
  tie (knot + blade lying on the shirt), long sleeves with white shirt cuffs. Low-detail LOD falls back to a plain black jacket.
- MSUM text: drawn in the body fragment shader (pattern id 8) as stroked letters in bind-pose space, front of chest only.
- Naked uses `ap.skin` for torso, arms, legs.

## Integration
- `humanSystem.shirtRandomKeys` / `pantsRandomKeys` (no Naked) are used by `resetCustomization`; cycling uses the full lists.
- First-person (fp-hands.js): it only draws bare hands (one shared skin material, no sleeves), so there is no sleeve color to sync.

## Revision 2 (CUSTOMIZE_SPEC2.md)
- **Tie**: `addTube` winds faces assuming `axis x v` points opposite `u`. The tie ran top->bottom (axis down), so its faces pointed inward and the shirt facets showed through as white diamonds. It now runs bottom->top and sits `frontZ + 0.007` (the shirt's front is a flat facet, so a few mm of gap is needed). New `flip` option on `addTube` for tubes wound the other way.
- **The old feet were inside-out** for the same reason (axis +Z, u=X, v=Y), i.e. lit from the wrong side. All foot-axis tubes now use `flip: true`, so sneakers/boots look slightly different (correct lighting) but keep their shape/colors.
- **Singlet** (`jersey` kind): sleeveless (`sleeveLen` 0, arms skin like Naked), a skin chest tube under a red tube with pattern id 9. The body shader discards the armholes and neckline per pixel in bind space (the id is `9 + (height - 1) * 2` so the cuts follow `ap.height`), then draws MSUM. No collar/hem/sleeve trim. MSUM Shorts: no accent stripe, no white hem.
- **Shoes** (`SHOES` table, `addShoe`): `ap.shoeStyle` (key), `ap.shoeKind` (geometry), `ap.shoe` (color); `outfitShoeStyle/outfitShoeKind/outfitShoe` keep the outfit's own. `setShoes(character, key)` goes through the same geometry cache as `setClothing` (`swapBody`, key includes shoes). Hidden key `sneakersGray` exists only for the one outfit with gray sneakers. Tall shoes (boots/combat) put a shaft over the shin; socks under shorts are skipped for Sandals/Barefoot. Details (laces, straps, toes) are skipped on far LODs.
- **Setup screens**: `CUSTOMIZE_CATEGORIES` has `"shoes"`; `shoeKey` null = outfit's shoe, adopted from the character in `applyCustomizationToCharacter`. Quad model height 33vh -> 29.5vh so five rows fit.
- Tests: `node tests/customize-test.js`, `#pvptest` (`tests/pvp-test.js`, new "00" menu-flow checks). Screenshot harness lives outside the repo (C:/Users/lrafy/cz-scratch: `harness.html` for models, `ui-shot.js` for title/setup screens via `index.html#envtest`).
- Not verified by hand: suit tie while walking/crouching (it shares the chest/spine bones with the shirt, but only the bind pose was rendered), real controller navigation of the new screen.
