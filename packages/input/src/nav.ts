// Menu navigation: turns stick / d-pad state into discrete menu steps with key repeat (fires on press, again after
// `delay`, then every `every` seconds while held), plus confirm / back. It reads PadState actions, so a remap of
// confirm / back applies here too. Merges every connected pad, or only one seat (the player who paused).
import { dir4, type Dir4 } from "./sticks.ts";
import type { PadState } from "./types.ts";

export interface NavOptions<A extends string> {
  /** Actions that step the cursor (usually the d-pad); the left stick always does unless `stick` is false. */
  up?: A;
  down?: A;
  left?: A;
  right?: A;
  confirm: readonly A[];
  back: readonly A[];
  /** First repeat after holding a direction (s). */
  delay?: number;
  /** Repeat interval after that (s). */
  every?: number;
  /** Stick deflection that counts as a direction. */
  threshold?: number;
  stick?: boolean;
}

export interface NavInput<A extends string> {
  dx: -1 | 0 | 1;
  dy: -1 | 0 | 1;
  confirm: boolean;
  back: boolean;
  /** Seat (index into the pads given) whose input fired first, or -1. */
  seat: number;
  /** Every action pressed this frame on any of the pads read. */
  pressed: Partial<Record<A, boolean>>;
}

export const NAV_DELAY = 0.38;
export const NAV_EVERY = 0.1;

export class MenuNavigator<A extends string> {
  private repeat: { dir: Dir4 | null; t: number }[] = [];

  constructor(public opts: NavOptions<A>) {}

  /** Dominant 4-way direction of a pad's stick plus its direction actions. */
  direction(p: PadState<A>): Dir4 | null {
    const o = this.opts;
    const on = (a: A | undefined) => (a !== undefined && p.held[a] ? 1 : 0);
    const st = o.stick !== false;
    const x = (st ? p.stickX : 0) + on(o.right) - on(o.left);
    const y = (st ? p.stickY : 0) + on(o.down) - on(o.up);
    return dir4(x, y, o.threshold ?? 0.5);
  }

  /** Forget held directions (call when a menu opens, so a held stick doesn't fire mid-repeat). */
  reset(): void {
    this.repeat = [];
  }

  read(pads: readonly PadState<A>[], now: number, only = -1): NavInput<A> {
    const o = this.opts;
    const n: NavInput<A> = { dx: 0, dy: 0, confirm: false, back: false, seat: -1, pressed: {} };
    pads.forEach((p, i) => {
      const r = (this.repeat[i] ??= { dir: null, t: 0 });
      if (!p.connected || (only >= 0 && i !== only)) {
        r.dir = null;
        return;
      }
      const dir = this.direction(p);
      let fire = false;
      if (dir !== r.dir) {
        r.dir = dir;
        r.t = now + (o.delay ?? NAV_DELAY);
        fire = !!dir;
      } else if (dir && now >= r.t) {
        r.t += o.every ?? NAV_EVERY;
        if (r.t <= now) r.t = now + (o.every ?? NAV_EVERY);
        fire = true;
      }
      const hit = (fire && !n.dx && !n.dy) || o.confirm.some((a) => p.pressed[a]) || o.back.some((a) => p.pressed[a]);
      if (fire && !n.dx && !n.dy) {
        if (dir === "left") n.dx = -1;
        if (dir === "right") n.dx = 1;
        if (dir === "up") n.dy = -1;
        if (dir === "down") n.dy = 1;
      }
      n.confirm ||= o.confirm.some((a) => p.pressed[a]);
      n.back ||= o.back.some((a) => p.pressed[a]);
      for (const a of Object.keys(p.pressed) as A[]) if (p.pressed[a]) n.pressed[a] = true;
      if (hit && n.seat < 0) n.seat = i;
    });
    return n;
  }
}
