import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test, eq, ok, near } from "./harness.ts";
import { EnvClient } from "../src/rl/client.ts";
import { serveEnv, type EnvIO } from "../src/rl/protocol.ts";
import { Policy, argmax, softmax, sample, type PolicyJson } from "../src/rl/policy.ts";

const here = dirname(fileURLToPath(import.meta.url));

test("RL protocol: round trip with a toy env server over stdin/stdout", async () => {
  const env = new EnvClient(
    process.execPath,
    ["--experimental-transform-types", "--no-warnings", join(here, "fixtures", "toy-env.ts")],
    {
      NENV: "2",
      SEED: "1",
    },
  );
  eq(JSON.stringify(env.spec), JSON.stringify({ obs: 3, heads: [3, 2], nenv: 2, name: "walk" }), "INFO spec");
  const o0 = await env.reset();
  // Env 0 got seed 1 (target 2), env 1 seed 2 (target 3).
  eq(Array.from(o0).join(), "0,2,0,0,3,0");
  let s = await env.step([2, 0, 2, 1]);
  eq(Array.from(s.obs).join(), "1,2,1,1,3,1");
  eq(Array.from(s.reward).join(), "1,1");
  eq(Array.from(s.done).join(), "0,0");
  s = await env.step([2, 0, 0, 0]);
  eq(s.done[0], 1, "env 0 reached its target");
  eq(s.result[0], 1);
  eq(s.reward[1], -1, "env 1 stepped away");
  // Env 0 was reset with the next seed (3 -> target 4): obs is the new episode's first.
  eq(Array.from(s.obs.slice(0, 3)).join(), "0,4,0");
  for (let i = 0; i < 4; i++) s = await env.step([1, 0, 1, 0]);
  eq(s.done[1], 1, "env 1 timed out after 6 steps");
  eq(s.result[1], -1);
  eq(await env.close(), 0, "server exits cleanly on EOF");
});

test("RL protocol: in-process IO, action range checked", async () => {
  const sent: Uint8Array[] = [];
  const queue = [new Int32Array([0, 0]), new Int32Array([5, 0])];
  const io: EnvIO = {
    read(b) {
      const a = queue.shift();
      if (!a) return false;
      b.set(new Uint8Array(a.buffer));
      return true;
    },
    write(b) {
      sent.push(b.slice());
    },
  };
  const env = {
    reset() {},
    observe(out: Float32Array, o: number) {
      out[o] = 7;
    },
    step: () => ({ reward: 0.5, done: false }),
  };
  let err = "";
  await serveEnv({ obs: 1, heads: [3, 2] }, () => env, { nenv: 1, io, info: false }).catch((e) => (err = e.message));
  ok(err.includes("out of range"), err);
  eq(sent.length, 3, "initial obs + one step's obs and tail");
  near(new Float32Array(sent[2].buffer)[0], 0.5, 1e-9);
});

test("policy runtime: forward pass matches a hand-computed network", () => {
  const json: PolicyJson = {
    obs: 2,
    mean: [1, 0],
    std: [2, 1],
    clip: 3,
    body: [{ in: 2, out: 2, w: [0.5, -1, 1, 1], b: [0, 0.1], act: "tanh" }],
    heads: [
      { in: 2, out: 3, w: [1, 0, 0, 1, -1, -1], b: [0, 0, 0.2] },
      { in: 2, out: 2, w: [2, 0, 0, 2], b: [0, 0], act: "relu" },
    ],
  };
  const p = new Policy(json);
  // x = clip((obs - mean) / std) = [(3 - 1) / 2, 10 -> clipped 3] = [1, 3]
  const h0 = Math.tanh(0.5 * 1 - 1 * 3);
  const h1 = Math.tanh(1 * 1 + 1 * 3 + 0.1);
  const [a, b] = p.forward([3, 10]);
  near(a[0], h0, 1e-6);
  near(a[1], h1, 1e-6);
  near(a[2], -h0 - h1 + 0.2, 1e-6);
  near(b[0], Math.max(0, 2 * h0), 1e-6, "relu clamps");
  near(b[1], 2 * h1, 1e-6);
  eq(p.act([3, 10]).join(), "1,1");
  const sm = softmax([0, Math.log(3)]);
  near(sm[1], 0.75, 1e-9);
  eq(
    sample([0, Math.log(3)], () => 0.2),
    0,
  );
  eq(
    sample([0, Math.log(3)], () => 0.3),
    1,
  );
  eq(argmax([1, 5, 5]), 1, "first max wins");
  let threw = false;
  try {
    new Policy({ ...json, heads: [{ in: 3, out: 1, w: [1, 1, 1], b: [0] }] });
  } catch {
    threw = true;
  }
  ok(threw, "shape mismatch rejected");
});
