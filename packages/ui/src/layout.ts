// Layout math in UI layout units: rects, insets, stacks / rows / grids from measured sizes, anchoring, "does it
// fit" checks and safe areas for the common screen aspects. Pure functions, no canvas: every component lays out
// with these first and then paints into the rects, so the same numbers drive drawing, hit-testing and the
// overflow debugger (debug.ts).

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Size {
  w: number;
  h: number;
}

export type Align = "start" | "center" | "end";
export type Justify = Align | "between";

export const rect = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h });

/** Shrinks a rect by CSS-style padding (one, two or four values). */
export function inset(r: Rect, t: number, rr = t, b = t, l = rr): Rect {
  return { x: r.x + l, y: r.y + t, w: Math.max(0, r.w - l - rr), h: Math.max(0, r.h - t - b) };
}

export function grow(r: Rect, d: number): Rect {
  return { x: r.x - d, y: r.y - d, w: r.w + d * 2, h: r.h + d * 2 };
}

/** True when `inner` lies within `outer` (with `eps` slack for sub-unit rounding). */
export function contains(outer: Rect, inner: Rect, eps = 0.01): boolean {
  return (
    inner.x >= outer.x - eps &&
    inner.y >= outer.y - eps &&
    inner.x + inner.w <= outer.x + outer.w + eps &&
    inner.y + inner.h <= outer.y + outer.h + eps
  );
}

export function containsPoint(r: Rect, x: number, y: number): boolean {
  return x >= r.x && y >= r.y && x <= r.x + r.w && y <= r.y + r.h;
}

