// Renders BRAWL's sound effects to public/sfx/<id>.<variant>.wav from the recipes in src/audio/synth.ts
// (procedural: no samples to license, no generation credit). Rerun after changing a recipe: pnpm sfx
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { normalise, render, seamless, sfxRecipes, wav } from "../src/audio/synth.ts";

const RATE = 22050;
const out = fileURLToPath(new URL("../public/sfx/", import.meta.url));
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
let bytes = 0;
for (const [id, variants] of Object.entries(sfxRecipes()))
  variants.forEach((v, i) => {
    let buf = normalise(render(v.voices, v.len, RATE, 101 + i * 13 + id.length), id.startsWith("bed.") ? 0.6 : 0.9);
    if (id.startsWith("bed.")) buf = seamless(buf, RATE);
    const data = wav(buf, RATE);
    bytes += data.length;
    writeFileSync(`${out}${id}.${i}.wav`, data);
  });
console.log(`wrote ${out} (${(bytes / 1024).toFixed(0)} KB)`);
