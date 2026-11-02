// Memo cache invalidation, screen stack, layout debugger, key repeat and component models (menu list, options,
// dialog, name entry, callouts, cards), all with fakes (no DOM).
import { LayoutDebug } from "../src/debug.ts";
import { Memo } from "../src/memo.ts";
import { KeyRepeat, NavRepeater, NO_NAV, type Nav } from "../src/nav.ts";
import { ScreenManager, type Screen } from "../src/screens.ts";
import { MenuList } from "../src/components/menuList.ts";
import { OptionsPage, adjustRow, type OptionRow } from "../src/components/options.ts";
import { Dialog } from "../src/components/dialog.ts";
import { NameEntry } from "../src/components/nameEntry.ts";
import { Callouts, slam } from "../src/components/callouts.ts";
import { cardLayout } from "../src/components/card.ts";
import { PlateCache } from "../src/paint/plates.ts";
import { eq, fakeCanvas, fakeCtx, fakeUi, near, ok, test } from "./harness.ts";

const nav = (o: Partial<Nav>): Nav => ({ ...NO_NAV, ...o });

// ── Memo ──

test("memo: repaints only when the key changes", () => {
  const memo = new Memo({ canvas: fakeCanvas });
  const ctx = fakeCtx(2);
  let painted = 0;
  const draw = () => ++painted;
  memo.draw(ctx, "p", "k1", 10, 10, 50, 20, draw);
  memo.draw(ctx, "p", "k1", 10, 10, 50, 20, draw);
  eq(painted, 1);
  eq(memo.draw(ctx, "p", "k1", 10, 10, 50, 20, draw), 1, "returns the cached result");
  memo.draw(ctx, "p", "k2", 10, 10, 50, 20, draw);
  eq(painted, 2);
  eq(ctx.calls.filter((c) => c === "drawImage").length, 4, "always blits");
});

test("memo: transform, rect, extra key and invalidate() force a repaint", () => {
  let ready = false;
  const memo = new Memo({ canvas: fakeCanvas, extraKey: () => String(ready) });
  const ctx = fakeCtx(2);
  let painted = 0;
  const draw = () => ++painted;
  memo.draw(ctx, "p", "k", 0, 0, 10, 10, draw);
  ctx.setTransform(3, 0, 0, 3, 0, 0);
  memo.draw(ctx, "p", "k", 0, 0, 10, 10, draw);
  eq(painted, 2, "device scale change");
  memo.draw(ctx, "p", "k", 5, 0, 10, 10, draw);
  eq(painted, 3, "moved");
  ready = true;
  memo.draw(ctx, "p", "k", 5, 0, 10, 10, draw);
  eq(painted, 4, "font became ready");
  memo.invalidate("p");
  memo.draw(ctx, "p", "k", 5, 0, 10, 10, draw);
  eq(painted, 5);
  memo.invalidate();
  memo.draw(ctx, "p", "k", 5, 0, 10, 10, draw);
  eq(painted, 6);
  eq(memo.repaints, 6);
});

test("memo: faded or rotated contexts draw directly; idle panels are freed", () => {
  const memo = new Memo({ canvas: fakeCanvas, maxIdle: 2 });
  const ctx = fakeCtx();
  let painted = 0;
  ctx.globalAlpha = 0.5;
  memo.draw(ctx, "p", "k", 0, 0, 10, 10, () => ++painted);
  memo.draw(ctx, "p", "k", 0, 0, 10, 10, () => ++painted);
  eq(painted, 2);
  eq(memo.size, 0);
  ctx.globalAlpha = 1;
  memo.draw(ctx, "q", "k", 0, 0, 10, 10, () => ++painted);
  eq(memo.size, 1);
  memo.tick();
  memo.tick();
  memo.tick();
  eq(memo.size, 0);
});

test("plates: bake once per id / size / device scale", () => {
  const plates = new PlateCache(10, fakeCanvas);
  const ctx = fakeCtx(2);
  let n = 0;
  for (let i = 0; i < 3; i++) plates.draw(ctx, "a", 0, 0, 10, 10, () => n++);
  eq(n, 1);
  plates.draw(ctx, "a", 0, 0, 12, 10, () => n++);
  ctx.setTransform(4, 0, 0, 4, 0, 0);
  plates.draw(ctx, "a", 0, 0, 12, 10, () => n++);
  eq(n, 3);
});

// ── Screens ──

