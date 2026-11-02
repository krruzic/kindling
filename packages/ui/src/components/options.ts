// Options page: a list of setting rows (slider, toggle, choice, keybind, action) with the label on the left and
// the control on the right. Up / down moves, left / right adjusts, A toggles / cycles / activates. Rows read and
// write through get / set callbacks, so the game's save format stays the game's.
import { inset, splitX, type Rect } from "../layout.ts";
import type { Nav, Pointer } from "../nav.ts";
import { panel, type Glyph, type Ui } from "../theme.ts";
import { MenuList } from "./menuList.ts";
import { drawGlyph, glyphWidth } from "./prompts.ts";
import { label } from "./text.ts";

interface RowBase {
  id: string;
  label: string;
  /** Detail line a page can show for the focused row. */
  blurb?: string;
  disabled?: boolean;
}

export type OptionRow = RowBase &
  (
    | {
        kind: "slider";
        min: number;
        max: number;
        step: number;
        get(): number;
        set(v: number): void;
        format?(v: number): string;
      }
    | { kind: "toggle"; get(): boolean; set(v: boolean): void; on?: string; off?: string }
    | { kind: "choice"; options: string[]; get(): number; set(i: number): void; wrap?: boolean }
    | { kind: "keybind"; get(): Glyph | null; listening?(): boolean; rebind(): void }
    | { kind: "action"; run(): void; danger?: boolean }
  );

export type OptionsEvent =
  | { type: "move"; index: number }
  | { type: "change"; row: OptionRow }
  | { type: "action"; row: OptionRow }
  | { type: "back" }
  | null;

export type OptionsSound = (k: "move" | "adjust" | "ok" | "back" | "error") => void;

/** Applies a left / right step (or A) to a row; true when its value changed. */
export function adjustRow(row: OptionRow, dir: number): boolean {
  switch (row.kind) {
    case "slider": {
      const v = row.get();
      const nv = Math.max(row.min, Math.min(row.max, Math.round((v + dir * row.step) / row.step) * row.step));
      if (nv === v) return false;
      row.set(nv);
      return true;
    }
    case "toggle":
      row.set(!row.get());
      return true;
    case "choice": {
      const n = row.options.length;
      const i = row.get();
      const ni = row.wrap === false ? Math.max(0, Math.min(n - 1, i + dir)) : (i + dir + n) % n;
      if (ni === i) return false;
      row.set(ni);
      return true;
    }
    default:
      return false;
  }
}

export class OptionsPage {
  index = 0;
  scroll = 0;

  constructor(
    public rows: OptionRow[],
    private sound?: OptionsSound,
    private hitId = "opt",
  ) {}

  get focused(): OptionRow | undefined {
    return this.rows[this.index];
  }

  update(nav: Nav, ptr?: Pointer & { hit: string }): OptionsEvent {
    const s = this.sound;
    // A keybind row that is listening owns the input until it stops.
    const f = this.rows[this.index];
    if (f?.kind === "keybind" && f.listening?.()) return null;
    let dx = nav.dx;
    let act = nav.a;
    if (ptr && (ptr.moved || ptr.click) && ptr.hit.startsWith(`${this.hitId}:`)) {
      const [, i, part] = ptr.hit.split(":");
      const k = Number(i);
      if (k !== this.index && !this.rows[k]?.disabled) {
        this.index = k;
        s?.("move");
      }
      if (ptr.click) {
        if (part === "dec") dx = -1;
        else if (part === "inc") dx = 1;
        else act = true;
      }
    }
    if (nav.b) {
      s?.("back");
      return { type: "back" };
    }
    if (nav.dy) {
      const n = this.rows.length;
      for (let k = 1; k <= n; k++) {
        const i = (this.index + nav.dy * k + n) % n;
        if (!this.rows[i].disabled) {
          if (i !== this.index) {
            this.index = i;
            s?.("move");
            return { type: "move", index: i };
          }
          break;
        }
      }
    }
    const row = this.rows[this.index];
    if (!row || row.disabled) return null;
    if (dx && adjustRow(row, dx)) {
      s?.("adjust");
      return { type: "change", row };
    }
    if (act) {
      if (row.kind === "action") {
        s?.("ok");
        row.run();
        return { type: "action", row };
      }
      if (row.kind === "keybind") {
        s?.("ok");
        row.rebind();
        return { type: "action", row };
      }
      if (row.kind === "slider") {
        // A on a slider wraps from max back to min (one-button devices can still set it).
        if (row.get() >= row.max) row.set(row.min);
        else adjustRow(row, 1);
        s?.("adjust");
        return { type: "change", row };
      }
      if (adjustRow(row, 1)) {
        s?.("adjust");
        return { type: "change", row };
      }
    }
    return null;
  }

