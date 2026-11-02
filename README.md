# Kindling

A small TypeScript engine for couch-and-online party games in the browser, extracted from building **Grudge** (a 2v2
arena RTS in three.js) and the games that followed it. It is a set of focused packages rather than a framework: take
the pieces you need, keep your game's own architecture.

Read [docs/LESSONS.md](docs/LESSONS.md) first: every package exists because of a lesson in it.

| Package | What it gives you |
| --- | --- |
| [`@kindling/core`](packages/core) | Deterministic sim toolkit: seeded RNGs, state/section hashing, fixed-tick loop, determinism harness, sharded headless runners and A/B data mutation, perf stats, holiday windows |
| [`@kindling/input`](packages/input) | Gamepads (Xbox, PlayStation, Switch Pro, GameCube adapters, Switch 2 Pro), keyboard halves, seats, robust analog triggers, per-device remapping, guided remap, prompt glyphs, menu navigation |
| [`@kindling/net`](packages/net) | WebSocket room relay (dev plugin + production), host-authoritative lockstep with input delay, hash checks, desync reports, stalls, CPU takeover, rejoin by replay, mirrored lobbies |
| [`@kindling/ui`](packages/ui) | Canvas UI layer: virtual resolution, bitmap fonts, text that never overflows, 9-slice panels, menus, options rows, prompt footers, cards, banners, screen stack, split-screen layouts, overflow/overlap debug overlay |
| [`@kindling/audio`](packages/audio) | WebAudio sample bank, voice budget and priority, buses, ducking, spatial hearing for split screen, ambience beds, music per screen |
| [`@kindling/save`](packages/save) | Versioned localStorage saves: schema defaults, migrations, options, names, records |
| [`@kindling/three`](packages/three) | three.js helpers: asset cache, socket-composed models, team dyeing, animation controller, instanced particles and glows, weather and string lights, follow and arena cameras, adaptive resolution, GPU stats |
| [`@kindling/assets`](packages/assets) | Asset pipeline: fal.ai (Nano Banana, Tripo, ElevenLabs) with cost logging, sheet slicing and keying, contact sheets, headless Blender modules (texture bakes, sockets, rig transfer, thumbnails, verification), licence registry, screenshot harness, RL training bridge |
| [`@kindling/server`](packages/server) | Production static server with precompression and the relay on one port, Docker and deploy templates |

`examples/` holds a complete small game wired through every package.

## Working on Kindling

```sh
pnpm install
pnpm -r typecheck
pnpm -r test
```

Packages are consumed as TypeScript source (Vite in the browser, `node --experimental-transform-types` in node), so
there is no build step. Conventions: [docs/CONVENTIONS.md](docs/CONVENTIONS.md).
