// Dialog / confirm: a centred panel with a title, a wrapped body (auto height, never overflowing) and a row of
// choices; left / right (or up / down) moves, A chooses, B cancels. The default choice can be the safe one
// (index 1 = "NO") so a mashed A doesn't erase a save.
import { center, inset, row as rowLayout, type Rect } from "../layout.ts";
import type { Nav, Pointer } from "../nav.ts";
import { fitBlock } from "../text.ts";
import { panel, type Ui } from "../theme.ts";
import { label, paragraph } from "./text.ts";

export type DialogEvent = { type: "choose"; index: number; option: string } | { type: "cancel" } | null;

export class Dialog {
  index: number;

  constructor(
    public title: string,
    public body: string,
    public options: string[] = ["YES", "NO"],
    o: { initial?: number; danger?: boolean; sound?: (k: "move" | "ok" | "back") => void } = {},
  ) {
    this.index = o.initial ?? 0;
    this.danger = !!o.danger;
    this.sound = o.sound;
  }
  danger: boolean;
  private sound?: (k: "move" | "ok" | "back") => void;

  update(nav: Nav, ptr?: Pointer & { hit: string }): DialogEvent {
    const n = this.options.length;
    if (ptr && (ptr.moved || ptr.click) && ptr.hit.startsWith("dlg:")) {
      const k = Number(ptr.hit.slice(4));
      if (k !== this.index) {
        this.index = k;
        this.sound?.("move");
      }
      if (ptr.click) {
        this.sound?.("ok");
        return { type: "choose", index: k, option: this.options[k] };
      }
    }
    if (nav.b) {
      this.sound?.("back");
      return { type: "cancel" };
    }
    const d = nav.dx || nav.dy;
    if (d) {
      const i = Math.max(0, Math.min(n - 1, this.index + d));
      if (i !== this.index) {
        this.index = i;
        this.sound?.("move");
      }
    }
    if (nav.a) {
      this.sound?.("ok");
      return { type: "choose", index: this.index, option: this.options[this.index] };
    }
    return null;
  }

  /** The dialog's rect for a screen W x H (height grows with the body). */
  measure(ui: Ui, W: number, H: number, width = Math.min(W * 0.62, ui.theme.metrics.rowH * 16)): Rect {
    const t = ui.theme;
    const pad = t.metrics.pad * 2;
    const titleH = (t.titleFont ?? t.font).lineHeight(t.metrics.title * 0.8);
    const body = fitBlock((s, z) => t.font.measure(s, z), this.body, width - pad * 2, H * 0.5, {
      size: t.metrics.text,
      minSize: t.metrics.minText,
      leading: 1.25,
    });
    const h = pad + titleH + t.metrics.gap * 2 + body.height + t.metrics.gap * 3 + t.metrics.rowH + pad;
    return center({ x: 0, y: 0, w: W, h: H }, width, Math.min(H - 8, h));
  }

  draw(ui: Ui, W: number, H: number): Rect {
    const t = ui.theme;
    const c = ui.ctx;
    c.fillStyle = "rgba(0,0,0,0.55)";
    c.fillRect(0, 0, W, H);
    const r = this.measure(ui, W, H);
    panel(ui, "dialog", r, { tint: this.danger ? t.colors.warn : undefined });
    ui.debug?.box("dialog", r, { bounds: { x: 0, y: 0, w: W, h: H }, ctx: c });
    const pad = t.metrics.pad * 2;
    const inner = inset(r, pad);
    const tf = t.titleFont ?? t.font;
    const titleH = tf.lineHeight(t.metrics.title * 0.8);
    label(
      ui,
      this.title,
      { ...inner, h: titleH },
      {
        title: true,
        size: t.metrics.title * 0.8,
        align: "center",
        onPanel: true,
        color: this.danger ? t.colors.warn : undefined,
        id: "dialog.title",
      },
    );
    const bodyTop = inner.y + titleH + t.metrics.gap * 2;
    const btnY = inner.y + inner.h - t.metrics.rowH;
    paragraph(
      ui,
      this.body,
      { x: inner.x, y: bodyTop, w: inner.w, h: btnY - t.metrics.gap * 2 - bodyTop },
      {
        onPanel: true,
        align: "center",
        color: t.colors.panelText,
        id: "dialog.body",
      },
    );
    const bw = Math.min(
      (inner.w - t.metrics.gap * (this.options.length - 1)) / this.options.length,
      t.metrics.rowH * 5,
    );
    const btns = rowLayout(
      { x: inner.x, y: btnY, w: inner.w, h: t.metrics.rowH },
      this.options.map(() => bw),
      {
        gap: t.metrics.gap * 2,
        justify: "center",
      },
    );
    btns.forEach((b, i) => {
      const sel = i === this.index;
      panel(ui, "button", b, { selected: sel, tint: sel && this.danger && i === 0 ? t.colors.warn : undefined });
      ui.hits?.add(`dlg:${i}`, b);
      ui.debug?.box(`dlg:${i}`, b, { bounds: r, group: "dlg", ctx: c });
      label(ui, this.options[i], inset(b, 0, t.metrics.pad), {
        align: "center",
        color: sel ? t.colors.text : t.colors.dim,
      });
    });
    return r;
  }
}
