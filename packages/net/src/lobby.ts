// Mirrored lobby: the host owns one state blob (the game's select screen: picks, ready flags, rules...) plus the
// seat table; guests see a copy ("lb:state", sent on change and every `resendMs`) and change it only by
// requests ("lb:req") that the host validates and applies with the game's callback. Grudge and QUICKLORE both ran
// the real select screen on the host and mirrored it this way (docs/LESSONS.md "Online (lockstep)").
//
// Seats: a guest announces which of its local devices want seats ("lb:want", re-sent every 1.5 s, so a guest with
// a keyboard and two pads gets three seats - the case that broke in our 8-player test). The host seats each device
// in a free seat (seatFor, default the first seat with no human: a human always beats a CPU) and frees them when
// the device or the guest goes away. lockstepSeats() turns the table into LockstepHost seats.
import type { NetMsg } from "./protocol.ts";
import type { HostLink, GuestLink, SeatSpec } from "./lockstep/types.ts";

/** Who sits in a seat. peer 0 = the host's own device. */
export interface LobbySeat {
  peer: number;
  device: number;
  name: string;
  cid: string;
}

export interface LobbyRequestContext<S> {
  peer: number;
  device: number;
  /** The requesting device's seat (-1: none). */
  seat: number;
  state: S;
}

export interface LobbyHostOptions<S, R> {
  link: HostLink;
  state: S;
  /** Number of seats (default 4). */
  seats?: number;
  /**
   * Validates a guest request and applies it to `state` in place. Return true when the state changed (it is
   * re-broadcast), false to reject. Never trust a request: a guest may only act on its own seats.
   */
  apply: (req: R, ctx: LobbyRequestContext<S>) => boolean;
  /** Chooses a seat for a device that wants one (-1: none free). Default: the first seat with no human. */
  seatFor?: (want: { peer: number; device: number }, seats: (LobbySeat | null)[]) => number;
  /** Seat name for a guest's device (default: its relay name, with the device number when it brings several). */
  nameFor?: (peerName: string, device: number, devices: number) => string;
  /** Full re-broadcast interval (default 1000 ms). */
  resendMs?: number;
  /** Called after seats change (e.g. to turn a CPU seat into a human one in the state). */
  onSeats?: (seats: (LobbySeat | null)[]) => void;
}

export class LobbyHost<S, R = unknown> {
  state: S;
  seats: (LobbySeat | null)[];
  private o: LobbyHostOptions<S, R>;
  private wants = new Map<number, number[]>();
  private names = new Map<number, string>();
  private version = 0;
  private sentVersion = -1;
  private sentAt = -1e9;
  private localName: (device: number) => string = (d) => `P${d + 1}`;
  /** While false (a match is running) seats are frozen: departed guests keep theirs for lockstep to handle. */
  open = true;

  constructor(opts: LobbyHostOptions<S, R>) {
    this.o = opts;
    this.state = opts.state;
    this.seats = Array.from({ length: opts.seats ?? 4 }, () => null);
  }

  /** Host-side change to the state (marks it for broadcast). */
  change(fn: (s: S) => void): void {
    fn(this.state);
    this.version++;
  }

  /** Freezes the seats during a match (false) and re-seats everyone after it (true). */
  setOpen(open: boolean): void {
    this.open = open;
    if (!open) return;
    const peers = new Set([...this.wants.keys(), ...this.seats.flatMap((s) => (s ? [s.peer] : []))]);
    for (const p of peers) this.reseat(p);
  }

  /** Seats the host's own devices (peer 0), keeping existing ones in place. */
  setLocal(devices: number[], name: (device: number) => string = (d) => `P${d + 1}`): void {
    this.wants.set(0, devices);
    this.names.set(0, "HOST");
    this.localName = name;
    this.reseat(0);
  }

  /** The seat of a peer's device (-1: none). */
  seatOf(peer: number, device: number): number {
    return this.seats.findIndex((s) => s?.peer === peer && s.device === device);
  }

  private defaultSeat(seats: (LobbySeat | null)[]): number {
    return seats.findIndex((s) => s === null);
  }

  private reseat(peer: number): void {
    if (!this.open) return;
    const nameOf = peer === 0 ? this.localName : undefined;
    const want = this.wants.get(peer) ?? [];
    let changed = false;
    this.seats.forEach((s, i) => {
      if (s && s.peer === peer && !want.includes(s.device)) {
        this.seats[i] = null;
        changed = true;
      }
    });
    const base = this.names.get(peer) ?? "GUEST";
    for (const d of want) {
      if (this.seatOf(peer, d) >= 0) continue;
      const i = this.o.seatFor ? this.o.seatFor({ peer, device: d }, this.seats) : this.defaultSeat(this.seats);
      if (i < 0 || i >= this.seats.length || this.seats[i]) continue;
      const name = nameOf
        ? nameOf(d)
        : this.o.nameFor
          ? this.o.nameFor(base, d, want.length)
          : want.length > 1
            ? `${base.slice(0, 10)}${d + 1}`
            : base;
      this.seats[i] = { peer, device: d, name, cid: this.o.link.peers?.get(peer)?.cid ?? "" };
      changed = true;
    }
    if (changed) {
      this.version++;
      this.o.onSeats?.(this.seats);
    }
  }

