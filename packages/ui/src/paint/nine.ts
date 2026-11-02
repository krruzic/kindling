// Nine-slice panels from images: corners drawn as-is, edges and centre stretched (smooth art) or tiled (pixel
// art, so pixels stay crisp), at an optional integer `scale` of the source pixels. Plus a tiny sprite atlas
// (name -> rect / nine-slice border) loaded from JSON, as QUICKLORE's GUI sheet.
import { loadImage } from "./canvas.ts";

export interface NineSpec {
  /** Source rect in the image. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Border widths (source px): one value, or [top, right, bottom, left]. */
  border: number | [number, number, number, number];
}

export interface NineOpts {
  /** Tile edges / centre instead of stretching (pixel art). */
  tile?: boolean;
  /** Paint the centre (default true). */
  fill?: boolean;
  /** Layout units per source pixel (default 1; 2 draws pixel art at double size). */
  scale?: number;
}

export function drawNine(
  ctx: CanvasRenderingContext2D,
  im: CanvasImageSource,
  s: NineSpec,
  x: number,
  y: number,
  w: number,
  h: number,
  o: NineOpts = {},
): void {
  const k = o.scale ?? 1;
  const [bt, br, bb, bl] = typeof s.border === "number" ? [s.border, s.border, s.border, s.border] : s.border;
  if (o.tile) {
    x = Math.round(x);
    y = Math.round(y);
    w = Math.round(w);
    h = Math.round(h);
  }
  // Destination borders shrink when the panel is smaller than its corners.
  const fx = Math.min(1, w / ((bl + br) * k || 1));
  const fy = Math.min(1, h / ((bt + bb) * k || 1));
  const dl = bl * k * fx;
  const dr = br * k * fx;
  const dt = bt * k * fy;
  const db = bb * k * fy;
  const cw = s.w - bl - br;
  const ch = s.h - bt - bb;
  const part = (sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, dw: number, dh: number) => {
    if (sw <= 0 || sh <= 0 || dw <= 0 || dh <= 0) return;
    if (!o.tile) {
      ctx.drawImage(im, sx, sy, sw, sh, dx, dy, dw, dh);
      return;
    }
    const tw = sw * k;
    const th = sh * k;
    for (let yy = 0; yy < dh - 0.001; yy += th)
      for (let xx = 0; xx < dw - 0.001; xx += tw) {
        const ww = Math.min(tw, dw - xx);
        const hh = Math.min(th, dh - yy);
        ctx.drawImage(im, sx, sy, ww / k, hh / k, dx + xx, dy + yy, ww, hh);
      }
  };
  const X = s.x;
  const Y = s.y;
  part(X, Y, bl, bt, x, y, dl, dt);
  part(X + s.w - br, Y, br, bt, x + w - dr, y, dr, dt);
  part(X, Y + s.h - bb, bl, bb, x, y + h - db, dl, db);
  part(X + s.w - br, Y + s.h - bb, br, bb, x + w - dr, y + h - db, dr, db);
  part(X + bl, Y, cw, bt, x + dl, y, w - dl - dr, dt);
  part(X + bl, Y + s.h - bb, cw, bb, x + dl, y + h - db, w - dl - dr, db);
  part(X, Y + bt, bl, ch, x, y + dt, dl, h - dt - db);
  part(X + s.w - br, Y + bt, br, ch, x + w - dr, y + dt, dr, h - dt - db);
  if (o.fill !== false) part(X + bl, Y + bt, cw, ch, x + dl, y + dt, w - dl - dr, h - dt - db);
}

export interface AtlasEntry {
  rect: [number, number, number, number];
  /** Present for nine-slice entries. */
  border?: number | [number, number, number, number];
}

/** A sprite sheet: an image plus named rects / nine-slices (JSON: { entries: { name: AtlasEntry } }). */
export class SpriteAtlas {
  constructor(
    readonly image: CanvasImageSource,
    readonly entries: Record<string, AtlasEntry>,
  ) {}

  static async load(imageUrl: string, jsonUrl: string): Promise<SpriteAtlas> {
    const [im, json] = await Promise.all([loadImage(imageUrl), fetch(jsonUrl).then((r) => r.json())]);
    return new SpriteAtlas(im, (json as { entries: Record<string, AtlasEntry> }).entries);
  }

  has(name: string): boolean {
    return name in this.entries;
  }

  private get(name: string): AtlasEntry {
    const e = this.entries[name];
    if (!e) throw new Error(`atlas: no entry ${name}`);
    return e;
  }

  nineSpec(name: string): NineSpec {
    const e = this.get(name);
    const [x, y, w, h] = e.rect;
    return { x, y, w, h, border: e.border ?? Math.floor(Math.min(w, h) / 3) };
  }

  nine(
    ctx: CanvasRenderingContext2D,
    name: string,
    x: number,
    y: number,
    w: number,
    h: number,
    o: NineOpts = {},
  ): void {
    drawNine(ctx, this.image, this.nineSpec(name), x, y, w, h, o);
  }

  /** Draws a sprite with its top-left at (x, y), scaled by k. */
  sprite(ctx: CanvasRenderingContext2D, name: string, x: number, y: number, k = 1): void {
    const [sx, sy, sw, sh] = this.get(name).rect;
    ctx.drawImage(this.image, sx, sy, sw, sh, x, y, sw * k, sh * k);
  }

  size(name: string): { w: number; h: number } {
    const r = this.get(name).rect;
    return { w: r[2], h: r[3] };
  }
}
