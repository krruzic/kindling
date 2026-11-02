// Keyboard + mouse state shared by every keyboard half. The core only sees method calls (keyDown / keyUp /
// mouseDown...), so node tests drive it directly; attachDom() wires it to window events in the browser. A key
// pressed and released between two polls still reads as held for one poll (taps aren't lost at low frame rates).
import type { PointerState } from "./types.ts";

export class KeyboardInput {
  readonly keys = new Set<string>();
  private tapped = new Set<string>();
  readonly mouse: PointerState = { x: 0, y: 0, left: false, right: false, middle: false, wheel: 0 };
  /** A text field has the keyboard: only mouse codes stay live. */
  typing = false;
  /** Codes the game uses; attachDom prevents their default browser action (scrolling on arrows / space). */
  captured = new Set<string>();

  keyDown(code: string): void {
    this.keys.add(code);
    this.tapped.add(code);
  }

  keyUp(code: string): void {
    this.keys.delete(code);
  }

  /** Window lost focus: nothing stays held. */
  blur(): void {
    this.keys.clear();
    this.mouse.left = this.mouse.right = this.mouse.middle = false;
  }

  mouseMove(x: number, y: number): void {
    this.mouse.x = x;
    this.mouse.y = y;
  }

  /** DOM button numbers: 0 left, 1 middle, 2 right (read as codes "Mouse0" / "Mouse1" / "Mouse2"). */
  mouseDown(button: number): void {
    if (button === 0) this.mouse.left = true;
    if (button === 1) this.mouse.middle = true;
    if (button === 2) this.mouse.right = true;
    this.keyDown(`Mouse${button}`);
  }

  mouseUp(button: number): void {
    if (button === 0) this.mouse.left = false;
    if (button === 1) this.mouse.middle = false;
    if (button === 2) this.mouse.right = false;
    this.keyUp(`Mouse${button}`);
  }

  wheel(dy: number): void {
    this.mouse.wheel += dy;
  }

  isDown(code: string): boolean {
    if (this.typing && !code.startsWith("Mouse")) return false;
    return this.keys.has(code) || this.tapped.has(code);
  }

  /** Codes down (or tapped) this poll. */
  down(): string[] {
    return [...new Set([...this.keys, ...this.tapped])].filter((c) => this.isDown(c));
  }

  /** Called by the manager at the end of each poll. */
  endFrame(): void {
    this.tapped.clear();
    this.mouse.wheel = 0;
  }
}

type Listen = (type: string, fn: (e: never) => void, opts?: AddEventListenerOptions) => void;

/** Wires a KeyboardInput to DOM events on `target` (default window). Returns a detach function. */
export function attachDom(kb: KeyboardInput, target: EventTarget = globalThis as unknown as EventTarget): () => void {
  const on: [string, (e: never) => void][] = [
    [
      "keydown",
      (e: KeyboardEvent) => {
        if (kb.captured.has(e.code) && !kb.typing) e.preventDefault();
        if (!e.repeat) kb.keyDown(e.code);
      },
    ],
    ["keyup", (e: KeyboardEvent) => kb.keyUp(e.code)],
    ["blur", () => kb.blur()],
    ["mousemove", (e: MouseEvent) => kb.mouseMove(e.clientX, e.clientY)],
    [
      "mousedown",
      (e: MouseEvent) => {
        kb.mouseMove(e.clientX, e.clientY);
        kb.mouseDown(e.button);
      },
    ],
    ["mouseup", (e: MouseEvent) => kb.mouseUp(e.button)],
    ["wheel", (e: WheelEvent) => kb.wheel(e.deltaY)],
  ];
  const add = target.addEventListener.bind(target) as unknown as Listen;
  const remove = target.removeEventListener.bind(target) as unknown as Listen;
  for (const [t, fn] of on) add(t, fn, { passive: t !== "keydown" });
  return () => {
    for (const [t, fn] of on) remove(t, fn);
  };
}
