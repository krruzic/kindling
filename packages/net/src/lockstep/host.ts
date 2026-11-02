// LockstepHost: the authoritative side of host-run lockstep (docs/LESSONS.md "Online (lockstep)").
//
// Every machine runs the same deterministic simulation from the same spec; only per-tick commands travel. With an
// input delay D (ticks), a machine samples its local devices when it steps tick T and schedules that command for
// tick T + D. Guests send theirs ("ls:in"); the host steps tick T once it holds every remote seat's command for T
// (ticks below D are idle), adds its own devices' and its CPUs' commands, steps, and broadcasts the packed frame
// ("ls:f"), plus a world hash and section hashes every `hashEvery` ticks. Guests step only on frames.
//
// Robustness:
// - stall: a remote seat's input is late -> the host waits; after `stallShowMs` onStall (and "ls:wait" to every
//   guest: "waiting for P3..."); after `dropAfterMs` its seats become CPUs (onDrop, "ls:drop").
// - a guest's connection drops mid-match: with leave "idle" its seats play idle commands for `graceMs` while the
//   match goes on, then CPUs take them; with leave "stall" the match waits for it (up to `dropAfterMs`).
// - rejoin: a guest that comes back with the same client id gets the spec and every frame and hash so far
//   ("ls:start" resume + "ls:f" chunks), replays them, then says "ls:live" with the tick its inputs start at; its
//   seats switch back from idle / CPU at that tick (onReturn). Anyone else joining mid-match spectates the same way.
// - desync: guests compare hashes and report the differing sections ("ls:desync" -> onDesync).
// - the host leaving ends the match for everyone (relay "hostgone"); a local pause menu must not pause the sim
//   (feed idle commands for the pausing seat instead).
import type { NetMsg } from "../protocol.ts";
import {
  hashRow,
  sectionNamesOf,
  resolveDelay,
  mathPrint,
  type CommandCodec,
  type DelayPolicy,
  type DesyncReport,
  type DropEvent,
  type HostLink,
  type LockstepSim,
  type SeatSpec,
  type StallInfo,
  type WireSeat,
} from "./types.ts";

export interface LockstepHostOptions<Cmd, Packed> {
  link: HostLink;
  codec: CommandCodec<Cmd, Packed>;
  /** Fixed tick length in ms (e.g. 1000 / 60). */
  tickMs: number;
  /** Build id sent in the start message (a guest on another build refuses it). */
  build?: string;
  /** Hash every this many ticks (default 30). */
  hashEvery?: number;
  /** Names of the sim's sectionHashes(), in order (default: the keys of a core-style sim's sections()). */
  sections?: string[];
  /** Input delay policy (default base 3 + one RTT in ticks, at most 12). */
  delay?: DelayPolicy;
  /** A CPU seat's command for this tick (host only; its output travels in the frames). Default: idle. */
  cpu?: (seat: number, tick: number) => Cmd;
  /** What a seat whose guest disconnected does during the grace period (default "idle"). */
  leave?: "idle" | "stall";
  /** leave "idle": ms before a CPU takes a disconnected guest's seats (default 10000). */
  graceMs?: number;
  /** Stall length before onStall fires (default 300 ms). */
  stallShowMs?: number;
  /** Stall length before the late seats become CPUs (default 10000 ms). */
  dropAfterMs?: number;
  /** Let peers that join mid-match watch (default true). */
  spectators?: boolean;
  /** Most ticks stepped per update (default 4: a throttled tab must not spiral). */
  maxSteps?: number;
  /** Frames per resume message (default 3000). */
  chunk?: number;
  onStep?: (tick: number, cmds: Cmd[]) => void;
  onStall?: (info: StallInfo | null) => void;
  onDrop?: (ev: DropEvent) => void;
  onReturn?: (ev: { seats: number[]; peer: number }) => void;
  onDesync?: (report: DesyncReport) => void;
  /** A peer joined mid-match and was sent the match so far (rejoin or spectator). */
  onResume?: (ev: { peer: number; seats: number[] }) => void;
}

interface HostSeat {
  kind: "local" | "remote" | "cpu";
  device: number;
  /** Relay peer id (-1: disconnected). */
  peer: number;
  cid: string;
  name: string;
  /** Remote: inputs are required from this tick (before it the seat is idle). */
  since: number;
  /** Remote: when its guest disconnected (leave "idle" grace), else null. */
  goneAt: number | null;
  /** CPU seat being reclaimed by its returning guest: becomes remote at this tick. */
  back: number | null;
  inputs: Map<number, unknown>;
  queue: unknown[];
  last: unknown;
}

type HashRow = number[];

