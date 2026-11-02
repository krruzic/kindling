// Screenshots of the demo with @kindling/assets' harness: starts Vite on a free port, shoots the default (arena
// camera) and ?cam=follow views at several sizes, fails on any console error, and writes a contact sheet.
//   node --experimental-transform-types --no-warnings demo/shots.ts [outDir]
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { screenshots, contactSheet } from "@kindling/assets";

const here = dirname(fileURLToPath(import.meta.url));
const out = process.argv[2] ?? "/tmp/opencode/kindling-three-demo";
const server = await createServer({ root: here, logLevel: "error", server: { port: 0, host: "127.0.0.1" } });
await server.listen();
const base = server.resolvedUrls!.local[0];
try {
  const r = await screenshots({
    targets: [
      { name: "arena", url: `${base}?t=4&scale=1` },
      { name: "follow", url: `${base}?cam=follow&t=4&scale=1` },
      { name: "perf", url: `${base}?perf&t=6` },
    ],
    out,
    sizes: [
      { width: 1920, height: 1080 },
      { width: 1280, height: 720 },
      { width: 1440, height: 900 },
    ],
    waitFor: "window.demo && window.demo.frames > 20",
    settleMs: 1200,
    timeoutMs: 120000,
    log: console.log,
  });
  const sheet = contactSheet({ files: r.files, out: join(out, "contact.png"), per: 3, cell: 480, tile: "none" });
  console.log("contact", sheet.out);
  for (const p of r.problems) console.log(`${p.kind} [${p.target} ${p.size}] ${p.message}`);
  if (r.problems.length) process.exitCode = 1;
} finally {
  await server.close();
}
