// fal.ai queue client (from Grudge's tools/gen-*.mjs). submit -> poll status -> fetch result, with the key from
// the environment or a .env file, and every call appended to a calls.log (time, model, label, estimated cost,
// request id, duration) so spend is always accountable. fetch and sleep are injectable: tests drive it with a
// mocked fetch and never touch the network or spend credit.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";

/**
 * Loads KEY=value lines from the first .env found in `dir` or its parents into process.env (existing variables
 * win). Returns the file read, or null.
 */
export function loadEnv(dir = process.cwd()): string | null {
  let d = resolve(dir);
  for (;;) {
    const f = join(d, ".env");
    if (existsSync(f)) {
      for (const line of readFileSync(f, "utf8").split("\n")) {
        const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
        if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
      }
      return f;
    }
    const up = dirname(d);
    if (up === d) return null;
    d = up;
  }
}

/**
 * Estimated USD per call by model (fal list prices when these tools were written; check fal.ai/pricing). A
 * function gets the input (e.g. per-second audio). Unknown models log "$?".
 */
export const FAL_COSTS: Record<string, number | ((input: Record<string, unknown>) => number)> = {
  "fal-ai/nano-banana-pro": (i) => (i.resolution === "4K" ? 0.3 : 0.15),
  "fal-ai/nano-banana-pro/edit": (i) => (i.resolution === "4K" ? 0.3 : 0.15),
  "fal-ai/nano-banana": 0.039,
  "fal-ai/nano-banana/edit": 0.039,
  "tripo3d/p1/image-to-3d": 0.3,
  "tripo3d/tripo/v2.5/image-to-3d": 0.3,
  "fal-ai/elevenlabs/sound-effects/v2": (i) => Number(i.duration_seconds ?? 5) * 0.002,
};

export interface FalOptions {
  /** API key (default: FAL_KEY from the environment, after loadEnv()). */
  key?: string;
  /** Where calls are logged (default: no log). */
  logFile?: string;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  pollMs?: number;
  /** Give up after this long in the queue (default 15 min). */
  timeoutMs?: number;
  baseUrl?: string;
  costs?: typeof FAL_COSTS;
  /** Progress lines (default: none). */
  log?: (msg: string) => void;
  /** Clock for the log/durations (tests). */
  now?: () => number;
}

export interface FalResult<T> {
  data: T;
  requestId: string;
  model: string;
  /** Estimated cost in USD (NaN when the model has no estimate). */
  cost: number;
  ms: number;
}

export class FalError extends Error {
  constructor(
    msg: string,
    readonly status?: number,
    readonly body?: unknown,
  ) {
    super(msg);
  }
}

export class FalClient {
  readonly key: string;
  private f: typeof fetch;
  private sleep: (ms: number) => Promise<void>;
  private now: () => number;

  constructor(private o: FalOptions = {}) {
    const key = o.key ?? process.env.FAL_KEY;
    if (!key) throw new FalError("FAL_KEY missing (set it in the environment or a .env file)");
    this.key = key;
    this.f = o.fetch ?? fetch;
    this.sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.now = o.now ?? Date.now;
  }

  private headers(json = false): Record<string, string> {
    const h: Record<string, string> = { Authorization: `Key ${this.key}` };
    if (json) h["Content-Type"] = "application/json";
    return h;
  }

  /** Estimated cost of one call (NaN if unknown). */
  estimate(model: string, input: Record<string, unknown>): number {
    const c = (this.o.costs ?? FAL_COSTS)[model];
    return c === undefined ? NaN : typeof c === "number" ? c : c(input);
  }

