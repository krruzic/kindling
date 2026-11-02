// @kindling/ui demo: every component in both example themes. Keys: arrows / WASD move, Enter / Space = A,
// Escape / Backspace = B, Q / E switch scene, T switches theme, P cycles the prompt device, G toggles the layout
// debugger, 1-4 split views. URL: ?theme=wood|pixel&scene=menu|options|cards|name|dialog|split|debug&pad=..&debug=1
import {
  AtlasFont,
  CanvasFont,
  Callouts,
  Dialog,
  HitList,
  LayoutDebug,
  Memo,
  MenuList,
  NameEntry,
  NavRepeater,
  OptionsPage,
  ScreenManager,
  SpriteAtlas,
  UiCanvas,
  cardHeight,
  drawCard,
  drawPromptBar,
  drawSeams,
  inset,
  label,
  layoutViews,
  panel,
  paragraph,
  row,
  seams,
  splitViews,
  type Glyph,
  type HeldNav,
  type Nav,
  type OptionRow,
  type PromptItem,
  type Rect,
  type Screen,
  type Theme,
  type Ui,
} from "../src/index.ts";
import { woodTheme } from "../src/themes/wood.ts";
import { pixelTheme } from "../src/themes/pixel.ts";
import { icon } from "./icons.ts";

const q = new URLSearchParams(location.search);
const SCENES = ["menu", "options", "cards", "name", "dialog", "split", "debug"] as const;
type SceneName = (typeof SCENES)[number];

// ── Assets ──

const titleFace = new FontFace("DemoTitle", "url(./assets/fonts/PirataOne.ttf)");
const [font, pixelFont, gui] = await Promise.all([
  AtlasFont.load("./assets/font.png", "./assets/font.json", { name: "barlow", ink: "rgba(0,0,0,0.55)" }),
  AtlasFont.load("./assets/pixelfont.png", "./assets/pixelfont.json", { name: "pixel" }),
  SpriteAtlas.load("./assets/gui.png", "./assets/gui.json"),
  titleFace.load().then((f) => document.fonts.add(f)),
]);
const titleFont = new CanvasFont({ family: "DemoTitle", lineHeight: 1.15, tracking: 0.02 });
const THEMES: Record<string, Theme> = {
  wood: woodTheme({ font, titleFont }),
  pixel: pixelTheme({ font: pixelFont, atlas: gui }),
};

// ── Game-side data: glyphs per device family (the input package would provide these) ──

const PADS: Record<string, Record<"a" | "b" | "x" | "y" | "start" | "lr", Glyph>> = {
  keyboard: {
    a: { label: "ENTER", family: "keyboard" },
    b: { label: "ESC", family: "keyboard" },
    x: { label: "X", family: "keyboard" },
    y: { label: "Y", family: "keyboard" },
    start: { label: "TAB", family: "keyboard" },
    lr: { label: "Q/E", family: "keyboard" },
  },
  xbox: {
    a: { label: "A", family: "xbox" },
    b: { label: "B", family: "xbox" },
    x: { label: "X", family: "xbox" },
    y: { label: "Y", family: "xbox" },
    start: { label: "MENU", family: "xbox" },
    lr: { label: "LB/RB", family: "xbox" },
  },
  playstation: {
    a: { label: "X", family: "playstation" },
    b: { label: "O", family: "playstation" },
    x: { label: "□", family: "playstation" },
    y: { label: "△", family: "playstation" },
    start: { label: "OPTIONS", family: "playstation" },
    lr: { label: "L1/R1", family: "playstation" },
  },
  gamecube: {
    a: { label: "A", family: "gamecube" },
    b: { label: "B", family: "gamecube" },
    x: { label: "X", family: "gamecube" },
    y: { label: "Y", family: "gamecube" },
    start: { label: "START", family: "gamecube" },
    lr: { label: "L/R", family: "gamecube" },
  },
};
let pad = q.get("pad") ?? "xbox";
const P = () => PADS[pad] ?? PADS.xbox;
const prompts = (...items: [keyof (typeof PADS)["xbox"], string][]): PromptItem[] =>
  items.map(([k, l]) => ({ glyph: P()[k], label: l }));

