// Switch 2 Pro Controller and the NSO GameCube controller (Switch 2 family, same protocol) over WebHID, plus the
// Switch 1 Pro Controller (057e:2009 and pads that copy it: 8BitDo in Switch mode, most knockoffs; Chromium on
// Linux never exposes it over Bluetooth through the Gamepad API). ProCon2Decoder turns input reports into pad
// states (pure, testable); ProCon2 opens devices and is a PadProvider. Switch 2 pads only report after the USB
// wake-up in procon2wake.ts.
import type { ExternalPad, PadProvider } from "../manager.ts";
import type { GamepadLike } from "../types.ts";
import { gcPad } from "./gcadapter.ts";
import { webHid, type HIDDeviceLike, type HIDInputReportEventLike } from "./webhid.ts";

export interface Pro2State {
  connected: boolean;
  a: boolean;
  b: boolean;
  x: boolean;
  y: boolean;
  l: boolean;
  r: boolean;
  zl: boolean;
  zr: boolean;
  plus: boolean;
  minus: boolean;
  ls: boolean;
  rs: boolean;
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  stickX: number;
  stickY: number;
  cX: number;
  cY: number;
  /** NSO GameCube controller: GC names apply (see feed) and lRaw / rRaw are its analog trigger bytes. */
  gc: boolean;
  /** Switch 1 Pro Controller (or a copy). */
  s1: boolean;
  lRaw: number;
  rRaw: number;
}

export const NINTENDO_VENDOR = 0x057e;
export const PRO2_PRODUCT = 0x2069;
export const NSO_GC_PRODUCT = 0x2073;
export const SWITCH1_PRO_PRODUCT = 0x2009;
/** Switch 1 sticks: centre ~2048, full tilt ~1300-1700 away. */
const S1_RANGE = 1250;
/** GameCube sticks travel less: start at GC_RANGE raw units to full and widen to what the stick has reached. */
const GC_RANGE = 750;
const RANGE = 1450;

export function emptyPro2(): Pro2State {
  return {
    connected: false,
    a: false,
    b: false,
    x: false,
    y: false,
    l: false,
    r: false,
    zl: false,
    zr: false,
    plus: false,
    minus: false,
    ls: false,
    rs: false,
    up: false,
    down: false,
    left: false,
    right: false,
    stickX: 0,
    stickY: 0,
    cX: 0,
    cY: 0,
    gc: false,
    s1: false,
    lRaw: 0,
    rRaw: 0,
  };
}

/** Decodes one controller's reports. `send` gets the Switch 1 "full report mode" commands it must answer with. */
export class ProCon2Decoder {
  readonly state = emptyPro2();
  last = "";
  private center: [number, number, number, number] | null = null;
  private reach = [0, 0, 0, 0];
  private s1Asked = -1e9;
  private s1Packet = 0;

  constructor(
    productId: number,
    private send: (reportId: number, data: Uint8Array<ArrayBuffer>) => void = () => {},
  ) {
    this.state.gc = productId === NSO_GC_PRODUCT;
    this.state.s1 = productId === SWITCH1_PRO_PRODUCT;
  }

  private s1Command(sub: number, arg: number[]): void {
    const r = new Uint8Array(48);
    r[0] = this.s1Packet++ & 0x0f;
    r.set([0x00, 0x01, 0x40, 0x40, 0x00, 0x01, 0x40, 0x40], 1);
    r[9] = sub;
    r.set(arg, 10);
    this.send(0x01, r);
  }

  private axes(raw: [number, number, number, number], range: (k: number) => number): void {
    const c = (this.center ??= raw.map((x) => (Math.abs(x - 2048) < 500 ? x : 2048)) as [
      number,
      number,
      number,
      number,
    ]);
    const ax = (k: number) => Math.max(-1, Math.min(1, (raw[k] - c[k]) / range(k)));
    const p = this.state;
    p.stickX = ax(0);
    p.stickY = -ax(1);
    p.cX = ax(2);
    p.cY = -ax(3);
  }

