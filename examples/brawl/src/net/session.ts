// Online play for BRAWL, DOM-free so the tests drive the exact code the browser runs (over @kindling/net/memory).
//
//   lobby  the host's select screen state (slots, rovers, colours, ready) lives in a LobbyHost and is mirrored to
//          guests; each guest device that pressed a button wants a seat; guests change their own slot only through
//          requests the host validates with the same applyReq() local play uses.
//   match  the host builds the MatchSpec from the slots and starts LockstepHost with the World; guests build the
//          same World from the spec. CPU slots (and guests that drop) are played by Bots on the host; their
//          commands travel in the frames like everyone else's.
//   after  the host ends the match (rematch), everyone is back in the lobby with ready flags cleared.
//
// Every frame: session.input(device, cmd) for each local player, then session.update(now). World events of every
// stepped tick are collected in `events` for presentation (drain them); replayed ticks during a rejoin are skipped.
import {
  LobbyGuest,
  LobbyHost,
  LockstepGuest,
  LockstepHost,
  type LobbySeat,
  type NetLink,
  type NetMsg,
  type SeatSpec,
  type StallInfo,
} from "@kindling/net";
import { Bot } from "../sim/bot.ts";
import { codec } from "../sim/codec.ts";
import { baseTuning, type Command, type GameEvent, type Tuning } from "../sim/types.ts";
import { World } from "../sim/world.ts";
import {
  applyReq,
  matchSpec,
  newSelect,
  playing,
  seatHuman,
  vacate,
  type MatchSpec,
  type SelectReq,
  type SelectState,
} from "../app/select.ts";

export const ROOM_KIND = "brawl";
export const TICK_MS = 1000 / 60;

export type SessionNote =
  | { type: "lobby" }
  | { type: "start"; spec: MatchSpec }
  | { type: "end"; reason: string }
  | { type: "drop"; seats: number[]; mine: boolean }
  | { type: "return"; seats: number[] }
  | { type: "desync"; tick: number; sections: string[] }
  | { type: "closed"; reason: string }
  | { type: "refused"; why: string };

export interface SessionOptions {
  link: NetLink;
  role: "host" | "guest";
  build: string;
  tuning?: Tuning;
  /** Host: seed for the next match (default from the link clock). */
  seed?: () => number;
  note?: (n: SessionNote) => void;
  /** Host: lockstep options for tests (shorter grace periods). */
  graceMs?: number;
  dropAfterMs?: number;
}

export class OnlineSession {
  readonly link: NetLink;
  readonly role: "host" | "guest";
  lobbyHost: LobbyHost<SelectState, SelectReq> | null = null;
  lobbyGuest: LobbyGuest<SelectState, SelectReq> | null = null;
  host: LockstepHost<Command, number, MatchSpec> | null = null;
  guest: LockstepGuest<Command, number, MatchSpec> | null = null;
  world: World | null = null;
  spec: MatchSpec | null = null;
  /** Host: a Bot per world seat played by a CPU (null: a human). */
  bots: (Bot | null)[] = [];
  /** Stall overlay info (null: none). */
  stall: StallInfo | null = null;
  /** Events of every tick stepped since the last drain. */
  readonly events: GameEvent[] = [];
  /** Host-side notes and guest-side notes (also passed to opts.note). */
  closed = "";
  private o: SessionOptions;
  private tuning: Tuning;
  private localNames = new Map<number, string>();
  private matches = 0;

  constructor(o: SessionOptions) {
    this.o = o;
    this.link = o.link;
    this.role = o.role;
    this.tuning = o.tuning ?? baseTuning();
    if (o.role === "host") this.makeHost();
    else this.makeGuest();
  }

  // ── Lobby ──

  /** The mirrored select state (null on a guest before the first update). */
  get state(): SelectState | null {
    return this.lobbyHost ? this.lobbyHost.state : (this.lobbyGuest?.state ?? null);
  }

  get seats(): (LobbySeat | null)[] {
    return this.lobbyHost ? this.lobbyHost.seats : (this.lobbyGuest?.seats ?? []);
  }

  get inMatch(): boolean {
    return !!(this.host?.running || this.guest?.running);
  }

