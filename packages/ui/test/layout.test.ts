// Layout math, UI canvas scaling and split-screen view rects.
import { anchor, contains, grid, inset, overlapArea, row, safeArea, splitX, stack, flowLength } from "../src/layout.ts";
import { computeUiMetrics } from "../src/uiCanvas.ts";
import { layoutViews, seams, splitViews } from "../src/split.ts";
import { eq, near, ok, test } from "./harness.ts";

const R = { x: 10, y: 20, w: 100, h: 60 };

test("inset: css-style padding", () => {
  eq(inset(R, 5), { x: 15, y: 25, w: 90, h: 50 });
  eq(inset(R, 1, 2, 3, 4), { x: 14, y: 21, w: 94, h: 56 });
  eq(inset(R, 100).w, 0);
});

test("stack: heights, gaps, justify and cross alignment", () => {
  const s = stack(R, [10, 20], { gap: 5 });
  eq(s, [
    { x: 10, y: 20, w: 100, h: 10 },
    { x: 10, y: 35, w: 100, h: 20 },
  ]);
  const c = stack(R, [10, 20], { gap: 5, justify: "center", cross: 40, align: "center" });
  near(c[0].y, 20 + (60 - 35) / 2);
  near(c[0].x, 10 + 30);
  const b = stack(R, [10, 10, 10], { justify: "between" });
  near(b[2].y + b[2].h, R.y + R.h);
  near(b[1].y, R.y + 25);
  eq(flowLength([10, 20], 5), 35);
});

test("row: widths and end alignment", () => {
  const r = row(R, [20, 30], { gap: 10, justify: "end" });
  near(r[1].x + r[1].w, R.x + R.w);
  near(r[0].x, R.x + R.w - 60);
  eq(r[0].h, 60);
});

test("grid: even cells and centred fixed cells", () => {
  const g = grid({ x: 0, y: 0, w: 100, h: 50 }, 6, { cols: 3, gap: 5 });
  eq(g.length, 6);
  near(g[0].w, 30);
  near(g[0].h, 22.5);
  near(g[5].x + g[5].w, 100);
  near(g[5].y + g[5].h, 50);
  const f = grid({ x: 0, y: 0, w: 100, h: 100 }, 4, { cols: 2, cellW: 20, cellH: 10, gap: 2, center: true });
  near(f[0].x, (100 - 42) / 2);
  near(f[0].y, (100 - 22) / 2);
});

test("anchor / contains / overlap / split", () => {
  eq(anchor(R, 20, 10, 1, 1), { x: 90, y: 70, w: 20, h: 10 });
  ok(contains(R, { x: 10, y: 20, w: 100, h: 60 }));
  ok(!contains(R, { x: 10, y: 20, w: 100.5, h: 60 }));
  eq(overlapArea({ x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 0, w: 10, h: 10 }), 0);
  eq(overlapArea({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5, w: 10, h: 10 }), 25);
  const [a, b] = splitX(R, 0.5, 10);
  near(a.w, 45);
  near(b.x, 65);
  near(b.w, 45);
});

test("safeArea: a 4:3 safe box stays on screen at 16:9, 16:10 and 4:3", () => {
  const H = 240;
  for (const aspect of [16 / 9, 16 / 10, 4 / 3]) {
    const W = H * aspect;
    const s = safeArea(W, H, 4 / 3, 0.05);
    ok(contains({ x: 0, y: 0, w: W, h: H }, s), `aspect ${aspect}`);
    near(s.w, 320 - 24);
    near(s.x + s.w / 2, W / 2);
  }
  // On a narrower screen it clips to the screen.
  const n = safeArea(200, 240, 16 / 9, 0);
  eq(n.w, 200);
});

