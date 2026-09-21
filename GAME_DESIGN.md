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
- **Mouse look:** base sensitivity `0.0022` rad/pixel (`MOUSE_SENSITIVITY_BASE`), pitch clamped to
  just under straight up/down. Camera rotation is computed once per frame
  (`applyCameraRotation`), combining the player's own aim with the current recoil offset (see §3)
  — mouse movement itself only updates the underlying yaw/pitch, never writes to the camera
  directly.
- **Look sensitivity sliders (Controls screen):** one for mouse look, one for the joystick, each
  0–100%, **default 50%** (= 1× the base values above — `MOUSE_SENSITIVITY_BASE`/
  `GAMEPAD_LOOK_SENSITIVITY_BASE`, the joystick's own base being `3.0` rad/sec at full
  deflection), shown at the top of their respective Controls tab. They're independent, not
  locked together — a keyboard+mouse P1 and a controller P2 in the same co-op match can run
  different values; only one controller slider exists for now, so two controller players in one
  match would currently share it. The controller slider's thumb is styled as a plain circle
  (matching the rebind-chip look) rather than the browser's default; while it's the
  stick-selected row on that tab, holding the stick left/right adjusts it *continuously* (rate
  proportional to how far past the deadzone it's pushed, `SLIDER_STICK_RATE_PERCENT_PER_SECOND =
  30`/sec at full deflection) rather than needing a push/release per nudge.
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
| Reload duration | 2.25s (same for both — tuned down from 2.4s) | 2.25s |
| View-model kick (visual) | pitch 0.09, kickback 0.05, recovers at rate 12 | pitch 0.06, kickback 0.035, recovers at rate 15 |
| Camera recoil (affects aim) | +0.028 rad pitch/shot, ±0.014 rad random yaw, recovers at rate 7 | +0.018 rad pitch/shot, ±0.009 rad random yaw, recovers at rate 9 |
| Shot sound | own recorded clip | own recorded clip |
| Reload sound | shared clip (same recording used by both guns) | shared clip |

The pistol's reload is a partial-clip design on purpose: reloading with a round still chambered
tops out at 8/9, not a full 9, since the clip itself only ever holds 7 — but see **Ammo Mode**
below, which changes this entirely under "Easy."

Both start equipped: slot 1 = pistol, slot 2 = Glock (there's no pickup/unlock gate on the
Glock — see §9).

### Ammo Mode setting (Realistic / Easy)

A Settings → Game Settings toggle (`ammoMode`, persisted, **defaults to Easy**) that changes how
reloading itself works, independent of the per-weapon stats above:

- **Realistic** (the original, always-existing behavior described above and in the roster table):
  a reload is a full magazine swap. It draws `magazineCapacity` rounds from reserve (or whatever's
  left, if less) and adds a chambered round on top if one was already loaded going in — so the
  pistol's partial-clip quirk (topping out at 8/9, never a full 9 via reloading) only applies
  under this mode. Any rounds left in the old magazine are discarded, not banked back.
- **Easy** (early-Call-of-Duty style, and the default): no chambered-round mechanic at all. A
  reload just tops the magazine up to its own capacity, drawing only the exact difference between
  capacity and whatever's currently loaded — nothing is ever wasted, and the practical "full"
  loadout is `magazineCapacity` (not `maxLoadedAmmo`, which only ever matters under Realistic).
  Starting/fresh-spawn ammo (`createWeaponSlotState`) also respects whichever mode is active, via
  a shared `getMaxLoadedAmmo(gunStats)` helper both reload and spawn read.

**Aiming down sights is blocked while the active slot is mid-reload** (recomputed every frame in
`updateAim`, same as the sprint/no-gun checks already there — holding aim through a reload's end
resumes ADS automatically the instant it finishes, no extra state needed).

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
  spawn from `FACE_TEXTURE_DEFS` — 44 face images embedded as base64 data URIs (from
  `5 nights at kise/images/`), each with its own aspect ratio. `EVANSFACE_SPAWN_CHANCE` (85%)
  picks "evanface" (the default/majority face); the other 15% is a uniform random pick from the
  remaining 43. Several of these face images are also reused as backdrops for various UI screens
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

There are **two separate inventory systems** — weapon slots (unchanged in shape from before) and a
non-weapon item inventory. They're independent: opening the item inventory does not affect the
equipped weapon, and vice versa.

The non-weapon item inventory (`INVENTORY_SYSTEM_ENABLED = true`, gating its one open path,
`toggleInventory()`) is fully live again as of 2026-09-21, including in co-op: each player now has
their own fully separate item inventory — own 8 slots, own panel (positioned on their own half of
the split screen), own cursor (real mouse for a keyboard+mouse player, left-stick-driven for a
controller player, Right Trigger to click/drag), and own drag state. A drag/drop can never cross
into the other player's grid or panel, and one player's inventory being open no longer freezes the
other player or affects their gameplay.

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
  blurred + darkened for legibility), heading **"PROTECT KISE"** (renamed from "Escape From
  Kise.", now all-caps with no period, set in Impact — a bold condensed display face, web-safe/
  pre-installed on Windows so there's no font file to bundle or network fetch to depend on —
  instead of the plain sans-serif every other screen uses), three buttons: **Play** (opens the
  mode-select screen below), **Settings** (see below), **Exit** (closes the native window via
  Tauri's window-close API, exposed through the `window.__TAURI__` global — enabled via
  `withGlobalTauri` in `tauri.conf.json` plus an explicit `core:window:allow-close` capability,
  since neither is granted by Tauri's default permission set). Also shows the session high score
  (see §4's Score system) below the heading.
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
    Has separate Keyboard + Mouse / Controller tabs — see the Controller navigation entry below
    for how rebinding a gamepad chip and navigating the whole screen with a controller work.
  - **Audio:** a single Master Volume slider (0–100%, see §7). Backdrop: "austinsface".
  - **Game Settings:** **Ammo** (Realistic/Easy — see §3), the Gore toggle (see §7, an on/off
    slider-style switch, off by default), and a Fullscreen toggle (same switch style, reflects/
    drives the native Tauri window's actual fullscreen state on load and on toggle, falling back
    to the browser Fullscreen API if opened outside Tauri). Backdrop: "chasesface".
  - The Settings hub screen itself uses "falconsface" as its backdrop. (All four backdrops reuse
    existing enemy face texture data — see §4 — purely as a decorative/self-contained asset
    choice, unrelated to which face an enemy actually spawns with.)
- **Controller navigation (menus):** a connected controller can now drive almost every menu
  screen, not just gameplay — built up over several passes this session, **not yet re-verified
  as a whole by the user after the latest fixes** (see §10's 2026-09-20 entry for the exact bugs
  found/fixed along the way). Two systems cover it:
  - **`pollGenericMenuNav`** — a generic up/down-highlight-and-activate system covering every
    static menu screen that doesn't have its own bespoke flow: the title screen's main panel and
    mode-select, Settings/Audio/Game Settings, the pause menu, and the death screen. Left stick
    up/down moves a gold-outlined highlight (`.menu-nav-selected`) through that screen's options,
    **wrapping around** end-to-end (so a screen whose Back button is drawn at the top but listed
    last in nav order is still reachable by pressing up from the default selection, not just down
    past everything else); it plays the same click sound a mouse would when the selection actually
    moves. Square (`CONTROLS_NAV_REBIND_BUTTON_INDEX`, reused here as the general "confirm/
    activate" button) does a real `.click()` on whatever's highlighted, so it reuses each button's
    existing logic/sound exactly rather than duplicating it — this is also how "Exit" on the title
    screen's main panel actually closes the app via a controller (Tauri's window-close call
    doesn't care whether the click that triggered it was a real mouse click or a synthetic one).
    Left/right instead continuously adjusts the current stop if it's a slider (Audio's Master
    Volume) — see §2's sensitivity-slider entry for the same continuous-hold mechanic. Game
    Settings' Ammo Mode toggle is a discrete left/right **stepper** instead, not a slider: its two
    options (Realistic/Easy) share one highlight stop (`.ammo-mode-options`, the wrapping element,
    not the individual option chips) and a single left/right push steps between them and clicks
    the target option, same edge-triggered feel as the difficulty screens' own stepping rather than
    the slider's continuously-driven value.
  - **Bespoke per-screen flows** (unchanged in kind from the existing setup-screen/Controls-chart
    navigation, extended this pass): the singleplayer difficulty screen now auto-switches its
    scheme to Controller the instant *any* controller input is detected (previously required a
    manual click), same as the Controls screen auto-switching from its Keyboard + Mouse tab to
    its Controller tab on any stick movement. Co-op's own setup screen gained left-stick
    difficulty stepping (shares `stepDifficulty`/`currentDifficulty` with singleplayer's own
    setup screen — there's still only one difficulty setting, not a separate co-op one), which
    also now plays the same "moved onto" click sound a mouse selection does. On the Controls
    screen's own chart, Square also now rebinds the Back/Reset to Defaults buttons at the very
    bottom of the list (previously mouse-only), and holding left/right on the Sensitivity row
    continuously adjusts it instead of one discrete nudge per push (see §2).
  - **X = Back everywhere except the title screen's own main panel** (`CONTROLLER_BACK_BUTTON_INDEX
    = 0`, `pollControllerBackButton`): works on mode-select, both setup screens, the Controls
    screen (either tab), Settings, Audio, Game Settings, and Pause (maps to Resume there, since
    Pause has no literal "Back" — resuming closes the menu, which is the equivalent action).
    Disabled entirely while either rebind flow is actively listening for a key/button, so X can
    still be bound to something (or read as "X" in the chart) without being hijacked as a menu
    key.
  - **Cursor hiding is now generalized past the singleplayer setup screen it started on:** any
    controller stick/button activity on a menu screen hides the real OS cursor
    (`setCursorHidden`); any real mouse movement *or click* brings it back
    (`isAnyMenuScreenVisible`'s two listeners) — this now also covers the co-op setup screen and
    the Controls screen, which previously had no cursor-hiding at all.
  - **A specific, now-fixed bug class worth remembering:** switching screens via a Square/X press
    used to reset the "was this button currently held" edge-detection flag as part of entering
    the new screen — so the *same still-held* press immediately re-triggered against the new
    screen's first item (e.g. pressing Square to select Play on the title screen would land on
    Mode Select and instantly "select" Singleplayer too, before the button was ever released).
    Fixed by never resetting those flags on a screen change; they now only ever reflect whether
    the physical button is currently down, checked continuously across every poll regardless of
    what's on screen.
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

- **No win condition — confirmed as the intended design, not an open gap.** Waves escalate forever
  (`8 + 4N` zombies, capped at 100; `N - 1` fast enemies from wave 5 on, uncapped wave number) with
  no ending, no boss, no "you survived" state; the only way a run ends is death. "Survive as long
  as possible, together" (co-op) or solo is the design, per explicit user decision — not something
  to revisit unless asked.
- **Score exists, but no run summary and no cross-launch persistence.** There's a live score
  (see §4) and a session high score shown on the title screen, but there's still no death-screen
  recap ("you scored 340, reached wave 7"), no leaderboard, and — deliberately, per how it was
  asked for — the high score resets to 0 every time the app is relaunched rather than being
  remembered long-term the way the difficulty choice and key bindings are. Worth deciding whether
  that's the intended final behavior or just where this stopped for now.
- **No health recovery of any kind.** No regen, no health pickups/kits — only ammo drops exist.
  Bandages exist in the item inventory (see §5) with a `healing` category tag but currently do
  nothing when held. Once damaged, the only way to reset health is a full death+restart.
- **The non-weapon item inventory is temporarily disabled entirely** (`INVENTORY_SYSTEM_ENABLED =
  false` in `index.html`, set 2026-09-19 by explicit request — see §10) on top of already being
  inert: even before being switched off, Bandages/Rocks/Planks/Cloth could be carried, picked up,
  and stacked, but nothing in the game consumed, crafted with, or otherwise used any of them — the
  system exists (slots, stacking, drop/pickup, its own toggleable panel) but has no gameplay effect
  and currently can't even be opened. It's also still only ever a single shared, P1-only panel in
  co-op — P2 has no way to use it even once re-enabled.
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
- **No weapon draw/holster sound.** Switching weapons (`switchToSlot`) is deliberately silent as
  of 2026-09-19 (explicit request — see §10), not just missing a clip. Picking a weapon up into
  the active slot (`tryPickUpNearbyItem`) still calls `playWeaponSound(def, "draw")`, but neither
  the pistol nor the Glock has a `draw` clip assigned, so that path is silent too, just not on
  purpose.
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

### 2026-09-19 — Split-screen co-op + audio system rework (in progress)

None of §1–9 reflect this work yet except where a progress note below says otherwise — this
section is the running source of truth for it until it's done, at which point it moves into the
numbered sections and gets a real changelog entry.

**Progress:**
- **Part 1 Step 1 (input abstraction) — done, user-verified in a real playtest.**
  `createKeyboardMouseInputSource`/`createGamepadInputSource` (~line 4610 area) replace the old
  bare `heldKeys`/`isActionHeld` globals and every raw keydown/mousedown-driven gameplay action
  (jump, slide-tap, reload, weapon-switch, melee, drop, interact, toggle-inventory, fire, aim).
  Only the keyboard+mouse instance (`inputSources[0]`) actually drives the (still singular)
  player; the gamepad implementation is structurally complete against the Standard Gamepad
  Mapping but wasn't exercised by real hardware in that pass. A full-file sweep found zero
  remaining references to the old singleton input state outside the new abstraction.
- **Part 1 Step 2 (co-op setup screen) — built, revised once per feedback, still not yet
  user-verified.** New `#title-coop-setup` screen, reached directly from the mode-select screen's
  Co-op option (bypassing `title-setup` entirely -- singleplayer's own difficulty screen is
  untouched and unchanged). Co-op's difficulty selection instead lives on this same combined
  screen, below the player-setup row (`#coop-difficulty-options`, sharing `.difficulty-option`/
  `currentDifficulty`/`updateDifficultyOptionButtons` with `title-setup`'s copy -- mouse-only,
  same as it always was, no keyboard/gamepad path was ever built for it). A vertical divider
  splits Player 1 (left) from Player 2 (right) -- fixed, not user-configurable. Background is
  `landersface` via a per-panel bg-image/tint pair, same pattern the pause-overlay panels use.
  Player 1 defaults to keyboard+mouse with a Controller switch; Player 2 is always controller (the
  only two valid configs per spec are one-KB+M-plus-one-controller or both-controller, so P2 never
  gets a scheme choice of its own). Both sides show a fixed-size (`.coop-setup-box`, width AND
  min-height locked) icon swapped between the two user-supplied PNGs (keyboard+mouse /
  controller, embedded as base64 same as every other image asset) via `<img>.src`, never
  hidden/shown, so switching P1's scheme never resizes the box. Ready-up (Enter for P1 on KB+M,
  X/button-index-2 on Standard Mapping for controller, toggleable), both-ready triggers a
  5-second countdown, either un-readying or a mid-setup gamepad disconnect cancels it. This is the
  *first* real exercise of the Gamepad API in this project (raw polling for connection-detection +
  the ready button) — genuinely untested against physical hardware so far. Deliberately does NOT
  create real `createGamepadInputSource()` instances for the players it detects here; it only
  remembers which raw gamepad index belongs to which player. Countdown completion currently just
  logs to console and resets both players to
  unready (`beginCoopMatch`'s stub) rather than starting a real match — that hookup is Step 3/4's
  job, once real dual-player gameplay state exists to attach it to.
- **Part 1 Step 3 (singleton audit, first slice: movement + look + health) — built, not yet
  user-verified.** `createPlayer(cam, input)` (see SCENE / RENDERER / CAMERA SETUP) is the real
  per-player object the whole step threads through: camera, its own InputSource, velocity/
  verticalVelocity/isGrounded/jumpOffset/currentEyeHeight/isSliding/slideElapsed/slideCooldown/
  isSprinting, footstep cadence (footstepDistanceSinceLastStep/steppingFoot), yaw/pitch/camera
  recoil offsets, health/isDead, and a frozen-state tracker for the slide-loop mute fix. `players[0]`
  reuses the *same* camera object every other still-singular system (enemies, footsteps'
  isInsideBuilding check, sunLight, raycasting, HUD) already reads directly, so none of those needed
  touching this pass. `players[1]` is a genuinely new second camera + player, fully real and
  independently mutable, but nothing drives it through the per-frame update functions yet — there's
  no real entry point into dual gameplay until a later step actually starts a co-op match, so it
  exists and is structurally verified (see below) rather than live-exercised.
  `updateMovement`/`updateFootsteps`/`playFootstepSound`/`endSlide`/`tryStartSlide`/
  `applyCameraRotation`/`takeDamage`/`triggerDeath`/`updateHealthUI` are now genuinely
  player-parameterized (callable for either player); `onMouseMove` stays hardcoded to `players[0]`
  on purpose (mouse-look was deliberately not unified through the InputSource abstraction in Step 1
  either — same reasoning, see its own comment). Necessary cross-references this pulled in outside
  the "movement/look/health" boundary itself: `updateEnemies`' isSliding-cancels-slide check and its
  two `takeDamage` call sites, the slide-loop mute/resume block in `animate()`, `updateAim`'s
  isSprinting read, and `updateGunBob`/`applyRecoil`/`updateRecoil`'s reads of velocity/isGrounded/
  camera-recoil-offsets — all hardcoded to `players[0]` since the functions that *own* them
  (weapon/melee/gun-bob) aren't parameterized yet. Weapon/inventory/melee/gun-bob/aim-progress/
  reload-tilt/item-inventory and their HUD (ammo counts, per-player HUD DOM generally) are
  deliberately **not** part of this slice — still bare globals, implicitly "player 1's" — that's the
  next slice of this same audit. Full-file sweep of all 17 migrated field names plus a check for
  leftover bare declarations found and fixed every stray reference (including two the first sweep
  pass missed: the scroll-wheel weapon-cycle listener and `updateWaveManager`'s death-pause check,
  both still reading bare `isDead`) before landing on zero remaining.
- **Part 1 Step 3 (singleton audit, second slice: weapon/inventory/aim/melee/gun-bob) — built, not
  yet user-verified.** Extends `createPlayer` with a full weapon rig: each player now gets their
  own real set of view-model meshes (`buildPlayerGunRig`, called once per player, reusing the
  existing `buildPistolViewModel`/`buildGlockViewModel`/`buildFistsViewModel`/`WEAPON_DEFS` — not
  redefined) parented under their own `viewModelRoot`/camera, not a shared set — needed so
  `getActiveMuzzleTip` and `applyGunTransform` have something valid to point at for player 2 too,
  even though only player 1 is rendered. Also moved: weapon inventory (`inventorySlots`/
  `activeSlotIndex`), aim/ADS (`isAiming`/`aimProgress`/`activeHipFirePosition` etc./
  `gunAdsPosition` etc.), the gun-transform layering numbers (reload tilt, gun-side recoil, bob,
  melee offset), melee state, hit-marker timer, and the non-weapon item inventory's own 8 slots.
  `getActiveSlot`/`getActiveWeaponDef`/`getActiveMuzzleTip`/`setActiveViewModel`/`switchToSlot`/
  `cycleActiveSlot`/`fireWeapon`/`applyHipFireSpread`/`tryReload`/`updateReload`/`updateAim`/
  `applyRecoil`/`updateRecoil`/`performMelee`/`endMeleeSwing`/`updateMelee`/`updateGunBob`/
  `updateAmmoUI`/`showHitMarker`/`updateHitMarker`/`addItemToInventory`/`resetItemInventory` are
  all now player-parameterized; every call site (dispatch, `resetGame`, `animate()`, the ammo-pickup
  and dropped-item-pickup paths) threads `players[0]` through. The item-inventory *panel's*
  rendering/drag-drop functions (`renderInventoryPanel`/`beginSlotDrag`/its mouseup handler)
  deliberately stay hardcoded to `players[0]` rather than taking a parameter — there's only one
  panel DOM element, same "singular HUD until Step 4" reasoning as `updateHealthUI`/`updateAmmoUI`.
  `isInventoryOpen`/`slotDragState` stay outside the player object entirely for the same reason.
  Two ordering fixes this slice needed: `resetItemInventory`'s initial starting-kit grant used to
  run at top-level script load, before `players` existed — moved to the final startup-calls cluster
  near `animate()`, alongside `updateHealthUI(players[0])`/`setActiveViewModel(players[0])`, which
  were already there for the identical reason. Full-file sweep of all 22 newly-migrated field/
  function names (on top of the first slice's 17) plus a check for leftover bare declarations found
  one more stray the mechanical pass introduced (`onPointerLockChange`'s `isAiming = false`) before
  landing on zero remaining across all 39 fields total.
- **Part 1 Step 4, Slice A (live two-player co-op loop, still single-camera) — built, not yet
  user-verified.** `startCoopMatch()` replaces the old stub: assigns each player a real
  `InputSource` (P1: `inputSources[0]` if keyboard+mouse, or their own persistent
  `player1GamepadInputSource` bound to `coopSetup.p1GamepadIndex` if controller; P2: always their
  own gamepad source, bound to `coopSetup.p2GamepadIndex`), resets both players plus the shared
  world via two new helpers (`resetPlayerState(player)` and `resetSharedWorldState()`, split out of
  the old singleplayer-only `resetGame()`, which now calls both), spawns them at a hardcoded
  ±1-unit offset (arbitrary, not spec'd), and hands off from the title screen. If P1 needs pointer
  lock, hand-off goes through the same gesture-gated "click to play" overlay singleplayer uses
  (a countdown finishing isn't a real user gesture, so calling `requestPointerLock()` directly
  would likely be silently refused by the browser) — otherwise gameplay starts immediately with no
  overlay. `animate()` now branches on a new `isCoopMatchActive` flag: singleplayer's block is
  completely unchanged (copy-pasted into an `else`, not rewritten in place, specifically so its
  already-verified behavior can't regress), and a new `updateCoopMatchFrame()` drives *both*
  players' full update chain each frame when true. Shared pause: a new `isMatchPaused` flag,
  settable by either P1 losing pointer lock (generalized `onPointerLockChange`) or any connected
  gamepad's Start button (button index 9, confirmed earlier) via a new per-frame poll — Start
  toggles rather than only pausing, since a both-controller match has no mouse to click Resume
  with. A new `playerNeedsPointerLock(player)` helper (`player.input === inputSources[0]`) lets
  `updateMovement`/`tryStartSlide`/`processEdgeTriggeredActions` skip their pointer-lock gate
  entirely for a controller-driven player instead of guessing how it should generalize — always
  true for singleplayer's players[0], so their behavior is provably unchanged.
  **Known gaps, explicitly not fixed in this slice:** enemies still only ever target/attack
  players[0] (`camera`, hardcoded) — player 2 can fully fight back and damage enemies, but enemies
  never chase or attack them; this is Step 5's "nearest player, re-evaluated on the repath/LOS
  throttle" work, confirmed already. Dying mid-co-op shows the ordinary singleplayer death screen
  regardless of whether a teammate is still alive — proper spectator-until-both-dead behavior is
  also Step 5. The item inventory panel/toggle stays entirely player-1-only and DOM-singular (P2's
  Y button can only ever affect it if P1 currently holds pointer lock, and a pure both-controller
  match can never open it at all) — pre-existing Step 3 scope boundary, not revisited here. Mixed
  P1-keyboard + P2-controller pause/resume has a rough edge: a controller's Start toggling
  `isMatchPaused` off hides the pause overlay even if P1 hasn't actually re-acquired pointer lock
  yet, so P1 can still appear stuck. Rendering is still single-camera (`players[0].camera` only) --
  player 2 is fully live and playable, just not visible yet.
- **Part 1 Step 4, Slice B1 (dual-viewport 3D rendering, no HUD yet) — built, not yet
  user-verified.** Confirmed with the user: actual in-game split is top/bottom (P1 top, P2 bottom)
  -- a separate decision from the co-op *setup screen's* left/right layout, which stays as-is; the
  two don't need to match. `renderFrame()` (replacing the bare `renderer.render(scene, camera)`
  call in `animate()`) renders both players' cameras into their own half via
  `renderer.setViewport`/`setScissor` when `isCoopMatchActive`, singleplayer's single full-canvas
  render otherwise. `updateCameraAspectsForRenderMode()` keeps each active camera's `aspect`
  matching its actual render target (full window for singleplayer; full-width/half-height -- a
  much wider aspect -- per player during co-op) without touching `fov` itself, called from
  `startCoopMatch` (so the first frame is already correct), the resize handler (replacing its old
  direct singleplayer-only aspect line), and `resetGame` (restoring players[0]'s aspect back to
  full-window when a co-op match ends, since nothing else would otherwise undo the half-height
  aspect it was left at).
  **Explicitly not done, and known to look broken until the next slice:** the HUD (health, ammo,
  hit-marker, crosshair) is still one single set of DOM elements positioned against the *whole*
  viewport -- during co-op it does not move or duplicate, so e.g. the crosshair renders at 50%/50%
  of the full window, which is now the seam between the two halves, not the center of either
  player's actual view. Per-half HUD duplication (plus a repositioned shared wave/score HUD, plus
  a visible divider line between the halves) is Slice B2, immediately next.
- **Part 1 Step 4, Slice B2 (per-half HUD) — built, not yet user-verified.** Duplicated
  crosshair/hit-marker/health/ammo as a second set of DOM elements (`*-p1`/`*-p2`), positioned via
  `vh`/`calc()` scoped to each player's own half (P1: 0-50vh, P2: 50-100vh) so they stay correctly
  placed across window resizes with no JS recalculation needed -- only the actual 3D viewport/
  camera aspect needs that (Slice B1's `updateCameraAspectsForRenderMode`). A new `hudRefsFor(player)`
  picks the right DOM ref set (singleplayer's original elements, or `hudRefsP1`/`hudRefsP2`) for
  `updateHealthUI`/`updateAmmoUI`/`showHitMarker`/`updateHitMarker` to write to; all four now go
  through it instead of the bare singular consts. A `body.coop-mode` class (toggled in
  `startCoopMatch`/`resetGame`) switches which set is visible via CSS -- the singleplayer elements
  and the co-op ones are never shown together. Added a visible divider line between the halves.
  Wave/score stay singular (shared match state, not per-player) but recenter on the seam via a
  `body.coop-mode` CSS override rather than being duplicated.
  **Known gap, not fixed here:** `setInventoryOpen`'s crosshair-hide-while-browsing-items only
  ever touches the singleplayer `#crosshair` element, not the co-op ones -- consistent with the
  item inventory's existing not-co-op-aware boundary (see Slice A's own notes), not a new gap.
- **Gamepad look/aim fix (unblocks real-controller testing) — built, not yet user-verified (I
  cannot test real gamepad input myself).** `createGamepadInputSource()`'s `poll()` method existed
  since Step 1 but was never actually called anywhere, which meant `wasActionJustPressed` never
  fired for a gamepad player -- not just look, but fire/reload/melee/jump/weapon-switch/drop/
  interact/toggleInventory were all silently broken for any real controller, only masked because
  `isActionHeld` (used for movement) reads live gamepad state directly rather than through
  `poll()`'s cache. Fixed by calling `player.input.poll()` once per player per frame in
  `updateCoopMatchFrame`'s per-player loop (guarded by `typeof ... === "function"` so it's a no-op
  for the KB+M source). Added right-stick look: `GAMEPAD_AXIS_LOOK_X/Y` (axes 2/3, Standard
  Mapping), a `GAMEPAD_LOOK_SENSITIVITY` constant (3.0 rad/s at full deflection -- hardcoded
  placeholder, no sensitivity setting exists yet, tune by feel), and a `pollLookDelta(deltaSeconds)`
  method returning `{ dYaw, dPitch }` already in radians with the same sign convention as mouse
  `movementX`/`movementY`, so the call site applies it identically:
  `player.yaw -= dYaw; player.pitch -= dPitch;` (pitch clamped to `PITCH_LIMIT`, same as
  `onMouseMove`). Applied in the same per-player loop, gated on the input source actually having a
  `pollLookDelta` method (so it's a no-op for KB+M, whose look still comes from `onMouseMove`).
- **Player body mesh (co-op only) — built, not yet user-verified.** Reuses `enemyGeometry`/
  `enemyBodyMaterial` exactly (same box, same red material), with no face plane, per the request
  that it look "the same as the enemy without a face." One `THREE.Mesh` per player, created once
  alongside the `players` array and stored as `player.bodyMesh`. Own-camera invisibility uses
  Three.js Layers rather than any per-frame visibility toggling: each body mesh lives only on its
  own dedicated layer (`PLAYER_BODY_LAYER = [1, 2]`, deliberately not layer 0, so it's also
  excluded from any raycast that doesn't explicitly opt in, e.g. hitscan/melee), and each camera
  enables the *other* player's layer on top of its default layer 0. A new `updatePlayerBodyMeshes()`
  (called from `animate()` right before `renderFrame()`, unconditionally every frame) keeps each
  mesh's position/yaw following its player (feet-anchored at `ENEMY_SIZE.height / 2`, not
  eye-anchored like the camera) and sets `visible = isCoopMatchActive && !player.isDead` --
  self-gating, so no extra wiring was needed in `startCoopMatch`/`resetGame` to hide it outside a
  match.
- **Nearest-player enemy targeting — built, not yet user-verified.** Per the long-confirmed Step 5
  spec (nearest player, re-evaluated on the existing repath throttle, not sticky aggro). Every
  enemy now tracks its own `targetPlayer` (set on `spawnEnemy`'s state, starts `null`). A new
  `pickNearestActivePlayer(x, z)` helper picks the closest non-dead player, collapsing to
  "`players[0]` or null" outside co-op so singleplayer behavior is unchanged. Selection happens in
  two places: (1) forced immediately if the current target is null or has died, so an enemy
  doesn't spend up to a full `NAV_REPATH_INTERVAL` camped on a now-dead, unmoving player; (2)
  otherwise reselected on the same throttled cadence as pathfinding (inside the existing
  `repathTimer` block), not every frame. Every `camera.position`/`players[0]` reference inside
  `updateEnemies` (line-of-sight check, path target, slide-cancel-on-contact, knockback,
  `takeDamage` call sites) now goes through the per-enemy `targetPlayer` instead. Also loosened
  `updateEnemies`'s own top-level gate from "return if `players[0]` is dead" to "return only if
  *every* player is dead" while a co-op match is active -- otherwise enemies would freeze solid
  the instant one of two players died, which would have made nearest-player targeting moot.
  **Known gap, not fixed here:** the actual "both players dead -> end the run" transition and
  proper spectator-mode UI are still Step 5's death/game-over work, not started.
- **PlayStation-labeled default controller scheme — built, not yet user-verified.** Re-pointed
  `GAMEPAD_BUTTON` per the user's explicit PS button-name request: Cross(0)=jump,
  Circle(1)=crouch/slide, Square(2)=reload, Triangle(3)=`switchWeapon` (new action, cycles the
  active weapon slot via the existing `cycleActiveSlot` helper -- previously KB+M-scroll-only),
  D-pad up(12)=toggleInventory (moved off Triangle), L3(10)=sprint and Options(9)=pause were
  already correct and untouched, L1/R1/L2/R2 (melee/interact/aim/fire) untouched per "shooting and
  aiming are already right." `weaponSlot1`/`weaponSlot2` (direct-select) stay bound for KB+M
  (Digit1/Digit2) but are no longer in `GAMEPAD_BUTTON` at all, so a controller now only cycles,
  never jumps straight to slot 2 -- gamepad-only, no KB+M behavior changed. Standard Gamepad
  Mapping button *indices* are hardware-layout-agnostic (an Xbox pad reports the same index 0-3
  for its ABXY as a PlayStation pad does for Cross/Circle/Square/Triangle), so this is purely a
  relabeling/reassignment, not new platform-detection logic.
- **Ready-up button fix.** `COOP_READY_BUTTON_INDEX` was set to 2 (Square) but the prompt text
  read "Press X to Ready Up" -- mismatched once the controller scheme got PS labels. Both now
  agree: button 3 (Triangle), text updated to match, in both the static HTML and the
  ready/cancel-toggle JS.
- **Co-op death bug fix (user-reported: "resets the game and teleports you to the spawn point and
  freezes if I go to menu then unpause").** Root cause found: `triggerDeath()` showed the
  singleplayer-shaped death screen (Restart/Main Menu buttons) and called
  `document.exitPointerLock()` the instant ANY co-op player died, even with their teammate still
  alive and the round still running -- exactly the "Known gap, not fixed here" already flagged in
  an earlier pass. In practice: P2 (controller) dies mid-round -> death screen pops up over the
  still-live game and yanks P1's pointer lock -> P1, still trying to play, lands a stray click on
  one of the death screen's buttons -> silent `resetGame()` fires underneath them, which reads
  exactly as "teleported to spawn, movement locked, click-to-play out of nowhere." A subsequent
  Escape+Resume on top of that already-broken state is what tipped into the harder full-app freeze
  (the previously-documented WebView2 pointer-lock-reacquisition hang, see
  `onPointerLockChange`'s own comment) -- fixing the root cause removes the broken state that led
  there, rather than patching the freeze itself. Fix: `triggerDeath` now early-returns (still
  marks that player `isDead`, just skips the death screen/unlock) unless every player is dead,
  actually implementing the already-confirmed spec ("solo-dead player spectates until BOTH players
  are dead, no revive"). `updateWaveManager` had the exact same hardcoded-to-`players[0]` freeze
  bug already fixed in `updateEnemies` last pass -- given the same co-op-aware gate here too, so
  the wave/spawn timer doesn't also halt the moment one of two players dies.
- **Co-op spectator death screen + fullscreen-survivor mode — built, not yet user-verified.** The
  earlier fix (triggerDeath early-returning silently on a solo death) turned out to be incomplete:
  the user reported the dead player's teammate was still being bounced to "click to play"
  sometimes. Rather than keep chasing that indirectly, built the actual requested UX, which
  removes the ambiguous silent-early-return state entirely: a solo death now shows a small
  death-screen-styled prompt ("YOU DIED" + a "△ Player N Full Screen" button) confined to just the
  DEAD player's own half (`.coop-spectator-screen`, `coop-p1`/`coop-p2`-scoped like the rest of the
  per-half HUD) -- their still-alive teammate's half keeps rendering and playing normally
  underneath, untouched. Clicking that button (`enterCoopSpectatorFullscreen(survivorIndex)`) sets
  a new `coopFullscreenSurvivorIndex` (null normally; the survivor's player index once set) that
  `renderFrame`/`updateCameraAspectsForRenderMode` both check to switch from dual-viewport to a
  plain single full-canvas render of just the survivor's camera (same code path singleplayer
  already uses, just pointed at whichever camera), with matching CSS
  (`body.coop-spectator-fullscreen[-p1|-p2]`) that hides the divider and the dead player's HUD and
  stretches the survivor's own HUD to fill the whole viewport instead of their half. World
  state/wave/enemies keep running exactly as before (already coop-aware from the last two passes).
  When the survivor ALSO dies, `triggerDeath` now finds every player dead and falls through to the
  same singleplayer-shaped `#death-screen` as always -- no special-casing needed there, it already
  worked once the "everyone dead" condition was reachable. `resetGame()` clears
  `coopFullscreenSurvivorIndex` and the new body classes/screens so a fresh run never inherits
  stale fullscreen-spectator state.
- **Ammo/item pickup bug fix (user-reported: "player2 cant pick up ammo drops").** Root cause:
  `updateAmmoPickups` was hardcoded to bare `camera`/`players[0]` for both the proximity check and
  which inventory got the ammo -- P2 physically could not collect a pickup no matter how close they
  stood to it, and pointer-lock gating (`document.pointerLockElement === canvas`) meant even P1
  couldn't if they were controller-driven. Fixed to check every live player in co-op (falling back
  to just `players[0]` outside it, identical to the old behavior), first eligible player in range
  gets it, pointer-lock gating now only applied via `playerNeedsPointerLock` (skipped for
  controller players, same reasoning as elsewhere). Found and fixed the identical bug one function
  over: `findNearbyDroppedItem()` (used by the interact/pickup key for dropped weapons/items, not
  just ammo) took no player argument at all and also silently checked distance from bare `camera`
  -- now takes the acting player and checks their own position, so P2 can pick up dropped
  weapons/items too, not just ammo.
- **Inventory-while-jumping freeze bug fix (user-reported).** `updateMovement` had a single
  pointer-lock-gated early return covering the WHOLE function, including gravity -- opening the
  inventory (which releases pointer lock on purpose) mid-jump froze the player floating in place,
  gravity and all, until they closed it again. Split into a `hasControl` flag: horizontal
  movement/wall collision/footsteps still require it (unchanged), but gravity/landing now run
  unconditionally every frame, same as the world already staying "live" while the inventory's
  open. `isCrouching` hoisted above the split since the (now-unconditional) landing-footstep sound
  needs it too.
- **Co-op round start "click to play" removed, + Triangle/Enter-confirmed spectator prompt
  (user-reported the click-to-play was still appearing, plus explicit UX requests).**
  `startCoopMatch` no longer shows the gesture-gated overlay before a keyboard+mouse P1 can play --
  it now calls `canvas.requestPointerLock()` directly the moment the match starts, relying on the
  still-live transient-activation window from whichever real gesture (Enter/click) last readied P1
  up. A new `pointerlockerror` listener is the safety net if a browser ever refuses that: only then
  does the old "click to play" panel appear, rather than always gating on it up front. Also made
  the solo-death "Full Screen" prompt (last pass's button) actually reachable by more than a mouse:
  a dead controller-driven player's own Triangle press now confirms it too (reuses the
  `switchWeapon` action id -- safe, since `processEdgeTriggeredActions` already skips dead players
  entirely, so there's no double-fire risk with the normal in-combat weapon-cycle use of the same
  button), and a dead keyboard+mouse P1 confirms via Enter instead (a separate keydown listener,
  since `switchWeapon` isn't bound to any KB+M key at all). The icon shown next to "Player N Full
  Screen" -- and next to "Ready Up"/"Cancel" on the co-op setup screen itself, moved to the same
  icon+verb format for consistency -- now matches whichever of those two a given prompt actually
  needs: a real Enter-key icon image (new asset, `ENTER_KEY_ICON_DATA_URI`, embedded the same way
  as the other two setup-screen icons) for anything keyboard+mouse-confirmed, a plain Unicode
  triangle glyph (no image asset needed) for anything Triangle-confirmed. P1's own icon is picked
  per-match from `coopSetup.p1Scheme` (set once in `startCoopMatch`, since it can't change mid-
  match); P2's is always the triangle glyph, since P2 is never keyboard+mouse.
- **Controller-triggered pause left P1's cursor invisible (user-reported).** `setMatchPaused(true)`
  showed the pause overlay but never released pointer lock -- fine for an Escape-triggered pause
  (losing pointer lock is what triggers that path in the first place), but a controller's Start
  pausing the match left a keyboard+mouse P1's mouse still captured, so the pause menu was up but
  unusable (no visible cursor to click Resume/Settings with). Fixed: `setMatchPaused(true)` now
  releases pointer lock itself whenever P1 had it, regardless of what triggered the pause. This
  exposed a second, previously-latent gap on the resume side: a controller toggling the pause back
  OFF can't itself reacquire pointer lock for P1 (Gamepad API polling isn't a browser user
  gesture), which would have hidden the overlay to a dead end with no click target left anywhere
  to get back in. `setMatchPaused` now takes an options bag
  (`{ reacquiringPointerLock: true }`, only ever passed by resumeButtonEl's own click handler,
  which follows up with a real `requestPointerLock()` call) to tell the two cases apart -- resuming
  any other way falls back to the gesture-gated "click to play" panel instead of hiding to nothing.
- **Enter-key icon size + weapon-switch sound (user-reported/requested).** The new Enter icon
  (ready-up prompts, P1's solo-death "Full Screen" prompt) was too small -- bumped
  `.coop-setup-ready-icon` from 14px to 26px tall, and scaled the Triangle glyph up to match
  (`1.4em`) so the two stay visually consistent. Also removed the "draw" sound `switchToSlot` used
  to play on every weapon switch (scroll wheel, number keys, gamepad Triangle) -- switching is now
  silent. Left `tryPickUpNearbyItem`'s own "draw" sound alone -- that one plays on actually
  *picking up* a new weapon, a different action from switching to one already held.
- **Root cause found and fixed for the "game randomly restarts to round 1 a round or so in"
  bug (user-reported).** `startCoopMatch()` hid the outer `#title-screen` when a match began, but
  never actually cleared `titlePanels["coop-setup"]`'s own "active" CSS class -- only
  `showTitlePanel(view)` does that, and nothing called it on this transition. `animate()` gates
  `pollCoopSetupGamepads`/`updateCoopCountdown` purely on that class still being "active", so both
  kept running every single frame throughout live gameplay, for the rest of the session. Every
  Triangle press during a real match (switching weapons -- see `GAMEPAD_BUTTON.switchWeapon`, the
  exact same physical button as `COOP_READY_BUTTON_INDEX`) also got silently read by
  `checkCoopReadyButton` as a "ready up" toggle, because `coopSetup.p1GamepadIndex`/
  `p2GamepadIndex` were still set to the real, live gamepad indices from setup. Two players
  happening to switch weapons within the same few seconds readied both of them back up, which
  started a real (just invisible, since the setup screen itself was hidden) 5-second countdown --
  and once it hit zero, `startCoopMatch()` ran again on top of the still-live match, wiping health/
  inventory/position and the entire shared world (wave back to 1, enemies cleared, score reset).
  Root fix: `startCoopMatch()` now calls `showTitlePanel(null)` to actually clear every title
  panel's "active" state (including coop-setup's) the moment a match goes live, so both polling
  functions stop running entirely instead of silently ticking away in the background. Also added
  `if (isCoopMatchActive) return;` as a second line of defense at the top of `startCoopMatch()`
  itself, directly per the user's own request ("lock the game from starting/restarting unless
  coming from the co-op screen") -- it can no longer fire at all while a match is already live,
  regardless of what triggers it.
- **Inventory system temporarily disabled (explicit request).** A single flag,
  `INVENTORY_SYSTEM_ENABLED = false`, gates `toggleInventory()` -- the one choke point every open
  path (keybind, gamepad D-pad up) already routed through, so nothing else needed touching. The
  panel simply won't open until this is flipped back on; `setInventoryOpen(false)` elsewhere
  (`resetGame` etc.) is untouched, since staying closed is always safe regardless of the flag.
- **Player body mesh color + jump-sync fix (user-reported).** Was reusing `enemyBodyMaterial`
  (enemy red) -- now has its own black `playerBodyMaterial`, shared across both players' meshes, so
  a player doesn't read as an enemy to their teammate at a glance. Also fixed
  `updatePlayerBodyMeshes` never actually leaving the ground: its Y position was hardcoded to
  `ENEMY_SIZE.height / 2` with no reference to `player.jumpOffset` at all, so the mesh stayed glued
  to the floor while its own player jumped right through/above it. Now adds `player.jumpOffset` on
  top of that base height every frame.
- **Controller drop/pickup binds swapped (explicit request).** `dropItem` and `interact` traded
  gamepad button indices (R1 <-> R3) in `GAMEPAD_BUTTON` -- everything else about them (edge-
  detection, the functions they call) is unchanged, this only moved which physical button triggers
  which action.
- **Controller melee/drop binds swapped (explicit request).** `melee` and `dropItem` traded gamepad
  button indices (L1 <-> R1) in `GAMEPAD_BUTTON` -- aim/fire on the actual L2/R2 triggers are
  untouched (the request's "L2"/"R2" wording is read as the bumpers, since aim/fire were already
  explicitly confirmed correct earlier and touching them wasn't asked for).
- **Fist melee buffed over gun-bash melee (explicit request).** Previously both used the same
  `MELEE_DAMAGE`(25)/`MELEE_RANGE`(2.2) regardless of whether a weapon was equipped. Split into two
  pairs: gun-bash keeps those exact values (still driven by each weapon def's own `melee` stats, so
  a future weapon could still tune its own bash separately), bare fists (empty active slot) now use
  new `FIST_MELEE_DAMAGE` (55) / `FIST_MELEE_RANGE` (2.8) instead -- unarmed hits harder and reaches
  further than swinging a gun.
- **Interact/pickup moved to D-pad right (explicit request).** `interact` in `GAMEPAD_BUTTON` moved
  from R3 (right stick click) to button 15 (D-pad right), freeing R3 up (currently unbound).
- **Singleplayer controller support (explicit request) — built, not yet user-verified (I have no
  controller to test with myself).** Previously singleplayer was unconditionally keyboard+mouse;
  the difficulty-select screen now has its own scheme box (`#setup-scheme-box`), visually identical
  to co-op's P1 box (same `.coop-setup-box`/`.coop-setup-scheme-icon` CSS, same Keyboard+Mouse /
  Controller buttons) but without a ready-up mechanic -- there's no second player to wait on, so
  "ready" (light green box, full-opacity icon) just means "this scheme's input is actually usable
  right now": keyboard+mouse always is, controller only once a gamepad's sent input (reset back to
  not-ready on every scheme switch, exactly like co-op's own detection). The Start button shows the
  same Enter/Triangle icon+verb co-op's ready-up prompts use (`readyIconHTML`, reused directly) and
  can be triggered by a click, Enter, OR (once a controller's detected) that gamepad's own Triangle
  press. The left stick left/right steps `currentDifficulty` through the 3 tiers while this screen
  is active, edge-triggered so holding it over doesn't rapid-fire through every option.
  Gameplay-side wiring, since "turn on controller support" meant it needed to actually work, not
  just show a UI: `startSingleplayerGame()` (replacing the old plain click handler) assigns
  `players[0].input` to `player1GamepadInputSource` (the same persistent source co-op's P1-
  controller case already uses -- singleplayer and co-op are never live at the same time, so
  sharing it is safe) or back to `inputSources[0]`, per the chosen scheme. `updateMovement`/
  `processEdgeTriggeredActions`/etc. already transparently support this with no changes at all --
  they're the exact same player-parameterized functions co-op's controller-driven P2 already
  exercises, gated by the existing `playerNeedsPointerLock` check. What genuinely needed adding to
  animate()'s singleplayer branch: (1) `poll()`/`pollLookDelta()` calls for `players[0].input`,
  previously only ever called from co-op's per-player loop; (2) `isPlayerFrozen` generalized from a
  bare pointer-lock check to `(p1NeedsClick || isSingleplayerPaused) && !isDead`, since a
  controller player has no pointer-lock concept to freeze on; (3) a new `isSingleplayerPaused`
  flag + `pollSingleplayerPauseGamepad()` (Start button, mirroring co-op's own pause polling) since
  losing pointer lock -- keyboard+mouse singleplayer's only pause trigger -- can never happen for a
  controller player; (4) `resumeButtonEl`/`restartButtonEl` made scheme-aware so neither tries to
  `requestPointerLock()` for a controller-driven run.
- **Controller controls tab (explicit request) — built, not yet user-verified (no controller to
  test with myself).** The Controls screen now has two browser-tab-style buttons at the top
  ("Keyboard + Mouse", default-active, and "Controller"), each showing its own chart in the same
  two-column grid/chip visual language. Gamepad bindings are genuinely rebindable now, not
  hardcoded: `GAMEPAD_BUTTON` (a plain constant) became `GAMEPAD_BIND_ACTIONS` (id/label/default
  entries) + `gamepadBinds` (the live, mutable, localStorage-persisted map `createGamepadInputSource`'s
  `poll()`/`isActionHeld()` actually read -- same pattern as `keybinds` for KB+M). Also folded
  Pause into this same rebindable map (`gamepadBinds.pause`, previously a separate hardcoded
  `GAMEPAD_PAUSE_BUTTON_INDEX` constant) so the chart isn't missing an entire button, updating both
  `pollCoopMatchPauseGamepads` and `pollSingleplayerPauseGamepad` to read it. Move/Look show as
  fixed, non-rebindable rows ("Left Stick"/"Right Stick") -- same idea as the KB+M chart's own
  "Look: Mouse" row -- since they're stick axes, not buttons. Rebinding a gamepad chip works exactly
  like the KB+M flow (click it, "Press any button…", capture and save, auto-unbinding any other
  action that already used that button) via a new `pollGamepadRebindCapture`, polled once per
  animate() frame while the Controls overlay is open; the two listening flows are mutually
  exclusive (starting one cancels the other). Per explicit spec, the controller itself can only
  navigate this screen, not edit it yet: while the Controller tab is showing, connecting a gamepad
  auto-highlights the top row's key chip with a blue hue (`controller-selected`), and the left
  stick up/down (edge-triggered, one step per push) moves that highlight through the chart --
  actually changing a bind, and leaving via Back, both still require the mouse, unchanged.
- **Not started:** the rest of Part 1 Step 5 (shared win/loss condition), the per-player inventory
  UI (moot for now while the system's disabled entirely -- see above), and all of Part 2 (audio
  rework).

#### Session handoff (2026-09-19, end of session) — development continuing in a new session

Everything above this point in today's dated entry was built and, per each entry's own note,
either user-verified after a launch or still awaiting the user's own test pass (I have no
physical controller and cannot test any gamepad-driven behavior myself — every claim above of
"not yet user-verified" is a real, open item, not a formality). Picking this project up in a fresh
session should start by reading this whole 2026-09-19 dated entry (the split-screen co-op build
end to end) plus the TODO list below, since none of that context carries over automatically.

**TODO, roughly in priority order:**

1. ~~Get user confirmation on everything still marked "not yet user-verified" above.~~ **Done —
   user-confirmed.**
2. ~~Re-enable the item inventory system and make it co-op-aware.~~ **Done — see this session's own
   "Inventory system: fully separated per-player" entry below for the full build. `INVENTORY_SYSTEM_ENABLED`
   is back to `true`.**
3. ~~Part 1 Step 5, the remaining piece: co-op's actual win/loss framing.~~ **Resolved as a design
   decision, not a gap: "survive as long as possible, together," no explicit win condition, for
   co-op or singleplayer.** §9's "No win condition" entry describes the intended design now, not an
   open question.
4. **Part 2: the audio system rework — on hold, explicitly, for now.** Still not started; see this
   section's own "Part 2: Audio system rework" spec further below (AudioManager, category volumes,
   3D positional audio, multi-listener split-screen handling, owner-priority boost, voice limiting)
   whenever it's picked back up.
5. **Smaller known gaps** (being worked through now):
   - ~~Mixed-scheme co-op resume wasn't fully seamless~~ **fixed** — a controller un-pausing on a
     keyboard+mouse P1's behalf used to fall back to a "click to play" gate; now hides the overlay
     immediately (gameplay's playable via keyboard right away) and silently retries
     `requestPointerLock()` on P1's very next real click/keypress instead, same pattern as the
     co-op match-start fix (`retryCoopPointerLockOnce`, now shared by both call sites).
   - ~~`setInventoryOpen`'s crosshair-hide only touched the singleplayer `#crosshair`~~ **fixed** —
     also hides `#crosshair-p1` now (needed its own `body.coop-mode .coop-crosshair.hidden` CSS
     rule too, since nothing matched that combination before). Still only P1's — the inventory
     system itself is still P1-only/shared (see item 2), so P2 has no crosshair-hiding trigger to
     wire up yet either.
   - **No weapon draw sound, no melee-impact sound — blocked on audio assets, not code.** Neither
     effect has a clip anywhere in the embedded audio library (`WEAPON_DEFS`' own `sounds` only
     define `shot`/`reload` for either gun; `performMelee` calls no sound at all). Per this
     project's own audio convention, these need to come from the user as real files, not
     synthesized/guessed here.

**Status:** a technical-challenges/questions/approach reply was given for both parts below;
several clarifying questions are still open and implementation has not started pending answers.

#### Part 1: Split-screen input & menu flow

- Two players, local split-screen. Input configs: one KB+M + one controller, **or** both
  controller (never two simultaneous KB+M, since Pointer Lock is document-global and can only
  ever serve one mouse-look player at a time — this resolves what would otherwise be an API
  blocker).
- **Menus:** only mouse navigates any menu (main/pause/co-op setup) — controller input does not
  navigate. Exception: either controller can pause from gameplay. Pausing pauses for **both**
  players.
- **Controller bindings:** hardcoded default scheme for now (not rebindable), functionally
  matching the existing singleplayer keybind actions (§2).
- **Singleplayer pre-game menu:** defaults to KB+M with an option to switch to controller, before
  pressing Start. Not exposed in the in-game pause menu — pre-game-only choice.
- **Co-op setup screen:** vertical divider, Player 1 top / Player 2 bottom (fixed, not
  configurable). Each half has a labeled dark-gray semi-transparent box holding that player's
  input selection + ready state.
  - P1 defaults to KB+M with a controller-switch option, same as singleplayer's pre-game menu.
  - P2 shows a grayed-out/"disconnected" controller icon that un-grays the instant controller
    input is detected for that slot.
  - Ready-up prompt: "Press Enter to Ready Up" (KB+M) / "Press X to Ready Up" (controller).
    Readying flips the box to light green and the prompt to "...to Cancel" (toggles back on a
    second press).
  - Once **both** players are readied: an on-screen countdown ("Starting in 5..." → 0), start of
    the game presentation is open (get creative). Either player cancelling before it finishes
    stops the countdown and the game does not start.
- **Rendering approach (mine, not detailed by the original ask):** two cameras rendered via
  `renderer.setViewport`/`setScissor` into top/bottom halves, each camera's `aspect` recomputed
  against half-height; per-half HUD DOM; Gamepad API polling for controller input; doubled player
  state (health/ammo/inventory/position) per §1's "doubled state" scope, world/enemies/wave/score
  assumed shared (pending confirmation — see open questions).

#### Part 2: Audio system rework

Reworking/expanding the existing system (§7), not a from-scratch rebuild — existing clips,
tuning, and call sites migrate in, not get re-recorded or re-triggered.

- **Central `AudioManager` module** — owns loading, playing, stopping, and controlling all game
  sounds; gameplay code calls into it (`playSound(sound, position)`,
  `playSound(sound, position, { volume, priority })`, `playUI(sound)`, styled idiomatically to
  the rest of the codebase rather than forced to match this shape literally).
- **Category volume controls**, at minimum: Music, Player, Weapons/attacks, UI, and a
  general/future catch-all — each an independent `GainNode` feeding the existing single
  `masterGainNode` (Master Volume keeps multiplying everything exactly as it does today).
- **3D positional audio**: position, base volume, max hearing distance, min/full-volume distance,
  optional loop, optional pitch variation, distance-based falloff — generalized from the gore
  clip's existing distance-only falloff (§7/§9), which is the one sound in the game that already
  does most of this.
- **Split-screen listener handling**: Web Audio has exactly one `AudioListener` per
  `AudioContext`, no native multi-listener support. Approach: skip `PannerNode`/`AudioListener`
  entirely (as gore already does) and manually compute each positional sound's relevance
  (distance-based volume + owner bonus, see below) against **each** player's camera, then take
  whichever player scores higher as both the final volume **and** the stereo-pan reference —
  never blended/averaged, so a sound never gets a contradictory pan. A sound most relevant to P1
  plays loud overall even if far from P2, per spec's explosion example.
- **Stereo panning**: computed against whichever listener "won" the relevance comparison above,
  via `StereoPannerNode`.
- **Player-specific sound priority**: sounds tagged with an owning player (`ownerId`) — own
  gunshots/footsteps/melee — get a volume boost for that player's own relevance score, so each
  player clearly hears their own actions.
- **Priority/voice limiting**: a registry of currently-active voices with priority tiers and a
  hard concurrent-voice cap (proposed ~24–32, tunable by ear); once at cap, lower-priority new
  requests are dropped in favor of player actions/explosions/major events/UI over ambient/distant
  sounds. Looping sounds (slide loop, future ambience) need to be exempt or last-resort-only
  candidates for stealing.
- **Performance**: decoded `AudioBuffer`s are already cached/reused (§7) — that doesn't change.
  `AudioBufferSourceNode`s are single-use by spec (`start()` can only ever be called once), so
  "reuse" in practice means the voice-cap/registry above bounding total concurrent node creation,
  not literally recycling source nodes.
- **Migration**: every existing call site (gunshots, reload, dry-fire, pickups, menu clicks,
  footsteps' surface/state volume table, the slide loop's bespoke gain-ramp start/stop, gore's
  distance math) routes through the new manager preserving its current tuned numbers — planned in
  small verifiable batches (UI sounds first) rather than one rewrite pass.

#### Open questions (blocking implementation start)

Part 1: co-op death/game-over condition; confirm world/enemies/wave/score stay single shared
instances while only health/ammo/inventory/position double; enemy targeting rule when both
players are alive (nearest vs. sticky-aggro); co-op starting loadout; controller pause-button
mapping (proposed Standard Mapping button 9 / Start); ready-up screen behavior on a controller
disconnecting after being detected; per-half FOV/aspect correction vs. flat crop; whether the
existing difficulty screen still gates co-op; whether "singleton-audit work done earlier" refers
to a refactor that's actually landed yet (not found in the current code — state is still bare
module-level `let`s) or is implied as part of this work; whether the single-file `index.html`
approach (kept for `file://` portability, see §1) should be revisited given how much larger this
feature will make it, now that Tauri serves the app rather than requiring raw `file://` opening.

Part 2: whether category volumes get real UI sliders now or stay code-level only (Master Volume
remains the only exposed control); whether an actual Music track is coming or Music stays an
empty reserved category; concurrent voice cap preference; which existing sounds should be
treated as positional-in-spirit (gore already is) vs. intentionally flat/global (menu sounds
already are) — specifically the green-enemy explosion, weapon/ammo pickup clips, and the slide
loop, which could reasonably go either way.

#### Planned build order (subject to change once answers come in)

1. Part 1: extract the input layer alone (`InputSource` abstraction for KB+M and gamepad),
   verify singleplayer is behaviorally unchanged before anything else.
2. Part 1: co-op setup screen UI + ready-up state machine, verified in isolation (no real
   split-screen gameplay started yet).
3. Part 1: thread a player parameter through movement/weapon/melee/HUD (two parallel state
   objects), still rendered from one camera as an intermediate step; verify no cross-player state
   leakage before touching rendering.
4. Part 1: actual split-screen render path (dual viewport/scissor, per-half HUD, aspect
   correction) — last, once dual gameplay state is already verified independently.
5. Part 1: enemy targeting + shared pause + controller-pause-from-gameplay + win/loss condition,
   then a full end-to-end playtest.
6. Part 2 (interleaved once Part 1 has two real camera positions to test against): AudioManager
   skeleton + category gains with zero behavior change → voice registry/priority cap → generalize
   gore's falloff into the shared positional path, migrate footsteps/gore onto it → extend to
   multi-listener scoring → owner-priority boost + stereo pan last.

### 2026-09-20 — Ammo Mode, look-sensitivity settings, controller menu navigation overhaul

Separate from the split-screen co-op/audio-rework initiative above (Part 2 of that plan still
hasn't been started) — this was a series of smaller, independently-requested features and fixes
in one continuous session. Unlike the 2026-09-19 co-op work, most of the controller-facing items
below **were exercised against real hardware this session** (the bug reports that drove each fix
were specific enough to have come from actual play, e.g. the exact "held Square instantly
re-selects the next screen's first item" bug) — but the *latest* round of fixes (back/reset
highlighting, wrap-around, the held-button double-activation fix) has not yet been re-confirmed
by the user in a fresh pass, so still treat those as open until they say otherwise.

**Ammo Mode setting** (§3) — new Game Settings toggle, Realistic (the original full-magazine-swap
behavior, now named/exposed as an option rather than the only behavior) vs. Easy (early-CoD-style
top-off, no chambered round, **new default**). Both read through one new `getMaxLoadedAmmo(gunStats)`
helper so reload and fresh-spawn ammo agree on what "full" means under whichever mode is active.
Landed alongside two small, unrelated combat tweaks bundled into the same pass: reload duration
2.4s → 2.25s for both guns, and aiming down sights is now blocked while the active slot is
mid-reload (§3).

**Look-sensitivity settings** (§2) — two new sliders on the Controls screen (one per tab), each
0–100%, default 50% (=1×). Persisted independently, not linked. The controller slider is itself
controller-navigable (see below) and got its own circle-thumb styling to match the rest of the
chart's chip look instead of the browser's default.

**Controller-driven rebinding** (Controls screen, Controller tab) — previously the controller
could only *navigate* this chart, not edit it (a spec'd limitation from the 2026-09-19 work).
Square now starts a rebind on whichever row is stick-selected (shows `<Press Button>`, same as a
mouse click would), and the next fresh button press on any pad completes it, auto-unbinding any
other action that already used that button — reuses the existing
`beginListeningForGamepadRebind`/`pollGamepadRebindCapture`/`applyGamepadRebind` flow the mouse
click already went through, no new rebind logic needed. Back and Reset to Defaults, at the very
bottom of the same chart, are now reachable and Square-activatable too (previously mouse-only).

**Controller menu navigation, built out from nothing to covering nearly every screen** — see §8's
new "Controller navigation (menus)" entry for the full description (`pollGenericMenuNav`,
wraparound, the shared gold `.menu-nav-selected` highlight, Square-to-activate, X-to-back
everywhere except the title's main panel, generalized cursor hiding, and the held-button
double-activation bug that was found and fixed along the way). Also unified every remaining blue
"selected" highlight in the UI (the Controls chart's stick-selected chip, the singleplayer
scheme buttons) to the same gold `#ffdc64` the difficulty picker already used, so "selected" reads
as one consistent color everywhere rather than blue in some places and gold in others.

**Enemy face pool grew from 38 to 44** — six new face images (`aidansface`, `aureksface`,
`austinweitesface`, `gradysface`, `manjotsface`, `noahsface`, sourced from the matching new PNGs
under `5 nights at kise/images/`) added as `FACE_TEXTURE_DEFS` entries in alphabetical order, each
with its `aspect` read from the actual PNG dimensions (`width / height`) rather than guessed.
Needed no other code changes: `FACE_KEYS`/`OTHER_FACE_KEYS` are derived from
`Object.keys(FACE_TEXTURE_DEFS)`, so the new keys are automatically in `pickRandomFaceKey`'s pool
(still 85% evanface / 15% uniform over the other 43) the moment they're in the defs object.

**Enter-key ready-up icon (`gamenterkeyuiicon.png`) fixed and enlarged, Enter now starts
singleplayer too:**
- The source PNG had a white background instead of transparency (visible as a white box around
  the icon in-game); fixed with a Pillow-based script (connected-component labeling on a
  white-ish mask, alpha zeroed only on the border-connected "outside" component, so the
  interior white of the key face/text was untouched) and overwritten in place. Rewriting the
  file alone wasn't enough, though — the game never reads it from disk, it inlines a base64
  copy at build/edit time (`ENTER_KEY_ICON_DATA_URI`, same self-contained-file approach as
  `FACE_TEXTURE_DEFS`), so that constant had to be regenerated from the new PNG too or the game
  keeps showing the stale white-background copy forever.
- `.coop-setup-ready-icon`/`.coop-setup-ready-icon-glyph` (the Enter image and the Triangle glyph
  respectively — see `readyIconHTML`) both grew 26px → 32px and switched from a hand-tuned
  `vertical-align: -7px` hack to `vertical-align: middle`, so they stay properly centered against
  the button text at this (or any future) size instead of needing another magic offset retuned by
  eye.
- Enter previously only readied-up on the co-op setup screen; it now also clicks the singleplayer
  setup screen's Start button for a keyboard+mouse P1 (`setupStartButtonEl.click()`), gated on
  `titlePanels["setup"]` still being `"active"` exactly like the co-op handler is gated on
  `titlePanels["coop-setup"]`. That gate matters for a specific reason: `startSingleplayerGame`
  clearing `titlePanels["setup"]`'s "active" class via `showTitlePanel(null)` is *the* fix for a
  previously-documented bug (Triangle re-starting a live controller run — see the bug list right
  below) — reusing the same gate here means Enter can't re-trigger `startSingleplayerGame` mid-run
  either, rather than reintroducing that bug class through a new input path.

**Controller tab: Back moved to the corner, Circle/Square/Triangle binds show as symbols
(explicit request):**
- Back (`#controls-back-button`) now pins to `#controls-card`'s top-left corner — same idea as
  every other screen's own `.corner-back-button`, applied here via a `controller-tab-active` class
  toggled on `#controls-card` in the tab-switch handler, so the Keyboard + Mouse tab's own
  Back/Reset row is untouched. It's purely a CSS reposition, not a markup move: Back is still a DOM
  child of the bottom button row, just taken out of flow — which meant Reset's sibling-combinator
  `margin-left` (from `.menu-button + .menu-button`) needed clearing too, or it'd sit off-center by
  that same amount with Back no longer actually there to justify it. Reset ends up centered for
  free once that's cleared, since `#controls-card` already centers its (now single-button) row.
- Back also moved in `controllerControlsRowEls`' nav order — from last (after Reset, reachable only
  by scrolling all the way down) to index 0, immediately above the Sensitivity slider, which stays
  the tab's default selection (`controllerControlsSelectedIndex` starts at 1, not 0, both where
  it's declared and where `pollControllerControlsNav` re-arms it). One stick-up press from the
  default selection now reaches Back directly, matching how the wraparound fix made Back reachable
  from the top on every `pollGenericMenuNav` screen (§8) — this chart has its own bespoke nav
  system instead of that shared one, so it needed the equivalent fix applied by hand here.
- `GAMEPAD_BUTTON_INDEX_LABELS`' Circle/Square/Triangle entries (index 1/2/3) changed from spelled-
  out words to their actual symbols (○/□/△) — the same outline-triangle glyph the co-op ready-up
  prompt already uses elsewhere (`&#9651;`/`△`) for consistency, plus the matching outline
  circle/square. X and everything else (L1/R1/Share/D-Pad/etc.) are unchanged.

**Co-op setup screen polish (explicit request), and co-op's own "Click to play" removed:**
- P1's keyboard+mouse icon (639x360) rendered visibly smaller than the controller icon (290x245)
  despite sharing the same fixed 150x100 box — `object-fit: contain` scales each to fit without
  distorting it, but the keyboard art's wider aspect meant it was constrained by the box's width
  (rendering ~84.5px tall) while the controller art was constrained by height (a full 100px tall).
  Rather than widen the shared box (which would break `.coop-setup-box`'s fixed size across P1's
  swap between the two — see that rule's own comment), a `scheme-keyboard` class (toggled in
  `updateCoopSetupUI`) applies `transform: scale(1.18)` to just the keyboard art, bringing its
  rendered height in line with the controller art's.
- P1's ready-up text lost its underline (`.coop-setup-ready-prompt.clickable`) — cosmetic-only,
  cursor:pointer still marks it clickable.
- P1 and P2's ready-up prompts sat at different Y positions, because P1's box has an extra
  scheme-switch button row above its icon that P2's box never had, and both boxes vertically
  center their contents (`.coop-setup-box`'s `justify-content: center`) — fewer stacked children
  in P2's box meant its icon/prompt centered higher. Fixed with an invisible clone of that same
  row (`.coop-setup-scheme.spacer` — `visibility: hidden`, inert, sized identically via the same
  classes so it can't drift out of sync) added to P2's box purely to occupy the same height. Its
  buttons carry no `data-scheme` and are excluded from every `.coop-scheme-button` selector
  (rescoped to `#coop-setup-p1 .coop-scheme-button`) so they can never accidentally get wired up.
- Both prompts' ready-up symbols (the Enter image and the Triangle glyph) grew to 150% of their
  shared 32px/1.7em base (48px/2.55em) — scoped by ID to just these two prompts, not the shared
  `.coop-setup-ready-icon`/`-icon-glyph` classes, so the singleplayer Start button and the co-op
  solo-death "Full Screen" buttons (which also use `readyIconHTML`) stay at their current size.
- **The "Click to play" overlay at co-op match start, removed (explicit bug report — it was
  showing up consistently, not just as a rare edge case).** `startCoopMatch` requests pointer lock
  directly (see its own comment) rather than gating on a click, relying on the browser's
  transient-activation window from whichever real gesture most recently readied P1 up still
  covering the moment the 5-second countdown reaches zero — evidently that window doesn't reliably
  last the full 5 seconds. The old fallback (`pointerlockerror` handler) put up the "click to
  play" panel when that request was refused; now it instead silently attaches a one-time
  click/keydown listener and retries `requestPointerLock()` on P1's very next real input — gameplay
  is already on screen, so from the player's side the first thing they do to actually play (move,
  shoot, anything) doubles as the retry, invisibly. Re-checks its own conditions before retrying,
  since real gameplay time (P1 dying, the match ending) may have passed since the original refusal.
  Scoped to co-op's own match-start path only — the mid-match "controller resumed pause, P1 has no
  way to reacquire lock" fallback (§8) and the post-match reset's overlay-view default are separate,
  legitimate uses of the same panel and were left alone.

**Co-op player body mesh didn't compress on crouch/slide (user-reported)** — `updatePlayerBodyMeshes`
(§4's own entry) kept every body mesh at its full `ENEMY_SIZE.height` regardless of pose, so a
crouching or sliding teammate's camera/gun dropped (see the eye-height lerp in `updatePlayer`) while
their visible body stayed standing-height to the other player. Fixed by deriving a height ratio
straight from `player.currentEyeHeight / EYE_HEIGHT` — already smoothly lerped toward
`CROUCH_EYE_HEIGHT` for the camera itself, covering both crouch and slide the same way that lerp
already does — and applying it as `mesh.scale.y`, with `position.y` adjusted so the box stays
feet-anchored (compresses from the top down) instead of shrinking around its own center. No new
lerp state needed; it can't drift out of sync with the camera since it reads the same value.

**Circle/Square rebind-chart symbols enlarged again (explicit follow-up)** — the first pass (22px)
still read as too small; bumped to 30px. Triangle's own 16px was left as-is (not flagged again).

**Dead player's gun floated in place instead of dropping (explicit bug report, co-op)** —
`viewModelRoot` (the gun/fists view model) is parented to the player's own camera (see
`buildPlayerGunRig`) and sits on the default render layer like everything else, not one of the
per-player `PLAYER_BODY_LAYER`-restricted meshes — nothing ever excluded it from the OTHER
player's camera, and nothing moved or hid it once its owner died and their camera stopped moving,
so it just hung frozen exactly where they'd last aimed, visible to their still-alive teammate.
Fixed in `triggerDeath` by reusing `dropActiveSlotItem` — the exact toss-and-tumble-to-rest
physics the G-key manual drop already uses — so the gun actually falls and settles on the ground
instead of vanishing in place (no-ops harmlessly if fists were already equipped), then hiding
`viewModelRoot` entirely so an empty-handed fists pose can't take over as the new floating thing.
`resetPlayerState` un-hides it again on respawn/restart.

**Weapon ammo confirmed/hardened as tied to the gun instance, not the player (explicit request,
co-op)** — ammo was already carried on the dropped/picked-up item itself (`spawnDroppedWeapon`'s
`loadedAmmo`/`reserveAmmo` params, read straight from whichever slot dropped it, and copied
straight into `pickedSlotState` on pickup) rather than tracked anywhere per-player, so a teammate
picking up your dropped gun already got exactly that gun's own ammo. What wasn't right: picking up
a weapon you're already carrying, with both slots full, replaced whatever slot was *active* —
meaning picking up a teammate's dropped Glock while your Glock sat in your inactive slot evicted
your unrelated Pistol instead, leaving you holding two Glocks (the swap never actually reached your
existing one). Fixed by checking for a slot that already holds the SAME `weaponId` first and
targeting that one specifically (dropping what was in it, in your place, exactly like a manual
G-press) before falling back to "replace whichever's active" for two genuinely different weapons.
`dropActiveSlotItem` split into a general `dropSlotItem(player, slotIndex)` to support dropping an
arbitrary (not-necessarily-active) slot for this.

**Co-op setup screen: character/face picker (large explicit feature request)** — both sides now
show a small, independently-rendered, continuously-rotating turntable preview of that player's
actual in-game body + face, with left/right arrow "buttons" flanking it to cycle the face:
- **Faces now exist on the player body at all, in-game** — `player.bodyMesh` (§4) was a plain
  black box with no face at all before this; it now gets a `facePlane` child (same
  `getFaceAssets`-cached geometry/material/position an enemy's own face plane uses), set to
  whichever face each player actually picked via `setPlayerFace(player, faceKey)`, called once at
  startup with a random key (so there's always something valid to look at) and again by
  `startCoopMatch` with the real, chosen key. Crouch/slide compression (this same session, earlier
  entry) scales `bodyMesh` on Y only, which `facePlane` would inherit as a child — countered with
  `facePlane.scale.y = 1 / heightScale` each frame so the face image itself never stretches, only
  rides down with the compressed body (its parent-relative offset shrinks along with the parent's
  scale, which is correct/desired here — that's the face moving down with a real crouch).
- **The preview itself** (`createSetupModelPreview`) is a genuinely separate small
  scene/camera/`WebGLRenderer` per side, targeting its own `<canvas>` — reuses the exact same
  `enemyGeometry`/`playerBodyMaterial`/`getFaceAssets` the real body does (so the preview always
  looks identical to what actually shows up in-game), just spinning continuously
  (`SETUP_MODEL_ROTATION_SPEED`, 0.4 rad/sec) rather than tracking any real player position/crouch.
  Two extra WebGL contexts is negligible next to the one already driving the real game; both only
  ever render while the co-op setup screen (and that side's own model) is visible.
- **Reveal timing**: P1's model is up immediately (keyboard needs no detection; controller needs a
  gamepad assigned, same "connected" condition its own icon already used). P2's only appears the
  instant a gamepad's actually claimed for them — same moment their icon/model-row would otherwise
  first read as "connected" — and disappears again if that controller disconnects
  (`coopSetup.p2GamepadIndex` resets to null on `"gamepaddisconnected"`, same as always). Each
  side's face KEY, once assigned, is never cleared by a disconnect — only `resetCoopSetup` (a fresh
  visit to this screen from mode-select) resets it to null — so reconnecting shows the same face
  rather than re-rolling it.
- **Random default, alphabetical cycling, wraps at the ends**: the moment either side's model first
  reveals itself with no face key yet, `pickRandomPlayerFaceKey()` assigns one. A new
  `SORTED_FACE_KEYS` (true alphabetical order, unlike `FACE_KEYS` itself, which deliberately puts
  `evanface` first for the enemy-spawn weighting — unrelated to this) backs
  `cyclePlayerFaceKey(currentKey, direction)`, wrapping at either end.
- **Input**: a keyboard+mouse side's arrows are left-click-only (`.coop-setup-face-arrow`'s own
  click handler checks that side's scheme is `"keyboard"` before doing anything — P2 is always
  controller, no mouse to click with). A controller side instead cycles with the RIGHT stick
  (`GAMEPAD_AXIS_LOOK_X` — explicit request: "the joystick that currently moves the camera angle",
  i.e. LOOK, not MOVE) via `checkCoopFaceStep`, edge-triggered per side exactly like
  `checkCoopDifficultyStep`'s own left-stick handling, just on the other axis so the two don't
  fight. Both paths funnel through one shared `cycleSetupFace(side, direction)`, which also plays
  the same `menu_click_01` stepper sound `stepDifficulty` already uses for its own stick path.
- `.coop-setup-box` widened 220px → 260px to fit the new preview row (canvas + two arrow buttons)
  without overflowing; P2's invisible scheme-button spacer (previous entry, this session) still
  keeps both sides' rows at the same Y position with the new row added above the connection icon.

**Character preview follow-up (explicit correction pass) — layout moved out of the box, rotation
reworked, and a real in-game orientation bug fixed:**
- **Faces were rendering on the back of the head, in the real game** — `player.bodyMesh`'s
  `rotation.y` was set to `player.yaw` directly, but that's the *camera's* yaw convention
  (local forward = -Z at yaw 0, see `applyCameraRotation`), not the *enemy mesh* convention
  `getFaceAssets`' own face-plane placement assumes (local forward = +Z, see its "Local +Z is the
  enemy's forward side" comment, written for `atan2(x, z)`-style enemy facing). Using `player.yaw`
  unmodified pointed the box's +Z side — and the face mounted on it — at camera-*backward*, i.e.
  directly away from wherever the player was actually looking. Fixed with `player.yaw + Math.PI`.
- **The preview moved out of `.coop-setup-box` entirely (explicit follow-up)** — the boxes are back
  to their original contents/220px width, exactly as before this feature existed. Each side's
  `#coop-setup-p1-model-row`/`#coop-setup-p2-model-row` is now a sibling of `.title-panel-content`
  pinned to the screen's outer edge (`left`/`right: 30px`) via `position: absolute` on `.title-panel`
  itself, at a much bigger 240x340 canvas (up from 100x140). Vertical alignment can't come from
  flex/gap anymore since the row lives in a completely different part of the layout than the box it
  needs to match — `alignCoopSetupModelRows` (called every frame alongside the render/rotation
  update) reads each box's real `getBoundingClientRect()` and sets the row's `top` to that box's
  measured vertical center, so it can't drift out of sync with the box even across a window resize.
- **Rotation changed from a continuous spin to a 90-degree-either-way oscillation (explicit
  request)**: `advanceSetupModelRotation` now clamps at `+/-SETUP_MODEL_MAX_YAW` (`Math.PI / 2`) and
  flips `rotationDirection` there instead of letting `rotation.y` wrap freely, so the model swings
  face-toward-camera → +90° → face-toward-camera → -90° → repeat, rather than spinning through the
  back of the model on every lap.

**Character preview: second tuning pass (explicit follow-up)**
- Swing narrowed from +/-90 to +/-75 degrees (`SETUP_MODEL_MAX_YAW`).
- Moved further from the midline: `left`/`right` 30px → 15px.
- **Arrows now sit at a fixed height matching where a face typically is, not the box/canvas's own
  center, and don't move between different faces** — previously part of the same flex row as the
  canvas (vertically centered as a unit, same as the canvas itself); now independently
  `position: absolute` within the row (which is already an absolute-positioned element itself, so
  it's their containing block for free) at a flat `top: 23%` of the canvas's own height. Explicitly
  NOT read from `getFaceAssets`' real per-face position/height, which varies slightly with each
  face's own source aspect ratio — the whole point was for the arrows to hold still regardless of
  which face is currently showing.
- Moved in closer to the canvas: the old flex `gap` (14px) is now an 8px `calc(100% + 8px)` offset
  on each arrow specifically.
- **Registering a face change now flashes that arrow gold for a third of a second** — the same
  `rgba(255, 220, 100, ...)` / `#ffdc64` `.difficulty-option.active` already uses, via a `.flash`
  class added in `cycleSetupFace` and removed by a `setTimeout(333)`, tracked per-button in a
  `WeakMap` so a rapid repeat resets/extends the flash instead of an earlier timeout cutting a
  newer one short. Fires for both the click and the stick-driven path (both funnel through
  `cycleSetupFace`).
- **This one clip is now half volume** — `cycleSetupFace`'s own `playClip("menu_click_01", ...)`
  call passes `{ volume: 0.5 }`; every other `menu_click_01` call site (`stepDifficulty`'s own
  click/stick paths included) is untouched, per explicit request.

**Character preview: third tuning pass (explicit follow-up)**
- Swing narrowed again, +/-75 → +/-65 degrees.
- Moved back toward the midline slightly: `left`/`right` 15px → 18px.
- **Arrows were leaking off the actual screen edge (user-reported)** — sitting just *outside* the
  canvas (even at the reduced 8px gap from the previous pass) meant the outer arrow (P1's left,
  P2's right) extended past the true viewport edge, since the model itself already sits close to
  it. Fixed by anchoring both arrows *inside* the canvas's own footprint instead — `left: 8px`/
  `right: 8px` (was `right`/`left: calc(100% + 8px)`, i.e. outside it) — overlapping the model a
  little near its edges rather than sitting beside it, same idea as a media carousel's own
  overlaid prev/next arrows. This keeps both arrows structurally on-screen regardless of how close
  to the true edge the model itself ever sits, rather than depending on getting the model's own
  offset and the gap both numerically right together.
- Flash duration shortened, a third of a second → a sixth (`setTimeout(333)` → `setTimeout(167)`).

**Character preview: fourth pass — real position/size tracking (explicit follow-up, found by
testing in actual fullscreen)** — every previous pass's px offsets were tuned windowed; going
fullscreen put the models flush against the true screen edge, since a fixed px offset from the
edge has no relationship to how much space fullscreen actually has to work with:
- **Horizontal position is now the real midpoint between the screen edge and that side's own
  `.coop-setup-box` border**, not a fixed px offset — `alignCoopSetupModelRows` measures both via
  `getBoundingClientRect` every frame (same function already handling vertical centering) and sets
  `left`/`right` to half that measured gap, so it's correct at any window size including
  fullscreen, not just whatever size it happened to be tuned at.
- **The model's actual SIZE now scales with the window too (explicit request)**, not just its
  position — `updateCoopSetupModelScale` computes `scale = window.innerHeight /
  SETUP_MODEL_SCALE_REFERENCE_HEIGHT` (1080, treated as the real fullscreen height the current
  240x340 look was tuned against) and resizes each preview's actual canvas + `WebGLRenderer` to
  match — deliberately a real resize, not a CSS `transform: scale()` on the canvas, which would
  just blur a WebGL surface whose internal drawing buffer never actually changed resolution.
- **The arrows scale right along with it** — their own `transform: translateY(-50%) scale(scale)`
  and their `left`/`right` overlap offset (`SETUP_MODEL_ARROW_EDGE_OFFSET`, 8px at scale 1) are set
  by the same function. Their `top: 23%` positioning already tracked the canvas's height for free
  (the row's own height comes from the canvas, its only in-flow child) and needed no change.
- Flash duration shortened again, a sixth of a second → a seventh (`setTimeout(167)` →
  `setTimeout(143)`).

**Character preview: fifth pass — arrow spacing (explicit follow-up)** — `SETUP_MODEL_ARROW_EDGE_OFFSET`
8px → 3px, nudging the arrows toward the canvas's true edge and further from the model itself
(they still sit inside the canvas's own footprint, per the earlier "leaking off-screen" fix — this
only reduces how far into it they sit).

**Controls screen: Back now pins to the corner on both tabs (explicit follow-up)** — previously
only the Controller tab got `.corner-back-button`-style placement (see this session's earlier
entry); Keyboard + Mouse still shared the bottom row with Reset. Since both tabs now want the same
placement, the tab-switch handler's whole conditional relocate-on-switch dance was removed —
`controlsBackButtonEl` moves out to `#overlay-controls` exactly once, at setup, permanently, rather
than shuffling between `#overlay-controls` and `#controls-buttons-row` on every tab click. Renamed
`.controller-tab-corner` → `.controls-back-corner` since it's no longer tab-specific. Reset, now
always alone in `#controls-buttons-row` on both tabs, centers there the same way it already did for
the Controller tab.

**Inventory system: fully separated per-player, re-enabled, custom cursor + controller support
(large explicit feature request)** — the item inventory (8-slot, drag-to-rearrange) was built
P1-only/shared and left disabled (`INVENTORY_SYSTEM_ENABLED = false`) since a real co-op session
couldn't use it properly (P2 pressing D-pad Up literally couldn't open it at all -- see the bug
below). Now fully separate:
- **Per-player state**: `isInventoryOpen`, `cursor` ({x, y}, the custom pointer's own position),
  `slotDragState`, and `cursorClickWasPressed` all moved onto the player object itself (next to the
  already-per-player `itemInventorySlots`) instead of being module-level globals shared by
  whichever player last touched them.
- **Per-player DOM**: a second panel/grid (`#inventory-panel-p2`/`#inventory-grid-p2`, mirroring
  the original P1 elements) plus two cursor dots (`#inventory-cursor-p1`/`-p2`).
  `inventoryElsFor(player)` resolves the right set via `players.indexOf`, same parallel-pair
  pattern `hudRefsP1`/`hudRefsP2` already uses. Every function that used to assume `players[0]`
  (`renderInventoryPanel`, `beginSlotDrag`, `finishSlotDrag` — the old inline mouseup logic,
  factored out so the controller path could call it too — `cancelSlotDrag`, `setInventoryOpen`,
  `toggleInventory`) now takes a `player` parameter and reads/writes through it.
- **Each panel centers on its own half of the split screen** (`body.coop-mode #inventory-panel` at
  `top: 25%`, `#inventory-panel-p2` at `75%`) instead of both potentially centering on the whole
  screen — expands back to `top: 50%` for a fullscreen spectator survivor, whose own view covers
  the whole screen again (`body.coop-spectator-fullscreen-p1/-p2`).
- **Custom cursor (explicit request): a small white circle, black outline, replacing the real OS
  cursor entirely** — `.inventory-cursor`, positioned via `updateInventoryCursorEl`. The real OS
  cursor is hidden globally the instant either player's inventory is open
  (`body.inventory-cursor-active`, toggled by `updateGlobalCursorHiding`) — `.inventory-slot`'s own
  `cursor: grab` needed an explicit override too, or it would've won over the inherited `none` by
  specificity.
- **A keyboard+mouse player's own experience is the same as before, just with the retextured
  cursor** — real `mousemove`/`mousedown`/`mouseup` still drive everything, just resolved to
  *whichever* player is actually on keyboard+mouse (`playerNeedsPointerLock`, at most one, ever)
  instead of assuming `players[0]`. **Can't cross the split-screen border**: the real mouse position
  gets clamped to that player's own half (`clampCursorToPlayerHalf`) before being stored as
  `player.cursor`, and drops resolve against that clamped position (`elementFromPoint`), not the
  raw mouse position — so even if the physical cursor strays into the other half, the drop can't
  land there. `finishSlotDrag` also double-checks the hit slot's `parentElement` is actually that
  player's own grid, belt-and-suspenders against the border ever actually being crossed.
- **A controller player's left stick drives the same cursor, Right Trigger clicks
  (explicit request)** — `updateInventoryCursorForController`, polled once per frame while that
  player's inventory is open. Left stick (`GAMEPAD_AXIS_MOVE_X/Y` — explicit request: "movement
  joystick", not look) moves `player.cursor` directly (not through the rebindable action layer);
  Right Trigger is hardcoded to physical button index 7 (same reasoning as every other
  menu-specific hardcoded button in this file — Square/Triangle for nav, etc. — not the rebindable
  "fire" action that just happens to default there too), edge-detected press/release into the exact
  same `beginSlotDrag`/`finishSlotDrag` the mouse path uses, so both inputs stay in lockstep.
  Required exposing a new `getRawGamepad` method on `createGamepadInputSource`'s returned object
  (previously fully private) to read the stick/trigger directly.
- **Each player's own inventory now actually freezes only THAT player**, in both modes — previously
  P1 opening the (only) inventory froze **both** co-op players (via the shared `isFrozen`/pointer-lock
  reasoning), and a controller-driven player's inventory opening didn't freeze anyone at all in
  either mode (nothing checked `isInventoryOpen` for them) — their stick kept moving their character
  underneath their own open panel. Fixed by pulling `player.isInventoryOpen` out of the shared
  co-op `isFrozen` calculation and checking it per-player in the loop instead (co-op), and adding it
  as an explicit second freeze trigger alongside `isSingleplayerPaused` (singleplayer, for a
  controller-driven run). The world itself is still never paused by inventory being open, in
  either mode, per the existing "exposed to danger while managing items" design.
- **Stale-input guard**: a gamepad source's own `poll()` never runs at all while that player's
  inventory is open, so its edge-detection snapshot goes stale — closing the inventory while still
  physically holding Right Trigger would otherwise read as a brand-new "fire" press the instant
  gameplay resumes. `setInventoryOpen` resyncs it (`poll()` then `endFrame()`, discarding that
  resync's own edge) on every close.
- Escape (keyboard-only, by definition) now resolves to whichever player is actually on
  keyboard+mouse before closing their inventory, instead of the old single shared flag.
  `resetGame()` and `triggerDeath` both close out any player's still-open inventory defensively (a
  dead player's panel/cursor no longer sits uselessly on top of the death/spectator screen; leaving
  the title screen no longer leaves a stray panel stuck open behind it).

**Inventory follow-up: a controller player genuinely couldn't open their inventory at all
(user-reported) — a poll-ordering bug in the previous entry's own new code.** Both
`updateCoopMatchFrame`'s per-player loop and the singleplayer frame both called
`processToggleInventoryAction(player)` *before* that frame's own `player.input.poll()` -- moved
there deliberately so the toggle check could run even while the rest of the per-player loop was
being skipped for other reasons. But `wasActionJustPressed` only ever reflects whatever `poll()`
populated *this* frame, and `endFrame()` (called unconditionally every frame regardless of any
freeze) wipes that clean before the next frame's poll ever runs -- so checking the toggle before
poll() meant it was always reading an already-cleared snapshot from the frame before, permanently:
a controller's D-pad Up press could never be seen at all. A keyboard's own toggle key worked fine
throughout, since `wasActionJustPressed` for it is fed by real, async keydown events, not a poll.
Fixed by moving `poll()` back to run first, before the toggle check, in both call sites -- it's a
plain snapshot with no side effects on its own, so running it unconditionally (same as the toggle
check itself) is safe regardless of what happens after it.

**Controller controls chart: Circle/Square chips were visibly bigger boxes than every other row
(user-reported)** — the previous session's `font-size: 30px`/`16px` fix for these being too small
also grew the chip's own line-height/box right along with the glyph (nothing constrained the two
independently). Switched to `transform: scale(2.14)`/`scale(1.14)` instead — the same ratios those
font-sizes had to the base 14px, so the glyph ends up the identical visual size as before, but
`transform` is pure paint, not layout, so the chip itself now stays exactly the same size as every
other row's.

**Bug fixes found via real controller testing this session** (each already folded into the
relevant section above/below, listed here as a flat record of what broke and why):
- Starting a singleplayer round on Controller left the "Click to play" overlay stuck up for the
  entire match — `startSingleplayerGame` only ever hid it as a side effect of
  `canvas.requestPointerLock()` succeeding, which a controller player never calls. Now hidden
  explicitly for that branch, mirroring what `startCoopMatch` already did correctly for a
  controller P1.
- The same missing hide meant the mouse cursor was never hidden at all under controller control,
  in gameplay or on the setup screens — this is what the new `setCursorHidden`/cursor-hiding work
  (§8) was actually built to fix, not just a menu-navigation nicety.
- A stale `titlePanels["setup"]` "active" class (never cleared on match start, only the outer
  `#title-screen` was hidden) meant `pollSingleplayerSetupGamepad` kept polling straight through
  live gameplay — every Triangle press (`switchWeapon`) was also read as "confirm/restart,"
  silently resetting the run. Same bug class, and same fix (`showTitlePanel(null)`), as an
  already-documented 2026-09-19 co-op bug.
- Settings' own controller highlight silently failed to appear when reached from the title
  screen specifically (not from pause) — `titleSettingsButtonEl`'s click handler hides
  `#title-screen` directly without clearing `titlePanels.main`'s own "active" class, so
  `pollGenericMenuNav` kept matching the title's main panel underneath and highlighted/polled
  buttons that weren't even visible anymore. Fixed by also requiring `#title-screen` itself to be
  visible in that screen's `isActive()` check (same fix applied defensively to mode-select too).
- Back/Reset's `.controller-selected` class was being toggled correctly but had no matching CSS
  outside `#controller-controls-list` (they live in `#controls-card` directly, not inside that
  list) — added the missing rule rather than moving the elements.
- Several Audio/General/Mode-select screens list their Back button *last* (it's actually drawn at
  the *top* of the screen, a `.corner-back-button`), so reaching it meant scrolling all the way
  down past everything else — fixed by making `pollGenericMenuNav`'s up/down wrap around instead
  of clamping, which makes pressing up from the default first item reach it directly.
- Game Settings' Ammo Mode toggle was exposed to `pollGenericMenuNav` as two separate up/down
  stops (one per `.ammo-mode-option`), inconsistent with every other binary control on that screen
  and unable to express "these two are one segmented control" the way the difficulty screens do —
  fixed by making the wrapping `.ammo-mode-options` div the single nav stop and driving it with a
  left/right stepper instead (see §8's "Controller navigation" entry above).

**TODO, this thread specifically (held off for now, per explicit user instruction — not being
worked on):**
1. Get a full fresh-launch confirmation pass on everything in this entry, especially the latest
   fixes (back/reset highlighting, wraparound, the held-button fix) which haven't been re-tested
   since landing.
2. Two controller players in the same co-op match still share one controller-sensitivity value
   (explicit, acknowledged limitation, not a bug) — revisit if/when that's actually requested.
3. The Controls screen's own tab buttons and the co-op setup screen's own scheme/ready-up
   controls are still mouse-only for anything beyond what's described above (e.g. no
   controller-driven way to switch co-op setup's P1 scheme) — not asked for yet, just noting the
   boundary.

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
- **2026-09-19 (later still, split-screen co-op)** — Local 2-player split-screen co-op (Part 1 of
  the plan further above), built incrementally across the day and covered in full, dated detail by
  this same day's earlier §10 entry (the one this Changelog line summarizes) — see that entry for
  the complete build order, every bugfix, and everything still flagged "not yet user-verified."
  Headline additions: an `InputSource` abstraction (keyboard+mouse and gamepad) with real gamepad
  look/aim support; a co-op setup screen (scheme choice, ready-up, countdown) that also gave
  singleplayer its own controller-support setup screen and real gamepad-driven gameplay, not just
  co-op; dual-viewport split-screen rendering with correct per-half aspect/FOV and per-half HUD; a
  visible, color-coded player body mesh in co-op; nearest-living-player enemy targeting; a co-op
  death/spectator system (a solo death shows a small per-half prompt instead of ending the round,
  with a controller-or-Enter-confirmed "Full Screen" toggle for the survivor); a fully rebindable
  Controller tab alongside the existing keyboard+mouse one on the Controls screen, including
  left-stick navigation of the chart once a controller's connected. Also fixed several real bugs
  surfaced along the way (most notably: a stale co-op-setup screen state that silently restarted
  a live match to round 1 whenever both players happened to switch weapons within a few seconds of
  each other; the inventory panel freezing a mid-air jump entirely instead of just its horizontal
  control; a controller-triggered pause leaving a keyboard+mouse player's cursor invisible). The
  non-weapon item inventory was temporarily disabled by explicit request partway through (see §5/§9)
  and remains off. See the session handoff note at the end of this day's §10 entry for the current
  TODO list.
- **2026-09-20** — Six new enemy faces added to `FACE_TEXTURE_DEFS` (38 → 44 — §4's Face texture
  entry), no other code changes needed since the spawn pool is derived from the defs object's own
  keys. Ammo Mode setting (Realistic/Easy, defaults to Easy — §3), two new look-
  sensitivity sliders on the Controls screen (§2), and a broad controller menu-navigation
  overhaul, covered in full by this same day's §10 entry. Headline additions: the Controls
  screen's Controller tab can now actually rebind a gamepad chip (previously navigation-only),
  reaching all the way down to Back/Reset to Defaults; a generic `pollGenericMenuNav` system
  drives up/down-highlight-and-Square-to-activate navigation (with wraparound) across nearly
  every remaining menu screen — title main/mode-select, Settings/Audio/Game Settings, Pause, and
  the death screen; X now acts as Back everywhere except the title's own main panel; real
  controller stick/button activity hides the mouse cursor on every menu screen (previously only
  the singleplayer setup screen did this, and even that had a bug leaving the cursor visible the
  whole match); every remaining blue "selected" highlight in the UI was unified to the same gold
  the difficulty picker uses. Also: reload duration 2.4s → 2.25s for both guns, and aiming down
  sights is now blocked while mid-reload. Fixed several real bugs surfaced along the way (most
  notably: a "Click to play" overlay left permanently stuck up for an entire controller-driven
  singleplayer match; a stale `titlePanels["setup"]` state that let Triangle silently restart a
  live singleplayer run, the same bug class as an already-fixed 2026-09-19 co-op one; and a
  held-button double-activation bug where switching screens via Square/X while still holding the
  button immediately "activated" the new screen's first item too before it was ever released).