  /** The lobby slot of one of this machine's devices (-1: none yet). */
  slotOf(device: number): number {
    if (this.lobbyHost) return this.lobbyHost.seatOf(0, device);
    return this.lobbyGuest?.mine.get(device) ?? -1;
  }

  /** The local devices (input seats) that want lobby slots, with their names. */
  setLocal(devices: { device: number; name: string }[]): void {
    for (const d of devices) this.localNames.set(d.device, d.name);
    const ids = devices.map((d) => d.device);
    if (this.lobbyHost) this.lobbyHost.setLocal(ids, (d) => this.localNames.get(d) ?? `P${d + 1}`);
    else this.lobbyGuest?.setDevices(ids);
  }

  /** A local device's select request (host: applied at once; guest: sent, applied optimistically). */
  request(device: number, req: SelectReq): void {
    const slot = this.slotOf(device);
    if (this.lobbyHost) {
      if (slot >= 0) this.lobbyHost.change((s) => applyReq(s, slot, req));
    } else if (this.lobbyGuest && slot >= 0) this.lobbyGuest.request(device, req, (s) => void applyReq(s, slot, req));
  }

  /** Host-side edit of the lobby state (CPU slots...). */
  edit(fn: (s: SelectState) => void): void {
    this.lobbyHost?.change(fn);
  }

  private makeHost(): void {
    const link = this.link;
    const lobby = new LobbyHost<SelectState, SelectReq>({
      link,
      state: newSelect(),
      seats: 4,
      apply: (req, ctx) => ctx.seat >= 0 && applyReq(ctx.state, ctx.seat, req),
      // A human beats a CPU: take an open slot first, else a CPU's.
      seatFor: (_w, seats) => {
        const s = lobby.state.slots;
        const open = seats.findIndex((x, i) => !x && s[i].kind === "open");
        return open >= 0 ? open : seats.findIndex((x) => !x);
      },
      onSeats: (seats) => this.syncSlots(seats),
    });
    this.lobbyHost = lobby;
    this.host = new LockstepHost<Command, number, MatchSpec>({
      link,
      codec,
      tickMs: TICK_MS,
      build: this.o.build,
      cpu: (seat) => this.bots[seat]?.command(this.world!) ?? codec.idle,
      graceMs: this.o.graceMs,
      dropAfterMs: this.o.dropAfterMs,
      onStep: () => this.collect(false),
      onStall: (s) => (this.stall = s),
      onDrop: (e) => {
        for (const seat of e.seats) this.bots[seat] = new Bot(seat, (this.spec?.seed ?? 1) + 77, 0.65);
        this.note({ type: "drop", seats: e.seats, mine: false });
      },
      onReturn: (e) => {
        for (const seat of e.seats) this.bots[seat] = null;
        this.note({ type: "return", seats: e.seats });
      },
      onDesync: (r) => this.note({ type: "desync", tick: r.tick, sections: r.sections }),
    });
  }

  /** Keeps the slots in step with who sits where (seats come and go with devices and guests). */
  private syncSlots(seats: (LobbySeat | null)[]): void {
    const s = this.lobbyHost!.state;
    seats.forEach((seat, i) => {
      const slot = s.slots[i];
      if (seat && slot.kind !== "human") seatHuman(s, i, seat.name);
      else if (seat && slot.kind === "human" && !slot.name) slot.name = seat.name;
      else if (!seat && slot.kind === "human") vacate(s, i);
    });
  }

  private makeGuest(): void {
    const link = this.link;
    this.lobbyGuest = new LobbyGuest<SelectState, SelectReq>({ link, onState: () => this.note({ type: "lobby" }) });
    this.guest = new LockstepGuest<Command, number, MatchSpec>({
      link,
      codec,
      build: this.o.build,
      createSim: (spec) => {
        this.spec = spec;
        this.world = new World(spec, this.tuning);
        this.events.length = 0;
        this.note({ type: "start", spec });
        return this.world;
      },
      onStep: (_t, _c, replaying) => this.collect(replaying),
      onStall: (s) => (this.stall = s),
      onDrop: (e) => this.note({ type: "drop", seats: e.seats, mine: e.mine }),
      onReturn: (e) => this.note({ type: "return", seats: e.seats }),
      onDesync: (r) => this.note({ type: "desync", tick: r.tick, sections: r.sections }),
      onEnd: (reason) => {
        this.stall = null;
        this.note({ type: "end", reason });
      },
      onRefused: (why) => this.note({ type: "refused", why }),
    });
  }