export class LockstepHost<Cmd, Packed = unknown, Spec = unknown> {
  readonly math = mathPrint();
  /** Match counter (frames carry it so stale messages from an earlier match are ignored). */
  id = 0;
  running = false;
  spec: Spec | null = null;
  sim: LockstepSim<Cmd> | null = null;
  delay = 0;
  /** Ticks stepped this match. */
  tick = 0;
  readonly stats = { steps: 0, stalls: 0, drops: 0, desyncs: 0, resumes: 0, returns: 0 };
  readonly desyncs: DesyncReport[] = [];

  private o: LockstepHostOptions<Cmd, Packed>;
  private seats: HostSeat[] = [];
  private frames: Packed[][] = [];
  private hashLog: HashRow[] = [];
  private outHashes: HashRow[] = [];
  private sent = 0;
  private acc = 0;
  private now = 0;
  private lastNow: number | null = null;
  private stallAt = 0;
  private stallKey = "";
  private waitSentAt = -1e9;
  private idlePacked: Packed;
  private sectionNames: string[] | undefined;

  constructor(opts: LockstepHostOptions<Cmd, Packed>) {
    this.o = opts;
    this.idlePacked = opts.codec.pack(opts.codec.idle);
  }

  get hashEvery(): number {
    return this.o.hashEvery ?? 30;
  }

  /** Seats as currently assigned (kind may change on drops / returns). */
  seatKinds(): ("local" | "remote" | "cpu")[] {
    return this.seats.map((s) => s.kind);
  }

  /** Starts a match: every guest gets the spec and seats and builds the same sim. */
  start(spec: Spec, seats: SeatSpec[], sim: LockstepSim<Cmd>, opts: { delay?: number } = {}): void {
    const link = this.o.link;
    const remotePeers = [...new Set(seats.flatMap((s) => (s.kind === "remote" ? [s.peer] : [])))];
    const rtts = remotePeers.map((p) => link.rttOf?.(p) ?? -1);
    this.delay = opts.delay ?? resolveDelay(this.o.delay, rtts, this.o.tickMs);
    this.id++;
    this.running = true;
    this.spec = spec;
    this.sim = sim;
    this.sectionNames = this.o.sections ?? sectionNamesOf(sim);
    this.tick = 0;
    this.frames = [];
    this.hashLog = [];
    this.outHashes = [];
    this.sent = 0;
    this.acc = 0;
    this.lastNow = null;
    this.stallAt = 0;
    this.stallKey = "";
    this.desyncs.length = 0;
    const idle = this.o.codec.idle;
    this.seats = seats.map((s, i) => ({
      kind: s.kind,
      device: s.kind === "cpu" ? -1 : s.device,
      peer: s.kind === "remote" ? s.peer : s.kind === "local" ? 0 : -1,
      cid: s.kind === "remote" ? (link.peers?.get(s.peer)?.cid ?? "") : s.kind === "local" ? (link.cid ?? "") : "",
      name: s.name ?? `P${i + 1}`,
      since: this.delay,
      goneAt: null,
      back: null,
      inputs: new Map(),
      queue: [],
      last: idle,
    }));
    link.toPeer("all", this.startMsg(false));
  }

  private wireSeats(): WireSeat[] {
    return this.seats.map((s) => ({ k: s.kind, p: s.peer, d: s.device, c: s.cid, n: s.name }));
  }

  private startMsg(resume: boolean): NetMsg {
    return {
      t: "ls:start",
      id: this.id,
      spec: this.spec,
      seats: this.wireSeats(),
      delay: this.delay,
      tickMs: this.o.tickMs,
      hashEvery: this.hashEvery,
      sections: this.sectionNames ?? null,
      build: this.o.build ?? "",
      math: this.math,
      resume,
      top: resume ? this.frames.length : 0,
    };
  }

  /** Ends the match for everyone. */
  end(reason = "ended"): void {
    if (!this.running) return;
    this.flush();
    this.running = false;
    this.o.link.toPeer("all", { t: "ls:end", id: this.id, reason });
    this.setStall(null);
  }

  /** Queues a local device's command (call every frame; merged per tick by the codec). */
  input(device: number, cmd: Cmd): void {
    for (const s of this.seats) if (s.kind === "local" && s.device === device && s.queue.length < 64) s.queue.push(cmd);
  }

  /** Makes a seat a CPU now (e.g. a local player leaves). */
  toCpu(seat: number): void {
    const s = this.seats[seat];
    if (!s) return;
    s.kind = "cpu";
    s.back = null;
    s.inputs.clear();
  }

  private sample(s: HostSeat): Packed {
    const c = this.o.codec;
    const m = c.merge(s.queue as Cmd[], s.last as Cmd);
    s.queue = [];
    s.last = m;
    return c.pack(m);
  }