const settings = { music: 7, sound: 9, shake: true, speed: 1, scale: 0, stereo: false };
let listening = "";
const binds: Record<string, string> = { jump: "a", attack: "x" };

// ── Shared state ──

let themeName = q.get("theme") === "pixel" ? "pixel" : "wood";
const canvas = new UiCanvas(modeFor(themeName), document.getElementById("app")!);
const debug = new LayoutDebug();
debug.enabled = q.has("debug");
const hits = new HitList();
const memo = new Memo({ extraKey: () => `${font.ready()}|${themeName}` });
const callouts = new Callouts();
let views = Number(q.get("views") ?? 3);

function modeFor(t: string) {
  return t === "pixel"
    ? ({ kind: "pixel", width: 480, height: 270 } as const)
    : ({ kind: "height", height: 240 } as const);
}

/** The scene area: the pixel stage, or the whole UI. */
function areaOf(): Rect {
  return canvas.stage;
}

let ui: Ui = { ctx: canvas.ctx, theme: THEMES[themeName], time: 0, debug, hits };

// ── Chrome ──

function chrome(a: Rect, title: string, items: PromptItem[]): Rect {
  const t = ui.theme;
  panel(ui, "backdrop", { x: 0, y: 0, w: canvas.w, h: canvas.h });
  const th = t.pixel ? 22 : 19;
  const tr = { x: a.x + 6, y: a.y + 4, w: a.w - 12, h: th };
  t.title?.(ui.ctx, title, tr, t);
  ui.debug?.box("title", tr, { group: "chrome", ctx: ui.ctx });
  const fh = t.pixel ? 18 : 16;
  const fr = { x: a.x + 6, y: a.y + a.h - fh - 2, w: a.w - 12, h: fh };
  const band = ui.ctx.createLinearGradient(0, fr.y - 6, 0, a.y + a.h);
  band.addColorStop(0, "rgba(0,0,0,0)");
  band.addColorStop(1, "rgba(0,0,0,0.55)");
  ui.ctx.fillStyle = band;
  ui.ctx.fillRect(0, fr.y - 6, canvas.w, canvas.h - fr.y + 6);
  drawPromptBar(ui, items, fr);
  return { x: a.x + 12, y: tr.y + th + 8, w: a.w - 24, h: fr.y - (tr.y + th + 8) - 6 };
}

// ── Scenes ──

const MENU_INFO: Record<string, { icon: string; eyebrow: string; body: string; footer: string }> = {
  campaign: {
    icon: "crown",
    eyebrow: "CHAPTER III",
    body: "Raise your banner over the old kingdom: twelve battles, a map of rival houses and a grudge that outlives them all.",
    footer: "62% COMPLETE",
  },
  versus: {
    icon: "sword",
    eyebrow: "2-4 PLAYERS",
    body: "Couch battles on one screen or split views. Any controller joins with a press.",
    footer: "LAST: BLUE WINS",
  },
  online: { icon: "flag", eyebrow: "LOCKSTEP", body: "Host a room or join one on the LAN.", footer: "OFFLINE" },
  options: {
    icon: "gear",
    eyebrow: "SETTINGS",
    body: "Sound, screen shake, text speed and button mapping per controller.",
    footer: "8 SETTINGS",
  },
  records: {
    icon: "scroll",
    eyebrow: "HALL OF FAME",
    body: "Every win, loss and name ever signed.",
    footer: "41 MATCHES",
  },
  quit: { icon: "shield", eyebrow: "", body: "Back to the title screen.", footer: "" },
};

const mainMenu = new MenuList([
  { id: "campaign", label: "CAMPAIGN" },
  { id: "versus", label: "VERSUS", value: "2-4P" },
  { id: "online", label: "VERSUS ONLINE", disabled: true },
  { id: "options", label: "OPTIONS" },
  { id: "records", label: "RECORDS" },
  { id: "quit", label: "QUIT" },
]);
mainMenu.index = 1;

