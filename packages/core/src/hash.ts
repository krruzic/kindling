// State hashing for lockstep checks and the determinism baseline. `Hasher` is an incremental 32-bit FNV-1a over a
// canonical byte stream of the values fed to it: integers as 4 bytes, floats either quantized (`q`, the usual choice
// for positions: tiny float noise that never reaches the sim should not count) or exactly (`f`, all 64 bits), strings
// as length + UTF-16 code units. `sectionHashes` hashes named parts of a world separately so a desync report says
// WHERE peers diverged (players, units, rng...) and not just that they did.

const BITS = new DataView(new ArrayBuffer(8));

/** One-shot FNV-1a 32 over bytes (the textbook function; "a" -> 0xe40c292c). */
export function fnv1a(bytes: ArrayLike<number>): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) h = Math.imul(h ^ (bytes[i] & 0xff), 0x01000193);
  return h >>> 0;
}

export class Hasher {
  h = 0x811c9dc5;

  constructor(seed?: number) {
    if (seed !== undefined) this.u32(seed);
  }

  private byte(b: number): void {
    this.h = Math.imul(this.h ^ b, 0x01000193);
  }

  /** An integer as 32 bits (negative numbers wrap as in `| 0`). */
  u32(v: number): this {
    v = v >>> 0;
    this.byte(v & 0xff);
    this.byte((v >>> 8) & 0xff);
    this.byte((v >>> 16) & 0xff);
    this.byte(v >>> 24);
    return this;
  }

  /** Alias of u32 for signed integers. */
  i32(v: number): this {
    return this.u32(v | 0);
  }

  /** A float quantized to 1/scale (Grudge hashed positions in 64ths). */
  q(v: number, scale = 64): this {
    return this.u32(Math.round(v * scale) | 0);
  }

  /** A float, exactly (all 64 bits; -0 and 0 hash the same, every NaN hashes the same). */
  f(v: number): this {
    // Little-endian explicitly so the bytes are the same on any host byte order.
    BITS.setFloat64(0, v === 0 ? 0 : Number.isNaN(v) ? NaN : v, true);
    return this.u32(BITS.getUint32(0, true)).u32(BITS.getUint32(4, true));
  }

  bool(v: boolean): this {
    this.byte(v ? 1 : 0);
    return this;
  }

  str(s: string): this {
    this.u32(s.length);
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      this.byte(c & 0xff);
      this.byte(c >>> 8);
    }
    return this;
  }

  /** A list: its length, then each item via `each` (default: exact numbers / strings / booleans). */
  arr<T>(list: readonly T[], each?: (h: Hasher, item: T) => void): this {
    this.u32(list.length);
    for (const x of list) {
      if (each) each(this, x);
      else this.value(x);
    }
    return this;
  }

  /** Any JSON-like value, structurally. Object keys are sorted, so insertion order does not matter. */
  value(v: unknown): this {
    if (v === null || v === undefined) this.byte(v === null ? 0 : 1);
    else if (typeof v === "number") {
      this.byte(2);
      this.f(v);
    } else if (typeof v === "string") {
      this.byte(3);
      this.str(v);
    } else if (typeof v === "boolean") {
      this.byte(4);
      this.bool(v);
    } else if (Array.isArray(v)) {
      this.byte(5);
      this.arr(v);
    } else if (ArrayBuffer.isView(v) && !(v instanceof DataView)) {
      this.byte(6);
      this.arr(Array.from(v as unknown as ArrayLike<number>));
    } else if (typeof v === "object") {
      this.byte(7);
      const keys = Object.keys(v as object).sort();
      this.u32(keys.length);
      for (const k of keys) this.str(k).value((v as Record<string, unknown>)[k]);
    } else throw new Error(`Hasher.value: can't hash a ${typeof v}`);
    return this;
  }

  digest(): number {
    return this.h >>> 0;
  }

  hex(): string {
    return hex32(this.digest());
  }
}

export function hex32(h: number): string {
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** Structural hash of a JSON-like value. */
export function hashValue(v: unknown): number {
  return new Hasher().value(v).digest();
}

export interface SectionHashes {
  /** Hash of all section hashes, in the order given. */
  total: number;
  sections: Record<string, number>;
}

/**
 * Hash named sections of a state separately: `sectionHashes({ players: (h) => ..., rng: (h) => h.u32(w.rng.state) })`.
 * `tick` (if given) is mixed into the total so two states at different ticks never compare equal.
 */
export function sectionHashes(parts: Record<string, (h: Hasher) => void>, tick?: number): SectionHashes {
  const sections: Record<string, number> = {};
  const all = new Hasher(tick);
  for (const [name, fill] of Object.entries(parts)) {
    const h = new Hasher();
    fill(h);
    sections[name] = h.digest();
    all.str(name).u32(sections[name]);
  }
  return { total: all.digest(), sections };
}

/** Names of the sections that differ between two section-hash maps (missing on one side counts as differing). */
export function diffSections(a: Record<string, number>, b: Record<string, number>): string[] {
  const names = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...names].filter((n) => a[n] !== b[n]);
}