  /**
   * Steps as many ticks as wall time allows (now: ms, e.g. performance.now()), broadcasts the new frames and runs
   * the stall / grace watchdogs. Call once per frame.
   */
  update(now: number): void {
    this.now = now;
    if (!this.running || !this.sim) return;
    const dt = this.lastNow === null ? 0 : Math.max(0, Math.min(250, now - this.lastNow));
    this.lastNow = now;
    this.acc += dt;
    const tickMs = this.o.tickMs;
    const maxSteps = this.o.maxSteps ?? 4;
    const stallMode = (this.o.leave ?? "idle") === "stall";
    let steps = 0;
    let missing: number[] = [];
    while (this.acc >= tickMs && steps < maxSteps && this.running) {
      const T = this.tick;
      missing = [];
      for (let i = 0; i < this.seats.length; i++) {
        const s = this.seats[i];
        if (s.kind === "cpu" && s.back !== null && T >= s.back) {
          s.kind = "remote";
          s.since = s.back;
          s.back = null;
          this.stats.returns++;
          this.o.onReturn?.({ seats: [i], peer: s.peer });
          this.o.link.toPeer("all", { t: "ls:back", id: this.id, seats: [i] });
        }
        if (s.kind !== "remote" || T < s.since || s.inputs.has(T)) continue;
        if (s.goneAt !== null && !stallMode) continue;
        missing.push(i);
      }
      if (missing.length) break;
      const frame: Packed[] = [];
      for (let i = 0; i < this.seats.length; i++) {
        const s = this.seats[i];
        if (s.kind === "local") s.inputs.set(T + this.delay, this.sample(s));
        let v: Packed;
        if (s.kind === "cpu") v = this.o.codec.pack(this.o.cpu ? this.o.cpu(i, T) : this.o.codec.idle);
        else if (s.kind === "remote" && (T < s.since || s.goneAt !== null)) v = this.idlePacked;
        else v = (s.inputs.get(T) as Packed) ?? this.idlePacked;
        s.inputs.delete(T);
        frame.push(v);
      }
      this.frames.push(frame);
      const cmds = frame.map((p) => this.o.codec.unpack(p));
      this.sim.step(cmds);
      this.tick++;
      if (this.tick % this.hashEvery === 0) {
        const row = [this.tick, ...hashRow(this.sim, this.sectionNames)];
        this.hashLog.push(row);
        this.outHashes.push(row);
      }
      this.o.onStep?.(this.tick, cmds);
      this.acc -= tickMs;
      steps++;
      this.stats.steps++;
    }
    if (steps >= maxSteps) this.acc = Math.min(this.acc, tickMs * 2);
    if (missing.length) this.acc = Math.min(this.acc, tickMs);
    this.flush();
    this.watch(now, missing);
  }

  private flush(): void {
    if (this.frames.length <= this.sent) return;
    this.o.link.toPeer("all", {
      t: "ls:f",
      id: this.id,
      k: this.sent,
      f: this.frames.slice(this.sent),
      h: this.outHashes,
    });
    this.sent = this.frames.length;
    this.outHashes = [];
  }

  private watch(now: number, missing: number[]): void {
    const graceMs = this.o.graceMs ?? 10000;
    const dropAfter = this.o.dropAfterMs ?? 10000;
    // leave "idle": disconnected seats past their grace period become CPUs; meanwhile report the countdown
    const away = this.seats.flatMap((s, i) => (s.kind === "remote" && s.goneAt !== null ? [i] : []));
    const expired = away.filter((i) => now - this.seats[i].goneAt! >= graceMs);
    if (expired.length && (this.o.leave ?? "idle") === "idle") {
      this.drop(expired, "left");
      return this.watch(
        now,
        missing.filter((i) => !expired.includes(i)),
      );
    }
    if (missing.length) {
      if (!this.stallAt) {
        this.stallAt = now;
        this.stats.stalls++;
      }
      const ms = now - this.stallAt;
      const gone = missing.some((i) => this.seats[i].goneAt !== null || this.seats[i].peer < 0);
      if (ms > dropAfter) {
        this.drop(missing, gone ? "gone" : "slow");
        this.stallAt = 0;
        return this.setStall(null);
      }
      if (ms >= (this.o.stallShowMs ?? 300))
        this.setStall({
          seats: missing,
          names: missing.map((i) => this.seats[i].name),
          reason: gone ? "gone" : "slow",
          stopped: true,
          ms,
          dropInMs: Math.max(0, dropAfter - ms),
        });
      return;
    }
    this.stallAt = 0;
    const awayLeft = away.filter((i) => !expired.includes(i));
    if (awayLeft.length && (this.o.leave ?? "idle") === "idle") {
      const at = Math.min(...awayLeft.map((i) => this.seats[i].goneAt!));
      return this.setStall({
        seats: awayLeft,
        names: awayLeft.map((i) => this.seats[i].name),
        reason: "gone",
        stopped: false,
        ms: now - at,
        dropInMs: Math.max(0, graceMs - (now - at)),
      });
    }
    this.setStall(null);
  }

