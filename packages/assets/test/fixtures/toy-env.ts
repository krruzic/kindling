// Toy env for the protocol round-trip test: walk a counter toward a target on a line. obs = [pos, target, steps],
// heads = [move: 0 left / 1 stay / 2 right, flag: 0 / 1 (ignored)]. +1 reward per step closer, done on reaching the
// target (result +1) or after 6 steps (result -1). Each reset puts the target at seed % 5.
import { serveEnv, type RlEnv } from "../../src/rl/protocol.ts";

class Walk implements RlEnv {
  pos = 0;
  target = 0;
  steps = 0;
  reset(seed: number): void {
    this.pos = 0;
    this.target = (seed % 5) + 1;
    this.steps = 0;
  }
  observe(out: Float32Array, o: number): void {
    out[o] = this.pos;
    out[o + 1] = this.target;
    out[o + 2] = this.steps;
  }
  step(a: Int32Array) {
    const before = Math.abs(this.target - this.pos);
    this.pos += a[0] - 1;
    this.steps++;
    const after = Math.abs(this.target - this.pos);
    if (after === 0) return { reward: 1, done: true, result: 1 };
    if (this.steps >= 6) return { reward: before - after, done: true, result: -1 };
    return { reward: before - after, done: false };
  }
}

await serveEnv({ obs: 3, heads: [3, 2], meta: { name: "walk" } }, () => new Walk());
