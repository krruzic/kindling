// The deterministic World: rovers on a round floating platform, knocking each other off it. Stepped at a fixed tick
// from one Command per seat; reads only the spec, the tuning and its own seeded RNG (no Date, no Math.random, no
// trig: facing is a unit vector and every operation is +, -, *, / or sqrt, which every JS engine computes
// bit-identically). Emits per-tick events for presentation and never reads them back.
//
// Rules: FFA, last rover on the platform wins the round, first to `winRounds` wins the match. Attack is a short
// cone blast, dash a burst that rams whoever it hits, special a charged ground slam. Knockback grows with damage %.
// After `suddenDeath` seconds the ring shrinks until someone falls; a round past `roundCap` is a draw.
import { Mulberry32, SimBase, sectionHashes, type SectionHashes } from "@kindling/core";
import {
  IDLE,
  type Command,
  type GameEvent,
  type Rover,
  type RoverId,
  type Spec,
  type Tuning,
  type WorldState,
  baseTuning,
} from "./types.ts";

export const SECTIONS = ["rovers", "match", "rng"] as const;

export class World extends SimBase<WorldState, Command, GameEvent> {
  readonly state: WorldState;
  readonly rng: Mulberry32;
  readonly t: Tuning;
  readonly winRounds: number;
  readonly spec: Spec;

  constructor(spec: Spec, tuning: Tuning = baseTuning()) {
    super(1 / tuning.match.tickHz);
    if (spec.rovers.length < 2 || spec.rovers.length > 4) throw new Error(`world: ${spec.rovers.length} seats`);
    this.spec = spec;
    this.t = tuning;
    this.rng = new Mulberry32(spec.seed);
    this.winRounds = spec.winRounds ?? tuning.match.winRounds;
    this.state = {
      rovers: spec.rovers.map((kind, seat) => newRover(seat, kind)),
      match: {
        phase: "countdown",
        phaseAt: 0,
        round: 1,
        fightAt: 0,
        ringR: tuning.match.arenaRadius,
        roundWinner: -1,
        winner: -1,
        order: [],
      },
    };
    this.placeRovers();
  }

  get over(): boolean {
    return this.state.match.phase === "done";
  }

  /** Seconds a phase lasts, in ticks. */
  ticks(seconds: number): number {
    return Math.round(seconds * this.t.match.tickHz);
  }

  private placeRovers(): void {
    const n = this.state.rovers.length;
    // Spawn spots on a circle; the RNG rotates who starts where each round.
    const spots = SPAWNS[n];
    const order = this.rng.shuffle(spots.map((_, i) => i));
    const r0 = this.t.match.arenaRadius * 0.55;
    this.state.rovers.forEach((r, i) => {
      const [sx, sz] = spots[order[i]];
      r.x = sx * r0;
      r.z = sz * r0;
      r.vx = r.vz = 0;
      const d = Math.sqrt(r.x * r.x + r.z * r.z) || 1;
      r.fx = -r.x / d;
      r.fz = -r.z / d;
      r.dmg = 0;
      r.alive = true;
      r.fellAt = -1;
      r.dashT = 0;
      r.dashReady = r.attackReady = r.slamReady = 0;
      r.attackAt = r.slamAt = -1;
      r.stun = 0;
      r.lastHitBy = -1;
      r.lastHitTick = -1;
    });
    this.state.match.ringR = this.t.match.arenaRadius;
    this.state.match.order = [];
  }

  protected update(cmds: readonly Command[]): void {
    const m = this.state.match;
    const T = this.tick;
    const since = T - m.phaseAt;
    if (m.phase === "countdown") {
      const total = this.ticks(this.t.match.countdown);
      const step = Math.floor(total / 3);
      if (since % step === 0 && since < step * 3) this.emit({ type: "countdown", n: 3 - since / step });
      this.turnOnly(cmds);
      if (since >= total) {
        m.phase = "fight";
        m.phaseAt = T;
        m.fightAt = T;
        this.emit({ type: "fight", round: m.round });
      }
      return;
    }
    if (m.phase === "done") return;
    if (m.phase === "fight") {
      this.shrink(T);
      this.control(cmds, T);
      this.resolveMoves(T);
    }
    this.physics(T);
    if (m.phase === "fight") this.checkRound(T);
    else if (m.phase === "roundOver" && since >= this.ticks(this.t.match.roundOver)) this.nextRound(T);
  }