  /** Feeds one input report (`nowMs` paces the Switch 1 mode request). */
  feed(reportId: number, v: DataView, nowMs = 0): void {
    const hex: string[] = [];
    for (let k = 0; k < Math.min(14, v.byteLength); k++) hex.push(v.getUint8(k).toString(16).padStart(2, "0"));
    this.last = `id ${reportId} len ${v.byteLength} ${hex.join(" ")}`;
    if (this.state.s1) return this.feedSwitch1(reportId, v, nowMs);
    const off = reportId ? 1 : 0;
    if (v.byteLength + off < 12) return;
    const b = (k: number) => v.getUint8(k - off);
    const p = this.state;
    p.connected = true;
    const bits = b(3) | (b(4) << 8) | (b(5) << 16);
    const on = (n: number) => !!(bits & (1 << n));
    p.b = on(0);
    p.a = on(1);
    p.y = on(2);
    p.x = on(3);
    p.zr = on(4);
    p.r = on(5);
    p.plus = on(6);
    p.rs = on(7);
    p.down = on(8);
    p.right = on(9);
    p.left = on(10);
    p.up = on(11);
    p.zl = on(12);
    p.l = on(13);
    p.minus = on(14);
    p.ls = on(15);
    // The GameCube pad uses the same bytes under GC names: zr = R, r = Z, zl = L, l = ZL, plus = Start. Bytes 13 /
    // 14 are its analog triggers.
    if (p.gc && v.byteLength + off > 14) {
      p.lRaw = b(13);
      p.rRaw = b(14);
    }
    const raw: [number, number, number, number] = [
      b(6) | ((b(7) & 0x0f) << 8),
      (b(7) >> 4) | (b(8) << 4),
      b(9) | ((b(10) & 0x0f) << 8),
      (b(10) >> 4) | (b(11) << 4),
    ];
    this.axes(raw, (k) => {
      if (!p.gc) return RANGE;
      this.reach[k] = Math.max(this.reach[k], Math.abs(raw[k] - (this.center?.[k] ?? 2048)));
      return Math.max(GC_RANGE, Math.min(RANGE, this.reach[k] * 0.92));
    });
  }

  /**
   * Switch 1 full report (0x30, and 0x21 subcommand replies, which start the same), report id stripped:
   * [2] Y X B A SR SL R ZR, [3] - + RS LS Home Capture, [4] Down Up Right Left SR SL L ZL, [5-10] two 12-bit sticks.
   * Simple-mode reports (0x3f, no hid-nintendo driver) get the "full mode" + player light commands, every 2 s.
   */
  private feedSwitch1(reportId: number, v: DataView, nowMs: number): void {
    if (reportId === 0x3f || (reportId !== 0x30 && reportId !== 0x21)) {
      if (reportId === 0x3f && nowMs - this.s1Asked > 2000) {
        this.s1Asked = nowMs;
        this.s1Command(0x03, [0x30]);
        setTimeout(() => this.s1Command(0x30, [0x01]), 60);
      }
      return;
    }
    if (v.byteLength < 11) return;
    const b = (k: number) => v.getUint8(k);
    const p = this.state;
    p.connected = true;
    const r = b(2);
    const s = b(3);
    const l = b(4);
    p.y = !!(r & 0x01);
    p.x = !!(r & 0x02);
    p.b = !!(r & 0x04);
    p.a = !!(r & 0x08);
    p.r = !!(r & 0x40);
    p.zr = !!(r & 0x80);
    p.minus = !!(s & 0x01);
    p.plus = !!(s & 0x02);
    p.rs = !!(s & 0x04);
    p.ls = !!(s & 0x08);
    p.down = !!(l & 0x01);
    p.up = !!(l & 0x02);
    p.right = !!(l & 0x04);
    p.left = !!(l & 0x08);
    p.l = !!(l & 0x40);
    p.zl = !!(l & 0x80);
    const raw: [number, number, number, number] = [
      b(5) | ((b(6) & 0x0f) << 8),
      (b(6) >> 4) | (b(7) << 4),
      b(8) | ((b(9) & 0x0f) << 8),
      (b(9) >> 4) | (b(10) << 4),
    ];
    this.axes(raw, (k) => {
      this.reach[k] = Math.max(this.reach[k], Math.abs(raw[k] - (this.center?.[k] ?? 2048)));
      return Math.max(S1_RANGE, this.reach[k] * 0.92);
    });
  }
}

/** A decoded pad as canonical buttons (Switch labels by position; the NSO GameCube pad as a GameCube pad). */
export function proPad(i: number, g: Pro2State): ExternalPad {
  const handle = `hid-pro-${i + 1}`;
  if (g.gc)
    return gcPad(handle, "nso-gc", "NSO GAMECUBE CONTROLLER", { ...g, z: g.r, start: g.plus, l: g.zl, r: g.zr }, g.l);
  const d = (on: boolean) => ({ digital: on });
  return {
    handle,
    key: g.s1 ? "switch-pro" : "switch2-pro",
    name: g.s1 ? "SWITCH PRO CONTROLLER" : "SWITCH 2 PRO CONTROLLER",
    family: "switch",
    profile: "switch-hid",
    buttons: {
      south: d(g.b),
      east: d(g.a),
      west: d(g.y),
      north: d(g.x),
      lb: d(g.l),
      rb: d(g.r),
      lt: d(g.zl),
      rt: d(g.zr),
      back: d(g.minus),
      start: d(g.plus),
      ls: d(g.ls),
      rs: d(g.rs),
      up: d(g.up),
      down: d(g.down),
      left: d(g.left),
      right: d(g.right),
    },
    stick: [g.stickX, g.stickY],
    cstick: [g.cX, g.cY],
  };
}

