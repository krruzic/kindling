// Versioned save store (Grudge's src/game/save.ts, generalised). One JSON document under one storage key:
//   - `defaults()` is the full shape; loading deep-fills anything missing (a new option appears with its default,
//     old saves keep working), and a stored value of the wrong type falls back to the default.
//   - `migrations[n]` upgrades a version n-1 payload to version n; they run in order on load, then the upgraded save
//     is written back.
//   - A corrupt save, or one from a NEWER build (a downgrade), is backed up under `<key>.bak` before anything can
//     overwrite it; the newer one is still loaded best-effort.
//   - `sanitize` runs last (snap options to valid values, drop broken entries).
// Stored as { v, data } by default; `format: "flat"` stores { v, ...data } like Grudge did, so an existing
// localStorage save can be adopted as is.
import { defaultStorage, type StorageLike } from "./storage.ts";

export interface SaveSchema<T extends object> {
  key: string;
  version: number;
  defaults: () => T;
  /** migrations[n](payloadAtVersionNMinus1) -> payload at version n. */
  migrations?: Record<number, (data: any) => any>;
  sanitize?: (data: T, defaults: T) => T | void;
  format?: "envelope" | "flat";
}

export interface LoadInfo {
  /** Version found in storage (null: nothing stored). */
  from: number | null;
  migrated: boolean;
  /** Why the stored data was not (fully) used. */
  problem: "corrupt" | "future" | null;
}

function isPlain(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * Fill `stored` with `defaults`: missing keys and type mismatches take the default; plain objects recurse; keys only
 * in `stored` are kept (dynamic tables such as records keyed by name).
 */
export function fillDefaults<T>(defaults: T, stored: unknown): T {
  if (isPlain(defaults)) {
    if (!isPlain(stored)) return structuredClone(defaults);
    const out: Record<string, unknown> = { ...stored };
    for (const [k, d] of Object.entries(defaults))
      out[k] = k in stored ? fillDefaults(d, stored[k]) : structuredClone(d);
    return out as T;
  }
  if (Array.isArray(defaults)) return (Array.isArray(stored) ? stored : structuredClone(defaults)) as T;
  if (defaults === null || defaults === undefined) return (stored ?? defaults) as T;
  return (typeof stored === typeof defaults ? stored : defaults) as T;
}

export class SaveStore<T extends object> {
  data: T;
  info: LoadInfo = { from: null, migrated: false, problem: null };
  readonly storage: StorageLike;

  constructor(
    readonly schema: SaveSchema<T>,
    storage?: StorageLike,
  ) {
    this.storage = storage ?? defaultStorage();
    this.data = this.load();
  }

  /** (Re)read from storage. */
  load(): T {
    const raw = this.read();
    this.info = { from: null, migrated: false, problem: null };
    if (raw === null) return (this.data = this.fresh());
    const parsed = this.decode(raw);
    if (!parsed) {
      this.backup(raw);
      this.info.problem = "corrupt";
      return (this.data = this.fresh());
    }
    this.data = this.upgrade(parsed.v, parsed.data, raw);
    if (this.info.migrated) this.write();
    return this.data;
  }

  /** Persist. False if storage refused (quota, disabled). */
  write(): boolean {
    try {
      this.storage.setItem(this.schema.key, this.encode());
      return true;
    } catch {
      return false;
    }
  }

  /** Mutate and write. */
  update(fn: (d: T) => void): void {
    fn(this.data);
    this.write();
  }

  /** Back to defaults (written). */
  reset(): void {
    this.data = this.fresh();
    this.write();
  }

  /** The save as a JSON string (a backup file the player can keep). */
  export(): string {
    return JSON.stringify({ key: this.schema.key, v: this.schema.version, data: this.data }, null, 2);
  }

  /** Replace the save from an export (older versions are migrated). Nothing changes on error. */
  import(json: string): { ok: true } | { ok: false; error: string } {
    let p: unknown;
    try {
      p = JSON.parse(json);
    } catch (e) {
      return { ok: false, error: `not JSON: ${e instanceof Error ? e.message : e}` };
    }
    if (!isPlain(p) || typeof p.v !== "number" || !("data" in p)) return { ok: false, error: "not a save export" };
    if (p.key !== undefined && p.key !== this.schema.key) return { ok: false, error: `save is for "${p.key}"` };
    if (p.v > this.schema.version) return { ok: false, error: `save is from a newer version (${p.v})` };
    try {
      const prevInfo = this.info;
      const next = this.upgrade(p.v, p.data, json);
      this.info = prevInfo;
      this.data = next;
    } catch (e) {
      return { ok: false, error: `migration failed: ${e instanceof Error ? e.message : e}` };
    }
    this.write();
    return { ok: true };
  }

  private fresh(): T {
    const d = this.schema.defaults();
    return this.schema.sanitize?.(d, this.schema.defaults()) ?? d;
  }

  private read(): string | null {
    try {
      return this.storage.getItem(this.schema.key);
    } catch {
      return null;
    }
  }

  private backup(raw: string): void {
    try {
      this.storage.setItem(this.schema.key + ".bak", raw);
    } catch {
      // nothing more we can do
    }
  }

  private encode(): string {
    const v = this.schema.version;
    return JSON.stringify(this.schema.format === "flat" ? { ...this.data, v } : { v, data: this.data });
  }

  private decode(raw: string): { v: number; data: unknown } | null {
    let p: unknown;
    try {
      p = JSON.parse(raw);
    } catch {
      return null;
    }
    if (!isPlain(p)) return null;
    const v = typeof p.v === "number" ? p.v : 0;
    if (this.schema.format === "flat") {
      const { v: _v, ...data } = p;
      return { v, data };
    }
    return "data" in p ? { v, data: p.data } : null;
  }

  private upgrade(v: number, data: unknown, raw: string): T {
    const target = this.schema.version;
    this.info.from = v;
    if (v > target) {
      this.backup(raw);
      this.info.problem = "future";
    } else
      for (let n = v + 1; n <= target; n++) {
        const m = this.schema.migrations?.[n];
        if (m) data = m(data);
        this.info.migrated = true;
      }
    const defaults = this.schema.defaults();
    const filled = fillDefaults(defaults, data);
    return this.schema.sanitize?.(filled, this.schema.defaults()) ?? filled;
  }
}
