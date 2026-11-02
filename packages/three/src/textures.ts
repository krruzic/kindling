// Small procedural sprite textures (DataTextures, so they also build in node without a canvas): soft radial glows,
// bulbs with a hot core, snowflakes, rings for shockwaves / selection, and a ragged scorch mark. White RGB with
// the shape in alpha, so materials tint them with vertex or instance colour.
import * as THREE from "three";

/** [radius 0..1, alpha 0..1] stops, linearly interpolated (like a canvas radial gradient). */
export type AlphaStops = readonly (readonly [number, number])[];

function ramp(stops: AlphaStops, r: number): number {
  if (r <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    const [r1, a1] = stops[i];
    if (r <= r1) {
      const [r0, a0] = stops[i - 1];
      return a0 + ((a1 - a0) * (r - r0)) / Math.max(1e-9, r1 - r0);
    }
  }
  return stops[stops.length - 1][1];
}

/** A white texture whose alpha is `alpha(u, v)` (u, v in -1..1 from the centre). */
export function alphaTexture(size: number, alpha: (u: number, v: number) => number): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const u = ((x + 0.5) / size) * 2 - 1;
      const v = ((y + 0.5) / size) * 2 - 1;
      const i = (y * size + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 255;
      data[i + 3] = Math.round(Math.max(0, Math.min(1, alpha(u, v))) * 255);
    }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

export function radialTexture(size: number, stops: AlphaStops): THREE.DataTexture {
  return alphaTexture(size, (u, v) => ramp(stops, Math.hypot(u, v)));
}

/** Soft additive glow (fake light): bright centre, long falloff. */
export const glowTexture = (size = 64) =>
  radialTexture(size, [
    [0, 1],
    [0.15, 0.75],
    [0.45, 0.22],
    [1, 0],
  ]);

/** A bulb: a hot core with a soft glow round it (Grudge's Christmas lights). */
export const bulbTexture = (size = 64) =>
  radialTexture(size, [
    [0, 1],
    [0.16, 1],
    [0.3, 0.4],
    [1, 0],
  ]);

/** A soft round snowflake. */
export const flakeTexture = (size = 32) =>
  radialTexture(size, [
    [0, 1],
    [0.35, 0.95],
    [0.6, 0.55],
    [1, 0],
  ]);

/** A ring between `inner` and `outer` (0..1 of the radius), feathered by `soft`. */
export const ringTexture = (size = 128, inner = 0.72, outer = 0.92, soft = 0.06) =>
  alphaTexture(size, (u, v) => {
    const r = Math.hypot(u, v);
    const a = Math.min((r - inner + soft) / soft, (outer + soft - r) / soft);
    return Math.max(0, Math.min(1, a));
  });

/** A ragged dark scorch blot (tint it near-black, normal blending). */
export function scorchTexture(size = 128, seed = 7): THREE.DataTexture {
  const ph = Array.from({ length: 5 }, (_, i) => Math.sin(seed * 12.9898 + i * 78.233) * 43758.5453);
  return alphaTexture(size, (u, v) => {
    const r = Math.hypot(u, v);
    const a = Math.atan2(v, u);
    let edge = 0.68;
    for (let k = 0; k < 5; k++) edge += Math.sin(a * (3 + k * 2) + ph[k]) * (0.06 / (k + 1));
    const t = 1 - Math.max(0, Math.min(1, (r - edge * 0.55) / (edge * 0.45)));
    return t * t * 0.9;
  });
}
