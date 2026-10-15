# Revision: player-count / PVE-PVP flow + clothing tweaks + shoes
Read CLAUDE.md, CUSTOMIZE_SPEC.md, CUSTOMIZE_NOTES.md, PVP_NOTES.md first. Do not change PVE gameplay.

## 1. Multiplayer menu flow
- The "select players" screen (#title-player-count) currently lists 2/3/4 PVE options plus a "PVP Deathmatch" divider with PVP: 2/3/4. Change it to ONE set: 2 Players, 3 Players, 4 Players (remove the PVP rows and divider).
- Clicking a count goes to a NEW intermediate title panel (e.g. #title-game-type) with two big options/buttons: "PVE" and "PVP" (same visual style as other mode-option panels; heading like "Choose Game Type"; a Back button returning to the player-count screen).
- PVE -> the existing PVE flow for that count (resetCoopSetup/coop-setup for 2, resetQuadSetup(n)/quad-setup for 3-4), exactly as before. PVP -> the existing PVP flow for that count (pvpSetupSelected etc., as the removed PVP rows did).
- Back buttons must still work through every chain: setup screens' Back should return to wherever they did before in a sensible way (PVE/PVP setup back -> the new game-type screen; game-type back -> player count; player count back -> mode screen). Check the existing places that call showTitlePanel("player-count") (end of match / return flows around lines ~20406 and ~22737) and make them still land somewhere sensible.
- Controller + keyboard/mouse navigation must work on the new screen (see how title panels register for gamepad navigation, e.g. key: "title-player-count" near the bottom of index.html, and replicate for the new panel). Remember the pvp tests drive screens via hooks (startPvpForTest etc.); update tests if affected.

## 2. Suit Coat
- Rename the shirt option "Suit Coat & Tie" to "Suit Coat" (name only; keep the key stable or update all references).
- Fix the tie: it currently clips through the dress shirt and looks wrong. The tie must be the TOP layer in front of the shirt (and sit in front of / over the jacket opening, not inside the shirt or jacket geometry): knot at the collar, blade hanging flat on the shirt front, slightly proud of the shirt surface (use polygonOffset/offset in normal direction, enough radius gap, and make sure nothing z-fights). Verify with rendered screenshots from front, 3/4 and side views, and also walking/crouch if cheap. The jacket lapels must frame the tie, not cover/cut through it.

## 3. MSUM jersey -> singlet
- Make the MSUM Jersey a cross-country running singlet (tank top): sleeveless with wide armholes and a scooped/round neckline, shoulder straps (a little narrower than a tee's), slightly fitted, bare arms and shoulders showing the character's skin. Entirely red including the neckline, armholes and hem: REMOVE the white collar/sleeve/hem trim. The only non-red element is the white "MSUM" text on the chest (keep it crisp, centered, readable).
- MSUM Shorts: all red too: REMOVE the white side stripe and white hem. Short red short shorts, otherwise unchanged.
- Rename not needed (keep "MSUM Jersey" / "MSUM Shorts").
- First-person/other code depending on sleeves: a sleeveless shirt needs no sleeve geometry; make sure the arms use skin color like Naked.

## 4. Shoes customization
- Add a fifth customization category "Shoes" to the setup lists (CUSTOMIZE_CATEGORIES in index.html, labels, customizationValue/cycleCustomization/render, applyCustomizationToCharacter, reset/random defaults) for ALL setup screens (2-player, 3/4-player, PVE and PVP), controller and mouse navigable like the others. Make sure the customize lists still fit on the quad setup columns (adjust spacing/sizes, not behavior).
- Player-model.js: add a shoes table (like SHIRTS/PANTS) + humanSystem.shoeKeys/shoeName and dressAppearance/applyShoes (or equivalent) so shoes are independent of the random outfit. Options (name them): Sneakers (white), Sneakers (black), Running Shoes (red, with white sole; visibly slimmer low-profile), Boots (brown), Combat Boots (black, chunky, higher), Dress Shoes (black glossy with thin sole), Sandals (straps over bare feet, skin showing), Barefoot (skin-colored feet, no shoe). Each must look good from the front/side, with proper sole thickness, toe shape and laces/straps where relevant, no clipping into pants/legs. Default for each player: keep their outfit's existing shoe (random outfits already have shoes) so existing looks do not change; random pick helper skips Barefoot.
- Update tests (tests/customize-test.js and pvp-test.js as needed); render screenshots of every shoe option to verify visually.

## Finish
Run node --check on edited JS, tests/customize-test.js, the #pvptest run (HASH='#pvptest' GL_MODE=swiftshader node tests/run-perf.js) and campus spawn test baseline comparison if cheap, sync frontend (node scripts/sync-frontend.js), update GAME_DESIGN.md and CUSTOMIZE_NOTES.md, commit locally (no push), do NOT launch the game. Do not commit the untracked "5 nights at kise/making the second map" folder.
