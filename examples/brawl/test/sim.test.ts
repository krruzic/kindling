// Sim tests: determinism (same seed -> same hashes, twice in one process, two worlds interleaved), a CPU match
// finishes with a champion, the command codec round-trips and keeps taps, MUT tuning changes the result.
import { applyMut } from "@kindling/core";
import { assert, test } from "./harness.ts";
import { codec, packCommand, unpackCommand } from "../src/sim/codec.ts";
import { cpuMatch, playCpuMatch } from "../src/sim/headless.ts";
import { baseTuning, IDLE, type Spec } from "../src/sim/types.ts";

const SPEC: Spec = { seed: 42, rovers: ["scout", "brute", "spark", "scout"] };

test("same seed, same match (twice in one process)", () => {
  const a = playCpuMatch(SPEC).world;
  const b = playCpuMatch(SPEC).world;
  assert.equal(a.hash(), b.hash());
  assert.deepEqual(a.sections(), b.sections());
  assert.notEqual(playCpuMatch({ ...SPEC, seed: 43 }).world.hash(), a.hash());
});

test("two worlds stepped interleaved match two run alone (no shared state)", () => {
  const x = cpuMatch(SPEC);
  const y = cpuMatch({ ...SPEC, seed: 7 });
  for (let i = 0; i < 3000; i++) {
    x.world.step(x.bots.map((b) => b.command(x.world)));
    y.world.step(y.bots.map((b) => b.command(y.world)));
  }
  const alone = cpuMatch(SPEC);
  for (let i = 0; i < 3000; i++) alone.world.step(alone.bots.map((b) => b.command(alone.world)));
  assert.equal(x.world.hash(), alone.world.hash());
});

test("a CPU match finishes with a champion", () => {
  for (const n of [2, 3, 4]) {
    const w = playCpuMatch({ seed: 100 + n, rovers: SPEC.rovers.slice(0, n) }).world;
    assert.equal(w.state.match.phase, "done", `${n} players`);
    const champ = w.state.rovers[w.state.match.winner];
    assert.equal(champ.wins, w.winRounds);
    assert.ok(w.state.rovers.every((r) => r === champ || r.wins < w.winRounds));
  }
});

test("the codec round-trips and merging keeps a tap between ticks", () => {
  const c = { mx: -100, mz: 37, attack: true, dash: false, special: true };
  assert.deepEqual(unpackCommand(packCommand(c)), c);
  assert.deepEqual(unpackCommand(packCommand(IDLE)), IDLE);
  const merged = codec.merge(
    [
      { ...IDLE, mx: 50, dash: true },
      { ...IDLE, mx: -20, mz: 10 },
    ],
    IDLE,
  );
  assert.deepEqual(merged, { ...IDLE, mx: -20, mz: 10, dash: true });
});

test("MUT tuning changes the match (data-driven balance)", () => {
  const t = applyMut(baseTuning(), "moves.attack.knock*=2; rovers.*.mass=0.6");
  assert.equal(t.rovers.brute.mass, 0.6);
  const a = playCpuMatch(SPEC).world.hash();
  const b = playCpuMatch(SPEC, { tuning: t }).world.hash();
  assert.notEqual(a, b);
});
