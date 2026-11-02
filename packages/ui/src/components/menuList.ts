// Menu list: a vertical list of items with a selection cursor that points AT the selected item (a left-pointing
// arrow reads as "back"), skipping disabled items, wrapping or clamping at the ends, scrolling when the list is
// taller than its rect, and mouse hover / click through hit targets registered while drawing.
// update() takes one frame's Nav (key repeat already applied, see nav.ts) and returns what happened; sounds go
// through the optional callback so the game picks them.
import { inset, type Rect } from "../layout.ts";
import type { Nav, Pointer } from "../nav.ts";
import { panel, type Ui } from "../theme.ts";
import { label } from "./text.ts";

export interface MenuItem {
  id: string;
  label: string;
  disabled?: boolean;
  /** Right-aligned value text ("ON", "3 / 5"). */
  value?: string;
}

export type MenuSound = (k: "move" | "ok" | "back" | "error") => void;

export type MenuEvent =
  { type: "move"; index: number } | { type: "select"; index: number; item: MenuItem } | { type: "back" } | null;

export interface MenuListOpts {
  wrap?: boolean;
  sound?: MenuSound;
  /** Hit id prefix (several lists on one screen need distinct ones). */
  hitId?: string;
}

export interface MenuDrawOpts {
  rowH?: number;
  gap?: number;
  size?: number;
  align?: "left" | "center";
  /** Panel role for rows (default "row"). */
  role?: string;
}

export class MenuList {
  index = 0;
  scroll = 0;
  private hitId: string;

  constructor(
    public items: MenuItem[],
    private o: MenuListOpts = {},
  ) {
    this.hitId = o.hitId ?? "menu";
    this.index = Math.max(0, this.next(-1, 1));
  }

  get selected(): MenuItem | undefined {
    return this.items[this.index];
  }

  /** Next enabled index from `from` stepping `dir`; -1 when none. */
  private next(from: number, dir: number): number {
    const n = this.items.length;
    for (let k = 1; k <= n; k++) {
      let i = from + dir * k;
      if (this.o.wrap !== false) i = ((i % n) + n) % n;
      else if (i < 0 || i >= n) return -1;
      if (!this.items[i].disabled) return i;
    }
    return -1;
  }

  update(nav: Nav, ptr?: Pointer & { hit: string }): MenuEvent {
    const s = this.o.sound;
    if (ptr && (ptr.moved || ptr.click)) {
      const m = ptr.hit.startsWith(`${this.hitId}:`) ? Number(ptr.hit.slice(this.hitId.length + 1)) : -1;
      if (m >= 0 && !this.items[m]?.disabled) {
        if (m !== this.index) {
          this.index = m;
          s?.("move");
          if (!ptr.click) return { type: "move", index: m };
        }
        if (ptr.click) {
          s?.("ok");
          return { type: "select", index: m, item: this.items[m] };
        }
      }
    }
    if (nav.b) {
      s?.("back");
      return { type: "back" };
    }
    if (nav.dy) {
      const i = this.next(this.index, nav.dy);
      if (i >= 0 && i !== this.index) {
        this.index = i;
        s?.("move");
        return { type: "move", index: i };
      }
    }
    if (nav.a) {
      const it = this.items[this.index];
      if (!it || it.disabled) {
        s?.("error");
        return null;
      }
      s?.("ok");
      return { type: "select", index: this.index, item: it };
    }
    return null;
  }

  /** Rows that fit in a rect of height h. */
  static visible(h: number, rowH: number, gap: number): number {
    return Math.max(1, Math.floor((h + gap) / (rowH + gap)));
  }

  /** Lays out row rects for r (after scrolling); null entries are scrolled out. */
  layout(
    r: Rect,
    rowH: number,
    gap: number,
    cursorW: number,
  ): { rows: (Rect | null)[]; up: boolean; down: boolean; bottom: number } {
    const n = this.items.length;
    let vis = MenuList.visible(r.h, rowH, gap);
    let top = r.y;
    const scrolling = vis < n;
    if (scrolling) {
      const arrow = rowH * 0.45;
      vis = MenuList.visible(r.h - arrow * 2, rowH, gap);
      top = r.y + arrow;
    }
    if (this.index < this.scroll) this.scroll = this.index;
    if (this.index >= this.scroll + vis) this.scroll = this.index - vis + 1;
    this.scroll = Math.max(0, Math.min(this.scroll, Math.max(0, n - vis)));
    const rows = this.items.map((_, i) => {
      const k = i - this.scroll;
      if (k < 0 || k >= vis) return null;
      return { x: r.x + cursorW, y: top + k * (rowH + gap), w: r.w - cursorW, h: rowH };
    });
    const shown = Math.min(vis, n - this.scroll);
    const bottom = top + shown * (rowH + gap) - gap;
    return { rows, up: scrolling && this.scroll > 0, down: scrolling && this.scroll + vis < n, bottom };
  }

  draw(ui: Ui, r: Rect, o: MenuDrawOpts = {}): (Rect | null)[] {
    const t = ui.theme;
    const rowH = o.rowH ?? t.metrics.rowH;
    const gap = o.gap ?? t.metrics.gap;
    const cursorW = rowH * 0.75;
    const L = this.layout(r, rowH, gap, cursorW);
    const pad = t.metrics.pad;
    L.rows.forEach((row, i) => {
      if (!row) return;
      const it = this.items[i];
      const sel = i === this.index;
      panel(ui, o.role ?? "row", row, { selected: sel, disabled: it.disabled, seed: i });
      ui.hits?.add(`${this.hitId}:${i}`, row);
      ui.debug?.box(`${this.hitId}:${i}`, row, { bounds: r, group: this.hitId, ctx: ui.ctx });
      const color = it.disabled ? t.colors.disabled : sel ? t.colors.selected : t.colors.panelText;
      const inner = inset(row, 0, pad);
      const size = o.size ?? t.metrics.text;
      if (it.value) {
        const vw = Math.min(inner.w * 0.4, t.font.measure(it.value, size) + 1);
        label(
          ui,
          it.value,
          { ...inner, x: inner.x + inner.w - vw, w: vw },
          { onPanel: true, color, size, align: "right" },
        );
        label(ui, it.label, { ...inner, w: inner.w - vw - pad }, { onPanel: true, color, size });
      } else label(ui, it.label, inner, { onPanel: true, color, size, align: o.align ?? "left" });
      if (sel) t.cursor(ui.ctx, row.x - 1.5, row.y + row.h / 2, "right", rowH * 0.36, ui.time);
    });
    const cx = r.x + cursorW + (r.w - cursorW) / 2;
    if (L.up) t.cursor(ui.ctx, cx, r.y, "up", rowH * 0.22, ui.time);
    if (L.down) t.cursor(ui.ctx, cx, L.bottom + rowH * 0.42, "down", rowH * 0.22, ui.time);
    return L.rows;
  }
}