function menuScene(): Screen<Nav> {
  return {
    name: "menu",
    enter: () => {
      callouts.clear();
      callouts.push("A NEW CHALLENGER APPROACHES", { sub: "PLAYER 3 JOINED WITH A GAMECUBE PAD", hold: 1e9 });
    },
    update: (_dt, nav) => {
      mainMenu.update(nav);
    },
    draw: () => {
      const t = ui.theme;
      const a = areaOf();
      const c = chrome(a, "KINDLING", prompts(["a", "SELECT"], ["b", "BACK"], ["lr", "SCENE"]));
      const lw = Math.min(t.pixel ? 170 : 150, c.w * 0.42);
      const rows = mainMenu.items.length;
      const listH = rows * t.metrics.rowH + (rows - 1) * t.metrics.gap;
      const listR = { x: c.x, y: c.y + Math.max(0, (c.h - listH) / 2 - 6), w: lw, h: Math.min(c.h, listH) };
      mainMenu.draw(ui, listR);
      const it = mainMenu.selected!;
      const info = MENU_INFO[it.id];
      const cx = c.x + lw + (t.pixel ? 20 : 16);
      const cw = c.x + c.w - cx;
      const content = {
        title: it.label,
        eyebrow: info.eyebrow,
        body: info.body,
        footer: info.footer,
        icon: icon(info.icon),
      };
      const ch = cardHeight(ui, cw, content, { maxH: c.h - 30 });
      const cy = c.y + Math.max(30, (c.h - ch) / 2 + 6);
      memo.draw(ui.ctx, "menuCard", `${it.id}`, cx - 6, cy - 6, cw + 12, ch + 12, (g) =>
        drawCard({ ...ui, ctx: g, debug: null }, cx, cy, cw, content, { tint: "#c81818", seed: 3, maxH: c.h - 30 }),
      );
      ui.debug?.box("menuCard", { x: cx, y: cy, w: cw, h: ch }, { bounds: c, ctx: ui.ctx, group: "content" });
      callouts.draw(ui, { x: cx, y: c.y - 6, w: cw, h: 40 }, ui.time);
    },
  };
}

function optionRows(): OptionRow[] {
  const fmt = (v: number) => `${v * 10}%`;
  const bind = (id: string, name: string): OptionRow => ({
    kind: "keybind",
    id,
    label: name,
    blurb: "Press A, then the button to use. Hold B to cancel.",
    get: () => P()[binds[id] as "a"],
    listening: () => listening === id,
    rebind: () => (listening = id),
  });
  return [
    {
      kind: "slider",
      id: "music",
      label: "MUSIC",
      blurb: "Music volume.",
      min: 0,
      max: 10,
      step: 1,
      get: () => settings.music,
      set: (v) => (settings.music = v),
      format: fmt,
    },
    {
      kind: "slider",
      id: "sound",
      label: "SOUND EFFECTS",
      blurb: "Effects, voices and ambience.",
      min: 0,
      max: 10,
      step: 1,
      get: () => settings.sound,
      set: (v) => (settings.sound = v),
      format: fmt,
    },
    {
      kind: "toggle",
      id: "shake",
      label: "SCREEN SHAKE",
      blurb: "Shake the view on big hits and falls.",
      get: () => settings.shake,
      set: (v) => (settings.shake = v),
    },
    {
      kind: "choice",
      id: "speed",
      label: "TEXT SPEED",
      blurb: "How fast dialog text types out.",
      options: ["SLOW", "NORMAL", "FAST", "INSTANT"],
      get: () => settings.speed,
      set: (i) => (settings.speed = i),
    },
    {
      kind: "choice",
      id: "scale",
      label: "PIXEL SCALE",
      blurb: "Largest whole-number scale, or a fixed one.",
      options: ["AUTO", "2X", "3X", "4X"],
      get: () => settings.scale,
      set: (i) => (settings.scale = i),
    },
    bind("jump", "JUMP"),
    bind("attack", "ATTACK"),
    {
      kind: "action",
      id: "defaults",
      label: "RESTORE DEFAULTS",
      blurb: "Put everything back as it was.",
      run: () => Object.assign(settings, { music: 7, sound: 9, shake: true, speed: 1, scale: 0 }),
    },
    {
      kind: "action",
      id: "erase",
      label: "ERASE ALL RECORDS",
      danger: true,
      blurb: "Forget every win, loss and match. Names are kept.",
      run: () => stack.push(dialogScene()),
    },
  ];
}
const optionsPage = new OptionsPage(optionRows());

