// Hash stability: these digests are what baselines and lockstep peers compare; they must never change.
import { assert, test } from "./harness.ts";
import { Hasher, diffSections, fnv1a, hashValue, hex32, sectionHashes } from "../src/index.ts";

test("fnv1a textbook vectors", () => {
  const bytes = (s: string) => [...s].map((c) => c.charCodeAt(0));
  assert.equal(fnv1a([]), 0x811c9dc5);
  assert.equal(fnv1a(bytes("a")), 0xe40c292c);
  assert.equal(fnv1a(bytes("foobar")), 0xbf9cf968);
});

test("hasher pinned digests", () => {
  const h = new Hasher().u32(1).i32(-1).q(1.5).f(0.1).str("kindling").bool(true).arr([1, "a", false]);
  assert.equal(h.hex(), "b3e6da97");
  assert.equal(hex32(hashValue({ b: [1, 2, { c: "x" }], a: null })), "0cf8d928");
});

test("value hashing ignores key order but not array order", () => {
  assert.equal(hashValue({ a: 1, b: 2 }), hashValue({ b: 2, a: 1 }));
  assert.notEqual(hashValue([1, 2]), hashValue([2, 1]));
  assert.notEqual(hashValue(["ab", "c"]), hashValue(["a", "bc"]));
  assert.notEqual(hashValue(1), hashValue("1"));
});

test("float canonicalisation and quantisation", () => {
  assert.equal(new Hasher().f(0).digest(), new Hasher().f(-0).digest());
  assert.equal(new Hasher().f(NaN).digest(), new Hasher().f(0 / 0).digest());
  assert.notEqual(new Hasher().f(0.1 + 0.2).digest(), new Hasher().f(0.3).digest());
  assert.equal(new Hasher().q(0.1 + 0.2).digest(), new Hasher().q(0.3).digest());
});

test("section hashes name what differs", () => {
  const a = sectionHashes({ players: (h) => h.u32(1), units: (h) => h.u32(2), rng: (h) => h.u32(3) }, 10);
  const b = sectionHashes({ players: (h) => h.u32(1), units: (h) => h.u32(9), rng: (h) => h.u32(3) }, 10);
  const c = sectionHashes({ players: (h) => h.u32(1), units: (h) => h.u32(2), rng: (h) => h.u32(3) }, 11);
  assert.notEqual(a.total, b.total);
  assert.notEqual(a.total, c.total);
  assert.deepEqual(diffSections(a.sections, b.sections), ["units"]);
  assert.deepEqual(diffSections(a.sections, { players: a.sections.players }), ["units", "rng"]);
});
