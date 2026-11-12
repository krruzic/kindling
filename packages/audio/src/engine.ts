// AudioEngine: the WebAudio graph and voice management.
//
//   buses     sfx, music and ambience (plus any the game adds) -> master -> compressor -> speakers. Levels go
//             through a curve so the low end of a 0..1 slider is actually quiet: "db" (a perceptual taper: even
//             steps in dB, 0 silent), "squared" or "linear". Level changes ramp briefly (no click on a slider).
//   play()    a random variant of a sample id (bank.ts) with pitch jitter, through an optional spatial placement
//             (gain -> low-pass when muffled -> pan -> bus). A voice budget caps simultaneous samples: past it,
//             a sound with higher priority steals the quietest-priority oldest voice, `priority: true` always
//             plays, everything else is dropped.
//   loops     A looped sound ALWAYS gets its scheduled stop when it has a duration, even if the duration is longer
//             than one pass of the sample (the Ceefax static that looped forever). Loops without a duration
//             return a Voice the caller must stop; stopAll() / stopLoops() stop any left over.
//   tone() / hiss()  synth blips and noise sweeps (UI ticks, chimes, fallbacks for missing samples).
//   duck()    dips buses briefly under a big moment and recovers.
// Nothing plays until unlock() runs after a user gesture (browser autoplay rules).
import { SampleBank, type BankOpts } from "./bank.ts";
import type { Place } from "./spatial.ts";

export interface BusSpec {
  /** Parent bus (default master). */
  parent?: string;
  /** Level 0..1 (before the curve). */
  level?: number;
  /** Fixed trim multiplied in (ambience sits under effects). */
  trim?: number;
}

export interface AudioEngineOpts {
  /** Master volume (default 0.7). */
  volume?: number;
  /** Most sample voices at once (default 56). */
  maxVoices?: number;
  /** Creates the context on unlock (tests pass a fake). */
  createContext?: () => AudioContext;
  /** Extra buses beyond sfx / music / ambience. */
  buses?: Record<string, BusSpec>;
  /**
   * How a 0..1 level becomes gain. "db": a perceptual taper, 1 = 0 dB and every step down the same number of dB
   * (`dbRange` over the slider: 40 puts a tenth at -36 dB), 0 silent; "squared": level 0.1 is -20 dB (default);
   * "linear": as given.
   */
  curve?: "squared" | "linear" | "db";
  /** The "db" curve's span (dB from level 1 down to level 0+; default 40). */
  dbRange?: number;
  /** Seconds a level change ramps over (default 0.05: no click). */
  levelRamp?: number;
  /** Random source for jitter and variants (presentation only, so Math.random is fine). */
  rng?: () => number;
  bank?: BankOpts;
  /** Compressor on the master (default true). */
  compressor?: boolean;
}

export interface PlayOpts {
  rate?: number;
  /** Seconds from now. */
  at?: number;
  /** Random pitch spread, fraction (default 0.05 = ±5%). */
  jitter?: number;
  /** true: plays even when the budget is full. A number: may steal a lower-priority voice. Default 0. */
  priority?: boolean | number;
  /** Bed-level detail (footsteps): doesn't extend busyUntil, so it can duck under louder sounds. */
  quiet?: boolean;
  loop?: boolean;
  /** Bus name (default "sfx"). */
  bus?: string;
  /** Cut after this many seconds with a short fade. Loops with a duration always get their stop. */
  dur?: number;
  /** Spatial placement (see spatial.ts). */
  place?: Place | null;
  /** Start offset into the sample, seconds. */
  offset?: number;
  /** Fade in over this many seconds. */
  fadeIn?: number;
}

export interface Voice {
  readonly id: string;
  readonly src: AudioBufferSourceNode;
  readonly gain: GainNode;
  readonly priority: number;
  readonly startedAt: number;
  readonly loop: boolean;
  /** Scheduled end time (Infinity for an open loop). */
  readonly endsAt: number;
  ended: boolean;
  /** Fades out over `fade` seconds and stops. Safe to call twice. */
  stop(fade?: number): void;
}

export interface ToneOpts {
  type?: OscillatorType;
  /** Start / end frequency (Hz); exponential sweep. */
  from: number;
  to?: number;
  dur: number;
  gain: number;
  at?: number;
  bus?: string;
  place?: Place | null;
}