function drawOptions(): void {
  const t = ui.theme;
  const a = areaOf();
  const c = chrome(a, "OPTIONS", prompts(["a", "CHANGE"], ["b", "BACK"], ["lr", "SCENE"]));
  const lw = Math.round(c.w * 0.6);
  const win = { x: c.x, y: c.y, w: lw, h: c.h };
  panel(ui, "window", win, { seed: 2 });
  ui.debug?.box("optionsWindow", win, { group: "content", ctx: ui.ctx });
  optionsPage.draw(ui, inset(win, t.pixel ? 8 : 7, t.pixel ? 10 : 8, t.pixel ? 8 : 7, t.pixel ? 8 : 6));
  const f = optionsPage.focused!;
  const dx = win.x + win.w + 12;
  drawCard(
    ui,
    dx,
    c.y + 6,
    c.x + c.w - dx,
    { eyebrow: "SETTING", title: f.label, body: f.blurb ?? "" },
    { tint: "#c81818", seed: 5 },
  );
}

function optionsScene(): Screen<Nav> {
  return {
    name: "options",
    update: (_dt, nav) => {
      if (listening) {
        if (nav.a || nav.b || nav.x || nav.y) {
          if (!nav.b) binds[listening] = nav.a ? "a" : nav.x ? "x" : "y";
          listening = "";
        }
        return;
      }
      optionsPage.update(nav);
    },
    draw: drawOptions,
  };
}

function dialogScene(): Screen<Nav> {
  const d = new Dialog(
    "ERASE ALL RECORDS?",
    "Every win, loss and match in the hall will be burned. Signed names are kept. This cannot be undone.",
    ["ERASE", "KEEP"],
    { initial: 1, danger: true },
  );
  return {
    name: "dialog",
    opaque: false,
    update: (_dt, nav) => {
      if (d.update(nav)) stack.pop();
    },
    draw: () => {
      const a = areaOf();
      ui.ctx.save();
      ui.ctx.translate(a.x, a.y);
      d.draw(ui, a.w, a.h);
      ui.ctx.restore();
    },
  };
}

const BOONS = [
  { title: "WHETSTONE", icon: "sword", eyebrow: "COMMON", body: "Attacks deal +15% damage.", footer: "120 GOLD" },
  {
    title: "TOWER SHIELD",
    icon: "shield",
    eyebrow: "RARE",
    body: "Block the first hit of every fight. Blocking a projectile reflects it back at its owner.",
    footer: "240 GOLD",
  },
  {
    title: "PHILOSOPHER'S DRAUGHT OF ENDLESS RESTORATION",
    icon: "flask",
    eyebrow: "LEGENDARY",
    body: "Heal fully once per battle.",
    footer: "400 GOLD",
  },
  { title: "JADE EYE", icon: "gem", eyebrow: "CURSED", body: "See hidden doors. Lose 1 heart.", footer: "FREE" },
];
let boon = 1;

