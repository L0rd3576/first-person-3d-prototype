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
- Shirt: **Naked** (key `naked`, never a random pick), **Suit Coat & Tie** (`suitTie`), **MSUM Jersey** (`msumJersey`).
- Pants: **Naked** (`naked`, never random), **Shorts** (`shorts`, knee-length chino), **MSUM Shorts** (`msumShorts`, short, white side stripe + hem).
- Suit coat: open jacket (two open tubes with per-vertex placed front edge and lapel facings), white shirt, stand collar,
  tie (knot + blade lying on the shirt), long sleeves with white shirt cuffs. Low-detail LOD falls back to a plain black jacket.
- MSUM text: drawn in the body fragment shader (pattern id 8) as stroked letters in bind-pose space, front of chest only.
- Naked uses `ap.skin` for torso, arms, legs.

## Integration
- `humanSystem.shirtRandomKeys` / `pantsRandomKeys` (no Naked) are used by `resetCustomization`; cycling uses the full lists.
- First-person (fp-hands.js): it only draws bare hands (one shared skin material, no sleeves), so there is no sleeve color to sync.
