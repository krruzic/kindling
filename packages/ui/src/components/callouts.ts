// Callouts: transient text the game pushes at players ("FIGHT!", "P1 TAKES THE LEAD", "THE GATES ARE SHUT").
// A queue per lane: "big" words slam into the middle one at a time; "banner" lines stack under the top edge (a
// few at once, the rest wait). Each slams in (scale from large with an overshoot and a small shake), holds, and
// fades out. The timing is a pure function (slam()) so it is tested and reusable for other pop-ins.
import { inset, type Rect } from "../layout.ts";
import { fitLine } from "../text.ts";
import { panel, type Ui } from "../theme.ts";

export type CalloutLane = "big" | "banner";

export interface Callout {
  text: string;
  sub?: string;
  lane: CalloutLane;
  /** Seconds on screen including the slam and fade (default big 1.6, banner 2.6). */
  hold: number;
  color?: string;
  /** Set when it starts showing. */
  at: number;
}

export interface SlamState {
  scale: number;
  alpha: number;
  /** Shake offset in units of text height. */
  shake: number;
  done: boolean;
}

const IN = 0.14;
const SETTLE = 0.12;
const OUT = 0.35;

/** Slam-in / hold / fade for a callout `age` seconds old that lives `hold` seconds. */
export function slam(age: number, hold: number, from = 2.4): SlamState {
  if (age < 0) return { scale: from, alpha: 0, shake: 0, done: false };
  if (age >= hold) return { scale: 1, alpha: 0, shake: 0, done: true };
  let scale = 1;
  let shake = 0;
  if (age < IN) {
    const k = age / IN;
    scale = from + (0.9 - from) * k * k;
  } else if (age < IN + SETTLE) {
    const k = (age - IN) / SETTLE;
    scale = 0.9 + 0.1 * (1 - (1 - k) * (1 - k));
    shake = (1 - k) * 0.06 * Math.sin(k * 40);
  }
  const alpha = age < IN ? Math.min(1, age / (IN * 0.5)) : age > hold - OUT ? Math.max(0, (hold - age) / OUT) : 1;
  return { scale, alpha, shake, done: false };
}

export class Callouts {
  private queue: Callout[] = [];
  private live: Callout[] = [];
  /** Banners shown at once. */
  maxBanners = 3;

  push(text: string, o: { sub?: string; lane?: CalloutLane; hold?: number; color?: string } = {}): void {
    const lane = o.lane ?? "banner";
    this.queue.push({ text, sub: o.sub, lane, hold: o.hold ?? (lane === "big" ? 1.6 : 2.6), color: o.color, at: -1 });
  }

  /** Advances the queue to time `now` (seconds). */
  update(now: number): void {
    this.live = this.live.filter((c) => now - c.at < c.hold);
    for (const c of [...this.queue]) {
      const busy = this.live.filter((l) => l.lane === c.lane).length;
      if (busy >= (c.lane === "big" ? 1 : this.maxBanners)) continue;
      c.at = now;
      this.live.push(c);
      this.queue.splice(this.queue.indexOf(c), 1);
    }
  }

  /** Currently showing (oldest first). */
  get showing(): readonly Callout[] {
    return this.live;
  }

  get waiting(): number {
    return this.queue.length;
  }

  clear(): void {
    this.queue = [];
    this.live = [];
  }

  draw(ui: Ui, area: Rect, now: number): void {
    const t = ui.theme;
    const c = ui.ctx;
    const measure = (s: string, z: number) => (t.titleFont ?? t.font).measure(s, z);
    let by = area.y + t.metrics.gap;
    for (const co of this.live) {
      const st = slam(now - co.at, co.hold, co.lane === "big" ? 2.6 : 1.6);
      if (st.done) continue;
      const tf = co.lane === "big" ? (t.titleFont ?? t.font) : t.font;
      const want = co.lane === "big" ? t.metrics.title * 2.2 : t.metrics.text * 1.1;
      const maxW = area.w * (co.lane === "big" ? 0.9 : 0.7);
      const f = fitLine(
        co.lane === "big" ? measure : (s, z) => t.font.measure(s, z),
        co.text,
        maxW,
        want,
        t.metrics.minText,
      );
      const lh = tf.lineHeight(f.size);
      const subH = co.sub ? t.font.lineHeight(t.metrics.small) : 0;
      const cx = area.x + area.w / 2;
      const boxW = Math.min(
        area.w * 0.8,
        Math.max(f.width, co.sub ? t.font.measure(co.sub, t.metrics.small) : 0) + t.metrics.pad * 6,
      );
      const boxH = lh + subH + t.metrics.pad * 2;
      const cy = co.lane === "big" ? area.y + area.h * 0.42 : by + boxH / 2;
      c.save();
      c.globalAlpha = st.alpha;
      c.translate(cx + st.shake * lh, cy);
      c.scale(st.scale, st.scale);
      const box = { x: -boxW / 2, y: -boxH / 2, w: boxW, h: boxH };
      if (co.lane === "banner") panel(ui, "banner", box, { tint: co.color });
      const style = { ...t.textStyle, color: co.color && co.lane === "big" ? co.color : t.textStyle.color };
      tf.draw(
        c,
        f.text,
        -f.width / 2,
        -boxH / 2 + t.metrics.pad,
        f.size,
        co.lane === "big" ? { ...style, outline: t.colors.ink } : style,
      );
      if (co.sub) {
        const sf = fitLine(
          (s, z) => t.font.measure(s, z),
          co.sub,
          boxW - t.metrics.pad * 2,
          t.metrics.small,
          t.metrics.minText,
        );
        t.font.draw(c, sf.text, -sf.width / 2, -boxH / 2 + t.metrics.pad + lh, sf.size, {
          ...t.textStyle,
          color: t.textStyle.color ?? t.colors.text,
        });
      }
      c.restore();
      if (co.lane === "banner") {
        ui.debug?.box(`callout:${co.text}`, inset({ x: cx - boxW / 2, y: cy - boxH / 2, w: boxW, h: boxH }, 0), {
          bounds: area,
          group: "callouts",
          ctx: c,
        });
        by += boxH + t.metrics.gap;
      }
    }
  }
}