function cardsScene(): Screen<Nav> {
  return {
    name: "cards",
    update: (_dt, nav) => {
      if (nav.dx) boon = (boon + nav.dx + BOONS.length) % BOONS.length;
    },
    draw: () => {
      const t = ui.theme;
      const a = areaOf();
      const c = chrome(a, "CHOOSE A BOON", prompts(["a", "TAKE"], ["y", "REROLL"], ["b", "SKIP"]));
      const gap = t.pixel ? 10 : 9;
      const n = BOONS.length;
      const cw = (c.w - gap * (n - 1)) / n;
      const contents = BOONS.map((b) => ({ ...b, icon: icon(b.icon) }));
      // Equal heights: measure all, use the tallest (capped to the space).
      const maxH = c.h - 44;
      const h = Math.min(maxH, Math.max(...contents.map((x) => cardHeight(ui, cw, x, { maxH }))));
      const rects = row(
        { x: c.x, y: c.y + 16, w: c.w, h },
        BOONS.map(() => cw),
        { gap },
      );
      rects.forEach((r, i) => {
        const sel = i === boon;
        const y = r.y - (sel ? 4 : 0);
        drawCard(ui, r.x, y, r.w, contents[i], {
          minH: h,
          maxH: h,
          seed: i,
          tint: sel ? "#c81818" : "#8a8a90",
          selected: sel,
        });
        if (sel) t.cursor(ui.ctx, r.x + r.w / 2, y - 3, "down", t.pixel ? 6 : 6, ui.time);
      });
      // A memoised status plate: repaints only when its key (gold, second) changes.
      const sec = Math.floor(ui.time);
      const sr = { x: c.x + c.w - 120, y: c.y + c.h - 20, w: 120, h: 18 };
      memo.draw(ui.ctx, "status", `${sec}`, sr.x, sr.y, sr.w, sr.h, (g) => {
        const u = { ...ui, ctx: g, debug: null };
        panel(u, "button", sr, {});
        label(u, `GOLD 1,250 - ${sec % 60}S`, inset(sr, 0, 6), { align: "center", size: t.metrics.small });
      });
      label(
        ui,
        `MEMO REPAINTS ${memo.repaints}`,
        { x: c.x, y: sr.y, w: 160, h: sr.h },
        { size: t.metrics.small, color: t.colors.dim },
      );
    },
  };
}

const nameEntry = new NameEntry("WREN", 8);

function nameScene(): Screen<Nav> {
  return {
    name: "name",
    update: (_dt, nav) => {
      nameEntry.update(nav);
    },
    draw: () => {
      const t = ui.theme;
      const a = areaOf();
      const c = chrome(a, "SIGN YOUR NAME", prompts(["a", "TYPE"], ["b", "DELETE"], ["y", "DONE"]));
      const w = Math.min(t.pixel ? 260 : 240, c.w);
      const h = Math.min(c.h, nameEntry.height(ui, w));
      nameEntry.draw(ui, { x: c.x + (c.w - w) / 2, y: c.y + (c.h - h) / 2, w, h }, "PLAYER 2 SIGNS");
    },
  };
}

function viewArt(g: CanvasRenderingContext2D, r: Rect, i: number): void {
  const hues = ["#4a78c8", "#c84a4a", "#c8a83a", "#4aa860"];
  const sky = g.createLinearGradient(0, r.y, 0, r.y + r.h);
  sky.addColorStop(0, "#1a2a4a");
  sky.addColorStop(0.55, "#4a6a8a");
  sky.addColorStop(0.56, "#3a5a2a");
  sky.addColorStop(1, "#1a2a10");
  g.fillStyle = sky;
  g.fillRect(r.x, r.y, r.w, r.h);
  g.fillStyle = "rgba(255,255,255,0.06)";
  for (let k = 0; k < 6; k++)
    g.fillRect(r.x + ((k * 53 + i * 31) % r.w), r.y + r.h * 0.56 + ((k * 17) % (r.h * 0.4)), r.w * 0.12, 1.5);
  g.fillStyle = hues[i];
  g.beginPath();
  g.arc(r.x + r.w * (0.35 + 0.1 * i), r.y + r.h * 0.68, Math.min(r.w, r.h) * 0.06, 0, Math.PI * 2);
  g.fill();
}

