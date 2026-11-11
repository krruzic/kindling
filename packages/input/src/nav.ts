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
  /** readDevices' repeat timers, by device handle (devices come and go, and their order changes with seats). */
  private byHandle = new Map<string, { dir: Dir4 | null; t: number }>();

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
    this.byHandle.clear();
  }

  /** One pad's step this frame (advances its repeat timer). */
  private one(p: PadState<A>, i: number, now: number, rec?: { dir: Dir4 | null; t: number }): NavInput<A> {
    const o = this.opts;
    const n: NavInput<A> = { dx: 0, dy: 0, confirm: false, back: false, seat: -1, pressed: {} };
    const r = rec ?? (this.repeat[i] ??= { dir: null, t: 0 });
    if (!p.connected) {
      r.dir = null;
      return n;
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
    if (fire) {
      if (dir === "left") n.dx = -1;
      if (dir === "right") n.dx = 1;
      if (dir === "up") n.dy = -1;
      if (dir === "down") n.dy = 1;
    }
    n.confirm = o.confirm.some((a) => p.pressed[a]);
    n.back = o.back.some((a) => p.pressed[a]);
    for (const a of Object.keys(p.pressed) as A[]) if (p.pressed[a]) n.pressed[a] = true;
    if (fire || n.confirm || n.back) n.seat = i;
    return n;
  }

  /** Every pad's (or one seat's) input merged: the first pad to step or press decides `seat`. */
  read(pads: readonly PadState<A>[], now: number, only = -1): NavInput<A> {
    const n: NavInput<A> = { dx: 0, dy: 0, confirm: false, back: false, seat: -1, pressed: {} };
    pads.forEach((p, i) => {
      if (only >= 0 && i !== only) {
        (this.repeat[i] ??= { dir: null, t: 0 }).dir = null;
        return;
      }
      const e = this.one(p, i, now);
      if ((e.dx || e.dy) && !n.dx && !n.dy) {
        n.dx = e.dx;
        n.dy = e.dy;
      }
      n.confirm ||= e.confirm;
      n.back ||= e.back;
      Object.assign(n.pressed, e.pressed);
      if (e.seat >= 0 && n.seat < 0) n.seat = i;
    });
    return n;
  }

  /**
   * Each pad's own input this frame, unmerged (a select screen where every seat moves its own cursor). Every pad
   * keeps its own repeat timer; read() and readEach() share them, so use one or the other per frame.
   */
  readEach(pads: readonly PadState<A>[], now: number): NavInput<A>[] {
    return pads.map((p, i) => this.one(p, i, now));
  }

  /**
   * Every connected device merged, seated or not (InputManager.deviceList(): a menu anyone can drive, including a
   * device that left its seat, which can't rejoin by a direction alone). Repeat timers are kept per device handle,
   * apart from read() / readEach()'s per-seat ones, so a game can read seats and devices in the same frame.
   * `seat` is the index in `devices` that acted first; `handle` its handle.
   */
  readDevices(
    devices: readonly { handle: string; state: PadState<A> }[],
    now: number,
  ): NavInput<A> & { handle: string | null } {
    const n: NavInput<A> & { handle: string | null } = {
      dx: 0,
      dy: 0,
      confirm: false,
      back: false,
      seat: -1,
      pressed: {},
      handle: null,
    };
    const live = new Set<string>();
    devices.forEach((d, i) => {
      live.add(d.handle);
      let r = this.byHandle.get(d.handle);
      if (!r) this.byHandle.set(d.handle, (r = { dir: null, t: 0 }));
      const e = this.one(d.state, i, now, r);
      if ((e.dx || e.dy) && !n.dx && !n.dy) {
        n.dx = e.dx;
        n.dy = e.dy;
      }
      n.confirm ||= e.confirm;
      n.back ||= e.back;
      Object.assign(n.pressed, e.pressed);
      if (e.seat >= 0 && n.seat < 0) {
        n.seat = i;
        n.handle = d.handle;
      }
    });
    for (const h of [...this.byHandle.keys()]) if (!live.has(h)) this.byHandle.delete(h);
    return n;
  }
}
