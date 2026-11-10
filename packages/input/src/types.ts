// Shared input types: the canonical physical buttons every pad is described in, device families, the per-device /
// per-seat PadState the game reads, and the minimal Gamepad shape the core needs (so node tests can use fakes).

/**
 * Canonical physical buttons, by POSITION on a standard (Xbox-shaped) pad. Profiles map a device's raw buttons and
 * axes onto these; games bind their actions to these per family. GameCube pads use: A = south, B = west, X = east,
 * Y = north, Z = rb, L = lt, R = rt, ZL (NSO pad) = lb.
 */
export type PadButton =
  | "south"
  | "east"
  | "west"
  | "north"
  | "lb"
  | "rb"
  | "lt"
  | "rt"
  | "back"
  | "start"
  | "ls"
  | "rs"
  | "up"
  | "down"
  | "left"
  | "right"
  | "home"
  | "capture";

/** Standard-mapping Gamepad.buttons order (https://w3c.github.io/gamepad/#remapping). */
export const STANDARD_BUTTONS: readonly PadButton[] = [
  "south",
  "east",
  "west",
  "north",
  "lb",
  "rb",
  "lt",
  "rt",
  "back",
  "start",
  "ls",
  "rs",
  "up",
  "down",
  "left",
  "right",
  "home",
  "capture",
];

/** Which pad a device looks like: picks labels, colours and the game's per-family default bindings ("touch": a
 * TouchPad, whose buttons carry no printed labels: prompts show the game's own). */
export type PadFamily = "xbox" | "playstation" | "switch" | "gc" | "generic" | "keyboard" | "touch";

/** The parts of the browser Gamepad the core reads (real Gamepads satisfy it; tests pass plain objects). */
export interface GamepadLike {
  id: string;
  index: number;
  connected: boolean;
  mapping: string;
  axes: readonly number[];
  buttons: readonly { value: number; pressed: boolean }[];
}

/** Pointer state for a keyboard half that owns the mouse. */
export interface PointerState {
  x: number;
  y: number;
  left: boolean;
  right: boolean;
  middle: boolean;
  /** Wheel delta accumulated since the last poll. */
  wheel: number;
}

/** One device's (or seat's) input this frame, by the game's action names. */
export interface PadState<A extends string> {
  connected: boolean;
  /** Runtime handle of the device ("pad-0", "gc-port-1", "keyboard-1"); "" when empty. */
  device: string;
  /** Remap key (Gamepad id, adapter port, keyboard half). */
  key: string;
  name: string;
  family: PadFamily;
  profile: string;
  stickX: number;
  stickY: number;
  cX: number;
  cY: number;
  /** Trigger travel above rest, 0..1 (0 on devices without analog triggers). */
  lt: number;
  rt: number;
  held: Record<A, boolean>;
  pressed: Record<A, boolean>;
  released: Record<A, boolean>;
  pointer?: PointerState;
}

export type Bindings<A extends string> = Record<A, string[]>;

/** Remaps saved per device key: action -> source ids. */
export type RemapData = Record<string, Record<string, string[]>>;

export function emptyFlags<A extends string>(actions: readonly A[]): Record<A, boolean> {
  const r = {} as Record<A, boolean>;
  for (const a of actions) r[a] = false;
  return r;
}

export function emptyPad<A extends string>(actions: readonly A[]): PadState<A> {
  return {
    connected: false,
    device: "",
    key: "",
    name: "",
    family: "generic",
    profile: "",
    stickX: 0,
    stickY: 0,
    cX: 0,
    cY: 0,
    lt: 0,
    rt: 0,
    held: emptyFlags(actions),
    pressed: emptyFlags(actions),
    released: emptyFlags(actions),
  };
}
