// Cameras. Two kinds, both presentation-only (the sim never reads them):
// - Arena framing (Grudge): a pitched perspective camera described by a ground focus point and the world width
//   visible across the screen there. frameTargets() fits N targets with a margin, clamps the width to
//   [minWidth, maxWidth] and the map, and clamps the focus so the view doesn't drift far off the map edges;
//   ArenaCamera eases toward that and optionally nudges until "keep" points project inside a safe box.
// - Locked follow (QUICKLORE): the target is locked to a fixed whole-pixel spot (no spring), and only a lean in a
//   *steady* movement direction eases in, in whole pixels. A spring + velocity lookahead + pixel rounding jitters
//   (it corrects by a pixel back and forth, and drifts after stopping); this doesn't. Stepped once per sim tick.
import * as THREE from "three";

export interface CameraRig {
  /** Degrees the camera looks down from horizontal. */
  pitchDeg: number;
  /** Vertical field of view in degrees (also set on the camera by placeCamera). */
  fovDeg: number;
  /** The look point sits this fraction of the width "up-screen" of the focus (Grudge: 0.06). */
  lookAhead?: number;
}

export interface Bounds2 {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

const DEG = Math.PI / 180;

/** World depth (along the view's ground direction) one unit of screen width covers, scaled by `fudge`. */
export function depthToWidth(aspect: number, pitchDeg: number, fudge = 1.25): number {
  return (aspect / Math.sin(pitchDeg * DEG)) * fudge;
}

/** Distance at which `width` world units span the screen horizontally. */
export function distanceForWidth(width: number, fovDeg: number, aspect: number): number {
  const hHalf = Math.atan(Math.tan((fovDeg * DEG) / 2) * aspect);
  return width / (2 * Math.tan(hHalf));
}

/**
 * Places `cam` so `width` units span the screen at `focus`, looking down at rig.pitchDeg, turned `yaw` about the
 * focus (0 = looking toward -Z). Returns the camera distance.
 */
export function placeCamera(
  cam: THREE.PerspectiveCamera,
  rig: CameraRig,
  focus: THREE.Vector3,
  width: number,
  yaw = 0,
): number {
  if (cam.fov !== rig.fovDeg) {
    cam.fov = rig.fovDeg;
    cam.updateProjectionMatrix();
  }
  const pitch = rig.pitchDeg * DEG;
  const dist = distanceForWidth(width, rig.fovDeg, cam.aspect);
  const sy = Math.sin(yaw);
  const cy = Math.cos(yaw);
  const ahead = width * (rig.lookAhead ?? 0.06);
  const lx = focus.x - sy * ahead;
  const lz = focus.z - cy * ahead;
  const back = Math.cos(pitch) * dist;
  cam.position.set(lx + sy * back, focus.y + Math.sin(pitch) * dist, lz + cy * back);
  cam.lookAt(lx, focus.y, lz);
  cam.updateMatrixWorld(true);
  return dist;
}

export interface FrameOptions {
  aspect: number;
  pitchDeg: number;
  /** Added to the targets' extent (world units). */
  margin: number;
  minWidth: number;
  maxWidth?: number;
  /** The playable area. Without it the width and focus are not clamped to a map. */
  bounds?: Bounds2;
  /** The widest view is the whole map times this, plus `fullPad` (Grudge: 1.3 and 12). */
  fullFactor?: number;
  fullPad?: number;
}

export interface Framing {
  x: number;
  z: number;
  width: number;
}

/**
 * Fits points (x/z on the ground): width covers their bounding box (depth converted to width by the pitch and
 * aspect) plus the margin, clamped to [minWidth, maxWidth] and to the map; the focus is the box centre clamped so
 * at most a little slack shows beyond the map edges (centred when the view is wider than the map). Pure.
 */
export function frameTargets(points: readonly { x: number; z: number }[], o: FrameOptions): Framing {
  const b = o.bounds;
  let x0 = Infinity;
  let z0 = Infinity;
  let x1 = -Infinity;
  let z1 = -Infinity;
  for (const p of points) {
    x0 = Math.min(x0, p.x);
    z0 = Math.min(z0, p.z);
    x1 = Math.max(x1, p.x);
    z1 = Math.max(z1, p.z);
  }
  if (!points.length) {
    const cx = b ? (b.x0 + b.x1) / 2 : 0;
    const cz = b ? (b.z0 + b.z1) / 2 : 0;
    x0 = x1 = cx;
    z0 = z1 = cz;
  }
  const d2w = depthToWidth(o.aspect, o.pitchDeg);
  const need = Math.max(x1 - x0, (z1 - z0) * d2w) + o.margin;
  let lo = o.minWidth;
  let hi = o.maxWidth ?? Infinity;
  if (b) {
    const bw = b.x1 - b.x0;
    const bd = b.z1 - b.z0;
    const full = Math.max(bw, bd * d2w) * (o.fullFactor ?? 1.3) + (o.fullPad ?? 12);
    lo = Math.min(lo, full);
    hi = Math.min(hi, full);
  }
  const width = Math.min(Math.max(need, lo), Math.max(lo, hi));
  let x = (x0 + x1) / 2;
  let z = (z0 + z1) / 2;
  if (b) {
    const bw = b.x1 - b.x0;
    const bd = b.z1 - b.z0;
    const slack = 6 + width * 0.15;
    x = width < bw + slack * 2 ? clamp(x, b.x0 + width / 2 - slack, b.x1 - width / 2 + slack) : (b.x0 + b.x1) / 2;
    const depth = width / d2w;
    const zs = 4 + depth * 0.15;
    z = depth < bd + zs * 2 ? clamp(z, b.z0 + depth / 2 - zs, b.z1 - depth / 2 + zs) : (b.z0 + b.z1) / 2;
  }
  return { x, z, width };
}

const clamp = (v: number, lo: number, hi: number) => (lo > hi ? (lo + hi) / 2 : Math.max(lo, Math.min(hi, v)));

/** Exponential ease factor for a rate (1/s) over dt seconds. */
export const easeK = (rate: number, dt: number) => 1 - Math.exp(-Math.max(0, dt) * rate);

export interface ArenaCameraOptions extends Omit<FrameOptions, "aspect" | "pitchDeg"> {
  rig: CameraRig;
  /** Ease rate (1/s) toward the framing (Grudge: 4). */
  rate?: number;
  /** Screen-space safe box (NDC x0, x1, y0, y1) that `keep` points must project into. */
  safe?: [number, number, number, number];
  /** Height added to keep points before projecting (their heads, not their feet). */
  keepHeight?: number;
}

/** Grudge's shared match camera: frames every target, eases there, and keeps important points on screen. */
export class ArenaCamera {
  readonly focus = new THREE.Vector3();
  width = 0;
  yaw = 0;
  private init = false;
  private v = new THREE.Vector3();

