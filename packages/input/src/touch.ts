// TouchPad: a touchscreen as one more pad (a PadProvider, family "touch"): a virtual stick on the left and virtual
// buttons, each bound to a canonical PadButton, so the game's actions, seats, remaps, prompts and menu navigation
// work exactly as with a real pad (and online lockstep sees ordinary commands).
//
// Layout (set by the game, in CSS px of the element it's attached to; call setLayout again on resize):
// - stick: `zone` (where a thumb may start it: usually the left half), `mode` "floating" (it appears where the
//   thumb lands, kept inside the zone) or "fixed" (centred on `cx, cy`; a touch within `grab` x radius of it takes
//   it), `radius` (full deflection), `deadzone` (fraction of the radius), `eightWay` (snap to 8 directions at full
//   tilt; default analog). A thumb dragged past the radius pulls the centre along (it re-centres, so reversing is
//   instant). Output: stickX / stickY in -1..1 (screen down is +y, like pads).
// - buttons: `{ id, x, y, r }` circles (or `w, h` rects) bound to canonical buttons. Multi-touch; a finger that
//   slides off a button onto an adjacent one moves to it (`slide`, default on; a little hysteresis keeps the
//   current one under the edge); a tap shorter than a poll still reads as pressed for one poll.
// Pointers: one finger per control. A second finger landing in the stick zone while the stick is held is ignored
// (palms, a resting thumb); fingers outside every control are ignored for play but reported as taps (`drainTaps`)
// so a game can use them for its menus. pointercancel releases whatever that pointer held (no stuck buttons).
// DOM (attach): Touch Events where the browser has them (each finger by identifier, every touchstart / touchmove
// default-prevented), pointer events with capture for a mouse / pen; `touch-action: none`, and the page's scroll /
// pinch zoom / long-press menu / text selection / double-tap zoom suppressed. `onTrace` reports every touch for an
// on-device diagnostic. Node tests drive the pointer methods (down / move / up / cancel) directly.
import type { ExternalPad, PadProvider } from "./manager.ts";
import type { GamepadLike, PadButton } from "./types.ts";

export interface TouchRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TouchStickLayout {
  zone: TouchRect;
  mode: "floating" | "fixed";
  /** Rest / fixed centre. */
  cx: number;
  cy: number;
  radius: number;
  /** Fraction of the radius that reads as centred (default 0.18). */
  deadzone?: number;
  /** Fixed mode: how far from the centre (x radius) a touch still takes the stick (default 1.6). */
  grab?: number;
  eightWay?: boolean;
}

export interface TouchButtonLayout {
  id: PadButton;
  x: number;
  y: number;
  /** Radius of a round button; or w / h (centred on x, y) for a rectangle. */
  r?: number;
  w?: number;
  h?: number;
}

export interface TouchLayout {
  stick: TouchStickLayout | null;
  buttons: TouchButtonLayout[];
  /** Slide between buttons (default true). */
  slide?: boolean;
}

export interface TouchTap {
  x: number;
  y: number;
  /** It started on a control (a button or the stick). */
  onControl: boolean;
}

export interface StickView {
  active: boolean;
  /** Centre and thumb, CSS px. */
  cx: number;
  cy: number;
  x: number;
  y: number;
  /** Output, -1..1. */
  vx: number;
  vy: number;
}

interface Ptr {
  id: number;
  kind: "stick" | "button" | "none";
  button: PadButton | null;
  x0: number;
  y0: number;
  t0: number;
  moved: number;
}

/** A tap: released within this long (s) and this far (CSS px) from where it started. */
const TAP_TIME = 0.35;
const TAP_SLOP = 14;

export class TouchPad implements PadProvider {
  readonly handle: string;
  readonly name: string;
  layout: TouchLayout = { stick: null, buttons: [] };
  /** Ignore input (e.g. while a text field has focus); everything held is let go. */
  enabled = true;
  /** Accept mouse pointers too (debugging on a desktop). */
  mouse: boolean;
  /** When a finger last touched (s; -Infinity = never): games show the controls while touch is the last input. */
  lastTouch = -Infinity;
  private ptrs = new Map<number, Ptr>();
  private stickPtr = -1;
  private sc = { x: 0, y: 0 };
  private sp = { x: 0, y: 0 };
  /** Buttons pressed since the last read (a tap shorter than a poll still counts once). */
  private latched = new Set<PadButton>();
  private taps: TouchTap[] = [];
  private touched = false;
  private clock: () => number;
  /** Every button this pad has or had (the device's bindings are made from the buttons it reports first, so a
   * layout without buttons, e.g. in a menu, mustn't leave it with none). */
  private known: Set<PadButton>;

