// Text fitting with a fake measure function: wrap, shrink, ellipsis, paragraph fit, and the no-overflow guarantee.
import { breakWord, ellipsize, fitBlock, fitLine, shrinkToFit, wrap } from "../src/text.ts";
import { eq, mono, near, ok, test } from "./harness.ts";

test("wrap: greedy word wrap with explicit newlines", () => {
  // size 10: each char 6 units; width 60 = 10 chars
  eq(wrap(mono, "the quick brown fox jumps", 60, 10), ["the quick", "brown fox", "jumps"]);
  eq(wrap(mono, "one\n\ntwo", 60, 10), ["one", "", "two"]);
  eq(wrap(mono, "  spaced   out  ", 60, 10), ["spaced out"]);
});

test("wrap: words longer than the line break by character", () => {
  eq(breakWord(mono, "abcdefghijkl", 30, 10), ["abcde", "fghij", "kl"]);
  eq(wrap(mono, "hi abcdefghijkl", 30, 10), ["hi", "abcde", "fghij", "kl"]);
});

test("shrinkToFit: largest size within [min, size]", () => {
  near(shrinkToFit(mono, "abcde", 30, 10), 10);
  const s = shrinkToFit(mono, "abcdefghij", 30, 10, 4);
  ok(mono("abcdefghij", s) <= 30);
  ok(s > 4.5, `should shrink just enough, got ${s}`);
  eq(shrinkToFit(mono, "abcdefghij", 30, 10, 8), 8);
});

test("ellipsize: cuts with ... and fits", () => {
  eq(ellipsize(mono, "short", 60, 10), "short");
  const e = ellipsize(mono, "a long sentence here", 60, 10);
  ok(e.endsWith("..."));
  ok(mono(e, 10) <= 60);
  eq(e, "a long...");
  eq(ellipsize(mono, "abc", 10, 10), "");
});

test("fitLine: shrinks first, then ellipsizes", () => {
  const a = fitLine(mono, "abcdefgh", 40, 10, 5);
  eq(a.text, "abcdefgh");
  ok(!a.truncated);
  ok(a.width <= 40);
  const b = fitLine(mono, "abcdefghijklmnopqrst", 40, 10, 8);
  ok(b.truncated);
  eq(b.size, 8);
  ok(b.width <= 40);
});

test("fitBlock: auto height grows; bounded height shrinks then truncates", () => {
  const text = "the quick brown fox jumps over the lazy dog again and again";
  const auto = fitBlock(mono, text, 60, Infinity, { size: 10 });
  eq(auto.size, 10);
  near(auto.height, auto.lines.length * 12);
  ok(!auto.truncated);
  const shrunk = fitBlock(mono, text, 60, 50, { size: 10, minSize: 5 });
  ok(shrunk.size < 10);
  ok(shrunk.height <= 50 + 0.01);
  ok(!shrunk.truncated);
  const cut = fitBlock(mono, text, 60, 25, { size: 10, minSize: 10 });
  eq(cut.lines.length, 2);
  ok(cut.truncated);
  ok(cut.lines[1].endsWith("..."));
  const capped = fitBlock(mono, text, 60, Infinity, { size: 10, maxLines: 2 });
  eq(capped.lines.length, 2);
});

test("no-overflow guarantee: random strings never exceed their box", () => {
  let seed = 12345;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const alphabet = "abcdefghijklmnopqrstuvwxyzW      ";
  for (let k = 0; k < 400; k++) {
    const len = Math.floor(rnd() * 120);
    let s = "";
    for (let i = 0; i < len; i++) s += alphabet[Math.floor(rnd() * alphabet.length)];
    const w = 8 + rnd() * 120;
    const h = rnd() * 80;
    const b = fitBlock(mono, s, w, h, { size: 10, minSize: 6 });
    for (const l of b.lines) ok(mono(l, b.size) <= w + 1e-9, `line "${l}" ${mono(l, b.size)} > ${w}`);
    ok(b.height <= Math.max(h, 0) + 0.01, `block ${b.height} > ${h}`);
    const f = fitLine(mono, s, w, 10, 6);
    ok(f.width <= w + 1e-9);
  }
});
