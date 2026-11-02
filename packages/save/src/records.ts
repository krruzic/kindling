// Records tables: wins / losses / draws per key (a player name id, a character, a map) plus personal bests per
// stat (fastest clear, most kills), over a plain object inside the save's data. And a capped recent-match log.

export interface Record3 {
  w: number;
  l: number;
  d: number;
}

export interface RecordEntry extends Record3 {
  /** Best value per stat. */
  best?: Record<string, number>;
}

export type Outcome = "w" | "l" | "d";

export function emptyRecord(): RecordEntry {
  return { w: 0, l: 0, d: 0 };
}

export function games(r: Record3): number {
  return r.w + r.l + r.d;
}

/** Wins / games, or null with no games. */
export function winRate(r: Record3): number | null {
  const n = games(r);
  return n ? r.w / n : null;
}

/** "63%" or "-". */
export function winRateText(r: Record3): string {
  const v = winRate(r);
  return v === null ? "-" : `${Math.round(v * 100)}%`;
}

/** Outcome for a side given the winning side (-1 = draw). */
export function outcomeOf(winner: number, side: number): Outcome {
  return winner < 0 ? "d" : winner === side ? "w" : "l";
}

export class RecordsTable {
  constructor(
    private readonly table: () => Record<string, RecordEntry>,
    private readonly onChange?: () => void,
  ) {}

  /** The entry for `key` (a zeroed one, not stored, if absent). */
  get(key: string): RecordEntry {
    return this.table()[key] ?? emptyRecord();
  }

  keys(): string[] {
    return Object.keys(this.table());
  }

  private entry(key: string): RecordEntry {
    return (this.table()[key] ??= emptyRecord());
  }

  /** Count one result. */
  result(key: string, outcome: Outcome): void {
    this.entry(key)[outcome]++;
    this.onChange?.();
  }

  /** Offer a value for a best; true if it is a new best ("max": higher is better, "min": lower). */
  best(key: string, stat: string, value: number, better: "max" | "min" = "max"): boolean {
    const e = this.entry(key);
    const cur = e.best?.[stat];
    if (cur !== undefined && (better === "max" ? value <= cur : value >= cur)) return false;
    (e.best ??= {})[stat] = value;
    this.onChange?.();
    return true;
  }

  /** Keys sorted by win rate (then games), with at least `minGames`. */
  ranked(minGames = 1): { key: string; entry: RecordEntry; rate: number }[] {
    return Object.entries(this.table())
      .filter(([, e]) => games(e) >= minGames)
      .map(([key, entry]) => ({ key, entry, rate: winRate(entry) ?? 0 }))
      .sort((a, b) => b.rate - a.rate || games(b.entry) - games(a.entry) || a.key.localeCompare(b.key));
  }

  /** Zero every result and best (keys stay). */
  clear(): void {
    for (const e of Object.values(this.table())) {
      e.w = e.l = e.d = 0;
      delete e.best;
    }
    this.onChange?.();
  }
}

/** Newest-first log capped at `max` entries (in place). */
export function pushLog<T>(log: T[], entry: T, max: number): T[] {
  log.unshift(entry);
  if (log.length > max) log.length = max;
  return log;
}
