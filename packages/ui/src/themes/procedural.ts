// Procedural textures for the example themes (wood planks, parchment, cloth), generated once from a seed with
// value noise into cache canvases. They let the wood theme look painted without shipping image files; a game
// passes its own texture images instead (its art, its look).
import { cacheCanvas } from "../paint/canvas.ts";

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Tileable value noise: a `cells` x `cells` lattice sampled smoothly over size x size. */
function noise(size: number, cells: number, r: () => number): Float32Array {
  const lat = Array.from({ length: cells * cells }, r);
  const out = new Float32Array(size * size);
  const sm = (t: number) => t * t * (3 - 2 * t);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const fx = (x / size) * cells;
      const fy = (y / size) * cells;
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      const tx = sm(fx - x0);
      const ty = sm(fy - y0);
      const v = (i: number, j: number) => lat[((j % cells) * cells + (i % cells)) | 0];
      const a = v(x0, y0) + (v(x0 + 1, y0) - v(x0, y0)) * tx;
      const b = v(x0, y0 + 1) + (v(x0 + 1, y0 + 1) - v(x0, y0 + 1)) * tx;
      out[y * size + x] = a + (b - a) * ty;
    }
  return out;
}

function fbm(size: number, r: () => number, octaves: [number, number][]): Float32Array {
  const out = new Float32Array(size * size);
  let total = 0;
  for (const [cells, w] of octaves) {
    const n = noise(size, cells, r);
    for (let i = 0; i < out.length; i++) out[i] += n[i] * w;
    total += w;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

const mix = (a: number[], b: number[], t: number) => a.map((v, i) => v + (b[i] - v) * t);

function paint(size: number, fn: (x: number, y: number, i: number) => number[]): HTMLCanvasElement {
  const c = cacheCanvas(size, size);
  const g = c.getContext("2d")!;
  const im = g.createImageData(size, size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const [r, gg, b] = fn(x, y, i);
      im.data[i * 4] = r;
      im.data[i * 4 + 1] = gg;
      im.data[i * 4 + 2] = b;
      im.data[i * 4 + 3] = 255;
    }
  g.putImageData(im, 0, 0);
  return c;
}

/** Horizontal wood grain (tileable), warm mid brown. */
export function woodTexture(seed = 7, size = 256): HTMLCanvasElement {
  const r = rng(seed);
  const warp = fbm(size, r, [
    [4, 1],
    [8, 0.5],
  ]);
  const fine = fbm(size, r, [
    [32, 1],
    [64, 0.6],
  ]);
  const dark = [92, 54, 28];
  const light = [168, 112, 62];
  return paint(size, (x, y, i) => {
    const ring =
      0.5 + 0.5 * Math.sin((y / size) * Math.PI * 2 * 9 + warp[i] * 9 + Math.sin((x / size) * Math.PI * 2) * 0.6);
    const streak = Math.pow(ring, 3);
    const t = 0.25 + streak * 0.55 + (fine[i] - 0.5) * 0.35;
    return mix(dark, light, Math.max(0, Math.min(1, t)));
  });
}

/** Aged parchment: warm cream with blotches, fibres and specks (tileable). */
export function parchmentTexture(seed = 11, size = 256): HTMLCanvasElement {
  const r = rng(seed);
  const blot = fbm(size, r, [
    [3, 1],
    [6, 0.7],
    [12, 0.4],
  ]);
  const fibre = fbm(size, r, [
    [48, 1],
    [96, 0.5],
  ]);
  const specks = Array.from({ length: size * size }, () => (r() < 0.004 ? r() : 0));
  const base = [238, 222, 184];
  const aged = [204, 170, 116];
  return paint(size, (_x, _y, i) => {
    const t = Math.max(0, Math.min(1, (blot[i] - 0.35) * 1.6 + (fibre[i] - 0.5) * 0.25));
    const c = mix(base, aged, t);
    const k = specks[i] ? 0.75 : 1;
    return c.map((v) => v * k);
  });
}

/** Woven cloth in a colour (banners, ribbons). */
export function clothTexture(rgb: [number, number, number], seed = 3, size = 128): HTMLCanvasElement {
  const r = rng(seed);
  const n = fbm(size, r, [
    [8, 1],
    [16, 0.5],
  ]);
  return paint(size, (x, y, i) => {
    const weave = ((x >> 1) + (y >> 1)) % 2 ? 0.94 : 1.04;
    const k = weave * (0.85 + n[i] * 0.3);
    return rgb.map((v) => Math.min(255, v * k));
  });
}
