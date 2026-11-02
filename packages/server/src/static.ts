// Static file handler for a built game (Grudge's tools/server.ts, generalised):
//   - routes map URL paths to files: "/" -> the landing page, "/play" -> the game's index.html, and "/play/*" for SPA
//     deep links (a prefix route only applies when no real file matches);
//   - precompressed <file>.br / <file>.gz (see precompress.ts) are sent when the browser accepts them and they are
//     not older than the file;
//   - files under the hashed dirs (Vite's assets/) are cached for a year, immutable; everything else is
//     revalidated (If-Modified-Since -> 304) so a deploy shows up on the next visit;
//   - byte ranges for uncompressed responses (audio / video seeking); path traversal and non-GET/HEAD refused.
import { createReadStream, statSync, type Stats } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";
import { MIME } from "./mime.ts";

export interface StaticOptions {
  /** Directory with the built site. */
  root: string;
  /**
   * URL path -> file path (relative to root). Keys ending in "/*" are prefix routes for SPA deep links. A trailing
   * slash on the request is ignored for matching ("/play/" matches "/play").
   */
  routes?: Record<string, string>;
  /** Root-relative dirs whose files have content hashes in their names (default ["assets"]). */
  hashed?: string[];
  /** Extra or overriding MIME types by extension (".ext": "type"). */
  types?: Record<string, string>;
  /** Headers added to every file response. */
  headers?: Record<string, string>;
  /** Root-relative file sent with status 404 when nothing matches (default: plain text). */
  notFound?: string;
}

export type Handler = (req: IncomingMessage, res: ServerResponse) => void;

function statFile(p: string): Stats | null {
  try {
    const st = statSync(p);
    return st.isFile() ? st : null;
  } catch {
    return null;
  }
}

export function createStaticHandler(opts: StaticOptions): Handler {
  const root = resolve(opts.root);
  const routes = opts.routes ?? {};
  const exact = new Map<string, string>();
  const prefixes: [string, string][] = [];
  for (const [k, v] of Object.entries(routes)) {
    if (k.endsWith("/*")) prefixes.push([k.slice(0, -1), v]);
    else exact.set(k.length > 1 ? k.replace(/\/+$/, "") : k, v);
  }
  prefixes.sort((a, b) => b[0].length - a[0].length);
  const hashedDirs = (opts.hashed ?? ["assets"]).map((d) => join(root, d) + sep);
  const types = { ...MIME, ...opts.types };

  /** A root-relative URL path to a file inside root, or null. */
  const inRoot = (rel: string): string | null => {
    if (rel.endsWith("/")) rel += "index.html";
    const file = normalize(join(root, rel));
    if (!file.startsWith(root + sep)) return null;
    if (statFile(file)) return file;
    try {
      if (statSync(file).isDirectory()) return inRoot(rel + "/");
    } catch {
      // missing
    }
    return null;
  };

  const resolveFile = (urlPath: string): string | null => {
    let rel: string;
    try {
      rel = decodeURIComponent(urlPath);
    } catch {
      return null;
    }
    if (rel.includes("\0")) return null;
    const key = rel.length > 1 ? rel.replace(/\/+$/, "") : rel;
    const routed = exact.get(key);
    if (routed !== undefined) return inRoot(routed);
    const real = inRoot(rel);
    if (real) return real;
    for (const [p, target] of prefixes) if (rel.startsWith(p)) return inRoot(target);
    return null;
  };

  return (req, res) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { Allow: "GET, HEAD" }).end();
      return;
    }
    const urlPath = (req.url ?? "/").split("?")[0].split("#")[0];
    const file = resolveFile(urlPath);
    if (!file) {
      const page = opts.notFound ? inRoot(opts.notFound) : null;
      if (page) return send(req, res, page, 404);
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8", ...opts.headers }).end("Not found");
      return;
    }
    send(req, res, file, 200);
  };

  function send(req: IncomingMessage, res: ServerResponse, file: string, status: number): void {
    const st = statFile(file);
    if (!st) {
      res.writeHead(404).end();
      return;
    }
    const hashed = hashedDirs.some((d) => file.startsWith(d));
    const cache = hashed ? "public, max-age=31536000, immutable" : "no-cache";
    if (status === 200 && !hashed) {
      const since = Date.parse(String(req.headers["if-modified-since"] ?? ""));
      if (since && Math.floor(st.mtimeMs / 1000) <= Math.floor(since / 1000)) {
        res.writeHead(304, { "Cache-Control": cache, "Last-Modified": st.mtime.toUTCString(), ...opts.headers }).end();
        return;
      }
    }
    const accept = String(req.headers["accept-encoding"] ?? "");
    let body = file;
    let size = st.size;
    let encoding: string | undefined;
    for (const [enc, ext] of [
      ["br", ".br"],
      ["gzip", ".gz"],
    ] as const) {
      if (!acceptsEncoding(accept, enc)) continue;
      const pst = statFile(file + ext);
      // A variant older than its file is stale (file rebuilt without re-running precompress): skip it.
      if (pst && pst.mtimeMs >= st.mtimeMs) {
        body = file + ext;
        size = pst.size;
        encoding = enc;
        break;
      }
    }
    const headers: Record<string, string | number> = {
      "Content-Type": types[extname(file).toLowerCase()] ?? "application/octet-stream",
      Vary: "Accept-Encoding",
      "Cache-Control": cache,
      "Last-Modified": st.mtime.toUTCString(),
      "X-Content-Type-Options": "nosniff",
      ...opts.headers,
    };
    if (encoding) headers["Content-Encoding"] = encoding;
    else headers["Accept-Ranges"] = "bytes";
    let start = 0;
    let end = size - 1;
    const range = !encoding && status === 200 ? parseRange(String(req.headers.range ?? ""), size) : null;
    if (range === "invalid") {
      res.writeHead(416, { "Content-Range": `bytes */${size}`, ...opts.headers }).end();
      return;
    }
    if (range) {
      [start, end] = range;
      status = 206;
      headers["Content-Range"] = `bytes ${start}-${end}/${size}`;
    }
    headers["Content-Length"] = size === 0 ? 0 : end - start + 1;
    res.writeHead(status, headers);
    if (req.method === "HEAD" || size === 0) {
      res.end();
      return;
    }
    createReadStream(body, { start, end })
      .on("error", () => res.destroy())
      .pipe(res);
  }
}

/** True if Accept-Encoding lists `enc` without q=0. */
export function acceptsEncoding(header: string, enc: string): boolean {
  for (const part of header.split(",")) {
    const [name, ...params] = part.trim().split(";");
    if (name.trim().toLowerCase() !== enc && name.trim() !== "*") continue;
    const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
    return !q || Number(q.slice(2)) > 0;
  }
  return false;
}

/** A single "bytes=a-b" range, null when absent / multi-range (send everything), "invalid" when unsatisfiable. */
function parseRange(h: string, size: number): [number, number] | null | "invalid" {
  const m = /^bytes=(\d*)-(\d*)$/.exec(h.trim());
  if (!m || (!m[1] && !m[2])) return null;
  let start: number;
  let end: number;
  if (!m[1]) {
    start = Math.max(0, size - Number(m[2]));
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  }
  if (start > end || start >= size) return "invalid";
  return [start, end];
}
