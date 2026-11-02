// UiCanvas: the one 2D canvas every screen, menu and HUD element is painted into, laid over the game view.
//
// Two scaling modes:
//   "height" - Grudge: a logical space `height` units tall (width follows the window aspect) mapped to the native
//              backing store (CSS size x DPR, capped at maxPx lines). Shapes and text rasterise at full
//              resolution; layout never thinks in device pixels.
//   "pixel"  - QUICKLORE: a pixel-art content box (e.g. 480 x 270) at the largest whole-number scale that fits
//              the device pixels; the logical space is the whole canvas divided by that scale, with `stage` the
//              centred content box. Smoothing is off so pixels stay square.
// The backing store is re-fitted on every begin() (no stale resize events). Nothing reads pixels back from it, so
// the browser keeps it GPU-accelerated.
import type { Rect } from "./layout.ts";

export type UiScaleMode =
  | {
      kind: "height";
      height: number;
      /** Highest backing-store height in device pixels (default 2160). */ maxPx?: number;
    }
  | {
      kind: "pixel";
      width: number;
      height: number;
      /** Cap on the integer scale (0 = as large as fits). */ maxScale?: number;
    };

export interface UiMetrics {
  /** Backing store size in device pixels. */
  pw: number;
  ph: number;
  /** Logical size in layout units. */
  w: number;
  h: number;
  /** Device pixels per layout unit. */
  scale: number;
  /** The design content box in layout units (the full screen in "height" mode). */
  stage: Rect;
}

/** Pure scaling math for a CSS size and DPR (tested in node). */
export function computeUiMetrics(mode: UiScaleMode, cssW: number, cssH: number, dpr = 1): UiMetrics {
  const devW = Math.max(1, Math.round(cssW * dpr));
  const devH = Math.max(1, Math.round(cssH * dpr));
  if (mode.kind === "height") {
    const ph = Math.max(1, Math.min(mode.maxPx ?? 2160, devH));
    const pw = Math.max(1, Math.round((ph * devW) / devH));
    const h = mode.height;
    const w = (h * devW) / devH;
    return { pw, ph, w, h, scale: ph / h, stage: { x: 0, y: 0, w, h } };
  }
  let s = Math.max(1, Math.floor(Math.min(devW / mode.width, devH / mode.height)));
  if (mode.maxScale) s = Math.min(s, mode.maxScale);
  const w = devW / s;
  const h = devH / s;
  const stage = {
    x: Math.floor((w - mode.width) / 2),
    y: Math.floor((h - mode.height) / 2),
    w: mode.width,
    h: mode.height,
  };
  return { pw: devW, ph: devH, w, h, scale: s, stage };
}

export class UiCanvas {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  metrics: UiMetrics;

  constructor(
    public mode: UiScaleMode,
    parent?: HTMLElement,
    canvas?: HTMLCanvasElement,
  ) {
    this.canvas = canvas ?? document.createElement("canvas");
    if (!canvas) {
      Object.assign(this.canvas.style, { position: "absolute", left: "0", top: "0", width: "100%", height: "100%" });
      (parent ?? document.body).appendChild(this.canvas);
    }
    if (mode.kind === "pixel") this.canvas.style.imageRendering = "pixelated";
    this.ctx = this.canvas.getContext("2d")!;
    this.metrics = computeUiMetrics(mode, 1, 1);
  }

  get w(): number {
    return this.metrics.w;
  }
  get h(): number {
    return this.metrics.h;
  }
  get stage(): Rect {
    return this.metrics.stage;
  }

  /** Fits the backing store to the element's CSS size, clears it and returns the context in layout units. */
  begin(): CanvasRenderingContext2D {
    const r = this.canvas.getBoundingClientRect();
    const cssW = r.width || window.innerWidth;
    const cssH = r.height || window.innerHeight;
    const m = computeUiMetrics(this.mode, cssW, cssH, window.devicePixelRatio || 1);
    this.metrics = m;
    if (this.canvas.width !== m.pw || this.canvas.height !== m.ph) {
      this.canvas.width = m.pw;
      this.canvas.height = m.ph;
    }
    const g = this.ctx;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";
    g.clearRect(0, 0, m.pw, m.ph);
    g.setTransform(m.scale, 0, 0, m.scale, 0, 0);
    g.imageSmoothingEnabled = this.mode.kind !== "pixel";
    return g;
  }

  /** Converts a client (mouse) position to layout units. */
  toLayout(clientX: number, clientY: number): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    return {
      x: ((clientX - r.left) / Math.max(1, r.width)) * this.metrics.w,
      y: ((clientY - r.top) / Math.max(1, r.height)) * this.metrics.h,
    };
  }
}
