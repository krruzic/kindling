// The node relay over real WebSockets on an ephemeral port: rooms, routing, meta and the /info list, kinds,
// build refusal, heartbeat (dropped after missed pings, kept after a single miss), host loss, the Vite plugin.
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { WebSocket } from "ws";
import { test, ok, eq } from "./harness.ts";
import { createRelay, type Relay } from "../src/relay/node.ts";
import { NetLink, type NetMsg, type RelayInfo, type SocketLike } from "../src/index.ts";

async function serve(opts: Parameters<typeof createRelay>[0]): Promise<{ relay: Relay; server: Server; port: number }> {
  const relay = createRelay(opts);
  const server = createServer((req, res) => {
    if (relay.handleRequest(req, res)) return;
    res.statusCode = 404;
    res.end();
  });
  relay.attach(server);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return { relay, server, port: (server.address() as AddressInfo).port };
}

function stop(s: { relay: Relay; server: Server }): Promise<void> {
  s.relay.close();
  s.server.closeAllConnections?.();
  return new Promise((r) => s.server.close(() => r()));
}

function link(port: number, build = "b1", cid?: string): NetLink {
  return new NetLink({
    url: `ws://127.0.0.1:${port}/net/ws`,
    socket: (url) => new WebSocket(url) as unknown as SocketLike,
    build,
    cid,
  });
}

/** Resolves with the next inbox message matching `pred` (already queued ones included). */
function next(l: NetLink, pred: (m: NetMsg) => boolean, ms = 3000): Promise<NetMsg> {
  const queued = l.drain();
  const hit = queued.find(pred);
  if (hit) return Promise.resolve(hit);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      l.onMessage = null;
      reject(new Error(`timeout waiting on ${l.role}; status "${l.status}"`));
    }, ms);
    l.onMessage = (m) => {
      if (!pred(m)) return;
      clearTimeout(timer);
      l.onMessage = null;
      l.drain();
      resolve(m);
    };
  });
}

const getInfo = async (port: number): Promise<RelayInfo> => (await fetch(`http://127.0.0.1:${port}/net/info`)).json();

test("relay over ws: rooms, routing, meta, room list, kinds, build refusal", async () => {
  const s = await serve({ kinds: ["versus", "campaign"] });
  try {
    const host = link(s.port, "b1", "hcid");
    host.host({ name: "Kay", kind: "versus" });
    const hosting = await next(host, (m) => m.t === "hosting");
    const code = String(hosting.room);
    ok(/^[A-Z]{4}$/.test(code), `room code ${code}`);
    ok(Array.isArray(hosting.addrs), "LAN addresses listed");

    const guest = link(s.port, "b1", "gcid");
    const joined = next(host, (m) => m.t === "joined");
    guest.join({ name: "Ann", kind: "versus", room: code });
    const welcome = await next(guest, (m) => m.t === "welcome");
    eq(welcome.room, code);
    const j = await joined;
    eq([j.name, j.cid], ["ANN", "gcid"]);
    eq(host.peers.get(guest.id)?.cid, "gcid");

    const up = next(host, (m) => m.t === "from");
    guest.toHost({ t: "hello", n: 1 });
    eq(((await up).msg as NetMsg).n, 1);
    const down = next(guest, (m) => m.t === "hi");
    host.toPeer("all", { t: "hi" });
    await down;

    host.meta({ name: "Kay's arena", phase: "match", players: 2, seats: 4, extra: { map: "DUNES" } });
    // relayed after the meta on the same socket: once the guest has it, the relay has the meta too
    const sync = next(guest, (m) => m.t === "sync");
    host.toPeer("all", { t: "sync" });
    await sync;
    const info = await getInfo(s.port);
    eq(info.rooms.length, 1);
    eq(
      [info.rooms[0].code, info.rooms[0].name, info.rooms[0].phase, info.rooms[0].peers],
      [code, "KAY'S ARENA", "match", 1],
    );
    eq(info.rooms[0].extra, { map: "DUNES" });
    eq(info.rooms[0].kind, "versus");
    const stats = await (await fetch(`http://127.0.0.1:${s.port}/net/stats`)).json();
    ok(stats.opened === 1 && stats.joins === 1, "stats counters");

    // code-less join of another kind finds nobody; unknown kinds are refused; another build is refused
    const other = link(s.port);
    other.join({ kind: "campaign" });
    eq((await next(other, (m) => m.t === "error")).code, "nobody");
    const weird = link(s.port);
    weird.join({ kind: "chess" });
    eq((await next(weird, (m) => m.t === "error")).code, "kind");
    const old = link(s.port, "b0");
    old.join({ kind: "versus", room: code });
    eq((await next(old, (m) => m.t === "error")).code, "build");

    // the host leaving tells the guest
    const gone = next(guest, (m) => m.t === "closed");
    host.close();
    eq((await gone).reason, "host-left");
    eq((await getInfo(s.port)).rooms.length, 0);
  } finally {
    await stop(s);
  }
});

test("relay heartbeat drops a silent socket after missed pings but not after one miss", async () => {
  const s = await serve({ heartbeatMs: 80, missedPings: 3 });
  try {
    const url = `ws://127.0.0.1:${s.port}/net/ws`;
    const open = (ws: WebSocket) => new Promise<void>((r) => ws.once("open", () => r()));
    // a host that never answers pings (a sleeping laptop), with a guest in its room
    const dead = new WebSocket(url, { autoPong: false });
    await open(dead);
    dead.send(JSON.stringify({ t: "host", name: "zzz" }));
    const code = await new Promise<string>((r) => dead.once("message", (d) => r(JSON.parse(String(d)).room)));
    const guest = link(s.port);
    guest.join({ room: code });
    await next(guest, (m) => m.t === "welcome");
    // a client that misses exactly one ping, then answers every one
    const flaky = new WebSocket(url, { autoPong: false });
    await open(flaky);
    let pings = 0;
    flaky.on("ping", () => {
      if (pings++ > 0) flaky.pong();
    });
    const t0 = Date.now();
    const deadClosed = new Promise<number>((r) => dead.once("close", () => r(Date.now() - t0)));
    const hostLeft = next(guest, (m) => m.t === "closed", 3000);
    const ms = await deadClosed;
    ok(ms >= 160 && ms < 1500, `dropped after ${ms} ms`);
    eq((await hostLeft).reason, "host-left");
    await new Promise((r) => setTimeout(r, 600));
    ok(pings >= 6, `flaky got ${pings} pings`);
    eq(flaky.readyState, WebSocket.OPEN);
    eq(s.relay.core.counters.dropped, 1);
    flaky.close();
  } finally {
    await stop(s);
  }
});

test("vitePlugin mounts the upgrade handler and middleware", () => {
  const relay = createRelay({ path: "/game" });
  const used: unknown[] = [];
  const events: string[] = [];
  const fake = {
    httpServer: { on: (ev: string) => events.push(ev), address: () => null, listening: false } as never,
    middlewares: { use: (fn: unknown) => used.push(fn) },
  };
  const plugin = relay.vitePlugin();
  plugin.configureServer(fake);
  plugin.configurePreviewServer(fake);
  eq(used.length, 2);
  ok(events.includes("upgrade") && events.includes("listening"), "listeners attached");
  let nexted = false;
  relay.middleware({ url: "/other" } as never, {} as never, () => (nexted = true));
  ok(nexted, "unrelated requests pass through");
  relay.close();
});
