// Pairing from a menu: the two browser pickers a couch game needs behind one small state machine a menu can draw.
//
//   "wake"  WebUSB: a wired Switch 2 Pro / NSO GameCube pad stays silent until it gets the wake-up (procon2wake.ts).
//           Once the player has picked it here, the browser remembers and it wakes by itself on every plug-in.
//   "find"  WebHID: a GameCube adapter, a Switch 2 pad or a Switch Pro pad, read by GcAdapter / ProCon2.
//
// Both pickers only open on a real key press or click. A gamepad button is not one, and a player in a menu is
// usually holding a gamepad: so request() opens the picker at once when it may, and otherwise waits ("gesture") for
// the next key or click anywhere and opens it then. UI-agnostic: a page reads `state` / `kind` and writes its own
// words.
import type { GcAdapter } from "./gcadapter.ts";
import { adoptHidPads, hidPadFilters, type ProCon2 } from "./procon2.ts";
import { ProCon2Waker } from "./procon2wake.ts";
import { webHid, webUsb, type HIDLike, type USBLike } from "./webhid.ts";

export type PairKind = "wake" | "find";
/**
 * idle; gesture: waiting for a key or click to open the picker; choosing: the picker is open; ok: a pad was picked
 * and handed over; none: the picker was closed with nothing picked; failed: picked, but it would not open (check
 * `detail`); unsupported: this browser has no WebUSB / WebHID.
 */
export type PairState = "idle" | "gesture" | "choosing" | "ok" | "none" | "failed" | "unsupported";

export interface PairingOptions {
  gc?: Pick<GcAdapter, "adopt" | "status">;
  pro?: ProCon2;
  waker?: ProCon2Waker;
  /** Tests: the browser's pieces. */
  hid?: HIDLike;
  usb?: USBLike;
  /** Whether a picker may open right now (default: navigator.userActivation.isActive, true where unknown). */
  active?: () => boolean;
  /** Where the next key or click is listened for (default: window). */
  target?: Pick<EventTarget, "addEventListener" | "removeEventListener">;
}

export class PadPairing {
  state: PairState = "idle";
  kind: PairKind = "find";
  /** The reader's own status line after a pick (e.g. a permissions hint). */
  detail = "";
  private disarm: (() => void) | null = null;

  constructor(private o: PairingOptions = {}) {}

  supports(kind: PairKind): boolean {
    return kind === "wake" ? !!(this.o.usb ?? webUsb()) : !!(this.o.hid ?? webHid());
  }

  get busy(): boolean {
    return this.state === "gesture" || this.state === "choosing";
  }

  /** Opens `kind`'s picker now, or on the next key press / click if the browser wants one first. */
  request(kind: PairKind): void {
    this.cancel();
    this.kind = kind;
    this.detail = "";
    if (!this.supports(kind)) {
      this.state = "unsupported";
      return;
    }
    if (this.mayOpen()) void this.run(kind);
    else this.arm(kind);
  }

  /** Stops waiting for a key or click (an open picker is the browser's to close). */
  cancel(): void {
    this.disarm?.();
    this.disarm = null;
    if (this.state === "gesture") this.state = "idle";
  }

  private mayOpen(): boolean {
    if (this.o.active) return this.o.active();
    const ua = typeof navigator === "undefined" ? undefined : navigator.userActivation;
    return ua ? ua.isActive : true;
  }

  private arm(kind: PairKind): void {
    const t = this.o.target ?? (typeof window === "undefined" ? undefined : window);
    if (!t) {
      this.state = "unsupported";
      return;
    }
    this.state = "gesture";
    const go = () => {
      this.disarm?.();
      this.disarm = null;
      void this.run(kind);
    };
    t.addEventListener("keydown", go, true);
    t.addEventListener("pointerdown", go, true);
    this.disarm = () => {
      t.removeEventListener("keydown", go, true);
      t.removeEventListener("pointerdown", go, true);
    };
  }

  private async run(kind: PairKind): Promise<void> {
    this.state = "choosing";
    try {
      if (kind === "wake") {
        const usb = (this.o.usb ?? webUsb())!;
        const waker = this.o.waker ?? new ProCon2Waker();
        const before = waker.woken;
        await waker.wake(await usb.requestDevice({ filters: ProCon2Waker.filters() }));
        this.detail = waker.status;
        this.state = waker.woken > before ? "ok" : "failed";
      } else {
        const hid = (this.o.hid ?? webHid())!;
        const ds = await hid.requestDevice({ filters: hidPadFilters() });
        if (!ds.length) {
          this.state = "none";
          return;
        }
        await adoptHidPads(ds, this.o.gc, this.o.pro);
        this.detail = [this.o.pro?.status, this.o.gc?.status].filter(Boolean).join(" · ");
        this.state = /BLOCKED|FAILED|UNAVAILABLE/.test(this.detail) ? "failed" : "ok";
      }
    } catch (err) {
      // SecurityError: the browser still wanted a key or click (no userActivation API to ask): wait for one.
      if ((err as { name?: string })?.name === "SecurityError" && !this.disarm) this.arm(kind);
      else this.state = "none";
    }
  }
}
