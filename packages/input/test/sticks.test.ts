// Deadzones, flick and smash detection, tap vs hold.
import { axialDeadzone, dir4, FlickDetector, radialDeadzone, SmashDetector, TapHold } from "../src/index.ts";
import { eq, near, ok, test } from "./assert.ts";

test("sticks: deadzones", () => {
  eq(radialDeadzone(0.1, 0.1, 0.2), [0, 0]);
  const [x, y] = radialDeadzone(1, 0, 0.2);
  near(x, 1);
  near(y, 0);
  near(radialDeadzone(0.6, 0, 0.2)[0], 0.5);
  eq(axialDeadzone(-0.1, 0.2), 0);
  near(axialDeadzone(-0.6, 0.2), -0.5);
  eq(dir4(0.2, 0.1), null);
  eq(dir4(0.2, -0.9), "up");
  eq(dir4(0.8, 0.6), "right");
});

test("sticks: flick fires once, re-arms near centre", () => {
  const f = new FlickDetector(0.7, 0.35);
  eq(f.update(0.5, 0), null);
  eq(f.update(0.9, 0), "right");
  eq(f.update(1, 0), null, "held: no repeat");
  eq(f.update(0.5, 0), null, "between: still disarmed");
  eq(f.update(0.1, 0), null);
  eq(f.update(0, -0.8), "up");
});

test("sticks: smash only from rest within the window", () => {
  const s = new SmashDetector(0.3, 0.85, 0.12);
  s.update(0, 0, 0);
  ok(s.update(1, 0, 0.05), "fast flick");
  ok(!s.update(1, 0, 0.06), "once");
  s.update(0, 0, 1);
  s.update(0.5, 0, 1.05);
  ok(!s.update(1, 0, 1.3), "slow push isn't a smash");
});

test("sticks: tap vs hold", () => {
  const t = new TapHold(0.2, 0.8);
  t.update(true, 0);
  const tap = t.update(false, 0.1);
  eq([tap.released, tap.tap, tap.charge], [true, true, 0]);
  t.update(true, 1);
  const mid = t.update(true, 1.6);
  ok(mid.charging);
  near(mid.charge, 0.5);
  const rel = t.update(false, 2.5);
  eq([rel.released, rel.tap, rel.charge], [true, false, 1]);
});
