// The RL observation and action encoding for one seat, shared by tools/env.ts (training over @kindling/assets' env
// protocol) and any in-game agent bot running a trained policy (@kindling/assets/policy), so training and play see
// byte-identical inputs. Deterministic like the rest of the sim folder.
import { IDLE, type Command } from "./types.ts";
import type { World } from "./world.ts";

/** Floats per observation: self (10) + 3 rivals (8 each) + match (3). */
export const OBS = 10 + 3 * 8 + 3;
/** Action heads: move direction (8 + none), button (none, attack, dash, special). */
export const HEADS = [9, 4];

const DIRS: [number, number][] = [
  [0, 0],
  [0, -100],
  [71, -71],
  [100, 0],
  [71, 71],
  [0, 100],
  [-71, 71],
  [-100, 0],
  [-71, -71],
];

export function observe(w: World, seat: number, out: Float32Array, o: number): void {
  const R = w.state.match.ringR;
  const me = w.state.rovers[seat];
  const T = w.tick;
  const cd = (ready: number) => Math.min(1, Math.max(0, (ready - T) / 120));
  let k = o;
  out[k++] = me.x / R;
  out[k++] = me.z / R;
  out[k++] = me.vx / 10;
  out[k++] = me.vz / 10;
  out[k++] = me.fx;
  out[k++] = me.fz;
  out[k++] = me.dmg / 100;
  out[k++] = cd(me.dashReady);
  out[k++] = cd(me.slamReady);
  out[k++] = me.alive ? 1 : 0;
  // rivals, nearest first (stable tie-break by seat)
  const others = w.state.rovers
    .filter((r) => r.seat !== seat)
    .map((r) => ({ r, d: (r.x - me.x) * (r.x - me.x) + (r.z - me.z) * (r.z - me.z) }))
    .sort((a, b) => a.d - b.d || a.r.seat - b.r.seat);
  for (let i = 0; i < 3; i++) {
    const r = others[i]?.r;
    if (!r) {
      k += 8;
      continue;
    }
    out[k++] = (r.x - me.x) / R;
    out[k++] = (r.z - me.z) / R;
    out[k++] = r.vx / 10;
    out[k++] = r.vz / 10;
    out[k++] = r.dmg / 100;
    out[k++] = r.alive ? 1 : 0;
    out[k++] = r.attackAt >= 0 || r.slamAt >= 0 ? 1 : 0;
    out[k++] = r.stun > 0 ? 1 : 0;
  }
  out[k++] = R / w.t.match.arenaRadius;
  out[k++] = w.state.match.phase === "fight" ? 1 : 0;
  out[k++] = me.wins / w.winRounds;
}

export function decode(a: ArrayLike<number>): Command {
  const [mx, mz] = DIRS[a[0]] ?? DIRS[0];
  return { ...IDLE, mx, mz, attack: a[1] === 1, dash: a[1] === 2, special: a[1] === 3 };
}
