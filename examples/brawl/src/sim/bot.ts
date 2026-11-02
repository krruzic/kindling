// CPU player. Lives in the sim folder and plays through the same Command as humans, so it runs identically on the
// online host (inside LockstepHost's `cpu` callback), in headless balance runs, in the attract-mode world and in the
// RL env. Deterministic: its own seeded ParkMiller RNG (one per seat, never shared), reads only the World.
// `skill` 0..1 scales how often it reacts and how fast it re-thinks.
//
// Behaviour: pick the closest rival (prefer one near the edge), steer to a spot that pushes them outward, attack
// when they are in the cone, dash when lined up between them and the rim, slam when two are close or one is near
// the rim, and retreat toward the centre when too close to the edge itself.
import { ParkMiller } from "@kindling/core";
import { IDLE, type Command, type Rover } from "./types.ts";
import type { World } from "./world.ts";

export interface BotProfile {
  attacks: number;
  dashes: number;
  slams: number;
  retreats: number;
  thinks: number;
}

export class Bot {
  readonly rng: ParkMiller;
  target = -1;
  private nextThink = 0;
  private aimX = 0;
  private aimZ = 0;
  readonly profile: BotProfile = { attacks: 0, dashes: 0, slams: 0, retreats: 0, thinks: 0 };

  constructor(
    readonly seat: number,
    seed: number,
    public skill = 0.7,
  ) {
    this.rng = new ParkMiller((seed * 7919 + seat * 104729 + 17) >>> 0 || 1);
  }

  command(w: World): Command {
    const st = w.state;
    const me = st.rovers[this.seat];
    if (!me || !me.alive || st.match.phase === "done" || st.match.phase === "roundOver") return IDLE;
    const B = w.t.bots;
    const ring = st.match.ringR;
    const T = w.tick;
    if (T >= this.nextThink) {
      this.profile.thinks++;
      this.nextThink = T + Math.round(B.think + (B.thinkSkilled - B.think) * this.skill) + this.rng.int(3);
      this.pickTarget(st.rovers, ring);
    }
    if (st.match.phase === "countdown") {
      const t = st.rovers[this.target];
      return t ? stick(t.x - me.x, t.z - me.z) : IDLE;
    }
    const meR = Math.sqrt(me.x * me.x + me.z * me.z);
    // Too near the edge: back to the middle first.
    if (meR > ring * B.edge) {
      this.profile.retreats++;
      return stick(-me.x, -me.z);
    }
    const t = st.rovers[this.target];
    if (!t || !t.alive) return stick(-me.x * 0.3, -me.z * 0.3);
    const dx = t.x - me.x;
    const dz = t.z - me.z;
    const d = Math.sqrt(dx * dx + dz * dz) || 1e-3;
    const facing = (dx * me.fx + dz * me.fz) / d;
    // Approach from the centre side so hits push outward.
    const tR = Math.sqrt(t.x * t.x + t.z * t.z) || 1e-3;
    this.aimX = t.x - (t.x / tR) * 1.2 - me.x;
    this.aimZ = t.z - (t.z / tR) * 1.2 - me.z;
    const react = this.rng.next() < B.reaction * (0.4 + 0.6 * this.skill);
    const mv = w.t.moves;
    const cmd = stick(d < 2 ? dx : this.aimX, d < 2 ? dz : this.aimZ);
    if (react && d < mv.attack.range * 0.9 && facing > mv.attack.cone + 0.1 && T >= me.attackReady) {
      cmd.attack = true;
      this.profile.attacks++;
    }
    // Dash when the target sits between us and the rim (outward ram) or to close a long gap.
    const outward = (dx * t.x + dz * t.z) / (d * tR);
    if (react && T >= me.dashReady && facing > 0.9 && ((d < 4.5 && outward > 0.55) || d > 7)) {
      cmd.dash = true;
      this.profile.dashes++;
    }
    let near = 0;
    for (const o of st.rovers)
      if (o !== me && o.alive && sq(o.x - me.x) + sq(o.z - me.z) < sq(mv.special.radius * 0.8)) near++;
    if (react && T >= me.slamReady && near > 0 && (near > 1 || tR > ring * 0.6) && this.rng.next() < 0.5) {
      cmd.special = true;
      this.profile.slams++;
    }
    return cmd;
  }

  private pickTarget(rs: Rover[], ring: number): void {
    const me = rs[this.seat];
    let best = -1;
    let score = Infinity;
    for (const o of rs) {
      if (o === me || !o.alive) continue;
      const d = Math.sqrt(sq(o.x - me.x) + sq(o.z - me.z));
      const edge = Math.sqrt(o.x * o.x + o.z * o.z) / ring;
      const s = d - edge * 3 * this.skill - o.dmg * 0.01 + this.rng.next() * 2;
      if (s < score) {
        score = s;
        best = o.seat;
      }
    }
    this.target = best;
  }
}

/** A Command steering toward (x, z), stick quantised to -100..100. */
function stick(x: number, z: number): Command {
  const m = Math.sqrt(x * x + z * z);
  if (m < 1e-3) return { ...IDLE };
  return { mx: Math.round((x / m) * 100), mz: Math.round((z / m) * 100), attack: false, dash: false, special: false };
}

const sq = (v: number) => v * v;
