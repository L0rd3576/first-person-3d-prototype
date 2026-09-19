# Game Design Document

**This document describes what is actually implemented in `index.html` as of the date below.**
It was written by reading the current code (constants, functions, and comments), not by
re-stating original feature requests — values get tuned after the fact, and this reflects
current tuning, not history. When this drifts out of sync with the code (and it will), trust
the code and re-sync this file.

---

## 1. Overview

A first-person, wave-based survival shooter titled **"Escape From Kise."** (per the title
screen — there's still no story/framing behind that name; see [Known Gaps](#9-known-gaps--open-design-questions)).
The player spawns inside a small single-building floor plan, fights off escalating waves of one
enemy type (plus a faster variant), and survives as long as possible, on one of three difficulty
levels chosen from a pre-game setup screen. There is currently no win condition.

**Platform / tech stack:**
- **Tauri 2 (Rust)** — native desktop window/shell, packaging. See `src-tauri/`.
- **Three.js r128** — 3D rendering, vendored locally at `vendor/three.min.js` (no CDN, no network dependency).
- **Web Audio API** — all sound effects, no `<audio>` elements. See §7.
- **Vanilla JS/HTML, single file** — the entire game lives in `index.html` at the project root
  (the source of truth). `scripts/sync-frontend.js` copies it (and `vendor/`) into `frontend/`,
  which is what Tauri actually bundles — `frontend/index.html` is a generated copy, never edited
  directly.
- No build step, no bundler, no external game-code dependencies.

---

## 2. Movement & Controls

**Every binding below is now rebindable**, not fixed — see the Controls screen in §8 (reached via
the Settings menu, itself reached from the title screen or pause menu). What follows is each
action's *default* key:

| Input (default) | Action |
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
| Scroll wheel | Cycle active weapon slot |
| `V` | Melee |
| `G` | Drop the active weapon slot's item |
| `F` | Pick up the nearest dropped item in range |
| `E` | Toggle the non-weapon item inventory (see §5) |
| `Esc` | Pause (releases pointer lock) |

Rebinding a key already assigned to another action **auto-unbinds it from that other action**
(no two actions can share a key). A **Reset to Defaults** button on the Controls screen restores
the table above. Bindings persist across launches via `localStorage`.

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
  `0.75s` cooldown after any slide ends before another can start. Plays a looping slide sound
  for the slide's whole duration, fading in/out rather than starting/stopping abruptly — see §7.
- **Jump:** initial upward velocity `7.0`, gravity `-18.0`/sec². Landing (not jumping) also
  immediately triggers the next footstep sound rather than waiting for movement distance to
  accumulate — see §7.
- **Aim down sights also reduces gun bob by 80%** (to 20% of its normal hip-fire amplitude),
  eased in/out over the same transition the ADS pose/FOV already use — see §3.
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
  factory returning `{ group, muzzleTip }`, a `recoil` config (see below), and an optional
  `sounds` map (`{ shot, reload, draw? }` — see §7; a weapon with no `sounds` entry at all, or
  missing a given event, is silent for that event rather than erroring).
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
| Reload duration | 2.4s (same for both) | 2.4s |
| View-model kick (visual) | pitch 0.09, kickback 0.05, recovers at rate 12 | pitch 0.06, kickback 0.035, recovers at rate 15 |
| Camera recoil (affects aim) | +0.028 rad pitch/shot, ±0.014 rad random yaw, recovers at rate 7 | +0.018 rad pitch/shot, ±0.009 rad random yaw, recovers at rate 9 |
| Shot sound | own recorded clip | own recorded clip |
| Reload sound | shared clip (same recording used by both guns) | shared clip |

The pistol's reload is a partial-clip design on purpose: reloading with a round still chambered
tops out at 8/9, not a full 9, since the clip itself only ever holds 7.

Both start equipped: slot 1 = pistol, slot 2 = Glock (there's no pickup/unlock gate on the
Glock — see §9).

### Firing

- Hitscan: an instant raycast from the camera through screen center. No bullet travel time.
- Hip-fire spread: ±0.044 rad (~2.5°) half-angle cone, sampled uniformly by area. Fully accurate
  (zero spread) while aiming down sights.
- **ADS:** hold right mouse button. Gun lerps toward a centered pose, FOV narrows from 75° to
  60°, both easing over 0.2s. Mouse sensitivity does *not* change while aiming. Gun bob from
  movement is also cut to 20% of normal while aiming (see §2), eased by the same transition.
- **Auto-reload:** firing an empty gun with reserve ammo left automatically starts a reload
  instead of dry-clicking (and plays the reload sound, not a dry-fire sound). Firing an empty
  gun with **no** reserve ammo left plays a distinct dry-fire click instead.
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
- No dedicated melee-impact sound exists yet (see §9).

### Damage reference

| Source | Damage | Hits to kill a base enemy (60 HP) |
|---|---|---|
| Pistol | 40 | 2 |
| Glock | 30 | 2 |
| Melee (either) | 25 | 3 |
| Enemy contact (per player, normal variant) | 10/tick, every 0.5s | — |
| Enemy contact (fast/"green" variant) | 30, once, self-destructs | — |

---

## 4. Enemies

- **One enemy archetype** with a faster variant, not multiple distinct enemy types.
- **Base stats:** 60 HP, speed `3.025` units/sec (~59% of player walk speed), person-sized box
  (`0.6 × 1.8 × 0.6`). Speed and size are each independently randomized ±1–5% per spawn (flavor,
  not wave-based scaling).
- **Fast ("green") variant:** same stats otherwise, but moves at **2.805×** the
  (already-randomized) base speed (`GREEN_ENEMY_SPEED_MULTIPLIER` — reduced from an original
  3.3× per tuning pass). Visually distinct (green body material vs. red). **Its attack is
  different in kind, not just speed:** instead of the normal enemy's repeated contact-tick
  damage, one contact detonates it for a single **30-damage hit**, destroying it in the process
  via the same "kill" pathway as any other death (score, ammo-drop chance, particles) — see
  `GREEN_ENEMY_EXPLOSION_DAMAGE` and the `isGreen` branch in `updateEnemies`. The explosion has
  its own particle burst (bigger/brighter/faster than a normal death, see §7) and its own sound
  effect, played unconditionally (**not** gated by the Gore setting — that setting only affects
  the gore/blood system described in §7).
- **Face texture:** every enemy gets a flat face plane glued to the front of its body, picked at
  spawn from `FACE_TEXTURE_DEFS` — 38 face images embedded as base64 data URIs (from
  `5 nights at kise/images/`), each with its own aspect ratio. `EVANSFACE_SPAWN_CHANCE` (85%)
  picks "evanface" (the default/majority face); the other 15% is a uniform random pick from the
  remaining 37. Several of these face images are also reused as backdrops for various UI screens
  (see §8) — that's purely a "we already have the asset decoded" convenience, unrelated to
  enemy spawning. Materials/geometries are cached per face key rather than rebuilt per spawn.
- **Contact damage:** normal variant deals 10 HP per tick, every 0.5s, while within contact range
  (which scales with that enemy's own randomized size); the fast/green variant instead deals its
  one-time 30-damage explosion (see above).
- **Knockback:** a fixed velocity impulse pushes the player away from the enemy on each contact tick
  (not applied on the green variant's self-destructing explosion contact).
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

  Separately, a **much simpler bounding-box "is this point inside the building" check**
  (`isInsideBuilding()`) now exists again too — but it has nothing to do with enemy pathfinding.
  It's used only for the concrete floor patch and footstep surface selection (see §6/§7). Don't
  confuse the two: pathfinding is pure A* with no notion of "inside/outside" at all; the
  inside/outside check is a separate, narrow-purpose helper for flooring/audio.
- **Spawning:**
  - 5 hand-placed spawn points ringing the building at its actual wall gaps/corners, plus 10 more
    procedurally placed on a ring outside the wall bounding box entirely (evenly spaced with a
    randomized phase per session). All spawners are validated clear of every wall collider at load.
  - A spawner within 10 units of the player is excluded from the random pool for that particular
    spawn (falls back to the full list if every spawner is somehow excluded at once).
  - **Wave sizing (Normal):** wave *N* spawns `8 + 4N` base enemies (capped at **100** —
    `MAX_ENEMIES_PER_WAVE`, raised from an original 50), staggered one at a time such that the
    time from the wave's first spawn to its last is exactly `(count) × 0.85` seconds (e.g. 100
    zombies takes 85 seconds to finish spawning — `WAVE_SPAWN_DURATION_MULTIPLIER` in the code).
    This formula, plus every other number in this section, is Normal's — see **Difficulty
    system** below for how Hard/Legendary change it.
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
  - **25%** chance per kill to drop an ammo pickup at the death position (reduced from an
    original 30% — see §5).

### Difficulty system

A per-difficulty config object (`DIFFICULTIES` in the code) that enemy-spawning/stat code reads
from — nothing scatters if-difficulty checks through that logic. Selected on the pre-game setup
screen (see §8), persisted across launches, defaults to Normal the very first time the game is
ever run.

| | Normal (baseline) | Hard | Legendary |
|---|---|---|---|
| Enemy speed | 1.0× (the `3.025` units/sec baseline above) | 1.15× | 1.30× (relative to Normal directly, not stacked on Hard's 1.15×) |
| Enemy health | 1.0× (60 HP) | 1.0× (60 HP) | 1.2× (72 HP) |
| Enemy count formula | `f(w) = 8 + 4w` | `f(w) = 10 + 5w` | same as Hard |
| Fast-enemy schedule | starts wave 3 (as above) | same shape, shifted 1 wave earlier (starts wave 2) | same as Hard |

The speed/health multipliers apply to *every* enemy including the fast variant (its own 2.805×
speed multiplier stacks on top of the difficulty multiplier, not instead of it). The wave-count
formula is capped at 100 regardless of difficulty, same as Normal.

### Score system

- **+10 points** for every enemy killed, any variant (`ENEMY_KILL_SCORE` in the code).
- **A per-difficulty bonus every time a wave is fully cleared:** +100 on Normal, +150 on Hard,
  +200 on Legendary (`DIFFICULTIES[id].roundClearScore` in the code — same data-driven object the
  rest of the difficulty system uses, not a separate hardcoded check).
- Current score is shown in the top-right HUD during play; resets to 0 at the start of every run
  (death+restart, or exiting to the main menu).
- **Session high score:** the best `currentScore` has reached across *any* run since the app was
  last launched, shown on the title screen's main panel (labeled simply "High Score" — an earlier
  "(this session)" qualifier was dropped from the label text, though the underlying behavior is
  unchanged: it is *not* persisted to `localStorage` and still resets to 0 on a fresh launch, by
  design — see §9 for the gap this leaves).

---

## 5. Items / Inventory

There are now **two separate inventory systems** — weapon slots (unchanged in shape from before)
and a newer non-weapon item inventory. They're independent: opening the item inventory does not
affect the equipped weapon, and vice versa.

### Weapon slots

- **2 slots.** Each holds either a weapon ID or is empty. An empty active slot means the player
  holds fists — two tan rectangular-prism forearm meshes — rather than a third "weapon." Melee
  still works with fists equipped (see §3).
- **Switching:** number keys (`1`/`2`) select a slot directly; scroll wheel cycles between them.
  Both always work, not either/or. Switching snaps the view model to the new pose instantly,
  cancels ADS, and cancels any in-progress melee swing. A reload in progress on a slot you
  switch away from *pauses* (doesn't keep advancing) until you switch back to it. Drawing a
  weapon (switching to it, or picking one up into the active slot) is wired to play a "draw"
  sound if the weapon def defines one — neither current weapon has one recorded yet, so this is
  presently silent (see §7/§9).
- **Ammo pickups:** small floating cubes, dropped at **25%** chance on enemy death (reduced from
  an original 30%), despawn after 60s if uncollected. Walking within 0.8 units collects one
  (+12 reserve rounds) and plays a pickup sound (at 85% of the clip's normal volume). Ammo goes
  to whichever gun is actually "in hand": the active slot if it holds a gun, or the other slot's
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
  a fresh weapon. Plays a pickup sound at full volume (distinct from the ammo pickup's reduced
  volume, even though it's the same underlying clip).
- **Current weapon roster:** Pistol and Glock (see §3). No other weapon types exist (no
  grenades/attachments/armor/keys/etc.).

### Non-weapon item inventory

- **8 slots**, toggled open/closed with `E` (`toggleInventory` keybind). Each slot is either
  empty or `{ itemId, quantity }`.
- **Real-time, not a real pause:** enemies keep moving/attacking while it's open — only player
  input (movement, look, firing) freezes. This is deliberately different from the pause menu,
  which does fully freeze the simulation (see §8).
- **Starting kit** (granted fresh on every run, via `resetGame`): 1 Bandages, 1 Rocks, 1 Planks,
  1 Cloth.
- **Item types** (`ITEM_DEFS`): Bandages (`healing` category), Rocks/Planks (`crafting`),
  Cloth (`misc`) — categories exist as data but **nothing currently consumes or crafts with any
  of these items**. They can be carried and picked up (dropped world items of `kind: "item"` add
  to a matching/under-cap stack, or a free slot) but have no functional effect yet. See §9.

---

## 6. Map / Environment

- **Ground plane:** a flat `130 × 130` unit grass-green platform, sky-blue background + matching
  fog (fades in from 40 units, fully opaque by 110). A grid helper overlays the whole platform
  for motion legibility.
- **Concrete floor patch:** the building's interior now gets its own gray ground plane instead of
  the grass showing through — sized to the same wall-derived bounding box `isInsideBuilding()`
  uses (see §4), sitting just above the grass (and below the grid helper, which still overlays
  both surfaces identically). The box is deliberately inset **0.5 units** past the exterior
  walls' traced centerlines (`BUILDING_INTERIOR_INSET`) — enough to swallow both the walls' own
  half-thickness and the floor plan's corner-welding slop, so no sliver of concrete peeks out
  past a wall's outside face. This same box is what footstep surface selection reads (see §7).
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
- There is exactly **one map/level** — no level select, no second area. There is now a real
  visual (concrete) and audible (footstep sound) distinction between inside and outside the
  building, but still no second area/level.

---

## 7. Audio & Visual Effects

The game was silent until this pass; it now has a full sound-effect layer plus a reworked
blood/particle system. Both are new sections of this document — there's no "before" to compare
numbers against except where explicitly noted.

### Audio system

- **Web Audio API**, not `<audio>` elements. One shared `AudioContext`, resumed on the first
  click anywhere (satisfies the browser's autoplay-gesture requirement) since it's otherwise
  constructed immediately at load.
- Every clip is a short WAV, trimmed of silence, downmixed to mono, embedded as a base64 data URI
  (`AUDIO_CLIP_DEFS`) — the same self-contained-single-file approach the enemy face textures use,
  and for the same reason (works opened directly via `file://`). All clips decode once at
  startup into cached `AudioBuffer`s.
- **One shared `masterGainNode`** sits between every sound and the destination — the Settings →
  Audio screen's Master Volume slider (0–100%, default 100, persisted) is the only thing that
  touches it, so every sound effect in the game is affected by one control.
- Per-clip playback (`playClip`/`playRandomClip`) supports an optional volume multiplier and a
  random pitch `detuneRange` (used for gunshots, so repeated fire doesn't sound identical).
- **What plays sound today:**
  - Pistol/Glock gunshots (own clips) and reload (one clip shared by both guns).
  - Dry-fire click, only when a trigger pull finds both the magazine *and* reserve empty.
  - Weapon draw — the hook exists (`playWeaponSound(def, "draw")`, called on weapon-switch and
    on picking a weapon into the active slot) but neither current weapon has a `draw` clip
    assigned, so this is currently silent (see §9).
  - Ammo pickup (85% volume) and weapon ground-pickup (100% volume) — same underlying clip, two
    different volumes.
  - Every menu button/back button and every mode-select/difficulty-select option (excluding
    disabled placeholder options) plays a click sound, via one delegated, capturing `document`
    click listener rather than a handler wired to each button individually.
  - **Footsteps** (see below).
  - **Slide**: a continuously looping clip for the slide's whole duration (built from a one-shot
    recording — see the audio folder's splitting notes — via a crossfade loop rather than a
    single natural loop point), fading in over 100ms on start and fading out over 100ms on end
    (whether the slide ends from its own decay or an early key release), via a `GainNode` ramp
    rather than an abrupt stop.
  - **Green-enemy explosion** (see §4) — its own dedicated sound, unconditional.
  - **Gore audio** (see below) — 10 clips, one picked at random per enemy death, gated by the
    Gore setting.

### Footsteps

- **Left/right alternation:** a single `steppingFoot` flag flips every time a step actually
  plays — no separate timer or gait simulation.
- **Surface:** grass or concrete, decided per-step by `isInsideBuilding()` (see §4/§6) at the
  player's current position.
- **Cadence is distance-based, not timer-based:** the player's actual post-wall-collision
  horizontal movement is accumulated each frame; once it crosses a threshold, the next step
  plays and the accumulator resets. This is what makes sprinting naturally produce a faster
  footstep rate than walking without any separate per-state timing logic. Thresholds (all
  user-tuned by ear, not derived from a formula): **2.8** units walking, **3.0** sprinting,
  **1.4** crouching (crouch is a fixed distance, not a fraction of the walk one, since crouch
  speed is much slower and a proportional distance made crouched steps sound too sparse).
- **Volume** also varies by movement state — crouch quietest, then walk, then sprint loudest —
  and separately by surface:

  | | Grass | Concrete |
  |---|---|---|
  | Crouch | 3% | 10% |
  | Walk | 5% | 20% |
  | Sprint | 8% | 25% |

- **No footsteps** while airborne, while standing still, or while sliding (a slide is a
  momentum-driven ground-scrape with its own looping sound, not a walking gait — see above).
- **Landing** from a jump plays the next due step immediately (and resets the distance
  accumulator) rather than waiting for movement distance to build back up after touching down.

### Particle bursts (muzzle flash, blood splash, death, explosion)

One shared, pooled system (`spawnParticleBurst`/`updateParticleBursts`) backs all four effects —
just different particle counts/colors/speeds/lifetimes per event, not separate systems. Rendered
as `THREE.Points` (native camera-facing point sprites, not literal quad geometry) using one
shared procedurally-generated soft radial-dot texture (`SOFT_DOT_TEXTURE`, a canvas gradient, no
external image asset) tinted per-event via each emitter's own `color`.

| Event | Particle count | Lifetime |
|---|---|---|
| Muzzle flash | 10 | 0.09s |
| On-hit blood splash | 8 | 0.5s |
| Enemy death | 24 (17 if the Gore setting is off — see below) | 0.6s |
| Green-enemy explosion | 30 | 0.6s |

All fade out via linearly-ramped opacity over their lifetime and drift under a per-event gravity
scale. **Emitters are pooled with a fixed hard cap** (`MAX_CONCURRENT_PARTICLE_BURSTS = 40`) —
once that many bursts are active at once, the *oldest* active burst's emitter is reused for the
newest one rather than ever allocating another; this replaced an earlier version of the pool that
had no such ceiling (it created a new GPU-backed emitter any time the pool was empty, with
nothing capping how many could ever exist).

### Blood pool decals

A flat, textured ground plane left at an enemy's death position — new addition, no equivalent
existed before. Reuses the same soft-dot texture as the particle system (tinted dark red), and a
single literally-shared `PlaneGeometry` (every decal's size/position/rotation lives on its own
mesh transform, not in vertex data). Pooled with the same fixed-cap, oldest-eviction pattern as
particle bursts (`MAX_CONCURRENT_BLOOD_DECALS = 20`).

- Size: randomized 0.8–1.4 units per instance; rotation: fully randomized per instance — so
  pools don't look identical.
- Lifetime: randomized **10–20 seconds** per instance, then fades out (linear opacity ramp) and
  is returned to the pool.
- Sits above the grass/concrete ground but below the grid helper, at every death position
  regardless of which surface it's on.
- **Gated entirely by the Gore setting** — see below.

### Gore setting

A new toggle (Settings → Game Settings → Gore), **off by default**, persisted across launches.
Gates three things, all at the moment an enemy dies:
1. **Blood pool decal:** spawns only when Gore is on; not spawned at all when off.
2. **Death particle count:** cut by 30% when Gore is off (24 → ~17; the green explosion burst is
   *not* affected — that one is the enemy's own attack effect, not "gore").
3. **Gore audio:** only plays when Gore is on. When it fires, one of 10 clips is picked at random
   and played with **distance-based volume** from the camera to the death position — full
   volume within 4 units, linearly quieter out to 25 units, and **not played at all** (rather
   than played at volume 0) beyond that, so a death far across the map can be inaudible, per
   spec. On top of that distance falloff, all 10 clips are also scaled to 85% of their normal
   level. This is a simple distance-only falloff, not full 3D positional/panned audio — see §9.

---

## 8. UI / UX

- **Title screen** (`#title-screen`, shown first, above everything else): full-screen background
  is the same enemy face image the 3D face texture uses (stretched via `object-fit: cover`,
  blurred + darkened for legibility), heading "Escape From Kise.", three buttons: **Play**
  (opens the mode-select screen below), **Settings** (see below), **Exit** (closes the native
  window via Tauri's window-close API, exposed through the `window.__TAURI__` global — enabled
  via `withGlobalTauri` in `tauri.conf.json` plus an explicit `core:window:allow-close`
  capability, since neither is granted by Tauri's default permission set). Also shows the session
  high score (see §4's Score system) below the heading.
- **Mode-select screen** (reached via Play): **Singleplayer** (the only wired-up option, proceeds
  to the difficulty screen below), **Co-op** and **Custom** shown as disabled placeholders for
  modes that don't exist yet. A corner **Back** button returns to the title screen's main panel.
- **Difficulty setup screen** (reached via Singleplayer): a difficulty selector — **Normal** /
  **Hard** / **Legendary**, single-select, the active one visually highlighted — plus a **Start**
  button that begins the run on whichever difficulty is currently selected, and a **Back** button
  that returns to the mode-select screen. Hard and Legendary each list what's harder about them
  as bullet points under the option (Hard: "More enemies", "Faster enemies"; Legendary: "More
  enemies", "Fastest enemies", "Enemies have more health"); Normal has none. Defaults to Normal
  the very first time the game is ever run; after that, the last-selected difficulty is
  remembered via `localStorage` and pre-selected on every subsequent launch. See §4's Difficulty
  system for what each option actually changes.
- **Settings menu** (reached from the title screen's main panel *or* the in-game pause menu —
  both now show a **Settings** button where they used to show **Controls** directly): a hub with
  three destinations, stacked vertically — **Controls**, **Audio**, **Game Settings** — plus a
  **Back** button that returns to wherever Settings was opened from (title or pause). Controls,
  Audio, and Game Settings all live one level under Settings and always return to it directly
  (not to title/pause) when backed out of.
  - **Controls:** the key-binding list, now **rebindable** (click a bound key, then press any
    key to reassign it — see §2), plus a **Reset to Defaults** button. Backdrop: "haugensface".
  - **Audio:** a single Master Volume slider (0–100%, see §7). Backdrop: "austinsface".
  - **Game Settings:** the Gore toggle (see §7), an on/off slider-style switch, off by default.
    Backdrop: "chasesface".
  - The Settings hub screen itself uses "falconsface" as its backdrop. (All four backdrops reuse
    existing enemy face texture data — see §4 — purely as a decorative/self-contained asset
    choice, unrelated to which face an enemy actually spawns with.)
- **HUD (during play):**
  - Top-center: current wave number, or a countdown to the next wave during the grace period.
  - Top-right: current score (see §4's Score system).
  - Bottom-left: health label + color-shifting bar (green → yellow → red as it drops).
  - Bottom-right: loaded/reserve ammo counter — automatically hidden entirely when fists are
    equipped (no ammo to show).
  - Center: a small crosshair dot, plus a brief red "X" hit marker flash (0.2s) on a confirmed
    hit (gunfire or melee).
- **Item inventory panel** (`E` to toggle, see §5): a separate on-screen panel, centered, showing
  8 slots. Unlike the pause menu, opening it does **not** freeze the simulation — enemies keep
  acting; only player input freezes.
- **Start screen:** minimal "Click to play" prompt.
- **Pause menu:** triggered whenever pointer lock is lost while alive (Esc, alt-tab, or any other
  browser-driven unlock) — **does** fully freeze the whole simulation (waves, enemies, reload/
  aim/recoil/melee timers, ammo pickups, dropped-item physics, item-inventory state), unlike the
  item inventory panel above. Buttons, now stacked vertically: **Resume** (re-locks the pointer),
  **Settings** (see above), and **Exit to Main Menu** (ends the current run — same full reset as
  the death screen's Restart, including the score, but returns to the title screen instead of
  dropping straight back into a new round).
- **Death screen:** full-screen red overlay, "YOU DIED", a **Restart** button that fully resets
  run state (health, both weapon slots back to fresh pistol+Glock, item inventory back to its
  starting kit, position, wave counter back to pre-wave-1, all enemies/pickups/dropped
  items/particle bursts/blood decals cleared) and immediately re-requests pointer lock, plus a
  **Main Menu** button doing the same full reset but returning to the title screen's main panel
  instead (mirrors the pause menu's own Exit to Main Menu button above).
- Still no minimap, no objective marker, no graphics options.

---

## 9. Known Gaps / Open Design Questions

Being direct about the distance between "a collection of working mechanics" and "a complete game":

- **No win condition.** Waves escalate forever (`8 + 4N` zombies, capped at 100; `N - 1` fast
  enemies from wave 5 on, uncapped wave number) with no ending, no boss, no "you survived" state
  — the only way a run ends is death.
- **Score exists, but no run summary and no cross-launch persistence.** There's a live score
  (see §4) and a session high score shown on the title screen, but there's still no death-screen
  recap ("you scored 340, reached wave 7"), no leaderboard, and — deliberately, per how it was
  asked for — the high score resets to 0 every time the app is relaunched rather than being
  remembered long-term the way the difficulty choice and key bindings are. Worth deciding whether
  that's the intended final behavior or just where this stopped for now.
- **No health recovery of any kind.** No regen, no health pickups/kits — only ammo drops exist.
  Bandages exist in the item inventory (see §5) with a `healing` category tag but currently do
  nothing when held. Once damaged, the only way to reset health is a full death+restart.
- **The non-weapon item inventory is inert.** Bandages/Rocks/Planks/Cloth can be carried, picked
  up, and stacked, but nothing in the game currently consumes, crafts with, or otherwise uses any
  of them — the system exists (slots, stacking, drop/pickup, its own toggleable panel) but has no
  gameplay effect yet.
- **Single enemy archetype.** "Fast enemy" is a speed/color/attack-behavior variant of the same
  mesh and AI, not a distinct enemy type — no ranged enemies, no special attacks beyond the one
  explosion behavior, no boss waves.
- **Gore audio is distance-attenuated, not truly positional.** `playGoreAudioAt` scales volume by
  straight-line distance from the camera (with a hard cutoff beyond which it doesn't play at all)
  but has no stereo panning or directionality — a death to the player's left and one an equal
  distance to their right sound identical. Every other sound effect in the game is fully
  non-positional (played at a flat volume regardless of world position); gore audio is the only
  exception, and only partially.
- **Several tuned numbers are flagged guesses, not measured/balanced values** — worth a real
  playtesting pass rather than trusting them as final: footstep step-distances/volumes (chosen by
  ear), the particle-burst/blood-decal pool caps (40 and 20 — generous estimates, not stress-
  tested at a genuinely high wave count), the gore-audio reference/max distances (4 and 25 units),
  and the Glock's starting reserve ammo (51, never specified up front).
- **No weapon draw/holster sound.** The code path exists (`playWeaponSound(def, "draw")`, wired
  to weapon-switch and pickup-into-active-slot) but neither the pistol nor the Glock has a `draw`
  clip assigned, so switching weapons is silent.
- **No melee-impact sound.** Gunfire, reload, footsteps, pickups, menu actions, sliding, and
  enemy deaths all have audio; a melee hit landing does not.
- **Glock has no acquisition gate.** It starts equipped in slot 2 from the very beginning — there's
  no pickup/unlock moment for it, which undercuts the point of having a drop/pickup system if the
  second gun is just handed over for free. Worth deciding whether new guns should start as
  world pickups instead.
- **A title exists ("Escape From Kise.") but no narrative/theme behind it.** No framing for who
  the player is, why the building is being attacked, what "Kise" refers to, or what the enemies
  are (they're referred to as "enemies"/"zombies" only in code comments, never in-game).
- **Single map, no variety.** One floor plan, no second area, no procedural variation. The
  building now has a visually/audibly distinct interior (concrete floor, different footstep
  sound) but it's still the same one building.
- **No enemy variety in behavior beyond the one green-variant explosion**, every enemy otherwise
  uses identical pathing/aggro logic with no ranged/ambush/group-tactic behavior.
- **Dropped-item geometry is duplicated per instance** (each `buildModel()` call creates fresh
  geometry rather than sharing it across instances of the same weapon) — a correctness non-issue
  today (disposed on pickup/reset) but worth revisiting if dropped items become numerous or
  long-lived.

---

## 10. Design Notes / Directives

> **This section is intentionally empty of pre-filled content.** Use it as a running log for
> your own freeform notes, ideas, and decisions as the design evolves — it's not something that
> needs to be "finished" or kept in sync with the code the way sections 1–9 are. Add dated
> entries below as you go.

*(nothing recorded yet)*

---

## 11. Changelog

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
- **2026-09-18 (later still, once more)** — Added the score system (§4: +10/enemy kill,
  +100/+150/+200 round-clear bonus by difficulty, session high score shown on the title screen)
  and a pause-menu **Exit to Main Menu** button. Difficulty setup screen now lists what's harder
  about Hard/Legendary as bullet points under each option.
- **2026-09-18 (yet later still)** — Wave spawn-duration multiplier changed from `2` to `0.85`
  seconds per zombie (`WAVE_SPAWN_DURATION_MULTIPLIER` in the code) — waves now finish spawning
  much faster relative to their size (e.g. 100 zombies: 85s instead of 200s).
- **2026-09-18 (yet later still, once more)** — Added a **Back** button to the difficulty setup
  screen. Performance pass: enemy raycast target list is now a persistent array instead of a
  `.map()` allocation per shot/melee swing, the sun shadow map shrank from 2048² `PCFSoftShadowMap`
  at a ±60 frustum to 1024² `PCFShadowMap` at ±30, enemy line-of-sight checks are throttled
  instead of running every frame, particle bursts (muzzle flash/blood/death) are pooled instead of
  created and disposed per spawn, and the wave HUD text element is only touched when its displayed
  value actually changes. Added a multi-face enemy system: 38 face images embedded as base64 data
  URIs, picked per spawn (85% evanface / 15% random other face — see §4's Face texture entry).
  Score now awards +10 for every enemy kill (previously fast/"green" kills only). Death screen
  gained a **Main Menu** button alongside Restart (see §8's Death screen entry).
- **2026-09-19** — Large pass covering rebindable keybinds, a second inventory system, mode
  select, and the game's first audio + reworked visual-effects layer. Specifically:
  - **Controls became rebindable** (click-to-rebind, auto-unbind on conflict, Reset to Defaults,
    persisted) — previously view-only.
  - **Added the non-weapon item inventory** (8 slots, `E` to toggle, real-time/non-pausing) with
    four placeholder item types, none yet functional (see §9).
  - **Added the mode-select screen** (Singleplayer wired up; Co-op/Custom shown disabled) between
    the title screen and the difficulty screen.
  - **Restructured Controls access into a Settings hub** (Controls / Audio / Game Settings /
    Back), reachable from both the title screen and the pause menu, replacing their previous
    direct Controls buttons. Pause menu buttons switched to a vertical stack.
  - **Added the entire audio system** (§7): Web Audio API, master volume control, gunshot/reload/
    dry-fire/pickup/menu-click/footstep/slide-loop/gore sound effects.
  - **Reworked the particle-burst system**: added a shared procedural soft-dot texture (particles
    were flat hard-edged dots before), fixed unbounded emitter growth with a hard 40-burst cap
    and oldest-eviction, shortened death-burst lifetimes to match hit-splatter's "don't linger."
  - **Added blood pool decals** (§7) — a persistent, pooled, capped ground-stain system that did
    not exist before, gated by a new **Gore setting** (off by default) that also trims death
    particle counts 30% and gates gore audio when off.
  - **Added a concrete floor patch** inside the building interior (§6), and with it a new,
    narrow-purpose `isInsideBuilding()` bounding-box check (unrelated to and not a replacement
    for the A* pathfinding system).
  - **Green ("fast") enemy reworked**: speed multiplier reduced from 3.3× to 2.805×, and its
    attack changed from repeated contact-tick damage to a single 30-damage self-destructing
    explosion with its own particle/sound effects.
  - **Balance/tuning changes**: ammo drop chance 30% → 25%; `MAX_ENEMIES_PER_WAVE` 50 → 100; both
    weapons' reload duration 1.5s → 2.4s; aiming down sights now cuts gun bob by 80%.
  - Session high score label simplified (dropped the "(this session)" qualifier from the
    displayed text only; underlying non-persistence is unchanged).
