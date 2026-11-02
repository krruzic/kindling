#!/usr/bin/env -S node --experimental-transform-types --no-warnings
// Sheet pipeline CLI over a prompt file (JSON: style + sheets of items):
//   kindling-sheet gen <prompts.json> <rawDir> [sheet ...] [--force]   generate raw sheets (spends fal credit;
//                                                                       every call logged to <rawDir>/calls.log)
//   kindling-sheet cut <prompts.json> <rawDir> <outDir> [--size 96] [--quantize 5] [--alpha hard] [--tile #968a6e]
//                                                                       slice every raw sheet, in file order (a
//                                                                       later sheet's id replaces an earlier one),
//                                                                       then write <outDir>/_contact.png
//   kindling-sheet prompt <prompts.json> <sheet>                         print the sheet prompt (no call)
//   kindling-sheet cost <rawDir>                                         spend so far from calls.log
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { FalClient, loadEnv, readCallLog } from "../fal.ts";
import { loadPromptFile, sheetPrompt } from "../prompts.ts";
import { contactSheet, generateSheet, sliceSheet } from "../sheets.ts";

const args = process.argv.slice(2);
const opt = (k: string) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const pos = args.filter((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));
const [cmd, a1, a2, ...more] = pos;

if (cmd === "prompt") {
  console.log(sheetPrompt(loadPromptFile(a1), a2));
} else if (cmd === "cost") {
  const r = readCallLog(join(a1, "calls.log"));
  console.log(`${r.entries.length} calls, ~$${r.total.toFixed(2)}`, r.byModel);
} else if (cmd === "gen") {
  const file = resolve(a1);
  loadEnv(dirname(file));
  const f = loadPromptFile(file);
  const fal = new FalClient({ logFile: join(a2, "calls.log"), log: console.log });
  const names = more.length ? more : Object.keys(f.sheets ?? {});
  const r = await Promise.all(
    names.map((n) => generateSheet(fal, f, n, a2, { force: args.includes("--force"), baseDir: dirname(file) })),
  );
  for (const x of r) console.log(x.skipped ? "kept" : "made", x.png);
} else if (cmd === "cut") {
  const f = loadPromptFile(a1);
  const out = more[0];
  const icons: string[] = [];
  for (const name of Object.keys(f.sheets ?? {})) {
    const sheet = join(a2, `sheet_${name}.png`);
    if (!existsSync(sheet)) continue;
    const r = sliceSheet({
      sheet,
      meta: join(a2, `sheet_${name}.json`),
      out,
      size: Number(opt("size") ?? 96),
      bg: f.background ?? "auto",
      quantize: Number(opt("quantize") ?? 0),
      alpha: (opt("alpha") as "soft" | "hard") ?? "soft",
      tile: opt("tile"),
    });
    console.log(`sheet_${name}: ${r.how}, ${r.cells.length} cells`);
    for (const c of r.cells) if (!icons.includes(c.id)) icons.push(c.id);
  }
  console.log(contactSheet({ files: icons.map((i) => join(out, `${i}.png`)), out: join(out, "_contact.png") }).out);
} else {
  console.error("usage: kindling-sheet gen|cut|prompt|cost ... (see the header of src/cli/sheet.ts)");
  process.exit(2);
}
