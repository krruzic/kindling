// Prompt footers: rows of [button glyph, label] ("(A) SELECT  (B) BACK"). The game passes Glyphs from its input
// layer (label + device family + colour), so the footer shows keyboard keys, Xbox / PlayStation / Switch /
// GameCube buttons as the player's device has them, while menus keep the GAME's action names in the labels.
// The theme can replace the glyph painter; the default draws keycaps for keyboards, discs for short pad labels and
// pills for long ones ("START", "LB").
import type { Rect } from "../layout.ts";
import type { Glyph, Theme, Ui } from "../theme.ts";

export interface PromptItem {
  glyph: Glyph;
  label: string;
}

const GAMECUBE = { A: "#2fa864", B: "#d43a32", X: "#9a9aa8", Y: "#9a9aa8", Z: "#6a4ac8", START: "#8a8a98" };
const FAMILY_COLORS: Record<string, Record<string, string>> = {
  xbox: { A: "#3f9b36", B: "#c8352b", X: "#2f63d6", Y: "#d8a91b" },
  gamecube: GAMECUBE,
  gc: GAMECUBE,
  switch: {},
};

/** The colour a glyph is drawn in: its own, else its family's convention, else neutral. */
export function glyphColor(g: Glyph): string {
  return (
    g.color ??
    FAMILY_COLORS[g.family]?.[g.label] ??
    (g.family === "keyboard" || g.family === "mouse" ? "#e8e4dc" : "#4a4a56")
  );
}

function isKey(g: Glyph): boolean {
  return g.family === "keyboard" || g.family === "mouse";
}

/** PlayStation face buttons are drawn as their symbols (fonts rarely have them). */
const PS_SYMBOLS: Record<string, "cross" | "circle" | "square" | "triangle"> = {
  "×": "cross",
  X: "cross",
  CROSS: "cross",
  "○": "circle",
  O: "circle",
  CIRCLE: "circle",
  "□": "square",
  SQUARE: "square",
  "△": "triangle",
  TRIANGLE: "triangle",
};
const PS_COLORS = { cross: "#7aa8f0", circle: "#f07078", square: "#e08ad8", triangle: "#50d0b0" };

function psSymbol(g: Glyph): "cross" | "circle" | "square" | "triangle" | null {
  if (g.shape) return g.shape;
  return g.family === "playstation" ? (PS_SYMBOLS[g.label.toUpperCase()] ?? PS_SYMBOLS[g.label] ?? null) : null;
}

export function defaultGlyphWidth(g: Glyph, h: number, t: Theme): number {
  if (psSymbol(g)) return h;
  const ts = h * 0.62;
  const tw = t.font.measure(g.label, ts);
  if (isKey(g)) return Math.max(h, tw + h * 0.6);
  return g.label.length <= 2 ? h : tw + h * 0.8;
}

/** Default glyph painter (keycap / disc / pill), left edge at x, centred on cy. */
export function defaultGlyph(
  ctx: CanvasRenderingContext2D,
  g: Glyph,
  x: number,
  cy: number,
  h: number,
  t: Theme,
): number {
  const w = defaultGlyphWidth(g, h, t);
  const ts = h * 0.62;
  const y = cy - h / 2;
  const col = glyphColor(g);
  const ink = t.colors.ink;
  ctx.save();
  const sym = psSymbol(g);
  if (sym) {
    const cx = x + h / 2;
    const r = h / 2;
    ctx.fillStyle = ink;
    ctx.beginPath();
    ctx.arc(cx, cy, r + 0.7, 0, Math.PI * 2);
    ctx.fill();
    const bg = ctx.createLinearGradient(0, y, 0, y + h);
    bg.addColorStop(0, "#4a4a58");
    bg.addColorStop(1, "#22222a");
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = g.color ?? PS_COLORS[sym];
    ctx.lineWidth = h * 0.11;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const k = r * 0.42;
    ctx.beginPath();
    if (sym === "cross") {
      ctx.moveTo(cx - k, cy - k);
      ctx.lineTo(cx + k, cy + k);
      ctx.moveTo(cx + k, cy - k);
      ctx.lineTo(cx - k, cy + k);
    } else if (sym === "circle") ctx.arc(cx, cy, k * 1.05, 0, Math.PI * 2);
    else if (sym === "square") ctx.rect(cx - k * 0.9, cy - k * 0.9, k * 1.8, k * 1.8);
    else {
      ctx.moveTo(cx, cy - k * 1.1);
      ctx.lineTo(cx + k * 1.05, cy + k * 0.75);
      ctx.lineTo(cx - k * 1.05, cy + k * 0.75);
      ctx.closePath();
    }
    ctx.stroke();
    ctx.restore();
    return h;
  }
  if (isKey(g)) {
    const r = h * 0.22;
    ctx.fillStyle = ink;
    ctx.beginPath();
    ctx.roundRect(x - 0.6, y - 0.6, w + 1.2, h + 1.2, r + 0.6);
    ctx.fill();
    ctx.fillStyle = shadeHex(col, -0.35);
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    ctx.fill();
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.roundRect(x + h * 0.08, y + h * 0.06, w - h * 0.16, h * 0.76, r * 0.8);
    ctx.fill();
    ctx.restore();
    t.font.draw(ctx, g.label, x + (w - t.font.measure(g.label, ts)) / 2, y + h * 0.44 - t.font.lineHeight(ts) / 2, ts, {
      color: "#2a2620",
      outline: null,
      shadow: null,
      bevel: false,
    });
    return w;
  }
  const r = h / 2;
  ctx.fillStyle = ink;
  ctx.beginPath();
  ctx.roundRect(x - 0.7, y - 0.7, w + 1.4, h + 1.4, r + 0.7);
  ctx.fill();
  const grad = ctx.createLinearGradient(0, y, 0, y + h);
  grad.addColorStop(0, shadeHex(col, 0.25));
  grad.addColorStop(1, shadeHex(col, -0.25));
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.28)";
  ctx.beginPath();
  ctx.roundRect(x + h * 0.22, y + h * 0.1, w - h * 0.44, h * 0.26, h * 0.13);
  ctx.fill();
  ctx.restore();
  t.font.draw(ctx, g.label, x + (w - t.font.measure(g.label, ts)) / 2, cy - t.font.lineHeight(ts) / 2, ts, {
    color: "#ffffff",
    outline: "rgba(0,0,0,0.55)",
    shadow: null,
    bevel: false,
  });
  return w;
}

