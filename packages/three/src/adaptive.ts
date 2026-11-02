// Adaptive render scale: budget for the weakest machine you'll play on. Feed frame times (ms); when the 90th
// percentile of the last `window` frames runs over budget the render scale steps down a level at once; it steps
// back up only after frames have stayed comfortably under budget (p90 < budget * upHeadroom) for `upAfterMs`, so
// it doesn't oscillate. Pure logic (no DOM, no clock): applyRenderScale() sizes a renderer from the result.
import type * as THREE from "three";

export interface AdaptiveOptions {
  /** Frame budget in ms (16.7 for 60 Hz). */
  budgetMs?: number;
  /** Render scale per level, highest first. */
  levels?: number[];
  /** Frames in the percentile window; a decision needs a full window since the last change. */
  window?: number;
  /** p90 must stay under budget * upHeadroom ... */
  upHeadroom?: number;
  /** ... for this long (ms of frames) before stepping back up. */
  upAfterMs?: number;
  /** Frames longer than this are ignored (a backgrounded tab, a GC pause, a shader compile). */
  ignoreOverMs?: number;
  /** Starting level. */
  level?: number;
}

export class AdaptiveResolution {
  readonly levels: number[];
  level: number;
  private readonly o: Required<Omit<AdaptiveOptions, "levels" | "level">>;
  private buf: Float64Array;
  private n = 0;
  private head = 0;
  private good = 0;
  private sorted: Float64Array;

  constructor(opts: AdaptiveOptions = {}) {
    this.levels = opts.levels ?? [1, 0.85, 0.72, 0.6, 0.5];
    this.level = Math.max(0, Math.min(this.levels.length - 1, opts.level ?? 0));
    this.o = {
      budgetMs: opts.budgetMs ?? 1000 / 60,
      window: opts.window ?? 60,
      upHeadroom: opts.upHeadroom ?? 0.7,
      upAfterMs: opts.upAfterMs ?? 5000,
      ignoreOverMs: opts.ignoreOverMs ?? 250,
    };
    this.buf = new Float64Array(this.o.window);
    this.sorted = new Float64Array(this.o.window);
  }

  get scale(): number {
    return this.levels[this.level];
  }

  /** 90th percentile of the current window (0 when empty). */
  p90(): number {
    if (!this.n) return 0;
    const s = this.sorted.subarray(0, this.n);
    s.set(this.buf.subarray(0, this.n));
    s.sort();
    return s[Math.min(this.n - 1, Math.floor(this.n * 0.9))];
  }

  /** Records one frame; returns true when the scale changed. */
  frame(ms: number): boolean {
    if (!(ms > 0) || ms > this.o.ignoreOverMs) return false;
    this.buf[this.head] = ms;
    this.head = (this.head + 1) % this.o.window;
    this.n = Math.min(this.o.window, this.n + 1);
    if (this.n < this.o.window) return false;
    const p = this.p90();
    if (p > this.o.budgetMs) {
      this.good = 0;
      if (this.level < this.levels.length - 1) return this.set(this.level + 1);
      return false;
    }
    if (p < this.o.budgetMs * this.o.upHeadroom) {
      this.good += ms;
      if (this.good >= this.o.upAfterMs && this.level > 0) return this.set(this.level - 1);
    } else this.good = 0;
    return false;
  }

  reset(level = this.level): void {
    this.level = level;
    this.n = 0;
    this.head = 0;
    this.good = 0;
  }

  private set(level: number): boolean {
    this.reset(level);
    return true;
  }
}

/**
 * Sizes the renderer's drawing buffer to CSS size x min(devicePixelRatio, maxDpr) x scale (CSS size unchanged).
 * Returns true when the buffer size changed (update camera aspect / render targets then).
 */
export function applyRenderScale(
  renderer: THREE.WebGLRenderer,
  scale: number,
  cssWidth: number,
  cssHeight: number,
  dpr = 1,
  maxDpr = 2,
): boolean {
  const ratio = Math.min(dpr, maxDpr) * scale;
  const w = Math.max(1, Math.round(cssWidth * ratio));
  const h = Math.max(1, Math.round(cssHeight * ratio));
  const c = renderer.domElement;
  if (c.width === w && c.height === h) return false;
  renderer.setPixelRatio(1);
  renderer.setSize(w, h, false);
  c.style.width = `${cssWidth}px`;
  c.style.height = `${cssHeight}px`;
  return true;
}
