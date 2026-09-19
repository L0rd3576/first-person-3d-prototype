# Glock audio: splitting plan

`gameglockaudio.wav` (44.13s, stereo 16-bit/44.1kHz, converted from the
original `gameglockaudio.mov`) is one continuous take containing several
different sounds recorded back-to-back: reload, drawing/holstering the
weapon, and gunshots at close/medium/far distance. **Not all of these
will end up used** -- this file exists so a future session can pick up
the splitting work without re-deriving everything from scratch, and so a
human can review/correct the guesses below before anything is cut.

## How the sounds were identified

No audio playback is available in-session, so identification was done by
analyzing the waveform numerically with Python (`wave` + `numpy`, both
already available/installable in this environment -- no other deps
needed):

1. Compute an RMS amplitude envelope (10ms windows) over the whole file.
2. Threshold against the noise floor to find 32 distinct "active"
   segments (events), merging gaps under 120ms so a single sound's
   natural decay doesn't get chopped into multiple pieces.
3. For each event, measure peak/RMS level, attack time (onset to peak),
   spectral centroid, and spectral rolloff (via FFT).
4. Re-analyze the four longest/oddest events at finer resolution (5ms
   windows) to count internal sub-peaks -- this is what separated
   "single gunshot" (one sharp transient + smooth decay tail) from
   "multi-step mechanical action" (several comparably-loud clicks
   spread over 1-3 seconds: mag out, mag in, slide rack, holster
   friction, etc).

This is acoustic pattern inference, not confirmed listening -- treat the
reload/draw grouping as fairly reliable (the multi-click structure is
unambiguous) and the close/medium/far distance boundaries as a rough
starting point (they're inferred from how much high-frequency content
survived, which correlates with distance but isn't calibrated against
anything). **A human should listen to each proposed group before
anything is finalized.**

## Detected events (timestamps into gameglockaudio.wav)

### Reload / draw sequence -- structurally different from every shot (multi-click clusters, not a single transient)
- `17.11s - 19.94s` -- two click clusters (~18 then ~5 sub-peaks) -- best guess: **reload** (mag eject + mag insert)
- `20.09s - 22.14s` -- click cluster ending in one sharper hit -- best guess: **draw / holster clear**
- `24.56s - 26.28s` -- three near-equal-loudness clicks in quick succession -- best guess: **slide rack / chamber**
- `22.73s - 23.98s` -- sits between the two above, but has a clean single-transient shape like a gunshot, not a click cluster -- **ambiguous**, possibly a stray shot recorded between reload takes rather than part of the sequence

### Everything else (28 events) -- single clean gunshot (one sharp attack, smooth decay tail), grouped by brightness as a distance proxy
**Close** (bright, ~4.3-7.8kHz spectral centroid, all before the reload/draw block):
`0.00s, 0.87s, 1.65s, 2.22s, 3.10s, 4.15s, 5.60s, 7.02s, 8.38s, 9.55s, 10.42s, 11.57s, 13.34s, 14.05s, 14.67s, 15.59s, 16.42s`

**Medium** (~3.6-4.9kHz centroid):
`26.66s, 28.30s, 34.89s, 39.73s, 41.46s`

**Far** (~1.7-2.7kHz centroid, longer/smoother reverb tails):
`29.56s, 31.68s, 33.33s, 36.29s, 38.04s, 43.10s`

**Unclear which distance bucket** (in-between spectral values, worth a close listen): `22.73s` (see above), plus a couple of the medium/far boundary cases -- re-run the analysis script (see below) with `--verbose` equivalent (just print the full per-event table again) if the exact centroid/rolloff numbers are needed again.

## Next steps for whoever picks this up

1. **Listen** to each event above (even a rough scrub in Audacity/any
   player is enough) and build the *actual* keep-list -- which takes
   are usable, what they really are, and which distance bucket each
   shot really belongs in. Expect to throw away some -- there are 28
   candidate gunshots and the game almost certainly doesn't need that
   many close takes.
2. Once the keep-list exists, extract each range into its own file.
   This can be done with Python's stdlib `wave` module alone (open the
   source file, `readframes`/`writeframes` the sample range for each
   clip, no external tools needed) -- or with `ffmpeg -ss <start> -to
   <end> -i gameglockaudio.wav <name>.wav` if ffmpeg has been installed
   by then (it wasn't available in this session).
3. Suggested naming, adjust to however the game's audio system ends up
   organized: `reload_01.wav`, `draw_01.wav`, `shot_close_01.wav`,
   `shot_medium_01.wav`, `shot_far_01.wav`, incrementing per kept take.
4. Wire the chosen files into the glock's `WEAPON_DEFS` entry in
   `index.html` once there's an actual audio-playback system in the
   game (there isn't one yet as of this file being written -- the
   project has no `<audio>`/Web Audio usage at all currently, so that's
   a prerequisite, not just a matter of pointing at file paths).
