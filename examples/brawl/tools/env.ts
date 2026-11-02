// RL environment for BRAWL over @kindling/assets' env protocol: the learning agent plays seat 0 of a duel or a
// free-for-all against the scripted Bots; one decision every REPEAT ticks. Reward: +1 per knock-out credited to the
// agent, -1 per own fall, +0.01 per damage point dealt; the match result (+1 / -1) on the final step.
//   INFO=1 node ... tools/env.ts                     print the spec
//   ENV_CMD="node --experimental-transform-types --no-warnings tools/env.ts" RUN=runs/rl \
//     python3 ../../packages/assets/rl/train.py     (CPU PPO; not run in CI)
import { serveEnv, type RlEnv, type StepResult } from "@kindling/assets/rl";
import { Bot } from "../src/sim/bot.ts";
import { decode, HEADS, OBS, observe } from "../src/sim/observe.ts";
import { ROVERS, type Command } from "../src/sim/types.ts";
import { World } from "../src/sim/world.ts";

export const REPEAT = 4;

export class BrawlEnv implements RlEnv {
  world!: World;
  bots: Bot[] = [];

  reset(seed: number): void {
    const n = 2 + (seed % 3);
    const rovers = Array.from({ length: n }, (_, i) => ROVERS[(seed + i * 2) % ROVERS.length]);
    this.world = new World({ seed, rovers, winRounds: 2 });
    this.bots = rovers.map((_, i) => new Bot(i, seed * 31 + 7, 0.5 + (seed % 5) * 0.1));
  }

  observe(out: Float32Array, offset: number): void {
    observe(this.world, 0, out, offset);
  }

  step(actions: Int32Array): StepResult {
    const w = this.world;
    const mine: Command = decode(actions);
    let reward = 0;
    for (let r = 0; r < REPEAT && !w.over; r++) {
      const cmds = this.bots.map((b, i) =>
        i === 0 ? (r === 0 ? mine : { ...mine, attack: false, dash: false, special: false }) : b.command(w),
      );
      w.step(cmds);
      for (const e of w.events) {
        if (e.type === "fall" && e.by === 0) reward += 1;
        if (e.type === "fall" && e.seat === 0) reward -= 1;
        if (e.type === "hit" && e.by === 0) reward += 0.01 * w.t.moves.attack.damage;
      }
      if (w.tick > 60 * 60 * 6) break;
    }
    const done = w.over || w.tick > 60 * 60 * 6;
    return done ? { reward, done, result: w.state.match.winner === 0 ? 1 : -1 } : { reward, done: false };
  }
}

if (import.meta.url === `file://${process.argv[1]}`)
  await serveEnv({ obs: OBS, heads: HEADS, meta: { game: "brawl", repeat: REPEAT } }, () => new BrawlEnv());
