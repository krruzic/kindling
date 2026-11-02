// AtlasFont: a bitmap face from an atlas PNG + metrics JSON (Grudge's game font, QUICKLORE's pixel font).
//
// Atlas layout: every glyph is a cell `h` font pixels tall, stored at `scale` atlas pixels per font pixel, with
// the glyph's fill in the RED channel and a dilated outline in the GREEN channel (alpha ignored). That lets one
// atlas be tinted to any colour and drawn with an ink rim and drop shadow. A string is stamped once into a cache
// canvas at the exact device-pixel size it will be drawn at (high-quality downsampling for smooth faces, nearest
// neighbour at whole multiples for pixel faces), tinted, and reused until evicted (LRU). Text whose size animates
// (slam-in banners) reuses the nearest existing bake while it moves, so it doesn't bake every frame.
import { cacheCanvas, deviceScale, loadImage } from "../paint/canvas.ts";
import type { Font, TextStyle } from "./font.ts";

export interface AtlasGlyph {
  /** Cell position and width in font pixels (multiply by `scale` for atlas pixels). */
  x: number;
  y: number;
  w: number;
  /** Pen advance in font pixels. */
  adv: number;
  /** Left bearing: how far the cell starts left of the pen. */
  ox: number;
}

export interface AtlasMetrics {
  /** Em size in font pixels (`size` in layout units maps to `px` font pixels). */
  px: number;
  /** Line box (cell) height in font pixels. */
  h: number;
  /** Baseline from the cell top, in font pixels. */
  base: number;
  /** Atlas pixels per font pixel (default 1). */
  scale?: number;
  /** Extra spacing between glyphs in font pixels. */
  track?: number;
  /** The face has no lower case: strings are upper-cased. */
  caps?: boolean;
  /** Pixel face: draw with nearest-neighbour at whole multiples. */
  pixel?: boolean;
  glyphs: Record<string, AtlasGlyph>;
}

export interface AtlasFontOpts {
  name?: string;
  /** Default fill colour. */
  color?: string;
  /** Default outline / shadow ink. */
  ink?: string;
  /** Most baked strings kept (LRU). */
  cacheSize?: number;
  /** Most new bakes per ~frame before animating text reuses nearby sizes. */
  bakesPerFrame?: number;
}

type Baked = { c: HTMLCanvasElement; w: number; h: number };
const PAD = 2;

export class AtlasFont implements Font {
  readonly name: string;
  readonly pixel: boolean;
  private readonly S: number;
  private fillMask: HTMLCanvasElement | null = null;
  private lineMask: HTMLCanvasElement | null = null;
  private tinted = new Map<string, HTMLCanvasElement>();
  private cache = new Map<string, Baked>();
  private widths = new Map<string, number>();
  private families = new Map<string, { at: number; sizes: number[] }>();
  private budgetAt = 0;
  private budgetLeft = 0;
  private scratch: HTMLCanvasElement | null = null;

  constructor(
    readonly metrics: AtlasMetrics,
    atlas: CanvasImageSource | null = null,
    private opts: AtlasFontOpts = {},
  ) {
    this.name = opts.name ?? "atlas";
    this.pixel = !!metrics.pixel;
    this.S = metrics.scale ?? 1;
    if (atlas) this.setAtlas(atlas);
  }

  /** Loads the atlas image and metrics JSON from URLs. */
  static async load(atlasUrl: string, metricsUrl: string, opts: AtlasFontOpts = {}): Promise<AtlasFont> {
    const [im, metrics] = await Promise.all([loadImage(atlasUrl), fetch(metricsUrl).then((r) => r.json())]);
    return new AtlasFont(metrics as AtlasMetrics, im, opts);
  }

