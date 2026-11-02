// Signed player names ("tags") kept by id, so renaming or two names that clean to the same text never mixes up
// records. Most recently used first, as name pickers want. Works over a plain object inside the save's data, so it
// serialises with it; `onChange` is usually `() => store.write()`.

export interface NameEntry {
  name: string;
  /** Last use, ms since epoch. */
  last: number;
}

export interface NameRef {
  id: string;
  name: string;
}

export interface CleanNameOptions {
  /** Max length (default 8). */
  max?: number;
  /** Uppercase first (default true). */
  upper?: boolean;
  /** Characters to strip (default: anything but A-Z, 0-9 and '-'). */
  strip?: RegExp;
}

export function cleanName(name: string, opts: CleanNameOptions = {}): string {
  let n = name.trim();
  if (opts.upper ?? true) n = n.toUpperCase();
  return n.replace(opts.strip ?? /[^A-Z0-9-]/g, "").slice(0, opts.max ?? 8);
}

/** RFC 4122 v4 id (crypto.randomUUID where available). */
export function newId(): string {
  const c = globalThis.crypto;
  if (typeof c?.randomUUID === "function") return c.randomUUID();
  const b = c.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export interface NameBookOptions<E extends NameEntry> {
  /** A new entry for a name (stats zeroed). */
  make: (name: string) => Omit<E, "name" | "last"> & Partial<NameEntry>;
  clean?: (name: string) => string;
  now?: () => number;
  id?: () => string;
  onChange?: () => void;
}

export class NameBook<E extends NameEntry> {
  private readonly clean: (name: string) => string;
  private readonly now: () => number;
  private readonly id: () => string;

  constructor(
    private readonly table: () => Record<string, E>,
    private readonly opts: NameBookOptions<E>,
  ) {
    this.clean = opts.clean ?? ((n) => cleanName(n));
    this.now = opts.now ?? Date.now;
    this.id = opts.id ?? newId;
  }

  /** Ids, most recently used first. */
  ids(): string[] {
    return Object.entries(this.table())
      .sort((a, b) => b[1].last - a[1].last || a[1].name.localeCompare(b[1].name))
      .map(([k]) => k);
  }

  names(): string[] {
    const t = this.table();
    return this.ids().map((k) => t[k].name);
  }

  get(id: string): E | undefined {
    return this.table()[id];
  }

  find(name: string): NameRef | null {
    const n = this.clean(name);
    const e = Object.entries(this.table()).find(([, t]) => t.name === n);
    return e ? { id: e[0], name: n } : null;
  }

  /** Add (or reuse) a name and mark it used. Null if it cleans to nothing. */
  add(name: string): NameRef | null {
    const n = this.clean(name);
    if (!n) return null;
    const ref = this.find(n) ?? { id: this.id(), name: n };
    const t = this.table();
    t[ref.id] ??= { ...this.opts.make(n), name: n, last: 0 } as E;
    this.use(ref.id);
    return ref;
  }

  use(id: string): void {
    const e = this.table()[id];
    if (!e) return;
    e.last = this.now();
    this.opts.onChange?.();
  }

  /** Rename keeping the id and its records. False if the new name is empty or taken by another id. */
  rename(id: string, name: string): boolean {
    const n = this.clean(name);
    const e = this.table()[id];
    const other = this.find(n);
    if (!e || !n || (other && other.id !== id)) return false;
    e.name = n;
    this.opts.onChange?.();
    return true;
  }

  remove(id: string): void {
    delete this.table()[id];
    this.opts.onChange?.();
  }
}
