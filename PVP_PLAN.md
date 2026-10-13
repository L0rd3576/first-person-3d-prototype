# PVP Deathmatch: implementation plan

Source spec: `PVP_SPEC.md`. Target file: `index.html` (one inline IIFE starting at line 3222). After editing, sync `frontend/index.html` with `node scripts/sync-frontend.js`. That copy is tracked by git and is currently byte-identical to the root file.

Line numbers below are from commit `c3bf7fb`. They drift as soon as you start editing, so **find each spot by function name with grep, and edit from the bottom of the file upward** where you can.

Implementer: Sonnet at medium effort, working strictly from this plan. If something here turns out to be wrong (a function's behavior differs from what is described), stop and escalate rather than improvising.

---

## 0. Core design decisions

1. **PVP is a co-op match plus a flag.** `startCoopMatch` (2 players) and `startQuadMatch` (3 or 4 players) run unchanged, so split-screen, per-player input, the HUD and the pause logic are all reused.
   - A new `isPvpMatchActive` is true only when the match was started from a PVP option. In PVP, `isCoopMatchActive` is **also** true.
   - Every PVP difference is an `if (isPvpMatchActive)` branch, or a multiplier that equals exactly `1` in PVE. With the flag false, PVE paths must execute the same statements as today.
2. **There is no PVP downed state.** `canPlayerBeDowned` returns false, and `triggerDeath` gets an early PVP branch. That branch skips the weapon drops, the co-op spectate/fullscreen/give-screen flow and the global death screen.
3. **Respawning reuses `resetPlayerState`**, followed by a PVP loadout and a procedural spawn position.
4. **Player-vs-player hits use one shared helper**, `findPvpPlayerHits(shooter, ray, maxDistance)`. It is an analytic vertical-cylinder test, the same idea as `findNearestEnemyBodyHit`, and it is filtered by `worldBlocksShot` (floor, wall and vehicle aware) and by barricade planks.
   - All gun and ray-melee paths call it.
   - The area melee paths (bat sweep, katana) use `hasLineOfSight(..., y1, y2)`, which is floor-aware.
5. **No PVE system needs a deep gate.** Nothing spawns enemies, pickups, drops or turrets once these are cut:
   - the wave manager,
   - the inventory open (which also covers crafting, skills and turrets),
   - the drop and interact actions,
   - the death drops.

   The remaining world updates (`updateEnemies`, `updateAmmoPickups`, `updateDroppedItems`, campus spawner/recycler) simply run on empty lists.

---

## 1. New state and constants (declare early to avoid TDZ)

Declare these right after the stamina constants block, around line 3283 (after `SLIDE_MIN_STAMINA`). They must be declared **before** any function that reads them can run. `isCoopMatchActive` sits at 18109, but several readers below (`getMaxStamina` and others) may run during init, so do not put the new state there.

```js
// ---- PVP DEATHMATCH (see PVP_PLAN.md) ----
// True only during a PVP match (isCoopMatchActive is also true then).
// Reset in resetGame and the setSplitScreen test hook, next to isCoopMatchActive.
let isPvpMatchActive = false;
let pvpSetupSelected = false;           // set by the player-count screen's PVP options, read by startCoopMatch/startQuadMatch
const PVP_MATCH_SECONDS = 30 * 60;
const PVP_RESPAWN_DELAY_SECONDS = 5;
const PVP_SPAWN_PROTECTION_SECONDS = 2;
const PVP_MOVE_SPEED_MULTIPLIER = 1.15;
const PVP_STAMINA_MULTIPLIER = 2;       // max stamina
const PVP_STAMINA_REGEN_MULTIPLIER = 2; // same refill time as PVE ("regen proportionally")
const PVP_INFINITE_RESERVE = 9999;      // shown as the infinity symbol
const PVP_PLAYER_HIT_RADIUS = 0.35 + 0.1; // PLAYER_RADIUS (10287) + margin, like PELLET_BODY_HIT_MARGIN
const PVP_HEAD_BAND = 0.25;             // metres below eye height that count as head
const PVP_RESULTS_AUTO_RETURN_SECONDS = 20;
const PVP_ZONE_TIMING = { INITIAL_ZONE_DELAY: 60, ZONE_STAY_DURATION: 45, ZONE_WARNING_DURATION: 20, ZONE_TRANSITION_DURATION: 30 };
const PVP_SPAWN = { CANDIDATES: 90, MIN_DISTANCE: 25, ZONE_EDGE_MARGIN: 8, CLEARANCE: 0.8, DISTANCE_CAP: 150, VISIBLE_PENALTY: 60 };
const pvpMatch = { timeLeft: 0, started: false, ended: false, resultsTimer: 0 };
function pvpMoveSpeedMultiplier() { return isPvpMatchActive ? PVP_MOVE_SPEED_MULTIPLIER : 1; }
```

`PLAYER_RADIUS` is declared at 10287, after this block. Use the literal (as above), or move the constant into a function if you prefer.

New per-player fields:
- `pvpKills`, `pvpDeaths`
- `pvpWeaponId` (default `"pistol"`)
- `pvpAwaitingSpawn`: true while the death or pre-match panel is up
- `pvpIsPrematch`
- `pvpRespawnTimer`
- `pvpProtectedFor`
- `pvpLastKilledBy`: a player or null
- `pvpNav`: `{ stickDir: 0, repeat: 0, prevButtons: [] }`

Initialise these in `startPvpMatchExtras` (section 4). They don't need to go in `createPlayer`. PVE code never reads them unless it has checked `isPvpMatchActive` first.

---

## 2. Every PVE-only behavior gated by `isPvpMatchActive`

| # | Where (function, line) | Change |
|---|---|---|
| G1 | `resetGame` (18631) | After `isCoopMatchActive = false;` add `isPvpMatchActive = false; pvpMatch.started = pvpMatch.ended = false; hidePvpUi();` and remove `"pvp-mode"` in the `classList.remove` at 18640. |
| G2 | `__gameTestHooks.setSplitScreen` (27689) | Add `isPvpMatchActive = false;` next to `isCoopMatchActive = n > 1;`. |
| G3 | `updateWaveManager` (26199) | First line: `if (isPvpMatchActive) return;`. This means no zombies, waves, wave score or skill points. |
| G4 | `toggleInventory` (17552) | Next to the `INVENTORY_SYSTEM_ENABLED` early return, add `if (isPvpMatchActive) return;`. This makes the inventory, crafting tab, skill tree and turret crafting unreachable. |
| G5 | `processEdgeTriggeredActions` (26696-26697) | `if (!isPvpMatchActive && ...wasActionJustPressed("dropItem")) dropActiveSlotItem(player);` and the same for `interact`. This stops players dropping their only weapon and blocks turret, barricade and item interaction. |
| G6 | `interactPromptFor` (12360) | First line: `if (isPvpMatchActive) return "";`. |
| G7 | `tryStartSlide` (24188) | `if (!isPvpMatchActive && !player.unlockedSkillIds.has("sliding")) return;` |
| G8 | `tryStartSlide` (24196) | `if (forwardSpeed < SLIDE_TRIGGER_SPEED * pvpMoveSpeedMultiplier()) return;`. Without this, PVP walking at 1.15x speed would meet the threshold. |
| G9 | `tryStartSlide` (24210) | Multiply `slidePeakSpeed` by `pvpMoveSpeedMultiplier()`. |
| G10 | `updateMovement` (24719) | `WALK_SPEED` becomes `WALK_SPEED * pvpMoveSpeedMultiplier()` in the slide decay target. |
| G11 | `updateMovement` (after 24698) | `maxSpeed *= pvpMoveSpeedMultiplier();`. This covers walk, sprint, tactical sprint and crouch, but not the downed crawl, which can't happen in PVP. |
| G12 | `getMaxStamina` (16835) | `return isPvpMatchActive ? max * PVP_STAMINA_MULTIPLIER : max;` |
| G13 | `getStaminaRegenMultiplier` (16845) | Multiply the result by `PVP_STAMINA_REGEN_MULTIPLIER` when PVP. |
| G14 | `resetPlayerState` (18498) | `player.stamina = getMaxStamina(player);`. This is identical in PVE because `resetPlayerSkills` has just run, so `getMaxStamina` returns `MAX_STAMINA`. |
| G15 | `canPlayerBeDowned` (17733) | `return isCoopMatchActive && !isPvpMatchActive && players.some(...)`. |
| G16 | `takeDamage` (17690) | See section 3.1 (attacker, spawn protection, kill credit). |
| G17 | `triggerDeath` (18005) | First line: `if (isPvpMatchActive) { pvpHandleDeath(player); return; }`. This skips the deathSnapshot, weapon drops, spectating, fullscreen, give-screen and the global death screen. |
| G18 | `confirmCoopSpectatorPrompt` (19216) | First line: `if (isPvpMatchActive) return;`. This one gate covers the dead-player Triangle press (26947-26954), the KB Enter listener (20096-20099) and the button clicks (19206). Together with G17, no co-op spectate or handoff can happen in PVP. |
| G19 | `updatePlayerBodyMeshes` (21317-21318) | `human.root.visible = isCoopMatchActive && !(isPvpMatchActive && player.pvpIsPrematch);` and `player.teammateMarker.visible = isCoopMatchActive && !isPvpMatchActive && !player.isDead;`. |
| G20 | `updateAmmoUI` (14379) | `refs.ammoReserveEl.textContent = isPvpMatchActive ? "∞" : slot.reserveAmmo;` |
| G21 | `advanceReload` (23026, after `if (!slot) return;`) | `if (isPvpMatchActive) slot.reserveAmmo = PVP_INFINITE_RESERVE;`. The reserve never runs dry, but a reload is still needed whenever the magazine empties. |
| G22 | `wearWeaponDurability` (23213) | First line: `if (isPvpMatchActive) return false;`. The bat never breaks, since breaking would empty the player's only slot. |
| G23 | `zoneStayDuration` (13275), `initZone` (13290), `updateZone` (13357, 13360) | Replace the four `ZONE_CONFIG.<timing>` reads with `zoneTiming("<KEY>")`, where `function zoneTiming(k) { return isPvpMatchActive ? PVP_ZONE_TIMING[k] : ZONE_CONFIG[k]; }`. Put the helper next to `zoneStayDuration`. Zone damage stays exactly as it is. |
| G24 | `initZone` (13281-13286) | `if (isPvpMatchActive) { const m = zoneMapRect(); cx = (m.minX + m.maxX) / 2; cz = (m.minZ + m.maxZ) / 2; }` goes before `zoneClampCenter`. At PVP start every player is in the pre-match panel, so the living-player centroid would be (0,0). |
| G25 | `updateCoopMatchFrame` (26828) | `const isFrozen = isMatchPaused \|\| p1NeedsClick \|\| reviveSelection !== null \|\| (isPvpMatchActive && pvpMatch.ended);` |
| G26 | `updateCoopMatchFrame` world block (26965) | Condition becomes `!isMatchPaused && !reviveSelection && !(isPvpMatchActive && pvpMatch.ended)`. Inside it, add `if (isPvpMatchActive) updatePvpMatch(deltaSeconds);`. |
| G27 | `updateCoopMatchFrame` per-player loop (after `processEdgeTriggeredActions(player)` at 26916; `poll()` has already run at 26876) | `if (isPvpMatchActive && player.pvpAwaitingSpawn) updatePvpPanelInput(player, deltaSeconds);`. Dead players reach this line because `processEdgeTriggeredActions` returns early for them; it isn't `continue`'d. |
| G28 | `updateCoopMatchFrame` top (26785) | `if (!(isPvpMatchActive && pvpMatch.ended)) pollCoopMatchPauseGamepads();`. Start must not pause over the results screen. |
| G29 | `onPointerLockChange` (18762) | `if (!players[0].isDead \|\| isPvpMatchActive)`. Otherwise a dead PVP P1 who presses Esc loses the lock, which freezes everyone (`p1NeedsClick`) with no pause menu shown. |
| G30 | `pointerlockerror` handler (20506) and `retryCoopPointerLockOnce` (20519) | `(!players[0].isDead \|\| isPvpMatchActive)`. P1 starts in the pre-match panel, which counts as dead, so without this a refused lock would never be retried. |
| G31 | `findAimAssistTarget` (20990) and its consumer (21111-21112) | See section 3.6. |
| G32 | Hit paths: `fireWeapon`, `fireShotgunPellets`, `resolveMeleeHit`, `performBatSweep`, `updateKatanaSweepHits`, `startKatanaSlash` | See section 3. |
| G33 | CSS | `body.pvp-mode #wave-hud, body.pvp-mode #score-hud, body.pvp-mode #boss-health-hud { display: none; }` |

**Deliberately not gated** (verified to be inert in PVP):
- `updateEnemies` and `updateTurrets`: the lists are empty because nothing spawns.
- `updateAmmoPickups`: these only come from `damageEnemy`.
- `updateDroppedItems`: drops are blocked by G5 and G17.
- `updateCampusFrame`: the spawner gets no requests, and visibility is still needed for rendering.
- `updateDownedPlayers`: nobody is downed.
- `updateReviving`: there are no downed targets.
- The revive skill, `useHealingItem` and medkits: these are only reachable through the inventory (G4).
- `addScore` and the score HUD: hidden by G33.
- Vehicles: these are static colliders. `worldBlocksShot` already stops bullets at them.

---

## 3. Player-vs-player damage

### 3.1 `takeDamage(player, amount, source, attacker = null)` (17690)

The 4th parameter is optional. All existing callers keep passing 3 arguments, so PVE is unchanged.

Insert these lines right after `if (player.grabbedBy) return;`:

```js
if (isPvpMatchActive) {
  if (attacker === player) return;                                   // never self
  if (player.pvpAwaitingSpawn || player.pvpProtectedFor > 0) return; // spawn protection (zone included)
  if (attacker) player.pvpLastKilledBy = attacker;                   // remembered for the death credit below
}
```

At the `health <= 0` branch, G15 already makes `canPlayerBeDowned` false, so execution goes to `triggerDeath`. Before calling `triggerDeath`, add: `if (isPvpMatchActive) pvpRecordKill(player, attacker);`.

- `pvpRecordKill(victim, attacker)`:
  - `victim.pvpDeaths++`.
  - If `attacker && attacker !== victim && !attacker.isDead`, then `attacker.pvpKills++` and `pvpToast(attacker, "Eliminated P" + n)`.
  - `victim.pvpLastKilledBy = attacker || null`. A zone or fall death counts as a death with no kill credit.
  - Calls `updatePvpHud()`.
- Deaths from the zone (`source = null`) and from falls (`undefined`) have no attacker, so they count as suicides.

### 3.2 Shared hit helper: put it next to `findNearestEnemyBodyHit` (22791)

```js
// PVP: every other living, spawned player whose body cylinder `ray` enters
// within maxDistance, nearest first, after floor-aware world blocking
// (worldBlocksShot: walls, floor slabs, vehicles) and barricade planks.
function findPvpPlayerHits(shooter, ray, maxDistance) {
  const out = [];
  const { origin, direction } = ray;
  const a = direction.x * direction.x + direction.z * direction.z;
  if (a < 1e-8) return out;
  for (const target of players) {
    if (target === shooter || target.isDead || target.pvpAwaitingSpawn) continue;
    const pos = target.camera.position;
    const ox = origin.x - pos.x, oz = origin.z - pos.z;
    const b = 2 * (ox * direction.x + oz * direction.z);
    const c = ox * ox + oz * oz - PVP_PLAYER_HIT_RADIUS * PVP_PLAYER_HIT_RADIUS;
    const disc = b * b - 4 * a * c;
    if (disc < 0) continue;
    const t = c <= 0 ? 0 : (-b - Math.sqrt(disc)) / (2 * a);
    if (t < 0 || t > maxDistance) continue;
    const y = origin.y + direction.y * t;
    const feetY = pos.y - target.currentEyeHeight;   // camera.y = eye + jumpOffset + groundY
    if (y < feetY || y > pos.y + 0.15) continue;      // crouch/slide shrink it automatically
    const point = new THREE.Vector3(origin.x + direction.x * t, y, origin.z + direction.z * t);
    if (isCampusMap && worldBlocksShot(origin, point, targetStandingY(shooter), targetStandingY(target))) continue;
    out.push({ target, distance: t, point, isHeadshot: y >= pos.y - PVP_HEAD_BAND });
  }
  if (barricadePlankMeshes.length && out.length) {
    raycaster.ray.copy(ray); // only needed if the caller passed a ray that isn't raycaster.ray
    const wood = raycaster.intersectObjects(barricadePlankMeshes, false);
    if (wood.length) return out.filter((h) => h.distance < wood[0].distance).sort((p, q) => p.distance - q.distance);
  }
  return out.sort((p, q) => p.distance - q.distance);
}

// Applies one PVP hit: directional damage feedback on the victim, kill credit
// via takeDamage's attacker, and the attacker's own hit marker.
function damagePvpPlayer(attacker, target, amount, isHeadshot) {
  takeDamage(target, amount, { x: attacker.camera.position.x, z: attacker.camera.position.z }, attacker);
  showHitMarker(attacker, isHeadshot);
}
```

- **Before you write this, confirm the `source` format.** Read `triggerDamageFx` (14032) and check that it uses `source.x` and `source.z` as the attacker's position. If it expects something else, adapt the `source` argument to match.
- **Floor awareness:** `targetStandingY(p)` (25493) returns `p.campusGroundY || 0`. That is the same argument the enemy paths pass to `worldBlocksShot`.
- **Spawn protection ends early.** At the start of `fireWeapon` (22645) and `performMelee` (23231), add `if (isPvpMatchActive) player.pvpProtectedFor = 0;`. Firing gives up the protection.

### 3.3 Hitscan guns: `fireWeapon` (22734)

Insert this after the spread is applied (22733) and before `let hits = raycastEnemies(raycaster);`:

```js
if (isPvpMatchActive) { firePvpHitscan(player, def, slot); return; }
```

`firePvpHitscan(player, def, slot)`:
- `const fxPower = (FX_WEAPON[slot.weaponId] || { power: 1 }).power;`
- `const hits = findPvpPlayerHits(player, raycaster.ray, Infinity);`
- If there are no hits: `spawnWorldImpact(raycaster.ray.origin, raycaster.ray.direction, fxPower); return;`
- Otherwise call `spawnFleshImpact(hits[0].point, raycaster.ray.direction, fxPower)`.
- **Sniper** (`def.gun.penetrationDamageFractions`):
  - For each `hits[i]` with `i < fractions.length`, damage = `def.gun.damage * fractions[i] * (hits[i].isHeadshot ? def.gun.headshotMultiplier : 1)`, applied with `damagePvpPlayer`.
  - Play the sniper hit audio the same way `fireSniperPenetratingShot` (8172) does. Read it first, and skip its enemy knockback and `playSniperHitFeedback`, since both expect an enemy.
- **Other guns:** damage = `hits[0].isHeadshot && def.gun.headshotDamage !== undefined ? def.gun.headshotDamage : def.gun.damage`, then `damagePvpPlayer(player, hits[0].target, damage, hits[0].isHeadshot)`.

### 3.4 Shotgun: `fireShotgunPellets` (22815)

Inside the pellet loop, right after `applyHipFireSpread(...)` (22822):

```js
if (isPvpMatchActive) {
  const h = findPvpPlayerHits(player, raycaster.ray, Infinity)[0];
  if (!h) { spawnWorldImpact(raycaster.ray.origin, raycaster.ray.direction, 0.6); continue; }
  if (i < 3) spawnFleshImpact(h.point, raycaster.ray.direction, 0.6);
  const e = pvpDamageByPlayer.get(h.target);
  const d = getShotgunPelletDamage(pellets, h.distance);
  if (e) e.damage += d; else pvpDamageByPlayer.set(h.target, { damage: d });
  continue;
}
```

- Declare `const pvpDamageByPlayer = new Map();` next to `damageByEnemy` (22817).
- After the loop, before the `damageByEnemy` apply loop, add: `for (const [t, e] of pvpDamageByPlayer) damagePvpPlayer(player, t, e.damage, false);`.
- Extend the hit marker line to `damageByEnemy.size > 0 || pvpDamageByPlayer.size > 0`. `damagePvpPlayer` already shows the marker, so you can simply leave that line as it is.
- Pellets are summed per player before they are applied, for the same reason as enemies: one kill credit, not twelve.

### 3.5 Melee

- **`resolveMeleeHit(player, damage, range, isBat)` (23282).** This is used by fists, the gun-bash and the bat's normal swing.
  - Read its whole body first (23282-23350). Note what it does after a hit (sounds, return value) and what its callers use.
  - Then insert after line 23284 (`raycaster.far = range;`):

    ```js
    if (isPvpMatchActive) {
      const h = findPvpPlayerHits(player, raycaster.ray, range)[0];
      raycaster.far = Infinity;
      if (h) { damagePvpPlayer(player, h.target, damage, false); /* + the same hit sound the enemy branch plays */ }
      return /* same value the enemy branch returns for hit / miss */;
    }
    ```

  - Today this path has **no** LOS check against enemies. In PVP, `worldBlocksShot` inside the helper supplies it, which satisfies the spec. There is no player knockback.
- **`performBatSweep(player)` (23350).** Add a PVP branch that loops over `players` instead of `enemies`:
  - Skip self, dead players and players awaiting spawn.
  - Keep the same horizontal range (`BAT_MELEE_RANGE`) and the frontal dot-product test.
  - Add `Math.abs(targetStandingY(t) - targetStandingY(player)) < 1.5`.
  - Add `hasLineOfSight(px, pz, tx, tz, 0, targetStandingY(player), targetStandingY(t))`.
  - Hit at most `BAT_SWEEP_MAX_TARGETS`, nearest first, with `BAT_SWEEP_DAMAGE` each, via `damagePvpPlayer`.
  - Keep the swing animation and sound code shared. Only the target loop should branch.
- **Katana: `updateKatanaSweepHits(player, progress)` (23965).**
  - After the enemy loop (which has nothing to iterate in PVP), add a `players` loop with the same math. Use `t.camera.position` for x and z, `PVP_PLAYER_HIT_RADIUS` as the radius, and the same bearing and `halfWidth` test.
  - LOS: `hasLineOfSight(camX, camZ, tx, tz, 0, targetStandingY(player), targetStandingY(t))` plus the same 1.5 m vertical check.
  - Use the existing `sweep.hitEnemies` Set to store player objects too. That way `KATANA_MAX_TARGETS` (1) is respected and each victim is hit once per slash.
  - Damage is `sweep.damage` via `damagePvpPlayer`.
  - Do not call `playKatanaHitFeedback(player, enemyState)`, since it expects an enemy. Check its body and either call only its attacker-side parts or skip it.
- **Fists:** an empty slot goes through `fireWeapon`, then `performMelee`, then `resolveMeleeHit`, which is already covered.
- **Explosions:** none are player-caused. The only area damage in the game comes from zombies (green explosion, boss slam). Nothing to do.

### 3.6 Aim assist (controller players): `findAimAssistTarget` (20990)

Add as the first line:

```js
if (isPvpMatchActive) return findPvpAimAssistTarget(player);
```

`findPvpAimAssistTarget(player)` has the same shape as the enemy loop:
- Skip self, dead players and players awaiting spawn.
- The aim point is `(t.camera.position.x, t.camera.position.y - 0.1, t.camera.position.z)`, which is face height.
- Same `AIM_ASSIST_SLOWDOWN_RANGE` and `AIM_ASSIST_SLOWDOWN_CONE_ANGLE`.
- LOS: `hasLineOfSight(origin.x, origin.z, tx, tz, 0.15, targetStandingY(player), targetStandingY(t))`.
- Returns `{ enemyState: null, angle, pos: t.camera.position, faceY }`.

Then change the consumer at 21111-21112 to:

```js
const targetPos = target.pos || target.enemyState.mesh.position;
const targetFaceY = target.faceY !== undefined ? target.faceY : getAimAssistTargetY(target.enemyState);
```

Check the rest of `pollLookDelta` (21085-21125) for any other `target.enemyState` reads, and handle them the same way.

---

## 4. Match lifecycle

### 4.1 Entry (title screen)

HTML (2732-2742): inside `#player-count-options`, after the three existing options, add a non-focusable label and three options.

```html
<div class="player-count-divider">PVP Deathmatch</div>
<div class="mode-option" data-pvp-players="2"><div class="mode-name">PVP: 2 Players</div></div>
<div class="mode-option" data-pvp-players="3"><div class="mode-name">PVP: 3 Players</div></div>
<div class="mode-option" data-pvp-players="4"><div class="mode-name">PVP: 4 Players</div></div>
```

- Controller and keyboard navigation work automatically. The `title-player-count` entry in `MENU_NAV_SCREENS` (27038) collects `#player-count-options .mode-option`, and the divider is not a `.mode-option`, so it isn't focusable. The click sound comes from the delegated listener at 7255.
- The JS goes at 19361-19374. Add `pvpSetupSelected = false;` at the top of the three existing handlers.
- Add three new handlers:
  - `data-pvp-players="2"`: `pvpSetupSelected = true; resetCoopSetup(); showTitlePanel("coop-setup");`
  - `"3"` and `"4"`: `pvpSetupSelected = true; resetQuadSetup(n); showTitlePanel("quad-setup");`
- Optional: set the setup headings to show PVP. Use `#quad-setup-heading` (written by `resetQuadSetup`, 21612) and the coop setup heading, and restore them when `pvpSetupSelected` is false.
- The setup screens' difficulty stepper has no effect in PVP. Leave it.

### 4.2 Start

In both `startCoopMatch` (20393) and `startQuadMatch` (21695):
- Right after the `if (isCoopMatchActive) return;` guard, add `isPvpMatchActive = pvpSetupSelected;`.
- As the last statement, add `if (isPvpMatchActive) startPvpMatchExtras();`.

`startPvpMatchExtras()` goes in the new section after `startQuadMatch`, titled `// PVP DEATHMATCH`:
1. `buildPvpUi()`, which is lazy and builds once; then `document.body.classList.add("pvp-mode")`.
2. `pvpMatch.timeLeft = PVP_MATCH_SECONDS; pvpMatch.started = false; pvpMatch.ended = false;`
3. `initZone();`. This runs after `resetSharedWorldState` has called `resetZone`, and the G24 PVP centre is used.
4. For each player `p`:
   - `p.pvpKills = p.pvpDeaths = 0`
   - `p.pvpWeaponId ||= "pistol"`
   - `p.pvpLastKilledBy = null`
   - `p.pvpProtectedFor = 0`
   - `p.pvpNav = { stickDir: 0, repeat: 0, prevButtons: [] }`
   - `pvpEnterAwaitingSpawn(p, /*prematch*/ true)`
5. `updatePvpHud()`.

`pvpEnterAwaitingSpawn(p, prematch)`:
- Sets `p.isDead = true`, `p.pvpAwaitingSpawn = true`, `p.pvpIsPrematch = prematch` and `p.pvpRespawnTimer = prematch ? 0 : PVP_RESPAWN_DELAY_SECONDS`.
- If the player is sliding: `endSlide(p)`. Then `cancelReload(p)`, `endMeleeSwing(p)`, `p.isAiming = false`, `p.isSprinting = false`, `p.viewModelRoot.visible = false`.
- `if (p.isInventoryOpen) setInventoryOpen(p, false)`.
- `showPvpPanel(p)`.

Marking the player `isDead` makes every existing system treat them as out of play: input actions, zone damage, enemy targeting, `getLivingPlayers` at 11859, and the zone centroid.

### 4.3 Death: `pvpHandleDeath(player)`, called from G17

- `player.isDead = true;`
- `if (player.carriedTurret) dropCarriedTurretOnDeath(player);`. This is defensive only.
- `pvpEnterAwaitingSpawn(player, false);`
- Do not exit pointer lock. A KB+M P1 drives the panel with the keyboard while the lock is held (see 5.3). Releasing the lock would freeze everyone via `p1NeedsClick`.
- The body stays where the player fell and plays the existing death pose. `updatePlayerBodyMeshes` uses `rig.deadPos`, which clears once `isDead` is false again.

### 4.4 Respawn: `pvpRespawnPlayer(player)`

Called by the panel's Respawn/Deploy action when `player.pvpRespawnTimer <= 0`.

```js
resetPlayerState(player);            // health, flags, stamina (=getMaxStamina, G14), physics, view model, HUD
player.inventorySlots[0] = player.pvpWeaponId === "fists" ? null : createWeaponSlotState(player.pvpWeaponId);
if (player.inventorySlots[0] && !WEAPON_DEFS[player.pvpWeaponId].gun.isMeleeOnly) player.inventorySlots[0].reserveAmmo = PVP_INFINITE_RESERVE;
player.inventorySlots[1] = null;
player.activeSlotIndex = 0;
setActiveViewModel(player);          // re-raises the chosen weapon and syncs the ammo HUD (shows the infinity symbol via G20)
const spot = pickPvpSpawnPoint(player);
player.camera.position.set(spot.x, EYE_HEIGHT, spot.z);
player.campusGroundY = 0;
player.yaw = spot.yaw; player.pitch = 0;
applyCameraRotation(player);
if (isCampusMap) campusWorld.updateVisibility(players.map((p) => p.camera.position));
player.pvpAwaitingSpawn = false; player.pvpIsPrematch = false; player.pvpProtectedFor = PVP_SPAWN_PROTECTION_SECONDS;
hidePvpPanel(player);
if (!pvpMatch.started && players.every((p) => !p.pvpIsPrematch)) pvpMatch.started = true; // clock starts once everyone has deployed
```

- `createWeaponSlotState` (14215) already loads a full magazine (`getMaxLoadedAmmo`).
- `resetPlayerState` resets skills, and the item inventory goes unused.

### 4.5 Per-frame: `updatePvpMatch(dt)`, called from G26 (world block, pauses with the match)

- For each player:
  - If `pvpAwaitingSpawn && pvpRespawnTimer > 0`, decrement it.
  - If `pvpProtectedFor > 0`, decrement it.
  - Refresh that player's panel countdown text and button enabled state.
- `if (pvpMatch.started) { pvpMatch.timeLeft -= dt; if (pvpMatch.timeLeft <= 0) { pvpMatch.timeLeft = 0; endPvpMatch(); } }`
- `updatePvpHud()`. It writes the timer text only when the whole second changes, which avoids rewriting the DOM every frame.
- Position the per-player PVP elements from `getPlayerViewportRect(i)` (18262). This is cheap, and it handles resize and all layouts. The view layout never goes dynamic in PVP, because `giveScreenArea` can't run (G18).

### 4.6 End: `endPvpMatch()`

- `pvpMatch.ended = true; pvpMatch.resultsTimer = PVP_RESULTS_AUTO_RETURN_SECONDS;`. G25, G26 and G28 then freeze play.
- Hide every per-player panel.
- Build the leaderboard: sort `players` by kills (descending), then deaths (ascending). Joint first place is shown as "Draw".
- Rows: rank, colored name `P{i+1}` (`ZONE_PLAYER_COLORS[i]`, 13205), kills, deaths, K/D. Banner: `P2 WINS` or `DRAW`.
- Show `#pvp-results`. Then `suppressNextPauseOnUnlock = true; document.exitPointerLock(); setCursorHidden(false);`. The suppression flag is the existing mechanism (see 18757), and it stops the pause overlay from appearing.
- The auto-return countdown runs from the always-running top of `updateCoopMatchFrame`, outside the frozen gates: `if (isPvpMatchActive && pvpMatch.ended && (pvpMatch.resultsTimer -= deltaSeconds) <= 0) pvpReturnToTitle();`
- `pvpReturnToTitle()` does the same as the death-screen Main Menu (19183): `resetGame(); titleScreenEl.classList.remove("hidden"); showTitlePanel("main");`. It also hides `#pvp-results`; `hidePvpUi` in G1 covers that.
- The results screen has a Continue button that calls `pvpReturnToTitle`.
  - Add a `MENU_NAV_SCREENS` entry (27006-27094): `{ key: "pvp-results", isActive: () => pvpResultsEl.classList.contains("visible"), getEls: () => [pvpResultsContinueEl] }`.
  - Add a `getControllerBackTarget` (27246) branch that returns the same button.

---

## 5. Procedural spawn algorithm: `pickPvpSpawnPoint(player)`

This is modelled on `procedural-spawn.js` `evaluate()` (206-265), the cheapest checks first. It runs only on a respawn, so the cost is about 90 candidates times at most 3 LOS checks.

```
others = players filtered: p !== player && !p.isDead && !p.pvpAwaitingSpawn
z = zoneState (initialized at match start, G24/4.2)
R = max(10, z.radius - PVP_SPAWN.ZONE_EDGE_MARGIN)
best = null, bestHidden = []
repeat PVP_SPAWN.CANDIDATES times:
  a = rand * 2PI; r = R * sqrt(rand)                 // area-uniform in the current zone
  x = z.center.x + cos(a) * r; zz = z.center.z + sin(a) * r
  // 1. valid floor / inside the map
  if (!campusWorld.insidePlayableEdge(x, zz, 2)) continue           // campus-world.js:7056
  if (!campusWorld.isWalkable(x, zz, PVP_SPAWN.CLEARANCE)) continue // ground floor, clear of walls (5686)
  // 2. if a zone move is pending, prefer inside the next zone too (soft)
  inNext = !z.next || hypot(x - z.next.x, zz - z.next.z) < z.next.radius - 4
  // 3. distance to every living opponent
  minD = min over others of hypot(dx, dz)   (Infinity if none)
  if (minD < PVP_SPAWN.MIN_DISTANCE) continue
  // 4. line of sight from each opponent's standing floor (floor-aware; fences are see-through)
  visible = count of others where !campusWorld.segmentBlocked(o.x, o.z, x, zz, 0, false, targetStandingY(o), 0)
  score = min(minD, PVP_SPAWN.DISTANCE_CAP) + (inNext ? 20 : 0) - visible * PVP_SPAWN.VISIBLE_PENALTY + rand * 5
  if (visible === 0) bestHidden.push({ x, z: zz, score })
  if (!best || score > best.score) best = { x, z: zz, score }
pick = bestHidden.length ? highest-score entry of bestHidden : best   // fallback: best score even if seen
if (!pick) pick = { x: campusWorld.spawn.x + (players.indexOf(player) - 1.5) * 2, z: campusWorld.spawn.z } // nothing valid at all
yaw = atan2(-(z.center.x - pick.x), -(z.center.z - pick.z))   // face the zone centre
return { x: pick.x, z: pick.z, yaw }
```

Notes:
- **Verify the yaw convention.** The camera looks down -Z at yaw 0 (see the comment at 21333). Check this against `applyCameraRotation`, and flip the sign if the player spawns facing away from the centre.
- **LOS is from the opponent's viewpoint.** `segmentBlocked(..., y1, y2)` with standing heights switches to the 3D floor-slab test (`campus-world.js` 5594/5635, which uses the eye-height constant `SIGHT_EYE_M`). Pass `includeFences=false`, because chain-link fences can be seen through. This is the "is it in sight" rule. Bullets don't use fences either.
- **Valid floor:** spawns go on the ground floor only (`campusGroundY = 0`). Before relying on `campusWorld.isWalkable` (5686), read it and confirm that it rejects building, vehicle and obstacle footprints. If it doesn't reject vehicles, also reject a candidate where `campusWorld.vehicleBlocksShot` (6182) intersects a short vertical segment at that spot, or use the collision helper that `resolveWallCollisions` relies on.
- **Off campus:** the map is campus-only (11801). If `!isCampusMap`, sample inside `zoneMapRect()` with `hasLineOfSight` and the same scoring. That fallback can stay simple.
- **First deploy:** the pre-match deploy uses the same function, so players start spread out and hidden from each other.

---

## 6. UI: HTML, CSS and DOM

### 6.1 Built once in JS by `buildPvpUi()` (called lazily)

This follows the same pattern as `buildZoneUi` at 13412. All elements are `position: fixed` and positioned from `getPlayerViewportRect(i)` every PVP frame. Because of that, no per-layout CSS (coop, trio or quad) is needed, and `PER_PLAYER_HUD_IDS` cloning isn't involved.

For each of the 4 players, append to `body`:
- `div.pvp-badge` (id `pvp-badge-p{n}`): the kill count, `"Kills 3"` plus a place such as `"#1"`, shown at the top-right of the viewport. It contains a `div.pvp-toast` that fades out after about 2 s (`"Eliminated P2"`), and a `div.pvp-protect` that reads "Spawn protected" while `pvpProtectedFor > 0`.
- `div.pvp-panel` (id `pvp-panel-p{n}`): the death and pre-match panel, which fills its player's viewport. It contains:
  - `h1`: "ELIMINATED", or "CHOOSE YOUR WEAPON" before the match.
  - `div.pvp-panel-sub`: "by P2", or "Zone" / "Fall" when there was no attacker. Empty before the match.
  - `ul.pvp-weapon-list`: one `li` per entry of `PVP_WEAPON_ORDER = [...Object.keys(WEAPON_DEFS), "fists"]`. That is pistol, glock, shotgun, smg, ak47, sniper, bat, katana and fists. The label is `WEAPON_DEFS[id].displayName`, or "Fists" (the spec's "melee": fists are an empty slot and have no `WEAPON_DEFS` entry). `li.selected` marks the current pick.
  - `button.menu-button.pvp-respawn`: "Respawn in 5", then "Respawn", or "Deploy" before the match. It has the `disabled` attribute while the timer is above 0.
  - `div.pvp-hint`: scheme-specific text, using `readyIconHTML` (19939) for the controller icon, for example "Up/Down: weapon · Square/Cross: respawn", or "W/S or Wheel: weapon · Enter/Space/Click: respawn".
  - Mouse clicks on an `li` or the button also work. They only matter when the pointer isn't locked.

Also add one global element, `div#pvp-timer`, showing `"29:41"`. It is centred on the 50vh seam: `top: 50vh; left: 50%; transform: translate(-50%, -50%)`. That matches where the co-op wave HUD sits (CSS 952-959), and every PVP layout has a horizontal seam at 50vh. Before the match starts it shows "Waiting for players".

`showPvpPanel(p)`, `hidePvpPanel(p)`, `updatePvpHud()` and `hidePvpUi()` toggle a `.visible` class. `hidePvpUi` hides everything, including `#pvp-results`, and is safe to call before `buildPvpUi` has run, so it must guard against null.

### 6.2 Static HTML

Add `#pvp-results` next to `#death-screen` (3180):

```html
<div id="pvp-results">
  <h1 id="pvp-results-banner">P1 WINS</h1>
  <table id="pvp-results-table"><thead><tr><th>#</th><th>Player</th><th>Kills</th><th>Deaths</th><th>K/D</th></tr></thead><tbody></tbody></table>
  <div id="pvp-results-return">Returning to title in 20</div>
  <button id="pvp-results-continue" class="menu-button">Continue</button>
</div>
```

### 6.3 CSS

Put this after the death-screen rules (1829-1854). Reuse that screen's z-index (30) for the results, and use 25 for the panels, the same as `.coop-spectator-screen`.

```css
body.pvp-mode #wave-hud, body.pvp-mode #score-hud, body.pvp-mode #boss-health-hud { display: none; }
.player-count-divider { margin-top: 10px; font: bold 14px Arial, Helvetica, sans-serif; color: rgba(255,255,255,0.7); text-align: center; letter-spacing: 2px; text-transform: uppercase; }
#pvp-timer { position: fixed; top: 50vh; left: 50%; transform: translate(-50%, -50%); z-index: 20; display: none; padding: 4px 12px; font: bold 22px Arial, Helvetica, sans-serif; color: #fff; background: rgba(0,0,0,0.55); border-radius: 6px; pointer-events: none; }
body.pvp-mode #pvp-timer { display: block; }
.pvp-badge { position: fixed; z-index: 20; display: none; transform: translateX(-100%); font: bold 18px Arial, Helvetica, sans-serif; color: #fff; text-shadow: 0 1px 3px #000; text-align: right; pointer-events: none; }
.pvp-badge.visible { display: block; }
.pvp-toast { font-size: 14px; color: #ffd24d; opacity: 0; transition: opacity 0.3s; }
.pvp-toast.show { opacity: 1; }
.pvp-protect { font-size: 12px; color: #7fd4ff; display: none; }
.pvp-protect.show { display: block; }
.pvp-panel { position: fixed; z-index: 25; display: none; flex-direction: column; align-items: center; justify-content: center; gap: 6px; background: rgba(20,0,0,0.6); color: #fff; font-family: Arial, Helvetica, sans-serif; pointer-events: auto; overflow: hidden; }
.pvp-panel.visible { display: flex; }
.pvp-panel h1 { margin: 0; font-size: clamp(18px, 4vh, 40px); }
.pvp-weapon-list { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(3, minmax(90px, 1fr)); gap: 4px; }
.pvp-weapon-list li { padding: 4px 10px; border: 2px solid rgba(255,255,255,0.4); border-radius: 4px; background: rgba(255,255,255,0.08); text-align: center; font-size: clamp(11px, 1.8vh, 16px); cursor: pointer; }
.pvp-weapon-list li.selected { border-color: #ffd24d; background: rgba(255,210,77,0.25); }
.pvp-respawn[disabled] { opacity: 0.5; cursor: default; }
.pvp-hint { font-size: 12px; opacity: 0.75; }
#pvp-results { position: fixed; inset: 0; z-index: 30; display: none; flex-direction: column; align-items: center; justify-content: center; gap: 14px; background: rgba(0,0,0,0.8); color: #fff; font-family: Arial, Helvetica, sans-serif; }
#pvp-results.visible { display: flex; }
#pvp-results-table { border-collapse: collapse; font-size: 20px; }
#pvp-results-table th, #pvp-results-table td { padding: 6px 16px; text-align: center; }
```

Navigation is described as a 3x3 grid, but in practice it is a linear selection (up/down steps by one, wrapping), so the grid is visual only. If the quad viewports turn out to be too small, keep the grid. It fits 9 entries in 3 rows.

### 6.4 Panel input: `updatePvpPanelInput(player, dt)`, called from G27

**Controller.** `const pad = player.input.getRawGamepad && player.input.getRawGamepad();`
- Up/down: D-pad buttons 12 and 13 (edge-detected against `player.pvpNav.prevButtons`), or left stick Y beyond the deadzone. Use an edge plus a hold-repeat (0.35 s first delay, then 0.12 s), the same idea as `stepHeldStickAxis` (20323). Reuse that function if its signature fits.
- Each step changes `player.pvpWeaponId` and re-renders the `li.selected`.
- Confirm: Square (`CONTROLS_NAV_REBIND_BUTTON_INDEX` = 2, the menu confirm) or Cross (button 0), edge-detected. Call `pvpRespawnPlayer(player)` if `pvpRespawnTimer <= 0`.
- D-pad up is normally the inventory toggle. The inventory is disabled (G4), and `processEdgeTriggeredActions` skips dead players, so the two don't conflict.

**Keyboard (P1 on KB+M only).** One `keydown` listener and one `wheel`/`mousedown` listener on `document`, active only when `isPvpMatchActive && matchP1Scheme === "keyboard" && players[0].pvpAwaitingSpawn && !isMatchPaused && !pvpMatch.ended`:
- W / ArrowUp / wheel up and S / ArrowDown / wheel down step the selection.
- Enter, Space or a left mousedown respawns, once the timer allows it.
- Call `preventDefault()` and `stopPropagation()` so Space doesn't also jump.
- Pointer lock stays held throughout. Firing is already ignored while the player is dead.

---

## 7. Edge cases to handle

- **Pause during a respawn countdown:** `updatePvpMatch` is in the world block (G26), so the countdown pauses along with the match. The panel input sits inside `!isFrozen` (G27), so it pauses too.
- **Every player dead at once:** `updateZone` returns early (13349) and the clock keeps running. That's acceptable.
- **The killer dies on the same frame:** `pvpRecordKill` still credits the killer, as long as the attacker exists. Drop the `!attacker.isDead` condition from 3.1 if you prefer to always credit; that is the simpler choice.
- **Zone damage during spawn protection:** blocked by the 3.1 guard, which is fine because spawns are inside the zone.
- **Burst follow-up shots** (`fireWeapon(player, true)` from `updateFireCooldown`) take the same PVP branch.
- **Restart button:** never shown in PVP (G17). `wasCoopMatch` and `wasQuadMatch` don't need to change.
- **`pvpSetupSelected` staying true:** after a PVP match, choosing co-op resets it (4.1). Singleplayer never reads it. `startSingleplayerGame` doesn't touch either flag, and `resetGame` has already cleared `isPvpMatchActive`.

---

## 8. Test checklist

### 8.1 Mechanical checks, run after every coherent batch of edits

1. **JS syntax** (parses without executing):
   `node -e "const s=require('fs').readFileSync('index.html','utf8');const a=s.indexOf('<script>\n')+9;new Function(s.slice(a,s.lastIndexOf('</script>')));console.log('syntax ok')"`
2. **Sync, then confirm the copies match:** `node scripts/sync-frontend.js` and `cmp index.html frontend/index.html`.
3. **PVE regression:** `node tests/run-perf.js` (the default `#perftest`). Use `HASH=#spawntest RESULT_EXPR="document.getElementById('spawn-test-results').textContent" node tests/run-perf.js` for the campus spawn test. Compare against a run on the unmodified commit: there should be no new `EXC`/`ERR` lines and similar numbers. If there's no GPU, add `GL_MODE=swiftshader`.

### 8.2 Automated PVP smoke test (new `tests/pvp-test.js`, hash `#pvptest`)

- In the test-hooks block (27639), add `pvptest` to the regex. Load `tests/pvp-test.js` when the hash matches `/pvptest/`.
- Expose these hooks:
  - `startPvpForTest(n)`: sets `pvpSetupSelected = true`, sets the setup schemes to controller, then calls `startCoopMatch()` or `resetQuadSetup(n)` + `startQuadMatch()`.
  - `pvpRespawnPlayer`, `pickPvpSpawnPoint`, `findPvpPlayerHits`, `updatePvpMatch`, `endPvpMatch`, `pvpMatch`.
  - `get isPvpMatchActive()`, `getMaxStamina`, `toggleInventory`, `updateCoopMatchFrame`, `resetGame`, `zoneState`.
- The test sets `window.__perfResults = JSON.stringify({ pass, checks })` so that `run-perf.js` picks it up. Run it with `HASH=#pvptest node tests/run-perf.js pvp.json`.
- Checks:
  1. After `startPvpForTest(2)`: `isPvpMatchActive && isCoopMatchActive`, every player has `pvpAwaitingSpawn`, and `#pvp-panel-p1` is visible.
  2. `pvpRespawnPlayer(p)` for both players: each has exactly one slot holding the chosen weapon, `reserveAmmo === PVP_INFINITE_RESERVE`, the reserve element shows the infinity symbol, and `pvpMatch.started === true`.
  3. The spawn points are at least `MIN_DISTANCE` apart, inside the zone, and `isWalkable`.
  4. Spawn LOS: on 50 repeated `pickPvpSpawnPoint` calls with opponents placed in the open, a hidden point is returned whenever one exists. That means `segmentBlocked` from each opponent is true.
  5. Place P2 10 m in front of P1 with no walls between them and both on the ground, aim P1 at P2, and set `pvpProtectedFor = 0`.
     - `fireWeapon(P1)` lowers P2's health by the pistol damage.
     - Repeat until P2 dies: `P2.isDead && !P2.isDowned`, `P1.pvpKills === 1`, `P2.pvpDeaths === 1`, and P2's panel shows "by P1".
  6. Self-hit is impossible: `findPvpPlayerHits(P1, ray from P1)` never contains P1.
  7. Floor awareness: put P2 on an upper floor directly above P1's line of fire (any campus building with `segmentBlocked3D` slabs), then check that `findPvpPlayerHits` returns nothing through the slab.
  8. Spawn protection: a hit within 2 s of a respawn does no damage.
  9. Respawn gate: `pvpRespawnTimer` is 5 right after death. Triggering the respawn before the timer reaches 0 does nothing. After stepping 5 s of `updatePvpMatch`, it works.
  10. No PVE spawns: step `updateCoopMatchFrame(1/30)` for 120 simulated seconds, then check `enemies.length === 0`, `waveNumber === 0`, and that `#wave-hud` is not displayed.
  11. `toggleInventory(P1)` leaves `isInventoryOpen` false. `getMaxStamina(P1) === 200`. The teammate markers are not visible.
  12. `tryStartSlide` works with no `sliding` skill (set the velocity above the threshold first).
  13. Zone: `zoneState.phaseDuration === 60` at init, and stepping 61 s moves it to `"warning"`.
  14. End: set `pvpMatch.timeLeft = 0.01` and step. Then `#pvp-results` is visible, the banner names the player with the most kills, and play is frozen.
  15. `resetGame()`: `isPvpMatchActive === false`, there is no `pvp-mode` class, and every PVP element is hidden. Then `startPvpForTest` → `resetGame` → `__gameTestHooks.startRun()` (singleplayer) gives `getMaxStamina === 100` and normal wave behavior.

### 8.3 Manual playtest

Only when the user asks to launch: `npm run tauri dev` (see CLAUDE.md, and never auto-launch).
- [ ] Multiplayer: the PVP options appear under a "PVP Deathmatch" label and can be reached with a controller (left stick, Square) and the mouse. Back returns to mode select.
- [ ] Run a PVP match with 2, 3 and 4 players: the setup screen works, and the match starts in the correct layout (top/bottom, trio, quad).
- [ ] The pre-match panel shows in every viewport with no timer. Choosing a weapon and pressing Deploy spawns the player out of sight of the others. The clock starts after the last player deploys.
- [ ] KB+M P1 changes weapon with W/S or the wheel and deploys with Enter, Space or a click, without losing pointer lock. A controller player uses the D-pad or stick and Square or Cross.
- [ ] Each weapon damages other players: pistol, glock (head), shotgun (close and far falloff), smg, ak47, sniper (head x2, penetration through 2 players), bat swing, bat sweep, katana, fists.
- [ ] No hits through walls, floors or vehicles. Melee doesn't reach through fences or across floors.
- [ ] Controller aim assist slows and pulls toward opponents but not through walls.
- [ ] A kill sends the victim straight to the death panel (no downed state), with no co-op spectate or "Give Screen Area", and the viewport stays. Respawn is disabled for 5 s. The attacker's kill count goes up and they see a toast.
- [ ] After a respawn: full health, the chosen weapon only, a full magazine, the infinity symbol for reserve, reloading still works, 2 s protection (ended early by firing), bat durability never breaks.
- [ ] No zombies, pickups, wave HUD, score HUD, inventory or skill tree. Turrets and crafting can't be reached. Vehicles are still present.
- [ ] Movement is visibly faster. Slide works with no skill. The stamina bar lasts about twice as long.
- [ ] The zone warns after about 60 s and moves about every 95 s. Damage outside works, and a zone death is counted as a death with no kill.
- [ ] No light-blue markers above players. Opponent bodies are visible, and dead bodies stay put until the respawn.
- [ ] Pausing (Esc or Start), including while P1 is dead, shows the pause menu and freezes the countdowns. Resume works.
- [ ] At 30:00 (shorten `PVP_MATCH_SECONDS` temporarily to test): the leaderboard appears, Continue or the 20 s auto-return goes to the title, and a following co-op or singleplayer game behaves exactly as before (waves, downed state, spectate, markers, stamina 100, normal speed).

---

## 9. Wrap-up (from the spec)

- **`GAME_DESIGN.md`:** add a short `## PVP Deathmatch` section after `## Zombie car climbing` (line 2502) covering the rules, the constants and their values, and the spawn rule. Add one changelog line under `## 11. Changelog`.
- **Commit locally, without pushing.** The commit includes `index.html`, `frontend/index.html`, `GAME_DESIGN.md`, `tests/pvp-test.js`, `PVP_SPEC.md` and `PVP_PLAN.md`. Suggested message: `Add PVP free-for-all deathmatch (2-4P split-screen)`.

## 10. Suggested implementation order (one syntax check after each step)

1. Section 1 state, plus G1, G2 and the `startCoopMatch`/`startQuadMatch` hooks, plus the 4.1 menu entry, with an empty `startPvpMatchExtras`. Check: a PVP match starts and plays as co-op.
2. The PVE gates (G3-G15, G19-G24, G33).
3. The death, respawn and spawn pieces: G16 (without the attacker yet), G17, G18, G25-G30, 4.2-4.6, section 5 and section 6.
4. The damage hooks: section 3 (3.1 through 3.6).
5. Sections 8.1 and 8.2, then the GAME_DESIGN note and the commit.
