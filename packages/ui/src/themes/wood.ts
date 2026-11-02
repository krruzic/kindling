// Example theme: Grudge's hand-painted look, parchment cards pinned on a dark wooden board, wooden beams with
// iron nails, wax seals, cloth ribbons and a gold arrow cursor. Every painter bakes into the plate cache, so a
// full menu costs a handful of drawImage calls. Textures default to the procedural ones (procedural.ts); pass a
// game's own images to reskin. Designed for a 240-unit tall UI ({ kind: "height", height: 240 }).
import type { Font, TextStyle } from "../font/font.ts";
import type { Rect } from "../layout.ts";
import { PlateCache } from "../paint/plates.ts";
import type { CursorDir, PanelPainter, Theme } from "../theme.ts";
import { clothTexture, parchmentTexture, woodTexture } from "./procedural.ts";

export interface WoodThemeOpts {
  font: Font;
  titleFont?: Font;
  textures?: { wood?: CanvasImageSource; parchment?: CanvasImageSource; cloth?: CanvasImageSource };
}

export const WOOD_COLORS = {
  text: "#f4e6c4",
  dim: "#c0a880",
  accent: "#e8b84a",
  panelText: "#3a2410",
  panelDim: "#7a5636",
  selected: "#8a1810",
  disabled: "#9a8466",
  ink: "#0b0806",
  warn: "#b02018",
  good: "#3d8a3a",
  track: "#2a1a0a",
  fill: "#d4a038",
};

const INK = WOOD_COLORS.ink;

/** A wax seal blob (centre cx, cy). */
export function waxSeal(g: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string): void {
  const blob = (rr: number) => {
    g.beginPath();
    for (let k = 0; k <= 36; k++) {
      const a = (k / 36) * Math.PI * 2;
      const q = rr * (1 + 0.09 * Math.sin(a * 7) + 0.05 * Math.sin(a * 3 + 1));
      if (k === 0) g.moveTo(cx + Math.cos(a) * q, cy + Math.sin(a) * q);
      else g.lineTo(cx + Math.cos(a) * q, cy + Math.sin(a) * q);
    }
    g.closePath();
  };
  g.fillStyle = INK;
  blob(r + 1.2);
  g.fill();
  const grad = g.createRadialGradient(cx - r * 0.3, cy - r * 0.35, r * 0.1, cx, cy, r * 1.1);
  grad.addColorStop(0, lift(color, 0.35));
  grad.addColorStop(1, lift(color, -0.35));
  g.fillStyle = grad;
  blob(r);
  g.fill();
  g.strokeStyle = "rgba(0,0,0,0.35)";
  g.lineWidth = r * 0.12;
  g.beginPath();
  g.arc(cx, cy, r * 0.62, 0, Math.PI * 2);
  g.stroke();
  g.strokeStyle = "rgba(255,210,190,0.35)";
  g.lineWidth = r * 0.07;
  g.beginPath();
  g.arc(cx, cy + r * 0.06, r * 0.62, Math.PI * 0.15, Math.PI * 0.85);
  g.stroke();
}