  private setStall(info: StallInfo | null): void {
    const key = info ? `${info.reason}:${info.seats.join(",")}:${info.stopped}` : "";
    const changed = key !== this.stallKey;
    this.stallKey = key;
    if (changed || (info && this.now - this.waitSentAt >= 500)) {
      this.o.onStall?.(info);
      this.waitSentAt = this.now;
      this.o.link.toPeer("all", { t: "ls:wait", id: this.id, info });
    }
  }

  /** These seats' guests are gone or stuck: CPUs play them from now on (everyone gets the commands). */
  drop(seats: number[], reason: DropEvent["reason"]): void {
    const list = seats.filter((i) => this.seats[i] && this.seats[i].kind === "remote");
    if (!list.length) return;
    for (const i of list) {
      const s = this.seats[i];
      s.kind = "cpu";
      s.goneAt = null;
      s.back = null;
      s.inputs.clear();
    }
    this.stats.drops += list.length;
    this.o.onDrop?.({ seats: list, reason });
    this.o.link.toPeer("all", { t: "ls:drop", id: this.id, seats: list, reason });
  }

  /**
   * Offer every drained link message (returns true when it was a lockstep / membership message it handled).
   * Handles "joined" (rejoin / spectate), "left" (disconnect) and "from" carrying "ls:*" messages.
   */
  receive(m: NetMsg): boolean {
    if (m.t === "joined") {
      this.joined(Number(m.id), String(m.cid ?? ""));
      return false;
    }
    if (m.t === "left") {
      this.left(Number(m.id));
      return false;
    }
    if (m.t !== "from") return false;
    const up = (m.msg ?? {}) as NetMsg;
    if (typeof up.t !== "string" || !up.t.startsWith("ls:")) return false;
    this.fromGuest(Number(m.id), up);
    return true;
  }

  private joined(peer: number, cid: string): void {
    if (!this.running) return;
    const mine = cid ? this.seats.flatMap((s, i) => (s.cid === cid && s.kind !== "local" ? [i] : [])) : [];
    if (!mine.length && this.o.spectators === false) return;
    for (const i of mine) {
      const s = this.seats[i];
      s.peer = peer;
      if (s.kind === "remote") {
        // idle until it has replayed and says "live"
        s.since = Infinity;
        s.goneAt = null;
        s.inputs.clear();
      }
    }
    this.resume(peer);
    this.stats.resumes++;
    this.o.onResume?.({ peer, seats: mine });
  }

  /** Sends the spec and every frame and hash so far to one peer. */
  private resume(peer: number): void {
    this.flush();
    const link = this.o.link;
    link.toPeer(peer, this.startMsg(true));
    const n = this.o.chunk ?? 3000;
    for (let k = 0; k < this.frames.length; k += n) {
      const f = this.frames.slice(k, k + n);
      const h = this.hashLog.filter(([t]) => t > k && t <= k + f.length);
      link.toPeer(peer, { t: "ls:f", id: this.id, k, f, h });
    }
  }

  private left(peer: number): void {
    if (!this.running) return;
    for (const s of this.seats) {
      if (s.peer !== peer || s.kind === "local") continue;
      s.peer = -1;
      s.back = null;
      if (s.kind === "remote") {
        s.goneAt = this.now;
        s.inputs.clear();
      }
    }
  }

  private fromGuest(peer: number, m: NetMsg): void {
    if (!this.running || Number(m.id) !== this.id) return;
    if (m.t === "ls:in") {
      const rows = Array.isArray(m.i) ? (m.i as unknown[][]) : [];
      for (const row of rows) {
        if (!Array.isArray(row)) continue;
        const [tick, seat, v] = row as [number, number, unknown];
        const s = this.seats[seat];
        if (!s || s.peer !== peer || s.kind === "local" || !Number.isInteger(tick) || tick < this.tick) continue;
        if (tick > this.tick + 600) continue;
        s.inputs.set(tick, v);
      }
      return;
    }
    if (m.t === "ls:live") {
      const from = Math.max(0, Math.floor(Number(m.from) || 0));
      for (const s of this.seats) {
        if (s.peer !== peer || s.kind === "local") continue;
        if (s.kind === "remote" && s.since === Infinity) s.since = from;
        else if (s.kind === "cpu" && s.cid) s.back = Math.max(from, this.tick);
      }
      return;
    }
    if (m.t === "ls:desync") {
      const report: DesyncReport = {
        tick: Number(m.tick),
        sections: (Array.isArray(m.sections) ? (m.sections as unknown[]) : []).map(String).slice(0, 32),
        peer,
        seats: this.seats.flatMap((s, i) => (s.peer === peer && s.kind !== "local" ? [i] : [])),
      };
      this.stats.desyncs++;
      this.desyncs.push(report);
      this.o.onDesync?.(report);
    }
  }
}
