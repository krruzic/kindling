// Test world: a host and N guests (each with its own local devices) on the in-memory network, wired the way a game
// wires them: NetLink -> dispatch -> LockstepHost/Guest + LobbyHost/Guest, random local input every frame.
import { MemoryNet } from "../src/memory.ts";
import {
  LobbyGuest,
  LobbyHost,
  LockstepGuest,
  LockstepHost,
  NetLink,
  type LockstepGuestOptions,
  type LockstepHostOptions,
  type NetLinkOptions,
  type StallInfo,
  type DesyncReport,
} from "../src/index.ts";
import { codec, cpuCommand, rng, SECTIONS, Toy, type Cmd, type Spec } from "./toy.ts";

export const TICK = 1000 / 60;
const FRAME = 16;

export interface Machine {
  name: string;
  link: NetLink;
  devices: number[];
  sim: Toy | null;
  host?: LockstepHost<Cmd, number, Spec>;
  guest?: LockstepGuest<Cmd, number, Spec>;
  lobbyHost?: LobbyHost<{ picks: Record<string, string> }, { pick: string }>;
  lobbyGuest?: LobbyGuest<{ picks: Record<string, string> }, { pick: string }>;
  /** Not updated while true (a frozen tab). */
  paused: boolean;
  /** Corrupt the sim at this tick (desync injection). */
  corruptAt: number;
  stalls: (StallInfo | null)[];
  desyncs: DesyncReport[];
  drops: { seats: number[]; reason: string }[];
  returns: number[][];
  ends: string[];
  refused: string[];
  cpuSeatsAsked: Set<number>;
  input: () => number;
  sticks: Map<number, Cmd>;
}

export interface WorldOptions {
  seed?: number;
  latencyMs?: [number, number];
  reorder?: boolean;
  /** Local devices per guest. */
  guests: number[][];
  /** Extra CPU seats. */
  cpus?: number;
  host?: Partial<LockstepHostOptions<Cmd, number>>;
  guest?: (i: number) => Partial<LockstepGuestOptions<Cmd, number, Spec>>;
  link?: (i: number) => NetLinkOptions;
  build?: string;
}

const HEROES = ["ash", "birch", "cedar", "dune"];

export class World {
  net: MemoryNet;
  host: Machine;
  guests: Machine[] = [];
  opts: WorldOptions;

  constructor(opts: WorldOptions) {
    this.opts = opts;
    this.net = new MemoryNet({
      seed: opts.seed ?? 7,
      latencyMs: opts.latencyMs ?? [10, 40],
      reorder: opts.reorder ?? false,
    });
    this.host = this.machine("host", [0], { cid: "host-cid" });
    const totalSeats = 1 + opts.guests.reduce((n, d) => n + d.length, 0) + (opts.cpus ?? 0);
    const m = this.host;
    m.lobbyHost = new LobbyHost<{ picks: Record<string, string> }, { pick: string }>({
      link: m.link,
      state: { picks: {} },
      seats: totalSeats,
      apply: (req, ctx) => {
        if (ctx.seat < 0 || !HEROES.includes(req.pick)) return false;
        ctx.state.picks[ctx.seat] = req.pick;
        return true;
      },
    });
    m.lobbyHost.setLocal([0]);
    m.host = new LockstepHost<Cmd, number, Spec>({
      link: m.link,
      codec,
      tickMs: TICK,
      build: opts.build ?? "b1",
      sections: SECTIONS,
      cpu: (seat) => {
        m.cpuSeatsAsked.add(seat);
        return cpuCommand(m.sim!, seat);
      },
      onStall: (s) => m.stalls.push(s),
      onDesync: (d) => m.desyncs.push(d),
      onDrop: (d) => m.drops.push(d),
      onReturn: (r) => m.returns.push(r.seats),
      ...opts.host,
    });
    m.link.host({ name: "HOST", kind: "versus", meta: { seats: totalSeats } });
    this.until(() => m.link.room !== "", 2000, "host room");
    opts.guests.forEach((devices, i) => this.addGuest(devices, i));
  }