/** A brass pin head. */
export function pin(g: CanvasRenderingContext2D, x: number, y: number, color: string): void {
  g.fillStyle = "rgba(0,0,0,0.35)";
  g.beginPath();
  g.arc(x + 1, y + 1.4, 3.2, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = INK;
  g.beginPath();
  g.arc(x, y, 3.4, 0, Math.PI * 2);
  g.fill();
  const grad = g.createRadialGradient(x - 1, y - 1, 0.3, x, y, 3);
  grad.addColorStop(0, lift(color, 0.5));
  grad.addColorStop(1, lift(color, -0.3));
  g.fillStyle = grad;
  g.beginPath();
  g.arc(x, y, 2.6, 0, Math.PI * 2);
  g.fill();
}

function lift(c: string, k: number): string {
  const m = c.match(/^#([0-9a-f]{6})$/i);
  if (!m) return c;
  const v = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
  const f = (x: number) => Math.round(k >= 0 ? x + (255 - x) * k : x * (1 + k));
  return `rgb(${f(v[0])},${f(v[1])},${f(v[2])})`;
}

/** The gold arrow, tip at (x, y) pointing `dir`. */
export function goldArrow(g: CanvasRenderingContext2D, x: number, y: number, dir: CursorDir, s: number, bob = 0): void {
  g.save();
  g.translate(x, y);
  g.rotate(dir === "right" ? 0 : dir === "left" ? Math.PI : dir === "down" ? Math.PI / 2 : -Math.PI / 2);
  g.translate(-bob, 0);
  const tri = (d: number) => {
    g.beginPath();
    g.moveTo(d * 0.6, 0);
    g.lineTo(-s * 1.15 - d, -s - d);
    g.lineTo(-s * 0.8 - d, 0);
    g.lineTo(-s * 1.15 - d, s + d);
    g.closePath();
  };
  g.fillStyle = "rgba(0,0,0,0.45)";
  g.save();
  g.translate(0.8, 1.2);
  tri(1.2);
  g.fill();
  g.restore();
  g.fillStyle = INK;
  tri(1.3);
  g.fill();
  const grad = g.createLinearGradient(0, -s, 0, s);
  grad.addColorStop(0, "#fff0b0");
  grad.addColorStop(0.45, "#e8b84a");
  grad.addColorStop(1, "#8a5a18");
  g.fillStyle = grad;
  tri(0);
  g.fill();
  g.fillStyle = "rgba(255,255,240,0.55)";
  g.beginPath();
  g.moveTo(-s * 0.15, -s * 0.12);
  g.lineTo(-s * 1.0, -s * 0.82);
  g.lineTo(-s * 0.82, -s * 0.12);
  g.closePath();
  g.fill();
  g.restore();
}

export function woodTheme(o: WoodThemeOpts): Theme {
  const plates = new PlateCache(400);
  let wood: CanvasImageSource | null = o.textures?.wood ?? null;
  let parch: CanvasImageSource | null = o.textures?.parchment ?? null;
  let cloth: CanvasImageSource | null = o.textures?.cloth ?? null;
  const tex = () => {
    wood ??= woodTexture();
    parch ??= parchmentTexture();
    cloth ??= clothTexture([150, 30, 24]);
  };
  const fillTex = (
    g: CanvasRenderingContext2D,
    im: CanvasImageSource,
    x: number,
    y: number,
    w: number,
    h: number,
    scale = 0.5,
    ox = 0,
    oy = 0,
  ) => {
    const p = g.createPattern(im, "repeat")!;
    p.setTransform(new DOMMatrix().translate(ox, oy).scale(scale));
    g.fillStyle = p;
    g.fillRect(x, y, w, h);
  };

  /** Parchment sheet with ink border, edge burn and inner rule. */
  const parchment = (g: CanvasRenderingContext2D, w: number, h: number, seed: number, tone = 0, rule = true) => {
    tex();
    g.fillStyle = "rgba(0,0,0,0.42)";
    g.fillRect(2.5, 3.5, w, h);
    g.fillStyle = INK;
    g.fillRect(-1, -1, w + 2, h + 2);
    fillTex(g, parch!, 0, 0, w, h, 0.45, seed * 37, seed * 53);
    if (tone) {
      g.fillStyle = tone > 0 ? `rgba(255,248,225,${tone})` : `rgba(120,80,40,${-tone})`;
      g.fillRect(0, 0, w, h);
    }
    const e = Math.min(w, h) * 0.5;
    for (const [x0, y0, x1, y1] of [
      [0, 0, Math.min(e, 10), 0],
      [w, 0, w - Math.min(e, 10), 0],
      [0, 0, 0, Math.min(e, 10)],
      [0, h, 0, h - Math.min(e, 10)],
    ]) {
      const gr = g.createLinearGradient(x0, y0, x1, y1);
      gr.addColorStop(0, "rgba(110,60,20,0.38)");
      gr.addColorStop(1, "rgba(110,60,20,0)");
      g.fillStyle = gr;
      g.fillRect(0, 0, w, h);
    }
    if (rule && w > 16 && h > 16) {
      g.strokeStyle = "rgba(110,70,30,0.42)";
      g.lineWidth = 1;
      g.strokeRect(2.5, 2.5, w - 5, h - 5);
    }
  };

  const plank = (
    g: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    tint: string,
    scale = 0.6,
    ox = 0,
  ) => {
    tex();
    fillTex(g, wood!, x, y, w, h, scale, ox, y);
    g.globalCompositeOperation = "multiply";
    g.fillStyle = tint;
    g.fillRect(x, y, w, h);
    g.globalCompositeOperation = "source-over";
  };

  const backdrop: PanelPainter = (ctx, r) =>
    plates.draw(ctx, "backdrop", r.x, r.y, r.w, r.h, (g, w, h) => {
      const ph = 26;
      for (let y = 0, k = 0; y < h; y += ph, k++) plank(g, 0, y, w, ph, "#7a6050", 0.9, k * 71);
      for (let y = ph, k = 0; y < h; y += ph, k++) {
        g.fillStyle = "rgba(0,0,0,0.55)";
        g.fillRect(0, y - 0.5, w, 1.2);
        g.fillStyle = "rgba(255,220,170,0.08)";
        g.fillRect(0, y + 0.7, w, 0.8);
        // Butt joints staggered per plank.
        const jx = ((k * 157) % Math.max(1, Math.round(w * 0.6))) + w * 0.2;
        g.fillStyle = "rgba(0,0,0,0.5)";
        g.fillRect(jx, y, 1, ph);
      }
      const v = g.createRadialGradient(w / 2, h * 0.45, h * 0.15, w / 2, h * 0.5, Math.max(w, h) * 0.72);
      v.addColorStop(0, "rgba(30,14,4,0.15)");
      v.addColorStop(1, "rgba(8,4,2,0.82)");
      g.fillStyle = v;
      g.fillRect(0, 0, w, h);
    });

  const card: PanelPainter = (ctx, r, op) => {
    plates.draw(ctx, `card|${op.seed ?? 0}`, r.x, r.y, r.w, r.h, (g, w, h) => parchment(g, w, h, op.seed ?? 0), 4);
    if (op.tint) pin(ctx, r.x + r.w / 2, r.y + 3.5, op.tint);
  };

  const windowP: PanelPainter = (ctx, r, op) =>
    plates.draw(
      ctx,
      `window|${op.seed ?? 0}`,
      r.x,
      r.y,
      r.w,
      r.h,
      (g, w, h) => {
        parchment(g, w, h, (op.seed ?? 0) + 5);
        g.strokeStyle = "rgba(110,70,30,0.3)";
        g.strokeRect(5, 5, w - 10, h - 10);
      },
      4,
    );

  const row: PanelPainter = (ctx, r, op) => {
    plates.draw(
      ctx,
      `row|${op.selected ? 1 : 0}|${op.disabled ? 1 : 0}|${(op.seed ?? 0) % 4}`,
      r.x,
      r.y,
      r.w,
      r.h,
      (g, w, h) => {
        parchment(g, w, h, op.seed ?? 0, op.selected ? 0.22 : op.disabled ? -0.25 : -0.06, false);
        if (op.selected) {
          g.fillStyle = "rgba(168,48,28,0.16)";
          g.fillRect(0, 0, w, h);
          // A red cloth tab on the left edge marks the choice.
          g.fillStyle = INK;
          g.fillRect(-1, -1, 4.5, h + 2);
          g.fillStyle = "#a8241a";
          g.fillRect(0, 0, 3, h);
          g.fillStyle = "rgba(255,200,180,0.35)";
          g.fillRect(0, 0, 3, 0.8);
        }
      },
      4,
    );
  };

  const inset: PanelPainter = (ctx, r) => {
    ctx.fillStyle = "#2a1a0a";
    ctx.fillRect(r.x - 1, r.y - 1, r.w + 2, r.h + 2);
    ctx.fillStyle = "#3a2614";
    ctx.fillRect(r.x, r.y, r.w, r.h);
    const g = ctx.createLinearGradient(0, r.y, 0, r.y + r.h);
    g.addColorStop(0, "rgba(0,0,0,0.45)");
    g.addColorStop(0.35, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(r.x, r.y, r.w, r.h);
  };

  const beam: PanelPainter = (ctx, r) =>
    plates.draw(
      ctx,
      "beam",
      r.x,
      r.y,
      r.w,
      r.h,
      (g, w, h) => {
        g.fillStyle = "rgba(0,0,0,0.45)";
        g.fillRect(2, h, w - 4, 3);
        g.fillStyle = INK;
        g.fillRect(-1.5, -1.5, w + 3, h + 3);
        plank(g, 0, 0, w, h, "#c89868", 0.7);
        g.fillStyle = "rgba(240,208,160,0.35)";
        g.fillRect(0, 0, w, 1);
        g.fillStyle = "rgba(0,0,0,0.3)";
        g.fillRect(0, h - 1.5, w, 1.5);
        for (const nx of [6, w - 6]) {
          g.fillStyle = INK;
          g.beginPath();
          g.arc(nx, h / 2, 2.4, 0, Math.PI * 2);
          g.fill();
          g.fillStyle = "#8a8a90";
          g.beginPath();
          g.arc(nx, h / 2, 1.6, 0, Math.PI * 2);
          g.fill();
          g.fillStyle = "rgba(255,255,255,0.6)";
          g.fillRect(nx - 0.9, h / 2 - 0.9, 0.7, 0.7);
        }
      },
      3,
    );

  const button: PanelPainter = (ctx, r, op) =>
    plates.draw(
      ctx,
      `button|${op.selected ? 1 : 0}|${op.tint ?? ""}`,
      r.x,
      r.y,
      r.w,
      r.h,
      (g, w, h) => {
        g.fillStyle = "rgba(0,0,0,0.4)";
        g.fillRect(1.5, 2, w, h);
        g.fillStyle = INK;
        g.beginPath();
        g.roundRect(-1, -1, w + 2, h + 2, 2.5);
        g.fill();
        g.save();
        g.beginPath();
        g.roundRect(0, 0, w, h, 2);
        g.clip();
        plank(g, 0, 0, w, h, op.selected ? "#e0b088" : "#8a6448", 0.55);
        if (op.tint) {
          g.globalCompositeOperation = "multiply";
          g.fillStyle = op.tint;
          g.fillRect(0, 0, w, h);
          g.globalCompositeOperation = "source-over";
        }
        const sh = g.createLinearGradient(0, 0, 0, h);
        sh.addColorStop(0, "rgba(255,230,190,0.35)");
        sh.addColorStop(0.5, "rgba(255,230,190,0)");
        sh.addColorStop(1, "rgba(0,0,0,0.35)");
        g.fillStyle = sh;
        g.fillRect(0, 0, w, h);
        g.restore();
        if (op.selected) {
          g.strokeStyle = "#f0c860";
          g.lineWidth = 1;
          g.beginPath();
          g.roundRect(0.5, 0.5, w - 1, h - 1, 2);
          g.stroke();
        }
      },
      3,
    );

  const banner: PanelPainter = (ctx, r, op) =>
    plates.draw(
      ctx,
      `banner|${op.tint ?? ""}`,
      r.x,
      r.y,
      r.w,
      r.h,
      (g, w, h) => {
        tex();
        const tail = Math.min(12, h * 0.8);
        for (const side of [-1, 1]) {
          const ex = side < 0 ? -tail : w + tail;
          const ix = side < 0 ? 4 : w - 4;
          const path = (d: number) => {
            g.beginPath();
            g.moveTo(ix, 3 - d);
            g.lineTo(ex - side * d, 3 - d);
            g.lineTo(ex - side * (tail * 0.4 - d), 3 + (h - 3) / 2);
            g.lineTo(ex - side * d, h + 3 + d);
            g.lineTo(ix, h + 3 + d);
            g.closePath();
          };
          g.fillStyle = INK;
          path(1);
          g.fill();
          g.save();
          path(0);
          g.clip();
          fillTex(g, cloth!, ex - tail, 0, tail * 2 + 8, h + 8, 0.5);
          g.fillStyle = "rgba(0,0,0,0.45)";
          g.fillRect(ex - tail, 0, tail * 2 + 8, h + 8);
          g.restore();
        }
        g.fillStyle = INK;
        g.fillRect(-1, -1, w + 2, h + 2);
        fillTex(g, cloth!, 0, 0, w, h, 0.5);
        if (op.tint) {
          g.globalCompositeOperation = "multiply";
          g.fillStyle = op.tint;
          g.fillRect(0, 0, w, h);
          g.globalCompositeOperation = "source-over";
        }
        const sh = g.createLinearGradient(0, 0, 0, h);
        sh.addColorStop(0, "rgba(255,220,200,0.28)");
        sh.addColorStop(0.5, "rgba(0,0,0,0)");
        sh.addColorStop(1, "rgba(0,0,0,0.35)");
        g.fillStyle = sh;
        g.fillRect(0, 0, w, h);
        g.strokeStyle = "rgba(240,200,96,0.7)";
        g.setLineDash([2, 1.5]);
        g.lineWidth = 0.7;
        g.strokeRect(1.8, 1.8, w - 3.6, h - 3.6);
        g.setLineDash([]);
      },
      14,
    );

  const dialog: PanelPainter = (ctx, r, op, t) => {
    windowP(ctx, r, { seed: 9 }, t);
    waxSeal(ctx, r.x + r.w - 12, r.y + r.h - 12, 8, op.tint ?? "#a8141a");
  };

  const field: PanelPainter = (ctx, r) =>
    plates.draw(
      ctx,
      "field",
      r.x,
      r.y,
      r.w,
      r.h,
      (g, w, h) => {
        g.fillStyle = INK;
        g.fillRect(-1, -1, w + 2, h + 2);
        tex();
        fillTex(g, parch!, 0, 0, w, h, 0.4, 13, 7);
        g.fillStyle = "rgba(255,250,235,0.3)";
        g.fillRect(0, 0, w, h);
        const sh = g.createLinearGradient(0, 0, 0, h);
        sh.addColorStop(0, "rgba(60,30,10,0.3)");
        sh.addColorStop(0.3, "rgba(60,30,10,0)");
        g.fillStyle = sh;
        g.fillRect(0, 0, w, h);
      },
      1,
    );

  const key: PanelPainter = (ctx, r, op) =>
    plates.draw(
      ctx,
      `key|${op.selected ? 1 : 0}`,
      r.x,
      r.y,
      r.w,
      r.h,
      (g, w, h) => {
        g.fillStyle = "rgba(0,0,0,0.3)";
        g.fillRect(1, 1.5, w, h);
        g.fillStyle = op.selected ? "#8a1810" : "rgba(80,50,20,0.55)";
        g.beginPath();
        g.roundRect(-0.6, -0.6, w + 1.2, h + 1.2, 2);
        g.fill();
        tex();
        g.save();
        g.beginPath();
        g.roundRect(0, 0, w, h, 1.6);
        g.clip();
        fillTex(g, parch!, 0, 0, w, h, 0.35, w * 3, h * 7);
        g.fillStyle = op.selected ? "rgba(255,250,230,0.45)" : "rgba(120,80,40,0.08)";
        g.fillRect(0, 0, w, h);
        g.fillStyle = "rgba(90,50,20,0.25)";
        g.fillRect(0, h - 1.2, w, 1.2);
        g.restore();
      },
      2,
    );

  const track: PanelPainter = (ctx, r) => {
    ctx.fillStyle = INK;
    ctx.beginPath();
    ctx.roundRect(r.x - 0.8, r.y - 0.8, r.w + 1.6, r.h + 1.6, (r.h + 1.6) / 2);
    ctx.fill();
    ctx.fillStyle = "#3a2614";
    ctx.beginPath();
    ctx.roundRect(r.x, r.y, r.w, r.h, r.h / 2);
    ctx.fill();
  };

  const knob: PanelPainter = (ctx, r, op) => {
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    const rr = Math.min(r.w, r.h) / 2;
    ctx.fillStyle = INK;
    ctx.beginPath();
    ctx.arc(cx, cy, rr + 0.9, 0, Math.PI * 2);
    ctx.fill();
    const g = ctx.createRadialGradient(cx - rr * 0.35, cy - rr * 0.4, rr * 0.1, cx, cy, rr);
    g.addColorStop(0, op.selected ? "#fff2b8" : "#e8d090");
    g.addColorStop(1, op.selected ? "#b07a20" : "#806030");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, rr, 0, Math.PI * 2);
    ctx.fill();
  };

  const textStyle: TextStyle = { color: WOOD_COLORS.text, outline: INK, shadow: "rgba(0,0,0,0.55)" };
  const panelTextStyle: TextStyle = {
    color: WOOD_COLORS.panelText,
    outline: null,
    shadow: "rgba(90,50,20,0.22)",
    bevel: false,
  };

  const title = (ctx: CanvasRenderingContext2D, text: string, r: Rect, t: Theme) => {
    beam(ctx, r, {}, t);
    const f = t.titleFont ?? t.font;
    const size = Math.min(r.h * 0.95, f.measure(text, 10) > 0 ? (10 * (r.w - 24)) / f.measure(text, 10) : r.h);
    const w = f.measure(text, size);
    f.draw(ctx, text, r.x + (r.w - w) / 2, r.y + (r.h - f.lineHeight(size)) / 2, size, {
      color: "#f0c450",
      outline: "#3c2408",
      shadow: "rgba(0,0,0,0.6)",
      bevel: true,
    });
  };

  return {
    name: "wood",
    font: o.font,
    titleFont: o.titleFont,
    colors: { ...WOOD_COLORS },
    metrics: { text: 10, small: 8, title: 16, minText: 6, rowH: 17, pad: 4, gap: 3, glyph: 10 },
    textStyle,
    panelTextStyle,
    panels: {
      backdrop,
      window: windowP,
      card,
      row,
      inset,
      header: beam,
      beam,
      button,
      banner,
      dialog,
      field,
      key,
      track,
      knob,
    },
    cursor: (ctx, x, y, dir, size, time) =>
      goldArrow(ctx, x, y, dir, size, Math.max(0, Math.sin(time * 6)) * size * 0.25),
    title,
  };
}
