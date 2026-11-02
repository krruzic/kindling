#!/usr/bin/env -S node --experimental-transform-types --no-warnings
// CLI: kindling-precompress [dir=release]
import { precompress } from "../precompress.ts";

const dir = process.argv[2] ?? "release";
const s = precompress(dir);
console.log(
  `precompressed ${s.files} files in ${dir}: ${(s.before / 1e6).toFixed(1)} MB -> ${(s.after / 1e6).toFixed(1)} MB (brotli)`,
);