  machine(name: string, devices: number[], linkOpts: NetLinkOptions = {}): Machine {
    return {
      name,
      link: new NetLink({
        url: "mem://relay/net/ws",
        socket: this.net.socket,
        now: this.net.clock,
        build: this.opts.build ?? "b1",
        ...linkOpts,
      }),
      devices,
      sim: null,
      paused: false,
      corruptAt: -1,
      stalls: [],
      desyncs: [],
      drops: [],
      returns: [],
      ends: [],
      refused: [],
      cpuSeatsAsked: new Set(),
      input: rng(name.length * 977 + devices.length * 31 + (this.opts.seed ?? 7)),
      sticks: new Map(),
    };
  }

  addGuest(devices: number[], i = this.guests.length, join = true): Machine {
    const g = this.machine(`guest${i}`, devices, { cid: `guest-cid-${i}`, ...this.opts.link?.(i) });
    g.lobbyGuest = new LobbyGuest({ link: g.link });
    g.lobbyGuest.setDevices(devices);
    g.guest = new LockstepGuest<Cmd, number, Spec>({
      link: g.link,
      codec,
      build: this.opts.build ?? "b1",
      createSim: (spec) => {
        g.sim = new Toy(spec);
        g.sim.corruptAt = g.corruptAt;
        return g.sim;
      },
      onStall: (s) => g.stalls.push(s),
      onDesync: (d) => g.desyncs.push(d),
      onDrop: (d) => g.drops.push(d),
      onReturn: (r) => g.returns.push(r.seats),
      onEnd: (r) => g.ends.push(r),
      onRefused: (w) => g.refused.push(w),
      ...this.opts.guest?.(i),
    });
    this.guests.push(g);
    if (join) {
      g.link.join({ name: `G${i}`, kind: "versus", room: this.host.link.room });
      this.until(() => g.link.state === "open" || g.link.state === "closed", 2000, `guest${i} welcome`);
    }
    return g;
  }

  get all(): Machine[] {
    return [this.host, ...this.guests];
  }

  private feed(m: Machine): void {
    for (const d of m.devices) {
      let c = m.sticks.get(d) ?? { mx: 0, my: 0, fire: false };
      if (m.input() < 0.08)
        c = {
          mx: Math.round(m.input() * 2000 - 1000) / 1000,
          my: Math.round(m.input() * 2000 - 1000) / 1000,
          fire: false,
        };
      m.sticks.set(d, c);
      const cmd = { ...c, fire: m.input() < 0.05 };
      m.host?.input(d, cmd);
      m.guest?.input(d, cmd);
    }
  }

  frame(m: Machine): void {
    const now = this.net.now;
    m.link.update(now);
    m.link.dispatch(
      (x) => m.host?.receive(x),
      (x) => m.guest?.receive(x),
      (x) => m.lobbyHost?.receive(x),
      (x) => m.lobbyGuest?.receive(x),
    );
    m.lobbyHost?.update(now);
    m.lobbyGuest?.update(now);
    this.feed(m);
    m.host?.update(now);
    m.guest?.update(now);
  }

  step(ms = FRAME): void {
    this.net.advance(ms);
    for (const m of this.all) if (!m.paused) this.frame(m);
  }

  run(ms: number): void {
    const end = this.net.now + ms;
    while (this.net.now < end) this.step();
  }

  until(pred: () => boolean, maxMs: number, what = "condition"): void {
    const end = this.net.now + maxMs;
    while (!pred()) {
      if (this.net.now > end) throw new Error(`timed out waiting for ${what}`);
      this.step();
    }
  }

  /** Starts a match from the lobby's seats. */
  start(seed = 1234): void {
    const lobby = this.host.lobbyHost!;
    const seats = lobby.lockstepSeats();
    const spec: Spec = { seed, players: seats.length };
    this.host.sim = new Toy(spec);
    lobby.setOpen(false);
    this.host.host!.start(spec, seats, this.host.sim);
  }

  /** Runs the match until the host has stepped `ticks`, then lets the guests drain every frame. */
  playTo(ticks: number, maxMs = 120000): void {
    this.until(() => this.host.host!.tick >= ticks, maxMs, `host tick ${ticks}`);
    const h = this.host;
    h.paused = true;
    const live = this.guests.filter((g) => g.link.state !== "closed" && g.guest!.running && !g.paused);
    this.until(() => live.every((g) => g.guest!.tick >= h.host!.tick), 20000, "guests catch up");
    h.paused = false;
  }
}
