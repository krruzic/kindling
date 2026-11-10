// Device families: detection from a Gamepad id (Chromium "Name (STANDARD GAMEPAD Vendor: 054c Product: 09cc)",
// Firefox "054c-09cc-Name"), the label and colour each family prints on each canonical button, keyboard key names,
// and display names. Pure data and string matching; no DOM.
import type { PadButton, PadFamily } from "./types.ts";

/** USB vendor / product parsed from a Gamepad id (lower-case hex), or null. */
export function vendorProduct(id: string): { vendor: string; product: string } | null {
  const c = /vendor:\s*([0-9a-f]{4}).*?product:\s*([0-9a-f]{4})/i.exec(id);
  if (c) return { vendor: c[1].toLowerCase(), product: c[2].toLowerCase() };
  const f = /^([0-9a-f]{1,4})-([0-9a-f]{1,4})-/i.exec(id);
  if (f) return { vendor: f[1].toLowerCase().padStart(4, "0"), product: f[2].toLowerCase().padStart(4, "0") };
  return null;
}

const SONY = ["054c"];
const MICROSOFT = ["045e"];
const NINTENDO = ["057e"];
/** Third-party Switch pads (PowerA, PDP, Hori). */
const SWITCH_3P = ["20d6", "0e6f", "0f0d"];

/**
 * Family of a browser gamepad from its id and mapping. Unknown pads with the standard mapping read as Xbox (most
 * clones are XInput); without it they are "generic" (raw button numbers).
 */
export function detectFamily(id: string, mapping = "standard"): PadFamily {
  const s = id.toLowerCase();
  const vp = vendorProduct(id);
  if (/gamecube|wup-028|wavebird/.test(s) || (vp && vp.vendor === "0079" && /^184[346]$/.test(vp.product))) return "gc";
  if (vp && NINTENDO.includes(vp.vendor) && (vp.product === "0337" || vp.product === "2073")) return "gc";
  if (/xbox|x-box|xinput|microsoft/.test(s) || (vp && MICROSOFT.includes(vp.vendor))) return "xbox";
  if (/playstation|dualshock|dualsense|sony|ps[345] /.test(s) || (vp && SONY.includes(vp.vendor))) return "playstation";
  if (/nintendo|switch|pro controller|joy-con/.test(s) || (vp && [...NINTENDO, ...SWITCH_3P].includes(vp.vendor)))
    return "switch";
  if (mapping !== "standard") return "generic";
  return "xbox";
}

