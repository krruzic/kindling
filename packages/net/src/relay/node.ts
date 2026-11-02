// Node WebSocket relay (`ws`) around RelayCore: mounts on any node http server (the production static server)
// and, through vitePlugin(), on the Vite dev / preview server, so online play works on the same port in dev and in
// production. Endpoints under `path` (default "/net"): `{path}/ws` (WebSocket), `{path}/info` (JSON: open rooms,
// the server's LAN addresses, a public URL) and `{path}/stats` (JSON counters, when `stats` is on).
import { networkInterfaces } from "node:os";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, type WebSocket } from "ws";
import { RelayCore, type RelayConn, type RelayCoreOptions } from "./core.ts";
import type { RelayInfo } from "../protocol.ts";

export { RelayCore } from "./core.ts";
export type { RelayConn, RelayCoreOptions, RelayCounters } from "./core.ts";

export interface RelayOptions extends RelayCoreOptions {
  /** URL prefix (default "/net"). */
  path?: string;
  /** Ping interval in ms (default 3500; with missedPings 3 a dead socket closes within ~10-14 s). */
  heartbeatMs?: number;
  /** Serve `{path}/stats` (default true). */
  stats?: boolean;
  /** Public URL to advertise in /info (a tunnel), or a function returning it. */
  publicUrl?: string | (() => string);
  /** Largest accepted frame in bytes (default 4 MiB: a rejoin replays every frame of a long match). */
  maxPayload?: number;
}

/** host:port for each LAN IPv4 interface, skipping loopback and Docker bridge ranges (172.16/12). */
export function lanAddresses(port: number): string[] {
  const out: string[] = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) {
      if (a.family !== "IPv4" || a.internal || /^172\.(1[6-9]|2\d|3[01])\./.test(a.address)) continue;
      out.push(`${a.address}:${port}`);
    }
  }
  return out;
}

type Next = () => void;
type Middleware = (req: IncomingMessage, res: ServerResponse, next: Next) => void;
interface ViteLikeServer {
  httpServer: Server | null | { on: Server["on"]; address: Server["address"] };
  middlewares: { use: (fn: Middleware) => void };
}

export interface Relay {
  readonly core: RelayCore;
  /** Port the attached server listens on (0 until known). */
  port: number;
  /** Handles a WebSocket upgrade for `{path}/ws`; false when the URL isn't ours. */
  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): boolean;
  /** Handles `{path}/info` and `{path}/stats`; false for anything else. */
  handleRequest(req: IncomingMessage, res: ServerResponse): boolean;
  /** Mounts the upgrade handler on a server (call before or after listen). */
  attach(server: Server | null | undefined): void;
  /** Connect-style middleware for handleRequest. */
  middleware: Middleware;
  /** A Vite plugin mounting the relay on the dev and preview servers. */
  vitePlugin(name?: string): {
    name: string;
    configureServer(server: ViteLikeServer): void;
    configurePreviewServer(server: ViteLikeServer): void;
  };
  info(port?: number): RelayInfo;
  stats(): Record<string, number>;
  /** Stops the heartbeat and closes every connection. */
  close(): void;
}

export function createRelay(opts: RelayOptions = {}): Relay {
  const path = (opts.path ?? "/net").replace(/\/$/, "");
  const heartbeatMs = opts.heartbeatMs ?? 3500;
  const core = new RelayCore(opts);
  const wss = new WebSocketServer({ noServer: true, maxPayload: opts.maxPayload ?? 4 << 20 });
  const publicUrl = () => (typeof opts.publicUrl === "function" ? opts.publicUrl() : (opts.publicUrl ?? ""));
  const portOf = (req: IncomingMessage) => Number((req.headers.host ?? "").split(":")[1] ?? 0) || relay.port;
  const under = (url: string | undefined, sub: string) => {
    const p = (url ?? "").split("?")[0];
    return p === `${path}/${sub}` || p === `${path}/${sub}/`;
  };

  wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
    const conn: RelayConn = {
      send: (text) => {
        if (ws.readyState === ws.OPEN) ws.send(text);
      },
      close: () => ws.close(),
      terminate: () => ws.terminate(),
      ping: () => ws.ping(),
    };
    const port = portOf(req);
    core.open(conn);
    ws.on("pong", () => core.alive(conn));
    ws.on("message", (raw, binary) => {
      if (binary) return;
      core.message(conn, String(raw), { addrs: lanAddresses(port), public: publicUrl() });
    });
    ws.on("close", () => core.closed(conn));
    ws.on("error", () => ws.terminate());
  });

  const timer = setInterval(() => core.heartbeat(), heartbeatMs);
  timer.unref?.();

  const json = (res: ServerResponse, body: unknown) => {
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.end(JSON.stringify(body));
  };

  const relay: Relay = {
    core,
    port: 0,
    handleUpgrade(req, socket, head) {
      if (!under(req.url, "ws")) return false;
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
      return true;
    },
    handleRequest(req, res) {
      if (under(req.url, "info")) json(res, relay.info(portOf(req)));
      else if (opts.stats !== false && under(req.url, "stats")) json(res, relay.stats());
      else return false;
      return true;
    },
    attach(server) {
      if (!server) return;
      const learn = () => {
        const a = server.address();
        if (a && typeof a === "object") relay.port = a.port;
      };
      if (server.listening) learn();
      server.on("listening", learn);
      server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
        relay.handleUpgrade(req, socket, head);
      });
    },
    middleware(req, res, next) {
      if (!relay.handleRequest(req, res)) next();
    },
    vitePlugin(name = "kindling-net-relay") {
      const mount = (server: ViteLikeServer) => {
        relay.attach(server.httpServer as Server | null);
        server.middlewares.use(relay.middleware);
      };
      return { name, configureServer: mount, configurePreviewServer: mount };
    },
    info(port = relay.port) {
      const rooms = core.roomList();
      return {
        rooms,
        addrs: lanAddresses(port),
        public: publicUrl(),
        players: rooms.reduce((n, r) => n + r.peers + 1, 0),
      };
    },
    stats() {
      return {
        uptime: Math.round((Date.now() - core.started) / 1000),
        rooms: core.roomList().length,
        connections: core.size,
        ...core.counters,
      };
    },
    close() {
      clearInterval(timer);
      core.closeAll();
      for (const ws of wss.clients) ws.terminate();
      wss.close();
    },
  };
  return relay;
}
