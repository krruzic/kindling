// Music: one looping track per screen (menu, select, battle, results), cross-faded when the wanted track
// changes, with an optional duck level (music under a pause menu or a dialog). Tracks load lazily: the wanted one
// first, then the rest in the background once something plays, so a screen change doesn't wait on the network.
// Call set() whenever the screen decides, and update() every frame.
import type { AudioEngine } from "./engine.ts";

export interface Track {
  url: string;
  /** Seamless loop points (seconds); default the whole file. */
  loopStart?: number;
  loopEnd?: number;
  /** Track trim (0..1). */
  gain?: number;
}

export interface MusicOpts {
  /** Crossfade seconds (default 1.2). */
  fade?: number;
  /** Bus (default "music"). */
  bus?: string;
  /** Fetch + decode (tests pass a fake). */
  load?: (url: string) => Promise<AudioBuffer>;
  /** Preload other tracks after the first one plays (default true). */
  prefetch?: boolean;
}

interface Playing {
  name: string;
  src: AudioBufferSourceNode;
  gain: GainNode;
}

export class MusicPlayer {
  private bufs = new Map<string, { buf: AudioBuffer | null; loading: boolean }>();
  private playing: Playing | null = null;
  private want: string | null = null;
  private duckTo = 1;
  private playedDuck = 1;

  constructor(
    private a: AudioEngine,
    private tracks: Record<string, Track>,
    private o: MusicOpts = {},
  ) {}

  /** The track to play (null = silence) and its duck level (1 = full). */
  set(name: string | null, duck = 1): void {
    this.want = name;
    this.duckTo = duck;
  }

  get current(): string | null {
    return this.playing?.name ?? null;
  }

  get wanted(): string | null {
    return this.want;
  }

  private fetch(name: string): AudioBuffer | null {
    const t = this.bufs.get(name);
    if (t) return t.buf;
    const tr = this.tracks[name];
    const ctx = this.a.ctx;
    if (!tr || !ctx) return null;
    const entry = { buf: null as AudioBuffer | null, loading: true };
    this.bufs.set(name, entry);
    const load = this.o.load ?? (async (u: string) => ctx.decodeAudioData(await (await fetch(u)).arrayBuffer()));
    load(tr.url)
      .then((b) => (entry.buf = b))
      .catch(() => {})
      .finally(() => (entry.loading = false));
    return null;
  }

  update(): void {
    const c = this.a.ctx;
    if (!c || !this.a.ready) return;
    const now = c.currentTime;
    const fade = this.o.fade ?? 1.2;
    if (this.playing && this.playing.name !== this.want) {
      const old = this.playing;
      old.gain.gain.cancelScheduledValues(now);
      old.gain.gain.setValueAtTime(old.gain.gain.value, now);
      old.gain.gain.linearRampToValueAtTime(0, now + fade);
      old.src.stop(now + fade + 0.1);
      this.playing = null;
    }
    if (!this.playing && this.want) {
      const buf = this.fetch(this.want);
      if (buf) {
        const tr = this.tracks[this.want];
        const src = c.createBufferSource();
        src.buffer = buf;
        src.loop = true;
        src.loopStart = tr.loopStart ?? 0;
        src.loopEnd = Math.min(buf.duration, tr.loopEnd ?? buf.duration);
        const gain = c.createGain();
        const level = this.duckTo * (tr.gain ?? 1);
        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(level, now + fade);
        src.connect(gain).connect(this.a.bus(this.o.bus ?? "music"));
        src.start(now + 0.05);
        this.playing = { name: this.want, src, gain };
        this.playedDuck = this.duckTo;
      }
    } else if (this.playing && this.o.prefetch !== false) {
      const next = Object.keys(this.tracks).find((k) => !this.bufs.has(k));
      if (next) this.fetch(next);
    }
    if (this.playing && this.playedDuck !== this.duckTo) {
      this.playedDuck = this.duckTo;
      const g = this.playing.gain.gain;
      g.cancelScheduledValues(now);
      g.setTargetAtTime(this.duckTo * (this.tracks[this.playing.name].gain ?? 1), now, 0.25);
    }
  }

  /** Stops immediately-ish (short fade), e.g. on leaving the page. */
  stop(fade = 0.3): void {
    const c = this.a.ctx;
    if (!c || !this.playing) return;
    const now = c.currentTime;
    this.playing.gain.gain.cancelScheduledValues(now);
    this.playing.gain.gain.setValueAtTime(this.playing.gain.gain.value, now);
    this.playing.gain.gain.linearRampToValueAtTime(0, now + fade);
    this.playing.src.stop(now + fade + 0.05);
    this.playing = null;
    this.want = null;
  }
}
