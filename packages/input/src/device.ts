// One connected input device, read each frame into named sources ("b3" / "a2+" for browser gamepads, canonical
// names like "south" for WebHID pads, KeyboardEvent codes for keyboard halves). Every source goes through a Trigger
// (trigger.ts), so analog triggers, modded GameCube L / R and axes resting off-centre all read the same way.
// Bindings (action -> source ids) turn sources into the game's actions.
import { Trigger, type TriggerSample } from "./trigger.ts";
import type { Bindings, PadButton, PadFamily, PadState } from "./types.ts";
import { emptyPad } from "./types.ts";

export type DeviceKind = "gamepad" | "hid" | "keyboard";

export interface Source {
  id: string;
  label: string;
  on: boolean;
  /** Canonical button this source plays by default (diagrams, labels). */
  button?: PadButton;
  /** An axis half: can bind, but never joins a seat or counts toward hold-to-skip (it can rest "on"). */
  axis: boolean;
  trig: Trigger;
}

export interface ReadOpts {
  onAt?: number;
  button?: PadButton;
  axis?: boolean;
  /** A known analog trigger (calibrates from its first frame, distrusts a stuck click). */
  analog?: boolean;
}

export class Device<A extends string> {
  readonly sources = new Map<string, Source>();
  /** When each source last went down (remap capture only takes presses after a step began). */
  readonly pressAt = new Map<string, number>();
  stick: [number, number, number, number] = [0, 0, 0, 0];
  lt = 0;
  rt = 0;
  alive = true;
  /** Browser gamepads: each axis's first reading, splitting it into halves that calibrate apart. */
  axisStart: number[] = [];
  /** Last raw Gamepad readout (debug pages). */
  raw: { axes: number[]; buttons: { value: number; pressed: boolean }[] } | null = null;
  state: PadState<A>;
  /** Sources held when the device joined or finished a remap: they read as off until let go. */
  readonly suppressed = new Set<string>();

  constructor(
    readonly handle: string,
    readonly key: string,
    public name: string,
    readonly family: PadFamily,
    readonly profile: string,
    readonly kind: DeviceKind,
    readonly defaults: Bindings<A>,
    actions: readonly A[],
  ) {
    this.state = emptyPad(actions);
  }

  /** Reads one source this frame (created on first use, so its Trigger calibrates from the device's first frames). */
  read(id: string, label: string, s: TriggerSample, now: number, opts: ReadOpts = {}): Source {
    let src = this.sources.get(id);
    if (!src) {
      src = {
        id,
        label,
        on: false,
        button: opts.button,
        axis: opts.axis ?? false,
        trig: new Trigger(opts.onAt ?? 0.5, opts.analog ?? false),
      };
      this.sources.set(id, src);
    }
    const was = src.on;
    src.on = src.trig.update(s, now);
    if (src.on && !was) this.pressAt.set(id, now);
    return src;
  }

  /** Held and not suppressed. */
  live(id: string): boolean {
    return !!this.sources.get(id)?.on && !this.suppressed.has(id);
  }

  /** Suppresses every source held now (the press that joined a seat or ended a remap mustn't also act). */
  suppressHeld(): void {
    for (const s of this.sources.values()) if (s.on) this.suppressed.add(s.id);
  }

  /** Lifts suppression from sources that were let go. */
  releaseSuppressed(): void {
    for (const id of this.suppressed) if (!this.sources.get(id)?.on) this.suppressed.delete(id);
  }

  /** Any non-axis source held. */
  anyOn(): boolean {
    for (const s of this.sources.values()) if (s.on && !s.axis) return true;
    return false;
  }

  /** A non-axis source went down exactly at `now`. */
  pressedAt(now: number): boolean {
    for (const [id, t] of this.pressAt) if (t === now && !this.sources.get(id)?.axis) return true;
    return false;
  }
}

export function emptyBindings<A extends string>(actions: readonly A[]): Bindings<A> {
  const b = {} as Bindings<A>;
  for (const a of actions) b[a] = [];
  return b;
}
