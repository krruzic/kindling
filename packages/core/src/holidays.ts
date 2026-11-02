// Holiday tweaks by date window (Grudge's src/game/holidays.ts, generalised). Presentation only: the sim never sees
// them, so online players needn't agree on the date or the option, and the determinism baseline never moves.
//   const holidays = new Holidays<"halloween" | "xmas">({ search: location.search })
//     .register("halloween", daysAround((y) => new Date(y, 9, 31), -7, 1))
//     .register("xmas", (d) => d.getMonth() === 11 && d.getDate() >= 26);
//   holidays.enabled = save.options.holidays;    // the option toggle
//   holidays.active()                            // what to show now (null when off)
//   holidays.toLoad()                            // whose assets to load (ignores the option, so toggling it on
//                                                // mid-session has the assets ready)
// `?holiday=<name>` forces one on, `?holiday=none` forces all off (screenshots and tests on any date).

export type DateWindow = (date: Date) => boolean;

/** The `n`th (1-based) `weekday` (0 = Sunday) of `month` (0-based) in `year`; n = -1 for the last one. */
export function nthWeekday(year: number, month: number, weekday: number, n: number): Date {
  if (n < 0) {
    const last = new Date(year, month + 1, 0);
    return new Date(year, month, last.getDate() - ((last.getDay() - weekday + 7) % 7));
  }
  const first = new Date(year, month, 1).getDay();
  return new Date(year, month, 1 + ((weekday - first + 7) % 7) + (n - 1) * 7);
}

/** Whole days from `a` to `b` by local calendar date (DST-safe). */
export function daysBetween(a: Date, b: Date): number {
  const day = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000;
  return day(b) - day(a);
}

/** A window of days around a yearly anchor: from `before` (negative) to `after` days, inclusive. */
export function daysAround(anchor: (year: number) => Date, before: number, after: number): DateWindow {
  return (d) => {
    const n = daysBetween(anchor(d.getFullYear()), d);
    return n >= before && n <= after;
  };
}

/** Fixed calendar range, months 0-based, inclusive; may wrap the new year (e.g. Dec 26 to Jan 2). */
export function dateRange(fromMonth: number, fromDay: number, toMonth: number, toDay: number): DateWindow {
  const from = fromMonth * 100 + fromDay;
  const to = toMonth * 100 + toDay;
  return (d) => {
    const v = d.getMonth() * 100 + d.getDate();
    return from <= to ? v >= from && v <= to : v >= from || v <= to;
  };
}

export interface HolidaysOptions {
  /** A URL query string (location.search) to read the override from. */
  search?: string;
  /** Override param name (default "holiday"). */
  param?: string;
  /** Clock for "today" (default new Date()). */
  today?: () => Date;
}

export class Holidays<N extends string = string> {
  /** The option toggle: false turns every tweak off (active() is null); assets still follow toLoad(). */
  enabled = true;
  private readonly list: { name: N; window: DateWindow }[] = [];
  private readonly today: () => Date;
  private readonly raw: string | null;

  constructor(opts: HolidaysOptions = {}) {
    this.today = opts.today ?? (() => new Date());
    const search = opts.search ?? (typeof location !== "undefined" ? location.search : "");
    this.raw = new URLSearchParams(search).get(opts.param ?? "holiday");
  }

  /** Add a holiday; earlier registrations win when windows overlap. */
  register(name: N, window: DateWindow): this {
    this.list.push({ name, window });
    return this;
  }

  names(): N[] {
    return this.list.map((h) => h.name);
  }

  /** The URL override: a holiday name, null for "none" (or an unknown name), undefined when absent. */
  get forced(): N | null | undefined {
    if (this.raw === null) return undefined;
    return this.list.find((h) => h.name === this.raw)?.name ?? null;
  }

  /** The holiday on `date` by the calendar alone (ignores the option and the override). */
  on(date: Date = this.today()): N | null {
    return this.list.find((h) => h.window(date))?.name ?? null;
  }

  /** Every holiday whose window contains `date`. */
  allOn(date: Date = this.today()): N[] {
    return this.list.filter((h) => h.window(date)).map((h) => h.name);
  }

  /** The holiday to show now: override or calendar, and only with the option on. */
  active(date?: Date): N | null {
    if (!this.enabled) return null;
    return this.toLoad(date);
  }

  /** The holiday whose assets should load: override or calendar, whatever the option says. */
  toLoad(date?: Date): N | null {
    const f = this.forced;
    return f !== undefined ? f : this.on(date);
  }

  is(name: N, date?: Date): boolean {
    return this.active(date) === name;
  }
}