  /** Moves a seated device to another free seat (host-side, e.g. a validated "seat" request). */
  move(from: number, to: number): boolean {
    if (!this.seats[from] || to < 0 || to >= this.seats.length || this.seats[to]) return false;
    this.seats[to] = this.seats[from];
    this.seats[from] = null;
    this.version++;
    this.o.onSeats?.(this.seats);
    return true;
  }

  /** Offer every drained link message; true when it was a lobby message. */
  receive(m: NetMsg): boolean {
    if (m.t === "joined") {
      this.names.set(Number(m.id), String(m.name ?? "GUEST"));
      this.version++;
      return false;
    }
    if (m.t === "left") {
      const id = Number(m.id);
      this.wants.delete(id);
      this.names.delete(id);
      this.reseat(id);
      return false;
    }
    if (m.t !== "from") return false;
    const peer = Number(m.id);
    const up = (m.msg ?? {}) as NetMsg;
    if (up.t === "lb:want") {
      const ks = (Array.isArray(up.ks) ? up.ks : [])
        .map(Number)
        .filter((k) => Number.isInteger(k) && k >= 0 && k < 16)
        .slice(0, 8);
      this.wants.set(peer, [...new Set(ks)]);
      this.reseat(peer);
      return true;
    }
    if (up.t === "lb:req") {
      const device = Number(up.k);
      const ctx: LobbyRequestContext<S> = { peer, device, seat: this.seatOf(peer, device), state: this.state };
      if (this.o.apply(up.req as R, ctx)) this.version++;
      return true;
    }
    return false;
  }

  /** Broadcasts the state when it changed, and every resendMs. */
  update(now: number): void {
    if (this.version === this.sentVersion && now - this.sentAt < (this.o.resendMs ?? 1000)) return;
    this.sentVersion = this.version;
    this.sentAt = now;
    this.o.link.toPeer("all", { t: "lb:state", v: this.version, state: this.state, seats: this.seats });
  }

  /** Lockstep seats for a match: host devices local, guest devices remote, empty seats CPU (or dropped). */
  lockstepSeats(emptyIsCpu = true): SeatSpec[] {
    return this.seats.flatMap((s, i): SeatSpec[] => {
      if (!s) return emptyIsCpu ? [{ kind: "cpu", name: `CPU${i + 1}` }] : [];
      if (s.peer === 0) return [{ kind: "local", device: s.device, name: s.name }];
      return [{ kind: "remote", peer: s.peer, device: s.device, name: s.name }];
    });
  }
}

export interface LobbyGuestOptions<S> {
  link: GuestLink;
  /** Re-send interval of the wanted devices (default 1500 ms). */
  wantEveryMs?: number;
  onState?: (state: S, seats: (LobbySeat | null)[]) => void;
}

export class LobbyGuest<S, R = unknown> {
  state: S | null = null;
  seats: (LobbySeat | null)[] = [];
  /** Local device -> seat. */
  readonly mine = new Map<number, number>();
  version = -1;
  private o: LobbyGuestOptions<S>;
  private want: number[] = [];
  private wantSent = "";
  private wantAt = -1e9;

  constructor(opts: LobbyGuestOptions<S>) {
    this.o = opts;
  }

  /** The local devices that want seats (call when devices join or leave). */
  setDevices(devices: number[]): void {
    this.want = [...new Set(devices)];
  }

  /** Asks the host to apply a request for a device. `optimistic` mutates the local copy until the next state. */
  request(device: number, req: R, optimistic?: (s: S) => void): void {
    if (optimistic && this.state) optimistic(this.state);
    this.o.link.toHost({ t: "lb:req", k: device, req });
  }

  receive(m: NetMsg): boolean {
    if (m.t === "welcome") {
      this.wantSent = "";
      return false;
    }
    if (m.t !== "lb:state") return false;
    this.version = Number(m.v);
    this.state = m.state as S;
    this.seats = Array.isArray(m.seats) ? (m.seats as (LobbySeat | null)[]) : [];
    this.mine.clear();
    this.seats.forEach((s, i) => {
      if (s && (s.peer === this.o.link.id || (s.cid && s.cid === this.o.link.cid))) this.mine.set(s.device, i);
    });
    this.o.onState?.(this.state, this.seats);
    return true;
  }

  /** Sends the wanted devices on change and every wantEveryMs. */
  update(now: number): void {
    const s = JSON.stringify(this.want);
    if (s === this.wantSent && now - this.wantAt < (this.o.wantEveryMs ?? 1500)) return;
    this.wantSent = s;
    this.wantAt = now;
    this.o.link.toHost({ t: "lb:want", ks: this.want });
  }
}
