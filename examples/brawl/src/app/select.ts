// The select screen's state: four slots (open / human / CPU) with a rover, a colour, a name and a ready flag. Plain
// data and pure functions, shared by local play (slots follow InputManager seats) and online play (the host's
// LobbyHost owns it and mirrors it to guests, who change it only through validated requests). The match spec and
// the world's seat order come from it too, so local, online and the tests build matches the same way.
import { ROVERS, type RoverId, type Spec } from "../sim/types.ts";

export const SLOTS = 4;

/** Player colours (team dye), in pick order. */
export const PALETTE = ["#e8453c", "#3c8ce8", "#f2c230", "#3cc878", "#b05ce8", "#f08a2c", "#e85ca8", "#40d0d8"];
export const PALETTE_NAMES = ["RED", "BLUE", "GOLD", "GREEN", "VIOLET", "ORANGE", "PINK", "TEAL"];

export interface Slot {
  kind: "open" | "human" | "cpu";
  rover: RoverId;
  color: number;
  name: string;
  ready: boolean;
  /** CPU skill 0..1 (CPU slots). */
  skill: number;
}

export interface SelectState {
  slots: Slot[];
  /** "pick" on the select screen; "match" while a match runs. */
  phase: "pick" | "match";
}

export type SelectReq =
  | { op: "rover"; dir: number }
  | { op: "color"; dir: number }
  | { op: "ready"; on: boolean }
  | { op: "name"; name: string };

/** Match spec: the sim's Spec plus what presentation needs on every machine (names, colours). */
export interface MatchSpec extends Spec {
  names: string[];
  colors: number[];
  /** Which world seats were CPUs at the start. */
  cpu: boolean[];
}

export const CPU_SKILLS = [0.35, 0.65, 0.95];
export const SKILL_NAMES = ["EASY", "NORMAL", "HARD"];

export function newSelect(): SelectState {
  return {
    phase: "pick",
    slots: Array.from({ length: SLOTS }, (_, i) => ({
      kind: "open",
      rover: ROVERS[i % ROVERS.length],
      color: i,
      name: "",
      ready: false,
      skill: CPU_SKILLS[1],
    })),
  };
}

function freeColor(s: SelectState, seat: number, from: number, dir: number): number {
  const used = new Set(s.slots.filter((x, i) => i !== seat && x.kind !== "open").map((x) => x.color));
  for (let k = 0; k < PALETTE.length; k++) {
    const c = (((from + dir * k) % PALETTE.length) + PALETTE.length) % PALETTE.length;
    if (!used.has(c)) return c;
  }
  return from;
}

/** Applies a request for `seat` (validated: bad values are refused). Returns true when the state changed. */
export function applyReq(s: SelectState, seat: number, req: SelectReq): boolean {
  const slot = s.slots[seat];
  if (!slot || slot.kind !== "human" || s.phase !== "pick" || !req || typeof req !== "object") return false;
  switch (req.op) {
    case "rover": {
      if (slot.ready || !Number.isInteger(req.dir)) return false;
      const i = ROVERS.indexOf(slot.rover);
      slot.rover = ROVERS[(((i + Math.sign(req.dir)) % ROVERS.length) + ROVERS.length) % ROVERS.length];
      return true;
    }
    case "color": {
      if (slot.ready || !Number.isInteger(req.dir) || !req.dir) return false;
      const c = freeColor(s, seat, slot.color + Math.sign(req.dir), Math.sign(req.dir));
      if (c === slot.color) return false;
      slot.color = c;
      return true;
    }
    case "ready":
      if (slot.ready === !!req.on) return false;
      slot.ready = !!req.on;
      return true;
    case "name": {
      const n = String(req.name ?? "")
        .toUpperCase()
        .replace(/[^A-Z0-9 !-]/g, "")
        .trim()
        .slice(0, 8);
      if (!n || n === slot.name) return false;
      slot.name = n;
      return true;
    }
  }
  return false;
}

/** A human sits down in a slot (a CPU there gives way). */
export function seatHuman(s: SelectState, seat: number, name: string): void {
  const slot = s.slots[seat];
  if (!slot) return;
  if (slot.kind !== "human") slot.ready = false;
  slot.kind = "human";
  slot.name = name;
  slot.color = freeColor(s, seat, slot.color, 1);
}

export function vacate(s: SelectState, seat: number): void {
  const slot = s.slots[seat];
  if (!slot) return;
  slot.kind = "open";
  slot.ready = false;
}

/** Adds a CPU in the first open slot (or bumps the last CPU's skill when full). Returns the slot or -1. */
export function addCpu(s: SelectState): number {
  const i = s.slots.findIndex((x) => x.kind === "open");
  if (i < 0) return -1;
  const slot = s.slots[i];
  slot.kind = "cpu";
  slot.ready = true;
  slot.name = `CPU ${i + 1}`;
  slot.skill = CPU_SKILLS[1];
  slot.color = freeColor(s, i, slot.color, 1);
  return i;
}

/** Cycles a CPU slot's skill; past HARD it is removed. */
export function cycleCpu(s: SelectState, seat: number): void {
  const slot = s.slots[seat];
  if (slot?.kind !== "cpu") return;
  const k = CPU_SKILLS.indexOf(slot.skill);
  if (k >= CPU_SKILLS.length - 1) vacate(s, seat);
  else slot.skill = CPU_SKILLS[k + 1];
}

export function removeCpu(s: SelectState): boolean {
  for (let i = s.slots.length - 1; i >= 0; i--)
    if (s.slots[i].kind === "cpu") {
      vacate(s, i);
      return true;
    }
  return false;
}

/** Slot indices that play (humans and CPUs), in seat order: world seat k is slot playing()[k]. */
export function playing(s: SelectState): number[] {
  return s.slots.flatMap((x, i) => (x.kind === "open" ? [] : [i]));
}

/** Ready to start: 2+ players, at least one human, every human ready. */
export function canStart(s: SelectState): boolean {
  const p = playing(s);
  const humans = p.filter((i) => s.slots[i].kind === "human");
  return p.length >= 2 && humans.length >= 1 && humans.every((i) => s.slots[i].ready);
}

export function matchSpec(s: SelectState, seed: number, winRounds?: number): MatchSpec {
  const p = playing(s).map((i) => s.slots[i]);
  return {
    seed,
    rovers: p.map((x) => x.rover),
    winRounds,
    names: p.map((x, k) => x.name || `P${k + 1}`),
    colors: p.map((x) => x.color),
    cpu: p.map((x) => x.kind === "cpu"),
  };
}
