# BRAWL

A small, complete game built on every Kindling package: a top-down 3D **rover sumo brawler** for 1-4 players on one
couch, online, or against CPUs. Knock the other rovers off a floating platform; last rover on it takes the round,
first to three rounds wins. It is the integration proof for the engine and the template for new games
([docs/GETTING_STARTED.md](../../docs/GETTING_STARTED.md)).

- **BLAST** (A): a short cone blast in front of you. **DASH** (B): a burst that rams whoever it hits.
  **SLAM** (X / triggers): a charged ground slam that throws everyone near you. Knockback grows with damage %.
- Three rovers: **SCOUT** (light, fast), **BRUTE** (heavy plow), **SPARK** (coil rover, the big slam).
- After 45 s the ring shrinks (sudden death).

## Run it

```sh
pnpm install                       # at the repository root
pnpm -C examples/brawl dev         # Vite on :5173, with the online relay mounted by the @kindling/net plugin
pnpm -C examples/brawl serve       # production: build, precompress, @kindling/server + relay on :8080
docker build -f examples/brawl/Dockerfile -t brawl . && docker run -p 8080:8080 brawl   # from the repo root
```

Keyboard: left half WASD + Space / Shift / E (C adds a CPU, Esc pauses), right half arrows + . , / (Enter pauses).
Any gamepad works (Xbox, PlayStation, Switch Pro, GameCube adapters; "FIND USB / GAMECUBE PADS" on the controllers
page for WebHID). On the select screen any device joins by pressing a button.

## Checks

| Command                                             | What                                                                                                                                                                                                                              |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm test`                                         | sim determinism, CPU matches finish, codec, MUT tuning, save migration, RL env, and headless online play: host + 2 guests (one with two players) over `@kindling/net/memory` with identical hashes, drop -> CPU, rejoin by replay |
| `pnpm determinism --check`                          | five seeded CPU matches against `tools/determinism.baseline.json` (`--write` only for intended sim changes)                                                                                                                       |
| `pnpm balance`                                      | sharded headless CPU matches (`GAMES=4 SHARDS=4 MUT="rovers.brute.mass*=0.9"`), report in `runs/balance/report.txt`                                                                                                               |
| `pnpm shots [dir]`                                  | every screen at 1920x1080 and 1280x720 through `@kindling/assets`' harness; fails on console errors and on any layout-debugger issue                                                                                              |
| `pnpm online-test [--prod]`                         | two browser pages: host + join by code, both play round 1, compare hashes, guest reloads and rejoins                                                                                                                              |
| `pnpm env-smoke`                                    | the RL env server (`tools/env.ts`) over the env protocol, 100 random steps                                                                                                                                                        |
| `pnpm credits`                                      | `assets.credits.json` covers every asset file                                                                                                                                                                                     |
| `pnpm parts` / `pnpm sfx` / `python3 tools/font.py` | regenerate rover parts (Blender, CPU), sound effects, the atlas font                                                                                                                                                              |

## Debug URLs

`?screen=title|menu|options|controls|online|credits|select|name|match|pause|results|quit`, `?players=2..4`,
`?seed=N`, `?t=<seconds of match pre-roll>`, `?perf` (perf overlay: frame times, CPU per section, draw calls, GPU ms,
adaptive scale), `?layoutdebug` (red outlines; issues in `window.game.layoutIssues`), `?holiday=xmas|none`, `?mute`,
`?pads=xbox,ps,switch,gc&join` (fake gamepads), `?host=NAME`, `?room=CODE&name=NAME`.

## Where things are, by package

| Package | In BRAWL                                                                                                                                                                                                                                                                         |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| core    | `src/sim/world.ts` (a `SimBase` with seeded `Mulberry32`, section hashes), bots on `ParkMiller`, `FixedLoop` in `src/app/match.ts`, `tools/determinism.ts`, `tools/balance.ts` (shards, `MUT`, JSONL, report), `Holidays` (snow in December), `PerfMeter` + `drawPerf` (`?perf`) |
| input   | `src/app/controls.ts`: actions, family defaults, two keyboard halves, HID providers, remaps in the save, command latch, `MenuNavigator`, glyphs (`mode: "auto"`); seats with press-to-join on the select screen; the controllers page (single + guided remap, raw readout)       |
| net     | `src/net/session.ts` (`LobbyHost`/`LobbyGuest` mirroring the select state, `LockstepHost`/`LockstepGuest`, CPU takeover, rejoin), room list + code in `src/ui/screens/online.ts`, the relay's Vite plugin in `vite.config.ts`                                                    |
| ui      | `src/ui`: wood theme with the Barlow atlas font, `ScreenManager`, `MenuList`, `OptionsPage` (sliders, choices, toggles, keybind rows), `Dialog`, `NameEntry`, `Callouts`, prompt bars, `LayoutDebug`                                                                             |
| audio   | `src/app/sound.ts`: sample bank from `assets/sfx`, music per screen rendered by `src/audio/synth.ts` through `MusicPlayer`'s load hook, ambience beds, spatial `place`, ducking                                                                                                  |
| save    | `src/app/save.ts`: options, names per seat, per-rover records and bests, match log, pad remaps; version 2 with a v1 migration                                                                                                                                                    |
| three   | `src/view/view.ts`: `AssetCache`, `assembleBySockets` + `dyeTeam`, turret clips via `AnimationController`, `Particles`, `GlowSprites`, `DecalLayer`, `ArenaCamera`, `AdaptiveResolution`, `RenderStats`/GPU timer, `snowfall` + `StringLights`, `mergeStatic`                    |
| assets  | Blender modules in `tools/parts.py`, `assets.credits.json`, `tools/shots.ts` (screenshot harness with layout checks), `tools/env.ts` (RL bridge)                                                                                                                                 |
| server  | `tools/server.ts` (static + relay on one port), `Dockerfile` from the template                                                                                                                                                                                                   |

No third-party art or sound: parts are built by a Blender script, sounds and music are synthesised, the only
download is the Barlow font (OFL).
