// Render stats for a `?perf` overlay: draw calls / triangles / points summed over every render() of a frame
// (renderer.info.autoReset is turned off), CPU frame ms with p90, and GPU ms per labelled section through
// EXT_disjoint_timer_query_webgl2 when the browser exposes it (results arrive a frame or two late and are
// dropped on a disjoint event). PerfOverlay prints a snapshot once a second in a corner <pre> (debug only; game UI
// belongs on the canvas).
import type * as THREE from "three";

interface TimerExt {
  TIME_ELAPSED_EXT: number;
  GPU_DISJOINT_EXT: number;
}

/** GPU timing with EXT_disjoint_timer_query_webgl2; every method is a no-op when unsupported. */
export class GpuTimer {
  readonly supported: boolean;
  private ext: TimerExt | null;
  private free: WebGLQuery[] = [];
  private pending: { q: WebGLQuery; key: string; frame: number }[] = [];
  private active: WebGLQuery | null = null;
  private frameNo = 0;
  private sums = new Map<string, number>();

  constructor(private gl: WebGL2RenderingContext) {
    this.ext = (gl.getExtension?.("EXT_disjoint_timer_query_webgl2") as TimerExt | null) ?? null;
    this.supported = !!this.ext;
  }

  begin(key: string): void {
    if (!this.ext || this.active) return;
    const q = this.free.pop() ?? this.gl.createQuery();
    if (!q) return;
    this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, q);
    this.active = q;
    this.pending.push({ q, key, frame: this.frameNo });
  }

  end(): void {
    if (!this.ext || !this.active) return;
    this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    this.active = null;
  }

  /** Call once per frame: collects finished queries into the per-key sums. */
  poll(): void {
    this.frameNo++;
    if (!this.ext) return;
    const gl = this.gl;
    const disjoint = gl.getParameter(this.ext.GPU_DISJOINT_EXT);
    const keep: typeof this.pending = [];
    for (const p of this.pending) {
      if (p.frame >= this.frameNo - 1 || !gl.getQueryParameter(p.q, gl.QUERY_RESULT_AVAILABLE)) {
        keep.push(p);
        continue;
      }
      if (!disjoint)
        this.sums.set(p.key, (this.sums.get(p.key) ?? 0) + gl.getQueryParameter(p.q, gl.QUERY_RESULT) / 1e6);
      this.free.push(p.q);
    }
    this.pending = keep;
  }

  /** Summed GPU ms per key since the last take(), and resets. */
  take(): Map<string, number> {
    const out = this.sums;
    this.sums = new Map();
    return out;
  }
}

export interface StatsSnapshot {
  fps: number;
  frameMs: number;
  frameP90: number;
  frameMax: number;
  calls: number;
  triangles: number;
  points: number;
  lines: number;
  /** GPU ms per frame per key (empty without the timer extension). */
  gpu: Record<string, number>;
  programs: number;
  textures: number;
  geometries: number;
  /** Custom counters (stat()), averaged per frame. */
  stats: Record<string, number>;
}

/** Collects per-frame stats and averages them over `periodMs`. */
export class RenderStats {
  readonly gpu: GpuTimer;
  snapshot: StatsSnapshot | null = null;
  private frames = 0;
  private sum = { calls: 0, triangles: 0, points: 0, lines: 0 };
  private custom = new Map<string, number>();
  private times: number[] = [];
  private t0 = -1;
  private last = -1;

  constructor(
    readonly renderer: THREE.WebGLRenderer,
    private periodMs = 1000,
  ) {
    renderer.info.autoReset = false;
    this.gpu = new GpuTimer(renderer.getContext() as WebGL2RenderingContext);
  }

  /** Adds to a custom counter for this frame. */
  stat(key: string, v = 1): void {
    this.custom.set(key, (this.custom.get(key) ?? 0) + v);
  }

  /** Call once at the end of each frame with the current time (ms). Returns a new snapshot once per period. */
  frame(now: number): StatsSnapshot | null {
    const info = this.renderer.info;
    this.sum.calls += info.render.calls;
    this.sum.triangles += info.render.triangles;
    this.sum.points += info.render.points;
    this.sum.lines += info.render.lines;
    info.reset();
    this.gpu.poll();
    if (this.last >= 0) this.times.push(now - this.last);
    this.last = now;
    if (this.t0 < 0) this.t0 = now;
    this.frames++;
    if (now - this.t0 < this.periodMs) return null;
    const n = this.frames;
    const sorted = [...this.times].sort((a, b) => a - b);
    const gpu: Record<string, number> = {};
    for (const [k, v] of this.gpu.take()) gpu[k] = v / n;
    const stats: Record<string, number> = {};
    for (const [k, v] of this.custom) stats[k] = v / n;
    this.snapshot = {
      fps: (n * 1000) / (now - this.t0),
      frameMs: (now - this.t0) / n,
      frameP90: sorted.length ? sorted[Math.floor(sorted.length * 0.9)] : 0,
      frameMax: sorted.length ? sorted[sorted.length - 1] : 0,
      calls: this.sum.calls / n,
      triangles: this.sum.triangles / n,
      points: this.sum.points / n,
      lines: this.sum.lines / n,
      gpu,
      programs: info.programs?.length ?? 0,
      textures: info.memory.textures,
      geometries: info.memory.geometries,
      stats,
    };
    this.frames = 0;
    this.sum = { calls: 0, triangles: 0, points: 0, lines: 0 };
    this.custom.clear();
    this.times = [];
    this.t0 = now;
    return this.snapshot;
  }
}

/** Formats a snapshot as aligned "key value" lines. */
export function formatStats(s: StatsSnapshot, extra: Record<string, number | string> = {}): string {
  const rows: [string, number | string][] = [
    ["fps", s.fps],
    ["frame ms", s.frameMs],
    ["frame p90", s.frameP90],
    ["frame max", s.frameMax],
    ["draw calls", s.calls],
    ["triangles", s.triangles],
    ["points", s.points],
    ...Object.entries(s.gpu).map(([k, v]) => [`gpu ${k}`, v] as [string, number]),
    ["programs", s.programs],
    ["textures", s.textures],
    ["geometries", s.geometries],
    ...Object.entries(s.stats),
    ...Object.entries(extra),
  ];
  return rows.map(([k, v]) => `${k.padEnd(14)} ${typeof v === "number" ? v.toFixed(2) : v}`).join("\n");
}

/** A fixed corner <pre> showing the latest snapshot; the snapshot is also mirrored on window[globalName]. */
export class PerfOverlay {
  readonly el: HTMLPreElement;

  constructor(
    parent: HTMLElement = document.body,
    private globalName = "kindlingPerf",
  ) {
    this.el = document.createElement("pre");
    this.el.style.cssText =
      "position:fixed;left:4px;top:4px;z-index:99;margin:0;padding:4px 6px;background:rgba(0,0,0,.7);" +
      "color:#cfe;font:11px monospace;pointer-events:none;white-space:pre";
    parent.appendChild(this.el);
  }

  show(s: StatsSnapshot, extra: Record<string, number | string> = {}): void {
    this.el.textContent = formatStats(s, extra);
    (globalThis as Record<string, unknown>)[this.globalName] = { ...s, ...extra };
  }

  dispose(): void {
    this.el.remove();
  }
}
