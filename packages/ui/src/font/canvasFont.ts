// CanvasFont: a CSS font family drawn with fillText, as a fallback while the atlas loads, for tools, or for
// languages the atlas lacks. Same interface and metrics model as AtlasFont (size = em size in layout units,
// widths measured once at a reference size and scaled), with outline (strokeText) and drop shadow.
import type { Font, TextStyle } from "./font.ts";
import { shade } from "./atlasFont.ts";

export interface CanvasFontOpts {
  family: string;
  weight?: string | number;
  style?: string;
  /** Line box height as a multiple of size (default 1.2). */
  lineHeight?: number;
  caps?: boolean;
  color?: string;
  /** Extra letter spacing in em. */
  tracking?: number;
  /** Optional measure override (node tests, or a pre-measured table). */
  measure?: (s: string, size: number) => number;
}

const REF = 100;

export class CanvasFont implements Font {
  readonly name: string;
  private widths = new Map<string, number>();
  private mctx: CanvasRenderingContext2D | null = null;
  private loaded: boolean;

  constructor(private o: CanvasFontOpts) {
    this.name = o.family;
    this.loaded = typeof document === "undefined" || !document.fonts ? true : document.fonts.check(this.css(12));
    if (!this.loaded && typeof document !== "undefined") {
      void document.fonts.load(this.css(12)).then(() => {
        this.loaded = true;
        this.widths.clear();
      });
    }
  }

  private css(px: number): string {
    return `${this.o.style ?? "normal"} ${this.o.weight ?? 400} ${px}px ${this.o.family}`;
  }

  private text(s: string): string {
    return this.o.caps ? s.toUpperCase() : s;
  }

  ready(): boolean {
    return this.loaded;
  }

  measure(s: string, size: number): number {
    if (this.o.measure) return this.o.measure(this.text(s), size);
    s = this.text(s);
    let w = this.widths.get(s);
    if (w === undefined) {
      if (!this.mctx) this.mctx = document.createElement("canvas").getContext("2d")!;
      this.mctx.font = this.css(REF);
      w = this.mctx.measureText(s).width + (this.o.tracking ?? 0) * REF * Math.max(0, [...s].length - 1);
      if (this.widths.size > 4000) this.widths.clear();
      this.widths.set(s, w);
    }
    return (w * size) / REF;
  }

  lineHeight(size: number): number {
    return size * (this.o.lineHeight ?? 1.2);
  }

  draw(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, size: number, st: TextStyle = {}): void {
    if (!s) return;
    s = this.text(s);
    ctx.save();
    ctx.font = this.css(size);
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    const tr = (this.o.tracking ?? 0) * size;
    if (tr && "letterSpacing" in ctx) (ctx as unknown as { letterSpacing: string }).letterSpacing = `${tr}px`;
    const cy = y + this.lineHeight(size) / 2 + size * 0.04;
    const ow = Math.max(0.6, size * 0.16);
    if (st.shadow) {
      const d = Math.max(0.6, size * 0.08);
      ctx.fillStyle = st.shadow;
      if (st.outline) {
        ctx.lineJoin = "round";
        ctx.lineWidth = ow;
        ctx.strokeStyle = st.shadow;
        ctx.strokeText(s, x + d, cy + d);
      }
      ctx.fillText(s, x + d, cy + d);
    }
    if (st.outline) {
      ctx.lineJoin = "round";
      ctx.lineWidth = ow;
      ctx.strokeStyle = st.outline;
      ctx.strokeText(s, x, cy);
    }
    const color = st.color ?? this.o.color ?? "#ffffff";
    if (st.bevel) {
      const g = ctx.createLinearGradient(0, cy - size * 0.4, 0, cy + size * 0.4);
      g.addColorStop(0, shade(color, 0.3));
      g.addColorStop(1, shade(color, -0.15));
      ctx.fillStyle = g;
    } else ctx.fillStyle = color;
    ctx.fillText(s, x, cy);
    ctx.restore();
  }
}