  constructor(
    readonly cam: THREE.PerspectiveCamera,
    readonly opts: ArenaCameraOptions,
  ) {}

  /** Jump straight to the framing on the next update. */
  snap(): void {
    this.init = false;
  }

  update(points: readonly THREE.Vector3[], dt: number, keep: readonly THREE.Vector3[] = points): void {
    const o = this.opts;
    const f = frameTargets(points, { ...o, aspect: this.cam.aspect, pitchDeg: o.rig.pitchDeg });
    const want = this.v.set(f.x, points.length ? avgY(points) : 0, f.z).clone();
    if (keep.length) this.keepInView(want, f.width, keep);
    const k = this.init ? easeK(o.rate ?? 4, dt) : 1;
    this.init = true;
    this.focus.lerp(want, k);
    this.width += (f.width - this.width) * k;
    placeCamera(this.cam, o.rig, this.focus, this.width, this.yaw);
  }

  /** Nudges `focus` (up to 4 iterations) until every keep point projects inside the safe box. */
  private keepInView(focus: THREE.Vector3, width: number, keep: readonly THREE.Vector3[]): void {
    const o = this.opts;
    const [X0, X1, Y0, Y1] = o.safe ?? [-0.8, 0.8, -0.66, 0.5];
    const d2w = depthToWidth(this.cam.aspect, o.rig.pitchDeg);
    const p = new THREE.Vector3();
    const yaw = this.yaw;
    for (let it = 0; it < 4; it++) {
      placeCamera(this.cam, o.rig, focus, width, yaw);
      let dx = 0;
      let dy = 0;
      for (const k of keep) {
        p.set(k.x, k.y + (o.keepHeight ?? 1.5), k.z).project(this.cam);
        if (p.x < X0) dx = Math.min(dx, p.x - X0);
        if (p.x > X1) dx = Math.max(dx, p.x - X1);
        if (p.y < Y0) dy = Math.min(dy, p.y - Y0);
        if (p.y > Y1) dy = Math.max(dy, p.y - Y1);
      }
      if (!dx && !dy) return;
      const sx = dx * width * 0.55;
      const sz = dy * (width / d2w) * 0.6;
      focus.x += Math.cos(yaw) * sx - Math.sin(yaw) * sz;
      focus.z += -Math.sin(yaw) * sx - Math.cos(yaw) * sz;
    }
  }
}

function avgY(points: readonly THREE.Vector3[]): number {
  let s = 0;
  for (const p of points) s += p.y;
  return s / points.length;
}

// ── Locked follow ──

export interface FollowBounds {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface FollowTarget {
  /** Position in the camera's units (pixels, or world units times pixels-per-unit). */
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Whether the target is deliberately moving (walking); the lean only follows deliberate movement. */
  moving: boolean;
  /** Its current top speed, so "a clear direction" is relative (default 1). */
  speed?: number;
}

export interface LockedFollowOptions {
  /** Maximum lean (units) toward the walking direction, per axis. */
  leanX?: number;
  leanY?: number;
  /** Lean easing per tick (0.08 settles in about 0.4 s at 60 Hz). */
  leanRate?: number;
  /** Pan speed per tick when the clamped target jumps (entering a new room). */
  pan?: number;
  /** A jump farther than this cuts instead of panning (warps, respawns). */
  cut?: number;
  /** Constant offset of the target from the view centre (e.g. -4 to show more above). */
  offsetX?: number;
  offsetY?: number;
  /** More ticks than this since the last update snaps (pause, tab switch). */
  maxSteps?: number;
}

/** Centres a span of `size` in [lo, hi] when it is wider than the area, else clamps its start. */
export function clampAxis(v: number, lo: number, hi: number, size: number): number {
  if (hi - lo <= size) return lo + (hi - lo - size) / 2;
  return Math.max(lo, Math.min(hi - size, v));
}

export class LockedFollowCam {
  /** Top-left of the view. */
  x = 0;
  y = 0;
  /** Integer top-left to draw with. */
  ix = 0;
  iy = 0;
  private lx = 0;
  private ly = 0;
  private dirX = 0;
  private dirY = 0;
  private tick = -1;
  private key: unknown = undefined;
  private readonly o: Required<LockedFollowOptions>;