export interface HissOpts {
  freq: number;
  q?: number;
  dur: number;
  gain: number;
  filter?: BiquadFilterType;
  sweepTo?: number;
  at?: number;
  bus?: string;
  place?: Place | null;
}

interface Bus {
  node: GainNode;
  level: number;
  trim: number;
}

export class AudioEngine {
  ctx: AudioContext | null = null;
  readonly bank: SampleBank;
  private master: GainNode | null = null;
  private buses = new Map<string, Bus>();
  private specs: Record<string, BusSpec>;
  private noise: AudioBuffer | null = null;
  private live: Voice[] = [];
  private budget = new Map<string, number>();
  private rng: () => number;
  /** Context time until which something loud is playing (quiet sounds can duck under it). */
  busyUntil = 0;
  /** Plays per id (+1000 per request for a missing id) for playtest tooling. */
  readonly log = new Map<string, number>();

  constructor(private o: AudioEngineOpts = {}) {
    this.rng = o.rng ?? Math.random;
    this.bank = new SampleBank({ rng: this.rng, ...o.bank });
    this.specs = {
      sfx: { level: 1 },
      music: { level: 0.5 },
      ambience: { level: 1, trim: 0.28, parent: "sfx" },
      ...o.buses,
    };
  }

  /** Creates the context and graph (first call), resumes a suspended context. Call from a user gesture. */
  unlock(): void {
    if (!this.ctx) {
      try {
        this.ctx = this.o.createContext ? this.o.createContext() : new AudioContext();
      } catch {
        return;
      }
      this.build();
      this.bank.load(this.ctx);
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
  }

  /** Unlocks on the first pointer / key / touch on `target`; returns a remover. */
  attachUnlock(target: EventTarget = globalThis as unknown as EventTarget): () => void {
    const f = () => this.unlock();
    const evs = ["pointerdown", "keydown", "touchstart"];
    for (const e of evs) target.addEventListener(e, f);
    return () => evs.forEach((e) => target.removeEventListener(e, f));
  }

  private build(): void {
    const c = this.ctx!;
    this.master = c.createGain();
    this.master.gain.value = this.o.volume ?? 0.7;
    if (this.o.compressor !== false) this.master.connect(c.createDynamicsCompressor()).connect(c.destination);
    else this.master.connect(c.destination);
    // Parents before children.
    const names = Object.keys(this.specs);
    const made = new Set<string>();
    const make = (n: string, depth = 0): void => {
      if (made.has(n) || depth > 8) return;
      const s = this.specs[n];
      if (s.parent && this.specs[s.parent]) make(s.parent, depth + 1);
      const node = c.createGain();
      const bus = { node, level: s.level ?? 1, trim: s.trim ?? 1 };
      node.gain.value = this.curve(bus.level) * bus.trim;
      node.connect(s.parent && this.buses.get(s.parent) ? this.buses.get(s.parent)!.node : this.master!);
      this.buses.set(n, bus);
      made.add(n);
    };
    names.forEach((n) => make(n));
    const len = c.sampleRate;
    this.noise = c.createBuffer(1, len, c.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = this.rng() * 2 - 1;
  }

  private curve(v: number): number {
    return levelGain(v, this.o.curve, this.o.dbRange);
  }

  get ready(): boolean {
    return !!this.ctx && this.ctx.state === "running";
  }

  get now(): number {
    return this.ctx?.currentTime ?? 0;
  }

  /** Live voices (sample sources not yet ended). */
  get voices(): number {
    return this.live.length;
  }

  get maxVoices(): number {
    return this.o.maxVoices ?? 56;
  }

  /** A bus's gain node (to connect custom chains). */
  bus(name = "sfx"): GainNode {
    const b = this.buses.get(name) ?? this.buses.get("sfx");
    if (!b) throw new Error("audio: not unlocked");
    return b.node;
  }

  /** Sets a bus level (0..1 slider value; the curve applies), ramping briefly. Works before unlock too. */
  setLevel(name: string, level: number): void {
    const spec = (this.specs[name] ??= { level });
    spec.level = level;
    const b = this.buses.get(name);
    if (!b) return;
    b.level = level;
    const v = this.curve(level) * b.trim;
    const ramp = this.o.levelRamp ?? 0.05;
    if (this.ctx && ramp > 0) {
      const now = this.ctx.currentTime;
      const g = b.node.gain;
      g.cancelScheduledValues(now);
      g.setValueAtTime(g.value, now);
      g.linearRampToValueAtTime(v, now + ramp);
      return;
    }
    if (this.ctx) {
      b.node.gain.cancelScheduledValues(this.ctx.currentTime);
      b.node.gain.setValueAtTime(v, this.ctx.currentTime);
    }
    b.node.gain.value = v;
  }

  /** A slider step (0..steps) as a bus level: step 0 silent, the curve does the rest. */
  setVolumeStep(name: string, step: number, steps: number): void {
    this.setLevel(name, steps > 0 ? Math.max(0, Math.min(steps, step)) / steps : 0);
  }

  level(name: string): number {
    return this.buses.get(name)?.level ?? this.specs[name]?.level ?? 0;
  }

  /** At most `max` sounds per `key` until the next frame() (e.g. 3 hit sounds a frame). */
  allow(key: string, max: number): boolean {
    const n = this.budget.get(key) ?? 0;
    if (n >= max) return false;
    this.budget.set(key, n + 1);
    return true;
  }

  /** Call once per frame: resets per-frame budgets. */
  frame(): void {
    this.budget.clear();
  }

  // ── Routing ──

  /** Output chain for one sound: gain -> (low-pass) -> (pan) -> bus. */
  private out(gain: number, bus: string | undefined, p: Place | null | undefined): GainNode {
    const c = this.ctx!;
    const g = c.createGain();
    g.gain.value = gain * (p?.gain ?? 1);
    let tail: AudioNode = g;
    if (p?.muffle) {
      const f = c.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.value = 1200;
      tail = tail.connect(f);
    }
    if (p && p.pan) {
      const pan = c.createStereoPanner();
      pan.pan.value = Math.max(-1, Math.min(1, p.pan));
      tail = tail.connect(pan);
    }
    tail.connect(this.bus(bus));
    return g;
  }

  // ── Voices ──

  private prio(o: PlayOpts): number {
    return o.priority === true ? Infinity : typeof o.priority === "number" ? o.priority : 0;
  }

  /** Makes room for a voice of priority p; false when it must be dropped. */
  private admit(p: number): boolean {
    if (this.live.length < this.maxVoices || p === Infinity) return true;
    let victim: Voice | null = null;
    for (const v of this.live)
      if (
        !v.ended &&
        v.priority < p &&
        (!victim || v.priority < victim.priority || (v.priority === victim.priority && v.startedAt < victim.startedAt))
      )
        victim = v;
    if (!victim) return false;
    victim.stop(0.03);
    this.release(victim);
    return true;
  }

  private release(v: Voice): void {
    const i = this.live.indexOf(v);
    if (i >= 0) this.live.splice(i, 1);
  }

  /** Plays a random variant of sample `id`; null when not ready, missing, silent or over budget. */
  play(id: string, gain = 1, o: PlayOpts = {}): Voice | null {
    if (!this.ctx || !this.master || gain <= 0.001) return null;
    const p = this.prio(o);
    const buf = this.bank.pick(id);
    this.log.set(id, (this.log.get(id) ?? 0) + (buf ? 1 : 1000));
    if (!buf || !this.admit(p)) return null;
    const c = this.ctx;
    const t = c.currentTime + (o.at ?? 0);
    const src = c.createBufferSource();
    src.buffer = buf;
    const j = o.jitter ?? 0.05;
    src.playbackRate.value = (o.rate ?? 1) * (1 + (this.rng() * 2 - 1) * j);
    src.loop = !!o.loop;
    const level = gain * (o.place?.gain ?? 1);
    const g = this.out(gain, o.bus, o.place);
    if (o.fadeIn) {
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(level, t + o.fadeIn);
    }
    src.connect(g);
    src.start(t, o.offset ?? 0);
    const len = buf.duration / src.playbackRate.value;
    let endsAt = o.loop ? Infinity : t + len;
    // A looped sound always gets its stop when it has a duration, even one longer than a pass of the sample.
    if (o.dur !== undefined && (o.loop || o.dur < len)) {
      const fade = Math.min(0.15, o.dur * 0.4);
      g.gain.setValueAtTime(level, t + o.dur - fade);
      g.gain.linearRampToValueAtTime(0, t + o.dur);
      src.stop(t + o.dur + 0.02);
      endsAt = t + o.dur + 0.02;
    }
    const engine = this;
    const v: Voice = {
      id,
      src,
      gain: g,
      priority: p,
      startedAt: t,
      loop: !!o.loop,
      endsAt,
      ended: false,
      stop(fade = 0.08) {
        if (this.ended) return;
        const now = c.currentTime;
        g.gain.cancelScheduledValues(now);
        g.gain.setValueAtTime(g.gain.value, now);
        g.gain.linearRampToValueAtTime(0, now + fade);
        try {
          src.stop(now + fade + 0.01);
        } catch {
          // Already stopped.
        }
        (this as { endsAt: number }).endsAt = now + fade + 0.01;
        engine.release(this);
      },
    };
    this.live.push(v);
    src.onended = () => {
      v.ended = true;
      this.release(v);
      g.disconnect();
    };
    if (!o.quiet && gain > 0.15) this.busyUntil = Math.max(this.busyUntil, t + Math.min(0.5, buf.duration));
    return v;
  }

  /** Stops every open loop (screen changes, leaving a match). */
  stopLoops(fade = 0.3): void {
    for (const v of [...this.live]) if (v.loop && v.endsAt === Infinity) v.stop(fade);
  }

  stopAll(fade = 0.1): void {
    for (const v of [...this.live]) v.stop(fade);
  }

  /** An oscillator blip / sweep (exponential pitch glide, click-free envelope). */
  tone(o: ToneOpts): void {
    if (!this.ctx || !this.master) return;
    const c = this.ctx;
    const t = c.currentTime + (o.at ?? 0);
    const osc = c.createOscillator();
    osc.type = o.type ?? "square";
    osc.frequency.setValueAtTime(o.from, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.to ?? o.from), t + o.dur);
    const g = this.out(1, o.bus, o.place);
    const peak = o.gain * (o.place?.gain ?? 1);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0008, t + o.dur);
    osc.connect(g);
    osc.start(t);
    osc.stop(t + o.dur + 0.02);
    osc.onended = () => g.disconnect();
  }

