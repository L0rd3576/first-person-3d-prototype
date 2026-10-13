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
