import { assert, test } from "./harness.ts";
import {
  NameBook,
  RecordsTable,
  SaveStore,
  cleanName,
  cycleOption,
  defaultStorage,
  fillDefaults,
  memoryStorage,
  newId,
  onOff,
  optionText,
  outcomeOf,
  pushLog,
  snapToRows,
  winRateText,
  type NameEntry,
  type OptionRow,
  type RecordEntry,
  type SaveSchema,
} from "../src/index.ts";

interface Options {
  music: number;
  shake: number;
  holidays: number;
}
interface Tag extends NameEntry {
  kills: number;
}
interface Data {
  options: Options;
  tags: Record<string, Tag>;
  heroes: Record<string, RecordEntry>;
  log: { at: number; winner: number }[];
}

const DEFAULT_OPTIONS: Options = { music: 7, shake: 1, holidays: 1 };
const ROWS: OptionRow<Options>[] = [
  { key: "music", label: "MUSIC", values: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10] },
  { key: "shake", label: "SCREEN SHAKE", values: [1, 0], fmt: onOff },
];

const schema: SaveSchema<Data> = {
  key: "game.save",
  version: 3,
  defaults: () => ({ options: { ...DEFAULT_OPTIONS }, tags: {}, heroes: {}, log: [] }),
  migrations: {
    // v2 renamed options.vol -> options.music
    2: (d) => {
      const { vol, ...rest } = d.options ?? {};
      return { ...d, options: { ...rest, music: vol } };
    },
    // v3 keyed tags by id instead of by name
    3: (d) => ({
      ...d,
      tags: Object.fromEntries(
        Object.entries(d.tags ?? {}).map(([name, t], i) => [`id${i}`, { ...(t as object), name }]),
      ),
    }),
  },
  sanitize: (d, def) => void snapToRows(d.options, ROWS, def.options),
};

test("fresh save gets defaults; works without localStorage (node)", () => {
  const s = new SaveStore(schema, defaultStorage());
  assert.deepEqual(s.data, schema.defaults());
  assert.equal(s.info.from, null);
  assert.equal(s.write(), true);
});

test("writes and reloads", () => {
  const mem = memoryStorage();
  const s = new SaveStore(schema, mem);
  s.update((d) => (d.options.music = 3));
  assert.deepEqual(JSON.parse(mem.dump()["game.save"]).v, 3);
  assert.equal(new SaveStore(schema, mem).data.options.music, 3);
});

test("migrations run in order from an old version and are written back", () => {
  const mem = memoryStorage({
    "game.save": JSON.stringify({
      v: 1,
      data: { options: { vol: 4, shake: 0 }, tags: { ANA: { last: 5, kills: 2 } } },
    }),
  });
  const s = new SaveStore(schema, mem);
  assert.deepEqual(s.info, { from: 1, migrated: true, problem: null });
  assert.deepEqual(s.data.options, { music: 4, shake: 0, holidays: 1 });
  assert.deepEqual(s.data.tags, { id0: { name: "ANA", last: 5, kills: 2 } });
  assert.deepEqual(s.data.log, []);
  assert.equal(JSON.parse(mem.dump()["game.save"]).v, 3);
  assert.equal(new SaveStore(schema, mem).info.migrated, false);
});

test("defaults fill new keys; wrong types and retired values fall back", () => {
  const mem = memoryStorage({
    "game.save": JSON.stringify({
      v: 3,
      data: { options: { music: "loud", shake: 5 }, heroes: { a: { w: 1, l: 0, d: 0 } } },
    }),
  });
  const s = new SaveStore(schema, mem);
  assert.deepEqual(s.data.options, DEFAULT_OPTIONS);
  assert.deepEqual(s.data.heroes, { a: { w: 1, l: 0, d: 0 } });
  assert.deepEqual(fillDefaults({ a: [1], b: { c: 2 } }, { a: "x", b: null, z: 1 }), { a: [1], b: { c: 2 }, z: 1 });
});

test("corrupt and newer saves are backed up, not lost", () => {
  const corrupt = memoryStorage({ "game.save": "{not json" });
  const a = new SaveStore(schema, corrupt);
  assert.equal(a.info.problem, "corrupt");
  assert.equal(corrupt.dump()["game.save.bak"], "{not json");
  const newer = JSON.stringify({ v: 9, data: { options: { music: 2 }, extra: true } });
  const future = memoryStorage({ "game.save": newer });
  const b = new SaveStore(schema, future);
  assert.equal(b.info.problem, "future");
  assert.equal(b.data.options.music, 2);
  assert.equal(future.dump()["game.save.bak"], newer);
});

test("flat format reads a Grudge-style { v, ...data } save", () => {
  const flat: SaveSchema<{ options: Options }> = {
    key: "grudge.save.v1",
    version: 1,
    format: "flat",
    defaults: () => ({ options: { ...DEFAULT_OPTIONS } }),
  };
  const mem = memoryStorage({ "grudge.save.v1": JSON.stringify({ v: 1, options: { music: 2 }, tags: {} }) });
  const s = new SaveStore(flat, mem);
  assert.equal(s.data.options.music, 2);
  s.write();
  const raw = JSON.parse(mem.dump()["grudge.save.v1"]);
  assert.equal(raw.v, 1);
  assert.deepEqual(raw.tags, {});
});