  constructor(
    o: { handle?: string; name?: string; mouse?: boolean; clock?: () => number; buttons?: PadButton[] } = {},
  ) {
    this.handle = o.handle ?? "touch-1";
    this.name = o.name ?? "TOUCH SCREEN";
    this.mouse = o.mouse ?? false;
    this.known = new Set(o.buttons ?? []);
    this.clock = o.clock ?? (() => (typeof performance !== "undefined" ? performance.now() / 1000 : 0));
  }

  setLayout(l: TouchLayout): void {
    this.layout = l;
    for (const b of l.buttons) this.known.add(b.id);
    const s = l.stick;
    if (s && this.stickPtr < 0) this.sc = { x: s.cx, y: s.cy };
  }

  // --- pointers ---------------------------------------------------------------------------------------------------

  down(id: number, x: number, y: number): void {
    if (!this.enabled) return;
    const now = this.clock();
    this.lastTouch = now;
    this.touched = true;
    const p: Ptr = { id, kind: "none", button: null, x0: x, y0: y, t0: now, moved: 0 };
    this.ptrs.set(id, p);
    const b = this.buttonAt(x, y, null);
    if (b) {
      p.kind = "button";
      p.button = b;
      this.latched.add(b);
      return;
    }
    const s = this.layout.stick;
    if (s && this.stickPtr < 0 && this.takesStick(s, x, y)) {
      p.kind = "stick";
      this.stickPtr = id;
      if (s.mode === "floating") {
        const z = s.zone;
        const m = Math.min(s.radius, z.w / 2, z.h / 2);
        this.sc = {
          x: Math.max(z.x + m, Math.min(z.x + z.w - m, x)),
          y: Math.max(z.y + m, Math.min(z.y + z.h - m, y)),
        };
      } else this.sc = { x: s.cx, y: s.cy };
      // (held against the zone's edge the centre can't sit under the thumb: it reads as a tilt that way)
      this.sp = { x, y };
    }
  }

  move(id: number, x: number, y: number): void {
    const p = this.ptrs.get(id);
    if (!p || !this.enabled) return;
    p.moved = Math.max(p.moved, Math.hypot(x - p.x0, y - p.y0));
    this.lastTouch = this.clock();
    if (p.kind === "stick") {
      this.sp = { x, y };
      if (this.layout.stick) this.pull(this.layout.stick);
    } else if (p.kind === "button" && this.layout.slide !== false) {
      const b = this.buttonAt(x, y, p.button);
      if (b && b !== p.button) {
        p.button = b;
        this.latched.add(b);
      }
    }
  }

  up(id: number): void {
    const p = this.ptrs.get(id);
    if (!p) return;
    this.ptrs.delete(id);
    if (p.kind === "stick") this.stickPtr = -1;
    if (this.clock() - p.t0 <= TAP_TIME && p.moved <= TAP_SLOP)
      this.taps.push({ x: p.x0, y: p.y0, onControl: p.kind === "button" });
  }

  /** The browser took the pointer (a system gesture, an alert): release it, no tap. */
  cancel(id: number): void {
    const p = this.ptrs.get(id);
    if (!p) return;
    this.ptrs.delete(id);
    if (p.kind === "stick") this.stickPtr = -1;
  }

  /** Let go of everything (focus lost, the page hidden). */
  releaseAll(): void {
    this.ptrs.clear();
    this.stickPtr = -1;
    this.latched.clear();
  }

  /** Taps since the last call (menus): position in CSS px, and whether they started on a control. */
  drainTaps(): TouchTap[] {
    const t = this.taps;
    this.taps = [];
    return t;
  }

  /** Any finger down now. */
  get active(): boolean {
    return this.ptrs.size > 0;
  }

  /** The stick for drawing (centre, thumb, output). */
  stickView(): StickView {
    const s = this.layout.stick;
    const [vx, vy] = this.output();
    const on = this.stickPtr >= 0;
    const c = on ? this.sc : { x: s?.cx ?? 0, y: s?.cy ?? 0 };
    const r = s?.radius ?? 1;
    return { active: on, cx: c.x, cy: c.y, x: c.x + vx * r, y: c.y + vy * r, vx, vy };
  }

  /** A button is held now (drawing). */
  held(b: PadButton): boolean {
    for (const p of this.ptrs.values()) if (p.kind === "button" && p.button === b) return true;
    return false;
  }

  // --- PadProvider --------------------------------------------------------------------------------------------------

  read(_pads: readonly (GamepadLike | null)[] = []): ExternalPad[] {
    if (!this.touched) return [];
    const buttons: ExternalPad["buttons"] = {};
    for (const b of this.known) buttons[b] = { digital: this.held(b) || this.latched.has(b) };
    this.latched.clear();
    const [x, y] = this.output();
    return [
      {
        handle: this.handle,
        key: "touch",
        name: this.name,
        family: "touch",
        profile: "touch",
        buttons,
        stick: [x, y],
        cstick: [0, 0],
      },
    ];
  }

