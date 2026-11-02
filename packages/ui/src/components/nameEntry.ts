// Name entry: an on-screen letter grid for pads (the keyboard types directly through type()/backspace()),
// with special keys (SPACE / DEL / DONE) on a last row. update() returns "done" or "cancel" when the entry closes.
// B deletes a letter first and cancels only on an empty name, so a mashed B doesn't throw a name away.
import { grid, inset, splitY, type Rect } from "../layout.ts";
import type { Nav, Pointer } from "../nav.ts";
import { panel, type Ui } from "../theme.ts";
import { label } from "./text.ts";

export type NameEntryEvent = "done" | "cancel" | "type" | null;

const SPECIAL = ["SPACE", "DEL", "DONE"] as const;

export class NameEntry {
  text: string;
  row = 0;
  col = 0;
  readonly rows: string[][];

  constructor(
    initial = "",
    public maxLen = 10,
    keys = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-!",
    public cols = 10,
    private sound?: (k: "move" | "key" | "back" | "ok" | "error") => void,
  ) {
    this.text = initial.slice(0, maxLen);
    const chars = [...keys];
    this.rows = [];
    for (let i = 0; i < chars.length; i += cols) this.rows.push(chars.slice(i, i + cols));
    this.rows.push([...SPECIAL]);
  }

  get key(): string {
    return this.rows[this.row][this.col];
  }

  type(ch: string): boolean {
    if ([...this.text].length >= this.maxLen) {
      this.sound?.("error");
      return false;
    }
    this.text += ch;
    this.sound?.("key");
    return true;
  }

  backspace(): boolean {
    if (!this.text) return false;
    this.text = [...this.text].slice(0, -1).join("");
    this.sound?.("back");
    return true;
  }

  private press(k: string): NameEntryEvent {
    if (k === "DONE") {
      if (!this.text.trim()) {
        this.sound?.("error");
        return null;
      }
      this.sound?.("ok");
      return "done";
    }
    if (k === "DEL") return this.backspace() ? "type" : null;
    return this.type(k === "SPACE" ? " " : k) ? "type" : null;
  }

  update(nav: Nav, ptr?: Pointer & { hit: string }): NameEntryEvent {
    if (ptr && (ptr.moved || ptr.click) && ptr.hit.startsWith("key:")) {
      const [r, c] = ptr.hit.slice(4).split(",").map(Number);
      if (r !== this.row || c !== this.col) {
        this.row = r;
        this.col = c;
        this.sound?.("move");
      }
      if (ptr.click) return this.press(this.key);
    }
    if (nav.b) {
      if (this.backspace()) return "type";
      this.sound?.("back");
      return "cancel";
    }
    if (nav.dy) {
      const from = this.rows[this.row].length;
      this.row = (this.row + nav.dy + this.rows.length) % this.rows.length;
      // Keep roughly the same horizontal position between rows of different lengths.
      const to = this.rows[this.row].length;
      this.col = Math.min(to - 1, Math.floor(((this.col + 0.5) * to) / from));
      this.sound?.("move");
    }
    if (nav.dx) {
      const n = this.rows[this.row].length;
      this.col = (this.col + nav.dx + n) % n;
      this.sound?.("move");
    }
    if (nav.y) {
      this.row = this.rows.length - 1;
      this.col = SPECIAL.indexOf("DONE");
    }
    if (nav.a) return this.press(this.key);
    return null;
  }

  /** Height the entry wants at width w (keys at full row height). */
  height(ui: Ui, w: number): number {
    const t = ui.theme;
    const gap = t.metrics.gap * 0.6;
    const cellW = (w - t.metrics.pad * 4 - gap * (this.cols - 1)) / this.cols;
    const rowH = Math.min(t.metrics.rowH, cellW / 1.0);
    const head = t.font.lineHeight(t.metrics.small);
    const keys = rowH * this.rows.length + gap * (this.rows.length - 2) + gap * 2.5;
    return t.metrics.pad * 4 + head + t.metrics.rowH * 1.1 + t.metrics.gap * 3 + keys;
  }