  // ── Match ──

  /** Host: starts a match from the lobby (false when the slots can't start one). */
  startMatch(winRounds?: number): boolean {
    const lobby = this.lobbyHost;
    if (!lobby || !this.host) return false;
    const s = lobby.state;
    const order = playing(s);
    if (order.length < 2) return false;
    const seed = this.o.seed ? this.o.seed() : (Math.floor(this.link.now()) * 2654435761 + ++this.matches) >>> 0;
    const spec = matchSpec(s, seed, winRounds);
    const seats: SeatSpec[] = order.map((slot, k) => {
      const seat = lobby.seats[slot];
      if (s.slots[slot].kind === "cpu" || !seat) return { kind: "cpu", name: spec.names[k] };
      if (seat.peer === 0) return { kind: "local", device: seat.device, name: spec.names[k] };
      return { kind: "remote", peer: seat.peer, device: seat.device, name: spec.names[k] };
    });
    this.spec = spec;
    this.world = new World(spec, this.tuning);
    this.bots = order.map((slot, k) => (seats[k].kind === "cpu" ? new Bot(k, seed, s.slots[slot].skill) : null));
    this.events.length = 0;
    lobby.setOpen(false);
    lobby.change((st) => (st.phase = "match"));
    this.host.start(spec, seats, this.world);
    this.link.meta({ phase: "match" });
    this.note({ type: "start", spec });
    return true;
  }

  /** Host: back to the lobby for everyone (rematch / after results). */
  endMatch(): void {
    if (!this.lobbyHost || !this.host) return;
    this.host.end();
    this.lobbyHost.setOpen(true);
    this.lobbyHost.change((st) => {
      st.phase = "pick";
      for (const x of st.slots) if (x.kind === "human") x.ready = false;
    });
    this.link.meta({ phase: "lobby" });
    this.stall = null;
    this.note({ type: "end", reason: "ended" });
  }

  /** World seats this machine's device plays. */
  seatsOf(device: number): number[] {
    if (this.guest) return this.guest.myDevices.get(device) ?? [];
    const lobby = this.lobbyHost;
    if (!lobby || !this.spec) return [];
    const order = playing(lobby.state);
    const slot = lobby.seatOf(0, device);
    const k = order.indexOf(slot);
    return k >= 0 ? [k] : [];
  }

  input(device: number, cmd: Command): void {
    this.host?.input(device, cmd);
    this.guest?.input(device, cmd);
  }

  /** Call every frame with the clock in ms. */
  update(now: number): NetMsg[] {
    const link = this.link;
    link.update(now);
    const rest = link.dispatch(
      (m) => this.host?.receive(m),
      (m) => this.guest?.receive(m),
      (m) => this.lobbyHost?.receive(m),
      (m) => this.lobbyGuest?.receive(m),
      (m) => this.watchLink(m),
    );
    this.lobbyHost?.update(now);
    this.lobbyGuest?.update(now);
    this.host?.update(now);
    this.guest?.update(now);
    if (this.lobbyHost) {
      const s = this.lobbyHost.state;
      const players = s.slots.filter((x) => x.kind !== "open").length;
      const key = `${players}|${s.phase}`;
      if (key !== this.metaKey) {
        this.metaKey = key;
        link.meta({ players, seats: 4, phase: s.phase === "match" ? "match" : "lobby", mode: "FFA" });
      }
    }
    return rest;
  }
  private metaKey = "";

  private watchLink(m: NetMsg): boolean {
    if (m.t === "closed") {
      this.closed = String(m.reason ?? "lost");
      this.note({ type: "closed", reason: this.closed });
    }
    return false;
  }

  private collect(replaying: boolean): void {
    if (replaying || !this.world) return;
    for (const e of this.world.events) this.events.push(e);
  }

  /** Takes the events collected since the last call. */
  drain(): GameEvent[] {
    return this.events.splice(0);
  }

  leave(): void {
    if (this.host?.running) this.host.end("host-left");
    this.link.close();
  }

  private note(n: SessionNote): void {
    this.o.note?.(n);
  }
}