  /** Filtered noise (whooshes, static, wind gusts), optionally sweeping the filter. */
  hiss(o: HissOpts): void {
    if (!this.ctx || !this.noise) return;
    const c = this.ctx;
    const t = c.currentTime + (o.at ?? 0);
    const src = c.createBufferSource();
    src.buffer = this.noise;
    const f = c.createBiquadFilter();
    f.type = o.filter ?? "lowpass";
    f.frequency.setValueAtTime(o.freq, t);
    if (o.sweepTo) f.frequency.exponentialRampToValueAtTime(o.sweepTo, t + o.dur);
    f.Q.value = o.q ?? 1;
    const g = this.out(1, o.bus, o.place);
    g.gain.setValueAtTime(o.gain * (o.place?.gain ?? 1), t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + o.dur);
    src.connect(f).connect(g);
    src.start(t, this.rng() * 0.5);
    src.stop(t + o.dur + 0.02);
    src.onended = () => g.disconnect();
  }

  /**
   * Dips buses to `depth` x their level for a moment (a huge impact over the music): `attack` down, hold, then
   * recover with time constant `release`.
   */
  duck(names: string[], depth = 0.6, o: { attack?: number; hold?: number; release?: number } = {}): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const attack = o.attack ?? 0.05;
    const hold = o.hold ?? 0.55;
    for (const n of names) {
      const b = this.buses.get(n);
      if (!b) continue;
      const base = this.curve(b.level) * b.trim;
      const p = b.node.gain;
      p.cancelScheduledValues(now);
      p.setValueAtTime(p.value, now);
      p.linearRampToValueAtTime(base * depth, now + attack);
      p.setTargetAtTime(base, now + attack + hold, o.release ?? 0.5);
    }
  }
}

/** The gain a 0..1 level gives on a curve (see AudioEngineOpts.curve); 0 is always silent. */
export function levelGain(v: number, curve: "squared" | "linear" | "db" = "squared", dbRange = 40): number {
  if (v <= 0) return 0;
  if (curve === "linear") return v;
  if (curve === "db") return Math.pow(10, (-(1 - Math.min(1, v)) * dbRange) / 20);
  return v * v;
}
