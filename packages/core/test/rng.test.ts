// RNG sequences are part of every determinism baseline: these values must never change.
import { assert, test } from "./harness.ts";
import { Mulberry32, ParkMiller, RngStreams, mulberry32, parkMiller, mixSeed, seedOf } from "../src/index.ts";

/** Grudge's original implementations, copied verbatim, as the reference. */
function grudgeMulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function grudgeBotRand(seed: number): () => number {
  return () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
}

test("mulberry32 fixed sequence", () => {
  const r = new Mulberry32(1);
  assert.deepEqual([r.u32(), r.u32(), r.u32()], [2693262067, 11749833, 2265367787]);
});

test("mulberry32 matches Grudge's World.rng", () => {
  for (const seed of [0, 1, 11, 23, 0xdeadbeef, -5]) {
    const a = mulberry32(seed);
    const b = grudgeMulberry(seed);
    for (let i = 0; i < 200; i++) assert.equal(a(), b());
  }
});

test("park-miller is minstd (16807, 282475249, ...)", () => {
  const r = new ParkMiller(1);
  assert.deepEqual(
    [1, 2, 3, 4, 5].map(() => r.nextInt()),
    [16807, 282475249, 1622650073, 984943658, 1144108930],
  );
});

test("park-miller matches Grudge's bot rand", () => {
  for (const seed of [7 * 9973, 7 * 9973 + 131, 99999]) {
    const a = parkMiller(seed);
    const b = grudgeBotRand(seed);
    for (let i = 0; i < 200; i++) assert.equal(a(), b());
  }
});

test("park-miller never sticks at 0", () => {
  const r = new ParkMiller(0);
  for (let i = 0; i < 10; i++) assert.ok(r.next() > 0);
  assert.ok(new ParkMiller(2147483647).nextInt() > 0);
});

test("state round-trips", () => {
  const a = new Mulberry32(5);
  a.next();
  const b = new Mulberry32(0);
  b.state = a.state;
  assert.equal(a.next(), b.next());
  const p = new ParkMiller(9);
  p.next();
  const q = new ParkMiller(1);
  q.state = p.state;
  assert.equal(p.next(), q.next());
});

test("helpers are deterministic and in range", () => {
  const a = new Mulberry32(3);
  const b = new Mulberry32(3);
  assert.deepEqual(a.shuffle([1, 2, 3, 4, 5, 6]), b.shuffle([1, 2, 3, 4, 5, 6]));
  for (let i = 0; i < 1000; i++) {
    const n = a.int(7);
    assert.ok(n >= 0 && n < 7 && Number.isInteger(n));
    const f = a.range(-2, 3);
    assert.ok(f >= -2 && f < 3);
  }
  assert.equal(new Mulberry32(4).pick(["x"]), "x");
});

test("streams are independent of request order and of each other's draws", () => {
  const s1 = new RngStreams(42);
  const loot1 = s1.get("loot");
  s1.get("ai").u32();
  s1.get("ai").u32();
  const s2 = new RngStreams(42);
  s2.get("ai");
  const loot2 = s2.get("loot");
  assert.equal(loot1.u32(), loot2.u32());
  assert.equal(new RngStreams(42).get("loot").u32(), 3188876305);
  assert.notEqual(new RngStreams(42).get("loot").u32(), new RngStreams(43).get("loot").u32());
  const states = s1.states();
  const s3 = new RngStreams(42);
  s3.restore(states);
  assert.equal(s3.get("ai").u32(), s1.get("ai").u32());
});

test("split and seed mixing are stable", () => {
  assert.equal(seedOf("a"), seedOf("a"));
  assert.notEqual(mixSeed(1, 2), mixSeed(2, 1));
  const a = new Mulberry32(10).split("child");
  const b = new Mulberry32(10).split("child");
  assert.equal(a.u32(), b.u32());
  assert.notEqual(new Mulberry32(10).split("x").u32(), new Mulberry32(10).split("y").u32());
});
