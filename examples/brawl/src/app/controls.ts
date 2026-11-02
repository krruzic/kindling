// Input (@kindling/input): the game's actions, default bindings per device family, two keyboard halves, the
// GameCube adapter and Switch 2 / NSO pads over WebHID, remaps saved in the save, the PadState -> Command mapper
// (with a per-seat latch so a tap between two ticks is never lost), menu navigation from every device, and glyphs
// for prompts in the player's own device style.
import { attachDom, InputManager, keyLabel, MenuNavigator, type KeyboardLayout, type PadState } from "@kindling/input";
import { GcAdapter, ProCon2, ProCon2Waker, requestHidPads } from "@kindling/input/hid";
import type { Glyph, Nav } from "@kindling/ui";
import { codec } from "../sim/codec.ts";
import { IDLE, type Command } from "../sim/types.ts";
import type { Save } from "./save.ts";

export const ACTIONS = ["attack", "dash", "special", "cpu", "pause", "back", "up", "down", "left", "right"] as const;
export type Action = (typeof ACTIONS)[number];

/** What a guided remap walks through (the moves and the pause button). */
export const REMAP_STEPS: Action[] = ["attack", "dash", "special", "cpu", "pause"];

export const ACTION_NAMES: Record<Action, string> = {
  attack: "BLAST",
  dash: "DASH",
  special: "SLAM",
  cpu: "ADD CPU",
  pause: "PAUSE",
  back: "BACK",
  up: "UP",
  down: "DOWN",
  left: "LEFT",
  right: "RIGHT",
};

const WASD = { up: ["KeyW"], down: ["KeyS"], left: ["KeyA"], right: ["KeyD"] };
const ARROWS = { up: ["ArrowUp"], down: ["ArrowDown"], left: ["ArrowLeft"], right: ["ArrowRight"] };

export const KEYBOARDS: KeyboardLayout<Action>[] = [
  {
    name: "KEYS LEFT",
    stick: WASD,
    buttons: {
      attack: ["Space", "KeyF"],
      dash: ["ShiftLeft", "KeyG"],
      special: ["KeyE", "KeyH"],
      cpu: ["KeyC"],
      pause: ["Escape", "Tab"],
      back: ["Escape", "KeyQ"],
      ...WASD,
    },
  },
  {
    name: "KEYS RIGHT",
    stick: ARROWS,
    buttons: {
      attack: ["Period", "Numpad0"],
      dash: ["Comma", "ShiftRight"],
      special: ["Slash", "KeyL"],
      cpu: ["KeyM"],
      pause: ["Enter", "NumpadEnter"],
      back: ["Backspace"],
      ...ARROWS,
    },
  },
];

export class Controls {
  readonly input: InputManager<Action>;
  readonly nav = new MenuNavigator<Action>({
    up: "up",
    down: "down",
    left: "left",
    right: "right",
    confirm: ["attack", "pause"],
    back: ["back"],
  });
  readonly gc = new GcAdapter();
  readonly pro = new ProCon2();
  private queues: Command[][] = [[], [], [], []];
  private last: Command[] = [IDLE, IDLE, IDLE, IDLE];

  constructor(save: Save) {
    new ProCon2Waker();
    this.input = new InputManager<Action>({
      actions: ACTIONS,
      seats: 4,
      bindings: {
        default: {
          attack: ["south"],
          dash: ["east", "rb"],
          special: ["west", "rt", "lt"],
          cpu: ["north"],
          pause: ["start"],
          back: ["east", "back"],
          up: ["up"],
          down: ["down"],
          left: ["left"],
          right: ["right"],
        },
        // Nintendo layouts print A on the east button: confirm / attack goes there.
        switch: { attack: ["east"], dash: ["south", "rb"], back: ["south", "back"] },
        // GameCube: big A, B left of it, X / Y round the top; R / L analog (either channel counts).
        gc: { attack: ["south"], dash: ["west", "rb"], special: ["east", "rt", "lt"], back: ["west"] },
      },
      keyboards: KEYBOARDS,
      providers: [this.gc, this.pro],
      remaps: {
        load: () => save.data.pads,
        save: (d) => {
          save.data.pads = d;
          save.write();
        },
      },
      labels: {
        attack: { label: "A", color: "#3f9b36" },
        dash: { label: "B", color: "#c8352b" },
        special: { label: "X", color: "#2f63d6" },
        cpu: { label: "Y", color: "#d8a91b" },
        pause: { label: "START" },
        back: { label: "B", color: "#c8352b" },
      },
      triggerOn: { rt: 0.6, lt: 0.6 },
    });
    this.input.joining = false;
    attachDom(this.input.keyboard);
  }