/** Upper-case display name from a Gamepad id ("Xbox 360 Controller (XInput STANDARD GAMEPAD)" -> "XBOX 360 ..."). */
export function cleanPadName(id: string): string {
  const s = id
    .replace(/\(.*?\)/g, "")
    .replace(/^[0-9a-f]{1,4}-[0-9a-f]{1,4}-/i, "")
    .replace(/[^A-Za-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
  return s ? s.slice(0, 30) : "CONTROLLER";
}

/** Shape a renderer draws for PlayStation face buttons (labels stay ASCII for bitmap fonts). */
export type GlyphShape = "cross" | "circle" | "square" | "triangle";

export interface ButtonFace {
  label: string;
  color: string;
  shape?: GlyphShape;
}

const GREY = "#5a5a64";
const DPAD: Partial<Record<PadButton, string>> = { up: "UP", down: "DOWN", left: "LEFT", right: "RIGHT" };

const XBOX: Record<PadButton, string> = {
  south: "A",
  east: "B",
  west: "X",
  north: "Y",
  lb: "LB",
  rb: "RB",
  lt: "LT",
  rt: "RT",
  back: "VIEW",
  start: "MENU",
  ls: "LS",
  rs: "RS",
  up: "UP",
  down: "DOWN",
  left: "LEFT",
  right: "RIGHT",
  home: "HOME",
  capture: "SHARE",
};
const PLAYSTATION: Record<PadButton, string> = {
  south: "CROSS",
  east: "CIRCLE",
  west: "SQUARE",
  north: "TRIANGLE",
  lb: "L1",
  rb: "R1",
  lt: "L2",
  rt: "R2",
  back: "SHARE",
  start: "OPTIONS",
  ls: "L3",
  rs: "R3",
  up: "UP",
  down: "DOWN",
  left: "LEFT",
  right: "RIGHT",
  home: "PS",
  capture: "TOUCHPAD",
};
const SWITCH: Record<PadButton, string> = {
  south: "B",
  east: "A",
  west: "Y",
  north: "X",
  lb: "L",
  rb: "R",
  lt: "ZL",
  rt: "ZR",
  back: "-",
  start: "+",
  ls: "LS",
  rs: "RS",
  up: "UP",
  down: "DOWN",
  left: "LEFT",
  right: "RIGHT",
  home: "HOME",
  capture: "CAPTURE",
};
const GC: Record<PadButton, string> = {
  south: "A",
  east: "X",
  west: "B",
  north: "Y",
  lb: "ZL",
  rb: "Z",
  lt: "L",
  rt: "R",
  back: "SELECT",
  start: "START",
  ls: "LS",
  rs: "RS",
  up: "UP",
  down: "DOWN",
  left: "LEFT",
  right: "RIGHT",
  home: "HOME",
  capture: "CAPTURE",
};
const GENERIC: Record<PadButton, string> = {
  ...XBOX,
  south: "1",
  east: "2",
  west: "3",
  north: "4",
  back: "SELECT",
  start: "START",
};

const LABELS: Record<Exclude<PadFamily, "keyboard">, Record<PadButton, string>> = {
  xbox: XBOX,
  playstation: PLAYSTATION,
  switch: SWITCH,
  gc: GC,
  generic: GENERIC,
  touch: GENERIC,
};

const COLORS: Partial<Record<PadFamily, Partial<Record<PadButton, string>>>> = {
  xbox: { south: "#3a9a30", east: "#c82820", west: "#2a5ad8", north: "#d8a818" },
  playstation: { south: "#6c8fd9", east: "#e0504a", west: "#d77fc0", north: "#3fbfa0" },
  gc: { south: "#1fa37a", west: "#d8332f", east: "#b8b8c0", north: "#b8b8c0", rb: "#6a4ac8", start: "#8a8a94" },
};

const SHAPES: Partial<Record<PadButton, GlyphShape>> = {
  south: "cross",
  east: "circle",
  west: "square",
  north: "triangle",
};

/** Label, colour (and shape on PlayStation) a family prints on a canonical button. */
export function buttonFace(family: PadFamily, b: PadButton): ButtonFace {
  const fam = family === "keyboard" ? "generic" : family;
  const face: ButtonFace = { label: LABELS[fam][b] ?? DPAD[b] ?? b.toUpperCase(), color: COLORS[family]?.[b] ?? GREY };
  if (family === "playstation" && SHAPES[b]) face.shape = SHAPES[b];
  return face;
}

/** Keycap colour of keyboard glyphs (a light cap with a dark legend, as every prompt painter draws keys). */
export const KEYCAP = "#e8e4dc";

/**
 * Colour of a physical button (for labels that came from elsewhere, e.g. a remap): the button's own colour on a
 * pad, the keycap colour on a keyboard.
 */
export function familyColor(family: PadFamily, label: string): string {
  if (family === "keyboard") return KEYCAP;
  const fam = family === "generic" ? "generic" : family;
  const b = (Object.keys(LABELS[fam]) as PadButton[]).find((k) => LABELS[fam][k] === label);
  return b ? buttonFace(family, b).color : GREY;
}

const KEY_NAMES: Record<string, string> = {
  ArrowUp: "UP",
  ArrowDown: "DOWN",
  ArrowLeft: "LEFT",
  ArrowRight: "RIGHT",
  Space: "SPACE",
  Enter: "ENTER",
  NumpadEnter: "ENTER",
  Escape: "ESC",
  Backspace: "BKSP",
  Tab: "TAB",
  ShiftLeft: "SHIFT",
  ShiftRight: "R-SHIFT",
  ControlLeft: "CTRL",
  ControlRight: "R-CTRL",
  AltLeft: "ALT",
  AltRight: "R-ALT",
  Period: ".",
  Comma: ",",
  Slash: "/",
  Semicolon: ";",
  Quote: "'",
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  Minus: "-",
  Equal: "=",
  Backquote: "`",
  Mouse0: "LMB",
  Mouse1: "MMB",
  Mouse2: "RMB",
};

/** Short printable name of a KeyboardEvent.code ("KeyA" -> "A", "Digit1" -> "1", "ArrowUp" -> "UP"). */
export function keyLabel(code: string): string {
  if (KEY_NAMES[code]) return KEY_NAMES[code];
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^Numpad\d$/.test(code)) return "NUM " + code.slice(6);
  if (/^F\d+$/.test(code)) return code;
  return code.toUpperCase().slice(0, 8);
}

/** Human name of a family's layout (controller setup pages). */
export const FAMILY_NAME: Record<PadFamily, string> = {
  xbox: "XBOX-STYLE",
  playstation: "PLAYSTATION",
  switch: "SWITCH-STYLE",
  gc: "GAMECUBE",
  generic: "UNKNOWN LAYOUT",
  keyboard: "KEYBOARD",
  touch: "TOUCH SCREEN",
};
