// Trigger logic (ported from Grudge tools/trigger-test.ts): fake GameCube / gamepad trigger states frame by frame.
import { gcPad, emptyGcPort, STUCK_S, Trigger, type GcPort } from "../src/index.ts";
import { eq, ok, test } from "./assert.ts";
import { FakePad, setup } from "./fake.ts";

const DT = 1 / 60;
const L_ON = 0.3;
const R_ON = 0.75;

function run(t: Trigger, clock: { t: number }, s: { digital?: boolean; analog?: number }, frames = 6): boolean {
  for (let i = 0; i < frames; i++) {
    clock.t += DT;
    t.update(s, clock.t);
  }
  return t.held;
}

/** GameCube adapter bytes are fed as byte / 170; rest ~30, full travel ~200. */
const B = (byte: number) => byte / 170;

test("trigger: digital only", () => {
  const t = new Trigger(L_ON, true);
  const c = { t: 0 };
  run(t, c, { digital: false, analog: B(0) });
  eq(t.held, false, "rest");
  eq(run(t, c, { digital: true, analog: B(0) }), true, "click");
  eq(run(t, c, { digital: false, analog: B(0) }), false, "release");
});

test("trigger: analog only", () => {
  const t = new Trigger(R_ON, true);
  const c = { t: 0 };
  run(t, c, { digital: false, analog: B(30) });
  eq(t.held, false, "rest");
  eq(run(t, c, { digital: false, analog: B(225) }), true, "full travel, no click");
  eq(run(t, c, { digital: false, analog: B(32) }), false, "release");
});

test("trigger: short travel adapts the threshold", () => {
  // Click modded dead and the analog only reaches ~60% (below R's 75%).
  const t = new Trigger(R_ON, true);
  const c = { t: 0 };
  run(t, c, { digital: false, analog: B(30) });
  eq(run(t, c, { digital: false, analog: B(130) }), true, "press");
  eq(run(t, c, { digital: false, analog: B(35) }), false, "release");
  eq(run(t, c, { digital: false, analog: B(130) }), true, "press again");
});

test("trigger: stuck high from connect", () => {
  const t = new Trigger(L_ON, true);
  const c = { t: 0 };
  run(t, c, { digital: false, analog: B(240) });
  eq(t.held, false, "stuck-high analog not held");
  eq(run(t, c, { digital: true, analog: B(240) }), true, "click still works");
  eq(run(t, c, { digital: false, analog: B(240) }), false, "click released");
});

test("trigger: sticks high mid-game is re-zeroed", () => {
  const t = new Trigger(L_ON, true);
  const c = { t: 0 };
  run(t, c, { digital: false, analog: B(30) });
  eq(run(t, c, { digital: false, analog: B(200) }), true, "first held");
  run(t, c, { digital: false, analog: B(200) }, Math.ceil((STUCK_S + 1) / DT));
  eq(t.held, false, "re-zeroed after STUCK_S");
  ok(t.note === "ANALOG RE-ZEROED", "debug note");
  eq(run(t, c, { digital: false, analog: B(30) }), false, "comes back down");
  eq(run(t, c, { digital: false, analog: B(200) }), true, "works again");
});

test("trigger: nonzero rest", () => {
  const t = new Trigger(L_ON, true);
  const c = { t: 0 };
  run(t, c, { digital: false, analog: B(110) });
  eq(t.held, false, "rest at byte 110");
  eq(run(t, c, { digital: false, analog: B(180) }), true, "press");
  eq(run(t, c, { digital: false, analog: B(110) }), false, "back to rest");
});

test("trigger: click stuck closed from connect", () => {
  const t = new Trigger(L_ON, true);
  const c = { t: 0 };
  run(t, c, { digital: true, analog: B(30) });
  eq(t.held, false, "ignored");
  eq(t.note, "CLICK STUCK ON");
  eq(run(t, c, { digital: true, analog: B(150) }), true, "analog still works");
  eq(run(t, c, { digital: true, analog: B(30) }), false, "analog released");
});