  /** WebHID pads need a user gesture (the controller setup screen's "FIND USB PADS"). */
  findHid(): void {
    void requestHidPads(this.gc, this.pro);
  }

  poll(now: number): void {
    this.input.poll(now);
  }

  /** One frame of menu input from every device (seated or not), in the ui package's Nav shape. */
  menu(now: number, onlySeat = -1): Nav & { seat: number; pressed: Partial<Record<Action, boolean>> } {
    const pads = onlySeat >= 0 ? this.input.players : this.input.devicePads();
    const n = this.nav.read(pads, now, onlySeat);
    return {
      dx: n.dx,
      dy: n.dy,
      a: n.confirm,
      b: n.back,
      x: !!n.pressed.special,
      y: !!n.pressed.cpu,
      seat: n.seat,
      pressed: n.pressed,
    };
  }

  /** A seat's input this frame as a sim Command (sticks quantised to -100..100). */
  static command(p: PadState<Action>): Command {
    if (!p.connected) return IDLE;
    let x = p.stickX;
    let y = p.stickY;
    if (!x && !y) {
      x = (p.held.right ? 1 : 0) - (p.held.left ? 1 : 0);
      y = (p.held.down ? 1 : 0) - (p.held.up ? 1 : 0);
    }
    const m = Math.hypot(x, y);
    if (m > 1) {
      x /= m;
      y /= m;
    }
    return {
      mx: Math.round(x * 100),
      mz: Math.round(y * 100),
      attack: p.pressed.attack,
      dash: p.pressed.dash,
      special: p.pressed.special,
    };
  }

  /** Queue this frame's command for a seat (local play): merged per tick so taps between ticks count. */
  latch(seat: number, cmd: Command): void {
    const q = this.queues[seat];
    if (q.length < 32) q.push(cmd);
  }

  /** The merged command for a seat's next tick (consumes the latch). */
  take(seat: number): Command {
    const m = codec.merge(this.queues[seat], this.last[seat]);
    this.queues[seat] = [];
    this.last[seat] = m;
    return m;
  }

  clearLatches(): void {
    this.queues = [[], [], [], []];
    this.last = [IDLE, IDLE, IDLE, IDLE];
  }

  /** Prompt glyph for an action in the style of the device used last (or a seat's device). */
  glyph(action: Action, seat?: number): Glyph {
    if (action === "left" || action === "right") return this.dirGlyph("x", seat);
    if (action === "up" || action === "down") return this.dirGlyph("y", seat);
    return this.input.glyph(action, { mode: "auto", seat });
  }

  /** A direction pair as one glyph: arrows on pads, the two keys of the stick on a keyboard half. */
  dirGlyph(axis: "x" | "y", seat?: number): Glyph {
    const g = this.input.glyph("attack", { mode: "auto", seat });
    if (g.family !== "keyboard")
      return { label: axis === "x" ? "\u2190\u2192" : "\u2191\u2193", family: g.family, color: "#4a4a56" };
    const kb = KEYBOARDS.find((k) => Object.values(k.buttons).some((c) => c?.includes(g.source ?? ""))) ?? KEYBOARDS[0];
    const [a, b] = axis === "x" ? [kb.stick.left[0], kb.stick.right[0]] : [kb.stick.up[0], kb.stick.down[0]];
    const lab = (c: string) =>
      keyLabel(c)
        .replace("LEFT", "\u2190")
        .replace("RIGHT", "\u2192")
        .replace("UP", "\u2191")
        .replace("DOWN", "\u2193");
    return { label: `${lab(a)}${lab(b)}`, family: "keyboard", color: g.color };
  }
}