  // --- maths --------------------------------------------------------------------------------------------------------

  /** Stick output -1..1 per axis: deadzone, full tilt at the radius, optionally 8-way. */
  output(): [number, number] {
    const s = this.layout.stick;
    if (!s || this.stickPtr < 0) return [0, 0];
    return stickOutput(this.sp.x - this.sc.x, this.sp.y - this.sc.y, s.radius, s.deadzone ?? 0.18, !!s.eightWay);
  }

  /** Past the radius the centre follows the thumb (it never needs to come all the way back). */
  private pull(s: TouchStickLayout): void {
    const dx = this.sp.x - this.sc.x;
    const dy = this.sp.y - this.sc.y;
    const d = Math.hypot(dx, dy);
    if (d <= s.radius || s.mode === "fixed") return;
    const k = (d - s.radius) / d;
    this.sc = { x: this.sc.x + dx * k, y: this.sc.y + dy * k };
  }

  private takesStick(s: TouchStickLayout, x: number, y: number): boolean {
    if (s.mode === "fixed") return Math.hypot(x - s.cx, y - s.cy) <= s.radius * (s.grab ?? 1.6);
    const z = s.zone;
    return x >= z.x && y >= z.y && x < z.x + z.w && y < z.y + z.h;
  }

  /** The button under (x, y); the current one keeps a little extra margin (no flicker on an edge). */
  private buttonAt(x: number, y: number, current: PadButton | null): PadButton | null {
    let best: PadButton | null = null;
    let bd = Infinity;
    for (const b of this.layout.buttons) {
      const extra = b.id === current ? 1.25 : 1;
      let d: number;
      if (b.r !== undefined) {
        d = Math.hypot(x - b.x, y - b.y) / (b.r * extra);
      } else {
        const hw = ((b.w ?? 0) / 2) * extra;
        const hh = ((b.h ?? 0) / 2) * extra;
        d = Math.max(Math.abs(x - b.x) / hw, Math.abs(y - b.y) / hh);
      }
      if (d <= 1 && d < bd) {
        bd = d;
        best = b.id;
      }
    }
    return best;
  }

  // --- DOM ----------------------------------------------------------------------------------------------------------

  /**
   * Every touch the DOM layer sees, for an on-device diagnostic: down / move / up / cancel (and why), the pointer id,
   * CSS px, the target and what it took (stick, a button, nothing).
   */
  onTrace: ((t: { type: string; id: number; x: number; y: number; target: string; took: string }) => void) | null =
    null;

  private trace(type: string, id: number, x: number, y: number, target: EventTarget | null): void {
    if (!this.onTrace) return;
    const p = this.ptrs.get(id);
    const el = target as HTMLElement | null;
    const tname = el?.tagName ? `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}` : "?";
    this.onTrace({ type, id, x: Math.round(x), y: Math.round(y), target: tname, took: p ? p.kind : "-" });
  }