  draw(ui: Ui, r: Rect, o: { rowH?: number; gap?: number; controlW?: number } = {}): void {
    const t = ui.theme;
    const rowH = o.rowH ?? t.metrics.rowH;
    const gap = o.gap ?? t.metrics.gap;
    const cursorW = rowH * 0.75;
    // Reuse the menu list's scrolling layout.
    const lay = Object.assign(new MenuList(this.rows.map((x) => ({ id: x.id, label: x.label }))), {
      index: this.index,
      scroll: this.scroll,
    });
    const L = lay.layout(r, rowH, gap, cursorW);
    this.scroll = lay.scroll;
    const pad = t.metrics.pad;
    L.rows.forEach((rr, i) => {
      if (!rr) return;
      const row = this.rows[i];
      const sel = i === this.index;
      panel(ui, "row", rr, { selected: sel, disabled: row.disabled, seed: i });
      ui.hits?.add(`${this.hitId}:${i}`, rr);
      ui.debug?.box(`${this.hitId}:${row.id}`, rr, { bounds: r, group: this.hitId, ctx: ui.ctx });
      const inner = inset(rr, 0, pad);
      const color = row.disabled ? t.colors.disabled : sel ? t.colors.selected : t.colors.panelText;
      if (row.kind === "action") {
        label(ui, row.label, inner, {
          onPanel: true,
          color: row.danger && !row.disabled ? t.colors.warn : color,
          align: "center",
        });
      } else {
        const cw = o.controlW ?? Math.min(inner.w * 0.48, rowH * 6.5);
        const [lr, cr] = splitX(inner, inner.w - cw, 0);
        label(ui, row.label, { ...lr, w: lr.w - pad }, { onPanel: true, color });
        this.control(ui, row, cr, sel, i);
      }
      if (sel) t.cursor(ui.ctx, rr.x - 1.5, rr.y + rr.h / 2, "right", rowH * 0.36, ui.time);
    });
    const cx = r.x + cursorW + (r.w - cursorW) / 2;
    if (L.up) t.cursor(ui.ctx, cx, r.y, "up", rowH * 0.22, ui.time);
    if (L.down) t.cursor(ui.ctx, cx, L.bottom + rowH * 0.42, "down", rowH * 0.22, ui.time);
  }

