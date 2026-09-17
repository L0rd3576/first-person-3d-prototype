# Project Context

This is a first-person 3D game being built with Claude Code by a college student.

## Launching the game

When the user says "Launch" (or asks to launch/run the game), run `npm run tauri dev` in the
background from this directory to open the Tauri app window.

- Do not immediately relaunch it after it exits. If the user closes the window/session
  themselves, that's an intentional stop, not a crash to recover from -- leave it stopped
  and wait for the user to ask again.
- Only retry if there's a genuine build/launch error to fix (e.g. a compile error), and say
  what you're retrying and why.
