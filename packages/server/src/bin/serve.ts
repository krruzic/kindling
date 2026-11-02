#!/usr/bin/env -S node --experimental-transform-types --no-warnings
// CLI: static server only (no relay). A game with online play writes its own few-line server.ts that calls serve()
// with attachRelay. Env: STATIC_DIR (default release), PORT (8080), HOST, ROUTES (JSON, e.g.
// '{"/":"/site/index.html","/play":"/index.html","/play/*":"/index.html"}').
import { serve } from "../server.ts";

const routes = process.env.ROUTES ? (JSON.parse(process.env.ROUTES) as Record<string, string>) : undefined;
await serve({
  root: process.env.STATIC_DIR ?? "release",
  port: Number(process.env.PORT ?? 8080),
  host: process.env.HOST || undefined,
  routes,
  log: (m) => console.log(m),
});
process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));
