// Menu navigation input: one frame of merged directions and buttons (from any device; the input package or the
// game builds it), key repeat for held directions, and mouse hit targets registered while drawing.
//
// Components consume a `Nav` (single steps per direction this frame, button presses as edges), so key repeat is
// decided in one place: feed held state to NavRepeater each frame and pass its output on.
import { containsPoint, type Rect } from "./layout.ts";

export interface Nav {
  /** -1 / 0 / 1 steps this frame (after repeat). */
  dx: number;
  dy: number;
  /** Confirm / cancel pressed this frame. */
  a: boolean;
  b: boolean;
  /** Optional extra buttons games use (tab switch, delete...). */
  x?: boolean;
  y?: boolean;
}

export const NO_NAV: Nav = { dx: 0, dy: 0, a: false, b: false };

/** Held state for one frame (directions as -1 / 0 / 1, buttons as held booleans). */
export interface HeldNav {
  x: number;
  y: number;
  a: boolean;
  b: boolean;
  bx?: boolean;
  by?: boolean;
}

/** Repeat for one held axis: a step on press, then after `delay` seconds one every `rate` seconds. */
export class KeyRepeat {
  private dir = 0;
  private t = 0;
  constructor(
    public delay = 0.32,
    public rate = 0.085,
  ) {}

  update(dir: number, dt: number): number {
    dir = Math.sign(dir);
    if (dir !== this.dir) {
      this.dir = dir;
      this.t = -this.delay;
      return dir;
    }
    if (!dir) return 0;
    this.t += dt;
    if (this.t >= this.rate) {
      this.t -= this.rate;
      return dir;
    }
    return 0;
  }

  reset(): void {
    this.dir = 0;
    this.t = 0;
  }
}

/** Turns held directions + buttons into a Nav with key repeat and button edges. */
export class NavRepeater {
  private rx: KeyRepeat;
  private ry: KeyRepeat;
  private prev = { a: false, b: false, x: false, y: false };

  constructor(delay?: number, rate?: number) {
    this.rx = new KeyRepeat(delay, rate);
    this.ry = new KeyRepeat(delay, rate);
  }

  update(h: HeldNav, dt: number): Nav {
    const p = this.prev;
    const nav: Nav = {
      dx: this.rx.update(h.x, dt),
      dy: this.ry.update(h.y, dt),
      a: h.a && !p.a,
      b: h.b && !p.b,
      x: !!h.bx && !p.x,
      y: !!h.by && !p.y,
    };
    this.prev = { a: h.a, b: h.b, x: !!h.bx, y: !!h.by };
    return nav;
  }
}

/**
 * Mouse targets registered while drawing (ids like "row:3", "dec:1"); the next update hit-tests the pointer
 * against them, topmost (last added) first. Hover / click then always match what was on screen.
 */
export class HitList {
  private hits: { id: string; r: Rect }[] = [];

  clear(): void {
    this.hits = [];
  }

  add(id: string, r: Rect): void {
    this.hits.push({ id, r });
  }

  at(x: number, y: number): string {
    for (let k = this.hits.length - 1; k >= 0; k--) if (containsPoint(this.hits[k].r, x, y)) return this.hits[k].id;
    return "";
  }
}

/** Mouse state in layout units for a frame. */
export interface Pointer {
  x: number;
  y: number;
  moved: boolean;
  click: boolean;
}