  private turnOnly(cmds: readonly Command[]): void {
    for (const r of this.state.rovers) {
      const c = cmds[r.seat] ?? IDLE;
      this.face(r, c.mx / 100, c.mz / 100, 1);
    }
  }

  private shrink(T: number): void {
    const m = this.state.match;
    const mt = this.t.match;
    const sd = this.ticks(mt.suddenDeath);
    const t = T - m.fightAt;
    if (t === sd) this.emit({ type: "suddenDeath" });
    if (t < sd) return;
    const k = Math.min(1, (t - sd) / this.ticks(mt.shrinkFor));
    m.ringR = mt.arenaRadius + (mt.arenaMin - mt.arenaRadius) * k;
  }

  private face(r: Rover, sx: number, sz: number, k: number): void {
    const mag = Math.sqrt(sx * sx + sz * sz);
    if (mag < this.t.physics.stickDeadzone) return;
    const tx = sx / mag;
    const tz = sz / mag;
    let fx = r.fx + (tx - r.fx) * k;
    let fz = r.fz + (tz - r.fz) * k;
    let d = Math.sqrt(fx * fx + fz * fz);
    if (d < 1e-6) {
      // Exactly opposite: turn through the side.
      fx = -r.fz;
      fz = r.fx;
      d = 1;
    }
    r.fx = fx / d;
    r.fz = fz / d;
  }

  private control(cmds: readonly Command[], T: number): void {
    const P = this.t.physics;
    const mv = this.t.moves;
    const dt = this.dt;
    for (const r of this.state.rovers) {
      if (!r.alive) continue;
      const k = this.t.rovers[r.kind];
      const c = cmds[r.seat] ?? IDLE;
      let sx = c.mx / 100;
      let sz = c.mz / 100;
      const mag = Math.sqrt(sx * sx + sz * sz);
      if (mag > 1) {
        sx /= mag;
        sz /= mag;
      }
      const stunned = r.stun > 0;
      if (r.stun > 0) r.stun--;
      if (stunned || r.dashT > 0) continue;
      const slow = r.slamAt >= 0 ? mv.special.slow : 1;
      this.face(r, sx, sz, Math.min(1, P.turnRate * dt));
      const live = mag >= P.stickDeadzone;
      const tvx = live ? sx * k.speed * slow : 0;
      const tvz = live ? sz * k.speed * slow : 0;
      const a = Math.min(1, k.accel * dt);
      r.vx += (tvx - r.vx) * a;
      r.vz += (tvz - r.vz) * a;
      if (c.dash && T >= r.dashReady && r.slamAt < 0) {
        if (live) {
          r.fx = sx / Math.sqrt(sx * sx + sz * sz);
          r.fz = sz / Math.sqrt(sx * sx + sz * sz);
        }
        r.dashT = this.ticks(mv.dash.time);
        r.dashReady = T + this.ticks(k.dashCd);
        r.vx = r.fx * k.dash;
        r.vz = r.fz * k.dash;
        this.emit({ type: "dash", seat: r.seat, x: r.x, z: r.z });
      }
      if (c.attack && T >= r.attackReady && r.attackAt < 0 && r.slamAt < 0) {
        r.attackAt = T + this.ticks(mv.attack.windup);
        r.attackReady = T + this.ticks(mv.attack.cooldown);
      }
      if (c.special && T >= r.slamReady && r.slamAt < 0 && r.attackAt < 0) {
        r.slamAt = T + this.ticks(mv.special.charge);
        r.slamReady = T + this.ticks(mv.special.cooldown);
        this.emit({ type: "slamCharge", seat: r.seat, x: r.x, z: r.z });
      }
    }
  }

