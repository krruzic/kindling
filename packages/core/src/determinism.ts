// Determinism harness (generalised from Grudge's tools/determinism.ts). A suite is a list of fixed seeded cases
// (typically CPU-vs-CPU matches) and a `run` that plays one and returns its final hash (and optionally section
// hashes). `runSuite` plays every case twice in the same process: a mismatch there means hidden state (module-level
// caches, Map iteration order over ids from a global counter, Math.random...), which would also desync peers.
// `compareBaseline` checks results against a committed baseline and explains every difference, naming the
// differing sections when both sides have them. The file / CLI side lives in node/determinism.ts.
import { diffSections, hex32 } from "./hash.ts";
import type { SectionHashes } from "./hash.ts";

export interface CaseResult {
  hash: number;
  sections?: Record<string, number>;
}

export interface DeterminismSuite<C> {
  cases: readonly C[];
  name: (c: C) => string;
  run: (c: C) => number | CaseResult | SectionHashes;
}

/** Baseline file contents: case name -> hash (Grudge's format) or { hash, sections }. */
export type Baseline = Record<string, number | CaseResult>;

/**
 * Define a determinism suite. Case names default to `c.name`, else a stable JSON of the case; names must be unique
 * (they key the baseline).
 */
export function defineDeterminismCases<C>(
  cases: readonly C[],
  run: (c: C) => number | CaseResult | SectionHashes,
  name: (c: C) => string = defaultName,
): DeterminismSuite<C> {
  const seen = new Set<string>();
  for (const c of cases) {
    const n = name(c);
    if (seen.has(n)) throw new Error(`determinism: duplicate case name "${n}"`);
    seen.add(n);
  }
  return { cases, run, name };
}

function defaultName(c: unknown): string {
  if (c && typeof c === "object" && typeof (c as { name?: unknown }).name === "string")
    return (c as { name: string }).name;
  return JSON.stringify(c);
}

function normalise(r: number | CaseResult | SectionHashes): CaseResult {
  if (typeof r === "number") return { hash: r >>> 0 };
  if ("total" in r) return { hash: r.total >>> 0, sections: r.sections };
  return r.sections ? { hash: r.hash >>> 0, sections: r.sections } : { hash: r.hash >>> 0 };
}

export interface HiddenState {
  name: string;
  first: CaseResult;
  again: CaseResult;
  sections: string[];
}

export interface SuiteRun {
  results: Record<string, CaseResult>;
  /** Cases whose repeat run in this process disagreed with the first. */
  hidden: HiddenState[];
  /** Cases that threw. */
  errors: { name: string; error: string }[];
}

/** Play every case `repeat` times (default 2) and collect results, hidden-state mismatches and errors. */
export function runSuite<C>(suite: DeterminismSuite<C>, opts: { repeat?: number; only?: string[] } = {}): SuiteRun {
  const repeat = Math.max(1, opts.repeat ?? 2);
  const out: SuiteRun = { results: {}, hidden: [], errors: [] };
  for (const c of suite.cases) {
    const name = suite.name(c);
    if (opts.only?.length && !opts.only.includes(name)) continue;
    try {
      const first = normalise(suite.run(c));
      out.results[name] = first;
      for (let i = 1; i < repeat; i++) {
        const again = normalise(suite.run(c));
        if (again.hash !== first.hash) {
          const sections = first.sections && again.sections ? diffSections(first.sections, again.sections) : [];
          out.hidden.push({ name, first, again, sections });
          break;
        }
      }
    } catch (e) {
      out.errors.push({ name, error: e instanceof Error ? (e.stack ?? e.message) : String(e) });
    }
  }
  return out;
}

export interface BaselineDiff {
  name: string;
  kind: "changed" | "new" | "missing";
  hash?: number;
  baseline?: number;
  sections: string[];
}

export interface Comparison {
  ok: boolean;
  diffs: BaselineDiff[];
  /** Human-readable report, one line per case plus explanations. */
  lines: string[];
}

function asResult(v: number | CaseResult | undefined): CaseResult | undefined {
  return v === undefined ? undefined : typeof v === "number" ? { hash: v >>> 0 } : v;
}

/** Compare a suite run to a baseline. Hidden state and errors always fail. */
export function compareBaseline(run: SuiteRun, baseline: Baseline): Comparison {
  const lines: string[] = [];
  const diffs: BaselineDiff[] = [];
  for (const [name, r] of Object.entries(run.results)) {
    const b = asResult(baseline[name]);
    if (!b) {
      diffs.push({ name, kind: "new", hash: r.hash, sections: [] });
      lines.push(`NEW  ${name} ${hex32(r.hash)} (not in baseline)`);
      continue;
    }
    if (b.hash === r.hash) {
      lines.push(`ok   ${name} ${hex32(r.hash)}`);
      continue;
    }
    const sections = b.sections && r.sections ? diffSections(b.sections, r.sections) : [];
    diffs.push({ name, kind: "changed", hash: r.hash, baseline: b.hash, sections });
    lines.push(
      `DIFF ${name} ${hex32(r.hash)} (baseline ${hex32(b.hash)})` +
        (sections.length ? ` sections: ${sections.join(", ")}` : ""),
    );
  }
  for (const name of Object.keys(baseline)) {
    if (name in run.results || run.errors.some((e) => e.name === name)) continue;
    diffs.push({ name, kind: "missing", baseline: asResult(baseline[name])!.hash, sections: [] });
    lines.push(`GONE ${name} (in baseline, not run)`);
  }
  for (const h of run.hidden)
    lines.push(
      `HIDDEN STATE ${h.name}: run 1 ${hex32(h.first.hash)}, run 2 ${hex32(h.again.hash)}` +
        (h.sections.length ? ` sections: ${h.sections.join(", ")}` : "") +
        " (same case, same process: something outside the sim's own state leaks in)",
    );
  for (const e of run.errors) lines.push(`ERROR ${e.name}: ${e.error}`);
  const ok = diffs.length === 0 && run.hidden.length === 0 && run.errors.length === 0;
  if (!ok && diffs.some((d) => d.kind === "changed"))
    lines.push("Sim results changed. If intended, rerun with --write and say so in the commit message.");
  return { ok, diffs, lines };
}

/** Baseline contents for a run (sections kept when the run has them). */
export function toBaseline(run: SuiteRun): Baseline {
  const out: Baseline = {};
  for (const [name, r] of Object.entries(run.results)) out[name] = r.sections ? r : r.hash;
  return out;
}
