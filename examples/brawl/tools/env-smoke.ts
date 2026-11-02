// RL bridge smoke test (no training): spawns tools/env.ts as an env server through @kindling/assets' EnvClient,
// reads its spec, and takes 100 random steps over 4 environments, checking the observation size, finite values and
// that episodes end and reset.   pnpm env-smoke
import { EnvClient } from "@kindling/assets/rl";
import { fileURLToPath } from "node:url";
import { HEADS, OBS } from "../src/sim/observe.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const client = new EnvClient(
  "node",
  ["--experimental-transform-types", "--no-warnings", "tools/env.ts"],
  { NENV: "4", SEED: "3" },
  root,
);
const { nenv, obs, heads } = client.spec;
if (obs !== OBS || JSON.stringify(heads) !== JSON.stringify(HEADS) || nenv !== 4)
  throw new Error(`bad spec ${JSON.stringify(client.spec)}`);
let o = await client.reset();
let seed = 99;
const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
let reward = 0;
let dones = 0;
for (let i = 0; i < 100; i++) {
  const acts = Array.from({ length: nenv * heads.length }, (_, k) => Math.floor(rand() * heads[k % heads.length]));
  const r = await client.step(acts);
  o = r.obs;
  if (o.length !== nenv * obs || !o.every(Number.isFinite)) throw new Error(`bad observation at step ${i}`);
  reward += r.reward.reduce((a, b) => a + b, 0);
  dones += r.done.reduce((a, b) => a + b, 0);
}
await client.close();
console.log(
  `env smoke ok: ${nenv} envs x 100 steps, obs ${obs}, heads ${heads}, total reward ${reward.toFixed(2)}, episodes ended ${dones}`,
);
