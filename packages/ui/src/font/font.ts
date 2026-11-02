// The Font interface every UI string goes through, plus text drawing helpers that measure first and never
// overflow (see text.ts). Two implementations: AtlasFont (a bitmap face from a PNG + metrics JSON, the look the
// game owns) and CanvasFont (a CSS font family, as a fallback or for tools). `size` is the em size in layout
// units; widths scale linearly with it.
import type { Rect } from "../layout.ts";
import { fitBlock, fitLine, type BlockFit, type LineFit } from "../text.ts";

export interface TextStyle {
  color?: string;
  /** Outline colour (ink rim around each glyph), or null / false for none. */
  outline?: string | null | false;
  /** Drop shadow colour, or null / false for none. */
  shadow?: string | null | false;
  /** Bevel gradient on the fill (lighter top, darker bottom). Default true for atlas fonts. */
  bevel?: boolean;
}

export interface Font {
  readonly name: string;
  /** Width of `s` at `size`. */
  measure(s: string, size: number): number;
  /** Height of one line box at `size`. */
  lineHeight(size: number): number;
  /** Draws `s` with the top of its line box at y. */
  draw(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, size: number, style?: TextStyle): void;
  /** False until the face's image / font file has loaded (draw is a no-op before that). */
  ready(): boolean;
  /** Pixel fonts want integer sizes and no smoothing. */
  readonly pixel?: boolean;
}

export type HAlign = "left" | "center" | "right";
export type VAlign = "top" | "middle" | "bottom";

export interface DrawTextOpts extends TextStyle {
  size: number;
  align?: HAlign;
}

/** Draws one line aligned on x; returns its width. */
export function drawText(
  ctx: CanvasRenderingContext2D,
  font: Font,
  s: string,
  x: number,
  y: number,
  o: DrawTextOpts,
): number {
  const w = font.measure(s, o.size);
  const dx = o.align === "center" ? -w / 2 : o.align === "right" ? -w : 0;
  font.draw(ctx, s, x + dx, y, o.size, o);
  return w;
}

export interface FitTextOpts extends TextStyle {
  size: number;
  /** Shrink no smaller than this before ellipsizing (default 70% of size). */
  minSize?: number;
  align?: HAlign;
  valign?: VAlign;
}

/** One line fitted into `r` (shrunk, then ellipsized). Returns the fit so callers can report / align on it. */
export function drawTextFit(ctx: CanvasRenderingContext2D, font: Font, s: string, r: Rect, o: FitTextOpts): LineFit {
  const measure = (t: string, z: number) => font.measure(t, z);
  const f = fitLine(measure, s, r.w, o.size, o.minSize ?? o.size * 0.7);
  const lh = font.lineHeight(f.size);
  const a = o.align ?? "left";
  const x = a === "center" ? r.x + (r.w - f.width) / 2 : a === "right" ? r.x + r.w - f.width : r.x;
  const v = o.valign ?? "middle";
  const y = v === "top" ? r.y : v === "bottom" ? r.y + r.h - lh : r.y + (r.h - lh) / 2;
  font.draw(ctx, f.text, x, y, f.size, o);
  return f;
}

export interface ParagraphOpts extends FitTextOpts {
  leading?: number;
  maxLines?: number;
}

/** A wrapped paragraph fitted into `r` (shrinks, then truncates). Returns the block for its height. */
export function drawParagraph(
  ctx: CanvasRenderingContext2D,
  font: Font,
  s: string,
  r: Rect,
  o: ParagraphOpts,
): BlockFit {
  const measure = (t: string, z: number) => font.measure(t, z);
  const leading = o.leading ?? 1.25;
  const b = fitBlock(measure, s, r.w, r.h, { size: o.size, minSize: o.minSize, leading, maxLines: o.maxLines });
  const v = o.valign ?? "top";
  let y = v === "top" ? r.y : v === "bottom" ? r.y + r.h - b.height : r.y + (r.h - b.height) / 2;
  const pad = (b.lineHeight - font.lineHeight(b.size)) / 2;
  for (const line of b.lines) {
    const w = font.measure(line, b.size);
    const x = o.align === "center" ? r.x + (r.w - w) / 2 : o.align === "right" ? r.x + r.w - w : r.x;
    font.draw(ctx, line, x, y + pad, b.size, o);
    y += b.lineHeight;
  }
  return b;
}

/** Measure function bound to a font (for text.ts helpers). */
export const measurer = (font: Font) => (s: string, size: number) => font.measure(s, size);
