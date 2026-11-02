// String lights (from Grudge's Christmas and Halloween dressing): coloured bulbs at an even spacing along curves
// (a spiral up a tree, swags round a tower, a sagging wire between two posts), drawn as one additive THREE.Points
// with a hot-core texture. No real lights: the bulbs twinkle by scaling their vertex colours with a gentle sine plus
// a slow chase along each string. Curve helpers return plain point lists, so the spacing maths is testable.
import * as THREE from "three";
import { bulbTexture } from "./textures.ts";

type P3 = { x: number; y: number; z: number };

/** Points every `spacing` along a polyline (arc length), starting `offset` in. */
export function pointsAlong(line: readonly P3[], spacing: number, offset = spacing / 2): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  if (line.length < 2 || spacing <= 0) return out;
  let next = offset;
  let walked = 0;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1];
    const b = line[i];
    const len = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    while (len > 0 && next <= walked + len + 1e-9) {
      const t = (next - walked) / len;
      out.push(new THREE.Vector3(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t));
      next += spacing;
    }
    walked += len;
  }
  return out;
}

/** Samples a three Curve into a polyline (for pointsAlong). */
export const sampleCurve = (c: THREE.Curve<THREE.Vector3>, divisions = 64) => c.getPoints(divisions);

/** A wire hung between a and b, sagging `sag` at the middle (parabola). */
export function sagLine(a: P3, b: P3, sag: number, divisions = 16): THREE.Vector3[] {
  return Array.from({ length: divisions + 1 }, (_, i) => {
    const t = i / divisions;
    return new THREE.Vector3(
      a.x + (b.x - a.x) * t,
      a.y + (b.y - a.y) * t - 4 * sag * t * (1 - t),
      a.z + (b.z - a.z) * t,
    );
  });
}

/** `swags` sagging arcs round a ring of radius r at height y (festoons under battlements). */
export function festoon(cx: number, cz: number, y: number, r: number, swags: number, sag: number, a0 = 0) {
  const lines: THREE.Vector3[][] = [];
  for (let s = 0; s < swags; s++) {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 12; i++) {
      const f = i / 12;
      const a = a0 + ((s + f) / swags) * Math.PI * 2;
      pts.push(new THREE.Vector3(cx + Math.cos(a) * r, y - Math.sin(f * Math.PI) * sag, cz + Math.sin(a) * r));
    }
    lines.push(pts);
  }
  return lines;
}

/** A spiral winding up from y0 to y1 with `pitch` between turns; `radius(t)` (t 0..1 up) shapes it (a cone tree). */
export function spiral(cx: number, cz: number, y0: number, y1: number, pitch: number, radius: (t: number) => number) {
  const turns = Math.max(0.5, (y1 - y0) / pitch);
  const n = Math.ceil(turns * 32);
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n;
    const a = t * turns * Math.PI * 2;
    const r = radius(t);
    return new THREE.Vector3(cx + Math.cos(a) * r, y0 + (y1 - y0) * t, cz + Math.sin(a) * r);
  });
}

export interface StringLightsOptions {
  /** Distance between bulbs along each line. */
  spacing?: number;
  /** Bulb colours, cycled along each string. */
  colors?: THREE.ColorRepresentation[];
  /** Share of strings that are all warm white instead. */
  warmShare?: number;
  warm?: THREE.ColorRepresentation;
  /** World size of a bulb sprite. */
  size?: number;
  /** Twinkle depth (0 = steady). */
  twinkle?: number;
  texture?: THREE.Texture;
}

export const BULB_COLORS = [0xff2a2a, 0x2aff5a, 0xffc22a, 0x3a7aff, 0xff5ad8];

export class StringLights {
  readonly points: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  private base: Float32Array;
  private phase: Float32Array;
  private twinkle: number;

  /** `lines`: polylines (see pointsAlong / sagLine / festoon / spiral / sampleCurve). */
  constructor(lines: readonly (readonly P3[])[], o: StringLightsOptions = {}) {
    const spacing = o.spacing ?? 0.4;
    const colors = (o.colors ?? BULB_COLORS).map((c) => new THREE.Color(c));
    const warm = new THREE.Color(o.warm ?? 0xffd890);
    const pos: number[] = [];
    const col: number[] = [];
    const ph: number[] = [];
    lines.forEach((line, li) => {
      const allWarm = o.warmShare ? (li * 0.618034) % 1 < o.warmShare : false;
      pointsAlong(line, spacing).forEach((p, i) => {
        const c = allWarm ? warm : colors[i % colors.length];
        pos.push(p.x, p.y, p.z);
        col.push(c.r, c.g, c.b);
        ph.push(i * 1.3 + li);
      });
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    g.computeBoundingSphere();
    this.base = new Float32Array(col);
    this.phase = new Float32Array(ph);
    this.twinkle = o.twinkle ?? 1;
    this.points = new THREE.Points(
      g,
      new THREE.PointsMaterial({
        map: o.texture ?? bulbTexture(),
        size: o.size ?? 0.65,
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        fog: false,
      }),
    );
  }

  get count(): number {
    return this.phase.length;
  }

  /** Twinkle and chase at `time` seconds. */
  update(time: number): void {
    if (!this.twinkle) return;
    const c = this.points.geometry.getAttribute("color") as THREE.BufferAttribute;
    const a = c.array as Float32Array;
    const b = this.base;
    const ph = this.phase;
    const d = this.twinkle;
    for (let i = 0; i < ph.length; i++) {
      const k = 1 - d * (0.28 - 0.18 * Math.sin(time * 2.3 + ph[i] * 1.7) - 0.16 * Math.sin(time * 1.4 - ph[i] * 0.55));
      a[i * 3] = b[i * 3] * k;
      a[i * 3 + 1] = b[i * 3 + 1] * k;
      a[i * 3 + 2] = b[i * 3 + 2] * k;
    }
    c.needsUpdate = true;
  }

  dispose(): void {
    this.points.geometry.dispose();
    this.points.material.dispose();
  }
}
