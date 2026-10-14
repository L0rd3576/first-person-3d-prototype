# Player customization rework (player-model.js + index.html setup screens)
Players pick Face / Headgear / Shirt / Pants on the multiplayer setup screens (see CUSTOMIZE_CATEGORIES in index.html, SHIRTS/PANTS/helmet tables in player-model.js, humanSystem.shirtKeys/pantsKeys/helmetKeys, dressAppearance). Works in PVE co-op and PVP; do not break the zombie system or other game logic.

## 1. Quality pass on ALL existing hats (headgear), shirts and pants
Audit each one visually: build a small headless render harness (reuse tests/run-perf.js / Puppeteer-style setup the repo already has, or an offscreen three.js page) that renders every headgear/shirt/pants option on a character (front + 3/4 + side views, also crouch/walking pose if cheap) to PNGs in a scratch folder, then LOOK at the images (read them) and fix: clipping/z-fighting through the body, floating or mis-sized hats, odd proportions, flat/ugly colors, missing details (seams, hems, cuffs, collars, pockets, brims), bad fabric shading. Keep it low-poly and consistent with the current art style; improvements should be clearly visible but tasteful. Record before/after notes in CUSTOMIZE_NOTES.md.

## 2. New skins (appear as normal options in the Shirt and Pants cycle lists, with names)
Top (shirt) options to add:
- "Naked" (shirtless): bare skin on torso and arms using the character's own skin tone, no clothing geometry; nothing weird at the neck/shoulders.
- "Suit Coat & Tie": black suit jacket with lapels, open front showing a white dress shirt and a dark red tie (knot + hanging blade, tucked in front of the jacket), long sleeves with small white shirt cuffs.
- "MSUM Jersey": red short-sleeved athletic jersey with the text MSUM in white on the CHEST ONLY (front of torso; use a canvas texture or decal geometry, crisp and centered, readable at a distance; trim white at collar/sleeve edges is fine).
Bottom (pants) options to add:
- "Naked": bare legs, no clothing at all (no briefs), skin tone matches the character's skin.
- "Shorts": plain shorts skin (there may already be a shorts kind; make a proper named option "Shorts" if not selectable, and make it look good).
- "MSUM Shorts": red short shorts (clearly short, above mid-thigh), white thin side stripe/trim optional.
Pairing: any shirt can combine with any pants (they are chosen separately). The MSUM Jersey and MSUM Shorts are separate list entries (user picks both to get the full kit).
Skin tone: character appearance already has a skin color; Naked must use it so arms/torso/legs match the head/hands.

## 3. Integration
- Names show in the customize list (customizationValue / helmetName etc).
- Random default picks (resetCustomization / randomAppearance / pickCustomizeKey) must still work; avoid making "Naked" appear as a random default for a player (random picks should skip Naked), but it must be selectable by cycling.
- First-person arms/hands (fp-hands.js) if they depend on shirt sleeve color: naked top -> bare skin arms; MSUM jersey -> red sleeve; suit -> black sleeve. Check how first person sleeves get their color and keep consistent.
- Setup screen preview models must show all new options correctly.
- Update tests (tests/pvp-test.js or a new tests/customize-test.js): cycling through every shirt/pants/headgear key applies without errors; new keys exist; random picks skip Naked.
- Run the JS syntax check and tests, sync frontend (node scripts/sync-frontend.js), update GAME_DESIGN.md briefly, commit locally (no push). Do not launch the game.
