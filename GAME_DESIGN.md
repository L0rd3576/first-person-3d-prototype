# Game Design Document

**This document describes what is actually implemented in `index.html` as of the date below.**
It was written by reading the current code (constants, functions, and comments), not by
re-stating original feature requests — values get tuned after the fact, and this reflects
current tuning, not history. When this drifts out of sync with the code (and it will), trust
the code and re-sync this file.

---

## 1. Overview

A first-person, wave-based survival shooter titled **"Escape From Kise."** (per the title
screen — there's still no story/framing behind that name; see [Known Gaps](#8-known-gaps--open-design-questions)).
The player spawns inside a small single-building floor plan, fights off escalating waves of one
enemy type (plus a faster variant), and survives as long as possible, on one of three difficulty
levels chosen from a pre-game setup screen. There is currently no win condition.

**Platform / tech stack:**
- **Tauri 2 (Rust)** — native desktop window/shell, packaging. See `src-tauri/`.
- **Three.js r128** — 3D rendering, vendored locally at `vendor/three.min.js` (no CDN, no network dependency).
- **Vanilla JS/HTML, single file** — the entire game lives in `index.html` at the project root
  (the source of truth). `scripts/sync-frontend.js` copies it (and `vendor/`) into `frontend/`,
  which is what Tauri actually bundles — `frontend/index.html` is a generated copy, never edited
  directly.
- No build step, no bundler, no external game-code dependencies.

---

## 2. Movement & Controls

Full current key bindings (from the input-handling code and the in-game Controls panel):

| Input | Action |
|---|---|
| `W A S D` | Move |
| `Shift` | Sprint |
| `Ctrl` | Crouch (hold) / Slide (tap while sprinting) |
| `Space` | Jump |
| Mouse | Look |
| Left mouse button | Fire |
| Right mouse button | Aim down sights (hold) |
| `R` | Reload |
| `1`, `2` | Switch to inventory slot 1 / 2 directly |
| Scroll wheel | Cycle active inventory slot |
| `V` | Melee |
| `G` | Drop the active slot's item |
| `F` | Pick up the nearest dropped item in range |
| `Esc` | Pause (releases pointer lock) |

**Movement model:** Quake-style accelerate/friction — input steers a velocity vector rather
than setting position directly (`ACCELERATION = 45`, `FRICTION = 9`), so momentum, sprint
transitions, and knockback all blend naturally.

- **Walk speed:** `6.0 * 0.85 = 5.1` units/sec (deliberately tuned down from an original 6.0).
- **Sprint:** `5.1 * 1.8 = 9.18` units/sec. Disabled while crouching.
- **Crouch:** eye height drops to `1.0` (from `1.7` standing), speed multiplier `0.5`
  (`2.55` units/sec), eye-height transition eased at rate `10`.
- **Slide:** tap `Ctrl` while sprinting forward (must be moving at ≥ `5.1 * 1.15 = 5.865`
  units/sec) to trigger a burst up to `9.18 * 2.0 = 18.36` units/sec, decaying back to walk
  speed over `1.2s`. Limited steering while sliding (nudges direction, doesn't redirect it),
  mouse sensitivity dampened to 60% of normal. Cancelled early by: jumping, running into an
  enemy, or tapping `Ctrl` again (must release and re-press — holding doesn't cancel it).
  `0.75s` cooldown after any slide ends before another can start.
- **Jump:** initial upward velocity `7.0`, gravity `-18.0`/sec².
- **Mouse look:** sensitivity `0.0022` rad/pixel, pitch clamped to just under straight up/down.
  Camera rotation is computed once per frame (`applyCameraRotation`), combining the player's
  own aim with the current recoil offset (see §3) — mouse movement itself only updates the
  underlying yaw/pitch, never writes to the camera directly.
- **Map size reference:** the floor plan is scaled so that running its longer bounding-box
  dimension at a fixed reference speed takes ~12.75s ("if there were no walls").

---

## 3. Combat Systems

### Weapon-definition architecture

Weapons are data, not special-cased code. Each entry in `WEAPON_DEFS` provides:
- `gun`: `damage`, `magazineCapacity` (rounds a reload draws from reserve — **not necessarily**
  `maxLoadedAmmo - 1`), `maxLoadedAmmo`, `defaultReserveAmmo`, `reloadDuration`, view-model
  pose data (`hipFirePosition`/`hipFireRotationY`, `adsPosition`/`adsRotationY`), a `buildModel()`
  factory returning `{ group, muzzleTip }`, and a `recoil` config (see below).
- `melee`: `damage`, `range`.

Inventory/switching/firing/reload/melee/recoil code all read this generically — adding a third
gun means adding another `WEAPON_DEFS` entry, not touching any of that logic. An empty inventory
slot isn't a weapon at all — it just means the player holds fists (see §5).

### Current weapon roster

| | Pistol | Glock |
|---|---|---|
| Damage/shot | 40 | 30 |
| Magazine | 8+1 (9 max loaded) | 17+1 (18 max loaded) |
| Reload draws | 7 rounds from reserve | 17 rounds from reserve |
| Starting reserve | 35 (5 clips) | 51 (3 magazines — guessed, unspecified) |
| Reload duration | 1.5s (same for both, for now) | 1.5s |
| View-model kick (visual) | pitch 0.09, kickback 0.05, recovers at rate 12 | pitch 0.06, kickback 0.035, recovers at rate 15 |
| Camera recoil (affects aim) | +0.028 rad pitch/shot, ±0.014 rad random yaw, recovers at rate 7 | +0.018 rad pitch/shot, ±0.009 rad random yaw, recovers at rate 9 |

The pistol's reload is a partial-clip design on purpose: reloading with a round still chambered
tops out at 8/9, not a full 9, since the clip itself only ever holds 7.

Both start equipped: slot 1 = pistol, slot 2 = Glock (there's no pickup/unlock gate on the
Glock — see §8).

### Firing

- Hitscan: an instant raycast from the camera through screen center. No bullet travel time.
- Hip-fire spread: ±0.044 rad (~2.5°) half-angle cone, sampled uniformly by area. Fully accurate
  (zero spread) while aiming down sights.
- **ADS:** hold right mouse button. Gun lerps toward a centered pose, FOV narrows from 75° to
  60°, both easing over 0.2s. Mouse sensitivity does *not* change while aiming.
- **Auto-reload:** firing an empty gun with reserve ammo left automatically starts a reload
  instead of dry-clicking.
- **Muzzle flash:** a small particle burst (10 particles, ~0.09s life) spawned just past the
  barrel tip, rendered with depth-testing disabled so it isn't occluded by the gun's own mesh.
- **Fists equipped:** left-click (the fire button) throws a punch instead of doing nothing —
  it calls the exact same melee action `V` does (see below), including its shared cooldown, so
  spamming left-click doesn't punch faster than pressing `V` would.

### Recoil (affects actual aim, not just the view model)

Two separate, per-weapon-configurable systems, both firing from the same shot:
1. **View-model kick** (cosmetic): the gun sprite itself kicks up/back and eases back to its
   pose.
2. **Camera recoil** (real): a fixed upward pitch kick plus a random ± horizontal yaw nudge are
   added to the player's *actual* look direction, decaying back toward wherever the mouse is
   really pointing. Recovery never fights new mouse input — aim and the recoil offset are two
   separate numbers only summed at the moment the camera's rotation is actually written each
   frame. The combined pitch is hard-clamped to the same limit normal mouse look respects, so
   sustained fire can't spin the view past straight up/down.

### Melee (works with a gun equipped or with fists)

- Damage: 25 (same for gun-swing and fist-punch).
- Range: 2.2 units (instant raycast, same hit-resolution style as gunfire, just range-limited).
- Cooldown: 0.6s between swings; the swing/punch animation itself takes 0.45s.
- With a gun equipped: the gun lifts, then swings forward/down as a strike (reuses the same
  pitch axis as recoil/reload tilt).
- With fists: alternates left/right punch each swing (thrust animation).

### Damage reference

| Source | Damage | Hits to kill a base enemy (60 HP) |
|---|---|---|
| Pistol | 40 | 2 |
| Glock | 30 | 2 |
| Melee (either) | 25 | 3 |
| Enemy contact (per player) | 10/tick, every 0.5s | — |

---

## 4. Enemies

- **One enemy archetype** with a faster variant, not multiple distinct enemy types.
- **Base stats:** 60 HP, speed `3.025` units/sec (~59% of player walk speed), person-sized box
  (`0.6 × 1.8 × 0.6`). Speed and size are each independently randomized ±1–5% per spawn (flavor,
  not wave-based scaling).
- **Fast ("green") variant:** same stats otherwise, but moves at 3.3× the (already-randomized)
  base speed. Visually distinct (green body material vs. red).
- **Contact damage:** 10 HP per tick, every 0.5s, while within contact range (which scales with
  that enemy's own randomized size).
- **Knockback:** a fixed velocity impulse pushes the player away from the enemy on each contact tick.
- **AI / pathfinding — this is grid A\*, not a two-state inside/outside zone system.** An earlier
  version of this project *did* use a two-state (outside/inside building) approach (see git
  history), but it's been fully replaced. Current behavior:
  - The floor plan is rasterized once at load into a walkability grid (0.75-unit cells).
  - Each enemy re-runs A* to the player on a jittered timer (~0.8–1.2s), not every frame.
  - The raw grid path is "string-pulled" down to a handful of corner-hugging waypoints.
  - An enemy drops its cached path early and beelines straight at the player the instant there's
    a clear line of sight — it only follows waypoints while something's actually in the way.
  - Diagonal grid moves are disallowed if they'd cut through a blocked cell's corner, so paths
    can't clip through a wall or the interior pillar.
  - Enemies turn toward their move direction at a limited rate (not an instant snap) and use the
    same sub-stepped wall collision as the player.
- **Spawning:**
  - 5 hand-placed spawn points ringing the building at its actual wall gaps/corners, plus 10 more
    procedurally placed on a ring outside the wall bounding box entirely (evenly spaced with a
    randomized phase per session). All spawners are validated clear of every wall collider at load.
  - A spawner within 10 units of the player is excluded from the random pool for that particular
    spawn (falls back to the full list if every spawner is somehow excluded at once).
  - **Wave sizing (Normal):** wave *N* spawns `8 + 4N` base enemies (capped at 50), staggered one
    at a time such that the time from the wave's first spawn to its last is exactly
    `(count) × 0.85` seconds (e.g. 100 zombies takes 85 seconds to finish spawning —
    `WAVE_SPAWN_DURATION_MULTIPLIER` in the code). This formula, plus every other number in this
    section, is Normal's — see **Difficulty system** below for how Hard/Legendary change it.
  - **Fast-enemy schedule (Normal)** — fully separate from the above, layered on top, not
    subtracted from the base count:
    - Waves 1–2: none.
    - Wave 3: exactly 1, at a random point in the wave's spawn window.
    - Wave 4: exactly 3 — one fixed at 3s in, then two more 0.4s apart right at the end.
    - Wave 5+: `count = wave - 1`, each at an independent random time in the spawn window.
  - **Grace periods:** 5s before wave 1, 10s between every wave after (starting the moment the
    previous wave's *last enemy dies*, not when it finishes spawning). Grace periods (and all
    other wave/enemy/reload/recoil timers) are frozen while the game is paused or before the
    player has ever clicked to start.
  - 30% chance per kill to drop an ammo pickup at the death position (see §5).

### Difficulty system

A per-difficulty config object (`DIFFICULTIES` in the code) that enemy-spawning/stat code reads
from — nothing scatters if-difficulty checks through that logic. Selected on the pre-game setup
screen (see §7), persisted across launches, defaults to Normal the very first time the game is
ever run.

| | Normal (baseline) | Hard | Legendary |
|---|---|---|---|
| Enemy speed | 1.0× (the `3.025` units/sec baseline above) | 1.15× | 1.30× (relative to Normal directly, not stacked on Hard's 1.15×) |
| Enemy health | 1.0× (60 HP) | 1.0× (60 HP) | 1.2× (72 HP) |
| Enemy count formula | `f(w) = 8 + 4w` | `f(w) = 10 + 5w` | same as Hard |
| Fast-enemy schedule | starts wave 3 (as above) | same shape, shifted 1 wave earlier (starts wave 2) | same as Hard |

The speed/health multipliers apply to *every* enemy including the fast variant (its own 3.3×
speed multiplier stacks on top of the difficulty multiplier, not instead of it). The wave-count
formula is capped at 50 regardless of difficulty, same as Normal.

### Score system

- **+10 points** for every fast ("green"/"evan") enemy killed. Normal enemy kills award nothing
  on their own.
- **A per-difficulty bonus every time a wave is fully cleared:** +100 on Normal, +150 on Hard,
  +200 on Legendary (`DIFFICULTIES[id].roundClearScore` in the code — same data-driven object the
  rest of the difficulty system uses, not a separate hardcoded check).
- Current score is shown in the top-right HUD during play; resets to 0 at the start of every run
  (death+restart, or exiting to the main menu).
- **Session high score:** the best `currentScore` has reached across *any* run since the app was
  last launched, shown on the title screen's main panel. Deliberately **not** persisted to
  `localStorage` the way the difficulty choice is — it resets to 0 on a fresh launch, by design
  (see §8 for the gap this leaves).

---

## 5. Items / Inventory

- **2 inventory slots.** Each holds either a weapon ID or is empty. An empty active slot means
  the player holds fists — two tan rectangular-prism forearm meshes — rather than a third
  "weapon." Melee still works with fists equipped (see §3).
- **Switching:** number keys (`1`/`2`) select a slot directly; scroll wheel cycles between them.
  Both always work, not either/or. Switching snaps the view model to the new pose instantly,
  cancels ADS, and cancels any in-progress melee swing. A reload in progress on a slot you
  switch away from *pauses* (doesn't keep advancing) until you switch back to it.
- **Ammo pickups:** small floating cubes, dropped at 30% chance on enemy death, despawn after
  60s if uncollected. Walking within 0.8 units collects one (+12 reserve rounds). Ammo goes to
  whichever gun is actually "in hand": the active slot if it holds a gun, or the other slot's
  gun if the active slot is fists. If neither slot has a gun, the pickup is left alone rather
  than wasted.
- **Dropping (`G`):** drops the active slot's weapon in front of the player, retaining its exact
  current ammo state (loaded + reserve). It tumbles under a simple gravity + bounce + angular-
  velocity model (no physics engine) and locks in place permanently after 1.5s of staying below
  both a linear- and angular-speed threshold. Dropped items never collide with the player or
  enemies — purely visual/interactive. Dropping empties the slot (fists become active if it was
  the active one).
- **Picking up (`F`):** picks up the nearest dropped item within 2.0 units — a plain proximity
  check, not an aim/raycast requirement (chosen deliberately over reusing melee's raycast
  pattern, since precisely crosshair-aiming at a small gun lying flat on the ground would feel
  unreliable). Fills an empty slot if one exists; if both are full, replaces the active slot and
  drops what was there (same drop behavior as `G`). Picked-up ammo state is exact, not reset to
  a fresh weapon.
- **Current weapon roster:** Pistol and Glock (see §3). No other item types exist (no
  grenades/attachments/armor/keys/etc.).

---

## 6. Map / Environment

- **Ground plane:** a flat `130 × 130` unit platform (grid-textured), sky-blue background +
  matching fog (fades in from 40 units, fully opaque by 110).
- **Building layout:** traced from a hand-drawn SVG floor plan (`5 nights at kise/svg.svg`,
  an 800×600 canvas) — 5 straight exterior/perimeter wall segments plus 2 rectangular interior
  obstacles (one diagonal wall, one axis-aligned pillar). Wall endpoints within a few SVG pixels
  of each other are welded to a shared average point so collision colliders join cleanly at
  corners (no seam gaps).
- **Scale:** chosen so that crossing the floor plan's longer bounding-box dimension at a fixed
  reference speed ("if there were no walls") takes ~12.75 seconds. Player speed and map size are
  tuned independently (a reference speed constant is used for scaling, not the live walk speed).
- **Collision:** all walls/pillars are line-segment colliders with half-thickness; both the
  player and enemies push out of them via the same sub-stepped resolver (large single-frame
  moves are split into ≤0.08-unit steps so fast movement — e.g. sliding — can't tunnel through a
  thin wall in one jump).
- **Player spawn:** a fixed point in the floor plan's top-left interior pocket, clear of every
  wall.
- **Enemy spawners:** invisible markers (no geometry) — 5 hand-placed at real wall gaps/corners,
  10 more evenly ringing the building's exterior (see §4). Enemies don't need to spawn *at* a
  gap; A* finds its own route in through whatever gap exists.
- **Nav grid:** derived entirely from the wall colliders and spawner positions (nothing hardcodes
  a specific gap/corner/coordinate), so it automatically rebuilds correctly if the floor plan or
  spawner placement changes.
- **Lighting:** one ambient light + one directional "sun" light with dynamic shadows (shadow
  target/position re-centered on the player every frame).
- There is exactly **one map/level** — no level select, no second area, no outdoor-vs-indoor
  distinction beyond "inside vs. outside the one building's walls."

---

## 7. UI / UX

- **Title screen** (`#title-screen`, shown first, above everything else): full-screen background
  is the same enemy face image the 3D face texture uses (stretched via `object-fit: cover`,
  blurred + darkened for legibility), heading "Escape From Kise.", three buttons: **Play**
  (opens the difficulty setup screen below), **Controls** (opens the same read-only controls
  panel the pause menu uses — not a duplicate), **Exit** (closes the native window via Tauri's
  window-close API, exposed through the `window.__TAURI__` global — enabled via
  `withGlobalTauri` in `tauri.conf.json` plus an explicit `core:window:allow-close` capability,
  since neither is granted by Tauri's default permission set). Also shows the session high score
  (see §4's Score system) below the heading.
- **Pre-game setup screen** (reached via Play): a difficulty selector — **Normal** / **Hard** /
  **Legendary**, single-select, the active one visually highlighted — plus a **Start** button
  that begins the run on whichever difficulty is currently selected. Hard and Legendary each list
  what's harder about them as bullet points under the option (Hard: "More enemies", "Faster
  enemies"; Legendary: "More enemies", "Fastest enemies", "Enemies have more health"); Normal has
  none. Defaults to Normal the very first time the game is ever run; after that, the
  last-selected difficulty is remembered via `localStorage` and pre-selected on every subsequent
  launch. See §4's Difficulty system for what each option actually changes.
- **HUD (during play):**
  - Top-center: current wave number, or a countdown to the next wave during the grace period.
  - Top-right: current score (see §4's Score system).
  - Bottom-left: health label + color-shifting bar (green → yellow → red as it drops).
  - Bottom-right: loaded/reserve ammo counter — automatically hidden entirely when fists are
    equipped (no ammo to show).
  - Center: a small crosshair dot, plus a brief red "X" hit marker flash (0.2s) on a confirmed
    hit (gunfire or melee).
- **Start screen:** minimal "Click to play" prompt — the full control list has been deliberately
  removed from here (see below) and lives only in the pause menu now.
- **Pause menu:** triggered whenever pointer lock is lost while alive (Esc, alt-tab, or any other
  browser-driven unlock) — **not** just cosmetic; the whole simulation (waves, enemies, reload/
  aim/recoil/melee timers, ammo pickups, dropped-item physics) freezes while it's up. Three
  buttons: **Resume** (re-locks the pointer), **Controls** (opens a read-only key-binding list,
  with a note that rebinding isn't available yet; **Back** returns to the pause menu), and
  **Exit to Main Menu** (ends the current run — same full reset as the death screen's Restart,
  including the score, but returns to the title screen instead of dropping straight back into a
  new round). This menu already existed before the title screen/score work — it wasn't built
  from scratch for this pass, just extended.
- **Death screen:** full-screen red overlay, "YOU DIED", a single **Restart** button that fully
  resets run state (health, both inventory slots back to fresh pistol+Glock, position, wave
  counter back to pre-wave-1, all enemies/pickups/dropped items cleared) and immediately
  re-requests pointer lock.
- No minimap, no objective marker, no settings/options menu (volume, graphics, key rebinding),
  no audio at all (no sound effects, no music — confirmed by explicit comments in the firing/
  reload code noting no audio system exists yet).

---

## 8. Known Gaps / Open Design Questions

Being direct about the distance between "a collection of working mechanics" and "a complete game":

- **No win condition.** Waves escalate forever (`8 + 4N` zombies, `N - 1` fast enemies from wave
  5 on, uncapped wave number) with no ending, no boss, no "you survived" state — the only way a
  run ends is death.
- **Score exists now, but no run summary and no cross-launch persistence.** There's a live score
  (see §4) and a session high score shown on the title screen, but there's still no death-screen
  recap ("you scored 340, reached wave 7"), no leaderboard, and — deliberately, per how it was
  asked for — the high score resets to 0 every time the app is relaunched rather than being
  remembered long-term the way the difficulty choice is. Worth deciding whether that's the
  intended final behavior or just where this stopped for now.
- **No health recovery of any kind.** No regen, no health pickups/kits — only ammo drops exist.
  Once damaged, the only way to reset health is a full death+restart.
- **Single enemy archetype.** "Fast enemy" is a speed/color variant of the same mesh and AI, not
  a distinct enemy type — no ranged enemies, no special attacks, no boss waves.
- **No audio whatsoever.** Every gunshot, hit, footstep, enemy, and menu action is silent.
- **No settings/options menu.** No volume, no graphics options, no rebindable keys (the pause
  menu's Controls panel is explicitly view-only). The only persisted preference of any kind is
  the chosen difficulty.
- **Glock has no acquisition gate.** It starts equipped in slot 2 from the very beginning — there's
  no pickup/unlock moment for it, which undercuts the point of having a drop/pickup system if the
  second gun is just handed over for free. Worth deciding whether new guns should start as
  world pickups instead.
- **Reserve ammo defaults are partly guessed.** The Glock's starting reserve (51) wasn't specified
  and was picked to "feel roughly proportionate" — not validated by actual playtesting/balance.
- **A title exists ("Escape From Kise.") but no narrative/theme behind it.** No framing for who
  the player is, why the building is being attacked, what "Kise" refers to, or what the enemies
  are (they're referred to as "enemies"/"zombies" only in code comments, never in-game).
- **Single map, no variety.** One floor plan, no second area, no procedural variation.
- **No enemy variety in behavior**, only in speed/color — every enemy uses identical pathing/
  aggro logic with no ranged/ambush/group-tactic behavior.
- **Dropped-item geometry is duplicated per instance** (each `buildModel()` call creates fresh
  geometry rather than sharing it across instances of the same weapon) — a correctness non-issue
  today (disposed on pickup/reset) but worth revisiting if dropped items become numerous or
  long-lived.

---

## 9. Design Notes / Directives

> **This section is intentionally empty of pre-filled content.** Use it as a running log for
> your own freeform notes, ideas, and decisions as the design evolves — it's not something that
> needs to be "finished" or kept in sync with the code the way sections 1–8 are. Add dated
> entries below as you go.

*(nothing recorded yet)*

---

## 10. Changelog

- **2026-09-18** — Initial version, written by reading the current state of `index.html` in
  full (constants, `WEAPON_DEFS`, inventory/drop/pickup, wave manager, nav-grid A*, floor plan,
  UI/overlay structure). Reflects the pistol+Glock two-weapon roster, the reworked fast-enemy
  spawn schedule, the drop/pickup system, and the existing pause menu with the start-screen
  control list removed.
- **2026-09-18 (later same day)** — Pistol magazine corrected from 9+1 (10 max loaded) to 8+1
  (9 max loaded). Fists now melee on left-click (fire) as well as `V`, sharing the same cooldown.
- **2026-09-18 (later still)** — Added the title screen ("Escape From Kise.") and a three-tier
  difficulty system (Normal/Hard/Legendary), persisted via `localStorage`. Enemy speed/health and
  the wave/fast-enemy formulas are now read from a `DIFFICULTIES` config rather than being fixed
  constants — see §4's Difficulty system for the exact multipliers. `tauri.conf.json` gained
  `withGlobalTauri: true` and the `core:window:allow-close` capability so the title screen's Exit
  button can close the native window.
- **2026-09-18 (later still, correction)** — Hard/Legendary's enemy count formula corrected from
  `f(w) = 10 + 5(w-1)` to `f(w) = 10 + 5w`, matching Normal's own `w`-based (not `w-1`-based)
  convention.
- **2026-09-18 (later still, once more)** — Added the score system (§4: +10/evan kill,
  +100/+150/+200 round-clear bonus by difficulty, session high score shown on the title screen)
  and a pause-menu **Exit to Main Menu** button. Difficulty setup screen now lists what's harder
  about Hard/Legendary as bullet points under each option.
- **2026-09-18 (yet later still)** — Wave spawn-duration multiplier changed from `2` to `0.85`
  seconds per zombie (`WAVE_SPAWN_DURATION_MULTIPLIER` in the code) — waves now finish spawning
  much faster relative to their size (e.g. 100 zombies: 85s instead of 200s).
