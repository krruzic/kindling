// Match drivers: the one place the client steps a World. A LocalMatch runs it on @kindling/core's FixedLoop (couch
// players' latched commands + Bots for CPU seats, hitstop on big hits, pause); an OnlineMatch lets the
// OnlineSession's lockstep step it and drains the events. Both hand every stepped tick's events to the same
// presentation callback (view, sound, HUD), so local and online play look and sound identical.
import { FixedLoop } from "@kindling/core";
import { Bot } from "../sim/bot.ts";
import { baseTuning, type Command, type GameEvent } from "../sim/types.ts";
import { World } from "../sim/world.ts";
import type { OnlineSession } from "../net/session.ts";
import type { MatchSpec } from "./select.ts";

export interface MatchDriver {
  readonly world: World;
  readonly spec: MatchSpec;
  readonly online: boolean;
  /** Render interpolation between the last two ticks. */
  readonly alpha: number;
  paused: boolean;
  /** Advance by a frame; `cmd(seat)` gives a local seat's command for each tick. */
  update(dt: number, now: number): void;
  /** World seats played on this machine, by local input seat. */
  localSeats(): { input: number; seat: number }[];
}

export type Present = (events: readonly GameEvent[], world: World) => void;

export class LocalMatch implements MatchDriver {
  readonly world: World;
  readonly online = false;
  readonly loop: FixedLoop;
  readonly bots: (Bot | null)[];

  constructor(
    readonly spec: MatchSpec,
    /** Input seat per world seat (-1: CPU). */
    readonly inputs: number[],
    skills: number[],
    command: (input: number) => Command,
    present: Present,
    beforeStep: () => void,
  ) {
    this.world = new World(spec, baseTuning());
    this.bots = inputs.map((inp, seat) => (inp < 0 ? new Bot(seat, spec.seed, skills[seat] ?? 0.65) : null));
    this.loop = new FixedLoop({
      dt: this.world.dt,
      maxSteps: 4,
      step: () => {
        beforeStep();
        const w = this.world;
        const cmds = this.inputs.map((inp, seat) => (inp < 0 ? this.bots[seat]!.command(w) : command(inp)));
        w.step(cmds);
        for (const e of w.events) if (e.type === "fall" || (e.type === "hit" && e.power > 14)) this.loop.hitstop(0.06);
        present(w.events, w);
      },
    });
  }

  get alpha(): number {
    return this.loop.alpha;
  }

  get paused(): boolean {
    return this.loop.paused;
  }

  set paused(v: boolean) {
    this.loop.paused = v;
  }

  update(dt: number): void {
    this.loop.advance(dt);
  }

  localSeats(): { input: number; seat: number }[] {
    return this.inputs.flatMap((input, seat) => (input >= 0 ? [{ input, seat }] : []));
  }
}

export class OnlineMatch implements MatchDriver {
  readonly online = true;
  /** Online pause is a local menu: the sim keeps running (the paused player feeds idle commands). */
  paused = false;

  constructor(
    readonly session: OnlineSession,
    readonly spec: MatchSpec,
    private present: Present,
  ) {}

  get world(): World {
    return this.session.world!;
  }

  get alpha(): number {
    return 1;
  }

  update(_dt: number, now: number): void {
    this.session.update(now);
    const evs = this.session.drain();
    if (evs.length && this.session.world) this.present(evs, this.session.world);
  }

  localSeats(): { input: number; seat: number }[] {
    const out: { input: number; seat: number }[] = [];
    for (let input = 0; input < 4; input++) for (const seat of this.session.seatsOf(input)) out.push({ input, seat });
    return out;
  }
}
