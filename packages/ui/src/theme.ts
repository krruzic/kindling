// Themes and the per-frame UI context.
//
// A Theme bundles the fonts, colours, metrics and painters components use: panel styles are plugins (named
// PanelPainter functions; a game adds its own with withPanels), the selection cursor and the button glyph are
// overridable. Components never hard-code a look, so the same menu list renders as Grudge's parchment-on-wood or
// QUICKLORE's pixel frames. `Ui` is what every component receives: context, theme, time, and the optional debug
// recorder / hit list.
import type { LayoutDebug } from "./debug.ts";
import type { Font, TextStyle } from "./font/font.ts";
import type { Rect } from "./layout.ts";
import type { HitList } from "./nav.ts";

/** A button glyph the game passes in (from its input layer): the label to show, the device family to style it. */
export interface Glyph {
  label: string;
  /**
   * "keyboard", "mouse", "xbox", "playstation", "switch", "gamecube" (or @kindling/input's "gc"), "generic"...
   * unknown families draw generic.
   */
  family: string;
  color?: string;
  /** Symbol to draw instead of the label (PlayStation face buttons; @kindling/input glyphs carry it). */
  shape?: "cross" | "circle" | "square" | "triangle";
}

export interface PanelOpts {
  selected?: boolean;
  disabled?: boolean;
  /** Accent / team colour some styles use (borders, pins, seals). */
  tint?: string;
  /** Stable per-element number styles may use for variety (tilt, grain offset). */
  seed?: number;
}

export type PanelPainter = (ctx: CanvasRenderingContext2D, r: Rect, o: PanelOpts, theme: Theme) => void;

export type CursorDir = "left" | "right" | "up" | "down";

export interface ThemeColors {
  /** Text on the backdrop. */
  text: string;
  dim: string;
  accent: string;
  /** Text on panels (cards / rows). */
  panelText: string;
  panelDim: string;
  selected: string;
  disabled: string;
  ink: string;
  warn: string;
  good: string;
  /** Slider track / fill. */
  track: string;
  fill: string;
}

export interface ThemeMetrics {
  /** Body text size, small text, titles; text never shrinks below minText. */
  text: number;
  small: number;
  title: number;
  minText: number;
  rowH: number;
  pad: number;
  gap: number;
  /** Prompt glyph height. */
  glyph: number;
}

export interface Theme {
  name: string;
  /** Pixel styles: integer coordinates, no smoothing. */
  pixel?: boolean;
  font: Font;
  titleFont?: Font;
  colors: ThemeColors;
  metrics: ThemeMetrics;
  /** Style for text on the backdrop and on panels. */
  textStyle: TextStyle;
  panelTextStyle: TextStyle;
  /**
   * Panel painters by role: "backdrop", "window", "card", "row", "inset", "header", "dialog", "button", "banner",
   * "field", "key". Missing roles fall back to "window".
   */
  panels: Record<string, PanelPainter>;
  /** The selection cursor with its TIP at (x, y), pointing `dir` (at the thing selected). */
  cursor: (ctx: CanvasRenderingContext2D, x: number, y: number, dir: CursorDir, size: number, time: number) => void;
  /** Button glyph left-aligned at x, vertically centred on cy, `h` tall; returns its width. */
  glyph?: (ctx: CanvasRenderingContext2D, g: Glyph, x: number, cy: number, h: number, theme: Theme) => number;
  glyphWidth?: (g: Glyph, h: number, theme: Theme) => number;
  /** A painted title (art font, ribbon...) fitted in r. Falls back to titleFont text. */
  title?: (ctx: CanvasRenderingContext2D, text: string, r: Rect, theme: Theme) => void;
}

/** Per-frame UI context handed to every component. */
export interface Ui {
  ctx: CanvasRenderingContext2D;
  theme: Theme;
  /** Seconds (presentation clock) for blinking / animation. */
  time: number;
  debug?: LayoutDebug | null;
  hits?: HitList | null;
}

/** A theme with extra / replaced panel styles. */
export function withPanels(theme: Theme, panels: Record<string, PanelPainter>): Theme {
  return { ...theme, panels: { ...theme.panels, ...panels } };
}

/** Paints panel `role` over r (recorded for the layout debugger). */
export function panel(ui: Ui, role: string, r: Rect, o: PanelOpts = {}): void {
  const p = ui.theme.panels[role] ?? ui.theme.panels.window ?? plainPanel;
  p(ui.ctx, r, o, ui.theme);
}

/** Last-resort panel: a flat box. Themes should always provide real art. */
export const plainPanel: PanelPainter = (ctx, r, o, t) => {
  ctx.fillStyle = t.colors.ink;
  ctx.fillRect(r.x, r.y, r.w, r.h);
  ctx.strokeStyle = o.selected ? t.colors.selected : t.colors.dim;
  ctx.lineWidth = 1;
  ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
};