test("export / import round trip, older exports migrate, bad imports change nothing", () => {
  const s = new SaveStore(schema, memoryStorage());
  s.update((d) => (d.options.music = 9));
  const json = s.export();
  const t = new SaveStore(schema, memoryStorage());
  assert.deepEqual(t.import(json), { ok: true });
  assert.equal(t.data.options.music, 9);
  assert.deepEqual(t.import(JSON.stringify({ v: 1, data: { options: { vol: 2 } } })), { ok: true });
  assert.equal(t.data.options.music, 2);
  assert.equal(t.import("nope").ok, false);
  assert.equal(t.import(JSON.stringify({ v: 99, data: {} })).ok, false);
  assert.equal(t.import(JSON.stringify({ key: "other", v: 1, data: {} })).ok, false);
  assert.equal(t.data.options.music, 2);
  t.reset();
  assert.equal(t.data.options.music, 7);
});

test("storage that throws on write does not crash", () => {
  const broken = {
    getItem: () => null,
    setItem: () => {
      throw new Error("QuotaExceededError");
    },
    removeItem: () => {},
  };
  const s = new SaveStore(schema, broken);
  assert.equal(s.write(), false);
});

test("option rows cycle, snap and format", () => {
  const o = { ...DEFAULT_OPTIONS };
  assert.equal(cycleOption(o, ROWS[0], 1), 8);
  o.music = 10;
  assert.equal(cycleOption(o, ROWS[0], 1), 0);
  assert.equal(cycleOption(o, ROWS[0], -1), 10);
  o.shake = 1;
  cycleOption(o, ROWS[1], 1);
  assert.equal(optionText(o, ROWS[1]), "OFF");
  o.music = 6.4;
  assert.equal(cycleOption(o, ROWS[0], 1), 7);
  o.shake = 3;
  assert.deepEqual(snapToRows(o, ROWS, DEFAULT_OPTIONS), ["shake"]);
  assert.equal(o.shake, 1);
});

test("names: clean, add/find by name, recent first, rename keeps the id", () => {
  assert.equal(cleanName("  ana-b!xyz99 "), "ANA-BXYZ");
  assert.match(newId(), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  const s = new SaveStore(schema, memoryStorage());
  let t = 100;
  let n = 0;
  const book = new NameBook<Tag>(() => s.data.tags, {
    make: () => ({ kills: 0 }),
    now: () => t++,
    id: () => `id${n++}`,
    onChange: () => s.write(),
  });
  const ana = book.add("ana")!;
  book.add("bo");
  assert.deepEqual(book.names(), ["BO", "ANA"]);
  assert.equal(book.add("ANA")!.id, ana.id);
  assert.deepEqual(book.names(), ["ANA", "BO"]);
  assert.equal(book.add("!!!"), null);
  assert.equal(book.rename(ana.id, "bo"), false);
  assert.equal(book.rename(ana.id, "cy"), true);
  assert.deepEqual(book.find("cy"), { id: ana.id, name: "CY" });
  assert.equal(book.get(ana.id)!.kills, 0);
  book.remove(ana.id);
  assert.deepEqual(book.names(), ["BO"]);
  assert.deepEqual(Object.keys(new SaveStore(schema, s.storage).data.tags), ["id1"]);
});

test("records: results, win rates, bests, ranking, log", () => {
  const s = new SaveStore(schema, memoryStorage());
  let writes = 0;
  const rec = new RecordsTable(
    () => s.data.heroes,
    () => writes++,
  );
  rec.result("knight", outcomeOf(0, 0));
  rec.result("knight", outcomeOf(1, 0));
  rec.result("knight", outcomeOf(-1, 0));
  rec.result("mage", "w");
  assert.deepEqual(rec.get("knight"), { w: 1, l: 1, d: 1 });
  assert.equal(winRateText(rec.get("knight")), "33%");
  assert.equal(winRateText(rec.get("nobody")), "-");
  assert.equal(rec.best("knight", "fastest", 90, "min"), true);
  assert.equal(rec.best("knight", "fastest", 95, "min"), false);
  assert.equal(rec.best("knight", "fastest", 80, "min"), true);
  assert.equal(rec.best("knight", "kills", 3), true);
  assert.equal(rec.best("knight", "kills", 3), false);
  assert.deepEqual(rec.get("knight").best, { fastest: 80, kills: 3 });
  assert.deepEqual(
    rec.ranked().map((r) => r.key),
    ["mage", "knight"],
  );
  assert.equal(writes, 7);
  rec.clear();
  assert.deepEqual(rec.get("knight"), { w: 0, l: 0, d: 0 });
  const log = s.data.log;
  for (let i = 0; i < 5; i++) pushLog(log, { at: i, winner: 0 }, 3);
  assert.deepEqual(
    log.map((l) => l.at),
    [4, 3, 2],
  );
});
