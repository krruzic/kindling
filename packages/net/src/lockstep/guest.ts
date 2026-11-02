// LockstepGuest: the guest side of host-run lockstep (protocol in lockstep/host.ts). A guest builds its sim from
// the host's "ls:start", steps only on the host's frames, sends its own seats' commands D ticks ahead ("ls:in"),
// checks the host's hashes when it reaches their tick and reports a desync with the differing sections.
//
// Pace: one tick per tickMs of wall time while a couple of frames are buffered; a bigger backlog catches up a few
// ticks per frame; a long backlog (a rejoin replaying the whole match) is a replay and steps many ticks per frame
// (onStep gets replaying=true so the game can skip sounds and effects). After a resume the guest only sends inputs
// once it has caught up ("ls:live" with the tick they start at), so the host never waits on a replay.
import type { NetMsg } from "../protocol.ts";
import {
  diffSections,
  mathPrint,
  type CommandCodec,
  type DesyncReport,
  type DropEvent,
  type GuestLink,
  type LockstepSim,
  type StallInfo,
  type WireSeat,
} from "./types.ts";

export interface GuestStartInfo {
  /** Match id. */
  id: number;
  seats: WireSeat[];
  /** Seat indices this machine plays, by local device. */
  mine: Map<number, number[]>;
  delay: number;
  tickMs: number;
  /** A rejoin / late join: the sim will be fast-forwarded through every frame so far. */
  resume: boolean;
  /** Whether the host's float math fingerprint differs from ours (may desync: warn the player). */
  mathDiffers: boolean;
}

export interface LockstepGuestOptions<Cmd, Packed, Spec> {
  link: GuestLink;
  codec: CommandCodec<Cmd, Packed>;
  /** Builds this machine's sim for a match (exactly what the host built from the same spec). */
  createSim: (spec: Spec, info: GuestStartInfo) => LockstepSim<Cmd>;
  /** Our build id: a start from a host on another build is refused. */
  build?: string;
  /** Section names (default: the host's). */
  sections?: string[];
  /** Frames kept buffered before stepping at wall-clock pace (default 2). */
  bufferTicks?: number;
  /** Most ticks per update when catching up (default 6). */
  maxCatchup?: number;
  /** A backlog over this many ticks is a replay (default 120). */
  replayFrom?: number;
  /** Most ticks per update while replaying (default 2000). */
  replaySteps?: number;
  /** No frames for this long (and the host said nothing) shows "waiting for the host" (default 1000 ms). */
  hostQuietMs?: number;
  onStart?: (info: GuestStartInfo) => void;
  onStep?: (tick: number, cmds: Cmd[], replaying: boolean) => void;
  /** Caught up after a resume; inputs flow again. */
  onLive?: () => void;
  onStall?: (info: StallInfo | null) => void;
  /** Seats became CPUs (`mine`: some are ours). */
  onDrop?: (ev: DropEvent & { mine: boolean }) => void;
  onReturn?: (ev: { seats: number[]; mine: boolean }) => void;
  onDesync?: (report: DesyncReport) => void;
  /** The match is over: "ended" (host), or the connection's close reason ("host-left", "host-silent", "lost"...). */
  onEnd?: (reason: string) => void;
  onRefused?: (why: string) => void;
}

type HashRow = number[];

export class LockstepGuest<Cmd, Packed = unknown, Spec = unknown> {
  readonly math = mathPrint();
  id = 0;
  running = false;
  spec: Spec | null = null;
  sim: LockstepSim<Cmd> | null = null;
  seats: WireSeat[] = [];
  delay = 0;
  tickMs = 1000 / 60;
  tick = 0;
  /** Inputs are being sent (false while replaying after a resume). */
  live = false;
  /** Highest frame index + 1 received. */
  top = 0;
  readonly stats = { steps: 0, hashChecks: 0, desyncs: 0, starts: 0, resumes: 0 };
  readonly desyncs: DesyncReport[] = [];

  private o: LockstepGuestOptions<Cmd, Packed, Spec>;
  private mine = new Map<number, number[]>();
  private mySeats = new Set<number>();
  private queues = new Map<number, Cmd[]>();
  private last = new Map<number, Cmd>();
  private buf = new Map<number, Packed[]>();
  private hostHashes = new Map<number, HashRow>();
  private early: NetMsg[] = [];
  private sections: string[] | undefined;
  private hashEvery = 30;
  private acc = 0;
  private lastNow: number | null = null;
  private now = 0;
  private frameAt = 0;
  private hostWait: StallInfo | null = null;
  private reconnecting = false;
  private stallKey = "";
  private desynced = false;

  constructor(opts: LockstepGuestOptions<Cmd, Packed, Spec>) {
    this.o = opts;
  }

