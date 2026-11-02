# Kindling

A small TypeScript engine for couch-and-online party games in the browser, extracted from building **Grudge** (a 2v2
arena RTS in three.js) and the games that followed it. It is a set of focused packages rather than a framework: take
the pieces you need, keep your game's own architecture.

Read [docs/LESSONS.md](docs/LESSONS.md) first: every package exists because of a lesson in it. To start a game,
follow [docs/GETTING_STARTED.md](docs/GETTING_STARTED.md).

| Package                               | What it gives you                                                                                                                                                                                                                                                        |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [`@kindling/core`](packages/core)     | Deterministic sim toolkit: seeded RNGs, state/section hashing, fixed-tick loop, determinism harness, sharded headless runners and A/B data mutation, perf stats, holiday windows                                                                                         |
| [`@kindling/input`](packages/input)   | Gamepads (Xbox, PlayStation, Switch Pro, GameCube adapters, Switch 2 Pro), keyboard halves, seats, robust analog triggers, per-device remapping, guided remap, prompt glyphs, menu navigation                                                                            |
| [`@kindling/net`](packages/net)       | WebSocket room relay (dev plugin + production), host-authoritative lockstep with input delay, hash checks, desync reports, stalls, CPU takeover, rejoin by replay, mirrored lobbies                                                                                      |
| [`@kindling/ui`](packages/ui)         | Canvas UI layer: virtual resolution, bitmap fonts, text that never overflows, 9-slice panels, menus, options rows, prompt footers, cards, banners, screen stack, split-screen layouts, overflow/overlap debug overlay                                                    |
| [`@kindling/audio`](packages/audio)   | WebAudio sample bank, voice budget and priority, buses, ducking, spatial hearing for split screen, ambience beds, music per screen                                                                                                                                       |
| [`@kindling/save`](packages/save)     | Versioned localStorage saves: schema defaults, migrations, options, names, records                                                                                                                                                                                       |
| [`@kindling/three`](packages/three)   | three.js helpers: asset cache, socket-composed models, team dyeing, animation controller, instanced particles and glows, weather and string lights, follow and arena cameras, adaptive resolution, GPU stats                                                             |
| [`@kindling/assets`](packages/assets) | Asset pipeline: fal.ai (Nano Banana, Tripo, ElevenLabs) with cost logging, sheet slicing and keying, contact sheets, headless Blender modules (texture bakes, sockets, rig transfer, thumbnails, verification), licence registry, screenshot harness, RL training bridge |
| [`@kindling/server`](packages/server) | Production static server with precompression and the relay on one port, Docker and deploy templates                                                                                                                                                                      |

## Status

| Package            | Status                                                                          | Tests |
| ------------------ | ------------------------------------------------------------------------------- | ----- |
| `@kindling/core`   | stable, used by the example                                                     | 39    |
| `@kindling/input`  | stable, used by the example                                                     | 46    |
| `@kindling/net`    | stable, used by the example                                                     | 15    |
| `@kindling/ui`     | stable, used by the example                                                     | 40    |
| `@kindling/audio`  | stable, used by the example                                                     | 17    |
| `@kindling/save`   | stable, used by the example                                                     | 11    |
| `@kindling/three`  | stable, used by the example                                                     | 24    |
| `@kindling/assets` | stable, used by the example (fal tools untested against the live API by design) | 12    |
| `@kindling/server` | stable, used by the example                                                     | 10    |
| `examples/brawl`   | complete example game                                                           | 11    |

What integrating them into one game found and fixed: [docs/INTEGRATION_NOTES.md](docs/INTEGRATION_NOTES.md).

## Example: BRAWL

[`examples/brawl`](examples/brawl) is a small, finished game wired through every package: a top-down 3D rover sumo
brawler for 1-4 players (couch, online, CPUs). Rovers are assembled from Blender-made parts by sockets and dyed per
player; blast, dash and slam the others off a floating platform, first to three rounds. It has a title, menus,
options, a controller page with remapping, a four-seat select screen that doubles as the online lobby, a HUD,
pause and results; procedural sound and music; saves with a migration; a determinism baseline, a sharded balance
runner, screenshot checks of every screen, a two-page online test, an RL env, a production server and a
Dockerfile.

```sh
pnpm -C examples/brawl dev                       # play (online works on the same port)
pnpm -C examples/brawl determinism --check       # sim guard
pnpm -C examples/brawl shots                     # every screen, layout-checked
pnpm -C examples/brawl online-test               # two browser pages, one match
```

## Working on Kindling

```sh
pnpm install
pnpm -r typecheck
pnpm -r test
```

Packages are consumed as TypeScript source (Vite in the browser, `node --experimental-transform-types` in node), so
there is no build step. Conventions: [docs/CONVENTIONS.md](docs/CONVENTIONS.md).
