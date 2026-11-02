// Prompts as data: one JSON file per asset family holding the shared style preamble, the background/isolation
// rules, generation settings (model tier, aspect, resolution, seed) and the items, optionally grouped into sheets.
// A sheet prompt asks for N icons in a strict COLS x ROWS grid on a flat chroma background in reading order; the
// slicer later cuts them back out by that order. Keeping this in files makes runs reproducible and reviewable.
import { readFileSync } from "node:fs";

export interface PromptItem {
  id: string;
  prompt: string;
}

export interface PromptFile {
  /** Shared style preamble ("1998 N64 fantasy item icons, chunky silhouettes..."). */
  style: string;
  /** Per-item rendering rules appended to every item ("chunky bold silhouette, thick dark outline"). */
  itemStyle?: string;
  /** Closing rules ("No text... Plain flat pure magenta background (#FF00FF) everywhere."). */
  suffix?: string;
  /** Background the slicer keys out ("#FF00FF"). */
  background?: string;
  tier?: "pro" | "flash";
  aspect?: string;
  resolution?: "1K" | "2K" | "4K";
  seed?: number;
  /** Grid columns for sheets (default 4). */
  cols?: number;
  /** Reference image(s) for style (paths relative to the prompt file). */
  references?: string[];
  /** Items not in a sheet (one image each). */
  items?: PromptItem[];
  /** Named sheets of items. Tuples [id, prompt] are accepted for brevity. */
  sheets?: Record<string, (PromptItem | [string, string])[]>;
}

export function loadPromptFile(path: string): PromptFile {
  const f = JSON.parse(readFileSync(path, "utf8")) as PromptFile;
  const errs = validatePromptFile(f);
  if (errs.length) throw new Error(`${path}: ${errs.join("; ")}`);
  return f;
}

export function validatePromptFile(f: PromptFile): string[] {
  const errs: string[] = [];
  if (!f || typeof f.style !== "string" || !f.style.trim()) errs.push("missing style");
  const ids = new Map<string, string>();
  const check = (where: string, items: unknown[]) =>
    items.forEach((it, i) => {
      const { id, prompt } = normItem(it as PromptItem);
      if (!id || !prompt) errs.push(`${where}[${i}] needs id and prompt`);
      else if (ids.has(id)) errs.push(`duplicate id ${id} (${ids.get(id)} and ${where})`);
      else ids.set(id, where);
    });
  if (f.items) check("items", f.items);
  for (const [name, items] of Object.entries(f.sheets ?? {})) {
    if (!Array.isArray(items) || !items.length) errs.push(`sheet ${name} is empty`);
    else check(`sheets.${name}`, items);
  }
  if (!f.items?.length && !Object.keys(f.sheets ?? {}).length) errs.push("no items or sheets");
  return errs;
}

function normItem(it: PromptItem | [string, string]): PromptItem {
  return Array.isArray(it) ? { id: it[0], prompt: it[1] } : it;
}

export function sheetItems(f: PromptFile, sheet: string): PromptItem[] {
  const s = f.sheets?.[sheet];
  if (!s) throw new Error(`no sheet ${sheet}`);
  return s.map(normItem);
}

export interface SheetLayout {
  cols: number;
  rows: number;
  ids: string[];
}

export function sheetLayout(f: PromptFile, sheet: string): SheetLayout {
  const items = sheetItems(f, sheet);
  const cols = Math.min(f.cols ?? 4, items.length);
  return { cols, rows: Math.ceil(items.length / cols), ids: items.map((i) => i.id) };
}

/** An aspect ratio close to the grid's (fal accepts a fixed list). */
export function sheetAspect(cols: number, rows: number): string {
  const want = cols / rows;
  const options: [string, number][] = [
    ["21:9", 21 / 9],
    ["2:1", 2],
    ["16:9", 16 / 9],
    ["3:2", 1.5],
    ["4:3", 4 / 3],
    ["1:1", 1],
    ["3:4", 0.75],
    ["2:3", 2 / 3],
    ["9:16", 9 / 16],
  ];
  return options.reduce((a, b) => (Math.abs(Math.log(b[1] / want)) < Math.abs(Math.log(a[1] / want)) ? b : a))[0];
}

/** The full prompt for one sheet: style, strict grid layout, numbered items in reading order, rules. */
export function sheetPrompt(f: PromptFile, sheet: string): string {
  const items = sheetItems(f, sheet);
  const { cols, rows } = sheetLayout(f, sheet);
  return [
    `${f.style.trim()} A sprite sheet of ${items.length} separate images.`,
    `Laid out in a strict grid of ${cols} columns and ${rows} rows with wide empty gaps, each image centred in its own cell and never touching another. Reading order left to right, top to bottom:`,
    items.map((it, i) => `${i + 1}. ${it.prompt}`).join("\n"),
    [f.itemStyle, f.suffix].filter(Boolean).join(" "),
  ]
    .filter(Boolean)
    .join("\n");
}

/** The prompt for a single item. */
export function itemPrompt(f: PromptFile, id: string): string {
  const it = (f.items ?? []).map(normItem).find((i) => i.id === id);
  if (!it) throw new Error(`no item ${id}`);
  return [f.style.trim(), it.prompt, f.itemStyle, f.suffix].filter(Boolean).join(" ");
}
