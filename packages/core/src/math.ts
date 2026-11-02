// Small math helpers that are safe in a deterministic sim: only +, -, *, /, comparisons, Math.round/floor and
// Math.sqrt (all IEEE-exact, so every engine agrees). Transcendentals (Math.sin, atan2, pow, exp) are not guaranteed
// bit-identical across JS engines; lockstep peers on different browsers should avoid them in the sim or quantize
// their results with `quantize` before they feed back into state.

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Move `v` toward `target` by at most `step` (no overshoot). */
export function approach(v: number, target: number, step: number): number {
  return v < target ? Math.min(target, v + step) : Math.max(target, v - step);
}

/** Round to a grid of 1/scale (e.g. 64ths of a unit), the same quantisation hashes use. */
export function quantize(v: number, scale = 64): number {
  return Math.round(v * scale) / scale;
}

const TAU = Math.PI * 2;

/** Angle wrapped into (-PI, PI]. */
export function wrapAngle(a: number): number {
  a = a % TAU;
  if (a <= -Math.PI) a += TAU;
  else if (a > Math.PI) a -= TAU;
  return a;
}

/** Signed shortest difference b - a between two angles. */
export function angleDiff(a: number, b: number): number {
  return wrapAngle(b - a);
}

/** Squared distance (no sqrt) for range checks. */
export function dist2(ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  return dx * dx + dz * dz;
}
