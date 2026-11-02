// The harness must catch: hidden state (module-level leakage), Math.random, changed results (naming the section),
// new and removed cases; and pass a clean sim.
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assert, test } from "./harness.ts";
import {
  Mulberry32,
  SimBase,
  compareBaseline,
  defineDeterminismCases,
  runSim,
  runSuite,
  sectionHashes,
} from "../src/index.ts";
import { runDeterminism } from "../src/node/index.ts";

interface Cmd {
  dx: number;
}
interface State {
  x: number[];
  score: number;
}

/** A clean toy sim: walkers pushed by commands and its own seeded RNG. */
class Walk extends SimBase<State, Cmd, never> {
  state: State;
  rng: Mulberry32;
  constructor(
    seed: number,
    private readonly leak: () => number = () => 0,
  ) {
    super(1 / 30);
    this.rng = new Mulberry32(seed);
    this.state = { x: [0, 0], score: 0 };
  }
  protected update(cmds: readonly Cmd[]): void {
    cmds.forEach((c, i) => (this.state.x[i] += c.dx + this.rng.range(-0.1, 0.1)));
    this.state.score += this.leak();
  }
  sections() {
    return sectionHashes(
      {
        walkers: (h) => h.arr(this.state.x, (hh, v) => hh.q(v)),
        score: (h) => h.f(this.state.score),
        rng: (h) => h.u32(this.rng.state),
      },
      this.tick,
    );
  }
  hash(): number {
    return this.sections().total;
  }
}

const CASES = [
  { name: "a", seed: 1, ticks: 300 },
  { name: "b", seed: 2, ticks: 200 },
];

function play(seed: number, ticks: number, leak?: () => number) {
  const bot = new Mulberry32(seed * 7);
  const w = runSim(new Walk(seed, leak), () => [{ dx: bot.range(-1, 1) }, { dx: bot.range(-1, 1) }], {
    maxTicks: ticks,
  });
  return w.sections();
}

const clean = defineDeterminismCases(CASES, (c) => play(c.seed, c.ticks));

test("clean sim: repeat runs agree and match their own baseline", () => {
  const run = runSuite(clean);
  assert.equal(run.hidden.length, 0);
  assert.equal(run.errors.length, 0);
  const base = Object.fromEntries(Object.entries(run.results).map(([k, v]) => [k, v.hash]));
  assert.ok(compareBaseline(runSuite(clean), base).ok);
});

let leaked = 0;
test("module-level state leaking into the sim is reported as hidden state", () => {
  const broken = defineDeterminismCases(CASES, (c) => play(c.seed, c.ticks, () => (leaked++ === 150 ? 1 : 0)));
  const run = runSuite(broken);
  assert.ok(run.hidden.length >= 1);
  assert.deepEqual(run.hidden[0].sections, ["score"]);
  const cmp = compareBaseline(run, {});
  assert.equal(cmp.ok, false);
  assert.ok(cmp.lines.some((l) => l.startsWith("HIDDEN STATE") && l.includes("score")));
});

test("Math.random in the sim is caught", () => {
  const broken = defineDeterminismCases(CASES, (c) => play(c.seed, c.ticks, () => Math.random()));
  assert.equal(runSuite(broken).hidden.length, 2);
});

test("a changed sim reports DIFF with the differing sections; new and gone cases too", () => {
  const base = runSuite(clean);
  const changed = defineDeterminismCases([...CASES, { name: "c", seed: 3, ticks: 10 }], (c) =>
    play(c.seed, c.name === "a" ? c.ticks + 1 : c.ticks),
  );
  const baseline = { ...Object.fromEntries(Object.entries(base.results)), old: 5 };
  const cmp = compareBaseline(runSuite(changed), baseline);
  assert.equal(cmp.ok, false);
  const kinds = Object.fromEntries(cmp.diffs.map((d) => [d.name, d.kind]));
  assert.deepEqual(kinds, { a: "changed", c: "new", old: "missing" });
  const a = cmp.diffs.find((d) => d.name === "a")!;
  assert.ok(a.sections.includes("walkers") && a.sections.includes("rng"));
  assert.ok(cmp.lines.some((l) => l.startsWith("DIFF a") && l.includes("walkers")));
});

test("plain-number (Grudge-format) baselines are accepted", () => {
  const run = runSuite(clean);
  const base = { a: run.results.a.hash, b: run.results.b.hash };
  assert.ok(compareBaseline(run, base).ok);
});

test("duplicate case names are rejected", () => {
  assert.throws(() => defineDeterminismCases([{ name: "x" }, { name: "x" }], () => 1));
});

test("errors in a case fail the run", () => {
  const s = defineDeterminismCases([{ name: "boom" }], () => {
    throw new Error("kaboom");
  });
  const cmp = compareBaseline(runSuite(s), {});
  assert.equal(cmp.ok, false);
  assert.ok(cmp.lines.some((l) => l.startsWith("ERROR boom")));
});

test("runDeterminism: --write then --check, and refuse to write hidden state", () => {
  const dir = mkdtempSync(join(tmpdir(), "kindling-det-"));
  const baselinePath = join(dir, "baseline.json");
  const log: string[] = [];
  const quiet = (l: string) => void log.push(l);
  assert.equal(runDeterminism(clean, { baselinePath, argv: ["--write"], log: quiet }).code, 0);
  const saved = JSON.parse(readFileSync(baselinePath, "utf8"));
  assert.deepEqual(Object.keys(saved), ["a", "b"]);
  assert.ok(saved.a.sections.walkers > 0);
  assert.equal(runDeterminism(clean, { baselinePath, argv: ["--check"], log: quiet }).code, 0);
  writeFileSync(baselinePath, JSON.stringify({ ...saved, a: { ...saved.a, hash: 1 } }));
  assert.equal(runDeterminism(clean, { baselinePath, argv: ["--check"], log: quiet }).code, 1);
  let n = 0;
  const broken = defineDeterminismCases(CASES, (c) => play(c.seed, c.ticks, () => n++));
  assert.equal(runDeterminism(broken, { baselinePath, argv: ["--write"], log: quiet }).code, 1);
  assert.equal(JSON.parse(readFileSync(baselinePath, "utf8")).a.hash, 1);
  assert.ok(log.some((l) => l.startsWith("Refusing")));
});