/** Overlap area of two rects (0 when they only touch). */
export function overlapArea(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

export function union(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

/** A w x h box placed inside `r` at fractional anchor (0 = left/top, 0.5 = centre, 1 = right/bottom). */
export function anchor(r: Rect, w: number, h: number, ax = 0.5, ay = 0.5): Rect {
  return { x: r.x + (r.w - w) * ax, y: r.y + (r.h - h) * ay, w, h };
}

export function center(r: Rect, w: number, h: number): Rect {
  return anchor(r, w, h, 0.5, 0.5);
}

/** Rounds a rect outwards to whole units (pixel styles). */
export function snap(r: Rect): Rect {
  const x = Math.floor(r.x);
  const y = Math.floor(r.y);
  return { x, y, w: Math.ceil(r.x + r.w) - x, h: Math.ceil(r.y + r.h) - y };
}

const alignOffset = (free: number, a: Align) => (a === "start" ? 0 : a === "center" ? free / 2 : free);

export interface FlowOpts {
  gap?: number;
  /** Placement along the flow when the sizes don't fill it. */
  justify?: Justify;
  /** Cross-axis size: "stretch" (default) fills the rect, a number fixes it, aligned by `align`. */
  cross?: "stretch" | number;
  align?: Align;
}

function flow(total: number, sizes: number[], o: FlowOpts): { at: number[]; gap: number } {
  let gap = o.gap ?? 0;
  const used = sizes.reduce((a, b) => a + b, 0) + gap * Math.max(0, sizes.length - 1);
  let start = 0;
  const j = o.justify ?? "start";
  if (j === "between" && sizes.length > 1) gap += (total - used) / (sizes.length - 1);
  else if (j !== "between") start = alignOffset(total - used, j);
  const at: number[] = [];
  let p = start;
  for (const s of sizes) {
    at.push(p);
    p += s + gap;
  }
  return { at, gap };
}

/** Vertical stack of children with the given heights inside `r`. */
export function stack(r: Rect, heights: number[], o: FlowOpts = {}): Rect[] {
  const { at } = flow(r.h, heights, o);
  const cw = o.cross === undefined || o.cross === "stretch" ? r.w : o.cross;
  const cx = r.x + alignOffset(r.w - cw, o.align ?? "start");
  return heights.map((h, i) => ({ x: cx, y: r.y + at[i], w: cw, h }));
}

/** Horizontal row of children with the given widths inside `r`. */
export function row(r: Rect, widths: number[], o: FlowOpts = {}): Rect[] {
  const { at } = flow(r.w, widths, o);
  const ch = o.cross === undefined || o.cross === "stretch" ? r.h : o.cross;
  const cy = r.y + alignOffset(r.h - ch, o.align ?? "start");
  return widths.map((w, i) => ({ x: r.x + at[i], y: cy, w, h: ch }));
}

/** Total length of a flow of sizes with gaps (what stack/row need). */
export function flowLength(sizes: number[], gap = 0): number {
  return sizes.reduce((a, b) => a + b, 0) + gap * Math.max(0, sizes.length - 1);
}

export interface GridOpts {
  cols: number;
  gap?: number;
  gapY?: number;
  /** Fixed cell size; by default cells divide the rect evenly (rows from the item count). */
  cellW?: number;
  cellH?: number;
  /** Centre the grid block inside the rect when cells are fixed. */
  center?: boolean;
}

/** `n` cells laid out row-major in `cols` columns. */
export function grid(r: Rect, n: number, o: GridOpts): Rect[] {
  const cols = Math.max(1, o.cols);
  const rows = Math.max(1, Math.ceil(n / cols));
  const gx = o.gap ?? 0;
  const gy = o.gapY ?? gx;
  const cw = o.cellW ?? (r.w - gx * (cols - 1)) / cols;
  const ch = o.cellH ?? (r.h - gy * (rows - 1)) / rows;
  const bw = cw * cols + gx * (cols - 1);
  const bh = ch * rows + gy * (rows - 1);
  const ox = r.x + (o.center ? (r.w - bw) / 2 : 0);
  const oy = r.y + (o.center ? (r.h - bh) / 2 : 0);
  const out: Rect[] = [];
  for (let i = 0; i < n; i++) {
    const c = i % cols;
    const rr = Math.floor(i / cols);
    out.push({ x: ox + c * (cw + gx), y: oy + rr * (ch + gy), w: cw, h: ch });
  }
  return out;
}

/** Splits a rect into left / right at `at` (a fraction 0..1, or units when > 1), with a gap between. */
export function splitX(r: Rect, at: number, gap = 0): [Rect, Rect] {
  const a = at <= 1 ? (r.w - gap) * at : at;
  return [
    { x: r.x, y: r.y, w: a, h: r.h },
    { x: r.x + a + gap, y: r.y, w: Math.max(0, r.w - a - gap), h: r.h },
  ];
}

export function splitY(r: Rect, at: number, gap = 0): [Rect, Rect] {
  const a = at <= 1 ? (r.h - gap) * at : at;
  return [
    { x: r.x, y: r.y, w: r.w, h: a },
    { x: r.x, y: r.y + a + gap, w: r.w, h: Math.max(0, r.h - a - gap) },
  ];
}

/** Does content of size `s` fit in `r`? */
export function fits(s: Size, r: Rect | Size, eps = 0.01): boolean {
  return s.w <= r.w + eps && s.h <= r.h + eps;
}

// ── Safe areas ──

export const ASPECTS = { "16:9": 16 / 9, "16:10": 16 / 10, "4:3": 4 / 3, "21:9": 21 / 9 } as const;

/**
 * The centred rect of aspect `aspect` (clipped to the screen) inset by `margin` (fraction of height): lay out
 * important UI inside safeArea(W, H, 4/3) and it stays on screen and clear of the edges at 16:9, 16:10 and 4:3.
 * The UI space is W x H layout units (height fixed, width follows the window).
 */
export function safeArea(W: number, H: number, aspect: number = ASPECTS["16:9"], margin = 0.04): Rect {
  const w = Math.min(W, H * aspect);
  const m = H * margin;
  return inset({ x: (W - w) / 2, y: 0, w, h: H }, m);
}

/** Logical UI width for a fixed UI height at a screen aspect (e.g. 240 tall at 16:10 is 384 wide). */
export function widthFor(H: number, aspect: number): number {
  return Math.round(H * aspect);
}
