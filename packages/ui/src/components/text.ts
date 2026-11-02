// Themed text helpers: draw with the theme's font and style, fitted into a rect (shrink, then ellipsis), and
// reported to the layout debugger. Components use these instead of calling Font.draw directly.
import { drawParagraph, drawTextFit, type FitTextOpts, type ParagraphOpts } from "../font/font.ts";
import type { Rect } from "../layout.ts";
import type { BlockFit, LineFit } from "../text.ts";
import type { Ui } from "../theme.ts";

export interface LabelOpts extends Partial<FitTextOpts> {
  /** Text sits on a panel (uses panelTextStyle / panelText colour). */
  onPanel?: boolean;
  title?: boolean;
  id?: string;
}

function style(ui: Ui, o: LabelOpts) {
  const t = ui.theme;
  const base = o.onPanel ? t.panelTextStyle : t.textStyle;
  return {
    ...base,
    color: o.color ?? base.color ?? (o.onPanel ? t.colors.panelText : t.colors.text),
    ...(o.outline !== undefined ? { outline: o.outline } : {}),
    ...(o.shadow !== undefined ? { shadow: o.shadow } : {}),
    ...(o.bevel !== undefined ? { bevel: o.bevel } : {}),
  };
}

/** One line of text fitted into r. */
export function label(ui: Ui, s: string, r: Rect, o: LabelOpts = {}): LineFit {
  const t = ui.theme;
  const font = o.title ? (t.titleFont ?? t.font) : t.font;
  const size = o.size ?? t.metrics.text;
  const f = drawTextFit(ui.ctx, font, s, r, {
    ...style(ui, o),
    size,
    minSize: o.minSize ?? Math.min(size, Math.max(t.metrics.minText, size * 0.7)),
    align: o.align,
    valign: o.valign,
  });
  if (ui.debug) {
    const lh = font.lineHeight(f.size);
    const x = o.align === "center" ? r.x + (r.w - f.width) / 2 : o.align === "right" ? r.x + r.w - f.width : r.x;
    ui.debug.content(o.id ?? `text:${s.slice(0, 18)}`, x, r.y + (r.h - lh) / 2, f.width, Math.min(lh, r.h), r, ui.ctx);
  }
  return f;
}

/** A wrapped paragraph fitted into r. */
export function paragraph(
  ui: Ui,
  s: string,
  r: Rect,
  o: LabelOpts & { leading?: number; maxLines?: number } = {},
): BlockFit {
  const t = ui.theme;
  const size = o.size ?? t.metrics.text;
  const po: ParagraphOpts = {
    ...style(ui, o),
    size,
    minSize: o.minSize ?? Math.min(size, t.metrics.minText),
    align: o.align,
    valign: o.valign,
    leading: o.leading,
    maxLines: o.maxLines,
  };
  const b = drawParagraph(ui.ctx, t.font, s, r, po);
  ui.debug?.content(o.id ?? `para:${s.slice(0, 18)}`, r.x, r.y, b.width, b.height, r, ui.ctx);
  return b;
}
