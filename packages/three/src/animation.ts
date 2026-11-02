// Animation controller over an AnimationMixer (from Grudge's hero/soldier views). Rigs share clip names but not
// every rig has every clip, so play() resolves a name through a fallback table (followed a few hops: "throw" ->
// "attack_b" -> "attack"), then an optional default. One-shot clips (attacks, hits, death) play once and hold their
// last frame, or return to a loop clip ("idle") when they finish; everything else loops. Switching cross-fades.
import * as THREE from "three";

export interface AnimationOptions {
  /** Clips that play once (LoopOnce + clampWhenFinished). */
  oneShot?: Iterable<string> | ((name: string) => boolean);
  /** Substitute clip(s) when a rig lacks one; followed up to `maxHops` times. */
  fallbacks?: Record<string, string | readonly string[]>;
  maxHops?: number;
  /** Played when nothing resolves (e.g. "idle"); null plays nothing. */
  fallbackClip?: string | null;
  /** Default cross-fade seconds. */
  fade?: number;
  /** After a one-shot finishes, cross-fade to this clip (unset: hold the last frame). */
  returnTo?: string;
}

export interface PlayOptions {
  fade?: number;
  timeScale?: number;
  /** Restart even if this clip is already playing. */
  restart?: boolean;
  /** Override the one-shot table for this play. */
  once?: boolean;
  /** Override returnTo for this play (null: hold). */
  returnTo?: string | null;
}

export class AnimationController {
  readonly mixer: THREE.AnimationMixer;
  readonly actions = new Map<string, THREE.AnimationAction>();
  /** Name of the clip playing (after fallback resolution). */
  current: string | null = null;
  /** True once the current one-shot has finished. */
  done = false;
  private isOnce: (n: string) => boolean;
  private pendingReturn: string | null = null;
  private listeners: ((name: string) => void)[] = [];

  constructor(
    root: THREE.Object3D,
    clips: readonly THREE.AnimationClip[],
    readonly opts: AnimationOptions = {},
  ) {
    this.mixer = new THREE.AnimationMixer(root);
    for (const c of clips) this.actions.set(c.name, this.mixer.clipAction(c));
    const os = opts.oneShot;
    if (typeof os === "function") this.isOnce = os;
    else {
      const set = new Set(os ?? []);
      this.isOnce = (n) => set.has(n);
    }
    this.mixer.addEventListener("finished", (e) => {
      const name = [...this.actions.entries()].find(([, a]) => a === e.action)?.[0];
      if (!name || name !== this.current) return;
      this.done = true;
      for (const l of this.listeners) l(name);
      const back = this.pendingReturn;
      this.pendingReturn = null;
      if (back) this.play(back);
    });
  }

  has(name: string): boolean {
    return this.actions.has(name);
  }

  /** The clip that would play for `name` (fallbacks followed), or null. */
  resolve(name: string): string | null {
    const fb = this.opts.fallbacks ?? {};
    let frontier = [name];
    const seen = new Set<string>();
    for (let hop = 0; hop <= (this.opts.maxHops ?? 3) && frontier.length; hop++) {
      const next: string[] = [];
      for (const n of frontier) {
        if (seen.has(n)) continue;
        seen.add(n);
        if (this.actions.has(n)) return n;
        const f = fb[n];
        if (f) next.push(...(typeof f === "string" ? [f] : f));
      }
      frontier = next;
    }
    const d = this.opts.fallbackClip;
    return d && this.actions.has(d) ? d : null;
  }

  /** Plays `name` (resolved), cross-fading from the current clip. Returns the clip played, or null. */
  play(name: string, o: PlayOptions = {}): string | null {
    const clip = this.resolve(name);
    if (!clip) return null;
    const next = this.actions.get(clip)!;
    next.timeScale = o.timeScale ?? 1;
    if (this.current === clip && !o.restart) return clip;
    const prev = this.current ? this.actions.get(this.current) : undefined;
    const once = o.once ?? this.isOnce(name);
    next.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
    next.clampWhenFinished = once;
    next.reset().play();
    const fade = o.fade ?? this.opts.fade ?? 0.15;
    if (prev && prev !== next) {
      if (fade > 0) prev.crossFadeTo(next, fade, false);
      else prev.stop();
    }
    this.current = clip;
    this.done = false;
    this.pendingReturn = once ? (o.returnTo === undefined ? (this.opts.returnTo ?? null) : o.returnTo) : null;
    return clip;
  }

  /** Called with the clip name whenever a one-shot finishes. */
  onFinished(fn: (name: string) => void): void {
    this.listeners.push(fn);
  }

  /** Duration (s) of the clip `name` resolves to (0 when none). */
  duration(name: string): number {
    const c = this.resolve(name);
    return c ? this.actions.get(c)!.getClip().duration : 0;
  }

  update(dt: number): void {
    this.mixer.update(dt);
  }

  stopAll(): void {
    this.mixer.stopAllAction();
    this.current = null;
    this.pendingReturn = null;
  }

  dispose(): void {
    this.stopAll();
    this.mixer.uncacheRoot(this.mixer.getRoot());
  }
}
