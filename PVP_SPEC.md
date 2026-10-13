# PVP mode spec (user requirements)

Add a PVP free-for-all deathmatch under Multiplayer. Fast-paced. DO NOT change any PVE/co-op behavior: gate everything behind a new `isPvpMatchActive` flag (reset wherever isCoopMatchActive is reset).

## Entry
- Multiplayer -> player-count screen gets a PVP option (2, 3 or 4 players, split-screen using the existing 2P / 3-4P layouts and setup screens: reuse resetCoopSetup/resetQuadSetup flows with a pvp flag, start via startCoopMatch/startQuadMatch variants).

## Rules
- Full-size map, no zombies/enemy spawns/waves, no item/ammo pickups, no turrets, no crafting. Vehicles stay.
- Free for all. Match lasts 30 minutes; winner = most kills at timer end; show end-of-match kill/death leaderboard, then return to title. HUD: match timer + per-player kill count.
- Inventory and skill tree disabled (inputs ignored, UI not openable).
- Player move speed x1.15. Slides always enabled automatically (the PVE gating of slide is bypassed in PVP). Endurance (stamina) doubled: MAX_STAMINA x2 (and regen proportionally fine) in PVP only.
- Dynamic zone (ZONE_CONFIG / existing zone system): reuse it with a much shorter hold time (and faster shrink schedule), players outside take damage as existing.
- Remove the light-blue teammate marker above players (player.teammateMarker) in PVP.
- Players damage each other with all weapons (guns, bat, katana, fists/melee). Check every hit path (hitscan, shotgun pellets, melee, aim-assist, explosions if any) so it can hit other players, never self, with correct floor-aware LOS. Kill credit goes to the attacker. No friendly-fire exemptions.
- No downed/revive state in PVP: 0 HP = dead immediately. No co-op spectate/fullscreen handoff in PVP: every dead player's own viewport stays and shows the respawn UI.
- Procedural player spawnpoints: on (re)spawn choose a point that is not in sight of any other living player (line-of-sight check against all other players, min distance, prefer far from all players, not inside the zone-outside area, valid floor). Model it on procedural-spawn.js / spawnEnemyFromRandomSpawner. Fallback: the point with the best score if none fully hidden.
- Death: 5 second countdown before the Respawn button becomes enabled. The death UI (per player viewport) includes a weapon selector listing every weapon in WEAPON_DEFS (pistol, glock, shotgun, smg, ak47, sniper, bat, katana, melee included), controller + keyboard/mouse navigable like existing menus. Chosen weapon is picked at first spawn as well (a pre-match selector, same UI, with no wait timer).
- Loadout: spawn with ONLY the chosen weapon, full magazine, infinite reserve ammo: reserve box shows the infinity symbol; reload still required when the magazine empties. Melee weapons need no ammo. Full health on respawn, brief spawn protection (2s) is fine.
- Controls/input: use existing per-player input system (keyboard/mouse + controllers), same as co-op.

## Quality
- Verify by launching the game headless/with a quick smoke test if possible (see tests/ and CLAUDE.md), run a JS syntax check on the script in index.html, and make sure frontend/ copy is kept in sync if the repo mirrors index.html there (check how frontend/ relates to root).
- Smallest changes that work; keep PVE paths byte-for-byte equivalent in behavior.
- Update GAME_DESIGN.md briefly with a PVP section. Commit locally with a clear message (do not push).

## ADDENDUM: Kills leaderboard (added after the plan phase started; plan/implementation MUST include it)
- A small, clean, unobtrusive leaderboard box shown during PVP matches (and reused as the end-of-match results). Header text: "Kills". One row per player: small circular/rounded face image (the face that player picked on the setup screen, same image used for their identity elsewhere) then ": X" where X is their kill count. Rows sorted by kills descending; leader may get a subtle highlight; use each player's ZONE_PLAYER_COLORS color as a thin accent only.
- Semi-transparent dark panel, small font, no animation beyond a brief number tick on change. Place it where it does not cover crosshair/HUD (e.g. top center or top edge shared across the screen, NOT duplicated per viewport) and size/layout it to fit 2, 3 or 4 players (compact rows for 2; 3-4 stay equally tidy; check it against the 2-way, 3-way and 4-quadrant split layouts, including the center seam).
- Final results screen shows the same box enlarged with the winner highlighted.

## ADDENDUM 2: Death screen flow (overrides earlier wording)
- During the 5 second death countdown the weapon selector is already visible and fully usable (pick/change weapon freely). The Respawn button is HIDDEN during the countdown (show the countdown number instead) and only appears once the 5 seconds finish. Selection persists; the chosen weapon is used on respawn.
