import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assert, test } from "./harness.ts";
import {
  applyMut,
  distribution,
  envConfig,
  formatGrid,
  formatWinRates,
  matchupGrid,
  parseMut,
  shardEnv,
  shardOf,
  tally,
  winRates,
} from "../src/index.ts";
import { jsonlWriter, launcherScript, readJsonl, readJsonlAll, shq, writeLauncher } from "../src/node/index.ts";

test("shardOf partitions the list exactly", () => {
  const list = Array.from({ length: 23 }, (_, i) => i);
  const parts = [0, 1, 2, 3, 4].map((s) => shardOf(list, s, 5));
  assert.deepEqual(
    parts.flat().sort((a, b) => a - b),
    list,
  );
  assert.ok(Math.max(...parts.map((p) => p.length)) - Math.min(...parts.map((p) => p.length)) <= 1);
  assert.throws(() => shardOf(list, 5, 5));
  assert.deepEqual(shardEnv({ SHARD: "2", SHARDS: "4" }), { shard: 2, shards: 4 });
  assert.deepEqual(shardEnv({}), { shard: 0, shards: 1 });
  assert.throws(() => shardEnv({ SHARD: "4", SHARDS: "4" }));
});

test("envConfig parses typed values", () => {
  const c = envConfig(
    { GAMES: 20, FOCUS: "", HEROES: [] as string[], VERBOSE: false },
    { GAMES: "4", HEROES: "a, b,,c", VERBOSE: "yes" },
  );
  assert.deepEqual(c, { GAMES: 4, FOCUS: "", HEROES: ["a", "b", "c"], VERBOSE: true });
  assert.throws(() => envConfig({ GAMES: 1 }, { GAMES: "lots" }));
});

test("MUT: set, multiply, add, wildcards, indices", () => {
  const data = {
    heroes: { knight: { hp: 100, tags: ["a"] }, mage: { hp: 50, tags: [] as string[] } },
    waves: [{ every: 10 }, { every: 20 }],
    name: "x",
  };
  const counts: number[] = [];
  applyMut(
    data,
    'heroes.knight.hp=900; heroes.*.hp*=2; waves[1].every+=5; name="y z"; heroes.mage.tags=["q"]\nwaves.*.every*=0.5',
    counts,
  );
  assert.equal(data.heroes.knight.hp, 1800);
  assert.equal(data.heroes.mage.hp, 100);
  assert.deepEqual(data.waves, [{ every: 5 }, { every: 12.5 }]);
  assert.equal(data.name, "y z");
  assert.deepEqual(data.heroes.mage.tags, ["q"]);
  assert.deepEqual(counts, [1, 2, 1, 1, 1, 2]);
  assert.equal(parseMut("a=plain text")[0].value, "plain text");
  assert.deepEqual(parseMut(undefined), []);
});

test("MUT: typos and type errors fail loudly", () => {
  const data = { a: { b: 1, s: "x" } };
  assert.throws(() => applyMut(data, "a.c=2"), /no "c"/);
  assert.throws(() => applyMut(data, "a.s*=2"), /not a number/);
  assert.throws(() => applyMut(data, "a.b*=x"), /needs a number/);
  assert.throws(() => applyMut(data, "a.b"), /not path=value/);
  assert.equal(data.a.b, 1);
});

const rows = [
  { sides: [["knight"], ["mage"]], winner: 0, secs: 100, end: "core" },
  { sides: [["knight"], ["mage"]], winner: 0, secs: 120, end: "core" },
  { sides: [["mage"], ["knight"]], winner: 0, secs: 300, end: "timeout" },
  { sides: [["rogue"], ["knight"]], winner: -1, secs: 360, end: "timeout" },
  { sides: [["knight"], ["knight"]], winner: 1, secs: 90, end: "core" },
];

test("win rates skip mirrors and count draws", () => {
  const wr = Object.fromEntries(winRates(rows).map((r) => [r.name, r]));
  assert.deepEqual([wr.knight.wins, wr.knight.losses, wr.knight.draws], [2, 1, 1]);
  assert.equal(wr.knight.rate, 0.5);
  assert.equal(wr.mage.rate, 1 / 3);
  assert.equal(wr.rogue.draws, 1);
  assert.ok(wr.knight.ci95 > 0);
  assert.match(formatWinRates(winRates(rows)), /knight/);
});

test("matchup grid, distributions and tallies", () => {
  const g = matchupGrid(rows);
  assert.deepEqual(g.names, ["knight", "mage", "rogue"]);
  assert.equal(g.cell.knight.mage.wins, 2);
  assert.equal(g.cell.mage.knight.wins, 1);
  assert.equal(g.cell.knight.rogue.draws, 1);
  assert.match(formatGrid(g), /vs/);
  const d = distribution(
    rows.map((r) => r.secs),
    3,
  );
  assert.equal(d.n, 5);
  assert.equal(d.p50, 120);
  assert.equal(d.min, 90);
  assert.deepEqual(d.hist, [3, 0, 2]);
  assert.deepEqual(
    tally(rows, (r) => r.end).map((t) => [t.key, t.count]),
    [
      ["core", 3],
      ["timeout", 2],
    ],
  );
});

test("jsonl write and read back, torn last line skipped", () => {
  const dir = mkdtempSync(join(tmpdir(), "kindling-jsonl-"));
  const w = jsonlWriter(join(dir, "shard-0.jsonl"));
  w.write({ g: 0 });
  w.write({ g: 1 });
  writeFileSync(join(dir, "shard-1.jsonl"), '{"g":2}\n{"g":');
  assert.deepEqual(readJsonl(join(dir, "shard-0.jsonl")), [{ g: 0 }, { g: 1 }]);
  assert.deepEqual(
    readJsonlAll<{ g: number }>(dir).map((r) => r.g),
    [0, 1, 2],
  );
});

test("launcher: valid bash, runs shards detached, one blocking wait, DONE", () => {
  assert.equal(shq("it's"), `'it'\\''s'`);
  const dir = mkdtempSync(join(tmpdir(), "kindling-launch-"));
  const script = launcherScript({ command: "true", shards: 2, outDir: join(dir, "x"), env: { MUT: "a=1;b*=2" } });
  assert.match(script, /MUT='a=1;b\*=2'/);
  const path = writeLauncher(join(dir, "run.sh"), {
    name: "test",
    shards: 3,
    outDir: join(dir, "out"),
    cwd: dir,
    env: { MUT: "x.y=1;z*=2", GAMES: 2 },
    command: `node -e 'for (let g = 0; g < +process.env.GAMES; g++) console.log(JSON.stringify({ shard: +process.env.SHARD, of: +process.env.SHARDS, g, mut: process.env.MUT }))'`,
  });
  execFileSync("bash", ["-n", path]);
  execFileSync(path, [], { stdio: "pipe" });
  const done = execFileSync(path, ["wait"], { encoding: "utf8", timeout: 30000 });
  assert.match(done, /codes 0 0 0/);
  const out = readJsonlAll<{ shard: number; of: number; g: number; mut: string }>(join(dir, "out"));
  assert.equal(out.length, 6);
  assert.deepEqual([...new Set(out.map((r) => r.shard))].sort(), [0, 1, 2]);
  assert.ok(out.every((r) => r.of === 3 && r.mut === "x.y=1;z*=2"));
});