  /** Splits the atlas into its fill and outline masks (white, alpha from the red / green channels). */
  setAtlas(im: CanvasImageSource): void {
    const w = (im as HTMLImageElement).naturalWidth || (im as HTMLCanvasElement).width;
    const h = (im as HTMLImageElement).naturalHeight || (im as HTMLCanvasElement).height;
    const c = cacheCanvas(w, h);
    const g = c.getContext("2d", { willReadFrequently: true })!;
    g.drawImage(im, 0, 0);
    const src = g.getImageData(0, 0, w, h);
    const mask = (ch: number) => {
      const out = new ImageData(w, h);
      for (let i = 0; i < src.data.length; i += 4) {
        out.data[i] = out.data[i + 1] = out.data[i + 2] = 255;
        out.data[i + 3] = src.data[i + ch];
      }
      const m = cacheCanvas(w, h);
      m.getContext("2d")!.putImageData(out, 0, 0);
      return m;
    };
    this.fillMask = mask(0);
    this.lineMask = mask(1);
    this.tinted.clear();
    for (const b of this.cache.values()) b.c.width = b.c.height = 0;
    this.cache.clear();
    this.families.clear();
  }

  ready(): boolean {
    return !!this.fillMask;
  }

  private text(s: string): string {
    return this.metrics.caps ? s.toUpperCase() : s;
  }

  private glyph(ch: string): AtlasGlyph {
    const G = this.metrics.glyphs;
    return (
      G[ch] ?? G[ch.toUpperCase()] ?? G[ch.toLowerCase()] ?? G["?"] ?? G[" "] ?? { x: 0, y: 0, w: 0, adv: 4, ox: 0 }
    );
  }

  /** Width in font pixels. */
  private raw(s: string): number {
    let w = this.widths.get(s);
    if (w === undefined) {
      const t = this.metrics.track ?? 0;
      w = 0;
      for (const ch of s) w += this.glyph(ch).adv + t;
      w = Math.max(0, w - t);
      if (this.widths.size > 4000) this.widths.clear();
      this.widths.set(s, w);
    }
    return w;
  }

  measure(s: string, size: number): number {
    return (this.raw(this.text(s)) * size) / this.metrics.px;
  }

  lineHeight(size: number): number {
    return (this.metrics.h * size) / this.metrics.px;
  }

  /** Mask in a colour (cached per colour). */
  private ink(mask: HTMLCanvasElement, color: string, which: string): HTMLCanvasElement {
    const key = `${which}|${color}`;
    let c = this.tinted.get(key);
    if (!c) {
      c = cacheCanvas(mask.width, mask.height);
      const g = c.getContext("2d")!;
      g.drawImage(mask, 0, 0);
      g.globalCompositeOperation = "source-in";
      g.fillStyle = color;
      g.fillRect(0, 0, c.width, c.height);
      if (this.tinted.size > 32) this.tinted.clear();
      this.tinted.set(key, c);
    }
    return c;
  }

  /** Stamps glyphs from `src` into `g` at `px` device pixels per font pixel, pen starting at font px (dx, dy). */
  private stamp(g: CanvasRenderingContext2D, src: HTMLCanvasElement, s: string, dx: number, dy: number, px: number) {
    const { h } = this.metrics;
    const S = this.S;
    const t = this.metrics.track ?? 0;
    g.imageSmoothingEnabled = !this.pixel;
    if (!this.pixel) g.imageSmoothingQuality = "high";
    let pen = dx;
    for (const ch of s) {
      const gl = this.glyph(ch);
      if (gl.w > 0)
        g.drawImage(
          src,
          gl.x * S,
          gl.y * S,
          gl.w * S,
          h * S,
          Math.round((pen - gl.ox) * px),
          dy * px,
          gl.w * px,
          h * px,
        );
      pen += gl.adv + t;
    }
  }

