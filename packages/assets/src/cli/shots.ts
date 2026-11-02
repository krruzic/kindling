#!/usr/bin/env -S node --experimental-transform-types --no-warnings
// Screenshot CLI:
//   kindling-shots <url...> [--out shots/] [--sizes 1920x1080,1280x720,1440x900] [--wait "<js expr>"]
//                  [--settle 1500] [--timeout 60000] [--contact shots/contact.png] [--check "<js expr>"]
// --check: an expression the page answers with a list of its own problems (e.g. "window.game.layoutIssues").
// Exits 1 when any page logged errors or timed out (after writing every shot).
import { join } from "node:path";
import { screenshots, type Viewport } from "../screenshot.ts";
import { contactSheet } from "../sheets.ts";

const args = process.argv.slice(2);
const opt = (k: string) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const flags = new Set(["--out", "--sizes", "--wait", "--settle", "--timeout", "--contact", "--check"]);
const urls = args.filter((a, i) => !a.startsWith("--") && !flags.has(args[i - 1]));
if (!urls.length) {
  console.error(
    "usage: kindling-shots <url...> [--out dir] [--sizes WxH,...] [--wait expr] [--settle ms] [--contact png] [--check expr]",
  );
  process.exit(2);
}
const sizes: Viewport[] | undefined = opt("sizes")
  ?.split(",")
  .map((s) => s.split("x").map(Number))
  .map(([width, height]) => ({ width, height }));
const out = opt("out") ?? "shots";
const r = await screenshots({
  targets: urls,
  out,
  sizes,
  waitFor: opt("wait"),
  check: opt("check"),
  settleMs: Number(opt("settle") ?? 0),
  timeoutMs: Number(opt("timeout") ?? 60000),
  log: console.log,
});
const contact = opt("contact");
if (contact) console.log(contactSheet({ files: r.files, out: contact, per: 3, cell: 420, tile: "none" }).out);
for (const p of r.problems) console.log(`${p.kind} [${p.target} ${p.size}] ${p.message}`);
console.log(`${r.files.length} shots in ${join(out)}, ${r.problems.length} problems`);
if (r.problems.length) process.exit(1);