  private resolveMoves(T: number): void {
    const mv = this.t.moves;
    const rs = this.state.rovers;
    for (const r of rs) {
      if (!r.alive) {
        r.attackAt = r.slamAt = -1;
        continue;
      }
      const k = this.t.rovers[r.kind];
      if (r.attackAt === T) {
        r.attackAt = -1;
        this.emit({ type: "attack", seat: r.seat, x: r.x, z: r.z, fx: r.fx, fz: r.fz });
        for (const o of rs) {
          if (o === r || !o.alive) continue;
          const dx = o.x - r.x;
          const dz = o.z - r.z;
          const d = Math.sqrt(dx * dx + dz * dz);
          if (d > mv.attack.range || d < 1e-6) continue;
          if ((dx * r.fx + dz * r.fz) / d < mv.attack.cone) continue;
          this.knock(
            o,
            r,
            dx / d,
            dz / d,
            mv.attack.knock * k.power,
            mv.attack.scale * k.power,
            mv.attack.damage,
            T,
            "attack",
          );
        }
      }
      if (r.slamAt === T) {
        r.slamAt = -1;
        const rad = mv.special.radius * k.slam;
        this.emit({ type: "slam", seat: r.seat, x: r.x, z: r.z, r: rad });
        for (const o of rs) {
          if (o === r || !o.alive) continue;
          const dx = o.x - r.x;
          const dz = o.z - r.z;
          const d = Math.sqrt(dx * dx + dz * dz);
          if (d > rad) continue;
          const nx = d > 1e-6 ? dx / d : r.fx;
          const nz = d > 1e-6 ? dz / d : r.fz;
          // Full strength at the centre, 60% at the rim.
          const f = 1 - 0.4 * (d / rad);
          this.knock(
            o,
            r,
            nx,
            nz,
            mv.special.knock * k.slam * f,
            mv.special.scale * f,
            mv.special.damage,
            T,
            "special",
          );
        }
      }
    }
  }

  /** Knockback on `o` from `by` along (nx, nz): base + scale * damage%, divided by mass; then damage is added. */
  private knock(
    o: Rover,
    by: Rover,
    nx: number,
    nz: number,
    base: number,
    scale: number,
    damage: number,
    T: number,
    move: "attack" | "dash" | "special",
  ): void {
    const mass = this.t.rovers[o.kind].mass;
    const kb = (base + (scale * o.dmg) / 100) / mass;
    o.vx += nx * kb;
    o.vz += nz * kb;
    o.dashT = 0;
    o.attackAt = -1;
    o.stun = Math.min(this.ticks(this.t.physics.maxStun), this.ticks(kb * this.t.physics.hitStunPerKb));
    o.dmg += damage;
    o.lastHitBy = by.seat;
    o.lastHitTick = T;
    by.dealt += damage;
    this.emit({ type: "hit", seat: o.seat, by: by.seat, x: o.x, z: o.z, power: kb, move });
  }

  private physics(T: number): void {
    const P = this.t.physics;
    const dt = this.dt;
    const rs = this.state.rovers;
    for (const r of rs) {
      if (r.dashT > 0) {
        r.dashT--;
        continue;
      }
      const f = Math.max(0, 1 - P.friction * dt * (r.alive ? 1 : 0.2));
      // Stunned and airborne rovers slide; the controlled ones were already steered toward their stick.
      if (r.stun > 0 || !r.alive) {
        r.vx *= f;
        r.vz *= f;
      }
    }
    for (const r of rs) {
      r.x += r.vx * dt;
      r.z += r.vz * dt;
    }
    // Rover-rover collisions (seat order: deterministic).
    const R2 = P.radius * 2;
    for (let i = 0; i < rs.length; i++)
      for (let j = i + 1; j < rs.length; j++) {
        const a = rs[i];
        const b = rs[j];
        if (!a.alive || !b.alive) continue;
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const d2 = dx * dx + dz * dz;
        if (d2 >= R2 * R2) continue;
        const d = Math.sqrt(d2) || 1e-3;
        const nx = d2 > 0 ? dx / d : 1;
        const nz = d2 > 0 ? dz / d : 0;
        const ma = this.t.rovers[a.kind].mass;
        const mb = this.t.rovers[b.kind].mass;
        const push = (R2 - d) / 2;
        a.x -= nx * push;
        a.z -= nz * push;
        b.x += nx * push;
        b.z += nz * push;
        const rel = (b.vx - a.vx) * nx + (b.vz - a.vz) * nz;
        if (rel >= 0) continue;
        const j0 = (-(1 + P.bumpRestitution) * rel) / (1 / ma + 1 / mb);
        a.vx -= (j0 / ma) * nx;
        a.vz -= (j0 / ma) * nz;
        b.vx += (j0 / mb) * nx;
        b.vz += (j0 / mb) * nz;
        const dash = this.t.moves.dash;
        const aRam = a.dashT > 0 && b.dashT === 0;
        const bRam = b.dashT > 0 && a.dashT === 0;
        if (aRam) {
          a.dashT = 0;
          this.knock(b, a, nx, nz, dash.ram * this.t.rovers[a.kind].power, dash.scale, dash.damage, T, "dash");
        } else if (bRam) {
          b.dashT = 0;
          this.knock(a, b, -nx, -nz, dash.ram * this.t.rovers[b.kind].power, dash.scale, dash.damage, T, "dash");
        } else if (-rel > 2)
          this.emit({ type: "bump", a: a.seat, b: b.seat, x: (a.x + b.x) / 2, z: (a.z + b.z) / 2, power: -rel });
      }
    const m = this.state.match;
    for (const r of rs) {
      if (!r.alive) continue;
      const d2 = r.x * r.x + r.z * r.z;
      if (d2 <= m.ringR * m.ringR) continue;
      r.alive = false;
      r.fellAt = T;
      r.dashT = 0;
      r.falls++;
      const by = r.lastHitBy >= 0 && T - r.lastHitTick <= this.ticks(this.t.match.fallKoWindow) ? r.lastHitBy : -1;
      if (by >= 0 && by !== r.seat) rs[by].kos++;
      m.order.push(r.seat);
      this.emit({ type: "fall", seat: r.seat, by, x: r.x, z: r.z });
    }
  }

