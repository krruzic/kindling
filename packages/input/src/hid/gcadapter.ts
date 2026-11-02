// GameCube controller adapter (WUP-028 and clones in Wii U mode) over WebHID: GcAdapterDecoder turns its 37-byte
// reports into four ports (pure, testable with a DataView); GcAdapter opens the device, sends the start-polling
// report (retrying: the Linux kernel sometimes drops the adapter's data) and is a PadProvider for InputManager.
// Ports are skipped while an OS driver already exposes them as gamepads (Mayflash PC mode / wii-u-gc-adapter).
import type { ExternalPad, PadProvider } from "../manager.ts";
import type { GamepadLike } from "../types.ts";
import { webHid, type HIDDeviceLike, type HIDInputReportEventLike } from "./webhid.ts";

export interface GcPort {
  connected: boolean;
  a: boolean;
  b: boolean;
  x: boolean;
  y: boolean;
  z: boolean;
  l: boolean;
  r: boolean;
  start: boolean;
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  stickX: number;
  stickY: number;
  cX: number;
  cY: number;
  /** Raw L / R trigger bytes (0-255); Trigger calibrates their rest. */
  lRaw: number;
  rRaw: number;
}

export const GC_VENDOR = 0x057e;
export const GC_PRODUCT = 0x0337;
/** Trigger bytes are fed as byte / 170 so ~0.3 travel thresholds mean what they did on the 0..1 scale. */
export const GC_TRIGGER_SCALE = 170;
/** Gamepad ids of adapter ports an OS driver already exposes. */
export const NATIVE_GC = /gamecube (adapter port|controller)|wup-028/i;

export function emptyGcPort(): GcPort {
  return {
    connected: false,
    a: false,
    b: false,
    x: false,
    y: false,
    z: false,
    l: false,
    r: false,
    start: false,
    up: false,
    down: false,
    left: false,
    right: false,
    stickX: 0,
    stickY: 0,
    cX: 0,
    cY: 0,
    lRaw: 0,
    rRaw: 0,
  };
}

export class GcAdapterDecoder {
  readonly ports: GcPort[] = [emptyGcPort(), emptyGcPort(), emptyGcPort(), emptyGcPort()];
  reports = 0;
  states = 0;
  lastId = -1;
  lastLen = 0;
  lastStatus: number[] = [];
  private center: ([number, number, number, number] | undefined)[] = [];
  private offset = -1;

  /** Some stacks strip the 0x21 report id byte, some don't: find where the four 9-byte port blocks start. */
  private detectOffset(v: DataView): number {
    const score = (off: number) => {
      let n = 0;
      for (let p = 0; p < 4; p++) {
        const o = off + p * 9;
        if (o >= v.byteLength) return -1;
        const b = v.getUint8(o);
        if (b >> 4 <= 2 && (b & 0x0b) === 0) n++;
      }
      return n;
    };
    if (v.byteLength >= 37 && v.getUint8(0) === 0x21) return 1;
    return score(1) > score(0) ? 1 : 0;
  }

  feed(reportId: number, v: DataView): void {
    this.reports++;
    this.lastId = reportId;
    this.lastLen = v.byteLength;
    if (reportId !== 0x21 && !(reportId === 0 && v.byteLength >= 37)) return;
    this.states++;
    if (this.offset < 0 || this.reports % 120 === 0) this.offset = this.detectOffset(v);
    this.lastStatus = [0, 1, 2, 3].map((p) =>
      this.offset + p * 9 < v.byteLength ? v.getUint8(this.offset + p * 9) : 0,
    );
    for (let p = 0; p < 4; p++) {
      const o = this.offset + p * 9;
      if (o + 8 >= v.byteLength) break;
      const type = v.getUint8(o) >> 4;
      const port = this.ports[p];
      port.connected = type === 1 || type === 2;
      if (!port.connected) {
        this.center[p] = undefined;
        continue;
      }
      const b1 = v.getUint8(o + 1);
      const b2 = v.getUint8(o + 2);
      const raw: [number, number, number, number] = [
        v.getUint8(o + 3),
        v.getUint8(o + 4),
        v.getUint8(o + 5),
        v.getUint8(o + 6),
      ];
      const c = (this.center[p] ??= raw.map((x) => (Math.abs(x - 128) < 40 ? x : 128)) as [
        number,
        number,
        number,
        number,
      ]);
      const ax = (i: number, range: number) => Math.max(-1, Math.min(1, (raw[i] - c[i]) / range));
      port.a = !!(b1 & 0x01);
      port.b = !!(b1 & 0x02);
      port.x = !!(b1 & 0x04);
      port.y = !!(b1 & 0x08);
      port.left = !!(b1 & 0x10);
      port.right = !!(b1 & 0x20);
      port.down = !!(b1 & 0x40);
      port.up = !!(b1 & 0x80);
      port.start = !!(b2 & 0x01);
      port.z = !!(b2 & 0x02);
      port.r = !!(b2 & 0x04);
      port.l = !!(b2 & 0x08);
      port.stickX = ax(0, 88);
      port.stickY = -ax(1, 88);
      port.cX = ax(2, 76);
      port.cY = -ax(3, 76);
      port.lRaw = v.getUint8(o + 7);
      port.rRaw = v.getUint8(o + 8);
    }
  }

