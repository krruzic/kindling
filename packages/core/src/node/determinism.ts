// CLI side of the determinism harness: run a suite, compare with / write the committed JSON baseline, print the
// report. A game's tools/determinism.ts is then just its cases:
//   const suite = defineDeterminismCases(CASES, (c) => { const w = new World(c.seed); ...; return w.sections(); });
//   process.exitCode = runDeterminism(suite, { baselinePath: "tools/determinism.baseline.json" }).code;
// Mode comes from argv: --check (compare; exit 1 on any difference), --write (rewrite the baseline; only for
// intended sim changes, refused while hidden state is detected), neither (print the hashes).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { compareBaseline, runSuite, toBaseline } from "../determinism.ts";
import type { Baseline, Comparison, DeterminismSuite, SuiteRun } from "../determinism.ts";

export interface RunDeterminismOptions {
  baselinePath: string;
  /** Default: from argv (--check / --write), else "print". */
  mode?: "check" | "write" | "print";
  argv?: readonly string[];
  /** Runs per case in-process (default 2: hidden-state detection). */
  repeat?: number;
  /** Only these case names (--only=a,b on the command line). */
  only?: string[];
  log?: (line: string) => void;
}

export interface DeterminismOutcome {
  code: 0 | 1;
  run: SuiteRun;
  comparison: Comparison;
}

export function readBaseline(path: string): Baseline {
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as Baseline) : {};
}

export function runDeterminism<C>(suite: DeterminismSuite<C>, opts: RunDeterminismOptions): DeterminismOutcome {
  const argv = opts.argv ?? process.argv.slice(2);
  const mode = opts.mode ?? (argv.includes("--write") ? "write" : argv.includes("--check") ? "check" : "print");
  const onlyArg = argv.find((a) => a.startsWith("--only="));
  const only = opts.only ?? (onlyArg ? onlyArg.slice(7).split(",") : undefined);
  const log = opts.log ?? ((l: string) => console.log(l));
  const run = runSuite(suite, { repeat: opts.repeat, only });
  const comparison = compareBaseline(run, readBaseline(opts.baselinePath));
  for (const l of comparison.lines) log(l);
  if (mode === "write") {
    if (run.hidden.length || run.errors.length) {
      log("Refusing to write the baseline: fix hidden state / errors first.");
      return { code: 1, run, comparison };
    }
    const base = only ? { ...readBaseline(opts.baselinePath), ...toBaseline(run) } : toBaseline(run);
    writeFileSync(opts.baselinePath, JSON.stringify(base, null, 2) + "\n");
    log(`wrote ${opts.baselinePath} (${Object.keys(run.results).length} cases)`);
    return { code: 0, run, comparison };
  }
  if (mode === "check") return { code: comparison.ok ? 0 : 1, run, comparison };
  // print: still fail on hidden state or errors, which are bugs whatever the baseline says
  return { code: run.hidden.length || run.errors.length ? 1 : 0, run, comparison };
}
