#!/usr/bin/env -S node --experimental-transform-types --no-warnings
// Credits CLI:
//   kindling-credits validate [assets.credits.json] [--public]   exit 1 on errors
//   kindling-credits list [file]                                  one line per entry
//   kindling-credits attribution [file]                           markdown credits for an about screen / README
import { dirname, resolve } from "node:path";
import { formatAttribution, loadCredits, validateCredits, LICENCES } from "../credits.ts";

const [cmd = "validate", ...rest] = process.argv.slice(2);
const file = resolve(rest.find((a) => !a.startsWith("--")) ?? "assets.credits.json");
const c = loadCredits(file);

if (cmd === "list") {
  for (const e of c.entries)
    console.log(`${e.licence.padEnd(14)} ${e.path.padEnd(40)} ${e.title}${e.author ? ` - ${e.author}` : ""}`);
} else if (cmd === "attribution") {
  console.log(formatAttribution(c));
} else if (cmd === "validate") {
  const issues = validateCredits(c, dirname(file), { publicBuild: rest.includes("--public") });
  for (const i of issues) console.log(`${i.level === "error" ? "ERROR" : "warn "} ${i.path}: ${i.message}`);
  const errors = issues.filter((i) => i.level === "error").length;
  const byLic: Record<string, number> = {};
  for (const e of c.entries) byLic[e.licence] = (byLic[e.licence] ?? 0) + 1;
  console.log(
    `${c.entries.length} entries (${Object.entries(byLic)
      .map(([k, v]) => `${LICENCES[k]?.name ?? k}: ${v}`)
      .join(", ")}), ${errors} errors, ${issues.length - errors} warnings`,
  );
  if (errors) process.exit(1);
} else {
  console.error("usage: kindling-credits validate|list|attribution [assets.credits.json] [--public]");
  process.exit(2);
}
