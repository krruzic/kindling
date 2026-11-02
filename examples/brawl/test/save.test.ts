// Save: defaults, the v1 -> v2 migration (one volume -> three levels, shake boolean -> level), option snapping,
// names per seat, records.
import { memoryStorage } from "@kindling/save";
import { assert, test } from "./harness.ts";
import { createSave, SAVE_KEY, SAVE_VERSION } from "../src/app/save.ts";

test("save: fresh defaults, written as an envelope with the schema version", () => {
  const st = memoryStorage();
  const s = createSave(st);
  assert.equal(s.data.options.music, 6);
  s.write();
  assert.equal(JSON.parse(st.getItem(SAVE_KEY)!).v, SAVE_VERSION);
});

test("save: a v1 save migrates (volume -> music/sfx/ambience, shake -> level) and keeps its names", () => {
  const v1 = {
    v: 1,
    data: {
      options: { volume: 0.5, shake: false, holidays: 0 },
      names: { a: { name: "KAY", last: 5, wins: 3, games: 4 } },
    },
  };
  const st = memoryStorage({ [SAVE_KEY]: JSON.stringify(v1) });
  const s = createSave(st);
  assert.equal(s.store.info.from, 1);
  assert.ok(s.store.info.migrated);
  assert.deepEqual(s.data.options, { music: 5, sfx: 5, ambience: 3, shake: 0, scale: 0, holidays: 0, cpu: 1 });
  assert.equal(s.names.get("a")?.wins, 3);
  assert.equal(JSON.parse(st.getItem(SAVE_KEY)!).v, 2, "upgraded save written back");
  assert.equal((s.data.options as unknown as Record<string, unknown>).volume, undefined);
});

test("save: option values the menu can't show snap back; seat names and rover records persist", () => {
  const st = memoryStorage({ [SAVE_KEY]: JSON.stringify({ v: 2, data: { options: { scale: 33, shake: 7 } } }) });
  const s = createSave(st);
  assert.equal(s.data.options.scale, 0);
  assert.equal(s.data.options.shake, 2);
  assert.equal(s.seatName(1), "P2");
  assert.equal(s.setSeatName(1, "zed!"), "ZED");
  s.rovers.result("brute", "w");
  const again = createSave(st);
  assert.equal(again.seatName(1), "ZED");
  assert.equal(again.rovers.get("brute").w, 1);
});
