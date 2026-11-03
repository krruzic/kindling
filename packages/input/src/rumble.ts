// Rumble: dual-motor vibration on browser gamepads (Gamepad.vibrationActuator "dual-rumble"), addressed by the
// manager's device handle ("pad-<index>"). One effect per pad at a time: a new pulse only replaces the running one
// when it is at least as strong as what is left of it (a big hit is never cut short by a footstep), and short
// pulses inside a longer one are merged (max of the motors). `scale` is the options-menu strength, 0 disables.
import type { GamepadLike } from "./types.ts";

export interface RumblePulse {
  /** Low-frequency (heavy) motor 0..1. */
  strong: number;
  /** High-frequency (buzz) motor 0..1. */
  weak: number;
  /** Duration in milliseconds. */
  ms: number;
}

export interface RumbleActuator {
  playEffect(type: string, params: { duration: number; strongMagnitude: number; weakMagnitude: number; startDelay?: number }): Promise<unknown>;
  reset?(): Promise<unknown>;
}

type PadWithRumble = GamepadLike & { vibrationActuator?: RumbleActuator | null };

export class Rumble {
  /** Global strength 0..1 (0 = off). */
  scale = 1;
  private running = new Map<number, { strong: number; weak: number; until: number }>();

  constructor(
    private pads: () => readonly (PadWithRumble | null)[] = () =>
      typeof navigator !== "undefined" && navigator.getGamepads ? (navigator.getGamepads() as unknown as PadWithRumble[]) : [],
    private now: () => number = () => performance.now(),
  ) {}

  /** Play a pulse on a device handle ("pad-0") or pad index. Returns whether an effect was sent. */
  play(pad: string | number, p: RumblePulse): boolean {
    const index = typeof pad === "number" ? pad : Number(/^pad-(\d+)$/.exec(pad)?.[1] ?? NaN);
    if (!Number.isFinite(index) || this.scale <= 0 || p.ms <= 0) return false;
    const gp = this.pads().find((g) => g && g.index === index && g.connected);
    const act = gp?.vibrationActuator;
    if (!act) return false;
    const t = this.now();
    const cur = this.running.get(index);
    let strong = Math.min(1, p.strong * this.scale);
    let weak = Math.min(1, p.weak * this.scale);
    let until = t + p.ms;
    if (cur && cur.until > t) {
      if (strong + weak < (cur.strong + cur.weak) * 0.999 && until <= cur.until) return false;
      strong = Math.max(strong, until <= cur.until ? cur.strong : 0);
      weak = Math.max(weak, until <= cur.until ? cur.weak : 0);
      until = Math.max(until, cur.until);
    }
    this.running.set(index, { strong, weak, until });
    void act.playEffect("dual-rumble", { duration: until - t, strongMagnitude: strong, weakMagnitude: weak, startDelay: 0 }).catch(() => {});
    return true;
  }

  /** Stop every pad's vibration (pause menus, focus loss). */
  stop(): void {
    for (const gp of this.pads()) void gp?.vibrationActuator?.reset?.()?.catch(() => {});
    this.running.clear();
  }
}