  /** Submits to the queue, polls until done, returns the result; logs the call. */
  async run<T = Record<string, unknown>>(
    model: string,
    input: Record<string, unknown>,
    label = "",
  ): Promise<FalResult<T>> {
    const t0 = this.now();
    const base = this.o.baseUrl ?? "https://queue.fal.run";
    const sub = await this.f(`${base}/${model}`, {
      method: "POST",
      headers: this.headers(true),
      body: JSON.stringify(input),
    });
    if (!sub.ok) throw new FalError(`${model} submit ${sub.status}: ${await sub.text()}`, sub.status);
    const q = (await sub.json()) as { request_id: string; status_url: string; response_url: string };
    this.o.log?.(`${model} ${q.request_id} queued`);
    const deadline = t0 + (this.o.timeoutMs ?? 15 * 60_000);
    for (;;) {
      await this.sleep(this.o.pollMs ?? 3000);
      const r = await this.f(q.status_url, { headers: this.headers() });
      const st = (await r.json()) as { status?: string };
      if (st.status === "COMPLETED") break;
      if (st.status && !["IN_QUEUE", "IN_PROGRESS"].includes(st.status))
        throw new FalError(`${model} status ${JSON.stringify(st)}`, r.status, st);
      if (this.now() > deadline) throw new FalError(`${model} ${q.request_id} timed out`);
    }
    const res = await this.f(q.response_url, { headers: this.headers() });
    const data = (await res.json()) as T;
    if (!res.ok) throw new FalError(`${model} result ${res.status}: ${JSON.stringify(data)}`, res.status, data);
    const ms = this.now() - t0;
    const cost = this.estimate(model, input);
    if (this.o.logFile) {
      mkdirSync(dirname(this.o.logFile), { recursive: true });
      appendFileSync(
        this.o.logFile,
        logLine({ at: new Date(t0).toISOString(), model, label, cost, id: q.request_id, ms }),
      );
    }
    this.o.log?.(`${model} ${q.request_id} done in ${(ms / 1000).toFixed(1)} s (~$${cost.toFixed(3)})`);
    return { data, requestId: q.request_id, model, cost, ms };
  }

  /** Downloads a result URL (fal CDN, or a data: URI) to a file; returns the path. */
  async download(url: string, file: string): Promise<string> {
    mkdirSync(dirname(file), { recursive: true });
    const r = await this.f(url);
    if (!r.ok) throw new FalError(`download ${url} ${r.status}`, r.status);
    writeFileSync(file, Buffer.from(await r.arrayBuffer()));
    return file;
  }
}

export interface CallLogEntry {
  at: string;
  model: string;
  label: string;
  cost: number;
  id: string;
  ms: number;
}

/** "ISO model label $cost id=... ms=..." (Grudge's calls.log shape plus id and duration). */
export function logLine(e: CallLogEntry): string {
  const cost = Number.isFinite(e.cost) ? `$${e.cost.toFixed(3)}` : "$?";
  return `${e.at} ${e.model} ${e.label || "-"} ${cost} id=${e.id} ms=${Math.round(e.ms)}\n`;
}

/** Parses a calls.log (also Grudge's older "ISO model res label $cost" lines). */
export function readCallLog(file: string): { entries: CallLogEntry[]; total: number; byModel: Record<string, number> } {
  const entries: CallLogEntry[] = [];
  if (existsSync(file))
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 3) continue;
      const costTok = parts.find((p) => p.startsWith("$")) ?? "$?";
      const id = parts.find((p) => p.startsWith("id="))?.slice(3) ?? "";
      const ms = Number(parts.find((p) => p.startsWith("ms="))?.slice(3) ?? 0);
      const ci = parts.indexOf(costTok);
      entries.push({
        at: parts[0],
        model: parts[1],
        label: parts.slice(2, ci < 0 ? undefined : ci).join(" "),
        cost: costTok === "$?" ? NaN : Number(costTok.slice(1)),
        id,
        ms,
      });
    }
  const byModel: Record<string, number> = {};
  let total = 0;
  for (const e of entries)
    if (Number.isFinite(e.cost)) {
      total += e.cost;
      byModel[e.model] = (byModel[e.model] ?? 0) + e.cost;
    }
  return { entries, total, byModel };
}

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".glb": "model/gltf-binary",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
};

/** A local file as a data: URI (fal accepts them wherever it takes an image URL); URLs pass through. */
export function asUrl(pathOrUrl: string): string {
  if (/^(https?:|data:)/.test(pathOrUrl)) return pathOrUrl;
  const type = MIME[extname(pathOrUrl).toLowerCase()] ?? "application/octet-stream";
  return `data:${type};base64,${readFileSync(pathOrUrl).toString("base64")}`;
}