function screen(name: string, log: string[], opaque = true): Screen<string> {
  return {
    name,
    opaque,
    enter: () => log.push(`enter ${name}`),
    exit: () => log.push(`exit ${name}`),
    update: (_dt, input) => log.push(`update ${name} ${input}`),
    draw: (_c, _w, _h, ph) => log.push(`draw ${name} ${ph.phase}`),
  };
}

test("screens: push / pop with transitions; input only to the settled top", () => {
  const log: string[] = [];
  const sm = new ScreenManager<string>({ kind: "fade", duration: 0.2 });
  sm.push(screen("title", log));
  ok(sm.busy);
  sm.update(0.1, "x");
  eq(log.includes("update title x"), false, "no input mid-transition");
  sm.update(0.15, "y");
  ok(!sm.busy);
  sm.update(0.016, "z");
  ok(log.includes("update title z"));
  sm.push(screen("menu", log));
  eq(sm.names, ["title", "menu"]);
  sm.update(0.25, "a");
  log.length = 0;
  sm.draw(fakeCtx(), 100, 100);
  eq(log, ["draw menu idle"], "opaque settled top hides the screen below");
  sm.pop();
  eq(sm.names, ["title"]);
  log.length = 0;
  sm.draw(fakeCtx(), 100, 100);
  eq(log, ["draw title idle", "draw menu exit"], "leaving screen drawn on top while it exits");
  sm.update(0.25, "b");
  log.length = 0;
  sm.draw(fakeCtx(), 100, 100);
  eq(log, ["draw title idle"]);
});

test("screens: overlays show the screen below; replace / popTo / reset", () => {
  const log: string[] = [];
  const none = { kind: "none" as const, duration: 0 };
  const sm = new ScreenManager<string>(none);
  sm.push(screen("game", log));
  sm.push(screen("pause", log, false));
  log.length = 0;
  sm.draw(fakeCtx(), 1, 1);
  eq(log, ["draw game idle", "draw pause idle"]);
  sm.replace(screen("confirm", log, false));
  eq(sm.names, ["game", "confirm"]);
  sm.push(screen("a", log));
  sm.push(screen("b", log));
  sm.popTo("game");
  eq(sm.names, ["game"]);
  sm.reset(screen("title", log));
  eq(sm.names, ["title"]);
  ok(log.includes("exit game"));
});

// ── Debug ──

test("debug: flags overflow, sibling overlap and off-screen elements", () => {
  const d = new LayoutDebug();
  d.begin(null, { x: 0, y: 0, w: 100, h: 100 });
  const card = { x: 10, y: 10, w: 40, h: 40 };
  d.box("fits", { x: 12, y: 12, w: 30, h: 10 }, { bounds: card });
  d.content("long text", 12, 12, 60, 10, card);
  d.box("a", { x: 0, y: 60, w: 30, h: 20 }, { group: "cards" });
  d.box("b", { x: 20, y: 60, w: 30, h: 20 }, { group: "cards" });
  d.box("c", { x: 50, y: 60, w: 30, h: 20 }, { group: "cards" });
  d.box("footer", { x: 0, y: 95, w: 100, h: 10 });
  const issues = d.end();
  eq(
    issues.map((i) => `${i.kind}:${i.id}`),
    ["overflow:long text", "offscreen:footer", "overlap:a"],
  );
  d.strict = true;
  d.begin(null);
  let threw = false;
  try {
    d.box("x", { x: 0, y: 0, w: 10, h: 10 }, { bounds: { x: 0, y: 0, w: 5, h: 5 } });
  } catch {
    threw = true;
  }
  ok(threw);
});

test("debug: rects compare in screen space through the context transform", () => {
  const d = new LayoutDebug();
  const ctx = fakeCtx(4);
  d.begin(ctx);
  ctx.save();
  ctx.translate(50, 0);
  d.box("moved", { x: 0, y: 0, w: 10, h: 10 }, { ctx, group: "g" });
  ctx.restore();
  d.box("fixed", { x: 55, y: 0, w: 10, h: 10 }, { ctx, group: "g" });
  const is = d.end();
  eq(is.length, 1);
  eq(is[0].rect, { x: 50, y: 0, w: 10, h: 10 });
});

// ── Nav ──

test("key repeat: step on press, delay, then steady rate", () => {
  const r = new KeyRepeat(0.3, 0.1);
  eq(r.update(1, 0.016), 1);
  let steps = 0;
  for (let t = 0; t < 0.29; t += 0.01) steps += r.update(1, 0.01);
  eq(steps, 0, "nothing during the delay");
  for (let i = 0; i < 31; i++) steps += r.update(1, 0.01);
  ok(steps >= 2 && steps <= 3, `steps ${steps}`);
  eq(r.update(0, 0.01), 0);
  eq(r.update(-1, 0.01), -1);
});

