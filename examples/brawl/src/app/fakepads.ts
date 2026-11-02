// Debug only: fake browser gamepads for screenshots and tests (?pads=xbox,ps,switch,gc). They replace
// navigator.getGamepads, so the whole @kindling/input path runs as with real pads: family detection, profiles
// (the GameCube one is a Mayflash adapter in PC mode, raw layout), glyphs, seats. `&join` makes each pad press
// its A button once, a few frames apart, so they take seats on the select screen.
interface FakePad {
  id: string;
  index: number;
  connected: boolean;
  mapping: string;
  axes: number[];
  buttons: { value: number; pressed: boolean; touched: boolean }[];
  timestamp: number;
  /** Raw button that is A on this pad. */
  a: number;
}

const KINDS: Record<string, { id: string; mapping: string; buttons: number; axes: number[]; a: number }> = {
  xbox: {
    id: "Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)",
    mapping: "standard",
    buttons: 17,
    axes: [0, 0, 0, 0],
    a: 0,
  },
  ps: {
    id: "DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)",
    mapping: "standard",
    buttons: 17,
    axes: [0, 0, 0, 0],
    a: 0,
  },
  switch: {
    id: "Pro Controller (STANDARD GAMEPAD Vendor: 057e Product: 2009)",
    mapping: "standard",
    buttons: 17,
    axes: [0, 0, 0, 0],
    a: 1,
  },
  gc: {
    id: "MAYFLASH GameCube Controller Adapter (Vendor: 0079 Product: 1844)",
    mapping: "",
    buttons: 16,
    axes: [0, 0, 0, -1, -1, 0],
    a: 1,
  },
};

export function installFakePads(list: string[], join: boolean): (frame: number) => void {
  const pads: FakePad[] = list
    .filter((k) => KINDS[k])
    .map((k, index) => {
      const s = KINDS[k];
      return {
        id: s.id,
        index,
        connected: true,
        mapping: s.mapping,
        axes: [...s.axes],
        buttons: Array.from({ length: s.buttons }, () => ({ value: 0, pressed: false, touched: false })),
        timestamp: 0,
        a: s.a,
      };
    });
  Object.defineProperty(navigator, "getGamepads", { value: () => pads, configurable: true });
  return (frame) => {
    if (!join) return;
    pads.forEach((p, i) => {
      const at = 30 + i * 8;
      const on = frame >= at && frame < at + 3;
      p.buttons[p.a] = { value: on ? 1 : 0, pressed: on, touched: on };
      p.timestamp = frame;
    });
  };
}
