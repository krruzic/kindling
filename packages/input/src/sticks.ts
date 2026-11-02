// Stick helpers shared by every game: radial / axial deadzones, a 4-way direction, C-stick flick detection
// (fires once per flick, re-arms near centre), smash detection (rest -> near full within a short window) and a
// tap-vs-hold timer for charge buttons. All take explicit `now` seconds, so they are deterministic and testable.

export type Dir4 = "up" | "down" | "left" | "right";

/** Radial deadzone rescaled so output starts at 0 just past the deadzone and reaches 1 at full tilt. */
export function radialDeadzone(x: number, y: number, dz: number): [number, number] {
  const m = Math.hypot(x, y);
  if (m < dz || m === 0) return [0, 0];
  const scaled = Math.min(1, (m - dz) / (1 - dz));
  return [(x / m) * scaled, (y / m) * scaled];
}

/** Per-axis deadzone (rescaled), for menus and d-pad-like reads where diagonals shouldn't leak. */
export function axialDeadzone(v: number, dz: number): number {
  const a = Math.abs(v);
  if (a < dz) return 0;
  return Math.sign(v) * Math.min(1, (a - dz) / (1 - dz));
}

/** Dominant 4-way direction of (x, y) (y down = "down"), or null inside `threshold`. */
export function dir4(x: number, y: number, threshold = 0.5): Dir4 | null {
  if (Math.max(Math.abs(x), Math.abs(y)) < threshold) return null;
  if (Math.abs(x) > Math.abs(y)) return x > 0 ? "right" : "left";
  return y > 0 ? "down" : "up";
}

/** A stick flick: fires once when the stick passes `threshold`, re-arms once it is back under `rearm`. */
export class FlickDetector {
  private armed = true;

  constructor(
    public threshold = 0.7,
    public rearm = 0.35,
  ) {}

  update(x: number, y: number): Dir4 | null {
    const m = Math.hypot(x, y);
    if (m < this.rearm) {
      this.armed = true;
      return null;
    }
    if (!this.armed || m < this.threshold) return null;
    this.armed = false;
    if (Math.abs(x) > Math.abs(y)) return x > 0 ? "right" : "left";
    return y > 0 ? "down" : "up";
  }
}

/** Smash input: the stick goes from under `from` to over `to` within `within` seconds (a smash-dodge). */
export class SmashDetector {
  private restAt = -1e9;
  private armed = true;

  constructor(
    public from = 0.3,
    public to = 0.85,
    public within = 0.12,
  ) {}

  update(x: number, y: number, now: number): boolean {
    const m = Math.hypot(x, y);
    if (m < this.from) {
      this.restAt = now;
      this.armed = true;
      return false;
    }
    if (m >= this.to && this.armed) {
      this.armed = false;
      return now - this.restAt <= this.within;
    }
    return false;
  }
}

export interface TapHoldResult {
  /** Released this frame. */
  released: boolean;
  /** Released before `tap` seconds. */
  tap: boolean;
  /** Held past `tap`: charge 0..1 over `full` seconds (also set on the release frame). */
  charge: number;
  charging: boolean;
}

/** Tap vs hold-to-charge for one button. Feed held each frame. */
export class TapHold {
  private downAt = -1;

  constructor(
    public tap = 0.2,
    public full = 0.8,
  ) {}

  update(held: boolean, now: number): TapHoldResult {
    const out: TapHoldResult = { released: false, tap: false, charge: 0, charging: false };
    if (held && this.downAt < 0) this.downAt = now;
    if (this.downAt < 0) return out;
    const t = now - this.downAt;
    const charge = t > this.tap ? Math.min(1, (t - this.tap) / this.full) : 0;
    if (held) {
      out.charging = t > this.tap;
      out.charge = charge;
      return out;
    }
    this.downAt = -1;
    out.released = true;
    out.tap = t <= this.tap;
    out.charge = charge;
    return out;
  }
}