export class ProCon2 implements PadProvider {
  readonly decoders: ProCon2Decoder[] = [];
  private devices: HIDDeviceLike[] = [];
  status = "";

  constructor() {
    const hid = webHid();
    if (!hid) return;
    void hid.getDevices().then((ds) => ds.filter(ProCon2.matches).forEach((d) => void this.open(d)));
    hid.addEventListener("connect", (e) => {
      const d = (e as unknown as { device: HIDDeviceLike }).device;
      if (ProCon2.matches(d)) void this.open(d);
    });
    hid.addEventListener("disconnect", (e) => {
      const i = this.devices.indexOf((e as unknown as { device: HIDDeviceLike }).device);
      if (i >= 0) this.decoders[i].state.connected = false;
    });
  }

  static matches(d: { vendorId: number; productId: number }): boolean {
    return (
      d.vendorId === NINTENDO_VENDOR &&
      (d.productId === PRO2_PRODUCT || d.productId === NSO_GC_PRODUCT || d.productId === SWITCH1_PRO_PRODUCT)
    );
  }

  get pads(): Pro2State[] {
    return this.decoders.map((d) => d.state);
  }

  async open(d: HIDDeviceLike): Promise<void> {
    let i = this.devices.indexOf(d);
    if (i < 0) {
      i = this.devices.length;
      this.devices.push(d);
      const dec = new ProCon2Decoder(d.productId, (id, data) => void d.sendReport?.(id, data).catch(() => {}));
      this.decoders.push(dec);
      d.addEventListener("inputreport", (e) => {
        const r = e as HIDInputReportEventLike;
        dec.feed(r.reportId, r.data, performance.now());
      });
    }
    try {
      if (!d.opened) await d.open();
      this.status = `CONTROLLER ${i + 1} READY`;
    } catch {
      this.status = "PRO CONTROLLER BLOCKED (CHECK HIDRAW PERMISSION)";
    }
  }

  /** Gamepad API twins of pads read here (a wired Switch 2 pad, or a Switch 1 Pro once WebHID has it). */
  hides(pad: GamepadLike): boolean {
    const st = this.pads.filter((p) => p.connected);
    if (/(product: |^057e-)20(69|73)/i.test(pad.id) && !/virtual/i.test(pad.id) && st.some((p) => !p.s1)) return true;
    return /(product: |^057e-)2009/i.test(pad.id) && st.some((p) => p.s1);
  }

  read(): ExternalPad[] {
    return this.pads.flatMap((g, i) => (g.connected ? [proPad(i, g)] : []));
  }

  debug(): string {
    return this.decoders.map((d, i) => `PRO ${i + 1}: ${d.last}`).join("\n");
  }
}

/** Asks for any supported HID pad at once (one browser prompt) and hands each to its reader. Needs a user gesture. */
export async function requestHidPads(gc?: { adopt(d: HIDDeviceLike): Promise<void> }, pro?: ProCon2): Promise<void> {
  const hid = webHid();
  if (!hid) return;
  try {
    await adoptHidPads(await hid.requestDevice({ filters: hidPadFilters() }), gc, pro);
  } catch {
    // The user dismissed the picker.
  }
}

/** The browser picker's filters for every HID pad read here (GameCube adapter, Switch 2 / NSO GameCube / Pro). */
export function hidPadFilters(): { vendorId: number; productId: number }[] {
  return [
    GC_FILTER,
    ...[PRO2_PRODUCT, NSO_GC_PRODUCT, SWITCH1_PRO_PRODUCT].map((productId) => ({
      vendorId: NINTENDO_VENDOR,
      productId,
    })),
  ];
}

/** Hands picked HID devices to their readers. */
export async function adoptHidPads(
  ds: HIDDeviceLike[],
  gc?: { adopt(d: HIDDeviceLike): Promise<void> },
  pro?: ProCon2,
): Promise<void> {
  for (const d of ds) {
    if (ProCon2.matches(d)) await pro?.open(d);
    else await gc?.adopt(d);
  }
}

const GC_FILTER = { vendorId: 0x057e, productId: 0x0337 };
