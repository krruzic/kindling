// Frame-time snapping for the lockstep pacers (the same as @kindling/core's FrameSnap; net doesn't depend on core):
// a frame time within a hair of a whole number of display refreshes (1/4, 1/3, 1/2, 1 or 2 ticks) counts as exactly
// that, so a steady 60 or 120 Hz display steps evenly instead of 0 / 2 / 1 / 1 when vsync timestamps wobble by
// fractions of a millisecond; what it shaves or adds is kept as a debt and paid back once it reaches a tick.
export class FrameSnap {
  debt = 0;
  constructor(
    readonly tick: number,
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
