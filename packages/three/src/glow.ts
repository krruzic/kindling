// Additive glow sprites: fake lights. A real PointLight costs every lit material a shader variant and per-pixel
// work; a camera-facing additive quad with a soft texture reads as "this lantern is lit" for one instanced draw for
// all of them. Sprites are persistent handles (add / move / remove) with an optional pulse (flicker, twinkle).
import * as THREE from "three";
import { QuadBatch, type QuadBatchOptions } from "./quads.ts";
import { glowTexture } from "./textures.ts";

export interface GlowSpec {
  x: number;
  y: number;
  z: number;
  color?: THREE.ColorRepresentation;
  /** World size of the quad. */
  size?: number;
  /** Colour multiplier (additive: > 1 blows out toward white). */
  intensity?: number;
  /** Pulse: intensity *= 1 - depth/2 + depth/2 * sin(time * rate + phase). */
  pulseRate?: number;
  pulseDepth?: number;
  phase?: number;
}

interface Glow extends Required<Omit<GlowSpec, "color">> {
  r: number;
  g: number;
  b: number;
  live: boolean;
}

const tmp = new THREE.Color();

export class GlowSprites {
  readonly batch: QuadBatch;
  private glows: Glow[] = [];
  private freeIds: number[] = [];

  constructor(tex: THREE.Texture = glowTexture(), o: Omit<QuadBatchOptions, "mode" | "additive"> = {}) {
    this.batch = new QuadBatch(tex, { ...o, mode: "billboard", additive: true });
  }

  get object(): THREE.Object3D {
    return this.batch.mesh;
  }

  add(s: GlowSpec): number {
    tmp.set(s.color ?? 0xffd890);
    const g: Glow = {
      x: s.x,
      y: s.y,
      z: s.z,
      size: s.size ?? 1,
      intensity: s.intensity ?? 1,
      pulseRate: s.pulseRate ?? 0,
      pulseDepth: s.pulseDepth ?? 0,
      phase: s.phase ?? 0,
      r: tmp.r,
      g: tmp.g,
      b: tmp.b,
      live: true,
    };
    const id = this.freeIds.pop();
    if (id !== undefined) {
      this.glows[id] = g;
      return id;
    }
    this.glows.push(g);
    return this.glows.length - 1;
  }

  /** Updates fields of a sprite (position, colour, size...). */
  set(id: number, s: Partial<GlowSpec>): void {
    const g = this.glows[id];
    if (!g?.live) return;
    if (s.color !== undefined) {
      tmp.set(s.color);
      g.r = tmp.r;
      g.g = tmp.g;
      g.b = tmp.b;
    }
    for (const k of ["x", "y", "z", "size", "intensity", "pulseRate", "pulseDepth", "phase"] as const)
      if (s[k] !== undefined) g[k] = s[k]!;
  }

  remove(id: number): void {
    const g = this.glows[id];
    if (!g?.live) return;
    g.live = false;
    this.freeIds.push(id);
  }

  get live(): number {
    return this.glows.length - this.freeIds.length;
  }

  /** Writes every live sprite (with its pulse at `time` seconds) and uploads. */
  update(time: number): void {
    let n = 0;
    for (const g of this.glows) {
      if (!g.live) continue;
      const k = g.pulseDepth
        ? g.intensity * (1 - g.pulseDepth / 2 + (g.pulseDepth / 2) * Math.sin(time * g.pulseRate + g.phase))
        : g.intensity;
      this.batch.set(n++, g.x, g.y, g.z, g.size, g.size, 0, g.r * k, g.g * k, g.b * k, 1);
    }
    this.batch.commit(n);
  }

  dispose(): void {
    this.batch.dispose();
  }
}