function splitScene(): Screen<Nav> {
  return {
    name: "split",
    enter: () => {
      callouts.clear();
      callouts.push("FIGHT!", { lane: "big", hold: 1e9, color: "#f0c450" });
    },
    update: () => {},
    draw: () => {
      const t = ui.theme;
      const W = canvas.w;
      const H = canvas.h;
      const lay = t.pixel ? layoutViews(views, W, H, { viewW: 224, viewH: 126 }) : splitViews(views, W, H, { gap: 3 });
      lay.rects.forEach((r, i) => {
        viewArt(ui.ctx, r, i);
        // Per-view HUD plate, memoised per player.
        const pr = { x: r.x + 6, y: r.y + 6, w: Math.min(110, r.w - 12), h: t.metrics.rowH + 4 };
        memo.draw(ui.ctx, `hud${i}`, `${i}|${views}`, pr.x, pr.y, pr.w, pr.h, (g) => {
          const u = { ...ui, ctx: g, debug: null };
          panel(u, "row", pr, { selected: true, seed: i });
          label(u, `PLAYER ${i + 1}`, inset(pr, 0, 6), { onPanel: true, size: t.metrics.small });
        });
      });
      if (lay.spare) {
        panel(ui, "backdrop", lay.spare);
        const sr = inset(lay.spare, 10, 10, 26, 10);
        panel(ui, "window", sr, { seed: 4 });
        paragraph(ui, "SPARE VIEW: THE MAP, STANDINGS OR A REPLAY GOES HERE.", inset(sr, 10), {
          onPanel: true,
          align: "center",
          valign: "middle",
          size: t.metrics.small,
        });
      }
      drawSeams(ui.ctx, seams([...lay.rects, ...(lay.spare ? [lay.spare] : [])], t.pixel ? 0 : 3), {
        width: t.pixel ? 4 : 3,
        color: t.pixel ? "#0e1414" : "#140c06",
        bevel: t.pixel ? "#3c4a46" : "#5a3a1a",
      });
      callouts.draw(ui, { x: 0, y: 0, w: W, h: H }, ui.time);
      const fr = { x: 6, y: H - 18, w: W - 12, h: 16 };
      drawPromptBar(ui, prompts(["start", "PAUSE"], ["lr", "SCENE"]), fr, { align: "right" });
    },
  };
}

function debugScene(): Screen<Nav> {
  return {
    name: "debug",
    draw: () => {
      const t = ui.theme;
      const a = areaOf();
      const c = chrome(a, "LAYOUT DEBUGGER", prompts(["lr", "SCENE"]));
      const half = (c.w - 16) / 2;
      // Left: the bugs we shipped. Text drawn raw past its card, two cards overlapping, a panel off screen.
      const bad = { x: c.x, y: c.y + 4, w: half, h: 60 };
      panel(ui, "card", bad, { seed: 1 });
      const s = "THIS LINE WAS NEVER MEASURED AND RUNS STRAIGHT OFF THE CARD";
      t.font.draw(ui.ctx, s, bad.x + 6, bad.y + 8, t.metrics.text, t.panelTextStyle);
      debug.content(
        "raw text",
        bad.x + 6,
        bad.y + 8,
        t.font.measure(s, t.metrics.text),
        t.font.lineHeight(t.metrics.text),
        bad,
        ui.ctx,
      );
      const o1 = { x: c.x, y: bad.y + 72, w: half * 0.6, h: 44 };
      const o2 = { x: c.x + half * 0.45, y: bad.y + 84, w: half * 0.6, h: 44 };
      for (const [i, r] of [o1, o2].entries()) {
        panel(ui, "card", r, { seed: i + 4 });
        debug.box(`card ${i + 1}`, r, { group: "bad", ctx: ui.ctx });
      }
      // Right: the same content through the fitting helpers: no issues.
      const good = { x: c.x + half + 16, y: c.y + 4, w: half, h: 60 };
      panel(ui, "card", good, { seed: 2 });
      paragraph(ui, s, inset(good, 6), { onPanel: true, size: t.metrics.text, id: "fitted" });
      const cards = row({ x: good.x, y: good.y + 72, w: half, h: 44 }, [half * 0.48, half * 0.48], {
        gap: half * 0.04,
      });
      cards.forEach((r, i) => {
        panel(ui, "card", r, { seed: i + 7 });
        debug.box(`good ${i}`, r, { group: "good", ctx: ui.ctx });
        label(ui, i ? "NO OVERLAP" : "FITTED", inset(r, 6), { onPanel: true, align: "center" });
      });
    },
  };
}