test("trigger: click stuck mid-game while analog says up", () => {
  const t = new Trigger(L_ON, true);
  const c = { t: 0 };
  run(t, c, { digital: false, analog: B(30) });
  run(t, c, { digital: false, analog: B(200) });
  run(t, c, { digital: false, analog: B(30) });
  run(t, c, { digital: true, analog: B(30) }, Math.ceil((STUCK_S + 1) / DT));
  eq(t.held, false, "ignored");
  eq(t.note, "CLICK IGNORED");
  run(t, c, { digital: false, analog: B(30) });
  eq(run(t, c, { digital: true, analog: B(30) }), true, "works once it opens and clicks again");
});

test("trigger: hysteresis", () => {
  const t = new Trigger(L_ON, true);
  const c = { t: 0 };
  run(t, c, { analog: 0 });
  run(t, c, { analog: 1 });
  eq(run(t, c, { analog: 0.25 }), true, "held at 25% after a press");
  eq(run(t, c, { analog: 0.15 }), false, "released under 18%");
  eq(run(t, c, { analog: 0.25 }), false, "25% from released doesn't press");
});

test("trigger: plain button counts on its first frame and never goes stuck", () => {
  const t = new Trigger(0.5, false);
  const c = { t: 0 };
  eq(run(t, c, { analog: 1 }, 1), true, "first frame");
  run(t, c, { analog: 1 }, Math.ceil((STUCK_S + 1) / DT));
  eq(t.held, true, "held > STUCK_S stays held");
});

test("trigger: gamepad trigger resting at 0.2", () => {
  const t = new Trigger(L_ON, false);
  const c = { t: 0 };
  run(t, c, { analog: 0.2 });
  eq(t.held, false, "rest");
  eq(run(t, c, { analog: 0.8 }), true, "pressed");
});

test("trigger: untouched Chromium axis reads 0 (half way) until moved", () => {
  const t = new Trigger(L_ON, true);
  const c = { t: 0 };
  run(t, c, { analog: 0.5 });
  eq(t.held, false, "untouched");
  eq(run(t, c, { analog: 1 }), true, "pressed");
  eq(run(t, c, { analog: 0 }), false, "back to -1");
  eq(run(t, c, { analog: 0.4 }), true, "40%");
});

test("trigger: whole GameCube pad through the manager (R by travel alone, L by click alone)", () => {
  const port: GcPort = { ...emptyGcPort(), connected: true, lRaw: 30, rRaw: 30 };
  const { input, step } = setup({
    providers: [{ read: () => [gcPad("gc-port-1", "gc-port-1", "GC 1", port)] }],
    triggerOn: { lt: L_ON, rt: R_ON },
  });
  input.joining = false;
  step(6);
  const d = input.getDevice("gc-port-1")!;
  port.rRaw = 220;
  step(6);
  eq(d.sources.get("rt")!.on, true, "R by travel");
  ok(input.devicePads()[0].rt > 0.9, "rt travel exposed");
  port.rRaw = 30;
  step(6);
  port.l = true;
  step(6);
  eq(d.sources.get("lt")!.on, true, "L by click");
});

test("trigger: Mayflash PC-mode L on an axis, resting at -1 after first touch", () => {
  const pad = new FakePad("MAYFLASH GameCube Controller Adapter (Vendor: 0079 Product: 1844)", 0, "", 16, 6);
  const { input, pads, step } = setup();
  pads.push(pad);
  step(3);
  const d = input.getDevice("pad-0")!;
  eq(d.family, "gc");
  eq(d.profile, "mayflash_gc");
  eq(d.sources.get("a3+")!.on, false, "untouched axis");
  pad.axis(3, 1);
  step(3);
  eq(d.sources.get("a3+")!.on, true, "L axis pressed");
  pad.axis(3, -1);
  step(3);
  eq(d.sources.get("a3+")!.on, false, "L released at -1");
  pad.axis(4, 1);
  step(3);
  eq(input.devicePads()[0].held.special, true, "R axis plays the game's rt action");
});
