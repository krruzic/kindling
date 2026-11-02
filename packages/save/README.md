# @kindling/save

Versioned saves in localStorage: a typed schema with defaults, migrations by version, option rows, signed player
names with ids, records tables (wins per name, personal bests), a capped match log, and JSON import / export. Safe in
node and anywhere localStorage throws (in-memory fallback).

## Why

- [One App object holds all client state](../../docs/LESSONS.md#architecture): the save is one typed document hung
  off it, read by menus and written after matches, never touched by the sim.
- [Presentation-only features stay out of the sim](../../docs/LESSONS.md#architecture): options such as holiday
  tweaks, FPS counter or render scale live here, so online players never need to agree on them.
- [Remapping per device, saved, applied on reconnect](../../docs/LESSONS.md#input): controller bindings are just
  another table in the save (`pads: Record<deviceKey, bindings>`), deep-filled like everything else.
- Grudge's save grew field by field over months; every new option had to appear with its default in old saves, a
  removed choice had to snap back to a valid one, and names had to keep their records when renamed. That is
  `fillDefaults`, `snapToRows` and `NameBook`'s ids.

## API

- `new SaveStore<T>(schema, storage?)`: `data`, `info` (`from`, `migrated`, `problem: "corrupt" | "future" | null`),
  `write()`, `update(fn)`, `load()`, `reset()`, `export()`, `import(json)`.
  - `schema`: `{ key, version, defaults(), migrations?: { [n]: (vNminus1) => vN }, sanitize?(data, defaults), format?: "envelope" | "flat" }`.
  - Stored as `{ v, data }`; `"flat"` stores `{ v, ...data }` (Grudge's layout, to adopt existing saves).
  - Corrupt saves and saves from a newer build are copied to `<key>.bak` before anything overwrites them.
- `fillDefaults(defaults, stored)`: deep fill; wrong types take the default; extra keys kept.
- Storage: `defaultStorage()` (localStorage if writable, else memory), `memoryStorage(init?)`, `StorageLike`.
- Options: `OptionRow<T>` (`key`, `label`, `values`, `fmt?`, `blurb?`), `cycleOption(obj, row, dir)`,
  `optionText(obj, row)`, `snapToRows(obj, rows, defaults)`, `onOff`.
- Names: `cleanName(name, { max = 8, upper = true, strip })`, `newId()`,
  `new NameBook<E>(() => table, { make, clean?, now?, id?, onChange? })`: `add`, `find`, `use`, `rename`, `remove`,
  `ids()` / `names()` most recent first, `get`.
- Records: `new RecordsTable(() => table, onChange?)`: `result(key, "w" | "l" | "d")`, `best(key, stat, value,
"max" | "min")` (true on a new best), `get`, `ranked(minGames)`, `clear()`; `outcomeOf(winner, side)`, `winRate`,
  `winRateText`, `games`, `pushLog(log, entry, max)`.

## Usage

```ts
import { NameBook, RecordsTable, SaveStore, snapToRows, type OptionRow, type RecordEntry } from "@kindling/save";

interface Data {
  options: { music: number; fps: number; holidays: number };
  tags: Record<string, { name: string; last: number; kills: number }>;
  heroes: Record<string, RecordEntry>;
  log: MatchLog[];
}
const OPTION_ROWS: OptionRow<Data["options"]>[] = [{ key: "music", label: "MUSIC", values: [0, 1, 2, 3, 4, 5] }];

export const save = new SaveStore<Data>({
  key: "mygame.save",
  version: 2,
  defaults: () => ({ options: { music: 4, fps: 0, holidays: 1 }, tags: {}, heroes: {}, log: [] }),
  migrations: { 2: (d) => ({ ...d, options: { ...d.options, music: d.options.volume } }) },
  sanitize: (d, def) => void snapToRows(d.options, OPTION_ROWS, def.options),
});
export const names = new NameBook(() => save.data.tags, { make: () => ({ kills: 0 }), onChange: () => save.write() });
export const heroes = new RecordsTable(
  () => save.data.heroes,
  () => save.write(),
);

// after a match
heroes.result(pick, outcomeOf(winner, team));
heroes.best(pick, "fastest", seconds, "min");
```

## In Grudge

`src/game/save.ts` held rules, options, tags (signed names keyed by id after a migration from name keys), per-hero
records, the last 30 matches and controller remaps under `grudge.save.v1`, with `RULE_ROWS` / `OPTION_ROWS` driving the
RULES and OPTIONS pages and `cycle()` stepping them. This package is that file with the game taken out.
