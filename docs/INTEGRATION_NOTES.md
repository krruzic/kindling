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
