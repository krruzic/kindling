// Music: one looping track per screen (menu, select, battle, results), cross-faded when the wanted track
// changes, with an optional duck level (music under a pause menu or a dialog). Tracks load lazily: the wanted one
// first, then the rest in the background once something plays, so a screen change doesn't wait on the network.
// Call set() whenever the screen decides, and update() every frame.
// Streamed tracks (`stream: true`) play through a media element (MediaElementAudioSourceNode) instead of being
// decoded whole: a 2-minute track decodes to ~40 MB of PCM, so a game with a track per screen streams them.
import type { AudioEngine } from "./engine.ts";

/** The part of HTMLAudioElement a streamed track uses (tests pass a fake). */
export interface MediaLike {
  loop: boolean;
  preload: string;
  currentTime: number;
  play(): Promise<void> | void;
  pause(): void;
}

export interface Track {
  url: string;
  /** Seamless loop points (seconds); default the whole file. */
  loopStart?: number;
  loopEnd?: number;
  /** Track trim (0..1). */
  gain?: number;
  /** Stream through a media element instead of decoding (long tracks); loops the whole file. */
  stream?: boolean;
}

export interface MusicOpts {
  /** Crossfade seconds (default 1.2). */
  fade?: number;
  /** Bus (default "music"). */
  bus?: string;
  /** Fetch + decode (tests pass a fake). */
  load?: (url: string) => Promise<AudioBuffer>;
  /** Preload other tracks after the first one plays (default true; streamed tracks are never prefetched). */
  prefetch?: boolean;
  /** Media element for a streamed track (default `new Audio(url)`). */
  element?: (url: string) => MediaLike;
}

interface Playing {
  name: string;
  src: AudioBufferSourceNode | null;
  el: MediaLike | null;
  gain: GainNode;
}

export class MusicPlayer {
  private bufs = new Map<string, { buf: AudioBuffer | null; loading: boolean }>();
  private playing: Playing | null = null;
  private want: string | null = null;
  private duckTo = 1;
  private playedDuck = 1;
  /** Streams fading out: paused once their fade is over (a media element has no scheduled stop). */
  private fading: { el: MediaLike; at: number }[] = [];

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
      this.end(old, now + fade + 0.1);
      this.playing = null;
    }
    this.fading = this.fading.filter((f) => {
      if (now < f.at) return true;
      f.el.pause();
      return false;
    });
    if (!this.playing && this.want && this.tracks[this.want]?.stream) this.startStream(this.want, now, fade);
    else if (!this.playing && this.want) {
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
        this.playing = { name: this.want, src, el: null, gain };
        this.playedDuck = this.duckTo;
      }
    } else if (this.playing && this.o.prefetch !== false) {
      const next = Object.keys(this.tracks).find((k) => !this.bufs.has(k) && !this.tracks[k].stream);
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
    this.end(this.playing, now + fade + 0.05);
    this.playing = null;
    this.want = null;
  }

  /** Streams being played or faded out (tests, debug). */
  get streams(): number {
    return (this.playing?.el ? 1 : 0) + this.fading.length;
  }

  private end(p: Playing, at: number): void {
    if (p.src) p.src.stop(at);
    if (p.el) this.fading.push({ el: p.el, at });
  }

  private startStream(name: string, now: number, fade: number): void {
    const c = this.a.ctx!;
    const tr = this.tracks[name];
    const el = this.o.element
      ? this.o.element(tr.url)
      : (new (globalThis as unknown as { Audio: new (u: string) => MediaLike }).Audio(tr.url) as MediaLike);
    el.loop = true;
    el.preload = "auto";
    const node = c.createMediaElementSource(el as unknown as HTMLMediaElement);
    const gain = c.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(this.duckTo * (tr.gain ?? 1), now + fade);
    node.connect(gain).connect(this.a.bus(this.o.bus ?? "music"));
    const p = el.play();
    if (p && typeof (p as Promise<void>).catch === "function") (p as Promise<void>).catch(() => {});
    this.playing = { name, src: null, el, gain };
    this.playedDuck = this.duckTo;
  }
}
