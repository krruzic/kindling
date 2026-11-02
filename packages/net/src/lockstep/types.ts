// Lockstep types shared by LockstepHost and LockstepGuest, plus small helpers games use to build a codec
// (mergeFields, quantize), the input delay policy and a float-math fingerprint. See lockstep/host.ts for the
// protocol.
import type { NetMsg } from "../protocol.ts";
import type { PeerInfo } from "../client.ts";

/** How commands travel and combine. `Packed` must survive JSON (numbers, strings, arrays, plain objects). */
export interface CommandCodec<Cmd, Packed = unknown> {
  pack(c: Cmd): Packed;
  unpack(p: Packed): Cmd;
  /**
   * One tick's command from the inputs queued since the last tick (empty queue: what to repeat, usually `last`'s
   * held state with one-shot actions cleared). Taps between two ticks must not be lost.
   */
  merge(queue: Cmd[], last: Cmd): Cmd;
  /** The neutral command (no input): used before the input delay fills and for absent seats. */
  idle: Cmd;
}

/** The game's deterministic simulation as lockstep drives it. */
export interface LockstepSim<Cmd> {
  /** Advances one tick with one command per seat (index = seat). */
  step(cmds: Cmd[]): void;
  /** Whole-state checksum (uint32). */
  hash(): number;
  /** Per-section checksums (players, units, rng...), named by the `sections` option, so a desync says where. */
  sectionHashes?(): number[];
}

/** A seat as the host declares it when starting a match. */
export type SeatSpec =
  | { kind: "local"; device: number; name?: string }
  | { kind: "remote"; peer: number; device: number; name?: string }
  | { kind: "cpu"; name?: string };

/** A seat on the wire (k: kind, p: relay peer id, d: device index on its machine, c: client id, n: name). */
export interface WireSeat {
  k: "local" | "remote" | "cpu";
  p: number;
  d: number;
  c: string;
  n: string;
}

/** Host side of a link (NetLink fits). */
export interface HostLink {
  toPeer(to: number | "all", msg: NetMsg): void;
  kick?(id: number, why?: string): void;
  rttOf?(peer: number): number;
  peers?: Map<number, PeerInfo>;
  cid?: string;
}

/** Guest side of a link (NetLink fits). */
export interface GuestLink {
  readonly id: number;
  readonly cid: string;
  toHost(msg: NetMsg): void;
}

export interface StallInfo {
  /** Seats being waited for (host-side view; empty when waiting for the host itself). */
  seats: number[];
  names: string[];
  /** "slow": a connected guest's inputs are late; "gone": its connection dropped; "host": no frames from the host;
   * "reconnecting": this guest lost its socket and is retrying. */
  reason: "slow" | "gone" | "host" | "reconnecting";
  /** Whether the simulation is stopped (false: the seat plays idle during a grace period while others go on). */
  stopped: boolean;
  /** How long it has lasted (ms). */
  ms: number;
  /** Time until a CPU takes these seats (ms), or -1. */
  dropInMs: number;
}

export interface DesyncReport {
  tick: number;
  /** Names of the sections whose hashes differ (all section names, or ["world"], when sections are unknown). */
  sections: string[];
  /** Host side: the guest that reported it and its seats. */
  peer?: number;
  seats?: number[];
}

export interface DropEvent {
  seats: number[];
  reason: "slow" | "gone" | "left";
}

/** Input delay in ticks: a fixed number, {base, max}, or a function of the guests' RTTs. */
export type DelayPolicy = number | { base?: number; max?: number } | ((rttsMs: number[], tickMs: number) => number);

/** base + one round trip in ticks, clamped to [base, max]. Unknown RTTs (-1) count as 0. */
export function inputDelay(rttsMs: number[], tickMs: number, base = 3, max = 12): number {
  const worst = Math.max(0, ...rttsMs);
  return Math.max(base, Math.min(max, base + Math.ceil(worst / tickMs)));
}

export function resolveDelay(policy: DelayPolicy | undefined, rtts: number[], tickMs: number): number {
  if (typeof policy === "number") return Math.max(1, Math.round(policy));
  if (typeof policy === "function") return Math.max(1, Math.round(policy(rtts, tickMs)));
  return inputDelay(rtts, tickMs, policy?.base, policy?.max);
}

/**
 * A merge for object commands: `latest` fields (sticks, held buttons) come from the newest input; every other field
 * takes its first truthy value in the queue, so a one-shot press between two ticks isn't lost. An empty queue
 * repeats `last`'s latest fields over `idle`.
 */
export function mergeFields<C extends object>(queue: C[], last: C, idle: C, latest: readonly (keyof C)[]): C {
  const src = queue.length ? queue[queue.length - 1] : last;
  const out = { ...idle } as C;
  for (const k of latest) out[k] = src[k];
  for (const c of queue)
    for (const k of Object.keys(c) as (keyof C)[]) {
      if (latest.includes(k)) continue;
      if (c[k] && !out[k]) out[k] = c[k];
    }
  return out;
}

/** Rounds to a step (default 1/1000) so float noise doesn't bloat or desync commands; -0 becomes 0. */
export function quantize(v: number, step = 0.001): number {
  return Math.round(v / step) * step + 0;
}

/**
 * Float-math fingerprint of this JS engine. Peers whose Math differs may drift apart (transcendentals are not
 * specified bit-exactly); worth a warning, not a refusal.
 */
export function mathPrint(): string {
  let h = 0;
  for (let i = 1; i < 40; i++) {
    const v = i * 0.37;
    for (const r of [
      Math.sin(v),
      Math.cos(v),
      Math.atan2(v, 1.3),
      Math.exp(-v),
      Math.pow(v, 1.7),
      Math.hypot(v, 0.9),
      Math.sqrt(v),
    ])
      h = (Math.imul(h, 31) + (Math.round(r * 1e15) | 0)) | 0;
  }
  return (h >>> 0).toString(36);
}

/** Section names that differ between two hash rows ([hash, ...sections]). */
export function diffSections(mine: number[], theirs: number[], names: readonly string[] | undefined): string[] {
  const out: string[] = [];
  const n = Math.max(mine.length, theirs.length) - 1;
  for (let i = 0; i < n; i++) if (mine[i + 1] !== theirs[i + 1]) out.push(names?.[i] ?? `section${i}`);
  return out.length ? out : ["world"];
}
