// Sound (@kindling/audio): the procedural sfx bank (assets/sfx, rendered by tools/make-sfx.ts), music per screen
// rendered at runtime by the same synth through MusicPlayer's `load` hook, ambience beds per screen, spatial
// placement of match sounds from the camera (one listener: the shared arena view), and the sim-event -> sound
// mapping, which is the game's (the package only plays).
import { AudioEngine, Ambience, MusicPlayer, groupVariants, place, type Hearing } from "@kindling/audio";
import { renderSong, SONGS } from "../audio/synth.ts";
import type { GameEvent } from "../sim/types.ts";

const SFX = import.meta.glob("../../assets/sfx/*.wav", { query: "?url", import: "default", eager: true }) as Record<
  string,
  string
>;

export type Track = keyof typeof SONGS;

export class Sound {
  readonly engine = new AudioEngine({ maxVoices: 40, volume: 0.8 });
  readonly music: MusicPlayer;
  readonly ambience: Ambience;
  private hearing: Hearing = { views: [{ x: 0, z: 0, range: 14, left: 0, span: 1 }] };

  constructor() {
    this.engine.bank.register(groupVariants(SFX));
    const tracks = Object.fromEntries(Object.keys(SONGS).map((k) => [k, { url: k, gain: 0.8 }]));
    this.music = new MusicPlayer(this.engine, tracks, {
      fade: 0.9,
      // "url" is the song name: render it with the synth instead of fetching a file.
      load: async (name) => {
        const ctx = this.engine.ctx!;
        const pcm = renderSong(SONGS[name as Track], 22050);
        const buf = ctx.createBuffer(1, pcm.length, 22050);
        buf.getChannelData(0).set(pcm);
        return buf;
      },
    });
    this.ambience = new Ambience(this.engine);
  }

  attach(target: EventTarget): void {
    this.engine.attachUnlock(target);
  }

  levels(o: { music: number; sfx: number; ambience: number }): void {
    this.engine.setLevel("music", o.music / 10);
    this.engine.setLevel("sfx", o.sfx / 10);
    this.engine.setLevel("ambience", o.ambience / 10);
  }

  /** Per frame: the screen's music (ducked under menus) and beds. */
  frame(track: Track | null, duck: number, beds: "arena" | "menu" | "none"): void {
    this.engine.frame();
    this.music.set(track, duck);
    this.music.update();
    if (!this.engine.ready) return;
    if (beds === "arena")
      this.ambience.setBeds([
        { id: "bed.wind", level: 0.7 },
        { id: "bed.crowd", level: 0.5 },
      ]);
    else if (beds === "menu") this.ambience.setBeds([{ id: "bed.wind", level: 0.45 }]);
    else this.ambience.setBeds([]);
  }

  /** The listener follows the camera's focus. */
  listen(x: number, z: number, range: number): void {
    const v = this.hearing.views[0];
    v.x = x;
    v.z = z;
    v.range = range;
  }

  ui(k: "move" | "ok" | "back" | "error" | "adjust" | "key" | "join"): void {
    const e = this.engine;
    if (k === "move") e.tone({ type: "square", from: 880, to: 990, dur: 0.04, gain: 0.08 });
    else if (k === "adjust") e.tone({ type: "triangle", from: 660, to: 740, dur: 0.05, gain: 0.1 });
    else if (k === "key") e.tone({ type: "square", from: 1200, dur: 0.03, gain: 0.06 });
    else if (k === "ok") {
      e.tone({ type: "square", from: 660, to: 1320, dur: 0.09, gain: 0.1 });
      e.hiss({ freq: 3000, dur: 0.06, gain: 0.05, filter: "highpass" });
    } else if (k === "back") e.tone({ type: "square", from: 660, to: 330, dur: 0.09, gain: 0.09 });
    else if (k === "join") e.play("join", 0.8, { priority: true });
    else e.tone({ type: "sawtooth", from: 160, to: 120, dur: 0.14, gain: 0.12 });
  }

  /** One tick's sim events -> sounds, placed on the arena. */
  events(evs: readonly GameEvent[]): void {
    const e = this.engine;
    const at = (x: number, z: number) => place(this.hearing, x, 0, z, undefined, { ownFloor: 0.4 });
    for (const ev of evs) {
      switch (ev.type) {
        case "countdown":
          e.play("countdown", 0.8, { priority: true, jitter: 0 });
          break;
        case "fight":
          e.play("fight", 0.9, { priority: true, jitter: 0 });
          break;
        case "attack":
          if (e.allow("attack", 3)) e.play("attack", 0.6, { place: at(ev.x, ev.z) });
          break;
        case "dash":
          if (e.allow("dash", 3)) e.play("dash", 0.5, { place: at(ev.x, ev.z) });
          break;
        case "slamCharge":
          e.play("slamCharge", 0.5, { place: at(ev.x, ev.z) });
          break;
        case "slam":
          e.play("slam", 1, { place: at(ev.x, ev.z), priority: 2 });
          e.duck(["music"], 0.5, { hold: 0.15, release: 0.6 });
          break;
        case "hit":
          if (e.allow("hit", 4))
            e.play("hit", Math.min(1, 0.5 + ev.power * 0.03), { place: at(ev.x, ev.z), priority: 1 });
          break;
        case "bump":
          if (e.allow("bump", 2)) e.play("bump", 0.35, { place: at(ev.x, ev.z), quiet: true });
          break;
        case "fall":
          e.play("fall", 0.8, { place: at(ev.x, ev.z), priority: 2 });
          if (ev.by >= 0) e.play("ko", 0.6, { bus: "ambience", priority: 1, at: 0.15 });
          break;
        case "roundOver":
          e.play("roundOver", 0.8, { priority: true, jitter: 0 });
          break;
        case "matchOver":
          e.play("matchOver", 0.9, { priority: true, jitter: 0 });
          e.duck(["music", "ambience"], 0.3, { hold: 1.6, release: 1 });
          break;
        default:
          break;
      }
    }
  }
}
