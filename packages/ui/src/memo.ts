// Memo panels: UI panels whose content changes rarely (resources, player cards, standings, menus) are painted
// once into their own canvas at the UI canvas's device scale and blitted 1:1 until their key changes. In Grudge's
// 4-player split this cut HUD CPU by about a third: most of a panel's cost is text and sprites that would
// otherwise be redrawn every frame.
//
// The key must capture everything the panel shows (rounded so animations only repaint at visible steps); the
// transform, panel rect and `extraKey()` (font / image readiness) are appended automatically. A rotated or faded
// context falls back to drawing directly, since a 1:1 blit would not line up.
import { liveCanvas, type CanvasFactory } from "./paint/canvas.ts";

interface Panel<T> {
  c: HTMLCanvasElement;
  key: string;
  out: T;
  used: number;
}

export interface MemoOpts {
  /** Canvas factory (tests pass a fake). */
  canvas?: CanvasFactory;
  /** Appended to every key: e.g. `() => \`${font.ready()}|${imagesReady()}\`` so panels repaint once art loads. */
  extraKey?: () => string;
  /** Panels not drawn for this many frames are freed (default 600). */
  maxIdle?: number;
}

export class Memo {
  private panels = new Map<string, Panel<unknown>>();
  private frame = 0;
  /** Repaints since creation (for perf overlays and tests). */
  repaints = 0;

  constructor(private o: MemoOpts = {}) {}

  /**
   * Draws panel `id` covering the layout rect (x, y, w, h), repainting it with `draw` only when `key` changed.
   * Returns draw()'s result (e.g. the panel's measured height), cached with the bitmap.
   */
  draw<T>(
    ctx: CanvasRenderingContext2D,
    id: string,
    key: string,
    x: number,
    y: number,
    w: number,
    h: number,
    draw: (g: CanvasRenderingContext2D) => T,
  ): T {
    const m = ctx.getTransform();
    if (m.b || m.c || ctx.globalAlpha !== 1) return draw(ctx);
    const px = Math.floor(m.a * x + m.e);
    const py = Math.floor(m.d * y + m.f);
    const pw = Math.ceil(m.a * w) + 2;
    const ph = Math.ceil(m.d * h) + 2;
    const full = `${key}|${m.a},${m.d},${m.e},${m.f},${x},${y},${w},${h}|${this.o.extraKey?.() ?? ""}`;
    let p = this.panels.get(id) as Panel<T> | undefined;
    if (!p) {
      p = { c: (this.o.canvas ?? liveCanvas)(pw, ph), key: "", out: undefined as T, used: 0 };
      this.panels.set(id, p as Panel<unknown>);
    }
    p.used = this.frame;
    if (p.key !== full) {
      this.repaints++;
      if (p.c.width !== pw || p.c.height !== ph) {
        p.c.width = pw;
        p.c.height = ph;
      }
      const g = p.c.getContext("2d")!;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, pw, ph);
      g.imageSmoothingEnabled = ctx.imageSmoothingEnabled;
      g.setTransform(m.a, 0, 0, m.d, m.e - px, m.f - py);
      p.out = draw(g);
      p.key = full;
    }
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(p.c, px, py);
    ctx.restore();
    return p.out;
  }

  /** Forces panel `id` (or every panel) to repaint next draw. */
  invalidate(id?: string): void {
    if (id === undefined) for (const p of this.panels.values()) p.key = "";
    else {
      const p = this.panels.get(id);
      if (p) p.key = "";
    }
  }

  /** Call once per frame: frees panels that haven't been drawn for a while. */
  tick(): void {
    this.frame++;
    const idle = this.o.maxIdle ?? 600;
    for (const [id, p] of this.panels)
      if (this.frame - p.used > idle) {
        p.c.width = p.c.height = 0;
        this.panels.delete(id);
      }
  }

  get size(): number {
    return this.panels.size;
  }

  clear(): void {
    for (const p of this.panels.values()) p.c.width = p.c.height = 0;
    this.panels.clear();
  }
}
