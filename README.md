# First-Person 3D Prototype

A small first-person 3D prototype game, built as a desktop app with
[Tauri](https://tauri.app) (Rust) wrapping a single-file
[Three.js](https://threejs.org) scene. You move around a small
platform with WASD, look around with the mouse, and avoid/fight off an
enemy that chases you and drains your health.

## Tech stack

- **Tauri 2 / Rust** — native desktop shell (window, packaging,
  installers). See `src-tauri/`.
- **Three.js r128** — 3D rendering, vendored locally at `vendor/three.min.js`
  (no CDN dependency, no network required to run the app).
- **Vanilla JS / HTML** — the entire game lives in one file, `index.html`,
  at the project root. No bundler, no build step for the game code itself.

## Project layout

- `index.html` — the game itself (source of truth). Edit this file.
- `vendor/three.min.js` — vendored Three.js r128 build, referenced by
  `index.html`.
- `frontend/` — the web-assets folder Tauri actually bundles. Its
  contents (`index.html`, `vendor/`) are copied here automatically by
  `scripts/sync-frontend.js` before every dev run / build — don't edit
  files in `frontend/` directly, edit the root copies instead.
- `src-tauri/` — the Rust/Tauri application shell (window config,
  bundler config, Cargo project).
- `5 nights at kise/images/` — source art assets used while building
  the game (e.g. the enemy face texture).
- `scripts/sync-frontend.js` — copies `index.html` and `vendor/` into
  `frontend/` so Tauri has an isolated, self-contained web-assets
  directory to bundle.

## Setup (new machine)

1. **Install Rust** (needed to compile the Tauri shell):
   - Go to <https://rustup.rs> and follow the instructions, or run:
     ```
     winget install --id Rustlang.Rustup
     ```
   - Restart your terminal, then confirm with `rustc --version` and
     `cargo --version`.

2. **Install Node.js** (v18+): <https://nodejs.org>, or:
   ```
   winget install OpenJS.NodeJS.LTS
   ```

3. **Install platform build tools** (Windows): the "Desktop development
   with C++" workload from Visual Studio Build Tools is required by
   Tauri/Rust to link native binaries on Windows. See the
   [Tauri prerequisites guide](https://tauri.app/start/prerequisites/)
   for your OS if you're not on Windows.

4. **Clone the repo and install JS dependencies:**
   ```
   git clone <repo-url>
   cd first-person-3d-prototype
   npm install
   ```
   This installs the Tauri CLI (`@tauri-apps/cli`) as a dev dependency;
   there's no separate global install needed.

5. **Run it in dev mode:**
   ```
   npm run tauri dev
   ```

6. **Build a release binary / installer:**
   ```
   npm run tauri build
   ```
   Output lands in `src-tauri/target/release/` (the binary) and
   `src-tauri/target/release/bundle/` (MSI/NSIS installers on Windows).

## Controls

- **WASD** — move
- **Mouse** — look
- **Shift** — sprint
- **Ctrl** — crouch
- **Space** — jump
- Click the canvas to lock the pointer and start playing.
