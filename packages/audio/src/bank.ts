// Sample bank: sound ids with several variants each ("hit.0.ogg", "hit.1.ogg" -> id "hit"). load() decodes them
// a few at a time once the AudioContext exists (large ambience beds last), and pick() returns a random variant
// that isn't the one played last, so repeated hits don't machine-gun the same file.

export interface BankOpts {
  /** Parallel decodes (default 8). */
  concurrency?: number;
  /** Ids decoded last (big beds); default: ids starting with "bed.". */
  late?: (id: string) => boolean;
  /** Fetches and decodes one URL (tests / custom loaders). */
  fetchBuffer?: (ctx: BaseAudioContext, url: string) => Promise<AudioBuffer>;
  rng?: () => number;
}

/** Groups URLs into ids by stripping a trailing ".<n>.<ext>" (or ".<ext>") from the file name. */
export function groupVariants(urls: Record<string, string> | string[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const entries = Array.isArray(urls) ? urls.map((u) => [u, u] as const) : Object.entries(urls);
  for (const [path, url] of entries) {
    const name = path.slice(path.lastIndexOf("/") + 1);
    const id = name.replace(/(\.\d+)?\.[a-z0-9]+$/i, "");
    let l = out.get(id);
    if (!l) out.set(id, (l = []));
    l.push(url);
  }
  for (const l of out.values()) l.sort();
  return out;
}

const defaultFetch = async (ctx: BaseAudioContext, url: string) =>
  ctx.decodeAudioData(await (await fetch(url)).arrayBuffer());

export class SampleBank {
  private urls = new Map<string, string[]>();
  private bufs = new Map<string, AudioBuffer[]>();
  private last = new Map<string, number>();
  private queue: [string, string][] = [];
  private running = 0;
  private ctx: BaseAudioContext | null = null;
  /** Ids requested but never loaded (dev tooling: missing sounds). */
  readonly missing = new Map<string, number>();

  constructor(private o: BankOpts = {}) {}

  /** Registers variant URLs per id (see groupVariants for building this from a glob). */
  register(urls: Map<string, string[]> | Record<string, string[]>): void {
    const entries = urls instanceof Map ? [...urls] : Object.entries(urls);
    for (const [id, list] of entries) this.urls.set(id, [...(this.urls.get(id) ?? []), ...list]);
    if (this.ctx) this.enqueue(entries);
  }

  /** Adds an already-decoded buffer (synthesised sounds, tests). */
  add(id: string, buf: AudioBuffer): void {
    let l = this.bufs.get(id);
    if (!l) this.bufs.set(id, (l = []));
    l.push(buf);
  }

  /** Starts decoding every registered sample. */
  load(ctx: BaseAudioContext): Promise<void> {
    if (this.ctx) return this.idle();
    this.ctx = ctx;
    this.enqueue([...this.urls]);
    return this.idle();
  }

  private enqueue(entries: [string, string[]][]): void {
    const late = this.o.late ?? ((id: string) => id.startsWith("bed."));
    const jobs = entries.flatMap(([id, l]) => l.map((u) => [id, u] as [string, string]));
    jobs.sort((a, b) => Number(late(a[0])) - Number(late(b[0])));
    this.queue.push(...jobs);
    const n = this.o.concurrency ?? 8;
    while (this.running < n && this.queue.length) void this.next();
  }

  private waiters: (() => void)[] = [];

  private async next(): Promise<void> {
    const job = this.queue.shift();
    if (!job) {
      if (this.running === 0) for (const w of this.waiters.splice(0)) w();
      return;
    }
    this.running++;
    const [id, url] = job;
    try {
      this.add(id, await (this.o.fetchBuffer ?? defaultFetch)(this.ctx!, url));
    } catch {
      // A missing or undecodable file just leaves that variant out.
    }
    this.running--;
    return this.next();
  }

  /** Resolves when the queue has drained. */
  idle(): Promise<void> {
    if (!this.queue.length && this.running === 0) return Promise.resolve();
    return new Promise((r) => this.waiters.push(r));
  }

  has(id: string): boolean {
    return !!this.bufs.get(id)?.length;
  }

  ids(): string[] {
    return [...new Set([...this.urls.keys(), ...this.bufs.keys()])];
  }

  variants(id: string): number {
    return this.bufs.get(id)?.length ?? 0;
  }

  /** A random variant of `id`, never the same one twice in a row; null (and counted missing) if none. */
  pick(id: string): AudioBuffer | null {
    const l = this.bufs.get(id);
    if (!l?.length) {
      this.missing.set(id, (this.missing.get(id) ?? 0) + 1);
      return null;
    }
    if (l.length === 1) return l[0];
    const rng = this.o.rng ?? Math.random;
    let k = Math.floor(rng() * l.length);
    if (k === this.last.get(id)) k = (k + 1) % l.length;
    this.last.set(id, k);
    return l[k];
  }
}
