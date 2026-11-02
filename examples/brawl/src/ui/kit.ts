// BRAWL's UI kit on @kindling/ui: the wood theme (parchment cards on a workshop board, Grudge's look) with the
// Barlow atlas font for text and the same face as a CanvasFont for titles, plus the few layout pieces every screen
// shares: the title beam, the footer prompt bar, the dimmer over the 3D view and the player colour chips.
import {
  AtlasFont,
  CanvasFont,
  drawPromptBar,
  label,
  panel,
  type PromptItem,
  type Rect,
  type Theme,
  type Ui,
} from "@kindling/ui";
import { woodTheme } from "@kindling/ui/themes/wood";
import fontPng from "../../assets/ui/font.png?url";
import fontJson from "../../assets/ui/font.json?url";
import fontTtf from "../../assets/ui/fonts/BarlowSemiCondensed-Bold.ttf?url";

/** Logical UI height: everything is laid out in a 240-unit tall space (the wood theme's scale). */
export const UI_H = 240;

export async function loadTheme(): Promise<Theme> {
  const face = new FontFace("BrawlTitle", `url(${fontTtf})`);
  const [font] = await Promise.all([
    AtlasFont.load(fontPng, fontJson, { name: "barlow", ink: "rgba(0,0,0,0.55)" }),
    face.load().then((f) => document.fonts.add(f)),
  ]);
  const titleFont = new CanvasFont({ family: "BrawlTitle", lineHeight: 1.1, tracking: 0.03 });
  return woodTheme({ font, titleFont });
}

/** Darkens the 3D view behind a menu (stronger at the edges). */
export function dim(ui: Ui, w: number, h: number, k = 0.55): void {
  const c = ui.ctx;
  const g = c.createRadialGradient(w / 2, h * 0.45, h * 0.2, w / 2, h / 2, w * 0.65);
  g.addColorStop(0, `rgba(8,10,16,${k * 0.55})`);
  g.addColorStop(1, `rgba(8,10,16,${k})`);
  c.fillStyle = g;
  c.fillRect(0, 0, w, h);
}

/** The screen title on a beam, centred at the top. */
export function header(ui: Ui, w: number, text: string, y = 8): Rect {
  const tw = Math.min(w - 40, 200);
  const r = { x: (w - tw) / 2, y, w: tw, h: 26 };
  ui.theme.title?.(ui.ctx, text, r, ui.theme);
  ui.debug?.box("header", r, { bounds: { x: 0, y: 0, w, h: UI_H }, group: "chrome", ctx: ui.ctx });
  return r;
}

/** Footer prompts on a strip along the bottom edge. */
export function footer(ui: Ui, w: number, h: number, items: PromptItem[]): Rect {
  const r = { x: 10, y: h - 17, w: w - 20, h: 13 };
  const c = ui.ctx;
  const g = c.createLinearGradient(0, h - 26, 0, h);
  g.addColorStop(0, "rgba(0,0,0,0)");
  g.addColorStop(1, "rgba(0,0,0,0.6)");
  c.fillStyle = g;
  c.fillRect(0, h - 26, w, 26);
  drawPromptBar(ui, items, r);
  return r;
}

/** A round colour chip (player colour). */
export function chip(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string): void {
  ctx.fillStyle = "#0b0806";
  ctx.beginPath();
  ctx.arc(x, y, r + 0.9, 0, Math.PI * 2);
  ctx.fill();
  const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.35, r * 0.1, x, y, r);
  g.addColorStop(0, lighten(color, 0.45));
  g.addColorStop(1, lighten(color, -0.25));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

export function lighten(hex: string, k: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const v = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
  const f = (x: number) => Math.round(k >= 0 ? x + (255 - x) * k : x * (1 + k));
  return `rgb(${f(v[0])},${f(v[1])},${f(v[2])})`;
}

/** A small bar meter (rover stats, cooldowns) inside r: `k` of `n` pips lit. */
export function pips(ui: Ui, r: Rect, k: number, n: number, color: string): void {
  const c = ui.ctx;
  const gap = 1.2;
  const pw = (r.w - gap * (n - 1)) / n;
  for (let i = 0; i < n; i++) {
    c.fillStyle = "#0b0806";
    c.fillRect(r.x + i * (pw + gap) - 0.5, r.y - 0.5, pw + 1, r.h + 1);
    c.fillStyle = i < k ? color : "rgba(90,60,30,0.35)";
    c.fillRect(r.x + i * (pw + gap), r.y, pw, r.h);
  }
}

/** A labelled panel line ("eyebrow" text) helper: small dim text on a panel. */
export function small(
  ui: Ui,
  s: string,
  r: Rect,
  o: { align?: "left" | "center" | "right"; color?: string; id?: string } = {},
): void {
  label(ui, s, r, {
    onPanel: true,
    size: ui.theme.metrics.small,
    color: o.color ?? ui.theme.colors.panelDim,
    align: o.align,
    id: o.id,
  });
}

export { panel };
