// Switch 2 Pro Controller / NSO GameCube controller wake-up over WebUSB: sends the vendor init sequence and the
// player LED command so the controller starts reporting as a HID gamepad (then ProCon2 or the Gamepad API reads
// it). Without this a wired Switch 2 pad stays silent.
import { webUsb, type USBDeviceLike } from "./webhid.ts";

const VENDOR = 0x057e;
/** Switch 2 Pro Controller and the NSO GameCube controller share the wake-up. */
const PRODUCTS = [0x2069, 0x2073];
const ff = (n: number) => Array<number>(n).fill(0xff);
const zero = (n: number) => Array<number>(n).fill(0);

export const WAKE: number[][] = [
  [0x03, 0x91, 0x00, 0x0d, 0x00, 0x08, 0x00, 0x00, 0x01, 0x00, ...ff(6)],
  [0x07, 0x91, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00],
  [0x16, 0x91, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00],
  [0x15, 0x91, 0x00, 0x01, 0x00, 0x0e, 0x00, 0x00, 0x00, 0x02, ...ff(12)],
  [0x15, 0x91, 0x00, 0x02, 0x00, 0x11, 0x00, 0x00, 0x00, ...ff(16)],
  [0x15, 0x91, 0x00, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00],
  [0x09, 0x91, 0x00, 0x07, 0x00, 0x08, ...zero(10)],
  [0x0c, 0x91, 0x00, 0x02, 0x00, 0x04, 0x00, 0x00, 0x27, 0x00, 0x00, 0x00],
  [0x11, 0x91, 0x00, 0x03, 0x00, 0x00, 0x00, 0x00],
  [0x0a, 0x91, 0x00, 0x08, 0x00, 0x14, 0x00, 0x00, 0x01, ...ff(8), 0x35, 0x00, 0x46, ...zero(8)],
  [0x0c, 0x91, 0x00, 0x04, 0x00, 0x04, 0x00, 0x00, 0x27, 0x00, 0x00, 0x00],
  [0x03, 0x91, 0x00, 0x0a, 0x00, 0x04, 0x00, 0x00, 0x09, 0x00, 0x00, 0x00],
  [0x10, 0x91, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00],
  [0x01, 0x91, 0x00, 0x0c, 0x00, 0x00, 0x00, 0x00],
  [0x03, 0x91, 0x00, 0x01, 0x00, 0x00, 0x00],
  [0x0a, 0x91, 0x00, 0x02, 0x00, 0x04, 0x00, 0x00, 0x03, 0x00, 0x00],
];

/** Player LED command (1-4 lights by slot). */
export const wakeLed = (slot: number): number[] => [
  0x09,
  0x91,
  0x00,
  0x07,
  0x00,
  0x08,
  0x00,
  0x00,
  [0x01, 0x03, 0x07, 0x0f][slot % 4],
  ...zero(7),
];

export class ProCon2Waker {
  status = "";
  woken = 0;
  private busy = new Set<USBDeviceLike>();

  /** Wakes already-permitted pads now and on plug-in (no-op without WebUSB). */
  constructor(private onWoke: () => void = () => {}) {
    const usb = webUsb();
    if (!usb) return;
    void usb.getDevices().then((ds) => ds.filter(ProCon2Waker.matches).forEach((d) => void this.wake(d)));
    usb.addEventListener("connect", (e) => {
      const d = (e as unknown as { device: USBDeviceLike }).device;
      if (ProCon2Waker.matches(d)) setTimeout(() => void this.wake(d), 300);
    });
  }

  static matches(d: { vendorId: number; productId: number }): boolean {
    return d.vendorId === VENDOR && PRODUCTS.includes(d.productId);
  }

  /** Asks the user for a pad to wake (needs a user gesture). */
  async request(): Promise<boolean> {
    const usb = webUsb();
    if (!usb) return false;
    try {
      const d = await usb.requestDevice({ filters: PRODUCTS.map((productId) => ({ vendorId: VENDOR, productId })) });
      await this.wake(d);
      return true;
    } catch {
      return false;
    }
  }

  async wake(d: USBDeviceLike): Promise<void> {
    if (this.busy.has(d)) return;
    this.busy.add(d);
    try {
      if (!d.opened) await d.open();
      if (!d.configuration) await d.selectConfiguration(1);
      const iface =
        d.configuration!.interfaces.find((i) => i.interfaceNumber === 1) ??
        d.configuration!.interfaces.find((i) => i.alternate.interfaceClass === 0xff);
      if (!iface) throw new Error("no vendor interface");
      await d.claimInterface(iface.interfaceNumber);
      const eps = iface.alternate.endpoints.filter((e) => e.type === "bulk");
      const out = eps.find((e) => e.direction === "out")?.endpointNumber ?? 2;
      const inp = eps.find((e) => e.direction === "in")?.endpointNumber ?? 2;
      for (const cmd of [...WAKE, wakeLed(this.woken)]) {
        await d.transferOut(out, new Uint8Array(cmd));
        await d.transferIn(inp, 64);
      }
      await d.releaseInterface(iface.interfaceNumber).catch(() => {});
      await d.close().catch(() => {});
      this.woken++;
      this.status = "PRO CONTROLLER AWAKE";
      this.onWoke();
    } catch {
      this.status = "PRO CONTROLLER: CHECK USB PERMISSION";
    } finally {
      this.busy.delete(d);
    }
  }
}