test("nav repeater: button edges, not holds", () => {
  const n = new NavRepeater();
  eq(n.update({ x: 0, y: 1, a: true, b: false }, 0.016).a, true);
  const second = n.update({ x: 0, y: 1, a: true, b: false }, 0.016);
  eq([second.a, second.dy], [false, 0]);
  eq(n.update({ x: 0, y: 0, a: false, b: true }, 0.016).b, true);
});

// ── Menu list ──

test("menu list: skips disabled items, wraps, selects and backs out", () => {
  const sounds: string[] = [];
  const m = new MenuList(
    [
      { id: "a", label: "A", disabled: true },
      { id: "b", label: "B" },
      { id: "c", label: "C", disabled: true },
      { id: "d", label: "D" },
    ],
    { sound: (k) => sounds.push(k) },
  );
  eq(m.index, 1, "starts on the first enabled item");
  eq(m.update(nav({ dy: 1 })), { type: "move", index: 3 });
  eq(m.update(nav({ dy: 1 })), { type: "move", index: 1 }, "wraps past the disabled first item");
  eq(m.update(nav({ a: true }))?.type, "select");
  eq(m.update(nav({ b: true })), { type: "back" });
  eq(sounds, ["move", "move", "ok", "back"]);
  const clamp = new MenuList(
    [
      { id: "x", label: "X" },
      { id: "y", label: "Y" },
    ],
    { wrap: false },
  );
  clamp.update(nav({ dy: -1 }));
  eq(clamp.index, 0);
});

test("menu list: scrolling keeps the selection visible", () => {
  const m = new MenuList(Array.from({ length: 20 }, (_, i) => ({ id: `${i}`, label: `${i}` })));
  m.index = 15;
  const L = m.layout({ x: 0, y: 0, w: 100, h: 100 }, 16, 2, 10);
  ok(L.rows[15] !== null);
  ok(L.rows[0] === null);
  ok(L.up);
  const vis = L.rows.filter(Boolean) as { y: number; h: number }[];
  for (const r of vis) ok(r.y >= 0 && r.y + r.h <= 100);
});

test("menu list: pointer hover and click", () => {
  const m = new MenuList([
    { id: "a", label: "A" },
    { id: "b", label: "B" },
  ]);
  eq(m.update(NO_NAV, { x: 0, y: 0, moved: true, click: false, hit: "menu:1" }), { type: "move", index: 1 });
  eq(m.update(NO_NAV, { x: 0, y: 0, moved: false, click: true, hit: "menu:1" })?.type, "select");
});

// ── Options ──

function rows(state: { vol: number; on: boolean; mode: number }): OptionRow[] {
  return [
    {
      kind: "slider",
      id: "vol",
      label: "VOLUME",
      min: 0,
      max: 10,
      step: 1,
      get: () => state.vol,
      set: (v) => (state.vol = v),
    },
    { kind: "toggle", id: "on", label: "SHAKE", get: () => state.on, set: (v) => (state.on = v) },
    {
      kind: "choice",
      id: "mode",
      label: "MODE",
      options: ["A", "B", "C"],
      get: () => state.mode,
      set: (i) => (state.mode = i),
    },
    { kind: "action", id: "reset", label: "RESET", run: () => Object.assign(state, { vol: 5, on: false, mode: 0 }) },
  ];
}

test("options: sliders clamp, toggles flip, choices wrap", () => {
  const s = { vol: 9, on: false, mode: 2 };
  const r = rows(s);
  ok(adjustRow(r[0], 1));
  eq(s.vol, 10);
  eq(adjustRow(r[0], 1), false, "clamped at max");
  adjustRow(r[1], -1);
  eq(s.on, true);
  adjustRow(r[2], 1);
  eq(s.mode, 0, "wraps");
  adjustRow(r[2], -1);
  eq(s.mode, 2);
});

test("options page: navigation, adjust events, A on slider wraps, actions run", () => {
  const s = { vol: 10, on: false, mode: 0 };
  const p = new OptionsPage(rows(s));
  eq(p.update(nav({ a: true }))?.type, "change");
  eq(s.vol, 0, "A at max wraps to min");
  eq(p.update(nav({ dx: 1 }))?.type, "change");
  eq(s.vol, 1);
  p.update(nav({ dy: -1 }));
  eq(p.focused?.id, "reset");
  eq(p.update(nav({ a: true }))?.type, "action");
  eq(s.vol, 5);
  eq(p.update(nav({ b: true })), { type: "back" });
});

