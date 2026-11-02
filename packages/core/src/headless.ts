// Helpers for headless sharded runners (balance sims, evals, profiles): split a job list across SHARD/SHARDS
// processes, read typed config from env vars, and mutate game data from a MUT string for A/B runs without touching
// code. Pure (no node imports); pass `process.env` in node. The node side (JSONL files, launcher) is node/.
//
//   MUT="heroes.knight.hp=900; units.*.speed*=1.1; match.rules=[1,2]; bots.skill+=0.05"
//   - `path=value`  set (value parsed as JSON, else taken as a string)
//   - `path*=n`     multiply, `path+=n` add (numbers only)
//   - path segments split on "." with `[i]` for array indices; `*` matches every key / index at that level
//   - every path must already exist (strict): a typo must fail the run, not silently A/B nothing

export type Env = Record<string, string | undefined>;

function defaultEnv(): Env {
  const p = (globalThis as { process?: { env?: Env } }).process;
  return p?.env ?? {};
}

/** The items of `list` this shard runs: every SHARDS-th starting at SHARD (round-robin keeps shards balanced). */
export function shardOf<T>(list: readonly T[], shard: number, shards: number): T[] {
  if (!(shards >= 1) || !(shard >= 0) || shard >= shards || !Number.isInteger(shard) || !Number.isInteger(shards))
    throw new Error(`shardOf: bad shard ${shard}/${shards}`);
  return list.filter((_, i) => i % shards === shard);
}

/** SHARD and SHARDS from the environment (defaults 0 / 1), validated. */
export function shardEnv(env: Env = defaultEnv()): { shard: number; shards: number } {
  const shard = Number(env.SHARD ?? 0);
  const shards = Number(env.SHARDS ?? 1);
  if (!Number.isInteger(shard) || !Number.isInteger(shards) || shards < 1 || shard < 0 || shard >= shards)
    throw new Error(`bad SHARD=${env.SHARD} SHARDS=${env.SHARDS}`);
  return { shard, shards };
}

type EnvValue = number | string | boolean | string[];

/**
 * Typed env config from defaults: `envConfig({ GAMES: 20, FOCUS: "", HEROES: [] as string[], VERBOSE: false })`.
 * Numbers must parse, lists split on commas, booleans accept 1/0/true/false/yes/no.
 */
export function envConfig<T extends Record<string, EnvValue>>(defaults: T, env: Env = defaultEnv()): T {
  const out: Record<string, EnvValue> = { ...defaults };
  for (const [k, def] of Object.entries(defaults)) {
    const raw = env[k];
    if (raw === undefined || raw === "") continue;
    if (typeof def === "number") {
      const n = Number(raw);
      if (Number.isNaN(n)) throw new Error(`env ${k}=${raw}: not a number`);
      out[k] = n;
    } else if (typeof def === "boolean") {
      const v = raw.toLowerCase();
      if (["1", "true", "yes", "on"].includes(v)) out[k] = true;
      else if (["0", "false", "no", "off"].includes(v)) out[k] = false;
      else throw new Error(`env ${k}=${raw}: not a boolean`);
    } else if (Array.isArray(def))
      out[k] = raw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    else out[k] = raw;
  }
  return out as T;
}

export interface Mutation {
  path: string[];
  op: "=" | "*=" | "+=";
  value: unknown;
  /** The source text, for logs and result rows. */
  text: string;
}

function parsePath(p: string): string[] {
  const out: string[] = [];
  for (const part of p.split(".")) {
    const m = /^([^[\]]*)((?:\[[^\]]+\])*)$/.exec(part.trim());
    if (!m) throw new Error(`MUT: bad path segment "${part}"`);
    if (m[1]) out.push(m[1]);
    for (const idx of m[2].matchAll(/\[([^\]]+)\]/g)) out.push(idx[1]);
  }
  if (!out.length) throw new Error(`MUT: empty path`);
  return out;
}

function parseValue(v: string): unknown {
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
}

/** Parse a MUT string ("a.b=1;c*=1.2"); separators ";" or newlines. */
export function parseMut(mut: string | undefined): Mutation[] {
  if (!mut) return [];
  const out: Mutation[] = [];
  for (const raw of mut.split(/[;\n]/)) {
    const text = raw.trim();
    if (!text) continue;
    const m = /^(.+?)(\*=|\+=|=)(.*)$/.exec(text);
    if (!m) throw new Error(`MUT: "${text}" is not path=value`);
    const op = m[2] as Mutation["op"];
    const value = parseValue(m[3].trim());
    if (op !== "=" && typeof value !== "number") throw new Error(`MUT: "${text}": ${op} needs a number`);
    out.push({ path: parsePath(m[1]), op, value, text });
  }
  return out;
}

/**
 * Apply mutations to `data` in place (clone first if the base must survive) and return it. Throws if a path does
 * not exist or `*=` / `+=` hit a non-number. Returns how many leaves each mutation touched via `counts`.
 */
export function applyMut<T>(data: T, muts: readonly Mutation[] | string, counts?: number[]): T {
  const list = typeof muts === "string" ? parseMut(muts) : muts;
  for (const m of list) {
    let n = 0;
    const visit = (node: unknown, i: number): void => {
      if (node === null || typeof node !== "object")
        throw new Error(`MUT ${m.text}: "${m.path[i - 1]}" is not an object`);
      const o = node as Record<string, unknown>;
      const seg = m.path[i];
      const keys = seg === "*" ? Object.keys(o) : [seg];
      for (const k of keys) {
        if (!(k in o)) throw new Error(`MUT ${m.text}: no "${k}" at ${m.path.slice(0, i).join(".") || "<root>"}`);
        if (i < m.path.length - 1) {
          visit(o[k], i + 1);
          continue;
        }
        if (m.op === "=") o[k] = structuredClone(m.value);
        else {
          if (typeof o[k] !== "number") throw new Error(`MUT ${m.text}: ${k} is not a number`);
          o[k] = m.op === "*=" ? (o[k] as number) * (m.value as number) : (o[k] as number) + (m.value as number);
        }
        n++;
      }
    };
    visit(data, 0);
    counts?.push(n);
  }
  return data;
}
