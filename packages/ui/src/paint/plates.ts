// Baked plates: expensive procedural art (textured panels, beams, seals, backdrops) painted once per size and
// device scale into a CPU cache canvas and then drawn as a single image (LRU). Image patterns are only ever used
// inside these bakes (see canvas.ts). Theme painters are built from plate() so drawing a whole menu of parchment
// cards costs a handful of drawImage calls.
import { cacheCanvas, deviceScale, type CanvasFactory } from "./canvas.ts";

export class PlateCache {
  private plates = new Map<string, HTMLCanvasElement>();
  /** Bakes since creation. */
  bakes = 0;

  constructor(
    private max = 300,
    private factory: CanvasFactory = cacheCanvas,
  ) {}

  /**
   * Draws plate `id` over (x, y, w, h), baking it first with `paint(g, w, h)` (in layout units, origin at the
   * plate's top-left) when this id / size / device scale isn't cached. `margin` extends the bake on every side for
   * shadows and overhangs.
   */
  draw(
    ctx: CanvasRenderingContext2D,
    id: string,
    x: number,
    y: number,
    w: number,
    h: number,
    paint: (g: CanvasRenderingContext2D, w: number, h: number) => void,
    margin = 0,
  ): void {
    if (w <= 0 || h <= 0) return;
    const k = Math.max(1, deviceScale(ctx));
    const key = `${id}|${w.toFixed(2)}|${h.toFixed(2)}|${k.toFixed(3)}|${margin}`;
    let c = this.plates.get(key);
    const tw = w + margin * 2;
    const th = h + margin * 2;
    if (!c) {
      this.bakes++;
      c = this.factory(Math.max(1, Math.ceil(tw * k)), Math.max(1, Math.ceil(th * k)));
      const g = c.getContext("2d")!;
      g.scale(c.width / tw, c.height / th);
      g.translate(margin, margin);
      g.imageSmoothingEnabled = true;
      paint(g, w, h);
      this.plates.set(key, c);
      if (this.plates.size > this.max) {
        const old = this.plates.keys().next().value!;
        this.plates.get(old)!.width = 0;
        this.plates.delete(old);
      }
    } else {
      this.plates.delete(key);
      this.plates.set(key, c);
    }
    ctx.drawImage(c, x - margin, y - margin, tw, th);
  }

  clear(): void {
    for (const c of this.plates.values()) c.width = 0;
    this.plates.clear();
  }
}