  draw(ui: Ui, r: Rect, title = "ENTER NAME"): void {
    const t = ui.theme;
    const c = ui.ctx;
    panel(ui, "window", r, {});
    ui.debug?.box("nameEntry", r, { ctx: c });
    const inner = inset(r, t.metrics.pad * 2);
    const head = t.font.lineHeight(t.metrics.small);
    label(
      ui,
      title,
      { ...inner, h: head },
      { onPanel: true, size: t.metrics.small, color: t.colors.panelDim, align: "center" },
    );
    const fieldH = t.metrics.rowH * 1.1;
    const field = { x: inner.x, y: inner.y + head + t.metrics.gap, w: inner.w, h: fieldH };
    panel(ui, "field", field, {});
    // Slots: one underline per letter so the length limit is visible.
    const slotW = Math.min((field.w - t.metrics.pad * 2) / this.maxLen, t.metrics.text * 0.95);
    const sx = field.x + (field.w - slotW * this.maxLen) / 2;
    const chars = [...this.text];
    const tsz = Math.min(t.metrics.text * 1.1, slotW * 1.3);
    for (let i = 0; i < this.maxLen; i++) {
      const x = sx + i * slotW;
      const caret = i === chars.length && Math.floor(ui.time * 2.5) % 2 === 0;
      c.fillStyle = caret ? t.colors.selected : t.colors.panelDim;
      c.globalAlpha = caret ? 1 : 0.5;
      c.fillRect(x + slotW * 0.12, field.y + field.h - t.metrics.pad - 1, slotW * 0.76, caret ? 1.5 : 0.75);
      c.globalAlpha = 1;
      if (chars[i]) {
        const w = t.font.measure(chars[i], tsz);
        t.font.draw(
          c,
          chars[i],
          x + (slotW - w) / 2,
          field.y + (field.h - t.font.lineHeight(tsz)) / 2 - 0.5,
          tsz,
          t.panelTextStyle,
        );
      }
    }
    const [, keysR] = splitY(inner, head + fieldH + t.metrics.gap * 3, 0);
    const letterRows = this.rows.length - 1;
    const gap = t.metrics.gap * 0.6;
    const rowH = Math.min(t.metrics.rowH, (keysR.h - gap * letterRows) / this.rows.length);
    const gridH = rowH * letterRows + gap * (letterRows - 1);
    const cellW = Math.min(rowH * 1.25, (keysR.w - gap * (this.cols - 1)) / this.cols);
    const cells = grid({ x: keysR.x, y: keysR.y, w: keysR.w, h: gridH }, letterRows * this.cols, {
      cols: this.cols,
      gap,
      cellW,
      cellH: rowH,
      center: true,
    });
    const draw = (k: string, cr: Rect, ri: number, ci: number) => {
      const sel = ri === this.row && ci === this.col;
      panel(ui, "key", cr, { selected: sel });
      ui.hits?.add(`key:${ri},${ci}`, cr);
      ui.debug?.box(`key:${k}`, cr, { bounds: r, group: "keys", ctx: c });
      label(ui, k, inset(cr, 0, 1), {
        align: "center",
        size: k.length > 1 ? t.metrics.small : t.metrics.text,
        color: sel ? t.colors.selected : t.colors.panelText,
        onPanel: true,
      });
    };
    for (let ri = 0; ri < letterRows; ri++)
      this.rows[ri].forEach((k, ci) => draw(k, cells[ri * this.cols + ci], ri, ci));
    const last = this.rows.length - 1;
    const bw = cellW * 3 + gap * 2;
    const by = keysR.y + gridH + gap * 2.5;
    const total = bw * SPECIAL.length + gap * 2 * (SPECIAL.length - 1);
    const bx = keysR.x + (keysR.w - total) / 2;
    SPECIAL.forEach((k, ci) => draw(k, { x: bx + ci * (bw + gap * 2), y: by, w: bw, h: rowH }, last, ci));
  }
}