  /**
   * Wires an element's input (CSS px relative to the element's box) and stops the page from scrolling, zooming,
   * selecting text or opening the long-press menu while it's touched. Returns a detach function.
   * Touches: by default through Touch Events where the browser has them (every phone and tablet), each finger by its
   * identifier, every touchstart / touchmove default-prevented (non-passive), so a drag is never claimed as a
   * scroll or an edge swipe and turned into a cancel. Pointer events (with capture) are only for a mouse / pen
   * (`mouse` debugging), or for touches where there are no Touch Events. `events: "pointer"` forces the old path.
   */
  attach(el: HTMLElement, o: { events?: "auto" | "touch" | "pointer" } = {}): () => void {
    const st = el.style as CSSStyleDeclaration & { webkitUserSelect?: string; webkitTouchCallout?: string };
    st.touchAction = "none";
    st.userSelect = "none";
    st.webkitUserSelect = "none";
    st.webkitTouchCallout = "none";
    const touchApi =
      o.events === "touch" || (o.events !== "pointer" && typeof window !== "undefined" && "ontouchstart" in window);
    const box = () => el.getBoundingClientRect();
    // pointers: touches only when there's no Touch Events path
    const ours = (e: PointerEvent) =>
      (e.pointerType === "touch" && !touchApi) || e.pointerType === "pen" || (e.pointerType === "mouse" && this.mouse);
    const pos = (e: { clientX: number; clientY: number }): [number, number] => {
      const r = box();
      return [e.clientX - r.left, e.clientY - r.top];
    };
    const onDown = (e: PointerEvent) => {
      if (!ours(e)) return;
      e.preventDefault();
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        // (a synthetic or already-gone pointer)
      }
      this.down(e.pointerId, ...pos(e));
      this.trace("pointerdown", e.pointerId, ...pos(e), e.target);
    };
    const onMove = (e: PointerEvent) => {
      if (!ours(e) || !this.ptrs.has(e.pointerId)) return;
      e.preventDefault();
      this.move(e.pointerId, ...pos(e));
    };
    const onUp = (e: PointerEvent) => {
      if (!ours(e)) return;
      e.preventDefault();
      this.trace("pointerup", e.pointerId, ...pos(e), e.target);
      this.up(e.pointerId);
    };
    const onCancel = (e: PointerEvent) => {
      if (!ours(e)) return;
      this.trace(e.type, e.pointerId, ...pos(e), e.target);
      this.cancel(e.pointerId);
    };
    // touches: ids offset so they never meet a pointer id
    const T = 1_000_000;
    const each = (e: TouchEvent, f: (id: number, x: number, y: number) => void) => {
      for (const t of Array.from(e.changedTouches)) f(T + t.identifier, ...pos(t));
    };
    let moves = 0;
    const onTouchStart = (e: TouchEvent) => {
      if (e.cancelable) e.preventDefault();
      each(e, (id, x, y) => {
        this.down(id, x, y);
        this.trace("touchstart", id, x, y, e.target);
      });
    };
    const onTouchMove = (e: TouchEvent) => {
      if (e.cancelable) e.preventDefault();
      each(e, (id, x, y) => {
        this.move(id, x, y);
        // (one move in eight: the log shows the drag without drowning in it)
        if (moves++ % 8 === 0) this.trace("touchmove", id, x, y, e.target);
      });
    };
    const onTouchEnd = (e: TouchEvent) => {
      if (e.cancelable) e.preventDefault();
      each(e, (id, x, y) => {
        this.trace(e.type, id, x, y, e.target);
        if (e.type === "touchcancel") this.cancel(id);
        else this.up(id);
      });
    };
    const stop = (e: Event) => e.preventDefault();
    const onHide = () => {
      if (document.hidden) this.releaseAll();
    };
    const opts = { passive: false } as AddEventListenerOptions;
    const on: [EventTarget, string, EventListener, AddEventListenerOptions?][] = [
      [el, "pointerdown", onDown as EventListener, opts],
      [el, "pointermove", onMove as EventListener, opts],
      [el, "pointerup", onUp as EventListener, opts],
      [el, "pointercancel", onCancel as EventListener],
      [el, "lostpointercapture", onCancel as EventListener],
      [el, "contextmenu", stop],
      [el, "selectstart", stop],
      [el, "gesturestart", stop, opts],
      [document, "visibilitychange", onHide],
    ];
    if (touchApi)
      on.push(
        [el, "touchstart", onTouchStart as EventListener, opts],
        [el, "touchmove", onTouchMove as EventListener, opts],
        [el, "touchend", onTouchEnd as EventListener, opts],
        [el, "touchcancel", onTouchEnd as EventListener, opts],
      );
    // no scroll / pinch / double-tap zoom anywhere on the page while a finger is down (iOS: a drag that the page
    // could scroll is otherwise taken as a scroll and the touch cancelled)
    else on.push([el, "touchstart", stop, opts], [el, "touchmove", stop, opts]);
    if (typeof document !== "undefined") on.push([document, "touchmove", stop, opts]);
    for (const [t, k, f, op] of on) t.addEventListener(k, f, op);
    const blur = () => this.releaseAll();
    window.addEventListener("blur", blur);
    return () => {
      for (const [t, k, f] of on) t.removeEventListener(k, f);
      window.removeEventListener("blur", blur);
    };
  }
}

/**
 * A stick vector (thumb minus centre, px) as output: nothing inside the deadzone, then rising to full tilt at the
 * radius (rescaled so the edge of the deadzone is 0, not a jump); eightWay snaps to 8 directions at full tilt.
 */
export function stickOutput(
  dx: number,
  dy: number,
  radius: number,
  deadzone: number,
  eightWay = false,
): [number, number] {
  const d = Math.hypot(dx, dy);
  const dz = deadzone * radius;
  if (d <= dz || d === 0) return [0, 0];
  if (eightWay) {
    const a = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
    const x = Math.cos(a);
    const y = Math.sin(a);
    return [Math.abs(x) < 1e-9 ? 0 : x, Math.abs(y) < 1e-9 ? 0 : y];
  }
  const m = Math.min(1, (d - dz) / (radius - dz));
  return [(dx / d) * m, (dy / d) * m];
}
