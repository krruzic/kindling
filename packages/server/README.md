# @kindling/server

The production server for a built Kindling game: static files and the online relay on one port in one node process,
precompressed assets, the right cache headers, SPA routes, a health check; the precompress step; and Docker,
docker-compose and deploy-over-ssh templates.

## Why

- [Docker image: static build + the relay in one node server on one port; `docker save | ssh host 'docker load'`;
  `docker-compose up -d`. Precompress static assets.](../../docs/LESSONS.md#deployment)
- [A dumb relay served by the dev server and by the production static server on the same
  port](../../docs/LESSONS.md#online-lockstep): the relay lives in `@kindling/net`; this server takes it by injection
  (`attachRelay`, `route`) so the packages stay independent.
- [Budget for the weakest machine](../../docs/LESSONS.md#rendering-threejs): Grudge's 15.9 MB map GLB brotlied to
  4.7 MB; hashed assets are cached forever, `index.html` revalidated so a deploy is picked up on the next visit.

## API

- `serve(opts): Promise<{ server, port, url, close() }>` and `createGameServer(opts): http.Server` (not listening).
  Options (all of `StaticOptions` plus):
  - `port` (env `PORT`, else 8080; 0 = ephemeral), `host`
  - `health` path answered `ok` (default `/healthz`, `false` to disable)
  - `route(req, res) => boolean`: extra HTTP endpoints tried first (the relay's room list)
  - `attachRelay(server)`: install the relay's WebSocket upgrade handler
  - `upgradePaths` allowed to upgrade (default `["/net/ws"]`); other upgrade requests are destroyed
- `createStaticHandler({ root, routes, hashed = ["assets"], types, headers, notFound })`:
  - `routes`: URL path -> root-relative file. `"/"` for a landing page, `"/play"` for the game, `"/play/*"` prefix
    routes for SPA deep links (only when no real file matches). Trailing slashes and query strings are ignored.
  - sends `<file>.br` / `<file>.gz` when accepted (respecting `q=0`) and not older than the file
  - hashed dirs: `Cache-Control: public, max-age=31536000, immutable`; everything else `no-cache` with
    `Last-Modified` / `If-Modified-Since` -> 304
  - single byte ranges (206 / 416) for uncompressed responses; 405 for non-GET/HEAD; traversal -> 404
- `precompress(dir, { extensions, minSize = 1024, maxRatio = 0.95, brotliQuality = 9 })` -> `{ files, before, after }`.
  Variants that don't save 5% are not written (and an old one is deleted).
- `MIME`, `COMPRESSIBLE`, `acceptsEncoding(header, enc)`.
- CLIs: `src/bin/precompress.ts [dir]`, `src/bin/serve.ts` (static only; env `STATIC_DIR`, `PORT`, `HOST`, `ROUTES`
  as JSON), also as the `kindling-precompress` / `kindling-serve` bins.
- `templates/`: `Dockerfile` (build -> precompress -> slim runtime, `HEALTHCHECK` on `/healthz`), `docker-compose.yml`
  (image from `.env`, `./data` volume, log rotation), `deploy.sh` (env `IMAGE`, `HOST`, `REMOTE_DIR`, `URL`; builds,
  `docker save | gzip | ssh HOST 'gunzip | docker load'`, copies the compose file, writes `.env`, `compose up -d`,
  then a `curl --retry` health check; `DRY_RUN=1` prints the commands).

## Usage

A game's `tools/server.ts` (the `SERVER_ENTRY` of the Dockerfile):

```ts
import { serve } from "@kindling/server";
import { NetRelay } from "@kindling/net/relay";

const relay = new NetRelay();
await serve({
  root: process.env.STATIC_DIR ?? "release",
  routes: { "/": "/site/index.html", "/play": "/index.html", "/play/*": "/index.html" },
  route: (req, res) => relay.route(req, res),
  attachRelay: (server) => relay.attach(server),
  log: console.log,
});
process.on("SIGTERM", () => process.exit(0));
```

Deploy:

```sh
cp node_modules/@kindling/server/templates/{Dockerfile,docker-compose.yml,deploy.sh} .
IMAGE=mygame:latest HOST=me@server REMOTE_DIR=/srv/mygame URL=https://mygame.example ./deploy.sh
```

Node only strips TypeScript outside `node_modules`, so the image (and any node use of Kindling) needs `@kindling/*`
linked from a workspace (`workspace:*` or `link:`), as in this monorepo, rather than installed as tarballs.

## In Grudge

`tools/server.ts` served `release/` with the landing page (`site/`) at `/` and the game at `/play`, precompressed
copies from `tools/precompress.ts`, a year of caching for Vite's hashed `assets/`, and `NetRelay` on the same port,
destroying upgrades outside `/net/ws`. The Dockerfile built, precompressed and ran it; deploys were `docker save |
ssh | docker load` plus `docker-compose up -d`.
