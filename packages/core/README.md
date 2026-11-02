# @kindling/core

The deterministic simulation toolkit and client loop: seeded RNGs, state and section hashing, a `Sim` contract with a
fixed-step `FixedLoop`, a determinism harness with a baseline CLI, helpers for sharded headless runs (env config,
`MUT` data mutation for A/B, JSONL results, a detached launcher, balance reports), a perf meter and date-window
holidays.

## Why

- [One deterministic simulation](../../docs/LESSONS.md#architecture): one `World` stepped at a fixed tick from one
  `Command` per seat, only a seeded RNG, events per tick for presentation. That rule bought lockstep online play,
  headless balance sims, bots, replays and RL. `Sim`, `SimBase`, `Mulberry32`, `ParkMiller`, `RngStreams`.
- [A determinism check guards the sim](../../docs/LESSONS.md#architecture), with each case run twice in-process to
  catch hidden state, and [hash sections, not just the world](../../docs/LESSONS.md#architecture) so a desync says
  where. `Hasher`, `sectionHashes`, `defineDeterminismCases`, `runDeterminism`.
- [Fixed tick with an accumulator; cap catch-up steps](../../docs/LESSONS.md#simulation). `FixedLoop`.
- [Headless sims sharded over all cores](../../docs/LESSONS.md#balance-and-testing) with `SHARD/SHARDS`, `setsid
nohup`, a `DONE` file and one blocking wait; [data-driven tuning](../../docs/LESSONS.md#architecture) mutated by
  `MUT="path=value"` for A/B. `shardOf`, `envConfig`, `applyMut`, `writeLauncher`, `winRates`, `matchupGrid`.
- [Budget for the weakest machine; measure with a `?perf` overlay](../../docs/LESSONS.md#rendering-threejs).
  `PerfMeter`, `Ring`, `drawPerf`.
- [Presentation-only features stay out of the sim](../../docs/LESSONS.md#architecture) and
  [holiday tweaks by date window with a URL override and an option toggle](../../docs/LESSONS.md#deployment).
  `Holidays`.

## API

Main entry `@kindling/core` (browser-safe, no node imports):

| Module      | Exports                                                                                                                                                                                                                                                                 |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| rng         | `Mulberry32`, `ParkMiller` (classes with `next/u32/int/range/chance/pick/shuffle/split`, settable `state`), `mulberry32(seed)` / `parkMiller(seed)` function forms (bit-identical to Grudge's), `RngStreams` (named independent streams), `mixSeed`, `seedOf`, `fmix32` |
| math        | `clamp`, `lerp`, `approach`, `quantize`, `wrapAngle`, `angleDiff`, `dist2` (IEEE-exact operations only)                                                                                                                                                                 |
| hash        | `Hasher` (incremental FNV-1a: `u32/i32/q(quantized)/f(exact)/bool/str/arr/value`, `digest/hex`), `fnv1a`, `hashValue`, `sectionHashes(parts, tick)`, `diffSections`, `hex32`                                                                                            |
| sim         | `Sim<State, Command, Event>` (`tick`, `time`, `dt`, `state`, `events`, `step(cmds)`, `hash()`, optional `sections()`), `SimBase` (bookkeeping: events cleared per step, `time = tick * dt`, `emit`), `runSim(sim, commands, { maxTicks, done })`                        |
| loop        | `FixedLoop({ dt, step, maxSteps = 5, maxFrame = 0.25 })`: `advance(frameSeconds)`, `alpha`, `hitstop(s)`, `paused`, `timeScale`, `dropped`; `animationFrames(frame)`                                                                                                    |
| determinism | `defineDeterminismCases(cases, run, name?)`, `runSuite(suite, { repeat = 2, only })`, `compareBaseline(run, baseline)` (ok / DIFF with sections / NEW / GONE / HIDDEN STATE / ERROR), `toBaseline`                                                                      |
| headless    | `shardOf(list, shard, shards)`, `shardEnv(env)`, `envConfig(defaults, env)`, `parseMut`, `applyMut(data, mut)`                                                                                                                                                          |
| report      | `winRates`, `matchupGrid`, `distribution`, `tally`, `percentileSorted`, `formatTable`, `formatWinRates`, `formatGrid`, `formatDistribution`                                                                                                                             |
| perf        | `Ring(size)` (`push`, `percentile`, `mean`, `max`, `values`), `PerfMeter({ now, enabled })` (`begin`, `cpu(key, t0)`, `stat`, `end`, `snapshot`, `spikes`, `lines`), `drawPerf(ctx, meter)`                                                                             |
| holidays    | `Holidays<N>({ search, param, today })` (`register(name, window)`, `on`, `allOn`, `active`, `toLoad`, `forced`, `enabled`), `daysAround`, `dateRange`, `nthWeekday`, `daysBetween`                                                                                      |

Node entry `@kindling/core/node`: `runDeterminism(suite, { baselinePath, argv, mode })`, `readBaseline`,
`jsonlWriter(path)`, `readJsonl`, `readJsonlAll(dir)`, `launcherScript(opts)`, `writeLauncher(path, opts)`, `shq`.

Command packing for the network lives in `@kindling/net`.

## Usage

A sim and its client loop:

```ts
import { FixedLoop, Mulberry32, SimBase, animationFrames, sectionHashes } from "@kindling/core";

class World extends SimBase<State, Command, GameEvent> {
  state = initialState();
  rng = new Mulberry32(seed);
  protected update(cmds: readonly Command[]) {
    /* game logic; this.emit({ type: "hit", ... }) */
  }
  sections() {
    return sectionHashes(
      {
        players: (h) => this.state.players.forEach((p) => h.q(p.x).q(p.z).i32(p.hp)),
        rng: (h) => h.u32(this.rng.state),
      },
      this.tick,
    );
  }
  hash() {
    return this.sections().total;
  }
}

const loop = new FixedLoop({ dt: world.dt, step: () => world.step(commandsFor(world)) });
animationFrames((dt) => {
  loop.advance(dt);
  audio.handle(world.events);
  view.render(loop.alpha);
});
```

`tools/determinism.ts` (run before every commit, `--write` only for intended sim changes):

```ts
import { defineDeterminismCases, runSim } from "@kindling/core";
import { runDeterminism } from "@kindling/core/node";

const suite = defineDeterminismCases([{ name: "duel-11", seed: 11, seconds: 120 }], (c) => {
  const w = new World(c.seed);
  const bots = [new Bot(0, c.seed), new Bot(1, c.seed + 1)];
  runSim(w, (w) => bots.map((b) => b.command(w)), { done: (w) => w.over || w.time >= c.seconds });
  return w.sections();
});
process.exitCode = runDeterminism(suite, { baselinePath: "tools/determinism.baseline.json" }).code;
```

A sharded balance run:

```ts
// tools/balance.ts, run by each shard
const { shard, shards } = shardEnv(process.env);
const cfg = envConfig({ GAMES: 20, FOCUS: "", MUT: "" });
const data = applyMut(structuredClone(baseData), cfg.MUT);
const out = jsonlWriter(null); // stdout -> OUT/shard-i.jsonl
for (const job of shardOf(jobs(cfg), shard, shards)) out.write(play(job, data));

// once: write the launcher, start it, block once, report
writeLauncher("runs/ab/run.sh", {
  shards: 16,
  outDir: "runs/ab",
  env: { GAMES: 2, MUT: "heroes.knight.hp*=1.1" },
  command: "node --experimental-transform-types --no-warnings tools/balance.ts",
});
// $ runs/ab/run.sh && runs/ab/run.sh wait
console.log(formatWinRates(winRates(readJsonlAll("runs/ab"))));
```

## In Grudge

- `World.rng` was `mulberry32(seed)` and every `Bot` had its own Park-Miller `rand()`; both are reproduced bit for bit
  (the tests compare against copies of the originals).
- `tools/determinism.ts` ran five seeded CPU matches and compared `worldHash` against
  `tools/determinism.baseline.json`; `runDeterminism` reads that plain `{ name: hash }` format and adds the
  in-process double run and section names.
- The frame loop (`src/app/loop.ts`, `match.ts stepWorld`) is `FixedLoop`: `maxTicksPerFrame` catch-up cap, backlog
  dropped, `acc / dt` as the render alpha.
- Balance, eval and profile runners used `SHARD/SHARDS` round-robin, JSONL lines and `MUT` A/B mutations;
  `src/perf.ts` was the `?perf` overlay; `src/game/holidays.ts` the Thanksgiving / Halloween / Christmas windows.
