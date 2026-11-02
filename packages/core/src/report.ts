// Balance-report helpers over game result rows (from headless runs, usually read back from JSONL shards): per-entity
// win rates with a 95% interval, matchup grids, distributions (game length...), tallies (how games ended) and plain
// text tables. A row only needs `sides` (the entities on each side, e.g. heroes per team) and `winner` (side index,
// -1 for a draw); anything else on the row is yours to tally.

export interface GameRow {
  sides: readonly (readonly string[])[];
  /** Winning side index, or -1 for a draw. */
  winner: number;
}

export interface WinRate {
  name: string;
  games: number;
  wins: number;
  losses: number;
  draws: number;
  /** Wins / games (draws count as games, not wins). */
  rate: number;
  /** Half-width of the 95% normal-approximation interval on `rate`. */
  ci95: number;
}

function wr(name: string, w: number, l: number, d: number): WinRate {
  const games = w + l + d;
  const rate = games ? w / games : 0;
  return {
    name,
    games,
    wins: w,
    losses: l,
    draws: d,
    rate,
    ci95: games ? 1.96 * Math.sqrt((rate * (1 - rate)) / games) : 0,
  };
}

/**
 * Win rate per entity, sorted best first. An entity appearing twice on one side (mirror partners) counts once per
 * game for that side; mirror matches (on both sides) are skipped for that entity since they say nothing.
 */
export function winRates(rows: readonly GameRow[]): WinRate[] {
  const acc = new Map<string, [number, number, number]>();
  for (const r of rows) {
    const sidesOf = new Map<string, Set<number>>();
    r.sides.forEach((side, s) => {
      for (const e of side) {
        let set = sidesOf.get(e);
        if (!set) sidesOf.set(e, (set = new Set()));
        set.add(s);
      }
    });
    for (const [e, set] of sidesOf) {
      if (set.size !== 1) continue;
      const s = [...set][0];
      const a = acc.get(e) ?? [0, 0, 0];
      a[r.winner < 0 ? 2 : r.winner === s ? 0 : 1]++;
      acc.set(e, a);
    }
  }
  return [...acc]
    .map(([n, [w, l, d]]) => wr(n, w, l, d))
    .sort((a, b) => b.rate - a.rate || a.name.localeCompare(b.name));
}

export interface MatchupGrid {
  names: string[];
  /** cell[a][b]: games where a was on a side facing b. */
  cell: Record<string, Record<string, WinRate>>;
}

/** Win rate of each entity against each opposing entity (a vs b counts every game they were on opposite sides). */
export function matchupGrid(rows: readonly GameRow[]): MatchupGrid {
  const acc = new Map<string, Map<string, [number, number, number]>>();
  const names = new Set<string>();
  for (const r of rows) {
    r.sides.forEach((side, s) => {
      const mine = new Set(side);
      const foes = new Set<string>();
      r.sides.forEach((o, t) => {
        if (t !== s) for (const e of o) foes.add(e);
      });
      for (const a of mine) {
        names.add(a);
        for (const b of foes) {
          if (a === b) continue;
          let row = acc.get(a);
          if (!row) acc.set(a, (row = new Map()));
          const c = row.get(b) ?? [0, 0, 0];
          c[r.winner < 0 ? 2 : r.winner === s ? 0 : 1]++;
          row.set(b, c);
        }
      }
    });
  }
  const sorted = [...names].sort();
  const cell: MatchupGrid["cell"] = {};
  for (const a of sorted) {
    cell[a] = {};
    for (const [b, [w, l, d]] of acc.get(a) ?? []) cell[a][b] = wr(b, w, l, d);
  }
  return { names: sorted, cell };
}

export interface Distribution {
  n: number;
  mean: number;
  min: number;
  max: number;
  p10: number;
  p50: number;
  p90: number;
  /** Counts per bin of width `bin` starting at `binStart`. */
  hist: number[];
  bin: number;
  binStart: number;
}

/** Percentile (0..100) of an already-sorted array, linear interpolation. */
export function percentileSorted(sorted: readonly number[], p: number): number {
  if (!sorted.length) return NaN;
  const x = (Math.min(100, Math.max(0, p)) / 100) * (sorted.length - 1);
  const i = Math.floor(x);
  const f = x - i;
  return i + 1 < sorted.length ? sorted[i] * (1 - f) + sorted[i + 1] * f : sorted[i];
}

export function distribution(values: readonly number[], bins = 10): Distribution {
  const s = [...values].sort((a, b) => a - b);
  const n = s.length;
  const min = n ? s[0] : NaN;
  const max = n ? s[n - 1] : NaN;
  const bin = n && max > min ? (max - min) / bins : 1;
  const hist = new Array<number>(n ? bins : 0).fill(0);
  for (const v of s) hist[Math.min(bins - 1, Math.floor((v - min) / bin))]++;
  return {
    n,
    mean: n ? s.reduce((a, b) => a + b, 0) / n : NaN,
    min,
    max,
    p10: percentileSorted(s, 10),
    p50: percentileSorted(s, 50),
    p90: percentileSorted(s, 90),
    hist,
    bin,
    binStart: min,
  };
}

/** Count rows by a key (e.g. end reason), with shares, most common first. */
export function tally<R>(rows: readonly R[], key: (r: R) => string): { key: string; count: number; share: number }[] {
  const m = new Map<string, number>();
  for (const r of rows) m.set(key(r), (m.get(key(r)) ?? 0) + 1);
  return [...m]
    .map(([k, count]) => ({ key: k, count, share: rows.length ? count / rows.length : 0 }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

const pct = (v: number): string => `${(v * 100).toFixed(1)}%`;

/** Left-aligned first column, right-aligned rest. */
export function formatTable(header: readonly string[], rows: readonly (readonly (string | number)[])[]): string {
  const all = [header, ...rows].map((r) => r.map(String));
  const w = header.map((_, c) => Math.max(...all.map((r) => (r[c] ?? "").length)));
  return all.map((r) => r.map((v, c) => (c === 0 ? v.padEnd(w[c]) : v.padStart(w[c]))).join("  ")).join("\n");
}

export function formatWinRates(rates: readonly WinRate[]): string {
  return formatTable(
    ["name", "games", "W", "L", "D", "win", "±95"],
    rates.map((r) => [r.name, r.games, r.wins, r.losses, r.draws, pct(r.rate), pct(r.ci95)]),
  );
}

/** Grid of row-vs-column win rates (blank where they never met). */
export function formatGrid(g: MatchupGrid): string {
  return formatTable(
    ["vs", ...g.names],
    g.names.map((a) => [a, ...g.names.map((b) => (g.cell[a][b] ? `${Math.round(g.cell[a][b].rate * 100)}` : "-"))]),
  );
}

export function formatDistribution(d: Distribution, unit = ""): string {
  const f = (v: number) => `${Number.isFinite(v) ? +v.toFixed(2) : "-"}${unit}`;
  const top = Math.max(1, ...d.hist);
  const bars = d.hist.map((c, i) => {
    const lo = d.binStart + i * d.bin;
    return `  ${f(lo).padStart(10)} ${"#".repeat(Math.round((c / top) * 30)).padEnd(30)} ${c}`;
  });
  return [
    `n=${d.n} mean=${f(d.mean)} min=${f(d.min)} p10=${f(d.p10)} p50=${f(d.p50)} p90=${f(d.p90)} max=${f(d.max)}`,
    ...bars,
  ].join("\n");
}
