import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test, eq, ok } from "./harness.ts";
import {
  sheetPrompt,
  sheetLayout,
  sheetAspect,
  validatePromptFile,
  itemPrompt,
  loadPromptFile,
  type PromptFile,
} from "../src/prompts.ts";
import { sliceSheet, contactSheet } from "../src/sheets.ts";
import { validateCredits, formatAttribution, globToRegExp, type CreditsFile } from "../src/credits.ts";

const here = dirname(fileURLToPath(import.meta.url));
const tmp = () => mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "kassets-"));

/** Reads a PNG's pixels through Pillow (no image dependency in node). */
function pixels(file: string): { w: number; h: number; mode: string; px: number[][] } {
  const out = execFileSync(
    "python3",
    [
      "-c",
      "import json,sys\nfrom PIL import Image\nim=Image.open(sys.argv[1])\nprint(json.dumps({'w':im.width,'h':im.height,'mode':im.mode,'px':[list(p) for p in getattr(im.convert('RGBA'),'get_flattened_data',None) and im.convert('RGBA').get_flattened_data() or im.convert('RGBA').getdata()]}))",
      file,
    ],
    { encoding: "utf8", maxBuffer: 64 << 20 },
  );
  return JSON.parse(out);
}

const prompts: PromptFile = {
  style: "Item icons from a 1998 N64 fantasy game.",
  itemStyle: "Chunky silhouette, thick dark outline.",
  suffix: "No text. Plain flat pure magenta background (#FF00FF) everywhere.",
  background: "#FF00FF",
  cols: 4,
  seed: 7,
  sheets: {
    shapes: [
      ["green_orb", "a green orb"],
      ["gold_tri", "a gold triangle"],
      ["blue_box", "a blue box"],
      ["white_orb", "a white orb"],
      ["red_tri", "a red triangle"],
      ["black_box", "a black box"],
      ["teal_orb", "a teal orb"],
      ["orange_tri", "an orange triangle"],
    ],
  },
  items: [{ id: "hero", prompt: "a knight" }],
};

test("prompt files: validation, grid prompt, layout, aspect", () => {
  eq(validatePromptFile(prompts).length, 0);
  const bad = validatePromptFile({ style: "", sheets: { a: [["x", "1"]], b: [["x", "2"]] } });
  ok(bad.some((e) => e.includes("missing style")) && bad.some((e) => e.includes("duplicate id x")), bad.join());
  const p = sheetPrompt(prompts, "shapes");
  ok(p.startsWith("Item icons from a 1998"));
  ok(p.includes("4 columns and 2 rows"));
  ok(p.includes("1. a green orb\n2. a gold triangle"));
  ok(p.endsWith("everywhere."));
  eq(
    JSON.stringify(sheetLayout(prompts, "shapes")),
    JSON.stringify({ cols: 4, rows: 2, ids: prompts.sheets!.shapes.map((i) => (i as string[])[0]) }),
  );
  eq(sheetAspect(4, 2), "2:1");
  eq(sheetAspect(4, 3), "4:3");
  ok(itemPrompt(prompts, "hero").includes("a knight Chunky"));
  const tpl = loadPromptFile(join(here, "..", "templates", "icons.prompts.json"));
  eq(sheetLayout(tpl, "fire").ids.length, 4, "the template prompt file validates");
});

