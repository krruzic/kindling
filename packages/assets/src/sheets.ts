// Node side of sheet generation and slicing. generateSheet() renders one prompt-file sheet with Nano Banana and
// keeps the raw PNG plus its layout JSON ({cols, rows, ids}) and meta; sliceSheet() / contactSheet() run
// python/sheets.py (numpy + Pillow, like the originals) and return its JSON summary.
import { spawnSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { FalClient } from "./fal.ts";
import { nanoBanana, saveOutputs } from "./models.ts";
import { sheetAspect, sheetLayout, sheetPrompt, type PromptFile } from "./prompts.ts";

export const PYTHON_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "python");
const SHEETS_PY = join(PYTHON_DIR, "sheets.py");

function py(args: string[], python = process.env.PYTHON ?? "python3"): unknown {
  const r = spawnSync(python, [SHEETS_PY, ...args], { encoding: "utf8", maxBuffer: 64 << 20 });
  if (r.status !== 0) throw new Error(`sheets.py ${args[0]} failed (${r.status}): ${r.stderr || r.stdout}`);
  return JSON.parse(r.stdout.trim().split("\n").pop()!);
}

export interface SliceOptions {
  sheet: string;
  out: string;
  /** Layout: a meta JSON path, or ids/cols/rows directly. */
  meta?: string;
  ids?: string[];
  cols?: number;
  rows?: number;
  /** Icon size in px (default 96). */
  size?: number;
  /** "auto" (border median) or "#rrggbb". */
  bg?: string;
  mode?: "auto" | "gaps" | "grid";
  pad?: number;
  /** Bits per channel to keep (0 = no quantising; Grudge icons: 5). */
  quantize?: number;
  alpha?: "soft" | "hard";
  /** Also write <id>_tile.png on a frame: "#rrggbb" stone colour or a tile image path. */
  tile?: string;
  /** Keep the square raw cell crops (<id>_raw.png). */
  raw?: boolean;
}

export interface SliceResult {
  sheet: string;
  how: "gaps" | "grid";
  bg: [number, number, number];
  cells: { id: string; box: [number, number, number, number]; empty: boolean }[];
}

export function sliceSheet(o: SliceOptions): SliceResult {
  const a = ["slice", "--sheet", o.sheet, "--out", o.out];
  if (o.meta) a.push("--meta", o.meta);
  if (o.ids) a.push("--ids", o.ids.join(","));
  if (o.cols) a.push("--cols", String(o.cols));
  if (o.rows) a.push("--rows", String(o.rows));
  if (o.size) a.push("--size", String(o.size));
  if (o.bg) a.push("--bg", o.bg);
  if (o.mode) a.push("--mode", o.mode);
  if (o.pad !== undefined) a.push("--pad", String(o.pad));
  if (o.quantize) a.push("--quantize", String(o.quantize));
  if (o.alpha) a.push("--alpha", o.alpha);
  if (o.tile) a.push("--tile", o.tile);
  if (o.raw) a.push("--raw");
  return py(a) as SliceResult;
}

export interface ContactOptions {
  files: string[];
  out: string;
  per?: number;
  cell?: number;
  /** Tile behind each image ("#rrggbb", an image path, or "none"). */
  tile?: string;
  title?: string;
}

export function contactSheet(o: ContactOptions): { out: string; count: number; size: [number, number] } {
  const a = ["contact", "--out", o.out];
  if (o.per) a.push("--per", String(o.per));
  if (o.cell) a.push("--cell", String(o.cell));
  if (o.tile) a.push("--tile", o.tile);
  if (o.title) a.push("--title", o.title);
  return py([...a, ...o.files]) as ReturnType<typeof contactSheet>;
}

/**
 * Generates one sheet of a prompt file into `dir`: sheet_<name>.png (raw, never edited), sheet_<name>.json (layout
 * for the slicer) and sheet_<name>.meta.json (model, input, request id, cost). Skips when the PNG exists unless
 * `force`. `baseDir` resolves the prompt file's reference images.
 */
export async function generateSheet(
  fal: FalClient,
  f: PromptFile,
  name: string,
  dir: string,
  o: { force?: boolean; baseDir?: string } = {},
): Promise<{ png: string; layout: string; skipped: boolean }> {
  const png = join(dir, `sheet_${name}.png`);
  const layout = join(dir, `sheet_${name}.json`);
  if (existsSync(png) && !o.force) return { png, layout, skipped: true };
  const lay = sheetLayout(f, name);
  const r = await nanoBanana(fal, {
    prompt: sheetPrompt(f, name),
    images: f.references?.map((p) => resolve(o.baseDir ?? ".", p)),
    aspect: f.aspect ?? sheetAspect(lay.cols, lay.rows),
    resolution: f.resolution ?? "2K",
    seed: f.seed,
    tier: f.tier,
    label: `sheet_${name}`,
  });
  if (!r.urls.length) throw new Error(`sheet ${name}: no image returned`);
  await saveOutputs(fal, dir, `sheet_${name}`, "png", r.urls.slice(0, 1), r.result, r.input, { layout: lay });
  writeFileSync(layout, JSON.stringify(lay));
  return { png, layout, skipped: false };
}
