# PVP implementation notes

Deviations from / gaps in PVP_PLAN.md (no big changes were improvised).

- **Plan predates the addenda.** Kills leaderboard (ADDENDUM) and the death-screen flow (ADDENDUM 2) were implemented from PVP_SPEC.md directly:
  - One shared `#pvp-kills` box (top centre, not per viewport); the plan's per-viewport badge keeps only the "Eliminated Px" toast and "Spawn protected" text, not a kill count.
  - Results screen reuses the same row builder, enlarged, winner highlighted.
  - Respawn button is hidden during the 5 s countdown (countdown number shown instead); the weapon list is usable throughout. Pre-match has no wait, so "Deploy" shows at once.
- **`pvpRecordKill(victim, attacker, source)`** takes `source` so the panel can say "Zone" (source `null`) vs "Fall"; the plan's 2-argument version couldn't tell them apart.
- **Panel nav state** uses the existing `stepHeldStickAxis` state object (`pvpNav.stick`) instead of the plan's `stickDir/repeat` fields.
- **z-index:** PVP panels are 15 and HUD bits 12 (plan said 25/20) so the pause overlay (z 20) still covers them; otherwise pausing during a death would hide the pause menu.
- **Zone clock:** `updateZone` returns while every player is dead, so the zone does not start counting until the first player deploys.
- Killer credit does not require the killer to be alive (the plan's simpler option).
- **Not verified:** no manual playtest (CLAUDE.md says never auto-launch). Unchecked by hand: visual layout of panels/leaderboard in 2/3/4-player splits, KB+M panel input with pointer lock, real controller input, melee/katana/bat-sweep/shotgun/sniper hit paths (only pistol hitscan, self-hit, protection and kill flow are in `tests/pvp-test.js`), aim assist.

## Revision 2 (PVP_SPEC2.md) and revision 3 (PVP_SPEC3.md)

- **Resumed after a usage-limit stop.** Revision 2 items 1-10 were audited against the uncommitted diff: all were present. One real bug found by the test: the glow material's fog patch used `vFogDepth`, but the vendored three.js names it `fogDepth`, so the shader failed to compile (PVP bodies would not have rendered). Fixed; `tests/pvp-test.js` now renders a frame and asserts the glow program compiles.
- **Gun Game ties:** timer end ranks by level, then kills, then who reached the level first (`pvpLevelAt`); a full tie shares the win ("P1 & P2 WIN").
- **Kill feed** sits top-right; the minimap defaults to top-left and the Kills box top-centre, so nothing overlaps. The per-viewport "Eliminated" toast badge moved down (130 px) to clear the feed.
- **Damage table (rev 3):** `PVP_DAMAGE_TABLE` / `PVP_HIT_ZONES` near the other PVP constants. Zones come from hit height (fraction of the victim's current eye height) and lateral offset; there are no per-part hitboxes. The neck is a narrow band (1.44-1.50 m standing, within 0.12 m of centre); outside it is shoulder = torso. Arms are lateral >= 0.16 m between groin and shoulder height. The hitbox cylinder is padded (0.45 m radius), so a shot that grazes that padding at arm height counts as an arm hit (60 for the sniper), never as torso. Other guns only look at head vs not-head. The shotgun keeps "no head bonus" for pellets (as before), only the per-pellet base changed to 11.5.
- Head zone starts at 0.88 x eye height (1.50 m standing); the old head band was 0.25 m below the eye (1.45 m), so the neck no longer counts as head for non-sniper guns.
- **Settings:** `pvpSettings` is read live by `getMaxHealth` / `pvpMoveSpeedMultiplier` and persists while the page is open (reset with the panel's button). The setup screens' pad polling and ready countdowns pause while the panel is open; Enter/A/D/W/S keys are swallowed by a capture-phase listener. Square opens the panel on a controller, X closes it (generic back-button handling), the stick drives the sliders through the generic menu nav.
- **Not verified by hand:** the Settings panel and mode picker visuals, the Square/X/stick controller flow, the glow's look at night and in fog, kill feed and board in the 3/4-way layouts (only DOM state and a compile/render pass are in `tests/pvp-test.js`).
