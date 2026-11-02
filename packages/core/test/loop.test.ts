import { assert, test } from "./harness.ts";
import { FixedLoop, SimBase, runSim } from "../src/index.ts";

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
