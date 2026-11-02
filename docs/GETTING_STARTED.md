# Getting started: a new game from examples/brawl

`examples/brawl` is a complete small game wired through every package. The fastest way to a new game is to copy
it, keep the plumbing and replace the game. This walks through it. Read [LESSONS.md](LESSONS.md) first; most of the
structure below exists because of a lesson there.

## 1. Copy and rename

```sh
cp -r examples/brawl examples/mygame
rm -rf examples/mygame/{node_modules,release,runs}
```

- `package.json`: `"name": "@kindling/example-mygame"` (or anything; it is a workspace package, `examples/*`).
- `src/app/app.ts`: `BUILD` (online peers on another build are refused, so bump it when the sim changes).
- `src/net/session.ts`: `ROOM_KIND` (rooms of other kinds never show in your room list), and the relay's
  `kinds` in `vite.config.ts` and `tools/server.ts`.
- `src/app/save.ts`: `SAVE_KEY`, and reset `SAVE_VERSION` to 1 with no migrations.
- `index.html` title, the title screen text (`src/ui/screens/front.ts`).

Then `pnpm install` at the root and `pnpm -C examples/mygame dev`.

## 2. Where the game lives

```
src/sim/      the deterministic game: no DOM, no Date, no Math.random, no three.js
  types.ts      Spec (everything new World() needs), Command (one per seat per tick), GameEvent, tuning types
  world.ts      World extends SimBase: update(cmds) is one tick; sections() hashes players / match / rng
  bot.ts        CPU players: same Command as humans, own seeded RNG, a skill 0..1
  codec.ts      how a Command travels online (one integer) and how inputs within a tick merge
  headless.ts   playCpuMatch(): determinism cases, balance runs, tests, attract mode, RL opponents
  observe.ts    RL observation / action encoding (shared by the env and an in-game agent)
data/tuning.json  every number the balance runner may mutate (MUT="rovers.brute.mass*=0.9")
src/app/      the client: App (all client state + frame loop), controls, sound, save, select state, match drivers
src/net/      OnlineSession: lobby + lockstep over a NetLink
src/view/     the three.js view: reads the world and its events, never writes back
src/ui/       theme, kit and one file per screen group
tools/        determinism, balance, shots, online test, RL env, server, asset generators
test/         node tests (no framework)
```

The one rule: **the sim reads only its Spec, its Commands and its seeded RNG**, and only `+ - * / sqrt` on floats
(store facing as a vector, not an angle). Presentation (sound, particles, camera, UI, holidays) reads the world and
its per-tick `events`. Because of that one rule, the same `World` runs local matches, online lockstep, headless
balance runs, the attract mode and the RL env.

To replace the game: rewrite `types.ts` / `world.ts` / `bot.ts` (keep the `SimBase` shape and `sections()`), make
`codec.ts` pack your Command, then follow the type errors through `src/view`, `src/ui/screens/match.ts` (HUD) and
`src/app/sound.ts` (event -> sound). Run `pnpm determinism --write` once, commit the baseline, and from then on
`pnpm determinism --check` before every commit.

## 3. Add a mode

A mode is data in the Spec plus rules in the World. For example "teams":

1. `types.ts`: `Spec.teams?: number[]` (team per seat). Everything the world needs must be in the Spec: online
   guests build their world from it.
2. `world.ts`: use it (round over when one team is left); hash anything new in `sections()`.
3. `select.ts`: a field in `SelectState` (the host changes it with `lobby.change(...)`, guests see it mirrored) and
   in `matchSpec()`.
4. The select screen draws and edits it; the HUD and results read it.
5. A determinism case for it in `tools/determinism.ts` (`--write`, and say so in the commit), a test in
   `test/sim.test.ts`, and a job kind in `tools/balance.ts` if it needs balancing.

## 4. Online

Nothing to do for a new sim beyond a deterministic World and a codec: `OnlineSession` mirrors the select state with
`LobbyHost`/`LobbyGuest`, starts `LockstepHost` with `matchSpec()` and the lobby's seats, plays CPU seats with your
Bots on the host, turns dropped guests into CPUs and lets them rejoin by replay. Test it two ways:

- `test/online.test.ts`: host + guests over `@kindling/net/memory` (virtual clock, jitter), whole matches, hashes.
- `pnpm online-test`: two real browser pages against the dev relay (`--prod` against the production server).

The relay is the Vite plugin in dev (`vite.config.ts`) and is injected into `@kindling/server` in production
(`tools/server.ts`), on the same port as the game in both cases.

## 5. Assets

- 3D parts: `tools/parts.py` builds GLBs with `@kindling/assets`' Blender modules (CPU only):
  `nice blender -b --factory-startup -P tools/parts.py -- public/parts`. Each part has `S_*` socket empties
  (custom props become glTF extras) and a `team_paint` material; `src/view/view.ts` assembles them with
  `assembleBySockets` and dyes them with `dyeTeam`.
- Sound: `src/audio/synth.ts` + `tools/make-sfx.ts` (or real samples in `assets/sfx/<id>.<n>.wav`: variants are
  grouped by `groupVariants`). Music is rendered at runtime through `MusicPlayer`'s `load` hook; swap in files by
  giving tracks real URLs.
- Generated art (icons, sheets) goes through `@kindling/assets`' fal tools with prompts in files and a cost log.
- **Every file** under `assets/` and `public/` needs an entry in `assets.credits.json`; `pnpm credits` checks it.
- Look at it: `pnpm shots` screenshots every screen with the layout debugger on and fails on any overflow, overlap
  or console error. Add a `?screen=` route for each new screen (`App.route()`) and a line in `tools/shots.ts`.

## 6. Balance

`pnpm balance` writes a launcher, runs CPU matches sharded over cores (detached, one blocking wait), and prints win
rates per rover, the duel matchup grid, match lengths, how rovers left the ring and what the bots did. A/B a data
change without touching code: `GAMES=20 SHARDS=16 MUT="moves.special.radius*=0.9" pnpm balance`. Profile the bot
before blaming a character's kit.

## 7. Deploy

```sh
docker build -f examples/mygame/Dockerfile -t mygame:latest .     # from the repository root
IMAGE=mygame:latest HOST=me@server REMOTE_DIR=/srv/mygame URL=https://mygame.example \
  packages/server/templates/deploy.sh
```

The image builds, typechecks, precompresses and runs `tools/server.ts` (static build + relay on one port,
`/healthz`). Keep the host's browser tab in the foreground during online matches.

## Gates before every commit

`pnpm -C examples/mygame typecheck`, `test`, `determinism --check`, and prettier. Before a release: `shots`,
`online-test`, and a look at the screenshots.
