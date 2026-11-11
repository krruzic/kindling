# Integration notes

What building [`examples/brawl`](../examples/brawl) (one small game through every package) found in the packages,
and what was changed. Each fix has a test in its package.

## @kindling/net

- **A core `Sim` didn't plug into lockstep.** `@kindling/core` sims expose named section hashes
  (`sections(): { total, sections: Record<string, number> }`), but `LockstepSim` only took a positional
  `sectionHashes(): number[]`, so every game needed an adapter and had to repeat the section names in the host's
  `sections` option. `LockstepSim` now also accepts `sections()`; the host derives the section names from the sim
  when the option is absent and sends them to guests. New helpers `hashRow(sim, names)` and `sectionNamesOf(sim)`.
  Test: "a core-style sim (named sections(), no sectionHashes) is hashed and desyncs are named".

## @kindling/input

- **Prompt glyphs had no mode that is right for every pad.** `"game"` showed the game's letter (an "A" on a
  PlayStation pad), `"physical"` showed raw ids ("BTN 11", "a2+") after a remap onto an unknown button, which
  LESSONS.md says players hated. New `glyph(action, { mode: "auto" })`: the bound button's own face when it is a
  known button of that pad (CROSS on PlayStation, A on Xbox, the east A on Switch, green A on GameCube), else the
  game's letter. Test: "glyphs: game letters by default, physical on request, keys on keyboards".
