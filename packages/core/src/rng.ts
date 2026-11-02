// Seeded random number generators for deterministic simulations. The sim may only draw randomness from these
// (never Math.random), so two peers or two headless runs with the same seed produce the same game.
//   Mulberry32: fast, 32-bit state, good quality; Grudge's World.rng.
//   ParkMiller: the "minimal standard" LCG (16807 mod 2^31-1); Grudge's per-bot rng, kept so bots can be ported
//   with identical behaviour.
// Every generator exposes its integer `state` (hash it, save it for rejoin, restore it) and `split()` for a child
// stream, and `RngStreams` hands out named independent streams (e.g. "loot", "ai.3") that don't shift when another
// stream draws more numbers.

export interface Random {
  /** Uniform float in [0, 1). */
  next(): number;
  /** Uniform 32-bit unsigned integer. */
  u32(): number;
  /** Uniform integer in [0, n). */
  int(n: number): number;
  /** Uniform float in [lo, hi). */
  range(lo: number, hi: number): number;
  /** True with probability p. */
  chance(p: number): boolean;
  pick<T>(list: readonly T[]): T;
  /** Fisher-Yates shuffle in place; returns the list. */
  shuffle<T>(list: T[]): T[];
  /** The generator's whole state as an integer (hash it, save it, assign it back). */
  state: number;
  /** A child generator seeded from this one (advances this one by one draw). */
  split(label?: string | number): Random;
}

/** Murmur3's 32-bit finaliser: a good avalanche for turning structured seeds into well-spread ones. */
export function fmix32(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Combine two integers into one well-mixed 32-bit seed (order matters). */
export function mixSeed(a: number, b: number): number {
  return fmix32((Math.imul(fmix32(a >>> 0), 0x9e3779b1) ^ (b >>> 0)) >>> 0);
}

/** 32-bit FNV-1a of a string's UTF-16 code units (labels -> seeds). */
export function seedOf(label: string | number): number {
  if (typeof label === "number") return label >>> 0;
  let h = 0x811c9dc5;
  for (let i = 0; i < label.length; i++) {
    const c = label.charCodeAt(i);
    h = Math.imul(h ^ (c & 0xff), 0x01000193);
    h = Math.imul(h ^ (c >>> 8), 0x01000193);
  }
  return h >>> 0;
}

abstract class BaseRng implements Random {
  abstract next(): number;
  abstract u32(): number;
  abstract state: number;
  int(n: number): number {
    return Math.floor(this.next() * n);
  }
  range(lo: number, hi: number): number {
    return lo + (hi - lo) * this.next();
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
  pick<T>(list: readonly T[]): T {
    return list[this.int(list.length)];
  }
  shuffle<T>(list: T[]): T[] {
    for (let i = list.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      const t = list[i];
      list[i] = list[j];
      list[j] = t;
    }
    return list;
  }
  split(label: string | number = 0): Random {
    return new Mulberry32(mixSeed(this.u32(), seedOf(label)));
  }
}

export class Mulberry32 extends BaseRng {
  state: number;
  constructor(seed: number) {
    super();
    this.state = seed >>> 0;
  }
  u32(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  }
  next(): number {
    return this.u32() / 4294967296;
  }
}

const PM_M = 2147483647;

/** Seeds outside 1..2^31-2 (0 would stick at 0 forever) are folded into range. */
function pmSeed(seed: number): number {
  let s = Math.floor(Math.abs(seed)) % PM_M;
  if (s === 0) s = PM_M - 1;
  return s;
}

export class ParkMiller extends BaseRng {
  private s: number;
  constructor(seed: number) {
    super();
    this.s = pmSeed(seed);
  }
  get state(): number {
    return this.s;
  }
  set state(v: number) {
    this.s = pmSeed(v);
  }
  /** Raw next state in 1..2^31-2 (the classic minstd output). */
  nextInt(): number {
    // 16807 * (2^31 - 2) < 2^53, so this is exact in doubles.
    this.s = (this.s * 16807) % PM_M;
    return this.s;
  }
  next(): number {
    return this.nextInt() / PM_M;
  }
  u32(): number {
    // Two draws: minstd only has 31 bits.
    return ((this.nextInt() << 16) ^ this.nextInt()) >>> 0;
  }
}

/** Function form of Mulberry32, bit-identical to Grudge's `mulberry32(seed)`. */
export function mulberry32(seed: number): () => number {
  const r = new Mulberry32(seed);
  return () => r.next();
}

/** Function form of Park-Miller, identical to Grudge's bot `rand()` for seeds in 1..2^31-2. */
export function parkMiller(seed: number): () => number {
  const r = new ParkMiller(seed);
  return () => r.next();
}

/**
 * Named independent streams from one root seed. `get("loot")` always starts from the same seed regardless of the
 * order streams are first requested or how much any other stream has drawn.
 */
export class RngStreams {
  private readonly made = new Map<string, Mulberry32>();
  constructor(readonly seed: number) {}
  get(name: string | number): Mulberry32 {
    const key = String(name);
    let r = this.made.get(key);
    if (!r) {
      r = new Mulberry32(mixSeed(this.seed, seedOf(name)));
      this.made.set(key, r);
    }
    return r;
  }
  /** Every stream's state, sorted by name (for hashing and save/restore). */
  states(): [string, number][] {
    return [...this.made].map(([k, r]) => [k, r.state] as [string, number]).sort((a, b) => (a[0] < b[0] ? -1 : 1));
  }
  restore(states: readonly [string, number][]): void {
    for (const [k, s] of states) this.get(k).state = s;
  }
}
