// Screen manager: a stack of full-screen UI states (title -> menu -> options -> dialog...) with enter / exit
// transitions. Only the top screen gets input, and none does while a transition runs (no double-presses
// through a fading screen). Screens below an opaque, settled top screen are not drawn; overlays (opaque: false,
// e.g. pause or a dialog) draw over the screen beneath. Transitions are applied by the manager (fade / slide /
// none) and also passed to draw() so a screen can animate its own parts.

export type TransitionKind = "fade" | "slide" | "none";

export interface Transition {
  kind: TransitionKind;
  /** Seconds. */
  duration: number;
}

export interface ScreenPhase {
  phase: "enter" | "idle" | "exit";
  /** 0..1 through the phase (1 when idle). */
  p: number;
}

export interface Screen<D = unknown> {
  readonly name: string;
  /** Overlays (false) let the screen below show through. Default true. */
  readonly opaque?: boolean;
  enter?(): void;
  exit?(): void;
  /** Called while this screen is the top and settled. */
  update?(dt: number, input: D): void;
  /** Called every frame for screens below the top too (animations, attract worlds). */
  tick?(dt: number): void;
  draw(ctx: CanvasRenderingContext2D, w: number, h: number, phase: ScreenPhase): void;
}

interface Entry<D> {
  screen: Screen<D>;
  phase: "enter" | "idle" | "exit";
  t: number;
  tr: Transition;
}

export const DEFAULT_TRANSITION: Transition = { kind: "fade", duration: 0.22 };
const NONE: Transition = { kind: "none", duration: 0 };

export class ScreenManager<D = unknown> {
  private stack: Entry<D>[] = [];
  /** Screens on their way out (drawn on top until their exit finishes). */
  private leaving: Entry<D>[] = [];

  constructor(public transition: Transition = DEFAULT_TRANSITION) {}

  get top(): Screen<D> | undefined {
    return this.stack[this.stack.length - 1]?.screen;
  }

  get depth(): number {
    return this.stack.length;
  }

  /** Names bottom to top (debug / tests). */
  get names(): string[] {
    return this.stack.map((e) => e.screen.name);
  }

  /** A transition is running (input is held). */
  get busy(): boolean {
    return this.leaving.length > 0 || this.stack.some((e) => e.phase !== "idle");
  }

  push(s: Screen<D>, tr: Transition = this.transition): void {
    this.stack.push({ screen: s, phase: tr.duration > 0 ? "enter" : "idle", t: 0, tr });
    s.enter?.();
  }

  /** Removes the top screen (with its exit transition). */
  pop(tr: Transition = this.transition): Screen<D> | undefined {
    const e = this.stack.pop();
    if (!e) return undefined;
    this.retire(e, tr);
    return e.screen;
  }

  /** Replaces the top screen. */
  replace(s: Screen<D>, tr: Transition = this.transition): void {
    const e = this.stack.pop();
    if (e) this.retire(e, tr.kind === "slide" ? tr : NONE);
    this.push(s, tr);
  }

  /** Pops down to (not including) the named screen; replaces everything when it's not on the stack. */
  popTo(name: string, tr: Transition = this.transition): void {
    while (this.stack.length && this.top!.name !== name) this.pop(this.stack.length === 1 ? tr : NONE);
  }

  /** Clears the stack and pushes `s` (e.g. back to the title). */
  reset(s: Screen<D>, tr: Transition = this.transition): void {
    while (this.stack.length) this.pop(NONE);
    this.leaving = [];
    this.push(s, tr);
  }

  private retire(e: Entry<D>, tr: Transition): void {
    e.screen.exit?.();
    if (tr.duration <= 0) return;
    e.phase = "exit";
    e.t = 0;
    e.tr = tr;
    this.leaving.push(e);
  }

  update(dt: number, input: D): void {
    for (const e of [...this.stack, ...this.leaving]) {
      if (e.phase === "idle") continue;
      e.t += dt;
      if (e.t >= e.tr.duration) {
        if (e.phase === "enter") e.phase = "idle";
        else this.leaving.splice(this.leaving.indexOf(e), 1);
      }
    }
    for (const e of this.stack) e.screen.tick?.(dt);
    const top = this.stack[this.stack.length - 1];
    if (top && !this.busy) top.screen.update?.(dt, input);
  }

  /** Index of the lowest screen that must be drawn. */
  private firstVisible(): number {
    for (let i = this.stack.length - 1; i > 0; i--) {
      const e = this.stack[i];
      if (e.screen.opaque !== false && e.phase === "idle") return i;
    }
    return 0;
  }

  draw(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    for (const e of this.stack.slice(this.firstVisible())) this.drawEntry(ctx, w, h, e);
    for (const e of this.leaving) this.drawEntry(ctx, w, h, e);
  }

  private drawEntry(ctx: CanvasRenderingContext2D, w: number, h: number, e: Entry<D>): void {
    const p = e.phase === "idle" ? 1 : Math.min(1, e.t / Math.max(1e-6, e.tr.duration));
    const vis = e.phase === "exit" ? 1 - p : e.phase === "enter" ? p : 1;
    ctx.save();
    if (e.tr.kind === "fade") ctx.globalAlpha *= ease(vis);
    else if (e.tr.kind === "slide") ctx.translate((1 - ease(vis)) * w * (e.phase === "exit" ? -1 : 1), 0);
    e.screen.draw(ctx, w, h, { phase: e.phase, p });
    ctx.restore();
  }
}

const ease = (t: number) => 1 - (1 - t) * (1 - t);
