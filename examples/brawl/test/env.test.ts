// RL env (tools/env.ts) in process: 100 random decisions, observation size and finiteness, a full episode ends with
// a result, and the observation is a pure function of the world (same seed, same bytes).
import { assert, test } from "./harness.ts";
import { BrawlEnv } from "../tools/env.ts";
import { OBS } from "../src/sim/observe.ts";

test("rl env: 100 random steps, then an episode to the end", () => {
  const env = new BrawlEnv();
  env.reset(4);
  const obs = new Float32Array(OBS * 2);
  let seed = 7;
  const rand = (n: number) => (seed = (seed * 16807) % 2147483647) % n;
  for (let i = 0; i < 100; i++) env.step(Int32Array.from([rand(9), rand(4)]));
  env.observe(obs, OBS);
  assert.ok(obs.every(Number.isFinite));
  assert.ok(obs.slice(OBS).some((v) => v !== 0));
  let last = env.step(Int32Array.from([0, 0]));
  for (let i = 0; i < 20000 && !last.done; i++) last = env.step(Int32Array.from([rand(9), rand(4)]));
  assert.ok(last.done, "episode ends");
  assert.ok(last.result === 1 || last.result === -1);
  const a = new BrawlEnv();
  const b = new BrawlEnv();
  a.reset(9);
  b.reset(9);
  const oa = new Float32Array(OBS);
  const ob = new Float32Array(OBS);
  for (let i = 0; i < 50; i++) {
    a.step(Int32Array.from([i % 9, i % 4]));
    b.step(Int32Array.from([i % 9, i % 4]));
  }
  a.observe(oa, 0);
  b.observe(ob, 0);
  assert.deepEqual([...oa], [...ob]);
});
