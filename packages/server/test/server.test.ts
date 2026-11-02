// Real HTTP requests against a server on an ephemeral port over a temp build directory.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { brotliDecompressSync, gunzipSync } from "node:zlib";
import { assert, test } from "./harness.ts";
import { acceptsEncoding, precompress, serve, type Running } from "../src/index.ts";

interface Reply {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
}

function get(base: string, path: string, headers: Record<string, string> = {}, method = "GET"): Promise<Reply> {
  return new Promise((resolveP, reject) => {
    const req = request(base + path, { method, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => resolveP({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on("error", reject);
    req.end();
  });
}

function site(): string {
  const root = mkdtempSync(join(tmpdir(), "kindling-site-"));
  const put = (rel: string, data: string | Buffer) => {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), data);
  };
  put("index.html", "<html>GAME</html>");
  put("site/index.html", "<html>LANDING</html>");
  put("docs/index.html", "DOCS");
  put("assets/app-1a2b3c.js", "console.log('hello kindling');\n".repeat(200));
  put("assets/clip.ogg", Buffer.from(Array.from({ length: 4000 }, (_, i) => i % 251)));
  put("assets/tiny.js", "x()");
  put("404.html", "NOPE");
  writeFileSync(join(tmpdir(), "kindling-secret.txt"), "secret");
  return root;
}

const root = site();
let srv: Running;
const relayAttached: string[] = [];

test("start on an ephemeral port with an injected relay", async () => {
  const s = precompress(root);
  assert.equal(s.files, 1);
  assert.ok(existsSync(join(root, "assets/app-1a2b3c.js.br")) && existsSync(join(root, "assets/app-1a2b3c.js.gz")));
  assert.ok(!existsSync(join(root, "assets/tiny.js.br")));
  assert.ok(!existsSync(join(root, "assets/clip.ogg.br")));
  assert.ok(s.after < s.before);
  srv = await serve({
    root,
    port: 0,
    host: "127.0.0.1",
    routes: { "/": "/site/index.html", "/play": "/index.html", "/play/*": "/index.html" },
    notFound: "/404.html",
    route: (req, res) => {
      if (req.url !== "/net/rooms") return false;
      res.writeHead(200, { "Content-Type": "application/json" }).end("[]");
      return true;
    },
    attachRelay: (server) => {
      relayAttached.push("yes");
      server.on("upgrade", (req, socket) => {
        if (req.url?.startsWith("/net/ws")) {
          socket.end("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n");
        }
      });
    },
  });
  assert.ok(srv.port > 0);
  assert.deepEqual(relayAttached, ["yes"]);
});

test("routes: landing at /, game at /play, SPA deep links, directories", async () => {
  assert.equal((await get(srv.url, "/")).body.toString(), "<html>LANDING</html>");
  assert.equal((await get(srv.url, "/index.html")).body.toString(), "<html>GAME</html>");
  for (const p of ["/play", "/play/", "/play?bots=1&map=x", "/play/lobby/abc"]) {
    const r = await get(srv.url, p);
    assert.equal(r.status, 200, p);
    assert.equal(r.body.toString(), "<html>GAME</html>", p);
    assert.equal(r.headers["content-type"], "text/html; charset=utf-8");
    assert.equal(r.headers["cache-control"], "no-cache");
  }
  assert.equal((await get(srv.url, "/docs")).body.toString(), "DOCS");
  assert.equal((await get(srv.url, "/net/rooms")).body.toString(), "[]");
  assert.equal((await get(srv.url, "/healthz")).body.toString(), "ok");
});

test("precompressed variants by Accept-Encoding, immutable cache for hashed assets", async () => {
  const raw = readFileSync(join(root, "assets/app-1a2b3c.js"));
  const br = await get(srv.url, "/assets/app-1a2b3c.js", { "accept-encoding": "gzip, deflate, br" });
  assert.equal(br.headers["content-encoding"], "br");
  assert.deepEqual(brotliDecompressSync(br.body), raw);
  assert.equal(br.headers["cache-control"], "public, max-age=31536000, immutable");
  assert.equal(br.headers.vary, "Accept-Encoding");
  assert.equal(br.headers["content-type"], "text/javascript; charset=utf-8");
  assert.equal(Number(br.headers["content-length"]), br.body.length);
  const gz = await get(srv.url, "/assets/app-1a2b3c.js", { "accept-encoding": "gzip" });
  assert.equal(gz.headers["content-encoding"], "gzip");
  assert.deepEqual(gunzipSync(gz.body), raw);
  const brOff = await get(srv.url, "/assets/app-1a2b3c.js", { "accept-encoding": "br;q=0, gzip" });
  assert.equal(brOff.headers["content-encoding"], "gzip");
  const plain = await get(srv.url, "/assets/app-1a2b3c.js");
  assert.equal(plain.headers["content-encoding"], undefined);
  assert.deepEqual(plain.body, raw);
});

test("a stale precompressed file (older than its source) is not served", async () => {
  const file = join(root, "assets/app-1a2b3c.js");
  const old = new Date(Date.now() - 60_000);
  utimesSync(file + ".br", old, old);
  const r = await get(srv.url, "/assets/app-1a2b3c.js", { "accept-encoding": "br" });
  assert.equal(r.headers["content-encoding"], undefined);
  precompress(root);
});

test("404s, traversal, methods, HEAD, 304", async () => {
  const nf = await get(srv.url, "/nope.js");
  assert.equal(nf.status, 404);
  assert.equal(nf.body.toString(), "NOPE");
  assert.equal((await get(srv.url, "/../kindling-secret.txt")).status, 404);
  assert.equal((await get(srv.url, "/%2e%2e/kindling-secret.txt")).status, 404);
  assert.equal((await get(srv.url, "/%E0%A4%A")).status, 404);
  const post = await get(srv.url, "/", {}, "POST");
  assert.equal(post.status, 405);
  assert.equal(post.headers.allow, "GET, HEAD");
  const head = await get(srv.url, "/play", {}, "HEAD");
  assert.equal(head.status, 200);
  assert.equal(head.body.length, 0);
  assert.equal(Number(head.headers["content-length"]), "<html>GAME</html>".length);
  const lm = String((await get(srv.url, "/play")).headers["last-modified"]);
  assert.equal((await get(srv.url, "/play", { "if-modified-since": lm })).status, 304);
  assert.equal(
    (await get(srv.url, "/play", { "if-modified-since": new Date(Date.parse(lm) - 10_000).toUTCString() })).status,
    200,
  );
});

test("byte ranges on uncompressed files", async () => {
  const raw = readFileSync(join(root, "assets/clip.ogg"));
  const r = await get(srv.url, "/assets/clip.ogg", { range: "bytes=100-199" });
  assert.equal(r.status, 206);
  assert.equal(r.headers["content-range"], `bytes 100-199/${raw.length}`);
  assert.deepEqual(r.body, raw.subarray(100, 200));
  const tail = await get(srv.url, "/assets/clip.ogg", { range: "bytes=-10" });
  assert.deepEqual(tail.body, raw.subarray(raw.length - 10));
  assert.equal((await get(srv.url, "/assets/clip.ogg", { range: "bytes=99999-" })).status, 416);
  assert.equal(r.headers["content-type"], "audio/ogg");
});

test("upgrades: relay path handed to the relay, other paths destroyed", async () => {
  const up = (path: string) =>
    new Promise<string>((resolveP) => {
      const req = request(srv.url + path, { headers: { Connection: "Upgrade", Upgrade: "websocket" } });
      req.on("upgrade", (res) => resolveP(`upgraded ${res.statusCode}`));
      req.on("error", () => resolveP("destroyed"));
      req.on("response", (res) => resolveP(`response ${res.statusCode}`));
      req.end();
    });
  assert.equal(await up("/net/ws?room=1"), "upgraded 101");
  assert.equal(await up("/elsewhere"), "destroyed");
});

test("accept-encoding parsing", () => {
  assert.ok(acceptsEncoding("gzip, br", "br"));
  assert.ok(!acceptsEncoding("gzip", "br"));
  assert.ok(!acceptsEncoding("br;q=0", "br"));
  assert.ok(acceptsEncoding("*", "gzip"));
});

test("deploy template: valid bash and the expected pipeline (dry run)", () => {
  const script = new URL("../templates/deploy.sh", import.meta.url).pathname;
  execFileSync("bash", ["-n", script]);
  const out = execFileSync(script, [], {
    encoding: "utf8",
    env: { ...process.env, DRY_RUN: "1", IMAGE: "g:1", HOST: "me@h", REMOTE_DIR: "/srv/g", URL: "https://g.example" },
  });
  assert.match(out, /\+ docker build -f Dockerfile -t g:1 \./);
  assert.match(out, /\+ docker save g:1 \| gzip \| ssh me@h 'gunzip \| docker load'/);
  assert.match(out, /docker\\ compose\\ up\\ -d/);
  assert.match(out, /\+ curl -fsS .*https:\/\/g\.example\/healthz/);
  assert.throws(() => execFileSync(script, [], { stdio: "pipe", env: { ...process.env, DRY_RUN: "1", IMAGE: "" } }));
});

test("stop the server", async () => {
  await srv.close();
});