test("UiCanvas metrics: fixed height mode follows the aspect and caps the backing store", () => {
  const m = computeUiMetrics({ kind: "height", height: 240 }, 1920, 1080, 1);
  eq([m.pw, m.ph], [1920, 1080]);
  near(m.w, 240 * (16 / 9));
  near(m.scale, 4.5);
  const hi = computeUiMetrics({ kind: "height", height: 240, maxPx: 2160 }, 2560, 1440, 2);
  eq(hi.ph, 2160);
  eq(hi.pw, 3840);
  near(hi.scale, 9);
  const t = computeUiMetrics({ kind: "height", height: 240 }, 1280, 800, 1);
  near(t.w, 384);
});

test("UiCanvas metrics: pixel mode picks the largest integer scale and centres the stage", () => {
  const m = computeUiMetrics({ kind: "pixel", width: 480, height: 270 }, 1920, 1080, 1);
  eq(m.scale, 4);
  eq(m.stage, { x: 0, y: 0, w: 480, h: 270 });
  const k = computeUiMetrics({ kind: "pixel", width: 480, height: 270 }, 1280, 720, 1);
  eq(k.scale, 2);
  eq(k.stage.x, Math.floor((640 - 480) / 2));
  eq(k.stage.y, Math.floor((360 - 270) / 2));
  const capped = computeUiMetrics({ kind: "pixel", width: 480, height: 270, maxScale: 2 }, 3840, 2160, 1);
  eq(capped.scale, 2);
  const tiny = computeUiMetrics({ kind: "pixel", width: 480, height: 270 }, 300, 200, 1);
  eq(tiny.scale, 1);
});

test("layoutViews: integer scales for 1-4 pixel views at 1080p", () => {
  const o = { viewW: 320, viewH: 176 };
  const one = layoutViews(1, 1920, 1080, o);
  eq(one.scale, 6);
  eq(one.rects[0], { x: 0, y: Math.floor((1080 - 1056) / 2), w: 1920, h: 1056 });
  const two = layoutViews(2, 1920, 1080, o);
  eq(two.scale, 3);
  eq(two.rects.length, 2);
  // side by side: 2 x 960 wide
  eq(two.rects[1].x, 960);
  const three = layoutViews(3, 1920, 1080, o);
  eq(three.scale, 3);
  ok(three.spare !== null);
  eq(three.rects.length, 3);
  const four = layoutViews(4, 1920, 1080, o);
  for (const r of four.rects) ok(contains({ x: 0, y: 0, w: 1920, h: 1080 }, r));
  const capped = layoutViews(1, 1920, 1080, { ...o, maxScale: 2 });
  eq(capped.scale, 2);
});

test("splitViews: fills the screen with whole-unit edges and gaps", () => {
  const v = splitViews(2, 1921, 1080, { gap: 4 });
  eq(v.rects[0], { x: 0, y: 0, w: 959, h: 1080 });
  eq(v.rects[1].x, 963);
  near(v.rects[1].x + v.rects[1].w, 1921);
  const s = splitViews(2, 1920, 1080, { vertical: true });
  eq(s.rects[1].y, 540);
  const q = splitViews(3, 100, 100);
  eq(q.rects.length, 3);
  eq(q.spare, { x: 50, y: 50, w: 50, h: 50 });
});

test("seams: one per shared edge, collinear pieces merged", () => {
  eq(seams(splitViews(1, 100, 100).rects).length, 0);
  const two = seams(splitViews(2, 100, 50).rects);
  eq(two, [{ dir: "v", at: 50, from: 0, len: 50 }]);
  const four = seams(splitViews(4, 100, 100).rects);
  eq(four.length, 2, "quadrants: one vertical + one horizontal line");
  eq(
    four.map((s) => [s.dir, s.at, s.from, s.len]),
    [
      ["h", 50, 0, 100],
      ["v", 50, 0, 100],
    ],
  );
  const gapped = seams(splitViews(4, 100, 100, { gap: 4 }).rects, 4);
  eq(gapped.length, 2);
  // 3 views plus the spare: still a full cross.
  const three = splitViews(3, 100, 100);
  eq(seams([...three.rects, three.spare!]).length, 2);
});