test("options page: a listening keybind row holds the input", () => {
  let listening = true;
  let rebinds = 0;
  const p = new OptionsPage([
    {
      kind: "keybind",
      id: "jump",
      label: "JUMP",
      get: () => null,
      listening: () => listening,
      rebind: () => rebinds++,
    },
    { kind: "toggle", id: "t", label: "T", get: () => false, set: () => {} },
  ]);
  eq(p.update(nav({ dy: 1 })), null);
  eq(p.index, 0);
  listening = false;
  p.update(nav({ a: true }));
  eq(rebinds, 1);
});

// ── Dialog / name entry ──

test("dialog: defaults to the safe choice, moves, chooses, cancels", () => {
  const d = new Dialog("ERASE?", "All records will be lost.", ["ERASE", "KEEP"], { initial: 1 });
  eq(d.update(nav({ a: true })), { type: "choose", index: 1, option: "KEEP" });
  d.update(nav({ dx: -1 }));
  eq(d.update(nav({ a: true }))?.type, "choose");
  eq(d.index, 0);
  d.update(nav({ dx: -1 }));
  eq(d.index, 0, "clamped");
  eq(d.update(nav({ b: true })), { type: "cancel" });
});

test("name entry: grid typing, length limit, B deletes before cancelling", () => {
  const e = new NameEntry("", 3, "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-!", 10);
  eq(e.rows.length, 5);
  e.update(nav({ a: true }));
  e.update(nav({ dx: 1 }));
  e.update(nav({ a: true }));
  eq(e.text, "AB");
  e.update(nav({ dy: 1 }));
  eq(e.key, "L");
  e.update(nav({ a: true }));
  e.update(nav({ a: true }));
  eq(e.text, "ABL", "max length");
  eq(e.update(nav({ b: true })), "type");
  eq(e.text, "AB");
  e.update(nav({ y: true }));
  eq(e.key, "DONE");
  eq(e.update(nav({ a: true })), "done");
  const empty = new NameEntry("");
  eq(empty.update(nav({ b: true })), "cancel");
  empty.update(nav({ dy: -1 }));
  eq(empty.row, empty.rows.length - 1, "wraps to the special row");
  empty.col = 2;
  eq(empty.update(nav({ a: true })), null, "DONE refuses an empty name");
});

// ── Callouts ──

test("slam: overshoot, settle, hold, fade", () => {
  const a = slam(0, 2);
  ok(a.scale > 2 && a.alpha === 0);
  const b = slam(0.14, 2);
  near(b.scale, 1, 0.12);
  eq(slam(0.5, 2), { scale: 1, alpha: 1, shake: 0, done: false });
  const f = slam(1.9, 2);
  ok(f.alpha > 0 && f.alpha < 1);
  ok(slam(2, 2).done);
});

test("callouts: one big at a time, banners up to the cap, the rest queue", () => {
  const c = new Callouts();
  c.maxBanners = 2;
  c.push("FIGHT", { lane: "big", hold: 1 });
  c.push("ROUND 2", { lane: "big", hold: 1 });
  c.push("one");
  c.push("two");
  c.push("three");
  c.update(0);
  eq(
    c.showing.map((x) => x.text),
    ["FIGHT", "one", "two"],
  );
  eq(c.waiting, 2);
  c.update(1.01);
  eq(
    c.showing.map((x) => x.text),
    ["one", "two", "ROUND 2"],
  );
  c.update(2.7);
  eq(
    c.showing.map((x) => x.text),
    ["three"],
  );
});

// ── Cards ──

test("card: auto height grows with the body; maxH caps it", () => {
  const ui = fakeUi();
  const short = cardLayout(ui, 0, 0, 120, { title: "SWORD", body: "Sharp." });
  const long = cardLayout(ui, 0, 0, 120, {
    title: "SWORD",
    body: "A very sharp sword that cuts through anything you point it at, twice.",
  });
  ok(long.h > short.h);
  ok(long.body!.y + long.body!.h <= long.h);
  const capped = cardLayout(ui, 0, 0, 120, { title: "SWORD", body: "word ".repeat(80) }, { maxH: 60 });
  eq(capped.h, 60);
  ok(capped.body!.y + capped.body!.h <= 60 + 1e-9);
  const icon = cardLayout(ui, 0, 0, 120, { title: "T", icon: () => {} });
  ok(icon.icon !== null && icon.h >= icon.icon.h);
  ok(icon.title.x > icon.icon!.x + icon.icon!.w);
});