  private checkRound(T: number): void {
    const m = this.state.match;
    const alive = this.state.rovers.filter((r) => r.alive);
    const capped = T - m.fightAt >= this.ticks(this.t.match.roundCap);
    if (alive.length > 1 && !capped) return;
    m.roundWinner = alive.length === 1 ? alive[0].seat : -1;
    if (m.roundWinner >= 0) this.state.rovers[m.roundWinner].wins++;
    m.phase = "roundOver";
    m.phaseAt = T;
    this.emit({ type: "roundOver", round: m.round, winner: m.roundWinner });
  }

  private nextRound(T: number): void {
    const m = this.state.match;
    const champ = this.state.rovers.find((r) => r.wins >= this.winRounds);
    if (champ) {
      m.phase = "done";
      m.phaseAt = T;
      m.winner = champ.seat;
      this.emit({ type: "matchOver", winner: champ.seat });
      return;
    }
    m.round++;
    m.phase = "countdown";
    m.phaseAt = T;
    m.roundWinner = -1;
    this.placeRovers();
  }

  sections(): SectionHashes {
    return sectionHashes(
      {
        rovers: (h) => {
          for (const r of this.state.rovers)
            h.q(r.x)
              .q(r.z)
              .q(r.vx)
              .q(r.vz)
              .q(r.fx)
              .q(r.fz)
              .i32(r.dmg)
              .bool(r.alive)
              .i32(r.fellAt)
              .i32(r.dashT)
              .i32(r.dashReady)
              .i32(r.attackAt)
              .i32(r.attackReady)
              .i32(r.slamAt)
              .i32(r.slamReady)
              .i32(r.stun)
              .i32(r.lastHitBy)
              .i32(r.wins)
              .i32(r.kos)
              .i32(r.falls)
              .i32(r.dealt);
        },
        match: (h) => {
          const m = this.state.match;
          h.str(m.phase).i32(m.phaseAt).i32(m.round).i32(m.fightAt).q(m.ringR).i32(m.roundWinner).i32(m.winner);
          for (const s of m.order) h.i32(s);
        },
        rng: (h) => h.u32(this.rng.state),
      },
      this.tick,
    );
  }

  hash(): number {
    return this.sections().total;
  }
}

/** Unit spawn spots per player count (x, z), symmetric around the centre. */
const S = Math.SQRT1_2;
const SPAWNS: Record<number, [number, number][]> = {
  2: [
    [-1, 0],
    [1, 0],
  ],
  3: [
    [0, -1],
    [0.8660254037844386, 0.5],
    [-0.8660254037844386, 0.5],
  ],
  4: [
    [-S, -S],
    [S, -S],
    [S, S],
    [-S, S],
  ],
};

function newRover(seat: number, kind: RoverId): Rover {
  return {
    seat,
    kind,
    x: 0,
    z: 0,
    vx: 0,
    vz: 0,
    fx: 0,
    fz: 1,
    dmg: 0,
    alive: true,
    fellAt: -1,
    dashT: 0,
    dashReady: 0,
    attackAt: -1,
    attackReady: 0,
    slamAt: -1,
    slamReady: 0,
    stun: 0,
    lastHitBy: -1,
    lastHitTick: -1,
    wins: 0,
    kos: 0,
    falls: 0,
    dealt: 0,
  };
}
