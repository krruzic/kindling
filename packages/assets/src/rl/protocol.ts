// The RL environment bridge (from Grudge's tools/ml/env.ts): NENV copies of the game run headless in one node
// process, driven by a trainer over stdin/stdout with a fixed-size little-endian binary protocol, no framing:
//
//   on start:  -> obs[NENV * OBS] float32
//   each step: <- act[NENV * HEADS] int32 (one categorical choice per action head)
//              -> obs[NENV * OBS] float32, then tail[3 * NENV] float32 = reward[NENV], done[NENV], result[NENV]
//
// done = 1 on the step an episode ends (result: +1 win / -1 loss / 0 draw, or whatever the game reports); the
// server resets that env itself, so obs is already the next episode's first observation. With INFO=1 in the
// environment the server prints {"obs", "heads", "nenv", ...meta} as JSON and exits (the trainer sizes its network
// from it). The game supplies observe / act / reward / reset; keep the observation code shared with the in-game
// agent so training and play see byte-identical inputs.

export interface StepResult {
  reward: number;
  done: boolean;
  /** Outcome on the final step (+1 / -1 / 0). */
  result?: number;
}

export interface RlEnv {
  /** Starts a fresh episode (the server calls it once at start and after every done). */
  reset(seed: number): void;
  /** Writes OBS floats at out[offset...]. */
  observe(out: Float32Array, offset: number): void;
  /** Applies one decision (one int per head) and advances; returns the reward since the last decision. */
  step(actions: Int32Array): StepResult;
}

export interface EnvSpec {
  obs: number;
  /** Size of each categorical action head (Grudge: [10 moves, 8 buttons]). */
  heads: number[];
  /** Anything else the trainer should know (roster, repeat...). */
  meta?: Record<string, unknown>;
}

export interface EnvIO {
  /** Fills buf completely; false on EOF. */
  read(buf: Uint8Array): boolean;
  write(buf: Uint8Array): void;
}

/** Blocking stdin/stdout IO (the trainer and the env step in lockstep, so blocking is what we want). */
export async function stdio(): Promise<EnvIO> {
  const { readSync, writeSync } = await import("node:fs");
  return {
    read(b) {
      let off = 0;
      while (off < b.length) {
        let n = 0;
        try {
          n = readSync(0, b, off, b.length - off, null);
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code === "EAGAIN") continue;
          if ((e as NodeJS.ErrnoException).code === "EOF") return false;
          throw e;
        }
        if (n === 0) return false;
        off += n;
      }
      return true;
    },
    write(b) {
      let off = 0;
      while (off < b.length) off += writeSync(1, b, off, b.length - off);
    },
  };
}

export interface ServeOptions {
  nenv?: number;
  /** First seed; each reset takes the next one. */
  seed?: number;
  io?: EnvIO;
  /** Print the spec and return instead of serving (default: process.env.INFO). */
  info?: boolean;
}

/**
 * Serves `nenv` environments made by `make(index)` until the trainer closes stdin. Returns the number of steps
 * served. Defaults read NENV / SEED / INFO from the environment.
 */
export async function serveEnv(spec: EnvSpec, make: (index: number) => RlEnv, o: ServeOptions = {}): Promise<number> {
  const nenv = o.nenv ?? Number(process.env.NENV ?? 8);
  if (o.info ?? !!process.env.INFO) {
    const line = JSON.stringify({ obs: spec.obs, heads: spec.heads, nenv, ...spec.meta }) + "\n";
    if (o.io) o.io.write(new TextEncoder().encode(line));
    else process.stdout.write(line);
    return 0;
  }
  const io = o.io ?? (await stdio());
  let seed = o.seed ?? Number(process.env.SEED ?? 1);
  const H = spec.heads.length;
  const envs = Array.from({ length: nenv }, (_, k) => {
    const e = make(k);
    e.reset(seed++);
    return e;
  });
  const obs = new Float32Array(nenv * spec.obs);
  const tail = new Float32Array(nenv * 3);
  const act = new Int32Array(nenv * H);
  const actBytes = new Uint8Array(act.buffer);
  const send = (withTail: boolean) => {
    obs.fill(0);
    envs.forEach((e, k) => e.observe(obs, k * spec.obs));
    io.write(new Uint8Array(obs.buffer));
    if (withTail) io.write(new Uint8Array(tail.buffer));
  };
  send(false);
  let steps = 0;
  while (io.read(actBytes)) {
    for (let k = 0; k < nenv; k++) {
      const a = act.subarray(k * H, k * H + H);
      for (let h = 0; h < H; h++)
        if (a[h] < 0 || a[h] >= spec.heads[h]) throw new Error(`action ${a[h]} out of range for head ${h}`);
      const r = envs[k].step(a);
      tail[k] = r.reward;
      tail[nenv + k] = r.done ? 1 : 0;
      tail[2 * nenv + k] = r.done ? (r.result ?? 0) : 0;
      if (r.done) envs[k].reset(seed++);
    }
    send(true);
    steps++;
  }
  return steps;
}