  private control(ui: Ui, row: OptionRow, r: Rect, sel: boolean, i: number): void {
    const t = ui.theme;
    const c = ui.ctx;
    const h = r.h;
    const cy = r.y + h / 2;
    const size = t.metrics.small;
    const text = sel ? t.colors.selected : t.colors.panelText;
    const arrows = (vr: Rect) => {
      const a = h * 0.22;
      t.cursor(c, vr.x + a * 0.2, cy, "left", a, ui.time);
      t.cursor(c, vr.x + vr.w - a * 0.2, cy, "right", a, ui.time);
      ui.hits?.add(`${this.hitId}:${i}:dec`, { x: vr.x, y: r.y, w: h * 0.6, h });
      ui.hits?.add(`${this.hitId}:${i}:inc`, { x: vr.x + vr.w - h * 0.6, y: r.y, w: h * 0.6, h });
      return inset(vr, 0, a * 1.6);
    };
    if (row.kind === "slider") {
      const v = row.get();
      const txt = row.format ? row.format(v) : String(v);
      const vw =
        Math.max(t.font.measure(row.format ? row.format(row.max) : String(row.max), size), t.font.measure(txt, size)) +
        2;
      const tr = { x: r.x, y: cy - h * 0.14, w: Math.max(4, r.w - vw - h * 0.4), h: h * 0.28 };
      const k = (v - row.min) / Math.max(1e-9, row.max - row.min);
      panel(ui, "track", tr, { selected: sel });
      c.fillStyle = t.colors.fill;
      const fillW = Math.max(0, (tr.w - 2) * k);
      if (t.pixel) c.fillRect(Math.round(tr.x + 1), Math.round(tr.y + 1), Math.round(fillW), Math.round(tr.h - 2));
      else {
        c.beginPath();
        c.roundRect(tr.x + 1, tr.y + 1, fillW, tr.h - 2, (tr.h - 2) / 2);
        c.fill();
      }
      const steps = Math.round((row.max - row.min) / row.step);
      if (steps <= 12) {
        c.fillStyle = "rgba(0,0,0,0.25)";
        for (let s = 1; s < steps; s++) c.fillRect(tr.x + (tr.w * s) / steps - 0.3, tr.y + 1, 0.6, tr.h - 2);
      }
      panel(ui, "knob", { x: tr.x + 1 + fillW - h * 0.2, y: cy - h * 0.3, w: h * 0.4, h: h * 0.6 }, { selected: sel });
      ui.hits?.add(`${this.hitId}:${i}:dec`, { x: tr.x, y: r.y, w: tr.w * k, h });
      ui.hits?.add(`${this.hitId}:${i}:inc`, { x: tr.x + tr.w * k, y: r.y, w: tr.w * (1 - k), h });
      label(ui, txt, { x: r.x + r.w - vw, y: r.y, w: vw, h }, { onPanel: true, color: text, size, align: "right" });
    } else if (row.kind === "toggle") {
      const on = row.get();
      const pr = { x: r.x + r.w - Math.min(r.w, h * 3.2), y: cy - h * 0.32, w: Math.min(r.w, h * 3.2), h: h * 0.64 };
      panel(ui, "inset", pr, {});
      const half = { ...pr, w: pr.w / 2, x: on ? pr.x + pr.w / 2 : pr.x };
      panel(ui, "button", inset(half, 1), { selected: true, tint: on ? t.colors.good : t.colors.disabled });
      label(ui, row.off ?? "OFF", inset({ ...pr, w: pr.w / 2 }, 0, 2), {
        size: size * 0.9,
        align: "center",
        color: on ? t.colors.dim : t.colors.text,
      });
      label(ui, row.on ?? "ON", inset({ ...pr, x: pr.x + pr.w / 2, w: pr.w / 2 }, 0, 2), {
        size: size * 0.9,
        align: "center",
        color: on ? t.colors.text : t.colors.dim,
      });
    } else if (row.kind === "choice") {
      const vr = arrows(r);
      label(ui, row.options[row.get()] ?? "", vr, { onPanel: true, color: text, size, align: "center" });
    } else if (row.kind === "keybind") {
      const listening = row.listening?.() ?? false;
      if (listening) {
        const blink = Math.floor(ui.time * 3) % 2 === 0;
        label(ui, "PRESS A BUTTON", r, { onPanel: true, color: blink ? t.colors.warn : text, size, align: "right" });
      } else {
        const g = row.get();
        if (g) {
          const gh = Math.min(h * 0.72, t.metrics.glyph * 1.1);
          const gw = glyphWidth(t, g, gh);
          drawGlyph(ui, g, r.x + r.w - gw, cy, gh);
        } else label(ui, "-", r, { onPanel: true, color: t.colors.panelDim, size, align: "right" });
      }
    }
  }
}
