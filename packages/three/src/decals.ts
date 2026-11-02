// Ground decals: flat quads that grow and fade (shockwave rings, scorch marks, footprints, selection rings), one
// instanced draw per texture. A layer has a budget; when it is full the oldest decal is recycled, so a busy fight
// never grows the cost. Persistent rings (a selection or "foot ring" under a unit) use pin() and stay until unpinned.
import * as THREE from "three";
import { QuadBatch, type QuadBatchOptions } from "./quads.ts";

export interface DecalSpec {
  x: number;
  z: number;
  /** Height (put it a hair above the ground to avoid z-fighting; default 0.02). */
  y?: number;
  size?: number;
  /** Size multiplier reached at the end of life (eased out). */
  grow?: number;
  /** Seconds; Infinity for a pinned decal. */
  life?: number;
  color?: THREE.ColorRepresentation;
  opacity?: number;
  rot?: number;
  /** Fraction of life spent fading in. */
  fadeIn?: number;
  /** Fraction of life (from the end) spent fading out (default 0.5). */
  fadeOut?: number;
}

interface Decal {
  x: number;
  y: number;
  z: number;
  size: number;
  grow: number;
  life: number;
  age: number;
  r: number;
  g: number;
  b: number;
  op: number;
  rot: number;
  fadeIn: number;
  fadeOut: number;
  seq: number;
}

const tmp = new THREE.Color();

export class DecalLayer {
  readonly batch: QuadBatch;
  private list: Decal[] = [];
  private pinned = new Map<number, Decal>();
  private seq = 0;
  private nextPin = 1;

  constructor(
    tex: THREE.Texture,
    readonly budget = 256,
    o: Omit<QuadBatchOptions, "mode"> = {},
  ) {
    this.batch = new QuadBatch(tex, { renderOrder: -1, ...o, mode: "ground" });
  }

  get object(): THREE.Object3D {
    return this.batch.mesh;
  }

  get live(): number {
    return this.list.length + this.pinned.size;
  }

  private make(s: DecalSpec, life: number): Decal {
    tmp.set(s.color ?? 0xffffff);
    return {
      x: s.x,
      y: s.y ?? 0.02,
      z: s.z,
      size: s.size ?? 1,
      grow: s.grow ?? 1,
      life,
      age: 0,
      r: tmp.r,
      g: tmp.g,
      b: tmp.b,
      op: s.opacity ?? 1,
      rot: s.rot ?? 0,
      fadeIn: s.fadeIn ?? 0,
      fadeOut: s.fadeOut ?? 0.5,
      seq: this.seq++,
    };
  }

  /** A transient decal; recycles the oldest when the layer is at budget. */
  spawn(s: DecalSpec): void {
    const d = this.make(s, Math.max(1e-3, s.life ?? 1));
    if (this.list.length + this.pinned.size >= this.budget && this.list.length) {
      let oldest = 0;
      for (let i = 1; i < this.list.length; i++) if (this.list[i].seq < this.list[oldest].seq) oldest = i;
      this.list[oldest] = d;
    } else this.list.push(d);
  }

  /** A persistent decal (no ageing); returns a handle for move()/unpin(). */
  pin(s: DecalSpec): number {
    const id = this.nextPin++;
    this.pinned.set(id, this.make(s, Infinity));
    return id;
  }

  move(id: number, s: Partial<DecalSpec>): void {
    const d = this.pinned.get(id);
    if (!d) return;
    if (s.x !== undefined) d.x = s.x;
    if (s.y !== undefined) d.y = s.y;
    if (s.z !== undefined) d.z = s.z;
    if (s.size !== undefined) d.size = s.size;
    if (s.rot !== undefined) d.rot = s.rot;
    if (s.opacity !== undefined) d.op = s.opacity;
    if (s.color !== undefined) {
      tmp.set(s.color);
      d.r = tmp.r;
      d.g = tmp.g;
      d.b = tmp.b;
    }
  }

  unpin(id: number): void {
    this.pinned.delete(id);
  }

  clear(): void {
    this.list = [];
  }

  update(dt: number): void {
    dt = Math.max(0, dt);
    let n = 0;
    const out: Decal[] = [];
    for (const d of this.list) {
      d.age += dt;
      const k = d.age / d.life;
      if (k >= 1) continue;
      out.push(d);
      const ease = 1 - (1 - k) * (1 - k);
      const s = d.size * (1 + (d.grow - 1) * ease);
      const fin = d.fadeIn > 0 && k < d.fadeIn ? k / d.fadeIn : 1;
      const fout = d.fadeOut > 0 && k > 1 - d.fadeOut ? (1 - k) / d.fadeOut : 1;
      this.batch.set(n++, d.x, d.y, d.z, s, s, d.rot, d.r, d.g, d.b, d.op * fin * fout);
    }
    this.list = out;
    for (const d of this.pinned.values())
      this.batch.set(n++, d.x, d.y, d.z, d.size, d.size, d.rot, d.r, d.g, d.b, d.op);
    this.batch.commit(n);
  }

  dispose(): void {
    this.batch.dispose();
  }
}
