import { assert, test } from "./harness.ts";
import { FixedLoop, FrameSnap, SimBase, runSim } from "../src/index.ts";

test("accumulator runs whole ticks and carries the remainder", () => {
  let n = 0;
  const loop = new FixedLoop({ dt: 1 / 30, step: () => void n++ });
  assert.equal(loop.advance(1 / 60), 0);
  assert.equal(loop.advance(1 / 60), 1);
  assert.equal(loop.advance(0.1), 3);
  assert.equal(n, 4);
  assert.ok(loop.alpha >= 0 && loop.alpha < 1);
});

test("max steps drops the backlog and frame clamp drops hitches", () => {
  let n = 0;
  const loop = new FixedLoop({ dt: 0.01, step: () => void n++, maxSteps: 5, maxFrame: 0.25 });
  assert.equal(loop.advance(10), 5);
  assert.equal(loop.acc, 0);
  assert.equal(loop.dropped, 1);
  assert.equal(n, 5);
});

test("hitstop and pause freeze the sim", () => {
  let n = 0;
  const loop = new FixedLoop({ dt: 0.1, step: () => void n++ });
  loop.hitstop(0.15);
  assert.equal(loop.advance(0.1), 0);
  assert.equal(loop.alpha, 0);
  assert.equal(loop.advance(0.1), 0);
  assert.equal(loop.advance(0.1), 1);
  loop.paused = true;
  assert.equal(loop.advance(1), 0);
  loop.paused = false;
  assert.equal(n, 1);
});

test("a step that cannot run keeps at most one tick of backlog", () => {
  let ready = false;
  let n = 0;
  const loop = new FixedLoop({ dt: 0.1, step: () => (ready ? void n++ : false) });
  loop.advance(0.25);
  assert.ok(loop.acc <= 0.1 + 1e-9);
  ready = true;
  assert.equal(loop.advance(0), 1);
});

test("SimBase clears events per tick and derives time from ticks", () => {
  class Counter extends SimBase<{ n: number }, number, string> {
    state = { n: 0 };
    protected update(cmds: readonly number[]): void {
      for (const c of cmds) this.state.n += c;
      if (this.tick % 2 === 0) this.emit(`even ${this.tick}`);
    }
    hash(): number {
      return this.state.n;
    }
  }
  const s = new Counter(1 / 60);
  s.step([1, 2]);
  assert.deepEqual(s.events, ["even 0"]);
  s.step([1]);
  assert.deepEqual(s.events, []);
  runSim(s, () => [1], { maxTicks: 60 });
  assert.equal(s.tick, 60);
  assert.equal(s.time, 1);
  assert.equal(s.hash(), 62);
});

test("pacing: a 60 / 120 Hz display with sub-ms wobble steps evenly (1 / 1 / 1, 0 / 1 / 0 / 1), no drift", () => {
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (const [hz, pattern] of [
    [60, [1]],
    [120, [0, 1]],
  ] as const) {
    const loop = new FixedLoop({ dt: 1 / 60, step: () => {} });
    const steps: number[] = [];
    // vsync timestamps: whole refreshes plus a little noise that doesn't add up (it's in the reading, not the clock)
    let last = 0;
    let wall = 0;
    for (let i = 1; i <= 2000; i++) {
      const t = i / hz + (rnd() - 0.5) * 0.0009;
      steps.push(loop.advance(t - last));
      wall = t;
      last = t;
    }
    const tail = steps.slice(10);
    const ok = tail.every((n, i) => n === pattern[(i + (tail[0] === pattern[0] ? 0 : 1)) % pattern.length]);
    assert.ok(ok, `${hz} Hz: uneven steps ${tail.slice(0, 40).join("")}`);
    const ran = steps.reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(ran - wall * 60) <= 2, `${hz} Hz: ${ran} ticks in ${wall.toFixed(2)} s`);
  }
  // without snapping the same wobble stutters
  const raw = new FixedLoop({ dt: 1 / 60, step: () => {}, snap: false });
  let bad = 0;
  let last = 0;
  for (let i = 1; i <= 2000; i++) {
    const t = i / 60 + (rnd() - 0.5) * 0.0009;
    if (raw.advance(t - last) !== 1) bad++;
    last = t;
  }
  assert.ok(bad > 0, "the unsnapped loop does stutter (the test's wobble is real)");
});

test("FrameSnap leaves odd frame times alone and pays back what it shaves", () => {
  const f = new FrameSnap(10, 0.06);
  assert.equal(f.snap(10.4), 10);
  assert.equal(f.snap(7), 7);
  const g = new FrameSnap(10, 0.06);
  let total = 0;
  for (let i = 0; i < 100; i++) total += g.snap(10.3);
  assert.ok(Math.abs(total + g.debt - 1030) < 1e-9, "nothing lost");
  assert.ok(Math.abs(g.debt) < 10);
});