  /** Seats this machine plays, by local device. */
  get myDevices(): Map<number, number[]> {
    return this.mine;
  }

  /** Queues a local device's command (call every frame; merged per tick by the codec). */
  input(device: number, cmd: Cmd): void {
    for (const seat of this.mine.get(device) ?? []) {
      const q = this.queues.get(seat);
      if (q && q.length < 64) q.push(cmd);
    }
  }

  /** Offer every drained link message; returns true when it was a lockstep message it handled. */
  receive(m: NetMsg): boolean {
    if (m.t === "closed") {
      if (this.running && m.reason !== "left") this.finish(String(m.reason ?? "lost"));
      return false;
    }
    if (m.t === "reconnecting") {
      this.reconnecting = true;
      return false;
    }
    if (m.t === "welcome") {
      this.reconnecting = false;
      return false;
    }
    if (typeof m.t !== "string" || !m.t.startsWith("ls:")) return false;
    if (m.t === "ls:start") {
      this.onStart(m);
      return true;
    }
    const id = Number(m.id);
    if (id > this.id) {
      if (this.early.length < 256) this.early.push(m);
      return true;
    }
    if (id !== this.id || !this.running) return true;
    this.fromHost(m);
    return true;
  }

  private onStart(m: NetMsg): void {
    const build = String(m.build ?? "");
    if (this.o.build && build && build !== this.o.build) {
      this.o.onRefused?.(`THE HOST RUNS ANOTHER VERSION (${build} VS ${this.o.build}) · REFRESH BOTH`);
      return;
    }
    const id = Number(m.id);
    const resume = m.resume === true;
    if (id < this.id || (id === this.id && this.running && !resume)) return;
    if (id !== this.id) {
      this.buf.clear();
      this.hostHashes.clear();
      this.top = 0;
    }
    this.id = id;
    this.spec = m.spec as Spec;
    this.seats = Array.isArray(m.seats) ? (m.seats as WireSeat[]) : [];
    this.delay = Math.max(0, Number(m.delay) || 0);
    this.tickMs = Number(m.tickMs) || 1000 / 60;
    this.hashEvery = Number(m.hashEvery) || 30;
    this.sections = this.o.sections ?? (Array.isArray(m.sections) ? (m.sections as string[]) : undefined);
    this.top = Math.max(this.top, Number(m.top) || 0);
    this.tick = 0;
    this.acc = 0;
    this.lastNow = null;
    this.frameAt = this.now;
    this.hostWait = null;
    this.desynced = false;
    this.desyncs.length = 0;
    this.live = !resume;
    this.mine = new Map();
    this.mySeats = new Set();
    this.queues = new Map();
    this.last = new Map();
    this.seats.forEach((s, i) => {
      if (s.k === "local") return;
      const ours = (s.c && s.c === this.o.link.cid) || (s.k === "remote" && s.p === this.o.link.id);
      if (!ours || s.d < 0) return;
      this.mine.set(s.d, [...(this.mine.get(s.d) ?? []), i]);
      this.mySeats.add(i);
      this.queues.set(i, []);
      this.last.set(i, this.o.codec.idle);
    });
    const info: GuestStartInfo = {
      id,
      seats: this.seats,
      mine: this.mine,
      delay: this.delay,
      tickMs: this.tickMs,
      resume,
      mathDiffers: !!m.math && m.math !== this.math,
    };
    this.sim = this.o.createSim(this.spec, info);
    this.running = true;
    this.stats.starts++;
    if (resume) this.stats.resumes++;
    this.o.onStart?.(info);
    const early = this.early.filter((e) => Number(e.id) === id);
    this.early = this.early.filter((e) => Number(e.id) > id);
    for (const e of early) this.fromHost(e);
  }

  private fromHost(m: NetMsg): void {
    if (m.t === "ls:f") {
      const k = Math.floor(Number(m.k));
      const fs = Array.isArray(m.f) ? (m.f as Packed[][]) : [];
      if (!Number.isInteger(k) || k < 0) return;
      fs.forEach((f, i) => {
        if (k + i >= this.tick) this.buf.set(k + i, f);
      });
      this.top = Math.max(this.top, k + fs.length);
      for (const h of (Array.isArray(m.h) ? m.h : []) as HashRow[]) if (h[0] > this.tick) this.hostHashes.set(h[0], h);
      this.frameAt = this.now;
      return;
    }
    if (m.t === "ls:wait") {
      this.hostWait = (m.info as StallInfo | null) ?? null;
      return;
    }
    if (m.t === "ls:drop") {
      const seats = ((m.seats as number[]) ?? []).filter((i) => Number.isInteger(i));
      for (const i of seats) if (this.seats[i]) this.seats[i].k = "cpu";
      const mine = seats.some((i) => this.mySeats.has(i));
      if (mine && this.live) for (const i of seats) this.mySeats.delete(i);
      this.o.onDrop?.({ seats, reason: (m.reason as DropEvent["reason"]) ?? "gone", mine });
      return;
    }
    if (m.t === "ls:back") {
      const seats = ((m.seats as number[]) ?? []).filter((i) => Number.isInteger(i));
      for (const i of seats) if (this.seats[i]) this.seats[i].k = "remote";
      this.o.onReturn?.({ seats, mine: seats.some((i) => this.mySeats.has(i)) });
      return;
    }
    if (m.t === "ls:end") this.finish(String(m.reason ?? "ended"));
  }

