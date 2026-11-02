// The sim's vocabulary: the match spec (everything `new World()` needs, which is also what the online host sends
// guests), one Command per seat per tick, the events a tick emits for presentation, and the data-driven tuning.
import TUNING_JSON from "../../data/tuning.json" with { type: "json" };

export type Tuning = typeof TUNING_JSON;
export type RoverId = keyof Tuning["rovers"];

export const ROVERS = Object.keys(TUNING_JSON.rovers) as RoverId[];

/** A fresh copy of the shipped tuning (balance runs mutate their own copy with MUT). */
export function baseTuning(): Tuning {
  return structuredClone(TUNING_JSON);
}

export interface Spec {
  seed: number;
  /** One rover per seat (2-4 seats). */
  rovers: RoverId[];
  /** Round wins needed (default from tuning). */
  winRounds?: number;
}

/**
 * One seat's input for one tick. Sticks are integers in -100..100 (quantised before they enter the world, so the
 * host and guests step on identical numbers); buttons are one-shot presses.
 */
export interface Command {
  mx: number;
  mz: number;
  attack: boolean;
  dash: boolean;
  special: boolean;
}

export const IDLE: Command = { mx: 0, mz: 0, attack: false, dash: false, special: false };

export type Phase = "countdown" | "fight" | "roundOver" | "done";

export interface Rover {
  seat: number;
  kind: RoverId;
  x: number;
  z: number;
  vx: number;
  vz: number;
  /** Facing as a unit vector (no trig in the sim). */
  fx: number;
  fz: number;
  /** Damage percent: knockback grows with it. */
  dmg: number;
  alive: boolean;
  /** Tick the rover left the ring (-1: on it). */
  fellAt: number;
  /** Ticks of dash left. */
  dashT: number;
  dashReady: number;
  /** Tick the attack lands (-1: none winding up). */
  attackAt: number;
  attackReady: number;
  slamAt: number;
  slamReady: number;
  stun: number;
  lastHitBy: number;
  lastHitTick: number;
  wins: number;
  kos: number;
  falls: number;
  dealt: number;
}

export interface MatchState {
  phase: Phase;
  /** Tick the phase began. */
  phaseAt: number;
  round: number;
  /** Tick the current round's fight began. */
  fightAt: number;
  ringR: number;
  /** Round winner seat (-1: draw / none yet). */
  roundWinner: number;
  /** Match winner seat (-1 while playing). */
  winner: number;
  /** Seat order of falls this round (for the results screen). */
  order: number[];
}

export interface WorldState {
  rovers: Rover[];
  match: MatchState;
}

export type GameEvent =
  | { type: "countdown"; n: number }
  | { type: "fight"; round: number }
  | { type: "attack"; seat: number; x: number; z: number; fx: number; fz: number }
  | { type: "dash"; seat: number; x: number; z: number }
  | { type: "slamCharge"; seat: number; x: number; z: number }
  | { type: "slam"; seat: number; x: number; z: number; r: number }
  | { type: "hit"; seat: number; by: number; x: number; z: number; power: number; move: "attack" | "dash" | "special" }
  | { type: "bump"; a: number; b: number; x: number; z: number; power: number }
  | { type: "fall"; seat: number; by: number; x: number; z: number }
  | { type: "suddenDeath" }
  | { type: "roundOver"; round: number; winner: number }
  | { type: "matchOver"; winner: number };
