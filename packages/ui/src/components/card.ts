// Card: icon + eyebrow + title + body, with auto height (cards grow to their content; text never runs past the
// edge). cardLayout() measures and places everything without drawing, so grids of cards can be sized to the
// tallest before any are painted; drawCard() paints with the theme's "card" panel.
import { inset, type Rect } from "../layout.ts";
import { fitBlock, fitLine } from "../text.ts";
import { panel, type PanelOpts, type Ui } from "../theme.ts";
import { label, paragraph } from "./text.ts";

export interface CardContent {
  title: string;
  body?: string;
  /** Small line above the title ("RARE", "CHAPTER II"). */
  eyebrow?: string;
  /** Icon painter (real art per entry; never a stand-in) or an image. */
  icon?: CanvasImageSource | ((ctx: CanvasRenderingContext2D, r: Rect) => void);
  /** Footer line (cost, status). */
  footer?: string;
}

export interface CardOpts extends PanelOpts {
  /** Icon size (default ~ 2.6 rows of text). */
  iconSize?: number;
  /** Cap on height: the body shrinks / truncates to fit instead of growing past it. */
  maxH?: number;
  /** Minimum height (grids of equal cards). */
  minH?: number;
  role?: string;
}

export interface CardLayout {
  h: number;
  icon: Rect | null;
  eyebrow: Rect | null;
  title: Rect;
  body: Rect | null;
  footer: Rect | null;
  titleSize: number;
}

export function cardLayout(ui: Ui, x: number, y: number, w: number, c: CardContent, o: CardOpts = {}): CardLayout {
  const t = ui.theme;
  const m = t.metrics;
  const pad = m.pad * 1.5;
  const measure = (s: string, z: number) => t.font.measure(s, z);
  const tf = t.titleFont ?? t.font;
  const iconS = c.icon ? (o.iconSize ?? Math.min(w * 0.3, m.text * 3.4)) : 0;
  const hx = x + pad + (iconS ? iconS + m.gap * 1.5 : 0);
  const hw = x + w - pad - hx;
  let cy = y + pad;
  const eyebrow = c.eyebrow ? { x: hx, y: cy, w: hw, h: t.font.lineHeight(m.small) } : null;
  if (eyebrow) cy += eyebrow.h;
  const tsize = fitLine((s, z) => tf.measure(s, z), c.title, hw, t.pixel ? m.text : m.text * 1.25, m.minText).size;
  const title = { x: hx, y: cy, w: hw, h: tf.lineHeight(tsize) };
  cy += title.h;
  const icon = iconS ? { x: x + pad, y: y + pad, w: iconS, h: iconS } : null;
  let top = Math.max(cy, icon ? icon.y + icon.h : 0) + m.gap;
  const footerH = c.footer ? t.font.lineHeight(m.small) + m.gap : 0;
  let body: Rect | null = null;
  if (c.body) {
    const avail = o.maxH !== undefined ? Math.max(0, y + o.maxH - pad - footerH - top) : Infinity;
    const b = fitBlock(measure, c.body, w - pad * 2, avail, { size: m.small, minSize: m.minText, leading: 1.25 });
    body = { x: x + pad, y: top, w: w - pad * 2, h: Math.min(avail, b.height) };
    top += body.h;
  } else top -= m.gap;
  let h = top + footerH + pad - y;
  if (o.minH) h = Math.max(h, o.minH);
  if (o.maxH !== undefined) h = Math.min(h, o.maxH);
  // The footer sits on the bottom edge (cards stretched to equal heights keep their footers aligned).
  const footer = c.footer ? { x: x + pad, y: y + h - pad - footerH + m.gap, w: w - pad * 2, h: footerH - m.gap } : null;
  return { h, icon, eyebrow, title, body, footer, titleSize: tsize };
}

/** Height a card of width w needs for its content. */
export function cardHeight(ui: Ui, w: number, c: CardContent, o: CardOpts = {}): number {
  return cardLayout(ui, 0, 0, w, c, o).h;
}

/** Draws a card at (x, y), w wide; returns its height. */
export function drawCard(ui: Ui, x: number, y: number, w: number, c: CardContent, o: CardOpts = {}): number {
  const t = ui.theme;
  const L = cardLayout(ui, x, y, w, c, o);
  const r = { x, y, w, h: L.h };
  panel(ui, o.role ?? "card", r, o);
  ui.debug?.box(`card:${c.title}`, r, { group: "cards", ctx: ui.ctx });
  if (L.icon && c.icon) {
    panel(ui, "inset", L.icon, {});
    const ir = inset(L.icon, 1.5);
    if (typeof c.icon === "function") c.icon(ui.ctx, ir);
    else ui.ctx.drawImage(c.icon, ir.x, ir.y, ir.w, ir.h);
  }
  if (L.eyebrow && c.eyebrow)
    label(ui, c.eyebrow, L.eyebrow, { onPanel: true, size: t.metrics.small, color: t.colors.panelDim });
  label(ui, c.title, L.title, { onPanel: true, title: true, size: L.titleSize, id: `card.title:${c.title}` });
  if (L.body && c.body)
    paragraph(ui, c.body, L.body, {
      onPanel: true,
      size: t.metrics.small,
      color: t.colors.panelText,
      id: `card.body:${c.title}`,
    });
  if (L.footer && c.footer) {
    ui.ctx.fillStyle = t.colors.panelDim;
    ui.ctx.globalAlpha = 0.35;
    ui.ctx.fillRect(L.footer.x, L.footer.y - t.metrics.gap / 2, L.footer.w, 0.75);
    ui.ctx.globalAlpha = 1;
    label(ui, c.footer, L.footer, { onPanel: true, size: t.metrics.small, color: t.colors.selected, align: "right" });
  }
  return L.h;
}
