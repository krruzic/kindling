// Robust trigger / button reading. One physical input can have a digital channel (a click bit), an analog channel
// (a trigger's travel, a Gamepad button's .value or an axis half), or both - as on a GameCube L / R, where either
// can be modded dead. The input is held when EITHER channel says so:
// - analog: rest calibrated from the lowest value seen (so a trigger resting part-pressed, or an axis that reads 0
//   until first touched, doesn't count as held); held from `onAt` of travel above rest, released below 60% of that
//   (hysteresis). A trigger whose travel never reaches `onAt` gets a threshold at 90% of the travel it has shown.
// - digital: on a known analog trigger, ignored until it has been seen released once (stuck closed never counts).
// - stuck: an analog channel held without moving for STUCK_S is re-baselined there (a trigger stuck high stops
//   reading held); a digital channel held STUCK_S while a live analog channel says released is ignored until it
//   releases.
// Plain buttons (0 / 1 values) read as pressed is held, from the first frame.

export const STUCK_S = 10;
/** Analog travel (above rest) a channel must have shown before its threshold adapts to it. */
const LIVE_RANGE = 0.2;
/** Movement that counts as the analog channel not being stuck. */
const STILL = 0.04;
/** Fraction of the threshold the travel must drop under to release (hysteresis). */
export const RELEASE_AT = 0.6;

export interface TriggerSample {
  digital?: boolean;
  analog?: number;
  /** false: this analog sample can't lower the rest (an axis half while the axis is past its start the other way). */
  calibrate?: boolean;
}

export class Trigger {
  rest = Number.NaN;
  peak = Number.NaN;
  held = false;
  /** Last raw samples, for the debug readout. */
  digital: boolean | undefined;
  analog: number | undefined;
  /** Times a stuck analog channel was re-baselined. */
  rebased = 0;
  private digitalUp: boolean;
  private digitalIgnored = false;
  private digitalSince = -1;
  private analogHeld = false;
  private stillAt = 0;
  private stillRef = Number.NaN;
  private fractional = false;

  constructor(
    public onAt = 0.5,
    /** A known analog trigger: calibrates from its first frame and distrusts a digital channel stuck closed. */
    readonly known = false,
  ) {
    this.digitalUp = !known;
  }

  /** Travel above rest (0 without an analog channel). */
  get travel(): number {
    return this.analog === undefined || Number.isNaN(this.rest) ? 0 : Math.max(0, this.analog - this.rest);
  }

  get analogLive(): boolean {
    return this.peak - this.rest >= LIVE_RANGE;
  }

  get isAnalog(): boolean {
    return this.known || this.fractional;
  }

  /** Why a channel is being ignored, for the debug readout ("" = trusted). */
  get note(): string {
    if (this.digital !== undefined && !this.digitalUp) return "CLICK STUCK ON";
    if (this.digitalIgnored) return "CLICK IGNORED";
    if (this.rebased) return "ANALOG RE-ZEROED";
    if (this.known && this.digital !== undefined && this.analog !== undefined && !this.analogLive)
      return "NO ANALOG SEEN YET";
    return "";
  }

  threshold(): number {
    const range = this.peak - this.rest;
    return range >= LIVE_RANGE ? Math.max(0.12, Math.min(this.onAt, range * 0.9)) : this.onAt;
  }

  update(s: TriggerSample, now: number): boolean {
    this.digital = s.digital;
    this.analog = s.analog;
    let a = false;
    const v = s.analog;
    if (v !== undefined && Number.isFinite(v)) {
      if (v > 0.001 && v < 0.999) this.fractional = true;
      if (Number.isNaN(this.rest)) this.rest = this.isAnalog ? v : Math.min(v, 0);
      else if (v < this.rest && s.calibrate !== false) this.rest = v;
      if (Number.isNaN(this.peak) || v > this.peak) this.peak = v;
      const on = this.threshold();
      const d = v - this.rest;
      a = this.analogHeld ? d > on * RELEASE_AT : d >= on;
      if (!a || Number.isNaN(this.stillRef) || Math.abs(v - this.stillRef) > STILL) {
        this.stillRef = v;
        this.stillAt = now;
      } else if (this.isAnalog && now - this.stillAt > STUCK_S) {
        this.rest = v;
        this.rebased++;
        a = false;
      }
    }
    this.analogHeld = a;
    let d = false;
    if (s.digital !== undefined) {
      if (!s.digital) {
        this.digitalUp = true;
        this.digitalIgnored = false;
        this.digitalSince = -1;
      } else if (this.digitalUp) {
        if (this.digitalSince < 0) this.digitalSince = now;
        if (this.known && now - this.digitalSince > STUCK_S && this.analogLive && !a) this.digitalIgnored = true;
        d = !this.digitalIgnored;
      }
    }
    this.held = a || d;
    return this.held;
  }
}

/** One line about a trigger's channels: click, raw analog, rest, travel and what's being ignored. */
export function triggerText(t: Trigger): string {
  const parts: string[] = [];
  if (t.digital !== undefined) parts.push(`CLICK ${t.digital ? "ON" : "OFF"}`);
  if (t.analog !== undefined)
    parts.push(
      `ANALOG ${t.analog.toFixed(2)} REST ${t.rest.toFixed(2)} TRAVEL ${t.travel.toFixed(2)}/${t.threshold().toFixed(2)}`,
    );
  if (t.note) parts.push(t.note);
  return parts.join(" · ");
}
