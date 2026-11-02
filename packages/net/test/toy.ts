// A toy deterministic simulation for the lockstep tests: players moving on an integer grid from stick commands,
// a seeded RNG spawning coins, scores from collecting coins and from "fire" presses. Integer math only.
import { mergeFields, type CommandCodec, type LockstepSim } from "../src/index.ts";

export interface Cmd {
  mx: number;
  my: number;
  fire: boolean;
}

export const IDLE: Cmd = { mx: 0, my: 0, fire: false };

export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const q = (v: number) => Math.max(-1000, Math.min(1000, Math.round(v * 1000)));

export const codec: CommandCodec<Cmd, number> = {
  pack: (c) => ((q(c.mx) + 1000) * 2001 + (q(c.my) + 1000)) * 2 + (c.fire ? 1 : 0),
  unpack: (v) => {
    const fire = v % 2;
    const r = (v - fire) / 2;
    const my = (r % 2001) - 1000;
    const mx = (r - (r % 2001)) / 2001 - 1000;
    return { mx: mx / 1000, my: my / 1000, fire: fire === 1 };
  },
  merge: (queue, last) => mergeFields(queue, last, IDLE, ["mx", "my"]),
  idle: IDLE,
};

export interface Spec {
  seed: number;
  players: number;
}

function fnv(h: number, v: number): number {
  h = Math.imul(h ^ (v & 0xffff), 0x01000193) >>> 0;
  return Math.imul(h ^ (v >>> 16), 0x01000193) >>> 0;
}

export class Toy implements LockstepSim<Cmd> {
  tick = 0;
  players: { x: number; y: number; score: number }[];
  coins: { x: number; y: number }[] = [];
  private rand: () => number;
  private rs = 0;
  /** Test hook: corrupt this sim at a tick (desync injection). */
  corruptAt = -1;

  constructor(spec: Spec) {
    this.rand = rng(spec.seed);
    this.players = Array.from({ length: spec.players }, (_, i) => ({ x: i * 100, y: 0, score: 0 }));
  }

  private r(n: number): number {
    this.rs++;
    return Math.floor(this.rand() * n);
  }

  step(cmds: Cmd[]): void {
    this.tick++;
    this.players.forEach((p, i) => {
      const c = cmds[i] ?? IDLE;
      p.x = (p.x + Math.round(c.mx * 8) + 4096) % 4096;
      p.y = (p.y + Math.round(c.my * 8) + 4096) % 4096;
      if (c.fire) p.score += 1 + this.r(3);
      for (let k = this.coins.length - 1; k >= 0; k--) {
        const o = this.coins[k];
        if (Math.abs(o.x - p.x) < 64 && Math.abs(o.y - p.y) < 64) {
          p.score += 5;
          this.coins.splice(k, 1);
        }
      }
    });
    if (this.r(10) === 0 && this.coins.length < 20) this.coins.push({ x: this.r(4096), y: this.r(4096) });
    if (this.tick === this.corruptAt) this.players[0].x += 1;
  }

  sectionHashes(): number[] {
    let p = 0x811c9dc5;
    for (const o of this.players) p = fnv(fnv(fnv(p, o.x), o.y), o.score);
    let c = 0x811c9dc5;
    for (const o of this.coins) c = fnv(fnv(c, o.x), o.y);
    return [p, c, fnv(0x811c9dc5, this.rs), fnv(0x811c9dc5, this.tick)];
  }

  hash(): number {
    return this.sectionHashes().reduce((h, v) => fnv(h, v), 0x811c9dc5);
  }
}

export const SECTIONS = ["players", "coins", "rng", "clock"];

/** A deterministic CPU: walks toward the nearest coin (reads only the sim). */
export function cpuCommand(sim: Toy, seat: number): Cmd {
  const p = sim.players[seat];
  const c = sim.coins[0];
  if (!p || !c) return { mx: 0, my: 0, fire: sim.tick % 17 === 0 };
  return { mx: Math.sign(c.x - p.x), my: Math.sign(c.y - p.y), fire: sim.tick % 23 === 0 };
}
