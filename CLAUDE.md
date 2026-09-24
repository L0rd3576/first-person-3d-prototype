# Project Context

This is a first-person 3D game being built with Claude Code by a college student.

## Git location

The parent folder `C:\Users\qj6264sf\Desktop\3dgame-from-laptop` is NOT a git repo.
The actual git repository (tracking `https://github.com/L0rd3576/first-person-3d-prototype`)
lives in this directory: `C:\Users\qj6264sf\Desktop\3dgame-from-laptop\first-person-3d-prototype`.
Run git commands from here, not the parent.

## Launching the game

When the user says "Launch" (or asks to launch/run the game), run `npm run tauri dev` in the
background from this directory to open the Tauri app window.

- Do not immediately relaunch it after it exits. If the user closes the window/session
  themselves, that's an intentional stop, not a crash to recover from -- leave it stopped
  and wait for the user to ask again.
- Only retry if there's a genuine build/launch error to fix (e.g. a compile error), and say
  what you're retrying and why.
