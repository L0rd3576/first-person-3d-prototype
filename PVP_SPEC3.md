# PVP revision 3 (on top of PVP_SPEC.md / PVP_SPEC2.md; apply ONLY in PVP matches via isPvpMatchActive; PVE stats and behavior must stay identical)
Player-vs-player damage in PVP (body / head). Melee values unchanged (bat 60, katana 40, fists 55, gun-bash 25).
- 1911 (pistol): 25 body / 50 head
- Glock: 34 body / 50 head
- Shotgun: 11.5 per pellet (keep 12 pellets, falloff as is); head multiplier as currently implemented
- SMG: 25 body / 34 head
- AK-47: 37 body / 50 head
- Sniper: 100 torso/neck/groin (shoulders and groin count as torso), 60 legs and arms, 200 head. Needs hit-zone classification on the player model/hitbox (head, neck, torso incl. shoulders+groin, arms, legs). Find how player-vs-player hit detection and headshots currently work (the humanoid player body in player-model.js / hit tests) and add a region classifier by local hit height/lateral offset or by per-part hitboxes. Region split for other guns: only head vs non-head matters. Make this table data-driven (e.g. PVP_DAMAGE_TABLE const) so values are easy to retune.
- Do not touch zombie damage values or PVE WEAPON_DEFS values; apply table only when the victim is a player in a PVP match.

PVP setup screen: add a "Settings" button opening a clean panel (mouse + controller navigable, Back/Done button) with two sliders:
- Player health: default 100 (current value), range 25-300, step 25; sets max health and starting health for all PVP players.
- Player speed: default 100% (= current PVP speed, i.e. the existing 1.15x buff stays the baseline), range 50%-200%, step 5%; multiplies on top of the current PVP speed.
Show current value next to each slider and a Reset-to-default button. Values persist for the match launched from that screen; heal-on-kill clamps to the chosen max health; HUD health bars scale correctly.

Also: update tests/pvp-test.js for the new damage table/hit zones/settings, run syntax check + tests, sync frontend (node scripts/sync-frontend.js), update GAME_DESIGN.md/PVP_NOTES.md, commit locally, do not push, do not launch the game.
