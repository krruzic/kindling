// Precompress a built site for the static server: next to every compressible file (code, JSON, fonts, 3D models -
// .glb is mostly raw vertex data; Grudge's 15.9 MB map brotlied to 4.7 MB) write <file>.br and <file>.gz, kept only
// when they save at least 5%. Images and audio are already compressed and are left alone. A variant that no longer
// pays off is deleted so a stale one can't be served.
import { readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";

export const COMPRESSIBLE = [
  ".js",
  ".mjs",
  ".css",
  ".html",
  ".json",
  ".map",
  ".glb",
  ".gltf",
  ".bin",
  ".ttf",
  ".otf",
  ".svg",
  ".wasm",
  ".txt",
  ".xml",
  ".webmanifest",
];

export interface PrecompressOptions {
  extensions?: readonly string[];
  /** Skip files smaller than this (default 1024 bytes). */
  minSize?: number;
  /** Keep a variant only if variant / original is below this (default 0.95). */
  maxRatio?: number;
  /** Brotli quality 0-11 (default 9: 11 is much slower for little gain on big models). */
  brotliQuality?: number;
}

export interface PrecompressStats {
  files: number;
  before: number;
  /** Bytes served to a brotli-capable browser afterwards. */
  after: number;
}

export function precompress(dir: string, opts: PrecompressOptions = {}): PrecompressStats {
  const exts = new Set((opts.extensions ?? COMPRESSIBLE).map((e) => e.toLowerCase()));
  const minSize = opts.minSize ?? 1024;
  const maxRatio = opts.maxRatio ?? 0.95;
  const stats: PrecompressStats = { files: 0, before: 0, after: 0 };
  const keep = (path: string, data: Buffer, original: number): number => {
    if (data.length < original * maxRatio) {
      writeFileSync(path, data);
      return data.length;
    }
    rmSync(path, { force: true });
    return original;
  };
  const walk = (d: string): void => {
    for (const name of readdirSync(d).sort()) {
      const p = join(d, name);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else if (exts.has(extname(name).toLowerCase()) && st.size >= minSize) {
        const buf = readFileSync(p);
        const br = brotliCompressSync(buf, {
          params: {
            [constants.BROTLI_PARAM_QUALITY]: opts.brotliQuality ?? 9,
            [constants.BROTLI_PARAM_SIZE_HINT]: buf.length,
          },
        });
        stats.after += keep(p + ".br", br, buf.length);
        keep(p + ".gz", gzipSync(buf, { level: 9 }), buf.length);
        stats.before += buf.length;
        stats.files++;
      }
    }
  };
  walk(dir);
  return stats;
}
