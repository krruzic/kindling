// The production server: static files and the online relay on one port in one node process, so one container
// serves the whole game. The relay is injected (`attachRelay(server)` installs its own upgrade handler, `route`
// answers its HTTP endpoints such as the room list), so this package doesn't depend on @kindling/net:
//   import { createRelay } from "@kindling/net/relay";
//   const relay = createRelay();
//   await serve({ root: "release", routes: { "/": "/site/index.html", "/play": "/index.html" },
//     route: (req, res) => relay.handleRequest(req, res), attachRelay: (s) => relay.attach(s) });
// WebSocket upgrades on any other path are refused (sockets destroyed), as in Grudge.
import { createServer as httpServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { createStaticHandler, type StaticOptions } from "./static.ts";

export interface ServeOptions extends StaticOptions {
  /** Default: env PORT, else 8080. 0 picks a free port. */
  port?: number;
  /** Default: all interfaces. */
  host?: string;
  /** Health check path answered "ok" (default "/healthz"; false disables). */
  health?: string | false;
  /** Extra HTTP routes tried first; return true when handled (e.g. the relay's room list). */
  route?: (req: IncomingMessage, res: ServerResponse) => boolean;
  /** Install the relay's upgrade handling on the server. */
  attachRelay?: (server: Server) => void;
  /** Path prefixes allowed to upgrade to WebSocket (default ["/net/ws"]). Others are destroyed. */
  upgradePaths?: string[];
  log?: (msg: string) => void;
}

export interface Running {
  server: Server;
  port: number;
  url: string;
  close(): Promise<void>;
}

/** The http.Server, not yet listening. */
export function createGameServer(opts: ServeOptions): Server {
  const files = createStaticHandler(opts);
  const health = opts.health === undefined ? "/healthz" : opts.health;
  const server = httpServer((req, res) => {
    try {
      if (health && (req.url ?? "").split("?")[0] === health) {
        res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" }).end("ok");
        return;
      }
      if (opts.route?.(req, res)) return;
      files(req, res);
    } catch (e) {
      opts.log?.(`error serving ${req.url}: ${e instanceof Error ? e.message : e}`);
      if (!res.headersSent) res.writeHead(500).end();
      else res.destroy();
    }
  });
  opts.attachRelay?.(server);
  const allowed = opts.upgradePaths ?? ["/net/ws"];
  server.on("upgrade", (req, socket) => {
    if (!allowed.some((p) => req.url?.startsWith(p))) socket.destroy();
  });
  return server;
}

/** Create and listen. Resolves once bound (with the actual port when port is 0). */
export function serve(opts: ServeOptions): Promise<Running> {
  const server = createGameServer(opts);
  const port = opts.port ?? Number(process.env.PORT ?? 8080);
  return new Promise((resolveP, reject) => {
    server.once("error", reject);
    server.listen(port, opts.host, () => {
      server.off("error", reject);
      const bound = (server.address() as AddressInfo).port;
      const shown = opts.host && opts.host !== "0.0.0.0" && opts.host !== "::" ? opts.host : "localhost";
      opts.log?.(`serving ${opts.root} on :${bound}`);
      resolveP({
        server,
        port: bound,
        url: `http://${shown.includes(":") ? `[${shown}]` : shown}:${bound}`,
        close: () =>
          new Promise<void>((r) => {
            server.closeAllConnections?.();
            server.close(() => r());
          }),
      });
    });
  });
}