  private bake(s: string, st: Required<Omit<TextStyle, "outline" | "shadow">> & TextStyle, px: number): Baked {
    const fam = `${st.color}|${st.outline || ""}|${st.shadow || ""}|${st.bevel ? 1 : 0}|${s}`;
    const key = `${px}|${fam}`;
    const hit = this.cache.get(key);
    if (hit) {
      this.cache.delete(key);
      this.cache.set(key, hit);
      return hit;
    }
    const now = typeof performance !== "undefined" ? performance.now() : 0;
    if (now - this.budgetAt > 12) {
      this.budgetAt = now;
      this.budgetLeft = this.opts.bakesPerFrame ?? 8;
    }
    const f = this.families.get(fam);
    if (f && (now - f.at < 250 || this.budgetLeft <= 0)) {
      let best: Baked | undefined;
      let bestD = Infinity;
      for (const p of f.sizes) {
        const b = this.cache.get(`${p}|${fam}`);
        const d = p >= px ? p / px : (2 * px) / p;
        if (b && d < bestD) {
          best = b;
          bestD = d;
        }
      }
      if (best) return best;
    }
    this.budgetLeft--;
    if (f) {
      f.at = now;
      if (!f.sizes.includes(px)) f.sizes.push(px);
      if (f.sizes.length > 8) f.sizes.shift();
    } else {
      if (this.families.size > 4000) this.families.clear();
      this.families.set(fam, { at: now, sizes: [px] });
    }

    const { h, base } = this.metrics;
    const sh = Math.max(1, Math.round(h / 9));
    const w0 = Math.ceil(this.raw(s)) + PAD * 2 + sh + 2;
    const h0 = h + PAD * 2 + sh;
    const o = cacheCanvas(Math.max(1, Math.round(w0 * px)), Math.max(1, Math.round(h0 * px)));
    const og = o.getContext("2d")!;
    const outline = st.outline || null;
    const shadow = st.shadow || null;
    if (shadow)
      this.stamp(
        og,
        this.ink(outline ? this.lineMask! : this.fillMask!, shadow, outline ? "l" : "f"),
        s,
        PAD + sh,
        PAD + sh,
        px,
      );
    if (outline) this.stamp(og, this.ink(this.lineMask!, outline, "l"), s, PAD, PAD, px);
    // Fill: stamp the white mask into scratch, tint it (bevel gradient or flat), composite over.
    if (!this.scratch) this.scratch = cacheCanvas();
    const sc = this.scratch;
    sc.width = o.width;
    sc.height = o.height;
    const sg = sc.getContext("2d")!;
    this.stamp(sg, this.fillMask!, s, PAD, PAD, px);
    sg.globalCompositeOperation = "source-in";
    if (st.bevel) {
      const grad = sg.createLinearGradient(0, (PAD + 1) * px, 0, (PAD + base) * px);
      grad.addColorStop(0, shade(st.color, outline ? 0.38 : 0.15));
      grad.addColorStop(0.55, st.color);
      grad.addColorStop(1, shade(st.color, outline ? -0.3 : -0.15));
      sg.fillStyle = grad;
    } else sg.fillStyle = st.color;
    sg.fillRect(0, 0, sc.width, sc.height);
    og.drawImage(sc, 0, 0);
    const baked = { c: o, w: w0, h: h0 };
    this.cache.set(key, baked);
    if (this.cache.size > (this.opts.cacheSize ?? 1200)) {
      const oldest = this.cache.keys().next().value!;
      this.cache.get(oldest)!.c.width = 0;
      this.cache.delete(oldest);
    }
    return baked;
  }

  draw(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, size: number, style: TextStyle = {}): void {
    if (!this.fillMask || !s) return;
    s = this.text(s);
    const k = size / this.metrics.px;
    const ppu = deviceScale(ctx);
    const px = this.pixel ? Math.max(1, Math.round(k * ppu)) : Math.min(this.S, Math.round(k * ppu * 8) / 8);
    const st = {
      color: style.color ?? this.opts.color ?? "#ffffff",
      outline: style.outline === undefined ? null : style.outline,
      shadow: style.shadow === undefined ? (this.opts.ink ?? "rgba(0,0,0,0.5)") : style.shadow,
      bevel: style.bevel ?? !this.pixel,
    };
    const b = this.bake(s, st, px);
    const smooth = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = !this.pixel;
    if (!this.pixel) ctx.imageSmoothingQuality = "high";
    const dx = this.pixel ? Math.round((x - PAD * k) * ppu) / ppu : x - PAD * k;
    const dy = this.pixel ? Math.round((y - PAD * k) * ppu) / ppu : y - PAD * k;
    ctx.drawImage(b.c, dx, dy, b.w * k, b.h * k);
    ctx.imageSmoothingEnabled = smooth;
  }
}

/** Lightens (k > 0) or darkens (k < 0) a #rgb / #rrggbb colour; other formats pass through. */
export function shade(color: string, k: number): string {
  const m = color.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return color;
  let hex = m[1];
  if (hex.length === 3) hex = [...hex].map((c) => c + c).join("");
  const v = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const f = (c: number) => Math.round(k >= 0 ? c + (255 - c) * k : c * (1 + k));
  return `rgb(${f(v[0])},${f(v[1])},${f(v[2])})`;
}
