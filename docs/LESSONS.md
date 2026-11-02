# Lessons from Grudge (and RUST RING, QUICKLORE)

Kindling is the engine extracted from building Grudge, a couch/online 2v2 arena RTS in three.js, plus two follow-up
games built on the same patterns (RUST RING, a battlebot sumo game; QUICKLORE, a Link's Awakening-style party game).
This file is the "why" behind every package. When a rule here looks arbitrary, it cost us a bug.

## Architecture

- **One deterministic simulation.** A `World` stepped at a fixed tick (30 or 60 Hz) from one `Command` per seat per
  tick. It never reads the wall clock, the camera, the DOM, three.js or `Math.random`; only a seeded RNG. The
  renderer, HUD and audio *read* it and its per-tick `events`, and never write back. This one rule bought:
  lockstep online play, headless balance sims at thousands of games, CPU bots that play through the same `Command`
  as humans, replays/rejoin-by-replay, and an RL training environment.
- **Presentation-only features stay out of the sim** (holidays, cosmetics, camera, UI). Online players then never
  need to agree on them, and the determinism baseline never moves for them.
- **A determinism check guards the sim.** Run fixed seeded CPU matches, hash the world, compare to a committed
  baseline (`--check`; `--write` only for intended sim changes, and say so in the commit). Run it before every commit.
  Also run each case twice in-process: a mismatch there means hidden state (module-level caches, iteration order).
- **Hash sections, not just the world.** When a desync happens, a per-section hash (players, units, structures, rng,
  match) tells you *where* immediately.
- **Data-driven tuning** (`data/*.json`): balance changes are data edits that the headless sims can mutate
  (`MUT="path=value"`) for A/B runs without touching code.
- **One App object** holds all client state; controllers are plain functions over it; a screen state machine
  (`title -> menu -> select -> match -> results`). Debug URL params enter any state directly (`?bots=1&map=..&time=..`)
  so screenshots and tests never click through menus.
- **One 2D UI canvas over the 3D view** for HUD, menus and screens, memoised per panel (redraw only when its key
  changes). Never DOM/CSS chrome for game UI.

## Simulation

- Fixed tick with an accumulator in the client loop; cap catch-up steps (a backgrounded tab must not spiral).
- Cooldowns stored as absolute times; freeze remaining durations on death and restore on respawn.
- Events (`hit`, `kill`, `fx`...) are emitted per tick for presentation; the sim never reads them back.
- Keep per-entity caches in the World, not module scope (two Worlds in one process must not share state: the
  attract-mode world, codex demo worlds, the headless runner).
- CPU bots: keep them in the sim folder, deterministic, their own seeded RNG; a `skill` 0..1 that scales reaction
  chance and think cadence. Profile them per behaviour (how often they retreat, block, use each ability) before
  blaming a character's kit for a low win rate: twice the "weak champion" was a weak bot.

## Balance and testing

- Headless sims sharded over all cores (`SHARD/SHARDS` env, `setsid nohup`, a `DONE` file and one blocking wait).
  Full suites took ~2.5 h on 16 cores; focused A/B runs (`FOCUS=hero GAMES=2 MUT=...`) ~12 min with identical seeds.
- Report per-entity win rates, matchup grids, game length, how games end (timeout / sudden death share), and
  "why" a game ended. Prefer kit/design fixes over raw number nerfs.
- Verify visuals with real browser screenshots (playwright-core + system chromium, headless), at several
  resolutions (1920x1080, 1280x720, 16:10), and *look at them*. Most UI bugs we shipped were visible in a screenshot
  nobody looked at: overlapping panels, text overflowing cards, the footer covered, wrong arrow direction.
- Test online with several headless pages (host + guests, including guests with several local seats each), assert
  identical final hashes/winners, cut a socket mid-match (reconnect), close a page (CPU takeover).
- An RL agent (PPO on CPU, the sim as a gym-like env over stdin/stdout) beat our scripted bot by finding real
  strategies (parry-chaining, constant blocking); profiling its behaviour vs the CPU's taught us what to add to the
  scripted bot. Keep the env observation/action code shared with the in-game agent bot and verify byte-identical.

## Input

- Every device becomes a `PadState` per seat; a `CommandMapper` turns it into the game `Command`. Keyboard halves
  (WASD / arrows) are seats too.
- Support what couch players actually own: standard gamepads (Xbox, PlayStation, Switch Pro), GameCube adapters
  (WebUSB/WebHID; Mayflash in PC mode; Linux uinput drivers), Switch 2 Pro over WebHID (needs a wake packet).
- Analog triggers: count a press if EITHER the digital click OR the analog travel passes a threshold, with
  hysteresis; learn the resting value (some rest half-pressed); ignore a channel that is stuck; handle triggers on
  odd axes. A modded GameCube pad with one dead channel otherwise loses L or R entirely.
- Remapping per device (keyed by the Gamepad id / adapter port), saved, applied on reconnect, guided "press every
  button" mode, can't trap a single-controller user (hold to skip, timeout). Prompts in menus still show the GAME's
  button letters (A / B), not the remapped physical labels ("BTN 11" everywhere was hated).
- Menu navigation with key repeat; any device press joins a seat on select screens.
- Debug readout of raw values per device: invaluable when a player's controller "doesn't work".

## Online (lockstep)

- A dumb relay (WebSocket rooms: host opens, peers join; "up" to host, "send" to peers; room list with LAN
  addresses and a kind/mode field) served by the dev server (Vite plugin) and by the production static server on
  the same port. The relay never runs the game.
- Host-authoritative lockstep: each tick the host merges every guest's commands (input delay of a few ticks +
  one RTT) with its own and its CPUs', steps, broadcasts the packed frame, and every 30 ticks a world hash (+ section
  hashes). Guests step only on received frames.