function shadeHex(c: string, k: number): string {
  const m = c.match(/^#([0-9a-f]{6})$/i);
  if (!m) return c;
  const v = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
  const f = (x: number) => Math.round(k >= 0 ? x + (255 - x) * k : x * (1 + k));
  return `rgb(${f(v[0])},${f(v[1])},${f(v[2])})`;
}

export function glyphWidth(t: Theme, g: Glyph, h: number): number {
  return (t.glyphWidth ?? defaultGlyphWidth)(g, h, t);
}

export function drawGlyph(ui: Ui, g: Glyph, x: number, cy: number, h: number): number {
  return (ui.theme.glyph ?? defaultGlyph)(ui.ctx, g, x, cy, h, ui.theme);
}

export interface PromptOpts {
  size?: number;
  glyphH?: number;
  /** Space between items. */
  gap?: number;
  onPanel?: boolean;
}

function dims(t: Theme, o: PromptOpts) {
  const size = o.size ?? t.metrics.small;
  const gh = o.glyphH ?? t.metrics.glyph;
  return { size, gh, gap: o.gap ?? gh * 0.9, inner: gh * 0.3 };
}

/** Width of a prompt row. */
export function promptWidth(t: Theme, items: PromptItem[], o: PromptOpts = {}): number {
  const d = dims(t, o);
  return items.reduce(
    (a, it, i) => a + glyphWidth(t, it.glyph, d.gh) + d.inner + t.font.measure(it.label, d.size) + (i ? d.gap : 0),
    0,
  );
}

/** Draws a prompt row starting at x, vertically centred on cy; returns its width. */
export function drawPrompts(ui: Ui, items: PromptItem[], x: number, cy: number, o: PromptOpts = {}): number {
  const t = ui.theme;
  const d = dims(t, o);
  let cx = x;
  items.forEach((it, i) => {
    if (i) cx += d.gap;
    cx += drawGlyph(ui, it.glyph, cx, cy, d.gh) + d.inner;
    const st = o.onPanel ? t.panelTextStyle : t.textStyle;
    t.font.draw(ui.ctx, it.label, cx, cy - t.font.lineHeight(d.size) / 2, d.size, st);
    cx += t.font.measure(it.label, d.size);
  });
  return cx - x;
}

/**
 * A footer: the prompt row centred (or aligned) in `r`, shrunk to fit its width if needed; recorded as one
 * element so the debugger catches a footer covered by a panel or running off screen.
 */
export function drawPromptBar(
  ui: Ui,
  items: PromptItem[],
  r: Rect,
  o: PromptOpts & { align?: "left" | "center" | "right" } = {},
): void {
  const t = ui.theme;
  let d = { ...o };
  let w = promptWidth(t, items, d);
  if (w > r.w) {
    const k = r.w / w;
    const base = dims(t, o);
    d = { ...o, size: base.size * k, glyphH: base.gh * k, gap: base.gap * k };
    w = promptWidth(t, items, d);
  }
  const x = o.align === "left" ? r.x : o.align === "right" ? r.x + r.w - w : r.x + (r.w - w) / 2;
  drawPrompts(ui, items, x, r.y + r.h / 2, d);
  ui.debug?.box("prompts", { x, y: r.y, w, h: r.h }, { bounds: r, group: "chrome", ctx: ui.ctx });
}