test("slicing: a synthetic magenta sheet cuts into clean keyed icons", () => {
  const dir = tmp();
  const sheet = join(dir, "sheet_shapes.png");
  execFileSync("python3", [join(here, "fixtures", "synth_sheet.py"), sheet]);
  const lay = sheetLayout(prompts, "shapes");
  writeFileSync(join(dir, "sheet_shapes.json"), JSON.stringify(lay));
  const out = join(dir, "icons");
  const r = sliceSheet({ sheet, meta: join(dir, "sheet_shapes.json"), out, size: 64, tile: "#968a6e", raw: true });
  eq(r.how, "gaps", "cells found from the background gaps");
  eq(r.cells.length, 8);
  eq(r.bg.join(), "255,0,255", "background detected from the border");
  // Boxes land in their grid cells, in reading order.
  r.cells.forEach((c, k) => {
    const cx = (c.box[0] + c.box[2]) / 2;
    const cy = (c.box[1] + c.box[3]) / 2;
    eq(Math.floor(cx / 200) + 4 * Math.floor(cy / 200), k, `cell ${c.id} in order`);
  });
  const expect: Record<string, number[]> = {
    green_orb: [40, 200, 60],
    blue_box: [40, 90, 230],
    red_tri: [200, 40, 40],
  };
  for (const [id, col] of Object.entries(expect)) {
    const im = pixels(join(out, `${id}.png`));
    eq(im.w, 64);
    eq(im.mode, "RGBA");
    eq(im.px[0][3], 0, `${id}: transparent corner`);
    const mid = im.px[32 * 64 + 32];
    eq(mid[3], 255, `${id}: opaque centre`);
    for (let c = 0; c < 3; c++) ok(Math.abs(mid[c] - col[c]) < 20, `${id}: centre colour ${mid} ~ ${col}`);
    // Despill: no magenta cast left on semi-transparent fringe pixels.
    const fringe = im.px.filter((p) => p[3] > 20 && p[3] < 235);
    ok(fringe.length > 0, `${id}: has a soft edge`);
    const pink = fringe.filter((p) => Math.min(p[0], p[2]) - p[1] > 60).length;
    ok(pink / fringe.length < 0.1, `${id}: ${pink}/${fringe.length} fringe pixels still magenta`);
    // Trimmed: content reaches near the edges of the icon.
    const opaqueCols = new Set(im.px.map((p, i) => (p[3] > 128 ? i % 64 : -1)).filter((x) => x >= 0));
    ok(Math.min(...opaqueCols) <= 6 && Math.max(...opaqueCols) >= 57, `${id}: trimmed and padded square`);
  }
  ok(existsSync(join(out, "green_orb_tile.png")) && existsSync(join(out, "green_orb_raw.png")));
  const g = sliceSheet({
    sheet,
    ids: lay.ids,
    cols: 4,
    rows: 2,
    out: join(dir, "grid"),
    mode: "grid",
    size: 32,
    quantize: 5,
    alpha: "hard",
  });
  eq(g.how, "grid");
  const hard = pixels(join(dir, "grid", "gold_tri.png"));
  ok(
    hard.px.every((p) => p[3] === 0 || p[3] === 255),
    "hard alpha",
  );
  ok(
    hard.px.every((p) => p[0] % 8 === 0),
    "quantised to 5 bits",
  );
  const cs = contactSheet({ files: lay.ids.map((i) => join(out, `${i}.png`)), out: join(dir, "contact.png"), per: 4 });
  eq(cs.count, 8);
  ok(cs.size[0] > 400 && existsSync(cs.out));
});

test("credits: validation and attribution", () => {
  const dir = tmp();
  mkdirSync(join(dir, "assets", "sfx"), { recursive: true });
  mkdirSync(join(dir, "assets", "generated"), { recursive: true });
  for (const f of ["sfx/hit.0.ogg", "sfx/hit.1.ogg", "sfx/door.ogg", "font.ttf", "tiles.png", "generated/sheet.png"])
    writeFileSync(join(dir, "assets", f), "x");
  const c: CreditsFile = {
    roots: ["assets"],
    ignore: ["assets/generated/**"],
    entries: [
      {
        path: "assets/sfx/hit.*.ogg",
        title: "Hits",
        author: "Kenney",
        source: "https://kenney.nl",
        licence: "CC0-1.0",
      },
      {
        path: "assets/sfx/door.ogg",
        title: "Old door",
        author: "someone",
        source: "https://freesound.org/x",
        licence: "CC-BY-SA-4.0",
        modified: "trimmed",
      },
      { path: "assets/font.ttf", title: "Font", licence: "OFL-1.1" },
      { path: "assets/missing.png", title: "Gone", licence: "WTFPL" },
    ],
  };
  const issues = validateCredits(c, dir);
  const has = (path: string, s: string) => issues.some((i) => i.path === path && i.message.includes(s));
  ok(has("assets/font.ttf", "requires an author"), JSON.stringify(issues));
  ok(has("assets/missing.png", "unknown licence"));
  ok(has("assets/missing.png", "matches no file"));
  ok(has("assets/tiles.png", "no credits entry"), "uncovered file");
  ok(!issues.some((i) => i.path.includes("generated")), "ignored glob");
  ok(!issues.some((i) => i.path.includes("hit")), "glob entry covers both variants");
  c.entries.push({ path: "assets/tiles.png", title: "Tiles", licence: "paid" });
  ok(validateCredits(c, dir, { publicBuild: true }).some((i) => i.message.includes("must not ship")));
  const text = formatAttribution(c);
  ok(
    text.includes("## CC BY-SA 4.0") &&
      text.includes('"Old door" by someone (https://freesound.org/x) (modified: trimmed)'),
  );
  ok(!text.includes("Hits"), "CC0 needs no credit line");
  ok(globToRegExp("a/**/b.png").test("a/b.png") && globToRegExp("a/**/b.png").test("a/x/y/b.png"));
  ok(!globToRegExp("a/*.png").test("a/x/b.png"));
});