- Heartbeats must tolerate short silences: dropping after 3-6 s killed a LAN game night; use ~3 missed pings (~10 s+).
- Guests may bring several local seats (the case that broke in our 8-player test).
- Robustness: version/build check on join; "waiting for P3..." stall overlay; a dropped guest becomes a CPU after a
  grace period; rejoin by replaying all frames; host leaving ends it with a clear message. The host's tab must stay
  in the foreground (browsers throttle background tabs).
- Online pause opens a local menu; the sim keeps running (pausing everyone for one player's menu froze matches).

## Rendering (three.js)

- Budget for the weakest machine you'll play on (a Ryzen 5 3400G iGPU at 1080p): measure draw calls and GPU time
  with an in-game `?perf` overlay; instanced particles; additive fake glow sprites instead of real lights; one
  shadow-casting light with a small map; one full-screen post pass at most; adaptive render scale stepping down
  when frames run long.
- Cameras: a spring-follow plus a velocity lookahead plus pixel rounding *jitters* (it corrects by a pixel back and
  forth, and drifts after stopping). Lock the target to the player's rounded position and ease only a whole-pixel
  lean toward a *steady* direction.
- Composable models: every part its own GLB with named socket empties (and custom props as glTF extras); the
  runtime assembles by sockets; team colour via a dedicated material name that is dyed at runtime.
- Never run GPU compute (ROCm/CUDA hacks) on the machine driving the desktop: an SDMA hang killed the whole GNOME
  session and everything in it.

## UI

- Draw everything on canvas with the game's own art: a bitmap/atlas font, 9-slice panels, painted icons. Generic
  drawn boxes and system fonts read as "vibe-coded".
- Measure every string before drawing; shrink or wrap within the card; never overflow. Cards grow to content.
- Real art for every entry (icons per boon/item/node); never reuse an unrelated icon as a stand-in.
- State must be readable at a glance (reachable / locked / cleared / current on map nodes).
- Selection cursors point AT the thing they select (a left-pointing arrow reads as "back").
- Footer prompt rows show the right glyphs per device (keyboard keys, Xbox, PlayStation, Switch, GameCube).

## Audio

- WebAudio with a sample bank (variants per id, jitter), a voice budget with priority, buses (sfx/music/ambience),
  spatial placement relative to the listener(s) in split screen.
- A looped sound must always get its scheduled stop (Ceefax static looped forever because the stop was only
  scheduled when `dur` was shorter than the sample).

## Asset pipeline

- Assets are generated by scripts (Blender headless `blender -b -P`, Pillow, procedural textures baked to images)
  and never hand-edited, so they are reproducible.
- fal.ai: Nano Banana (image gen/edit) for sheets of many icons at once on a flat chroma background, sliced and keyed;
  Tripo for image-to-3D meshes, then rigged onto existing rigs by script; ElevenLabs for sfx. Batch to save credit,
  log every call and its cost, keep prompts in files, keep raw outputs so slicing is reproducible.
- Check every downloaded asset's licence and record attribution (CC BY-SA needs credit).
- Paid tilesets: fine in a private repo, never publish.

## Deployment

- Docker image: static build + the relay in one node server on one port; `docker save | ssh host 'docker load'`;
  `docker-compose up -d`. Precompress static assets.
- Holiday tweaks by date window with a URL override and an option toggle; their assets only load inside the window.

## Process

- A design log (`docs/decisions.md`): one line per change, what and why.
- Gates before every commit: typecheck, determinism check, prettier.
- Build feel first: a whole game nobody had touched with a controller (RUST RING) "kinda sucked". Get a playable
  slice into hands early and iterate on feel before content.
