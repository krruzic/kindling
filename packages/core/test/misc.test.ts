import { assert, test } from "./harness.ts";
import {
  Holidays,
  PerfMeter,
  Ring,
  angleDiff,
  approach,
  clamp,
  dateRange,
  daysAround,
  nthWeekday,
  quantize,
  wrapAngle,
} from "../src/index.ts";

test("ring buffer keeps the last N and answers percentiles", () => {
  const r = new Ring(4);
  for (const v of [1, 2, 3, 4, 5, 6]) r.push(v);
  assert.deepEqual(r.values(), [3, 4, 5, 6]);
  assert.equal(r.last(), 6);
  assert.equal(r.mean(), 4.5);
  assert.equal(r.max(), 6);
  assert.equal(r.percentile(50), 4);
  assert.equal(r.percentile(100), 6);
  const big = new Ring(100);
  for (let i = 1; i <= 100; i++) big.push(i);
  assert.equal(big.percentile(95), 95);
  assert.ok(Number.isNaN(new Ring(3).percentile(50)));
});

test("perf meter: sections, counters, spikes, snapshot per window", () => {
  let t = 0;
  const m = new PerfMeter({ now: () => t, windowMs: 1000 });
  for (let f = 0; f < 90; f++) {
    const t0 = m.begin();
    t += 2;
    const t1 = m.cpu("sim", t0);
    t += f === 30 ? 20 : 4;
    m.cpu("render", t1);
    m.stat("draws", 10);
    m.end();
    t += Math.max(0, 16.6667 - (f === 30 ? 22 : 6));
  }
  assert.ok(m.snapshot.fps > 55 && m.snapshot.fps < 65, String(m.snapshot.fps));
  assert.equal(m.snapshot["frame.p50"], 6);
  assert.equal(m.snapshot["frame.max"], 22);
  assert.ok(Math.abs(m.snapshot["cpu.sim"] - 2) < 1e-9);
  assert.ok(Math.abs(m.snapshot.draws - 10) < 1e-9);
  assert.equal(m.spikes.length, 1);
  assert.equal(m.spikes[0]["cpu.render"], 20);
  assert.ok(m.lines().some((l) => l.startsWith("fps")));
  const off = new PerfMeter({ enabled: false, now: () => 1 });
  off.begin();
  off.end();
  assert.deepEqual(off.snapshot, {});
});

test("holidays: windows, override, option toggle", () => {
  const make = (search: string, today: Date) =>
    new Holidays<"halloween" | "thanksgiving" | "newyear">({ search, today: () => today })
      .register(
        "halloween",
        daysAround((y) => new Date(y, 9, 31), -7, 1),
      )
      .register(
        "thanksgiving",
        daysAround((y) => nthWeekday(y, 10, 4, 4), 0, 3),
      )
      .register("newyear", dateRange(11, 30, 0, 2));
  const h = make("", new Date(2026, 9, 28));
  assert.equal(h.active(), "halloween");
  assert.equal(h.on(new Date(2026, 10, 2)), null);
  assert.equal(h.on(new Date(2026, 10, 1)), "halloween");
  assert.equal(nthWeekday(2026, 10, 4, 4).getDate(), 26);
  assert.equal(nthWeekday(2026, 9, 1, -1).getDate(), 26);
  assert.equal(h.on(new Date(2026, 10, 29)), "thanksgiving");
  assert.equal(h.on(new Date(2027, 0, 2)), "newyear");
  assert.equal(h.on(new Date(2026, 11, 29)), null);
  h.enabled = false;
  assert.equal(h.active(), null);
  assert.equal(h.toLoad(), "halloween");
  const forced = make("?holiday=newyear", new Date(2026, 5, 1));
  assert.equal(forced.active(), "newyear");
  assert.ok(forced.is("newyear"));
  assert.equal(make("?holiday=none", new Date(2026, 9, 28)).active(), null);
  assert.equal(make("?x=1", new Date(2026, 9, 28)).forced, undefined);
});

test("math helpers", () => {
  assert.equal(clamp(5, 0, 3), 3);
  assert.equal(approach(1, 5, 2), 3);
  assert.equal(approach(1, 2, 5), 2);
  assert.equal(quantize(0.1 + 0.2), quantize(0.3));
  assert.ok(Math.abs(wrapAngle(3 * Math.PI) - Math.PI) < 1e-12);
  assert.ok(Math.abs(angleDiff(0.1, -0.1 + 2 * Math.PI) + 0.2) < 1e-12);
});