  private finish(reason: string): void {
    if (!this.running) return;
    this.running = false;
    this.setStall(null);
    this.o.onEnd?.(reason);
  }

  private sample(seat: number): Packed {
    const c = this.o.codec;
    const m = c.merge(this.queues.get(seat) ?? [], this.last.get(seat) ?? c.idle);
    this.queues.set(seat, []);
    this.last.set(seat, m);
    return c.pack(m);
  }

  /** Steps on buffered frames at wall-clock pace (now: ms), sends inputs, checks hashes. Call once per frame. */
  update(now: number): void {
    this.now = now;
    if (!this.running || !this.sim) return;
    const dt = this.lastNow === null ? 0 : Math.max(0, Math.min(250, now - this.lastNow));
    this.lastNow = now;
    this.acc += dt;
    const tickMs = this.tickMs;
    const buffer = this.o.bufferTicks ?? 2;
    const backlog = () => this.top - this.tick;
    const replaying = backlog() > (this.o.replayFrom ?? 120);
    const max = replaying ? (this.o.replaySteps ?? 2000) : backlog() > buffer ? (this.o.maxCatchup ?? 6) : 2;
    const out: unknown[][] = [];
    let steps = 0;
    while (this.buf.has(this.tick) && steps < max && (this.acc >= tickMs || backlog() > buffer) && this.running) {
      const T = this.tick;
      const f = this.buf.get(T)!;
      this.buf.delete(T);
      if (this.live) for (const seat of this.mySeats) out.push([T + this.delay, seat, this.sample(seat)]);
      const cmds = f.map((p) => this.o.codec.unpack(p));
      this.sim.step(cmds);
      this.tick++;
      this.o.onStep?.(this.tick, cmds, replaying);
      if (this.tick % this.hashEvery === 0) this.check(this.tick);
      this.acc = Math.max(0, this.acc - tickMs);
      steps++;
      this.stats.steps++;
    }
    if (!this.buf.has(this.tick)) this.acc = Math.min(this.acc, tickMs);
    if (out.length) this.o.link.toHost({ t: "ls:in", id: this.id, i: out });
    if (!this.live && backlog() <= buffer && this.tick >= this.top) {
      this.live = true;
      for (const seat of this.mySeats) this.queues.set(seat, []);
      this.o.link.toHost({ t: "ls:live", id: this.id, from: this.tick + this.delay });
      this.o.onLive?.();
    }
    const quiet = this.tick > 0 && now - this.frameAt > (this.o.hostQuietMs ?? 1000) && !this.buf.has(this.tick);
    this.setStall(
      this.reconnecting
        ? { seats: [], names: [], reason: "reconnecting", stopped: false, ms: 0, dropInMs: -1 }
        : (this.hostWait ??
            (quiet
              ? { seats: [], names: [], reason: "host", stopped: true, ms: now - this.frameAt, dropInMs: -1 }
              : null)),
    );
  }

  private setStall(info: StallInfo | null): void {
    const key = info
      ? `${info.reason}:${info.seats.join(",")}:${info.stopped}:${Math.floor(info.dropInMs / 1000)}`
      : "";
    if (key === this.stallKey) return;
    this.stallKey = key;
    this.o.onStall?.(info);
  }

  private check(tick: number): void {
    const host = this.hostHashes.get(tick);
    if (!host || !this.sim) return;
    this.hostHashes.delete(tick);
    this.stats.hashChecks++;
    const mine = [this.sim.hash() >>> 0, ...(this.sim.sectionHashes?.() ?? []).map((h) => h >>> 0)];
    if (mine[0] === host[1]) return;
    const report: DesyncReport = { tick, sections: diffSections(mine, host.slice(1), this.sections) };
    this.stats.desyncs++;
    this.desyncs.push(report);
    this.o.onDesync?.(report);
    if (!this.desynced) this.o.link.toHost({ t: "ls:desync", id: this.id, tick, sections: report.sections });
    this.desynced = true;
  }
}
