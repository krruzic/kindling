// Option / rule rows as data: each row lists its allowed values, how to show them and a one-line blurb, and the
// OPTIONS page cycles through them. `snapToRows` repairs a loaded save whose value is no longer offered (a removed
// choice must not leave a setting stuck on something the menu can't show).

export interface OptionRow<T> {
  key: keyof T & string;
  label: string;
  /** Allowed values, in menu order. May be a getter (e.g. resolutions that depend on the screen). */
  readonly values: readonly number[];
  fmt?: (v: number) => string;
  blurb?: string;
}

export const onOff = (v: number): string => (v ? "ON" : "OFF");

/** Step a row's value by `dir` (wrapping). A value not in the list snaps to the nearest one first. */
export function cycleOption<T>(obj: T, row: OptionRow<T>, dir: number): number {
  const vals = row.values;
  const cur = obj[row.key] as unknown as number;
  let i = vals.indexOf(cur);
  if (i < 0) i = vals.indexOf(vals.reduce((a, b) => (Math.abs(b - cur) < Math.abs(a - cur) ? b : a)));
  const next = vals[(((i + dir) % vals.length) + vals.length) % vals.length];
  (obj as Record<string, unknown>)[row.key] = next;
  return next;
}

/** The row's current value as display text. */
export function optionText<T>(obj: T, row: OptionRow<T>): string {
  const v = obj[row.key] as unknown as number;
  return row.fmt ? row.fmt(v) : String(v);
}

/** Reset every row whose value isn't offered any more to its default. Returns the keys that changed. */
export function snapToRows<T>(obj: T, rows: readonly OptionRow<T>[], defaults: T): string[] {
  const fixed: string[] = [];
  for (const r of rows) {
    if (!r.values.includes(obj[r.key] as unknown as number)) {
      (obj as Record<string, unknown>)[r.key] = defaults[r.key];
      fixed.push(r.key);
    }
  }
  return fixed;
}
