// Layout assertions: a dev mode that records every element's rect against the bounds it must stay inside and
// flags overflow (content wider / taller than its box, or a box poking out of its parent), overlap between
// siblings that must not overlap, and elements off screen; draw() outlines them in red over the UI. Most UI bugs
// we shipped (text past a card edge, a footer under a panel, overlapping cards) were exactly these, visible in a
// screenshot nobody looked at. Components report into it when `ui.debug` is set; screens can add their own.
// Rects are recorded with the context transform, so tilted / translated cards compare in screen layout space.
import { contains, overlapArea, type Rect } from "./layout.ts";

export type IssueKind = "overflow" | "overlap" | "offscreen";

export interface Issue {
  kind: IssueKind;
  id: string;
  /** Element rect in screen layout units. */
  rect: Rect;
  other?: string;
  detail: string;
}

interface Mat {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

interface Entry {
  id: string;
  rect: Rect;
  group?: string;
  m: Mat | null;
}

const ID: Mat = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

function apply(m: Mat, r: Rect): Rect {
  const pts = [
    [r.x, r.y],
    [r.x + r.w, r.y],
    [r.x, r.y + r.h],
    [r.x + r.w, r.y + r.h],
  ].map(([x, y]) => [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f]);
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/** m relative to base (base^-1 * m), for axis-aligned scale/translate bases. */
function relative(base: Mat, m: Mat): Mat {
  const det = base.a * base.d - base.b * base.c || 1;
  const ia = base.d / det;
  const ib = -base.b / det;
  const ic = -base.c / det;
  const id = base.a / det;
  const ie = -(ia * base.e + ic * base.f);
  const iff = -(ib * base.e + id * base.f);
  return {
    a: ia * m.a + ic * m.b,
    b: ib * m.a + id * m.b,
    c: ia * m.c + ic * m.d,
    d: ib * m.c + id * m.d,
    e: ia * m.e + ic * m.f + ie,
    f: ib * m.e + id * m.f + iff,
  };
}

export class LayoutDebug {
  enabled = true;
  /** Throw on the first issue (tests / CI screenshots). */
  strict = false;
  /** Draw every recorded box faintly, not just the bad ones. */
  showAll = false;
  /** Slack in layout units before something counts as overflowing. */
  eps = 0.5;
  private entries: Entry[] = [];
  private issues: Issue[] = [];
  private base: Mat = ID;
  private screen: Rect | null = null;

  /** Starts a frame; `ctx` gives the base (layout -> device) transform, `screen` the visible layout rect. */
  begin(ctx?: CanvasRenderingContext2D | null, screen?: Rect): void {
    this.entries = [];
    this.issues = [];
    this.base = ctx ? ctx.getTransform() : ID;
    this.screen = screen ?? null;
  }

  private toScreen(r: Rect, ctx?: CanvasRenderingContext2D | null): Rect {
    if (!ctx) return r;
    return apply(relative(this.base, ctx.getTransform()), r);
  }

  private add(kind: IssueKind, id: string, rect: Rect, detail: string, other?: string): void {
    const issue = { kind, id, rect, detail, other };
    this.issues.push(issue);
    if (this.strict) throw new Error(`ui ${kind}: ${id} ${detail}`);
  }

  /**
   * Records element `id` at `rect`. If `bounds` is given the rect must lie inside it. Elements sharing a `group`
   * must not overlap each other (checked in end()).
   */
  box(id: string, rect: Rect, o: { bounds?: Rect; group?: string; ctx?: CanvasRenderingContext2D | null } = {}): void {
    if (!this.enabled) return;
    const r = this.toScreen(rect, o.ctx);
    this.entries.push({ id, rect: r, group: o.group, m: null });
    if (o.bounds && !contains(this.toScreen(o.bounds, o.ctx), r, this.eps))
      this.add("overflow", id, r, `${fmt(rect)} outside ${fmt(o.bounds)}`);
  }

  /** Records content of measured size (w x h) drawn at (x, y) that must fit in `bounds`. */
  content(
    id: string,
    x: number,
    y: number,
    w: number,
    h: number,
    bounds: Rect,
    ctx?: CanvasRenderingContext2D | null,
  ): void {
    this.box(id, { x, y, w, h }, { bounds, ctx });
  }

  /** Runs the overlap and off-screen checks; returns this frame's issues. */
  end(): Issue[] {
    if (!this.enabled) return [];
    const groups = new Map<string, Entry[]>();
    for (const e of this.entries) {
      if (this.screen && !contains(this.screen, e.rect, this.eps))
        this.add("offscreen", e.id, e.rect, `${fmt(e.rect)} past screen ${fmt(this.screen)}`);
      if (!e.group) continue;
      let l = groups.get(e.group);
      if (!l) groups.set(e.group, (l = []));
      l.push(e);
    }
    for (const l of groups.values())
      for (let i = 0; i < l.length; i++)
        for (let j = i + 1; j < l.length; j++)
          if (overlapArea(l[i].rect, l[j].rect) > this.eps * this.eps)
            this.add("overlap", l[i].id, l[i].rect, `overlaps ${l[j].id}`, l[j].id);
    return this.issues;
  }

  get list(): readonly Issue[] {
    return this.issues;
  }

  /** Outlines bad elements in red (labelled) and, with showAll, every element in faint cyan. */
  draw(ctx: CanvasRenderingContext2D): void {
    if (!this.enabled) return;
    ctx.save();
    ctx.setTransform(this.base.a, this.base.b, this.base.c, this.base.d, this.base.e, this.base.f);
    const px = 1 / (Math.hypot(this.base.a, this.base.b) || 1);
    ctx.lineWidth = px;
    if (this.showAll) {
      ctx.strokeStyle = "rgba(0,255,255,0.45)";
      for (const e of this.entries) ctx.strokeRect(e.rect.x, e.rect.y, e.rect.w, e.rect.h);
    }
    ctx.font = `${10 * px}px monospace`;
    ctx.textBaseline = "top";
    for (const is of this.issues) {
      const color = is.kind === "overflow" ? "#ff2040" : is.kind === "overlap" ? "#ff9020" : "#ff40ff";
      ctx.strokeStyle = color;
      ctx.lineWidth = 2 * px;
      ctx.setLineDash([4 * px, 2 * px]);
      ctx.strokeRect(is.rect.x, is.rect.y, is.rect.w, is.rect.h);
      ctx.setLineDash([]);
      const label = `${is.kind}: ${is.id}`;
      const tw = ctx.measureText(label).width;
      ctx.fillStyle = color;
      ctx.fillRect(is.rect.x, is.rect.y - 11 * px, tw + 4 * px, 11 * px);
      ctx.fillStyle = "#000";
      ctx.fillText(label, is.rect.x + 2 * px, is.rect.y - 10.5 * px);
    }
    ctx.restore();
  }
}

const fmt = (r: Rect) => `[${r.x.toFixed(1)},${r.y.toFixed(1)} ${r.w.toFixed(1)}x${r.h.toFixed(1)}]`;