const SCENE_FACTORY: Record<SceneName, () => Screen<Nav>> = {
  menu: menuScene,
  options: optionsScene,
  cards: cardsScene,
  name: nameScene,
  dialog: () => optionsScene(),
  split: splitScene,
  debug: debugScene,
};

const stack = new ScreenManager<Nav>({ kind: "fade", duration: 0.2 });
let scene = (SCENES as readonly string[]).includes(q.get("scene") ?? "") ? (q.get("scene") as SceneName) : "menu";
function open(s: SceneName, tr = stack.transition): void {
  scene = s;
  if (s === "debug") debug.enabled = true;
  stack.reset(SCENE_FACTORY[s](), tr);
  if (s === "dialog") stack.push(dialogScene(), { kind: "none", duration: 0 });
}
open(scene, { kind: "none", duration: 0 });

// ── Input ──

const held = new Set<string>();
const pressed = new Set<string>();
addEventListener("keydown", (e) => {
  if (!held.has(e.code)) pressed.add(e.code);
  held.add(e.code);
  if (["ArrowUp", "ArrowDown", "Space", "Tab"].includes(e.code)) e.preventDefault();
});
addEventListener("keyup", (e) => held.delete(e.code));
const repeater = new NavRepeater();

function readNav(dt: number): Nav {
  const h = (...c: string[]) => c.some((k) => held.has(k));
  const st: HeldNav = {
    x: (h("ArrowRight", "KeyD") ? 1 : 0) - (h("ArrowLeft", "KeyA") ? 1 : 0),
    y: (h("ArrowDown", "KeyS") ? 1 : 0) - (h("ArrowUp", "KeyW") ? 1 : 0),
    a: h("Enter", "Space"),
    b: h("Escape", "Backspace"),
    bx: h("KeyX"),
    by: h("KeyY"),
  };
  return repeater.update(st, dt);
}

function hotkeys(): void {
  const p = (k: string) => pressed.has(k);
  const i = SCENES.indexOf(scene);
  if (p("KeyE")) open(SCENES[(i + 1) % SCENES.length]);
  if (p("KeyQ")) open(SCENES[(i + SCENES.length - 1) % SCENES.length]);
  if (p("KeyG")) debug.enabled = !debug.enabled;
  if (p("KeyP")) {
    const ks = Object.keys(PADS);
    pad = ks[(ks.indexOf(pad) + 1) % ks.length];
  }
  for (const n of [1, 2, 3, 4]) if (p(`Digit${n}`)) views = n;
  if (p("KeyT")) {
    themeName = themeName === "wood" ? "pixel" : "wood";
    canvas.mode = modeFor(themeName);
    canvas.canvas.style.imageRendering = themeName === "pixel" ? "pixelated" : "auto";
  }
  pressed.clear();
}

// ── Loop ──

let last = performance.now();
const t0 = performance.now();
function frame(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  hotkeys();
  const nav = readNav(dt);
  const ctx = canvas.begin();
  ui = { ctx, theme: THEMES[themeName], time: (now - t0) / 1000, debug: debug.enabled ? debug : null, hits };
  hits.clear();
  debug.begin(ctx, { x: 0, y: 0, w: canvas.w, h: canvas.h });
  callouts.update(ui.time);
  stack.update(dt, nav);
  stack.draw(ctx, canvas.w, canvas.h);
  const issues = debug.end();
  if (debug.enabled) debug.draw(ctx);
  memo.tick();
  (window as unknown as { uiIssues: unknown }).uiIssues = issues.map((i) => `${i.kind}:${i.id}`);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
(window as unknown as { demoReady: boolean }).demoReady = true;
