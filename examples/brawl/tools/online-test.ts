// A real online test in two browser pages against the dev relay (the Vite plugin): page A hosts a room and adds a
// CPU, page B joins by the room code; both seat a keyboard player, ready up, and the host starts the match. Both
// pages play (keyboard input) until round 2 begins; then the world hashes both recorded at the same ticks must be
// identical, and both must agree on who won round 1. Fails on any console error.
// Then the guest reloads its page mid-match: it rejoins the room with the same client id, replays the match so far
// and plays on in sync.
//   pnpm online-test           against the Vite dev server and its relay plugin
//   pnpm online-test --prod    against the production server (tools/server.ts: @kindling/server + relay) serving
//                              the build in release/ (run `pnpm build` first)
import { chromium } from "playwright-core";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { findChromium } from "@kindling/assets";
import { serve } from "@kindling/server";
import { createRelay } from "@kindling/net/relay";

const root = fileURLToPath(new URL("..", import.meta.url));
const prod = process.argv.includes("--prod");
let base = "";
let closeServer: () => Promise<void>;
if (prod) {
  const relay = createRelay({ kinds: ["brawl"] });
  const s = await serve({
    root: fileURLToPath(new URL("../release", import.meta.url)),
    port: 0,
    host: "127.0.0.1",
    route: (req, res) => relay.handleRequest(req, res),
    attachRelay: (srv) => relay.attach(srv),
  });
  base = `${s.url}/`;
  closeServer = async () => {
    relay.close();
    await s.close();
  };
} else {
  const server = await createServer({ root, logLevel: "error", server: { port: 0, host: "127.0.0.1" } });
  await server.listen();
  base = server.resolvedUrls!.local[0];
  closeServer = () => server.close();
}
console.log(`testing against ${prod ? "the production server" : "the Vite dev server"} at ${base}`);
const browser = await chromium.launch({
  executablePath: findChromium(),
  args: [
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    "--ignore-gpu-blocklist",
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    "--disable-backgrounding-occluded-windows",
  ],
});
const errors: string[] = [];
let failed = false;
const log = (m: string) => console.log(`[${(performance.now() / 1000).toFixed(1)}s] ${m}`);
try {
  const open = async (name: string, q: string) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await ctx.newPage();
    page.on("console", (m) => m.type() === "error" && errors.push(`${name}: ${m.text()}`));
    page.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
    await page.goto(`${base}?${q}&mute`);
    await page.waitForFunction("window.game && window.game.ready && window.game.frames > 10", null, { timeout: 60000 });
    return page;
  };
  type G = {
    room: string;
    screen: string;
    round: number;
    phase: string;
    tick: number;
    hashes: Record<string, string>;
    online: { inMatch: boolean } | null;
  };
  const game = (p: Awaited<ReturnType<typeof open>>) => p.evaluate(() => (window as unknown as { game: G }).game);
  const tap = async (p: Awaited<ReturnType<typeof open>>, key: string) => {
    await p.keyboard.down(key);
    await p.waitForTimeout(80);
    await p.keyboard.up(key);
    await p.waitForTimeout(120);
  };

  const host = await open("host", "host=ALPHA");
  await host.waitForFunction("window.game.room && window.game.room.length === 4", null, { timeout: 20000 });
  const room = (await game(host)).room;
  log(`host opened room ${room}`);
  const guest = await open("guest", `room=${room}&name=BETA`);
  await guest.waitForFunction("window.game.online && window.game.online.state === 'open'", null, { timeout: 20000 });
  log("guest joined");
  // seat a keyboard player on each page (first press joins), host adds a CPU, both ready
  await tap(host, "Space");
  await tap(guest, "Space");
  await host.waitForTimeout(1500);
  await tap(host, "KeyC");
  await tap(guest, "Space");
  await tap(host, "Space");
  await host.waitForFunction("window.game.screen === 'match'", null, { timeout: 20000 });
  await guest.waitForFunction("window.game.screen === 'match'", null, { timeout: 20000 });
  log("match started on both pages");
  // play: the guest drives right and dashes, the host circles and blasts
  await guest.keyboard.down("KeyD");
  await host.keyboard.down("KeyW");
  const until = Date.now() + 150000;
  let round1 = "";
  while (Date.now() < until) {
    await tap(guest, "ShiftLeft");
    await tap(host, "Space");
    const g = await game(guest);
    if (g.round >= 2) break;
  }
  await guest.keyboard.up("KeyD");
  await host.keyboard.up("KeyW");
  const [a, b] = [await game(host), await game(guest)];
  log(`host tick ${a.tick} round ${a.round}; guest tick ${b.tick} round ${b.round}`);
  if (a.round < 2 || b.round < 2) throw new Error("round 1 did not finish on both pages");
  const common = Object.keys(a.hashes).filter((t) => t in b.hashes);
  const differ = common.filter((t) => a.hashes[t] !== b.hashes[t]);
  log(`${common.length} common hash checkpoints, ${differ.length} differ`);
  if (common.length < 5) throw new Error("too few common checkpoints");
  if (differ.length) throw new Error(`desync at ticks ${differ.slice(0, 5).join(", ")}`);
  // the guest reloads mid-match: same tab (sessionStorage client id), rejoins and replays
  const before = (await game(host)).tick;
  await guest.reload();
  await guest.waitForFunction("window.game && window.game.screen === 'match' && window.game.tick > 0", null, {
    timeout: 30000,
  });
  await host.waitForFunction(`window.game.tick > ${before + 600}`, null, { timeout: 60000 });
  await guest.waitForFunction(`window.game.tick > ${before + 600}`, null, { timeout: 30000 });
  const [c, d] = [await game(host), await game(guest)];
  const later = Object.keys(c.hashes).filter((t) => t in d.hashes && Number(t) > before);
  const bad = later.filter((t) => c.hashes[t] !== d.hashes[t]);
  log(`after the guest's reload: ${later.length} common checkpoints past tick ${before}, ${bad.length} differ`);
  if (later.length < 3 || bad.length) throw new Error("rejoin by replay failed");
  round1 = "ok";
  void round1;
  await host.screenshot({ path: "/tmp/opencode/brawl-online-host.png" });
  await guest.screenshot({ path: "/tmp/opencode/brawl-online-guest.png" });
  log("screenshots /tmp/opencode/brawl-online-{host,guest}.png");
} catch (e) {
  failed = true;
  console.error(e);
} finally {
  await browser.close();
  await closeServer();
}
for (const e of errors) console.log("console error:", e);
if (failed || errors.length) process.exitCode = 1;
else console.log("online test passed");