  constructor(
    readonly vw: number,
    readonly vh: number,
    opts: LockedFollowOptions = {},
  ) {
    this.o = {
      leanX: 24,
      leanY: 14,
      leanRate: 0.08,
      pan: 6,
      cut: 160,
      offsetX: 0,
      offsetY: -4,
      maxSteps: 30,
      ...opts,
    };
  }

  /**
   * Advance to sim tick `tick` (steps once per elapsed tick). `bounds` limits the view (null = unbounded); `key`
   * identifies who/where is followed: a change snaps (new target, new map).
   */
  update(tick: number, t: FollowTarget, bounds: FollowBounds | null, key?: unknown): void {
    const steps = tick - this.tick;
    const [wx, wy] = this.target(t, bounds);
    const jump = Math.abs(wx - this.x) > this.o.cut || Math.abs(wy - this.y) > this.o.cut;
    if (key !== this.key || this.tick < 0 || steps < 0 || steps > this.o.maxSteps || jump) this.snap(t, bounds, key);
    else for (let i = 0; i < steps; i++) this.step(t, bounds);
    this.tick = tick;
    this.ix = Math.round(this.x);
    this.iy = Math.round(this.y);
  }

  snap(t: FollowTarget, bounds: FollowBounds | null, key?: unknown): void {
    this.key = key;
    this.lx = this.ly = 0;
    this.dirX = this.dirY = 0;
    [this.x, this.y] = this.target(t, bounds);
  }

  /** Current lean (units), for debugging. */
  get lean(): [number, number] {
    return [this.lx, this.ly];
  }

  /** Whether a point is in (or within `margin` of) the view. */
  sees(x: number, y: number, margin = 16): boolean {
    return (
      x > this.ix - margin && x < this.ix + this.vw + margin && y > this.iy - margin && y < this.iy + this.vh + margin
    );
  }

  /** The target's rounded position plus the whole-unit lean, clamped. */
  private target(t: FollowTarget, b: FollowBounds | null): [number, number] {
    const x = Math.round(t.x) + Math.round(this.lx) + this.o.offsetX - this.vw / 2;
    const y = Math.round(t.y) + Math.round(this.ly) + this.o.offsetY - this.vh / 2;
    if (!b) return [x, y];
    return [clampAxis(x, b.x0, b.x1, this.vw), clampAxis(y, b.y0, b.y1, this.vh)];
  }

  private step(t: FollowTarget, b: FollowBounds | null): void {
    const o = this.o;
    const sp = Math.max(1e-6, t.speed ?? 1);
    // Lean only toward a clear direction; small velocity wobbles (accel, wall slides) keep the last one.
    const ax = t.moving && Math.abs(t.vx) > sp * 0.5 ? Math.sign(t.vx) : t.moving ? this.dirX : 0;
    const ay = t.moving && Math.abs(t.vy) > sp * 0.5 ? Math.sign(t.vy) : t.moving ? this.dirY : 0;
    this.dirX = ax;
    this.dirY = ay;
    this.lx += (ax * o.leanX - this.lx) * o.leanRate;
    this.ly += (ay * o.leanY - this.ly) * o.leanRate;
    if (Math.abs(this.lx - ax * o.leanX) < 0.3) this.lx = ax * o.leanX;
    if (Math.abs(this.ly - ay * o.leanY) < 0.3) this.ly = ay * o.leanY;
    const [tx, ty] = this.target(t, b);
    // Locked to the target, except a big clamp change pans over at `pan` per tick.
    this.x = Math.abs(tx - this.x) > o.pan * 2 ? this.x + Math.sign(tx - this.x) * o.pan : tx;
    this.y = Math.abs(ty - this.y) > o.pan * 2 ? this.y + Math.sign(ty - this.y) * o.pan : ty;
  }
}
