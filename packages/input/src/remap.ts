// Remapping: a store of custom bindings per device key (Gamepad id, "gc-port-1", "keyboard-1") persisted through
// load / save callbacks (so this package doesn't depend on any save system), the swap rule for binding one source
// to one action, and RemapSession: the "press the button for X" / "press every button in turn" capture.
//
// A session binds the next source the device presses AND releases (after the step began) to the step's action.
// It can't trap a player with a single controller: holding any button HOLD_SKIP seconds skips the step (guided)
// or cancels (single action), and TIMEOUT seconds without input ends it. UI-agnostic: a page reads `action`,
// `hold`, `step` / `steps.length` and `status` and draws whatever it likes.
import type { Bindings, RemapData } from "./types.ts";

export interface RemapHooks {
  load?(): RemapData | null | undefined;
  save?(data: RemapData): void;
}

export class RemapStore {
  data: RemapData = {};

  constructor(private hooks: RemapHooks = {}) {
    this.reload();
  }

  /** Re-reads the saved data (keeping only well-formed entries). */
  reload(): void {
    const raw = this.hooks.load?.() ?? {};
    const data: RemapData = {};
    for (const [key, b] of Object.entries(raw ?? {})) {
      if (!b || typeof b !== "object") continue;
      const clean: Record<string, string[]> = {};
      for (const [a, srcs] of Object.entries(b))
        if (Array.isArray(srcs)) clean[a] = srcs.filter((s): s is string => typeof s === "string");
      data[key] = clean;
    }
    this.data = data;
  }

  has(key: string): boolean {
    return !!this.data[key];
  }

  get(key: string): Record<string, string[]> | undefined {
    return this.data[key];
  }

  set(key: string, b: Record<string, string[]>): void {
    this.data[key] = b;
    this.hooks.save?.(this.data);
  }

  reset(key: string): void {
    if (!(key in this.data)) return;
    delete this.data[key];
    this.hooks.save?.(this.data);
  }

  /** A device's bindings: its defaults with the saved ones on top (unknown actions in the save are ignored). */
  bindings<A extends string>(key: string, defaults: Bindings<A>): Bindings<A> {
    const c = this.data[key];
    if (!c) return defaults;
    const out = { ...defaults };
    for (const a of Object.keys(defaults) as A[]) if (c[a]) out[a] = c[a];
    return out;
  }
}

/**
 * Binds `source` to `action` alone (or the action's whole default set, if `source` is one of them: a GameCube R
 * keeps both click and travel). Another action that used `source` loses it; if that leaves it with nothing it takes
 * `action`'s old sources (a swap: rebinding A onto B's button puts B on A's old button).
 */
export function rebind<A extends string>(
  defaults: Bindings<A>,
  current: Bindings<A>,
  action: NoInfer<A>,
  source: string,
): Bindings<A> {
  const b = structuredClone(current);
  const mine = defaults[action].includes(source) ? [...defaults[action]] : [source];
  const prev = b[action].filter((s) => !mine.includes(s));
  b[action] = mine;
  for (const a of Object.keys(b) as A[]) {
    if (a === action || !b[a].some((s) => mine.includes(s))) continue;
    b[a] = b[a].filter((s) => !mine.includes(s));
    if (!b[a].length) b[a] = prev;
  }
  return b;
}

/** Holding a button this long while binding skips the step (guided) or cancels (single action). */
export const HOLD_SKIP = 1.5;
/** Binding stops after this long without input. */
export const CAPTURE_TIMEOUT = 10;

export type RemapStatus = "active" | "done" | "cancelled" | "timeout" | "lost";

/** What a session needs from the device it captures (Device satisfies it). */
export interface CaptureSource {
  readonly sources: ReadonlyMap<string, { id: string; on: boolean; axis: boolean }>;
  readonly pressAt: ReadonlyMap<string, number>;
}

export interface RemapOptions {
  holdSkip?: number;
  timeout?: number;
}

export class RemapSession<A extends string> {
  step = 0;
  status: RemapStatus = "active";
  /** Progress 0..1 of the longest-held button toward hold-to-skip (draw it as a ring). */
  hold = 0;
  readonly bound: A[] = [];
  readonly skipped: A[] = [];
  /** Source bound at each finished step (null = skipped). */
  readonly results: { action: A; source: string | null }[] = [];
  private at: number;
  private inputAt: number;
  private down = new Map<string, number>();
  readonly holdSkip: number;
  readonly timeout: number;

  constructor(
    /** Handle of the device being captured. */
    readonly device: string,
    readonly steps: readonly A[],
    now: number,
    private onBind: (action: A, source: string) => void,
    opts: RemapOptions = {},
  ) {
    this.at = this.inputAt = now;
    this.holdSkip = opts.holdSkip ?? HOLD_SKIP;
    this.timeout = opts.timeout ?? CAPTURE_TIMEOUT;
    if (!steps.length) this.status = "done";
  }

  get active(): boolean {
    return this.status === "active";
  }

  get guided(): boolean {
    return this.steps.length > 1;
  }

  /** The action being bound now (undefined once finished). */
  get action(): A | undefined {
    return this.active ? this.steps[this.step] : undefined;
  }

  /** Seconds until the no-input timeout. */
  timeLeft(now: number): number {
    return Math.max(0, this.timeout - (now - this.inputAt));
  }

  cancel(): void {
    if (this.active) this.status = "cancelled";
  }

  /** Advances the capture from the device's sources this frame (undefined = the device disconnected). */
  update(dev: CaptureSource | undefined, now: number): void {
    if (!this.active) return;
    if (!dev) {
      this.status = "lost";
      return;
    }
    this.hold = 0;
    for (const s of dev.sources.values()) {
      const at = dev.pressAt.get(s.id) ?? -1;
      if (!s.on || at <= this.at) continue;
      this.down.set(s.id, at);
      if (now - at < this.holdSkip) this.inputAt = now;
      // Axis halves can sit "on" by themselves (an untouched axis Chromium reads as 0), so they never skip.
      if (!s.axis) this.hold = Math.max(this.hold, (now - at) / this.holdSkip);
    }
    if (this.hold >= 1) return this.next(now, null);
    for (const id of this.down.keys()) if (!dev.sources.get(id)?.on) return this.next(now, id);
    if (now - this.inputAt > this.timeout) this.status = "timeout";
  }

  private next(now: number, source: string | null): void {
    const action = this.steps[this.step];
    this.results.push({ action, source });
    if (source) {
      this.onBind(action, source);
      this.bound.push(action);
    } else {
      this.skipped.push(action);
      if (!this.guided) {
        this.status = "cancelled";
        return;
      }
    }
    this.step++;
    this.at = this.inputAt = now;
    this.down.clear();
    this.hold = 0;
    if (this.step >= this.steps.length) this.status = "done";
  }
}
