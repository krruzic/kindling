# @kindling/audio

A small WebAudio engine for games: a sample bank with variants, a voice budget with priority, sfx / music /
ambience buses with ducking, synth blips and noise sweeps, spatial hearing per listener for split screen, ambience
beds and positional loops, and per-screen music with crossfades. Game-agnostic: which event plays which sound is
the game's mapping; this package only plays.

## Why

See [docs/LESSONS.md](../../docs/LESSONS.md), section **Audio** (and **Architecture**: audio only reads the world
and its events, never writes back):

- A sample bank with several variants per id plus pitch jitter keeps repeated sounds from machine-gunning.
- A voice budget with priority: a 4-player brawl can trigger hundreds of sounds a second; the important ones
  (announcer, UI, your own hits) must still play.
- Buses (sfx / music / ambience) so options sliders and ducking work on groups.
- Spatial placement relative to the listener(s): in split screen each view is a listener, panned by its slice of
  the screen.
- **A looped sound must always get its scheduled stop.** Grudge's Ceefax static looped forever because the stop was
  only scheduled when `dur` was shorter than the sample. Here a loop with a duration always gets its stop; open
  loops return a `Voice` to stop, and `stopLoops()` / `Ambience.stop()` clean up.

## API

| Export                                                       | What                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AudioEngine`                                                | `unlock()` (from a gesture) / `attachUnlock(target)`; `ready`, `now`; `bus(name)`, `setLevel(name, 0..1)` (squared curve by default), `level(name)`; `play(id, gain, opts)` -> `Voice` (`rate`, `at`, `jitter`, `priority` (true = always, number = may steal lower), `quiet`, `loop`, `dur`, `bus`, `place`, `offset`, `fadeIn`); `tone({ from, to, dur, gain })`; `hiss({ freq, q, dur, gain, filter, sweepTo })`; `duck(buses, depth, { attack, hold, release })`; `allow(key, max)` + `frame()` per-frame caps; `stopLoops()`, `stopAll()`; `voices`, `maxVoices`, `busyUntil`, `log`. Options: `maxVoices`, `volume`, extra `buses` (`{ parent, level, trim }`), `curve`, `createContext` (fakes), `rng`. |
| `Voice`                                                      | `id`, `src`, `gain`, `priority`, `loop`, `endsAt`, `ended`, `stop(fade)`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `SampleBank`, `groupVariants`                                | `register(groupVariants(globUrls))` ("hit.0.ogg", "hit.1.ogg" -> "hit"), `load(ctx)` (beds last, failures skipped), `add(id, buffer)`, `pick(id)` (never the same variant twice in a row), `has`, `missing`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `place`, `lean`, `Hearing`, `Listener`, `Place`, `viewSlice` | Listener = ground position, `range`, screen slice (`left`, `span`), optional `project()`. Loudest view wins; panned by screen slice; off-screen sounds are quieter and muffled; your own sounds have a floor. `lean` = global sound that still pans toward where it happened.                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `Ambience`                                                   | `setBeds([{ id, level }])` (fade in from a random offset; replaced beds fade out with a scheduled stop), `emitter(kind, id, level, points, hearing)` per frame (loop following the loudest emitter), `critters([{ id, lo, hi }])`, `stop()`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `MusicPlayer`                                                | `new MusicPlayer(engine, { menu: { url, loopEnd } })`; `set(name \| null, duck)`, `update()` per frame: lazy load, crossfade with scheduled stops, duck, background prefetch.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

## Usage

```ts
import { AudioEngine, Ambience, MusicPlayer, groupVariants, place } from "@kindling/audio";

const audio = new AudioEngine({ maxVoices: 56 });
audio.bank.register(groupVariants(import.meta.glob("./sfx/*.ogg", { query: "?url", import: "default", eager: true })));
audio.attachUnlock(window);
const music = new MusicPlayer(audio, { menu: { url: menuUrl }, battle: { url: battleUrl, loopEnd: 127.06 } });
const ambience = new Ambience(audio);

// every frame
audio.frame();
music.set(screen === "match" ? "battle" : "menu", paused ? 0.4 : 1);
music.update();
for (const ev of world.events) {
  const where = place(hearing, ev.x, ev.y, ev.z, ev.owner); // null = nobody hears it
  if (where && ev.type === "hit" && audio.allow("hit", 4)) audio.play("hit", 0.8, { place: where });
}
ambience.setBeds(map.beds);
ambience.emitter("torch", "bed.fire", 0.35, map.torches, hearing);
```

## Demo

`pnpm --filter @kindling/audio demo` (or `vite packages/audio/demo`): buttons for every feature with samples
synthesised at runtime, a live voice / loop counter, and a two-view strip to hear split-screen panning.

## In Grudge

Generalised from Grudge's `src/audio`: `bank.ts` (variant bank from a glob), `sfx.ts` (the `Audio` class: buses,
`MAX_VOICES`, priority, jitter, `play` / `tone` / `hiss`, `impact()` ducking, the loop-stop fix, music per screen
with crossfade and duck), `spatial.ts` (hearing per split-screen view, own-sound floor, muffling) and `tracker.ts`
(map ambience beds, positional torch / fountain loops, critters). Grudge's `events.ts` (sim event -> recipe) and
the per-hero voice / footstep tables stay in the game.
