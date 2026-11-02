// The deterministic simulation contract. A Sim advances one fixed tick per `step(commands)` (one Command per seat),
// emits that tick's `events` for presentation (cleared at the start of the next step; the sim never reads them back)
// and can `hash()` itself for lockstep checks and the determinism baseline. It never reads the wall clock, the DOM,
// the renderer or Math.random: only its commands and its own seeded RNG.
// `SimBase` implements the bookkeeping (tick, time = tick * dt so it never drifts, events cleared per tick).
import type { SectionHashes } from "./hash.ts";

export interface Sim<State, Command, Event> {
  /** Ticks stepped so far. */
  readonly tick: number;
  /** Simulated seconds (tick * dt). */
  readonly time: number;
  /** Seconds per tick. */
  readonly dt: number;
  /** The simulation state the presentation reads. */
  readonly state: State;
  /** Events produced by the last step only. */
  readonly events: readonly Event[];
  step(commands: readonly Command[]): void;
  hash(): number;
  /** Optional per-section hashes for desync diagnosis. */
  sections?(): SectionHashes;
}

export abstract class SimBase<State, Command, Event> implements Sim<State, Command, Event> {
  tick = 0;
  readonly events: Event[] = [];
  abstract readonly state: State;

  constructor(readonly dt: number) {}

  get time(): number {
    return this.tick * this.dt;
  }

  step(commands: readonly Command[]): void {
    this.events.length = 0;
    this.update(commands);
    this.tick++;
  }

  emit(e: Event): void {
    this.events.push(e);
  }

  /** One tick of game logic. `this.tick` is the tick being simulated (0 for the first step). */
  protected abstract update(commands: readonly Command[]): void;
  abstract hash(): number;
}

/**
 * Step a sim headless until `done` (or `maxTicks`), with commands from `commands(sim)` (e.g. CPU bots). The
 * bread and butter of determinism cases and balance runners.
 */
export function runSim<S extends Sim<unknown, C, unknown>, C>(
  sim: S,
  commands: (sim: S) => readonly C[],
  opts: { maxTicks?: number; done?: (sim: S) => boolean } = {},
): S {
  const max = opts.maxTicks ?? Infinity;
  while (sim.tick < max && !opts.done?.(sim)) sim.step(commands(sim));
  return sim;
}
