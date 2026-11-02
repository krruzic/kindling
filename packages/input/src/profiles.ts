// Profiles: how a browser Gamepad's raw buttons and axes map onto the canonical PadButtons, matched by Gamepad id.
// Standard-mapping pads need no profile (the browser already orders their buttons); the built-ins cover the odd
// devices couch players actually own: Mayflash GameCube adapters in PC mode, Linux uinput GameCube drivers
// (wii-u-gc-adapter), Switch 2 GameCube / Pro pads over Bluetooth and a Switch 2 Pro on hid-generic (raw USB).
// All data: a game can prepend its own (matched first) without code.
import type { PadButton, PadFamily } from "./types.ts";
import { STANDARD_BUTTONS } from "./types.ts";

export interface AxisRef {
  axis: number;
  invert?: boolean;
  /** Raw pads whose stick never reaches the axis's logical end (a Switch 2 Pro on hid-generic: ~70%). */
  scale?: number;
}

/** A trigger (or any button) read from one half of an axis: `max >= min` is the + half, else the - half. */
export interface AxisButton {
  axis: number;
  min?: number;
  max?: number;
  /** Travel above rest that counts as pressed. */
  threshold?: number;
}

export interface Profile {
  id: string;
  /** Case-insensitive substrings of Gamepad.id; "" matches everything. */
  match: string[];
  family?: PadFamily;
  /** Only for pads without the standard mapping (with it, the browser already fixed the layout). */
  rawOnly?: boolean;
  stick: { x: AxisRef; y: AxisRef };
  cstick: { x: AxisRef; y: AxisRef };
  buttons: Partial<Record<PadButton, number[]>>;
  axisButtons?: Partial<Record<PadButton, AxisButton | AxisButton[]>>;
  /** Analog thresholds per canonical button (overrides the manager's triggerOn). */
  thresholds?: Partial<Record<PadButton, number>>;
}

const sticks = (cx: number, cy: number) => ({
  stick: { x: { axis: 0 }, y: { axis: 1 } },
  cstick: { x: { axis: cx }, y: { axis: cy } },
});

const dpad = (up: number, down: number, left: number, right: number) => ({
  up: [up],
  down: [down],
  left: [left],
  right: [right],
});

export const STANDARD_PROFILE: Profile = {
  id: "standard",
  match: [""],
  ...sticks(2, 3),
  buttons: Object.fromEntries(STANDARD_BUTTONS.map((b, i) => [b, [i]])),
};

export const BUILTIN_PROFILES: Profile[] = [
  {
    id: "switch2_bt_gc",
    match: ["switch 2 bt gc"],
    family: "gc",
    ...sticks(2, 3),
    buttons: {
      south: [0],
      west: [1],
      east: [2],
      north: [3],
      lb: [4],
      rb: [5],
      lt: [6],
      rt: [7],
      start: [9],
      ...dpad(12, 13, 14, 15),
    },
    thresholds: { rt: 0.95, lt: 0.3 },
  },
  {
    id: "switch2_bt_pro",
    match: ["switch 2 bt pro", "switch pro bt"],
    family: "switch",
    ...sticks(2, 3),
    buttons: {
      east: [0],
      south: [1],
      north: [2],
      west: [3],
      lt: [4],
      rt: [5],
      lb: [6],
      rb: [7],
      start: [9],
      ls: [10],
      ...dpad(12, 13, 14, 15),
    },
  },
  {
    id: "gc_adapter_uinput",
    match: [
      "nintendo wup-028",
      "wii u gamecube adapter port",
      "standard gamecube controller",
      "wavebird gamecube controller",
    ],
    family: "gc",
    rawOnly: true,
    ...sticks(3, 4),
    buttons: {
      south: [0],
      east: [1],
      north: [2],
      west: [3],
      lt: [4],
      rt: [5],
      rb: [6],
      start: [7],
      ...dpad(8, 9, 10, 11),
    },
    axisButtons: { lt: { axis: 2, min: -1, max: 1 }, rt: { axis: 5, min: -1, max: 1 } },
  },
  {
    id: "mayflash_gc",
    match: ["gamecube", "0079-1846", "0079-1844", "0079-1843", "057e-0337", "mayflash"],
    family: "gc",
    ...sticks(5, 2),
    buttons: {
      east: [0],
      south: [1],
      west: [2],
      north: [3],
      lt: [4],
      rt: [5],
      rb: [7],
      start: [9],
      ...dpad(12, 13, 14, 15),
    },
    axisButtons: { lt: { axis: 3, min: -1, max: 1 }, rt: { axis: 4, min: -1, max: 1 } },
  },
  {
    id: "switch2_usb_pro",
    match: ["product: 2069"],
    family: "switch",
    rawOnly: true,
    stick: { x: { axis: 0, scale: 1.4 }, y: { axis: 1, invert: true, scale: 1.4 } },
    cstick: { x: { axis: 2, scale: 1.4 }, y: { axis: 3, invert: true, scale: 1.4 } },
    buttons: {
      south: [0],
      east: [1],
      west: [2],
      north: [3],
      rt: [4],
      rb: [5],
      start: [6],
      lt: [12],
      lb: [13],
      ...dpad(11, 8, 10, 9),
    },
  },
];

/** The profile for a gamepad: the first whose `match` hits its id (a rawOnly one yields standard on standard pads). */
export function profileFor(
  pad: { id: string; mapping: string },
  profiles: readonly Profile[] = BUILTIN_PROFILES,
): Profile {
  const id = pad.id.toLowerCase();
  const standard = pad.mapping === "standard";
  for (const p of profiles) {
    if (!p.match.some((m) => id.includes(m.toLowerCase()))) continue;
    // A raw-layout match with the standard mapping: the browser already fixed the layout (don't fall to a later one).
    return p.rawOnly && standard ? STANDARD_PROFILE : p;
  }
  return STANDARD_PROFILE;
}

/** Source ids ("b3", "a2+") a profile reads a canonical button from. */
export function profileSources(p: Profile, b: PadButton): string[] {
  const out = (p.buttons[b] ?? []).map((i) => `b${i}`);
  for (const ab of [p.axisButtons?.[b] ?? []].flat()) out.push(axisSourceId(ab));
  return out;
}

export function axisSourceId(ab: AxisButton): string {
  return `a${ab.axis}${(ab.max ?? 1) >= (ab.min ?? -1) ? "+" : "-"}`;
}
