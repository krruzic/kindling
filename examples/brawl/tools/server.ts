// Production server: the Vite build (release/) and the online relay on one port in one node process, via
// @kindling/server (static files, precompressed variants, cache headers, /healthz) with @kindling/net's relay
// injected. This is the Dockerfile's SERVER_ENTRY.
//   pnpm serve                      build, then serve on PORT (default 8080)
//   STATIC_DIR=release PORT=9000 node --experimental-transform-types --no-warnings tools/server.ts
import { fileURLToPath } from "node:url";
import { serve } from "@kindling/server";
import { createRelay } from "@kindling/net/relay";

const root = process.env.STATIC_DIR ?? fileURLToPath(new URL("../release", import.meta.url));
const relay = createRelay({ kinds: ["brawl"], publicUrl: () => process.env.PUBLIC_URL ?? "" });
const running = await serve({
  root,
  port: Number(process.env.PORT ?? 8080),
  host: process.env.HOST || undefined,
  route: (req, res) => relay.handleRequest(req, res),
  attachRelay: (server) => relay.attach(server),
  log: (m) => console.log(m),
});
console.log(`BRAWL on ${running.url} (relay at /net/ws, rooms at /net/info)`);
const stop = () => {
  relay.close();
  void running.close().then(() => process.exit(0));
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
