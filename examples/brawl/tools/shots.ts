// Screenshots of every screen with @kindling/assets' harness: starts this game's Vite (with the relay plugin) on a
// free port, opens each screen through its debug URL with the layout debugger on, shoots it at 1920x1080 and
// 1280x720, and fails on any console error, failed request or layout issue the page reports
// (window.game.layoutIssues). Writes a contact sheet.
//   pnpm shots [outDir] [--only=title,match] [--sizes=1920x1080,1280x720,1440x900]
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { contactSheet, screenshots, type ShotTarget, type Viewport } from "@kindling/assets";

const root = fileURLToPath(new URL("..", import.meta.url));
const args = process.argv.slice(2);
const out = args.find((a) => !a.startsWith("--")) ?? "/tmp/opencode/brawl-shots";
const only = args
  .find((a) => a.startsWith("--only="))
  ?.slice(7)
  .split(",");
const sizesArg = args.find((a) => a.startsWith("--sizes="))?.slice(8);
const sizes: Viewport[] = (sizesArg ?? "1920x1080,1280x720").split(",").map((s) => {
  const [width, height] = s.split("x").map(Number);
  return { width, height };
});

const SCREENS: [string, string][] = [
  ["title", "screen=title"],
  ["menu", "screen=menu"],
  ["options", "screen=options"],
  ["controls", "screen=controls"],
  ["online", "screen=online"],
  ["credits", "screen=credits"],
  ["select", "screen=select&players=3"],
  ["select-pads", "screen=select&fresh&pads=xbox,ps,gc,switch&join"],
  ["controls-pads", "screen=controls&pads=ps,gc&device=1"],
  ["name", "screen=name"],
  ["match", "screen=match&players=4&t=9"],
  ["match-xmas", "screen=match&players=3&t=14&holiday=xmas&seed=8"],
  ["perf", "screen=match&players=2&t=6&perf"],
  ["pause", "screen=pause&players=4&t=7"],
  ["results", "screen=results&players=4"],
  ["dialog", "screen=quit"],
  ["lobby", "host=SHOTS"],
];

const server = await createServer({
  root,
  logLevel: "error",
  server: { port: 0, host: "127.0.0.1", strictPort: false },
});
await server.listen();
const base = server.resolvedUrls!.local[0];
try {
  const targets: ShotTarget[] = SCREENS.filter(([n]) => !only || only.includes(n)).map(([name, q]) => ({
    name,
    url: `${base}?${q}&layoutdebug&mute`,
  }));
  const r = await screenshots({
    targets,
    out,
    sizes,
    waitFor: "window.game && window.game.ready && window.game.frames > 40 && !window.game.busy",
    check: "window.game.layoutIssues",
    settleMs: 900,
    timeoutMs: 120000,
    log: console.log,
  });
  const sheet = contactSheet({
    files: r.files,
    out: join(out, "contact.png"),
    per: sizes.length,
    cell: 480,
    tile: "none",
  });
  console.log("contact", sheet.out);
  for (const p of r.problems) console.log(`${p.kind} [${p.target} ${p.size}] ${p.message}`);
  console.log(`${r.files.length} shots, ${r.problems.length} problems`);
  if (r.problems.length) process.exitCode = 1;
} finally {
  await server.close();
}
