// Where saves live: localStorage when it works (it can throw: private mode, disabled storage, quota, sandboxed
// iframes), else an in-memory map, which is also what node (tests, headless tools) gets.

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function memoryStorage(init: Record<string, string> = {}): StorageLike & { dump(): Record<string, string> } {
  const m = new Map(Object.entries(init));
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, String(v)),
    removeItem: (k) => void m.delete(k),
    dump: () => Object.fromEntries(m),
  };
}

/** localStorage if it is present and writable, else a fresh memory store. */
export function defaultStorage(): StorageLike {
  try {
    const ls = (globalThis as { localStorage?: StorageLike }).localStorage;
    if (ls) {
      const probe = "__kindling_probe__";
      ls.setItem(probe, "1");
      ls.removeItem(probe);
      return ls;
    }
  } catch {
    // unusable: fall through
  }
  return memoryStorage();
}
