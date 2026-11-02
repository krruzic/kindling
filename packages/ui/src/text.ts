// Text fitting: word wrap, shrink-to-fit, ellipsis and paragraph fitting against any measure function
// (Font.measure, or a fake one in tests). The rule from Grudge: measure every string before drawing and never let
// it overflow its box. Every helper here guarantees each returned line measures within the width it was given
// (over-long words break by character; a block that still doesn't fit at the minimum size is truncated with an
// ellipsis), so callers can draw the result without checking again.

/** Width of `s` at `size` in layout units. */
export type Measure = (s: string, size: number) => number;

export const ELLIPSIS = "...";

/** Splits a word that is wider than `width` into pieces that each fit (at least one character per piece). */
export function breakWord(measure: Measure, word: string, width: number, size: number): string[] {
  const out: string[] = [];
  let cur = "";
  for (const ch of word) {
    if (cur && measure(cur + ch, size) > width) {
      out.push(cur);
      cur = ch;
    } else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

/**
 * Word-wraps `text` to `width`. Explicit "\n" starts a new line; runs of spaces collapse. Words wider than the
 * line are broken by character. A single character wider than `width` is dropped rather than overflow.
 */
export function wrap(measure: Measure, text: string, width: number, size: number): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    const words = para.split(/\s+/).filter(Boolean);
    let line = "";
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (measure(next, size) <= width) {
        line = next;
        continue;
      }
      if (line) out.push(line);
      line = "";
      if (measure(word, size) <= width) {
        line = word;
        continue;
      }
      const parts = breakWord(measure, word, width, size).filter((p) => measure(p, size) <= width);
      line = parts.pop() ?? "";
      out.push(...parts);
    }
    if (line || !words.length) out.push(line);
  }
  return out;
}

/** The largest size in [minSize, size] at which `text` fits `width` on one line (minSize if none does). */
export function shrinkToFit(measure: Measure, text: string, width: number, size: number, minSize = size): number {
  const w = measure(text, size);
  if (w <= width) return size;
  // Widths scale linearly with size for both font kinds; refine once in case of rounding.
  let s = Math.max(minSize, (size * width) / Math.max(1e-6, w));
  while (s > minSize && measure(text, s) > width) s = Math.max(minSize, s * 0.97);
  return s;
}

/** `text` cut (with an ellipsis) so it measures within `width`; "" when not even the ellipsis fits. */
export function ellipsize(measure: Measure, text: string, width: number, size: number, ellipsis = ELLIPSIS): string {
  if (measure(text, size) <= width) return text;
  const chars = [...text];
  let lo = 0;
  let hi = chars.length;
  // Longest prefix that fits with the ellipsis (binary search: widths grow with length).
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (measure(chars.slice(0, mid).join("").trimEnd() + ellipsis, size) <= width) lo = mid;
    else hi = mid - 1;
  }
  if (lo === 0) return measure(ellipsis, size) <= width ? ellipsis : "";
  return chars.slice(0, lo).join("").trimEnd() + ellipsis;
}

export interface LineFit {
  text: string;
  size: number;
  width: number;
  /** Shrinking was not enough and the text was cut. */
  truncated: boolean;
}

/** One line: shrink toward `minSize`, then ellipsize. The result always fits `width`. */
export function fitLine(measure: Measure, text: string, width: number, size: number, minSize = size * 0.7): LineFit {
  const s = shrinkToFit(measure, text, width, size, minSize);
  const t = measure(text, s) <= width ? text : ellipsize(measure, text, width, s);
  return { text: t, size: s, width: measure(t, s), truncated: t !== text };
}

export interface BlockOpts {
  size: number;
  /** Smallest size to shrink to before truncating (default: no shrinking). */
  minSize?: number;
  /** Line height as a multiple of size (default 1.2). */
  leading?: number;
  maxLines?: number;
}

export interface BlockFit {
  lines: string[];
  size: number;
  lineHeight: number;
  /** lines.length * lineHeight. */
  height: number;
  /** Widest line. */
  width: number;
  truncated: boolean;
}

function block(measure: Measure, lines: string[], size: number, lh: number, truncated: boolean): BlockFit {
  return {
    lines,
    size,
    lineHeight: lh,
    height: lines.length * lh,
    width: lines.reduce((m, l) => Math.max(m, measure(l, size)), 0),
    truncated,
  };
}

/**
 * Fits a paragraph into a w x h box: wraps at `size`, shrinking toward `minSize` until the lines fit the height;
 * if they still don't, keeps as many lines as fit and ellipsizes the last. Pass h = Infinity for "auto height"
 * (cards that grow to their content).
 */
export function fitBlock(measure: Measure, text: string, w: number, h: number, o: BlockOpts): BlockFit {
  const leading = o.leading ?? 1.2;
  const min = Math.min(o.size, o.minSize ?? o.size);
  const maxLines = o.maxLines ?? Infinity;
  const steps = 12;
  for (let i = 0; i <= steps; i++) {
    const s = o.size - ((o.size - min) * i) / steps;
    const lines = wrap(measure, text, w, s);
    if (lines.length * s * leading <= h + 0.01 && lines.length <= maxLines)
      return block(measure, lines, s, s * leading, false);
    if (min === o.size) break;
  }
  const lh = min * leading;
  const all = wrap(measure, text, w, min);
  const keep = Math.max(0, Math.min(maxLines, Math.floor((h + 0.01) / lh)));
  if (keep >= all.length) return block(measure, all, min, lh, false);
  const lines = all.slice(0, keep);
  if (keep > 0) lines[keep - 1] = ellipsize(measure, `${lines[keep - 1]} ${all[keep]}`, w, min);
  return block(measure, lines, min, lh, true);
}

/** Upper-cases for fonts without lower case (Grudge's bitmap face). */
export const caps = (s: string) => s.toUpperCase();
