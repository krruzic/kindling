// JSON Lines for headless results: one row per game, appended synchronously so a killed shard keeps every finished
// game, and read back across all shard files for the report. Rows are plain JSON (no Infinity/NaN: they become null).
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export interface JsonlWriter {
  write(row: unknown): void;
  readonly path: string | null;
  rows: number;
}

/** Writer to `path` (created / truncated unless `append`), or stdout when path is null/"-". */
export function jsonlWriter(path: string | null, opts: { append?: boolean } = {}): JsonlWriter {
  const file = path && path !== "-" ? path : null;
  if (file) {
    mkdirSync(dirname(file), { recursive: true });
    if (!opts.append || !existsSync(file)) writeFileSync(file, "");
  }
  const w: JsonlWriter = {
    path: file,
    rows: 0,
    write(row) {
      const line = JSON.stringify(row) + "\n";
      if (file) appendFileSync(file, line);
      else process.stdout.write(line);
      w.rows++;
    },
  };
  return w;
}

/** Rows of one .jsonl file; a torn last line (shard killed mid-write) is skipped, other bad lines throw. */
export function readJsonl<T = unknown>(path: string): T[] {
  const lines = readFileSync(path, "utf8").split("\n");
  const out: T[] = [];
  lines.forEach((l, i) => {
    if (!l.trim()) return;
    try {
      out.push(JSON.parse(l) as T);
    } catch (e) {
      if (i < lines.length - 1 && lines.slice(i + 1).some((x) => x.trim())) throw new Error(`${path}:${i + 1}: ${e}`);
    }
  });
  return out;
}

/** Rows of every *.jsonl in a directory (sorted by file name), or of each listed file. */
export function readJsonlAll<T = unknown>(dirOrFiles: string | readonly string[]): T[] {
  const files =
    typeof dirOrFiles === "string"
      ? readdirSync(dirOrFiles)
          .filter((f) => f.endsWith(".jsonl"))
          .sort()
          .map((f) => join(dirOrFiles, f))
      : dirOrFiles;
  return files.flatMap((f) => readJsonl<T>(f));
}