  debug(): string {
    const st = this.lastStatus.map((b) => b.toString(16).padStart(2, "0")).join(" ");
    const id = this.lastId < 0 ? "-" : "0X" + this.lastId.toString(16);
    return `REPORTS ${this.reports} · STATE ${this.states} · ID ${id} · LEN ${this.lastLen} · OFS ${this.offset} · PORTS ${st || "-"}`;
  }
}

/** A GameCube pad's state as canonical buttons (A south, B west, X east, Y north, Z rb, L lt, R rt). */
export function gcPad(handle: string, key: string, name: string, g: GcPort, zl?: boolean): ExternalPad {
  const trig = (digital: boolean, raw: number) => ({ digital, analog: raw / GC_TRIGGER_SCALE });
  const pad: ExternalPad = {
    handle,
    key,
    name,
    family: "gc",
    profile: "gc-hid",
    buttons: {
      south: { digital: g.a },
      west: { digital: g.b },
      east: { digital: g.x },
      north: { digital: g.y },
      rb: { digital: g.z },
      start: { digital: g.start },
      up: { digital: g.up },
      down: { digital: g.down },
      left: { digital: g.left },
      right: { digital: g.right },
      lt: trig(g.l, g.lRaw),
      rt: trig(g.r, g.rRaw),
    },
    stick: [g.stickX, g.stickY],
    cstick: [g.cX, g.cY],
    analog: ["lt", "rt"],
  };
  if (zl !== undefined) pad.buttons.lb = { digital: zl };
  return pad;
}

export class GcAdapter implements PadProvider {
  readonly decoder = new GcAdapterDecoder();
  status = "";
  private device: HIDDeviceLike | null = null;
  private initTimer: ReturnType<typeof setInterval> | undefined;
  private tries = 0;

  /** Opens an already-permitted adapter and listens for plugging (no-op without WebHID). */
  constructor() {
    const hid = webHid();
    if (!hid) {
      this.status = "WEBHID UNAVAILABLE";
      return;
    }
    void hid.getDevices().then((ds) => {
      const d = ds.find(GcAdapter.matches);
      if (d) void this.open(d);
    });
    hid.addEventListener("connect", (e) => {
      const d = (e as unknown as { device: HIDDeviceLike }).device;
      if (GcAdapter.matches(d)) void this.open(d);
    });
    hid.addEventListener("disconnect", (e) => {
      if ((e as unknown as { device: HIDDeviceLike }).device !== this.device) return;
      this.device = null;
      this.decoder.ports.forEach((p) => (p.connected = false));
      this.status = "ADAPTER UNPLUGGED";
    });
  }

  static matches(d: { vendorId: number; productId: number }): boolean {
    return d.vendorId === GC_VENDOR && d.productId === GC_PRODUCT;
  }

  get connected(): boolean {
    return !!this.device;
  }

  get ports(): readonly GcPort[] {
    return this.decoder.ports;
  }

  /** Asks the user for the adapter (call from a click / key handler: WebHID needs a user gesture). */
  async request(): Promise<void> {
    const hid = webHid();
    if (!hid || this.device) return;
    try {
      const [d] = await hid.requestDevice({ filters: [{ vendorId: GC_VENDOR, productId: GC_PRODUCT }] });
      if (d) await this.open(d);
    } catch (err) {
      this.status = "ADAPTER: " + String(err).slice(0, 60);
    }
  }

  async adopt(d: HIDDeviceLike): Promise<void> {
    if (!this.device && GcAdapter.matches(d)) await this.open(d);
  }

  private async open(d: HIDDeviceLike): Promise<void> {
    try {
      if (!d.opened) await d.open();
      d.addEventListener("inputreport", (e) => {
        const r = e as HIDInputReportEventLike;
        this.decoder.feed(r.reportId, r.data);
      });
      this.device = d;
      this.status = "GAMECUBE ADAPTER READY";
      await this.init();
      clearInterval(this.initTimer);
      this.initTimer = setInterval(() => {
        if (!this.device) return clearInterval(this.initTimer);
        if (this.decoder.states > 0) return clearInterval(this.initTimer);
        if (this.tries >= 6) {
          this.status = "NO ADAPTER DATA (LINUX: TRY THE wii-u-gc-adapter DRIVER)";
          return clearInterval(this.initTimer);
        }
        void this.init();
      }, 1000);
    } catch {
      this.status = "ADAPTER BLOCKED (CHECK HIDRAW PERMISSION)";
    }
  }

  /** The start-polling report (0x13), alternating an empty and a one-byte payload: stacks disagree on which works. */
  private async init(): Promise<void> {
    const empty = this.tries++ % 2 === 0;
    try {
      await this.device?.sendReport?.(0x13, empty ? new Uint8Array(0) : new Uint8Array([0]));
    } catch (err) {
      this.status = "ADAPTER INIT FAILED: " + String(err).slice(0, 50);
    }
  }

  read(gamepads: readonly (GamepadLike | null)[]): ExternalPad[] {
    if (gamepads.some((p) => !!p?.connected && NATIVE_GC.test(p.id))) return [];
    const out: ExternalPad[] = [];
    this.decoder.ports.forEach((g, p) => {
      if (g.connected) out.push(gcPad(`gc-port-${p + 1}`, `gc-port-${p + 1}`, `GAMECUBE PORT ${p + 1}`, g));
    });
    return out;
  }

  debug(): string {
    return this.device ? `GC ADAPTER: ${this.status} · ${this.decoder.debug()}` : "";
  }
}
