// Ambience: what plays without any game event.
//   beds      stereo loops per scene / map on the ambience bus (wind + birds), faded in from a random offset and
//             faded out with a scheduled stop when the scene changes;
//   emitters  positional loops (torches, a fountain, a river) whose level and pan follow the loudest of their
//             emitter points for the current listeners (spatial.ts), one loop per kind;
//   critters  the odd random call (birds, crows, owls) every lo..hi seconds, panned randomly.
// The game decides which beds / emitters a map has; this only plays them. It reads the world, never writes it.
import type { AudioEngine } from "./engine.ts";
import { place, type Hearing } from "./spatial.ts";

export interface Bed {
  id: string;
  level: number;
  rate?: number;
}

export interface Critter {
  id: string;
  /** Seconds between calls (random in [lo, hi]). */
  lo: number;
  hi: number;
  gain?: number;
}

interface Loop {
  src: AudioBufferSourceNode;
  gain: GainNode;
  pan: StereoPannerNode;
}

export class Ambience {
  private beds: Loop[] = [];
  private bedKey = "";
  private spots = new Map<string, Loop>();
  private critterAt = new Map<string, number>();

  constructor(
    private a: AudioEngine,
    private rng: () => number = Math.random,
  ) {}

  /** Starts a looping sample on the ambience bus at level 0 -> `level` (fade). */
  private loop(id: string, level: number, rate = 1): Loop | null {
    const c = this.a.ctx;
    const buf = c && this.a.bank.pick(id);
    if (!c || !buf) return null;
    const src = c.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.playbackRate.value = rate;
    const gain = c.createGain();
    gain.gain.setValueAtTime(0, c.currentTime);
    gain.gain.setTargetAtTime(level, c.currentTime, 1.2);
    const pan = c.createStereoPanner();
    src.connect(gain).connect(pan).connect(this.a.bus("ambience"));
    src.start(c.currentTime, this.rng() * Math.max(0, buf.duration - 1));
    return { src, gain, pan };
  }

  /** Fades a loop out and schedules its stop (always: a loop without a stop plays forever). */
  private end(l: Loop, fade = 0.4): void {
    const now = this.a.now;
    l.gain.gain.cancelScheduledValues(now);
    l.gain.gain.setTargetAtTime(0, now, fade);
    l.src.stop(now + fade * 5);
  }

  /** Sets the scene's beds (no-op when unchanged); [] silences them. */
  setBeds(beds: Bed[]): void {
    const key = beds.map((b) => `${b.id}@${b.level}`).join(",");
    if (key === this.bedKey && this.beds.length === beds.length) return;
    for (const l of this.beds) this.end(l);
    this.beds = [];
    this.bedKey = key;
    for (const b of beds) {
      const l = this.loop(b.id, b.level, b.rate);
      if (l) this.beds.push(l);
    }
    // Samples still decoding: try again on the next call.
    if (this.beds.length < beds.length) this.bedKey = "";
  }

  /**
   * A positional loop `kind` playing sample `id` at `level`, following the loudest of `points` for the listeners.
   * Call every frame with the current points (an empty list fades it out).
   */
  emitter(kind: string, id: string, level: number, points: { x: number; y?: number; z: number }[], h: Hearing): void {
    let best: { gain: number; pan: number } | null = null;
    for (const p of points) {
      const q = place(h, p.x, p.y ?? 0, p.z);
      if (q && (!best || q.gain > best.gain)) best = q;
    }
    let l = this.spots.get(kind);
    if (!l) {
      if (!best) return;
      l = this.loop(id, 0) ?? undefined;
      if (!l) return;
      this.spots.set(kind, l);
    }
    const now = this.a.now;
    l.gain.gain.setTargetAtTime((best?.gain ?? 0) * level, now, 0.15);
    l.pan.pan.setTargetAtTime(best?.pan ?? 0, now, 0.15);
  }

  /** Random calls from `list`, scheduled per id. Call every frame. */
  critters(list: Critter[]): void {
    const now = this.a.now;
    for (const cr of list) {
      const at = this.critterAt.get(cr.id);
      const next = now + cr.lo + this.rng() * (cr.hi - cr.lo);
      if (at === undefined) {
        this.critterAt.set(cr.id, next);
        continue;
      }
      if (now < at) continue;
      this.critterAt.set(cr.id, next);
      this.a.play(cr.id, cr.gain ?? 0.5, {
        bus: "ambience",
        quiet: true,
        place: { gain: 1, pan: this.rng() * 1.6 - 0.8, muffle: this.rng() < 0.5 },
      });
    }
  }

  /** Fades everything out (menus, results) with scheduled stops. */
  stop(): void {
    for (const l of [...this.beds, ...this.spots.values()]) this.end(l);
    this.beds = [];
    this.bedKey = "";
    this.spots.clear();
    this.critterAt.clear();
  }

  /** Loops currently playing (beds + emitters). */
  get loops(): number {
    return this.beds.length + this.spots.size;
  }
}