- **Keyboard glyphs were dark keycaps with dark legends.** Input gave keyboard glyphs the colour `#3a3a44`
  (meant as text ink), but every prompt painter (ui's default included) uses a glyph's colour as the keycap, so
  keys in the controller page and footers were unreadable. Keyboard glyphs now carry the keycap colour (`KEYCAP`,
  light). Same test.
- **The menu press that opened the select screen also seated its device.** Seats were taken while a button was
  _held_ with `joining` on, so pressing Enter on "LOCAL PLAY" put the right keyboard half in seat 1 before anyone
  pressed anything. Turning `joining` on now makes every held device let go first (`joining` is an accessor).
  Test: "seats: a button held when joining turns on (the menu press that opened the screen) doesn't seat".

## @kindling/ui

- **Glyphs from @kindling/input didn't quite fit `ui.Glyph`.** Input names the GameCube family `"gc"`, ui expected
  `"gamecube"` (wrong colours), and input carries the PlayStation symbol in `shape` while ui guessed it from the
  label. `Glyph` now has an optional `shape` (drawn as the symbol) and `"gc"` is an alias of `"gamecube"`, so an
  input glyph passes straight into `drawPromptBar` / keybind rows. Test: "glyphs: input's 'gc' family and shape
  field draw like gamecube / PlayStation symbols".

## @kindling/assets

- **The screenshot harness couldn't ask the page whether it looked right.** LESSONS.md wants every screen shot
  with the layout debugger clean, but `screenshots()` only collected console errors. New `check` option (per run
  or per target, and `--check` on `kindling-shots`): a JS expression evaluated just before each shot that returns
  the page's own problem list (e.g. `window.game.layoutIssues`); each entry becomes a `"check"` problem. Non-list
  results are kept in the new `ShotReport.data`. Test: "screenshot harness: sizes, predicate, console errors, page
  checks".

## @kindling/three

- **Every game's build shipped ~1.8 MB of DRACO and Basis decoders it never loaded.** `AssetCache` reached them
  through a dynamic `import()` behind its `dracoPath` / `ktx2` options, so the bundler always emitted
  `DRACOLoader`, `KTX2Loader` and their wasm. The options are replaced by a `setup(loader)` hook that runs once
  before the first load; a game that wants DRACO / KTX2 imports them there itself. BRAWL's `release/` lost 1.9 MB.
  Test: "AssetCache: setup configures the loader once, before the first load".

## @kindling/server

- **The documented relay wiring didn't exist.** The README and `server.ts` showed `new NetRelay()` and
  `relay.route(req, res)`; `@kindling/net/relay` exports `createRelay()` with `handleRequest` / `attach`. Fixed the
  docs; `examples/brawl/tools/server.ts` is the working wiring, and `pnpm -C examples/brawl online-test --prod`
  plays a real two-page online match through it (static build + relay on one port).

## Smaller things noticed (left as they are)

- `@kindling/input`'s `MenuNavigator` and `@kindling/ui`'s `NavRepeater` both do key repeat; a game uses one and
  maps its output to ui's `Nav` (four lines in `examples/brawl/src/app/controls.ts`).
- `drawPerf` (core) draws in canvas pixels; on a UI canvas with a layout transform, reset the transform first.
- `Memo` panels can't report to the layout debugger on cached frames; record their rects outside the paint.

## PELT juice pass

- **@kindling/three `Particles`: sparks pointed in random directions.** `stretch` streaks took a random `rot`, so
  impact sparks read as confetti. Added `align` (per particle) + `update(dt, camera?)`: aligned particles turn to their
  screen-space velocity each update. Test: "Particles: align turns streaks to the screen-space velocity".
- **@kindling/input had no rumble.** Added `Rumble` (dual-rumble through `Gamepad.vibrationActuator`, addressed by
  the manager's "pad-<index>" handle; weaker pulses never cut a running one short; `scale`). Test: "rumble: ...".

## QUICKLORE migration

QUICKLORE (the pixel-art party game whose input, net, save, relay and UI pieces Kindling was partly extracted from)
moved onto the packages: `@kindling/input` (InputManager with its Nintendo-position bindings, keyboard halves from its
save), `@kindling/net` (relay, LobbyHost / LobbyGuest for its host-run select screen, LockstepHost / LockstepGuest),
`@kindling/save` (a v1 -> v2 migration from its own localStorage format), `@kindling/core` (Mulberry32 is
bit-identical to its RNG: the determinism baseline held until the hash switched to `sectionHashes`), `@kindling/audio`,
`@kindling/server` and `@kindling/ui` (split layout + seams, text wrap / ellipsize, LayoutDebug).

- **@kindling/audio `MusicPlayer` decoded every track whole.** A 2-minute track decodes to ~40 MB of PCM; with a
  track per screen (title, select, run, showdown, results, credits) and prefetch on, a session held ~250 MB of
  music. Tracks can now stream (`stream: true`: an HTMLAudioElement through a MediaElementAudioSourceNode, crossfaded
  like decoded ones; the old stream is paused once its fade ends; never prefetched; `element` option for fakes).
  Test: "music: streamed tracks play through a media element, crossfade and get paused after their fade".
- **@kindling/input `MenuNavigator` couldn't give per-seat input.** A select screen where every seat moves its own
  cursor needs one step per pad, but `read(pads, now, only)` merges, and reading one seat at a time with `only`
  reset every other seat's repeat timer (so a held direction never repeated). New `readEach(pads, now)`: each pad's
  own steps, presses and repeat timer. Test: "nav: readEach gives every seat its own steps and repeat timer".
- **@kindling/input `MenuNavigator` only heard seated devices.** Menus read `read(players)` / `readEach(players)`,
  which only see devices in a seat; a device a game frees (backing out of a select screen calls `release`) can only
  re-seat with a button, never a direction, and with `joinPressCounts` that button also acts. In QUICKLORE the main
  menu after leaving select ignored up / down and A took you straight back into PLAY. New
  `readDevices(input.deviceList(), now)`: every connected device, seated or not, merged, repeat timers kept per
  device handle (apart from the seat timers, so a game can read both in one frame), with the acting `handle`. Test:
  "nav: readDevices lets any device drive a menu, seated or not".
- **@kindling/input's rumble test didn't typecheck** (`startDelay` missing from the fake actuator's parameter type);
  `pnpm -C packages/input typecheck` failed. Fixed the test's types.

Left as they are (QUICKLORE keeps its own):

- `@kindling/ui` components (MenuList, OptionsPage, Dialog, NameEntry, drawPromptBar) draw through a `Theme`'s fonts
  and panel roles; QUICKLORE's menus are bespoke pixel layouts (blurb panes, walking heroes, per-row pickers, GUI
  sheet frames per hero colour) and its prompt glyphs are drawn to match its 8 x 8 font. Adopting them means a
  re-skin of every page; the pieces that fit as-is (split layout and seams, wrap / ellipsize, LayoutDebug) are used.
- `LockstepHost`'s `leave: "stall"` has no way to drop a guest that said goodbye (it waits `dropAfterMs`): QUICKLORE
  sends a "bye" and calls `drop(seats, "left")` itself, which works fine with the public API.

## QUICKLORE camera pass

- **Fixed-step pacing stuttered at a steady 60 Hz (`FixedLoop`, `LockstepHost`, `LockstepGuest`).** All three ran
  `while (acc >= tick)`. Display timestamps wobble by fractions of a millisecond (timer precision, the compositor),
  and whenever the carried remainder sits near a tick boundary that turns a steady 1 / 1 / 1 into 0 / 2 / 1 / 0 / 2
  ticks per frame: the world holds still for a frame, then jumps two (QUICKLORE's owner: "smooth jerky"). New
  `FrameSnap` (@kindling/core; a copy in net's `lockstep/pace.ts`, which doesn't depend on core): a frame time within
  6% of a tick of 1/4, 1/3, 1/2, 1 or 2 ticks counts as exactly that, and what it shaves is kept as a debt and paid
  back once it reaches a tick (no drift from the wall clock). `FixedLoop` snaps by default (`snap: false` to opt
  out; not in slow motion); the lockstep pacers always do. New `alpha` getters on `LockstepHost` / `LockstepGuest`
  (wall clock past the last tick, 0..1) for render interpolation, like `FixedLoop.alpha`. Tests: core "pacing: a 60 /
  120 Hz display with sub-ms wobble steps evenly (...)", "FrameSnap leaves odd frame times alone and pays back what
  it shaves"; net "pacing: at 60 Hz (vsync timestamps with sub-ms jitter) every frame steps exactly one tick, no 0 / 2
  stutter".
- Not changed: a game's own camera and render interpolation stay in the game (QUICKLORE's are in
  src/render/camera.ts, interp.ts, pixel.ts), but the lesson for `GETTING_STARTED`-style games: lock the camera to the
  interpolated player, snap camera and sprites with one rule on one grid (absolute positions snapped, then minus the
  grid-aligned camera: `snap(x - cam)` flips on float ties), and don't add look-ahead that swings on reversals.

## QUICKLORE touch controls

- **New: `TouchPad` in @kindling/input** (a touchscreen as a pad, family `touch`). A `PadProvider`, so seats, the
  game's bindings by canonical button, prompts, `MenuNavigator` and lockstep online all work unchanged: the sim only
  ever sees commands. Floating or fixed stick (deadzone rescaled so its edge isn't a jump, full tilt at the radius,
  the centre follows a thumb dragged past the radius so reversing is instant, analog or 8-way), multi-touch buttons
  (round or rect, hold, tap latched for one poll, slide to a neighbour with a little hysteresis, pointercancel /
  blur / hidden page release everything), a second finger in the stick zone ignored (palms), taps off the controls
  queued for the game's menus. `attach(el)`: pointer events with capture, `touch-action: none`, no scroll / pinch /
  double-tap zoom / long-press menu / selection. New family `"touch"` (labels: the game's own). InputManager: a
  touch pad's stick skips `stickDeadzone` (it comes shaped). Tests: test/touch.test.ts (stick maths, re-centring,
  fixed vs floating, three fingers in one frame, tap latch, slide, cancel, palm, taps, as a seat, buttons first laid
  out after joining).
- **Found on the way: an ExternalPad device binds only the buttons it reports when it's first seen** (readExternal
  filters the defaults by `p.buttons` at creation). A touch pad first touched in a menu (no buttons drawn there)
  ended up with no bindings for the rest of the session. TouchPad now reports every button it ever had (and takes a
  `buttons` list up front). Left as is for HID pads (their button set is fixed).
- What stays in the game (QUICKLORE: src/app/touch.ts, src/ui/taps.ts, src/app/mobile.ts): drawing the controls in
  its own style, sizes in millimetres (CSS px are ~0.18 mm on phones, ~0.21 on tablets; no API gives the real size)
  and the safe-area insets (read through a probe element's `env(safe-area-inset-*)` padding), fading them out when
  a pad or the keyboard is used, menus by tap (each screen registers tap targets while drawing), fullscreen /
  orientation lock / audio unlock inside the DOM gesture (a rAF frame isn't one), the wake lock, a rotate screen,
  the manifest. A future `@kindling/ui` helper could take the tap-target registry; it's small and game-shaped for now.
