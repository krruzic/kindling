// Split-screen layout: 1-4 player views on one screen, plus the seams drawn between them.
//   layoutViews()  pixel games (QUICKLORE): fixed-size views (e.g. 320 x 176 game px) at the largest integer scale
//                  that fits; 2 players pick side-by-side or stacked, whichever scales bigger; 3 leaves a spare
//                  quadrant (map, standings).
//   splitViews()   smooth games (Grudge 3D): views fill the screen (halves / quadrants), optional gap.
//   seams()        the shared edges between view rects; drawSeams() paints them as a dark frame with a light bevel
//                  so the views read as separate windows.
import type { Rect } from "./layout.ts";

export interface ViewLayout {
  /** Integer scale (pixel layouts) or 1. */
  scale: number;
  rects: Rect[];
  /** The unused quadrant with 3 players. */
  spare: Rect | null;
}

function gridsFor(n: number, wide = true): [number, number][] {
  if (n <= 1) return [[1, 1]];
  if (n === 2)
    return wide
      ? [
          [2, 1],
          [1, 2],
        ]
      : [
          [1, 2],
          [2, 1],
        ];
  return [[2, 2]];
}

/** Fixed-size pixel views (viewW x viewH game px) at the largest integer scale that fits W x H device px. */
export function layoutViews(
  n: number,
  W: number,
  H: number,
  o: { viewW: number; viewH: number; maxScale?: number },
): ViewLayout {
  let best = { s: 0, c: 1, r: 1 };
  for (const [c, r] of gridsFor(n)) {
    let s = Math.max(1, Math.floor(Math.min(W / c / o.viewW, H / r / o.viewH)));
    if (o.maxScale) s = Math.min(s, o.maxScale);
    if (s > best.s) best = { s, c, r };
  }
  const s = best.s;
  const vw = o.viewW * s;
  const vh = o.viewH * s;
  const ox = Math.floor((W - best.c * vw) / 2);
  const oy = Math.floor((H - best.r * vh) / 2);
  const rects: Rect[] = [];
  for (let i = 0; i < best.c * best.r; i++)
    rects.push({ x: ox + (i % best.c) * vw, y: oy + Math.floor(i / best.c) * vh, w: vw, h: vh });
  return { scale: s, rects: rects.slice(0, Math.max(1, n)), spare: n === 3 ? rects[3] : null };
}

/**
 * Views filling W x H: 1 full, 2 side by side (`vertical` = stacked instead), 3-4 quadrants (3 leaves a spare).
 * Edges land on whole units; `gap` leaves room for seams between views.
 */
export function splitViews(n: number, W: number, H: number, o: { vertical?: boolean; gap?: number } = {}): ViewLayout {
  const g = o.gap ?? 0;
  const [c, r] = n <= 1 ? [1, 1] : n === 2 ? (o.vertical ? [1, 2] : [2, 1]) : [2, 2];
  const xs = [0, ...Array.from({ length: c - 1 }, (_, i) => Math.round(((i + 1) * W) / c)), W];
  const ys = [0, ...Array.from({ length: r - 1 }, (_, i) => Math.round(((i + 1) * H) / r)), H];
  const rects: Rect[] = [];
  for (let j = 0; j < r; j++)
    for (let i = 0; i < c; i++) {
      const x0 = xs[i] + (i > 0 ? g / 2 : 0);
      const x1 = xs[i + 1] - (i < c - 1 ? g / 2 : 0);
      const y0 = ys[j] + (j > 0 ? g / 2 : 0);
      const y1 = ys[j + 1] - (j < r - 1 ? g / 2 : 0);
      rects.push({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
    }
  return { scale: 1, rects: rects.slice(0, Math.max(1, n)), spare: n === 3 ? rects[3] : null };
}

export interface Seam {
  dir: "v" | "h";
  /** x of a vertical seam / y of a horizontal one. */
  at: number;
  from: number;
  len: number;
}

/** Shared edges between rects (touching, or separated by up to `gap`). Each seam is reported once. */
export function seams(rects: Rect[], gap = 0): Seam[] {
  const out = new Map<string, Seam>();
  const near = (a: number, b: number) => Math.abs(a - b) <= gap + 0.01;
  for (const a of rects)
    for (const b of rects) {
      if (a === b) continue;
      if (near(a.x + a.w, b.x) && b.x >= a.x + a.w - 0.01) {
        const from = Math.max(a.y, b.y);
        const len = Math.min(a.y + a.h, b.y + b.h) - from;
        if (len > 0) {
          const at = (a.x + a.w + b.x) / 2;
          out.set(`v${at},${from}`, { dir: "v", at, from, len });
        }
      }
      if (near(a.y + a.h, b.y) && b.y >= a.y + a.h - 0.01) {
        const from = Math.max(a.x, b.x);
        const len = Math.min(a.x + a.w, b.x + b.w) - from;
        if (len > 0) {
          const at = (a.y + a.h + b.y) / 2;
          out.set(`h${at},${from}`, { dir: "h", at, from, len });
        }
      }
    }
  // Merge collinear pieces (two quadrant edges along one line become one seam).
  const list = [...out.values()].sort((p, q) => (p.dir + p.at).localeCompare(q.dir + q.at) || p.from - q.from);
  const merged: Seam[] = [];
  for (const s of list) {
    const m = merged[merged.length - 1];
    if (m && m.dir === s.dir && m.at === s.at && s.from <= m.from + m.len + gap + 0.01)
      m.len = Math.max(m.len, s.from + s.len - m.from);
    else merged.push({ ...s });
  }
  return merged;
}

export interface SeamStyle {
  /** Seam thickness (layout / game units). */
  width?: number;
  color?: string;
  bevel?: string;
}

/** Paints seams as a dark frame with a 1-unit light bevel on each side. */
export function drawSeams(ctx: CanvasRenderingContext2D, list: Seam[], st: SeamStyle = {}): void {
  const B = st.width ?? 4;
  for (const s of list) {
    const [x, y, w, h] =
      s.dir === "v" ? [Math.round(s.at - B / 2), s.from, B, s.len] : [s.from, Math.round(s.at - B / 2), s.len, B];
    ctx.fillStyle = st.color ?? "#0e1414";
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = st.bevel ?? "#3c4a46";
    if (s.dir === "v") {
      ctx.fillRect(x, y, 1, h);
      ctx.fillRect(x + w - 1, y, 1, h);
    } else {
      ctx.fillRect(x, y, w, 1);
      ctx.fillRect(x, y + h - 1, w, 1);
    }
  }
}
