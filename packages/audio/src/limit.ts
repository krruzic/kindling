// Voice limiting by sound and by category, so a busy moment isn't a wall of the same blip: at most `max` copies of a
// sound (or of a category) at once, a minimum `gap` between two starts of the same sound (or category), and the
// rest dropped. Repeated sounds get a little pitch spread on top (engine `jitter`). Pure bookkeeping (no WebAudio):
// ask admit() before playing, with the sound's length so its slot frees when it ends. Games and tools (a headless
// count of what a run would play) share it.

export interface Limit {
  /** Copies at once (default: no cap). */
  max?: number;
  /** Seconds between two starts (default 0). */
  gap?: number;
}

export interface LimiterOptions {
  /** Per sound id. */
  sounds?: Record<string, Limit>;
  /** Per category (a sound's group). */
  groups?: Record<string, Limit>;
  /** Defaults for any sound without its own entry. */
  sound?: Limit;
}

interface Slot {
  ends: number[];
  last: number;
}

export class VoiceLimiter {
  private ids = new Map<string, Slot>();
  private groups = new Map<string, Slot>();
  /** Starts admitted / refused, by id (tools). */
  readonly played = new Map<string, number>();
  readonly refused = new Map<string, number>();

  constructor(public opts: LimiterOptions = {}) {}

  private slot(m: Map<string, Slot>, k: string, now: number): Slot {
    let s = m.get(k);
    if (!s) m.set(k, (s = { ends: [], last: -Infinity }));
    s.ends = s.ends.filter((t) => t > now);
    return s;
  }

  private fits(s: Slot, l: Limit | undefined, now: number): boolean {
    if (!l) return true;
    if (l.max !== undefined && s.ends.length >= l.max) return false;
    if (l.gap && now - s.last < l.gap) return false;
    return true;
  }

  /** May sound `id` (of category `group`) start at `now` (seconds), playing `dur` seconds? Records it if so. */
  admit(id: string, group: string | null, now: number, dur: number): boolean {
    const si = this.slot(this.ids, id, now);
    const sg = group ? this.slot(this.groups, group, now) : null;
    const li = this.opts.sounds?.[id] ?? this.opts.sound;
    const lg = group ? this.opts.groups?.[group] : undefined;
    if (!this.fits(si, li, now) || (sg && !this.fits(sg, lg, now))) {
      this.refused.set(id, (this.refused.get(id) ?? 0) + 1);
      return false;
    }
    si.ends.push(now + dur);
    si.last = now;
    if (sg) {
      sg.ends.push(now + dur);
      sg.last = now;
    }
    this.played.set(id, (this.played.get(id) ?? 0) + 1);
    return true;
  }

  /** Voices still sounding at `now` (all sounds). */
  live(now: number): number {
    let n = 0;
    for (const [, s] of this.ids) n += s.ends.filter((t) => t > now).length;
    return n;
  }
}
