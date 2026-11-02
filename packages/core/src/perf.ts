// Perf overlay core (the `?perf` overlay from Grudge's src/perf.ts without the DOM or WebGL coupling): a ring buffer
// of frame times with percentiles, plus per-section CPU timers and counters averaged over a reporting window.
// Timing is injected (`now`), so it runs anywhere; `drawPerf` is an optional canvas painter for the snapshot.
// When disabled every call is a cheap no-op, so the calls can stay in the frame loop.

/** Fixed-size ring of numbers (frame ms) with percentile queries over what it holds. */
export class Ring {
  private readonly buf: Float64Array;
  private at = 0;
  count = 0;

  constructor(readonly size: number) {
    this.buf = new Float64Array(size);
  }

  push(v: number): void {
    this.buf[this.at] = v;
    this.at = (this.at + 1) % this.size;
    if (this.count < this.size) this.count++;
  }

  /** Oldest first. */
  values(): number[] {
    const out: number[] = [];
    const start = this.count < this.size ? 0 : this.at;
    for (let i = 0; i < this.count; i++) out.push(this.buf[(start + i) % this.size]);
    return out;
  }

  last(): number {
    return this.count ? this.buf[(this.at - 1 + this.size) % this.size] : NaN;
  }

  mean(): number {
    if (!this.count) return NaN;
    let s = 0;
    for (let i = 0; i < this.count; i++) s += this.buf[i];
    return s / this.count;
  }

  max(): number {
    let m = -Infinity;
    for (let i = 0; i < this.count; i++) m = Math.max(m, this.buf[i]);
    return this.count ? m : NaN;
  }

  /** p in 0..100 (nearest rank). */
  percentile(p: number): number {
    if (!this.count) return NaN;
    const s = Array.from(this.buf.subarray(0, this.count)).sort((a, b) => a - b);
    const i = Math.min(this.count - 1, Math.max(0, Math.ceil((p / 100) * this.count) - 1));
    return s[i];
  }

  clear(): void {
    this.at = 0;
    this.count = 0;
  }
}

export interface PerfOptions {
  enabled?: boolean;
  /** Milliseconds clock (performance.now in browsers). */
  now?: () => number;
  /** Frames kept for percentiles (default 240). */
  frames?: number;
  /** Snapshot window in ms (default 1000). */
  windowMs?: number;
  /** A frame whose JS took longer than this (ms) is recorded as a spike with its sections (default 14). */
  spikeMs?: number;
}

export type PerfSnapshot = Record<string, number>;

export class PerfMeter {
  enabled: boolean;
  readonly frameMs: Ring;
  readonly gapMs: Ring;
  snapshot: PerfSnapshot = {};
  /** Recent spike frames: their sections and gap (newest last, at most 300). */
  readonly spikes: PerfSnapshot[] = [];
  private readonly clock: () => number;
  private readonly windowMs: number;
  private readonly spikeMs: number;
  private readonly cpuMs = new Map<string, number>();
  private readonly stats = new Map<string, number>();
  private readonly sums = new Map<string, number>();
  private frames = 0;
  private lastShow = 0;
  private lastFrame = 0;
  private frameStart = 0;

  constructor(opts: PerfOptions = {}) {
    this.enabled = opts.enabled ?? true;
    this.clock = opts.now ?? (() => (globalThis.performance ? performance.now() : Date.now()));
    this.frameMs = new Ring(opts.frames ?? 240);
    this.gapMs = new Ring(opts.frames ?? 240);
    this.windowMs = opts.windowMs ?? 1000;
    this.spikeMs = opts.spikeMs ?? 14;
  }

  now(): number {
    return this.enabled ? this.clock() : 0;
  }

  /** Mark the start of a frame's JS. */
  begin(): number {
    if (!this.enabled) return 0;
    return (this.frameStart = this.clock());
  }

  /** Add the time since `t0` to section `key`; returns the current time to chain sections. */
  cpu(key: string, t0: number): number {
    if (!this.enabled) return 0;
    const t = this.clock();
    this.cpuMs.set(key, (this.cpuMs.get(key) ?? 0) + (t - t0));
    return t;
  }

  /** Add to a per-frame counter (draw calls, ticks, repaints). */
  stat(key: string, v = 1): void {
    if (this.enabled) this.stats.set(key, (this.stats.get(key) ?? 0) + v);
  }

  /** End the frame: records frame time and gap, spikes, and rolls the snapshot once per window. */
  end(): void {
    if (!this.enabled) return;
    const t = this.clock();
    const ms = t - this.frameStart;
    const gap = this.lastFrame ? t - this.lastFrame : 0;
    this.lastFrame = t;
    this.frameMs.push(ms);
    if (gap) this.gapMs.push(gap);
    if (ms > this.spikeMs || gap > this.spikeMs * 2) {
      const sp: PerfSnapshot = { ms, gap };
      for (const [k, v] of this.cpuMs) if (v > 0.5) sp["cpu." + k] = +v.toFixed(2);
      for (const [k, v] of this.stats) sp[k] = v;
      this.spikes.push(sp);
      if (this.spikes.length > 300) this.spikes.shift();
    }
    for (const [k, v] of this.cpuMs) this.sums.set("cpu." + k, (this.sums.get("cpu." + k) ?? 0) + v);
    for (const [k, v] of this.stats) this.sums.set(k, (this.sums.get(k) ?? 0) + v);
    this.cpuMs.clear();
    this.stats.clear();
    this.frames++;
    if (!this.lastShow) this.lastShow = this.frameStart || t;
    if (t - this.lastShow < this.windowMs) return;
    const out: PerfSnapshot = {
      fps: (this.frames * 1000) / (t - this.lastShow),
      "frame.p50": this.frameMs.percentile(50),
      "frame.p95": this.frameMs.percentile(95),
      "frame.p99": this.frameMs.percentile(99),
      "frame.max": this.frameMs.max(),
      "gap.p95": this.gapMs.percentile(95),
    };
    for (const [k, v] of this.sums) out[k] = v / this.frames;
    this.snapshot = out;
    this.sums.clear();
    this.frames = 0;
    this.lastShow = t;
  }

  /** The snapshot as aligned "key value" lines. */
  lines(): string[] {
    return Object.entries(this.snapshot).map(([k, v]) => `${k.padEnd(18)} ${Number.isFinite(v) ? v.toFixed(2) : "-"}`);
  }
}

/** Paint the meter's snapshot in a corner of a 2D canvas (monospace on a dark box). */
export function drawPerf(ctx: CanvasRenderingContext2D, meter: PerfMeter, x = 4, y = 4, font = "11px monospace"): void {
  const lines = meter.lines();
  if (!lines.length) return;
  ctx.save();
  ctx.font = font;
  const lh = Math.ceil(parseInt(font, 10) * 1.25) || 14;
  const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 12;
  ctx.fillStyle = "rgba(0,0,0,0.7)";
  ctx.fillRect(x, y, w, lines.length * lh + 8);
  ctx.fillStyle = "#cfe";
  ctx.textBaseline = "top";
  lines.forEach((l, i) => ctx.fillText(l, x + 6, y + 4 + i * lh));
  ctx.restore();
}
