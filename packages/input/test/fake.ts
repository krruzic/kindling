// Fake Gamepad objects and a small game setup shared by the tests.
import { InputManager, type InputOptions, type KeyboardLayout } from "../src/index.ts";
import type { GamepadLike, RemapData } from "../src/index.ts";

export class FakePad implements GamepadLike {
  connected = true;
  axes: number[];
  buttons: { value: number; pressed: boolean }[];

  constructor(
    public id: string,
    public index: number,
    public mapping = "standard",
    nButtons = 17,
    nAxes = 4,
  ) {
    this.axes = Array<number>(nAxes).fill(0);
    this.buttons = Array.from({ length: nButtons }, () => ({ value: 0, pressed: false }));
  }

  set(i: number, value: number): this {
    this.buttons[i] = { value, pressed: value > 0.5 };
    return this;
  }

  press(i: number): this {
    return this.set(i, 1);
  }

  up(i: number): this {
    return this.set(i, 0);
  }

  axis(i: number, v: number): this {
    this.axes[i] = v;
    return this;
  }
}

export const XBOX_ID = "Xbox 360 Controller (XInput STANDARD GAMEPAD)";
export const DS4_ID = "Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 09cc)";

export type Act = "jump" | "attack" | "special" | "pause" | "up" | "down" | "left" | "right";
export const ACTS: Act[] = ["jump", "attack", "special", "pause", "up", "down", "left", "right"];

export const KB_LEFT: KeyboardLayout<Act> = {
  stick: { up: ["KeyW"], down: ["KeyS"], left: ["KeyA"], right: ["KeyD"] },
  buttons: { jump: ["KeyJ"], attack: ["KeyK"], special: ["KeyL"], pause: ["Escape"], up: ["KeyW"], down: ["KeyS"] },
  mouse: true,
};
export const KB_RIGHT: KeyboardLayout<Act> = {
  stick: { up: ["ArrowUp"], down: ["ArrowDown"], left: ["ArrowLeft"], right: ["ArrowRight"] },
  buttons: {
    jump: ["Period"],
    attack: ["Comma"],
    special: ["Slash"],
    pause: ["Enter"],
    up: ["ArrowUp"],
    down: ["ArrowDown"],
  },
};

/** A game with a pad list it controls, remaps saved into `saved`. */
export function setup(extra: Partial<InputOptions<Act>> = {}) {
  const pads: (GamepadLike | null)[] = [];
  const saved: { data: RemapData | null; writes: number } = { data: null, writes: 0 };
  const input = new InputManager<Act>({
    actions: ACTS,
    seats: 4,
    bindings: {
      default: {
        jump: ["south"],
        attack: ["west"],
        special: ["rt"],
        pause: ["start"],
        up: ["up"],
        down: ["down"],
        left: ["left"],
        right: ["right"],
      },
      switch: { jump: ["east"], attack: ["north"] },
    },
    gamepads: () => pads,
    remaps: {
      load: () => saved.data,
      save: (d) => {
        saved.data = structuredClone(d);
        saved.writes++;
      },
    },
    labels: { jump: { label: "A", color: "#2f5fd8" }, attack: { label: "B" } },
    ...extra,
  });
  let t = 0;
  const step = (n = 1, dt = 1 / 60) => {
    for (let i = 0; i < n; i++) input.poll((t += dt));
  };
  return { input, pads, saved, step, now: () => t };
}
