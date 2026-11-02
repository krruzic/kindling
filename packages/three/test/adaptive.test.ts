import { test, eq, ok } from "./harness.ts";
import { AdaptiveResolution } from "../src/adaptive.ts";

test("AdaptiveResolution: steps down on a slow p90, waits for a full window", () => {
  const a = new AdaptiveResolution({ budgetMs: 16.7, window: 60 });
  eq(a.scale, 1);
  for (let i = 0; i < 59; i++) ok(!a.frame(25), "no decision before the window is full");
  ok(a.frame(25), "steps down at the 60th slow frame");
  eq(a.level, 1);
  eq(a.scale, 0.85);
  for (let i = 0; i < 59; i++) a.frame(25);
  ok(a.frame(25));
  eq(a.level, 2, "keeps stepping while still slow");
});

test("AdaptiveResolution: a few slow frames don't trigger (p90 not mean)", () => {
  const a = new AdaptiveResolution({ budgetMs: 16.7, window: 60 });
  for (let i = 0; i < 600; i++) a.frame(i % 20 === 0 ? 40 : 12);
  eq(a.level, 0, "5% slow frames are under the 90th percentile");
});

test("AdaptiveResolution: steps back up only after sustained headroom", () => {
  const a = new AdaptiveResolution({ budgetMs: 16.7, window: 60, upAfterMs: 5000, level: 2 });
  let t = 0;
  let changedAt = -1;
  while (t < 20000) {
    t += 10;
    if (a.frame(10) && changedAt < 0) changedAt = t;
  }
  ok(changedAt >= 5000 + 600 - 10, `stepped up only after ~5 s of good frames (at ${changedAt} ms)`);
  eq(a.level, 0, "and keeps recovering");
  // Just under budget but not comfortably: hold.
  const b = new AdaptiveResolution({ budgetMs: 16.7, window: 60, level: 1 });
  for (let i = 0; i < 2000; i++) b.frame(15);
  eq(b.level, 1, "no step up without headroom");
});

test("AdaptiveResolution: ignores huge spikes and bottoms out", () => {
  const a = new AdaptiveResolution({ window: 10, levels: [1, 0.5] });
  for (let i = 0; i < 100; i++) a.frame(1000);
  eq(a.level, 0, "background-tab frames ignored");
  for (let i = 0; i < 100; i++) a.frame(40);
  eq(a.level, 1);
  eq(a.scale, 0.5);
});
