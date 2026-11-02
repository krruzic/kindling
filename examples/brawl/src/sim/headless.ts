// Headless CPU matches: the one loop shared by the determinism harness, the balance runner, the tests, the RL env's
// opponents and the title screen's attract mode. Bots are seeded from the match seed so a case is fully defined
// by its spec and skill.
import { runSim } from "@kindling/core";
import { Bot } from "./bot.ts";
import { baseTuning, type Spec, type Tuning } from "./types.ts";
import { World } from "./world.ts";

export interface CpuMatch {
  world: World;
  bots: Bot[];
}

export function cpuMatch(spec: Spec, skill: number | number[] = 0.7, tuning: Tuning = baseTuning()): CpuMatch {
  const world = new World(spec, tuning);
  const bots = spec.rovers.map((_, i) => new Bot(i, spec.seed, Array.isArray(skill) ? skill[i] : skill));
  return { world, bots };
}

/** Plays a CPU-only match to the end (or `maxSeconds` of sim time). */
export function playCpuMatch(
  spec: Spec,
  o: { skill?: number | number[]; tuning?: Tuning; maxSeconds?: number; onStep?: (w: World) => void } = {},
): CpuMatch {
  const m = cpuMatch(spec, o.skill, o.tuning);
  const max = Math.round((o.maxSeconds ?? 1800) * m.world.t.match.tickHz);
  const onStep = o.onStep;
  runSim(m.world, (w) => (onStep && w.tick > 0 && onStep(w), m.bots.map((b) => b.command(w))), {
    maxTicks: max,
    done: (w) => w.over,
  });
  onStep?.(m.world);
  return m;
}
