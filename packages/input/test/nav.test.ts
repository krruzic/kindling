// Menu navigation: key repeat timing, stick vs d-pad, confirm / back after remap, one-seat mode.
import { MenuNavigator, NAV_DELAY, NAV_EVERY, emptyPad } from "../src/index.ts";
import { eq, test } from "./assert.ts";
import { ACTS, FakePad, setup, XBOX_ID, type Act } from "./fake.ts";

const opts = {
  up: "up",
  down: "down",
  left: "left",
  right: "right",
  confirm: ["jump", "pause"],
  back: ["attack"],
} as const;

test("nav: fires on press, after the delay, then every interval", () => {
  const nav = new MenuNavigator<Act>({ ...opts, confirm: [...opts.confirm], back: [...opts.back] });
  const p = emptyPad(ACTS);
  p.connected = true;
  const fires: number[] = [];
  p.held.down = true;
  // 60 fps for 1 s, recording frames that step.
  for (let f = 0; f <= 60; f++) if (nav.read([p], f / 60).dy === 1) fires.push(f / 60);
  eq(fires[0], 0, "immediate");
  const second = fires[1];
  eq(second >= NAV_DELAY && second < NAV_DELAY + 1 / 60, true, `second after the delay (${second})`);
  const gaps = fires.slice(2).map((t, i) => t - fires[i + 1]);
  eq(
    gaps.every((g) => Math.abs(g - NAV_EVERY) < 1 / 60 + 1e-9),
    true,
    `repeat every ${NAV_EVERY}: ${gaps}`,
  );
  eq(fires.length, 1 + 1 + Math.floor((1 - NAV_DELAY) / NAV_EVERY + 1e-9), "count over one second");
  p.held.down = false;
  eq(nav.read([p], 1.1).dy, 0);
  p.stickX = -0.9;
  eq(nav.read([p], 1.2).dx, -1, "stick steps too, fresh press fires at once");
  eq(nav.read([p], 1.3).dx, 0, "inside the delay");
});

test("nav: per-seat state, only one seat, confirm / back", () => {
  const nav = new MenuNavigator<Act>({ ...opts, confirm: [...opts.confirm], back: [...opts.back] });
  const a = emptyPad(ACTS);
  const b = emptyPad(ACTS);
  a.connected = b.connected = true;
  b.pressed.attack = true;
  let n = nav.read([a, b], 0);
  eq([n.back, n.seat], [true, 1]);
  b.pressed.attack = false;
  a.pressed.pause = true;
  n = nav.read([a, b], 0.1, 1);
  eq(n.confirm, false, "only seat 1 read");
  n = nav.read([a, b], 0.2);
  eq([n.confirm, n.seat, n.pressed.pause], [true, 0, true]);
});

test("nav: readEach gives every seat its own steps and repeat timer", () => {
  const nav = new MenuNavigator<Act>({ ...opts, confirm: [...opts.confirm], back: [...opts.back] });
  const a = emptyPad(ACTS);
  const b = emptyPad(ACTS);
  a.connected = b.connected = true;
  a.held.down = true;
  let e = nav.readEach([a, b], 0);
  eq([e[0].dy, e[1].dy, e[0].seat, e[1].seat], [1, 0, 0, -1]);
  b.held.up = true;
  e = nav.readEach([a, b], 0.1);
  eq([e[0].dy, e[1].dy], [0, -1], "b's fresh press fires while a waits out its delay");
  e = nav.readEach([a, b], NAV_DELAY + 0.01);
  eq([e[0].dy, e[1].dy], [1, 0], "a repeats on its own timer");
  b.pressed.attack = true;
  e = nav.readEach([a, b], NAV_DELAY + 0.02);
  eq([e[0].back, e[1].back, e[1].seat], [false, true, 1], "presses stay with their seat");
});

test("nav: confirm follows a remap", () => {
  const { input, pads, step } = setup({ joinPressCounts: true });
  const nav = new MenuNavigator<Act>({ ...opts, confirm: ["jump"], back: ["attack"] });
  const pad = new FakePad(XBOX_ID, 0);
  pads.push(pad);
  step();
  input.bind("pad-0", "jump", "b3");
  pad.press(3);
  step();
  eq(nav.read(input.players, 1).confirm, true, "remapped button confirms");
  pad.up(3).press(0);
  step();
  const n = nav.read(input.players, 1.1);
  eq([n.confirm, n.back], [false, false], "old button (now unbound after swap rules) doesn't");
});
