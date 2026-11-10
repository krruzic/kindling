// Client-side fixed-step driver: turns variable frame times into whole sim ticks with an accumulator, as Grudge's
// frame loop did (src/app/loop.ts + match.ts stepWorld).
//   - A frame longer than `maxFrame` is clamped (a hitch is dropped, not simulated).
//   - At most `maxSteps` ticks per frame; if still behind after that, the backlog is dropped instead of spiralling
//     (a backgrounded tab returning must not freeze the page catching up).
//   - `alpha` is how far between the last two ticks the frame is, for render interpolation.
//   - `hitstop(seconds)` freezes the sim for that much wall time (hit feedback); `paused` stops it entirely.
//   - `step` may return false (e.g. an online guest with no frame from the host yet): the loop stops for this frame
//     and keeps at most one tick of backlog.
// `animationFrames` is a tiny requestAnimationFrame wrapper that hands out clamped frame seconds.
// `FrameSnap` (used by FixedLoop) snaps frame times that are within a hair of a whole number of display refreshes
// (1/4, 1/3, 1/2, 1 or 2 ticks), so a steady 60 or 120 Hz display steps the sim evenly instead of 0 / 2 / 1 / 1:
// with a plain `acc >= dt`, vsync timestamps that wobble by fractions of a millisecond flip a tick from one frame
// to the next whenever the carried remainder sits near a tick boundary (visible stutter). The time it shaves or
// adds is kept as a debt and paid back once it reaches a tick, so the sim never drifts from the wall clock.

export interface FixedLoopOptions {
  /** Seconds per tick. */
  dt: number;
  /** Run one tick. Return false if the tick could not run (nothing to step on). */
  step: () => boolean | void;
  /** Most ticks per frame (default 5). */
  maxSteps?: number;
  /** Longest frame time in seconds that is simulated (default 0.25). */
  maxFrame?: number;
  /** Snap frame times near whole display refreshes (FrameSnap; default true). */
  snap?: boolean;
}

/** Snaps frame times to whole fractions / multiples of a tick when they're within `tol` of one (see above). */
export class FrameSnap {
  /** Wall time not yet passed on (real minus snapped), paid back once it reaches a tick. */
  debt = 0;
  constructor(
    readonly tick: number,
    /** How close counts, as a fraction of a tick (default 0.06: 1 ms at 60 Hz). */
    readonly tol = 0.06,
  ) {}

  snap(dt: number): number {
    let out = dt;
    for (const k of [0.25, 1 / 3, 0.5, 1, 2])
      if (Math.abs(dt - this.tick * k) < this.tick * this.tol) {
        out = this.tick * k;
        break;
      }
    this.debt += dt - out;
    if (Math.abs(this.debt) >= this.tick) {
      out += this.debt;
      this.debt = 0;
    }
    return Math.max(0, out);
  }
}

export class FixedLoop {
  readonly dt: number;
  maxSteps: number;
  maxFrame: number;
  /** Unsimulated seconds carried to the next frame. */
  acc = 0;
  /** Seconds of hitstop left. */
  stopLeft = 0;
  paused = false;
  /** Wall-to-sim speed (slow motion < 1); 1 for anything networked. */
  timeScale = 1;
  /** Ticks run by the last advance(). */
  lastSteps = 0;
  /** Frames that hit maxSteps and dropped backlog (show it in a perf overlay). */
  dropped = 0;
  private readonly stepFn: () => boolean | void;
  private readonly snapper: FrameSnap | null;

  constructor(opts: FixedLoopOptions) {
    this.dt = opts.dt;
    this.snapper = opts.snap === false ? null : new FrameSnap(opts.dt);
    this.stepFn = opts.step;
    this.maxSteps = opts.maxSteps ?? 5;
    this.maxFrame = opts.maxFrame ?? 0.25;
  }

  /** Feed one frame's elapsed wall seconds; runs the due ticks and returns how many ran. */
  advance(frameSeconds: number): number {
    this.lastSteps = 0;
    if (this.paused) return 0;
    const raw = Math.min(this.maxFrame, Math.max(0, frameSeconds));
    let t = (this.snapper && this.timeScale === 1 ? this.snapper.snap(raw) : raw) * this.timeScale;
    if (this.stopLeft > 0) {
      const used = Math.min(this.stopLeft, t);
      this.stopLeft -= used;
      t -= used;
    }
    this.acc += t;
    let n = 0;
    while (this.acc >= this.dt && n < this.maxSteps) {
      if (this.stepFn() === false) {
        this.acc = Math.min(this.acc, this.dt);
        break;
      }
      this.acc -= this.dt;
      n++;
    }
    if (n === this.maxSteps && this.acc >= this.dt) {
      this.acc = 0;
      this.dropped++;
    }
    this.lastSteps = n;
    return n;
  }

  /** Render interpolation factor in [0, 1]: 0 while paused or in hitstop. */
  get alpha(): number {
    if (this.paused || this.stopLeft > 0) return 0;
    return Math.min(1, this.acc / this.dt);
  }

  /** Freeze the sim for `seconds` of wall time (the longer of the current and the new hitstop wins). */
  hitstop(seconds: number): void {
    this.stopLeft = Math.max(this.stopLeft, seconds);
  }

  reset(): void {
    this.acc = 0;
    this.stopLeft = 0;
    this.lastSteps = 0;
  }
}

/**
 * Calls `frame(dt, now)` every animation frame with dt in seconds (clamped to `maxDt`) and now in seconds since the
 * page loaded. Returns a stop function. Browser only.
 */
export function animationFrames(frame: (dt: number, now: number) => void, maxDt = 0.25): () => void {
  let last = -1;
  let id = 0;
  let stopped = false;
  const tick = (ms: number): void => {
    if (stopped) return;
    const dt = last < 0 ? 0 : Math.min(maxDt, Math.max(0, (ms - last) / 1000));
    last = ms;
    frame(dt, ms / 1000);
    id = requestAnimationFrame(tick);
  };
  id = requestAnimationFrame(tick);
  return () => {
    stopped = true;
    cancelAnimationFrame(id);
  };
}
