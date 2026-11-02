// Example theme: QUICKLORE's pixel-art UI, nine-slice frames from a GUI sprite sheet (dialog boxes with clipped
// corners, bevelled windows, parchment cards), a pixel bitmap font and a play-arrow cursor, all on whole pixels at
// an integer scale. Designed for a pixel UiCanvas ({ kind: "pixel", width: 480, height: 270 }).
//
// Expected atlas entries (nine-slices unless noted): box, box.sel, frame, parch, row, row.sel, inset, button,
// button.sel, key, key.sel, track, field, banner, knob (sprite), arrow (sprite, pointing right).
import type { Font } from "../font/font.ts";
import type { Rect } from "../layout.ts";
import type { SpriteAtlas } from "../paint/nine.ts";
import type { PanelPainter, Theme } from "../theme.ts";

export interface PixelThemeOpts {
  font: Font;
  titleFont?: Font;
  atlas: SpriteAtlas;
}

export const PIXEL_COLORS = {
  text: "#f8f0d0",
  dim: "#8f9c98",
  accent: "#ffd84a",
  panelText: "#f8f0d0",
  panelDim: "#8f9c98",
  selected: "#ffd84a",
  disabled: "#56605c",
  ink: "#141b1b",
  warn: "#ff6a70",
  good: "#7ee07a",
  track: "#18202c",
  fill: "#7ee07a",
};

export function pixelTheme(o: PixelThemeOpts): Theme {
  const A = o.atlas;
  const nine =
    (name: string, alt?: string): PanelPainter =>
    (ctx, r, op) => {
      const n = op.selected && alt && A.has(alt) ? alt : name;
      const q = snapR(r);
      A.nine(ctx, n, q.x, q.y, q.w, q.h, { tile: true });
      if (op.tint && op.selected) {
        ctx.save();
        ctx.globalCompositeOperation = "multiply";
        ctx.fillStyle = op.tint;
        ctx.fillRect(q.x + 2, q.y + 2, q.w - 4, q.h - 4);
        ctx.restore();
      }
    };
  const card: PanelPainter = (ctx, r) => {
    const q = snapR(r);
    A.nine(ctx, "frame", q.x, q.y, q.w, q.h, { tile: true });
  };
  const backdrop: PanelPainter = (ctx, r) => {
    const q = snapR(r);
    ctx.fillStyle = "#0c1216";
    ctx.fillRect(q.x, q.y, q.w, q.h);
    // A checker of slightly lighter tiles, like QUICKLORE's menu floor.
    ctx.fillStyle = "#121b20";
    for (let y = q.y; y < q.y + q.h; y += 16)
      for (let x = q.x + (((y - q.y) / 16) % 2) * 16; x < q.x + q.w; x += 32) ctx.fillRect(x, y, 16, 16);
    ctx.fillStyle = "rgba(255,255,255,0.03)";
    for (let y = q.y; y < q.y + q.h; y += 2) ctx.fillRect(q.x, y, q.w, 1);
  };
  const header: PanelPainter = (ctx, r) => {
    const q = snapR(r);
    A.nine(ctx, "banner", q.x, q.y, q.w, q.h, { tile: true });
  };
  const knob: PanelPainter = (ctx, r) => {
    const s = A.size("knob");
    A.sprite(ctx, "knob", Math.round(r.x + (r.w - s.w) / 2), Math.round(r.y + (r.h - s.h) / 2));
  };
  const title = (ctx: CanvasRenderingContext2D, text: string, r: Rect, t: Theme) => {
    header(ctx, r, {}, t);
    const f = t.titleFont ?? t.font;
    let size = t.metrics.title;
    while (size > t.metrics.text && f.measure(text, size) > r.w - 16) size -= t.metrics.text / 2;
    const w = f.measure(text, size);
    f.draw(ctx, text, Math.round(r.x + (r.w - w) / 2), Math.round(r.y + (r.h - f.lineHeight(size)) / 2), size, {
      color: PIXEL_COLORS.accent,
      outline: PIXEL_COLORS.ink,
      shadow: null,
    });
  };
  return {
    name: "pixel",
    pixel: true,
    font: o.font,
    titleFont: o.titleFont,
    colors: { ...PIXEL_COLORS },
    metrics: { text: 8, small: 8, title: 16, minText: 8, rowH: 16, pad: 5, gap: 3, glyph: 11 },
    textStyle: { color: PIXEL_COLORS.text, outline: PIXEL_COLORS.ink, shadow: null },
    panelTextStyle: { color: PIXEL_COLORS.panelText, outline: null, shadow: "#0a0e0e" },
    panels: {
      backdrop,
      window: nine("box"),
      dialog: nine("frame"),
      card,
      row: nine("row", "row.sel"),
      inset: nine("inset"),
      header,
      beam: header,
      button: nine("button", "button.sel"),
      banner: nine("banner"),
      field: nine("field"),
      key: nine("key", "key.sel"),
      track: nine("track"),
      knob,
    },
    cursor: (ctx, x, y, dir, _size, time) => {
      const s = A.size("arrow");
      const bob = Math.floor(time * 4) % 2;
      ctx.save();
      ctx.translate(Math.round(x), Math.round(y));
      ctx.rotate(dir === "right" ? 0 : dir === "left" ? Math.PI : dir === "down" ? Math.PI / 2 : -Math.PI / 2);
      A.sprite(ctx, "arrow", -s.w - bob, -Math.floor(s.h / 2));
      ctx.restore();
    },
    title,
  };
}

function snapR(r: Rect): Rect {
  const x = Math.round(r.x);
  const y = Math.round(r.y);
  return { x, y, w: Math.round(r.x + r.w) - x, h: Math.round(r.y + r.h) - y };
}
