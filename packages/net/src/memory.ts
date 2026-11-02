// In-memory transport: the real relay logic (RelayCore) behind fake WebSocket-like sockets on a virtual clock, with
// seeded random latency, jitter and optional reordering. NetLink takes `net.socket` as its socket factory and
// `() => net.now` as its clock, so the whole stack (relay, link, lockstep, lobby) runs in one node process with no
// sockets and no real time: tests step the clock with advance() and drive each machine's update() themselves.
import { RelayCore, type RelayConn, type RelayCoreOptions } from "./relay/core.ts";
import type { SocketLike } from "./client.ts";

export interface MemoryNetOptions {
  /** Seed for latency / jitter (deterministic runs). */
  seed?: number;
  /** One-way latency range per message in ms (default [5, 20]). */
  latencyMs?: [number, number];
  /** Deliver messages out of order when their random latencies cross (default false: in order, like TCP). */
  reorder?: boolean;
  /** Relay heartbeat interval in virtual ms (default 3500; 0 disables). */
  heartbeatMs?: number;
  relay?: RelayCoreOptions;
}

interface Event {
  at: number;
  seq: number;
  run: () => void;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A client socket on the in-memory network. */
export class MemorySocket implements SocketLike {
  readyState = 0;
  onopen: ((ev: never) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: never) => void) | null = null;
  onerror: ((ev: never) => void) | null = null;
  /** Per-socket latency override. */
  latencyMs: [number, number] | null = null;
  /** A frozen socket neither delivers nor answers pings (a sleeping laptop): the relay drops it on heartbeat. */
  frozen = false;
  /** Messages sent / received (tests). */
  sent = 0;
  received = 0;
  readonly conn: RelayConn;
  upAt = 0;
  downAt = 0;

  constructor(
    private net: MemoryNet,
    readonly url: string,
  ) {
    const self = this;
    this.conn = {
      send(text) {
        if (self.readyState !== 1) return;
        net.deliver(self, "down", () => {
          if (self.readyState !== 1 || self.frozen) return;
          self.received++;
          self.onmessage?.({ data: text });
        });
      },
      close() {
        self.serverClose();
      },
      terminate() {
        self.serverClose();
      },
      ping() {
        if (self.frozen || self.readyState !== 1) return;
        net.deliver(self, "down", () => net.deliver(self, "up", () => net.core.alive(self.conn)));
      },
    };
    net.deliver(this, "up", () => {
      if (this.readyState !== 0) return;
      net.core.open(this.conn);
      net.deliver(this, "down", () => {
        if (this.readyState !== 0) return;
        this.readyState = 1;
        this.onopen?.(undefined as never);
      });
    });
  }

  send(data: string): void {
    if (this.readyState !== 1) throw new Error("MemorySocket: not open");
    if (this.frozen) return;
    this.sent++;
    this.net.deliver(this, "up", () => this.net.core.message(this.conn, data));
  }

  close(): void {
    if (this.readyState >= 2) return;
    const wasOpen = this.readyState === 1;
    this.readyState = 2;
    this.net.deliver(this, "up", () => {
      if (wasOpen) this.net.core.closed(this.conn);
      this.net.deliver(this, "down", () => this.closedEvent());
    });
  }

  private serverClose(): void {
    if (this.readyState >= 2) return;
    this.net.deliver(this, "down", () => this.closedEvent());
    this.net.core.closed(this.conn);
  }

  private closedEvent(): void {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.onclose?.(undefined as never);
  }

  /**
   * The network goes away under this socket: the client sees a close at once; the relay only notices when
   * `relayNotices` (a clean TCP reset) or later through its heartbeat.
   */
  kill(relayNotices = true): void {
    if (this.readyState === 3) return;
    this.frozen = true;
    this.closedEvent();
    if (relayNotices) this.net.core.closed(this.conn);
  }
}

export class MemoryNet {
  now = 0;
  readonly core: RelayCore;
  readonly sockets: MemorySocket[] = [];
  private queue: Event[] = [];
  private seq = 0;
  private rand: () => number;
  private opts: MemoryNetOptions;
  private beatAt = 0;

  constructor(opts: MemoryNetOptions = {}) {
    this.opts = opts;
    this.rand = mulberry32(opts.seed ?? 1);
    this.core = new RelayCore({
      now: () => this.now,
      random: mulberry32((opts.seed ?? 1) ^ 0x9e3779b9),
      ...opts.relay,
    });
  }

  /** Socket factory for NetLink ({ socket: net.socket, now: net.clock }). */
  readonly socket = (url: string): MemorySocket => {
    const s = new MemorySocket(this, url);
    this.sockets.push(s);
    return s;
  };

  readonly clock = (): number => this.now;

  private latency(s: MemorySocket): number {
    const [lo, hi] = s.latencyMs ?? this.opts.latencyMs ?? [5, 20];
    return lo + this.rand() * (hi - lo);
  }

  /** Schedules a delivery on one direction of a socket (in order unless `reorder`). */
  deliver(s: MemorySocket, dir: "up" | "down", run: () => void): void {
    let at = this.now + this.latency(s);
    if (!this.opts.reorder) {
      const key = dir === "up" ? "upAt" : "downAt";
      at = Math.max(at, s[key]);
      s[key] = at;
    }
    this.schedule(at, run);
  }

  schedule(at: number, run: () => void): void {
    const e = { at, seq: this.seq++, run };
    let i = this.queue.length;
    while (i > 0 && (this.queue[i - 1].at > at || (this.queue[i - 1].at === at && this.queue[i - 1].seq > e.seq))) i--;
    this.queue.splice(i, 0, e);
  }

  /** Advances virtual time by `ms`, running every delivery and relay heartbeat that falls in it. */
  advance(ms: number): void {
    const end = this.now + ms;
    const beat = this.opts.heartbeatMs ?? 3500;
    for (;;) {
      const nextBeat = beat > 0 ? this.beatAt + beat : Infinity;
      const next = this.queue.length ? this.queue[0].at : Infinity;
      if (Math.min(next, nextBeat) > end) break;
      if (nextBeat <= next) {
        this.now = Math.max(this.now, nextBeat);
        this.beatAt = nextBeat;
        this.core.heartbeat();
        continue;
      }
      const e = this.queue.shift()!;
      this.now = Math.max(this.now, e.at);
      e.run();
    }
    this.now = end;
  }

  /** Messages still in flight. */
  get pending(): number {
    return this.queue.length;
  }
}
