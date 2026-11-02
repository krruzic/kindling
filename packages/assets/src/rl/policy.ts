// Policy runtime: the trained network exported to JSON (python/rl/export.py) evaluated in plain TypeScript, so a
// game can ship an "agent" CPU without any ML dependency (Grudge's ?agent= mode). An MLP body (Linear + tanh/relu)
// shared by several categorical heads; observations are normalised with the trainer's running mean / std and
// clipped. act() takes each head's argmax, or samples when given a seeded rand(). Deterministic (no Math.random).

export type Activation = "tanh" | "relu" | "none";

export interface LayerJson {
  in: number;
  out: number;
  /** Row-major out x in. */
  w: number[];
  b: number[];
  act?: Activation;
}

export interface PolicyJson {
  obs: number;
  mean?: number[];
  std?: number[];
  /** Normalised observations are clipped to +-clip (default 8). */
  clip?: number;
  body: LayerJson[];
  /** Action heads in protocol order (logits). */
  heads: LayerJson[];
  headNames?: string[];
  meta?: Record<string, unknown>;
}

interface Layer {
  in: number;
  out: number;
  w: Float32Array;
  b: Float32Array;
  act: Activation;
}

function prep(l: LayerJson, fallback: Activation): Layer {
  if (l.w.length !== l.in * l.out || l.b.length !== l.out) throw new Error(`bad layer ${l.in}x${l.out}`);
  return { in: l.in, out: l.out, w: Float32Array.from(l.w), b: Float32Array.from(l.b), act: l.act ?? fallback };
}

/** y = act(W x + b). */
export function linear(L: Layer, x: Float32Array, out = new Float32Array(L.out)): Float32Array {
  for (let r = 0; r < L.out; r++) {
    let s = L.b[r];
    const off = r * L.in;
    for (let c = 0; c < L.in; c++) s += L.w[off + c] * x[c];
    out[r] = L.act === "tanh" ? Math.tanh(s) : L.act === "relu" ? (s > 0 ? s : 0) : s;
  }
  return out;
}

export class Policy {
  private body: Layer[];
  private heads: Layer[];
  private mean: Float32Array;
  private std: Float32Array;
  private clip: number;
  private x: Float32Array;

  constructor(readonly json: PolicyJson) {
    this.body = json.body.map((l) => prep(l, "tanh"));
    this.heads = json.heads.map((l) => prep(l, "none"));
    this.mean = Float32Array.from(json.mean ?? new Array(json.obs).fill(0));
    this.std = Float32Array.from(json.std ?? new Array(json.obs).fill(1));
    this.clip = json.clip ?? 8;
    this.x = new Float32Array(json.obs);
    let n = json.obs;
    for (const l of this.body) {
      if (l.in !== n) throw new Error(`layer expects ${l.in} inputs, gets ${n}`);
      n = l.out;
    }
    for (const h of this.heads) if (h.in !== n) throw new Error(`head expects ${h.in} inputs, gets ${n}`);
  }

  /** Logits of every head for one observation. */
  forward(obs: ArrayLike<number>): Float32Array[] {
    if (obs.length !== this.json.obs) throw new Error(`obs has ${obs.length} values, policy wants ${this.json.obs}`);
    const x = this.x;
    for (let i = 0; i < x.length; i++)
      x[i] = Math.max(-this.clip, Math.min(this.clip, (obs[i] - this.mean[i]) / (this.std[i] || 1)));
    let h: Float32Array = x;
    for (const l of this.body) h = linear(l, h);
    return this.heads.map((l) => linear(l, h));
  }

  /** One action per head: argmax, or sampled from the softmax with `rand`. */
  act(obs: ArrayLike<number>, rand?: () => number): number[] {
    return this.forward(obs).map((logits) => (rand ? sample(logits, rand) : argmax(logits)));
  }
}

export function argmax(v: ArrayLike<number>): number {
  let best = 0;
  for (let i = 1; i < v.length; i++) if (v[i] > v[best]) best = i;
  return best;
}

export function softmax(v: ArrayLike<number>): number[] {
  let m = -Infinity;
  for (let i = 0; i < v.length; i++) m = Math.max(m, v[i]);
  const e = Array.from(v, (x) => Math.exp(x - m));
  const s = e.reduce((a, b) => a + b, 0);
  return e.map((x) => x / s);
}

export function sample(logits: ArrayLike<number>, rand: () => number): number {
  const p = softmax(logits);
  let r = rand();
  for (let i = 0; i < p.length; i++) if ((r -= p[i]) <= 0) return i;
  return p.length - 1;
}
