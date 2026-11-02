// The trainer side of the env protocol in TypeScript: spawns an env server (any command), reads its spec with
// INFO=1, then reset() / step() exactly like python/rl/train.py does. For evaluation scripts, profiling an agent's
// behaviour against the scripted bot, and the protocol round-trip test.
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { EnvSpec } from "./protocol.ts";

export interface StepOut {
  obs: Float32Array;
  reward: Float32Array;
  done: Float32Array;
  result: Float32Array;
}

export class EnvClient {
  readonly spec: EnvSpec & { nenv: number };
  private proc: ChildProcessWithoutNullStreams;
  private chunks: Buffer[] = [];
  private have = 0;
  private want: { n: number; resolve: (b: Buffer) => void; reject: (e: Error) => void } | null = null;
  private closed: Error | null = null;

  constructor(cmd: string, args: string[], env: Record<string, string> = {}, cwd?: string) {
    const base = { ...process.env, ...env };
    const info = spawnSync(cmd, args, { cwd, env: { ...base, INFO: "1" }, encoding: "utf8" });
    if (info.status !== 0) throw new Error(`env INFO failed: ${info.stderr}`);
    this.spec = JSON.parse(info.stdout.trim().split("\n").pop()!);
    const { INFO: _, ...rest } = base;
    this.proc = spawn(cmd, args, { cwd, env: rest, stdio: ["pipe", "pipe", "pipe"] });
    this.proc.stderr.on("data", (d) => process.stderr.write(d));
    this.proc.stdout.on("data", (d: Buffer) => {
      this.chunks.push(d);
      this.have += d.length;
      this.pump();
    });
    this.proc.on("exit", (code) => {
      this.closed = new Error(`env exited (${code})`);
      this.want?.reject(this.closed);
      this.want = null;
    });
  }

  private pump(): void {
    if (!this.want || this.have < this.want.n) return;
    const all = Buffer.concat(this.chunks);
    const out = all.subarray(0, this.want.n);
    const restBuf = all.subarray(this.want.n);
    this.chunks = restBuf.length ? [restBuf] : [];
    this.have = restBuf.length;
    const w = this.want;
    this.want = null;
    w.resolve(Buffer.from(out));
  }

  private read(n: number): Promise<Buffer> {
    if (this.closed && this.have < n) return Promise.reject(this.closed);
    return new Promise((resolve, reject) => {
      this.want = { n, resolve, reject };
      this.pump();
    });
  }

  private async floats(n: number): Promise<Float32Array> {
    const b = await this.read(n * 4);
    return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + n * 4));
  }

  /** The first observation batch (call once, right after construction). */
  reset(): Promise<Float32Array> {
    return this.floats(this.spec.nenv * this.spec.obs);
  }

  /** actions: nenv x heads ints, row-major. */
  async step(actions: ArrayLike<number>): Promise<StepOut> {
    const { nenv, heads } = this.spec;
    if (actions.length !== nenv * heads.length) throw new Error(`need ${nenv * heads.length} actions`);
    const a = Int32Array.from(actions as ArrayLike<number>);
    this.proc.stdin.write(Buffer.from(a.buffer));
    const obs = await this.floats(nenv * this.spec.obs);
    const tail = await this.floats(nenv * 3);
    return { obs, reward: tail.slice(0, nenv), done: tail.slice(nenv, 2 * nenv), result: tail.slice(2 * nenv) };
  }

  close(): Promise<number | null> {
    return new Promise((resolve) => {
      if (this.proc.exitCode !== null) return resolve(this.proc.exitCode);
      this.proc.once("exit", (c) => resolve(c));
      this.proc.stdin.end();
    });
  }
}
