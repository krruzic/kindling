// Spatial placement for sound effects with one listener per view (split screen). A sound is full volume near
// the middle of a view, fades out past its edge (distance scaled by how much of the world the view shows), is
// panned by where it lands on that view's slice of the SCREEN (left player's sounds come from the left), and is
// muffled when the view can't see it. The loudest view wins. Sounds made by or landing on a local player's own
// character never drop below a floor, so you always hear yourself.
//
// Engine-agnostic: a listener is a ground position, a range and its screen slice, plus an optional projector
// (three.js camera projection, or a 2D camera's rect test). 2D games pass their y as `z`.

export interface Listener {
  /** Listener ground position (world units). */
  x: number;
  z: number;
  /** Half the width of the world the view shows (distances are measured in these). */
  range: number;
  /** This view's horizontal slice of the screen, 0..1 (left edge and width). */
  left: number;
  span: number;
  /** Projects a world point into the view: sx -1..1 across it, and whether it is on screen. */
  project?(x: number, y: number, z: number): { sx: number; visible: boolean };
  /** The entity this view follows (its player): a `minor` sound of theirs is heard through this view only. */
  owner?: number;
}

export interface Hearing {
  views: Listener[];
  /** Entity ids local players control (their sounds never fall silent). */
  own?: Set<number>;
}

export interface Place {
  gain: number;
  /** -1..1 */
  pan: number;
  /** Low-pass it (off screen / behind something). */
  muffle: boolean;
}

export interface PlaceOpts {
  /** Full volume within this fraction of the range; silent beyond `far`. */
  near?: number;
  far?: number;
  /** Lowest gain for the listener's own sounds. */
  ownFloor?: number;
  /** Gain multiplier for off-screen sounds. */
  offscreen?: number;
  /** How far toward the screen edges panning reaches. */
  width?: number;
  /**
   * A minor sound (a pickup, a footstep, a gem): with an `owner`, only the owner's own view hears it (panned to that
   * view's slice, at full level near them); another player's minor sound (a CPU, a remote player: no view of their
   * own) gets `foreign`. Without this, split screen plays every player's coin ticks through every view.
   */
  minor?: boolean;
  /** Gain for a minor sound whose owner has no view here (default 0.25). */
  foreign?: number;
}

export const CENTER: Place = { gain: 1, pan: 0, muffle: false };

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** Where a sound at (x, y, z) sits for the listeners; null when nobody hears it. */
export function place(h: Hearing, x: number, y: number, z: number, owner?: number, o: PlaceOpts = {}): Place | null {
  const near = o.near ?? 0.6;
  const far = o.far ?? 1.35;
  let best: Place | null = null;
  // a minor sound of a player with a view: that view alone
  const mine = o.minor && owner !== undefined ? h.views.filter((l) => l.owner === owner) : [];
  const views = mine.length ? mine : h.views;
  for (const l of views) {
    const d = Math.hypot(x - l.x, z - l.z) / Math.max(1e-6, l.range);
    const t = clamp((d - near) / (far - near), 0, 1);
    const g = (1 - t) * (1 - t);
    if (g <= 0 || (best && g <= best.gain)) continue;
    const p = l.project ? l.project(x, y, z) : { sx: clamp((x - l.x) / l.range, -1, 1), visible: d <= 1 };
    const sx = l.left + clamp(p.sx * 0.5 + 0.5, 0, 1) * l.span;
    best = {
      gain: p.visible ? g : g * (o.offscreen ?? 0.65),
      pan: (sx * 2 - 1) * (o.width ?? 0.8),
      muffle: !p.visible,
    };
  }
  if (o.minor && owner !== undefined && !mine.length && best) best.gain *= o.foreign ?? 0.25;
  if (owner !== undefined && h.own?.has(owner)) {
    const floor = o.ownFloor ?? 0.32;
    if (!best) return { gain: floor, pan: 0, muffle: true };
    best.gain = Math.max(best.gain, floor);
  }
  return best;
}

/** A global sound (heard by everyone at full volume) that still leans toward where it happened. */
export function lean(h: Hearing, x: number, y: number, z: number, amount = 0.6): Place {
  const p = place(h, x, y, z);
  return { gain: 1, pan: (p?.pan ?? 0) * amount, muffle: false };
}

/** Listeners for N views laid side by side / in a grid: each view's screen slice from its rect. */
export function viewSlice(rect: { x: number; w: number }, screenW: number): { left: number; span: number } {
  return { left: rect.x / screenW, span: rect.w / screenW };
}
