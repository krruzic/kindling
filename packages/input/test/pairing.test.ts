// PadPairing: the picker opens at once on a real gesture, waits for a key or click after a gamepad press, and says
// what happened in a state a menu can draw.
import { PadPairing } from "../src/hid/pairing.ts";
import type { HIDDeviceLike, HIDLike, USBLike } from "../src/hid/webhid.ts";
import { eq, test } from "./assert.ts";

class Target {
  private fns = new Map<string, Set<() => void>>();
  addEventListener(t: string, f: unknown): void {
    if (!this.fns.has(t)) this.fns.set(t, new Set());
    this.fns.get(t)!.add(f as () => void);
  }
  removeEventListener(t: string, f: unknown): void {
    this.fns.get(t)?.delete(f as () => void);
  }
  fire(t: string): void {
    for (const f of [...(this.fns.get(t) ?? [])]) f();
  }
  count(): number {
    return [...this.fns.values()].reduce((n, s) => n + s.size, 0);
  }
}

const tick = () => new Promise((r) => setTimeout(r, 0));
const fakeHid = (picked: HIDDeviceLike[]): HIDLike & { asked: number } => {
  const h = Object.assign(new EventTarget(), {
    asked: 0,
    getDevices: async () => [],
    requestDevice: async () => {
      h.asked++;
      return picked;
    },
  });
  return h;
};
const adapter = () =>
  Object.assign(new EventTarget(), { opened: true, vendorId: 0x057e, productId: 0x0337, open: async () => {} });

test("pairing: with a real gesture the picker opens at once; a pick is handed to its reader", async () => {
  const hid = fakeHid([adapter()]);
  const got: HIDDeviceLike[] = [];
  const gc = { status: "GAMECUBE ADAPTER READY", adopt: async (d: HIDDeviceLike) => void got.push(d) };
  const p = new PadPairing({ hid, gc, active: () => true, target: new Target() });
  p.request("find");
  eq(p.state, "choosing");
  await tick();
  eq([p.state, hid.asked, got.length, p.detail], ["ok", 1, 1, "GAMECUBE ADAPTER READY"]);
});

test("pairing: after a gamepad press it waits for a key or click, then opens; cancel stops waiting", async () => {
  const hid = fakeHid([]);
  const t = new Target();
  const p = new PadPairing({ hid, active: () => false, target: t });
  p.request("find");
  eq([p.state, hid.asked, p.busy], ["gesture", 0, true]);
  t.fire("keydown");
  await tick();
  eq([p.state, hid.asked, t.count()], ["none", 1, 0], "closed with nothing picked");
  p.request("find");
  p.cancel();
  eq([p.state, t.count()], ["idle", 0]);
  t.fire("pointerdown");
  await tick();
  eq(hid.asked, 1);
});

test("pairing: no WebUSB / WebHID says unsupported; a refused wake says none", async () => {
  const p = new PadPairing({ active: () => true, target: new Target() });
  p.request("wake");
  eq(p.state, "unsupported");
  const usb = Object.assign(new EventTarget(), {
    getDevices: async () => [],
    requestDevice: async () => {
      throw Object.assign(new Error("no device selected"), { name: "NotFoundError" });
    },
  }) as unknown as USBLike;
  const q = new PadPairing({ usb, active: () => true, target: new Target() });
  q.request("wake");
  await tick();
  eq(q.state, "none");
});
