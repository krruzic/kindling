// NetLink: the client side of the relay (relay/core.ts) over any WebSocket-like socket (the browser's WebSocket,
// the `ws` package in node, or the in-memory transport in tests). A link is either the HOST (owns a room, sends to
// one guest or all) or a GUEST (talks only to the host). Incoming messages queue up and the game loop drains them
// once per frame (drain / dispatch); link-level traffic is handled here and never reaches the inbox:
//
// - ping / RTT: a guest pings the host every `pingMs`; the host answers at once (not on its next frame, so the
//   RTT is the network's), the guest keeps the median of the last 5 and reports it back ("rtt"), so the host knows
//   every guest's RTT (rttOf) to choose an input delay.
// - host heartbeat ("hb" every `heartbeatMs`, with the tab's hidden flag): a guest that hears nothing from a host
//   for `hostQuietMs` (longer when the host said it was hidden: browsers throttle background tabs) closes with
//   reason "host-silent". The relay drops a dead socket; this catches a host that is connected but frozen.
// - reconnect: a guest whose socket drops (not the host leaving, not a kick) retries the same room with the same
//   client id for `reconnectMs`; the host recognises it by that id (lockstep rejoin replays the match).
//
// Synthesised inbox messages: {t:"closed", reason}, {t:"reconnecting"}, and "welcome" gets `again: true` after a
// reconnect. Call update(now) every frame (or set autoUpdateMs so heartbeats survive a throttled background tab).
import type { NetMsg, RoomMeta } from "./protocol.ts";

/** The part of the WebSocket interface NetLink uses (browser WebSocket and node `ws` both fit). */
export interface SocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(): void;
  onopen: ((ev: never) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: never) => void) | null;
  onerror: ((ev: never) => void) | null;
}
export type SocketFactory = (url: string) => SocketLike;

export type CloseReason = "left" | "host-left" | "host-silent" | "lost" | "refused" | "kicked" | "unreachable";
export type LinkState = "idle" | "connecting" | "open" | "reconnecting" | "closed";

export interface PeerInfo {
  id: number;
  name: string;
  /** The guest's client id (stable across its reconnects). */
  cid: string;
  /** Median RTT in ms as the guest reported it (-1 unknown). */
  rtt: number;
}

export interface NetLinkOptions {
  /** Full WebSocket URL; default `ws(s)://<page host><path>/ws`. */
  url?: string;
  /** Relay path prefix (default "/net"). */
  path?: string;
  /** This client's build id: the relay refuses joining a room whose host runs another build. */
  build?: string;
  /** Stable client id (keep it per tab, e.g. in sessionStorage); default random. */
  cid?: string;
  socket?: SocketFactory;
  /** Clock in ms (default performance.now). */
  now?: () => number;
  pingMs?: number;
  heartbeatMs?: number;
  hostQuietMs?: number;
  hostQuietHiddenMs?: number;
  /** Guest reconnect window in ms (0: never reconnect). Default 10000. */
  reconnectMs?: number;
  reconnectEveryMs?: number;
  /** Whether this page is hidden (sent in the host heartbeat). Default document.hidden when available. */
  hidden?: () => boolean;
  /** Calls update() on a timer (ms) so heartbeats and pings keep going while the game loop is throttled. */
  autoUpdateMs?: number;
}

const OPEN = 1;
const randomId = () => Math.random().toString(36).slice(2, 12) + Math.random().toString(36).slice(2, 6);

export class NetLink {
  role: "host" | "peer" | null = null;
  /** Relay id: 0 for the host, >0 for a guest, -1 before welcome. */
  id = -1;
  state: LinkState = "idle";
  /** Human-readable status / last error. */
  status = "";
  /** Room code. */
  room = "";
  roomName = "";
  /** The room's meta when joining (guests). */
  roomMeta: RoomMeta | null = null;
  /** The server's LAN addresses and public URL (from hosting / welcome). */
  addrs: string[] = [];
  publicUrl = "";
  readonly cid: string;
  readonly build: string;
  /** Host: connected guests. */
  readonly peers = new Map<number, PeerInfo>();
  /** Guest: median RTT to the host in ms (-1 unknown). */
  rtt = -1;
  /** Guest: whether the host's tab said it was hidden. */
  hostHidden = false;
  hostHeardAt = 0;
  name = "";
  kind = "default";
  /** Called as each message lands in the inbox (e.g. to wake an idle loop); the message stays queued. */
  onMessage: ((m: NetMsg) => void) | null = null;

  private opts: NetLinkOptions;
  private ws: SocketLike | null = null;
  private inbox: NetMsg[] = [];
  private rtts: number[] = [];
  private pingAt = -1e9;
  private hbAt = -1e9;
  private welcomed = false;
  private reconnectUntil = 0;
  private reconnectAt = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private hostMeta: Partial<RoomMeta> | undefined;

  constructor(opts: NetLinkOptions = {}) {
    this.opts = opts;
    this.cid = opts.cid ?? randomId();
    this.build = opts.build ?? "";
    if (opts.autoUpdateMs) {
      this.timer = setInterval(() => this.update(), opts.autoUpdateMs);
      (this.timer as { unref?: () => void }).unref?.();
    }
  }

  now(): number {
    return this.opts.now ? this.opts.now() : performance.now();
  }

  get open(): boolean {
    return !!this.ws && this.ws.readyState === OPEN && this.state === "open";
  }

  url(): string {
    if (this.opts.url) return this.opts.url;
    const path = (this.opts.path ?? "/net").replace(/\/$/, "");
    const loc = (globalThis as { location?: { protocol: string; host: string } }).location;
    if (!loc) throw new Error("NetLink: no url option and no page location");
    return `${loc.protocol === "https:" ? "wss" : "ws"}://${loc.host}${path}/ws`;
  }

  private factory(): SocketFactory {
    if (this.opts.socket) return this.opts.socket;
    const WS = (globalThis as { WebSocket?: new (url: string) => SocketLike }).WebSocket;
    if (!WS) throw new Error("NetLink: no WebSocket available; pass a socket factory");
    return (url) => new WS(url);
  }

  /** Opens a room of `kind` with optional initial meta. */
  host(opts: { name?: string; kind?: string; meta?: Partial<RoomMeta> } = {}): void {
    this.reset();
    this.role = "host";
    this.name = opts.name ?? "HOST";
    this.kind = opts.kind ?? "default";
    this.hostMeta = opts.meta;
    this.connect();
  }

  /** Joins room `room` (a code), or with none the first open room of `kind`. */
  join(opts: { name?: string; kind?: string; room?: string } = {}): void {
    this.reset();
    this.role = "peer";
    this.name = opts.name ?? "GUEST";
    this.kind = opts.kind ?? "default";
    this.room = opts.room ?? "";
    this.connect();
  }

  private reset(): void {
    this.drop();
    this.inbox = [];
    this.peers.clear();
    this.rtts = [];
    this.rtt = -1;
    this.id = -1;
    this.welcomed = false;
    this.reconnectUntil = 0;
    this.status = "";
  }

  private hello(): NetMsg {
    if (this.role === "host")
      return { t: "host", name: this.name, kind: this.kind, build: this.build, cid: this.cid, meta: this.hostMeta };
    return { t: "join", name: this.name, kind: this.kind, build: this.build, cid: this.cid, room: this.room || null };
  }

  private connect(): void {
    this.drop();
    if (this.state !== "reconnecting") this.state = "connecting";
    this.status = this.state === "reconnecting" ? "RECONNECTING..." : "CONNECTING...";
    let ws: SocketLike;
    try {
      ws = this.factory()(this.url());
    } catch (e) {
      this.status = String((e as Error).message ?? e);
      if (this.state !== "reconnecting") this.finish("unreachable");
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      if (this.ws === ws) ws.send(JSON.stringify(this.hello()));
    };
    ws.onmessage = (e) => {
      if (this.ws !== ws) return;
      let m: NetMsg;
      try {
        m = JSON.parse(String(e.data));
      } catch {
        return;
      }
      if (m && typeof m === "object" && typeof m.t === "string") this.receive(m);
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.lost();
    };
    ws.onerror = () => {
      if (this.ws === ws && this.state === "connecting") this.status = "COULD NOT REACH THE SERVER";
    };
  }

  private receive(m: NetMsg): void {
    const now = this.now();
    if (m.t === "hosting") {
      this.state = "open";
      this.id = 0;
      this.welcomed = true;
      this.room = String(m.room ?? "");
      this.addrs = (m.addrs as string[]) ?? [];
      this.publicUrl = String(m.public ?? "");
      this.status = "";
      this.push(m);
      return;
    }
    if (m.t === "welcome") {
      const again = this.welcomed;
      this.state = "open";
      this.welcomed = true;
      this.reconnectUntil = 0;
      this.id = Number(m.id);
      this.room = String(m.room ?? "");
      this.roomName = String(m.name ?? "");
      this.roomMeta = (m.meta as RoomMeta) ?? null;
      this.addrs = (m.addrs as string[]) ?? [];
      this.publicUrl = String(m.public ?? "");
      this.hostHeardAt = now;
      this.status = "";
      this.push(again ? { ...m, again: true } : m);
      return;
    }
    if (m.t === "error") {
      this.status = String(m.msg ?? "ERROR");
      this.push(m);
      this.finish(this.state === "reconnecting" && m.code === "noroom" ? "host-left" : "refused");
      return;
    }
    if (this.role === "host") {
      if (m.t === "joined") {
        const id = Number(m.id);
        this.peers.set(id, { id, name: String(m.name ?? "GUEST"), cid: String(m.cid ?? ""), rtt: -1 });
      } else if (m.t === "left") this.peers.delete(Number(m.id));
      else if (m.t === "from") {
        const id = Number(m.id);
        const up = (m.msg ?? {}) as NetMsg;
        if (up.t === "ping") return this.toPeer(id, { t: "pong", s: up.s });
        if (up.t === "rtt") {
          const p = this.peers.get(id);
          if (p) p.rtt = Math.max(0, Number(up.ms) || 0);
          return;
        }
      }
      this.push(m);
      return;
    }
    // guest: everything else comes from the host (or the relay about the host)
    this.hostHeardAt = now;
    if (m.t === "hb") {
      this.hostHidden = m.hidden === true;
      return;
    }
    if (m.t === "pong") {
      this.rtts.push(Math.max(0, now - Number(m.s)));
      if (this.rtts.length > 5) this.rtts.shift();
      this.rtt = Math.round([...this.rtts].sort((a, b) => a - b)[this.rtts.length >> 1]);
      this.toHost({ t: "rtt", ms: this.rtt });
      return;
    }
    if (m.t === "hostgone") {
      this.push(m);
      this.finish("host-left");
      return;
    }
    if (m.t === "kicked") {
      this.status = String(m.why ?? "");
      this.push(m);
      this.finish("kicked");
      return;
    }
    this.push(m);
  }

  /** The socket closed without us asking. */
  private lost(): void {
    if (this.state === "closed" || this.state === "idle") return;
    const now = this.now();
    if (this.state === "reconnecting") return;
    const canRetry = this.role === "peer" && this.welcomed && (this.opts.reconnectMs ?? 10000) > 0;
    if (!canRetry) return this.finish(this.welcomed ? "lost" : "unreachable");
    this.state = "reconnecting";
    this.status = "RECONNECTING...";
    this.reconnectUntil = now + (this.opts.reconnectMs ?? 10000);
    this.reconnectAt = now;
    this.push({ t: "reconnecting" });
  }

  private finish(reason: CloseReason): void {
    if (this.state === "closed") return;
    this.drop();
    this.state = "closed";
    this.reconnectUntil = 0;
    this.push({ t: "closed", reason });
  }

  private drop(): void {
    const ws = this.ws;
    this.ws = null;
    if (ws && ws.readyState <= OPEN) {
      try {
        ws.close();
      } catch {
        // already gone
      }
    }
  }

  /** Leaves (no reconnect). The inbox gets {t:"closed", reason:"left"}. */
  close(): void {
    if (this.state === "idle" || this.state === "closed") {
      this.drop();
      return;
    }
    this.finish("left");
  }

  /** Stops the auto-update timer and closes. */
  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.close();
  }

  /** Pings, host heartbeat, host-silence watchdog and reconnect attempts. */
  update(now = this.now()): void {
    if (this.state === "reconnecting") {
      if (now > this.reconnectUntil) return this.finish("lost");
      if (!this.ws && now - this.reconnectAt >= (this.opts.reconnectEveryMs ?? 1500)) {
        this.reconnectAt = now;
        this.connect();
      }
      return;
    }
    if (!this.open) return;
    if (this.role === "host") {
      if (this.peers.size && now - this.hbAt >= (this.opts.heartbeatMs ?? 1000)) {
        this.hbAt = now;
        const doc = (globalThis as { document?: { hidden?: boolean } }).document;
        this.toPeer("all", { t: "hb", hidden: this.opts.hidden ? this.opts.hidden() : !!doc?.hidden });
      }
      return;
    }
    if (now - this.pingAt >= (this.opts.pingMs ?? 1000)) {
      this.pingAt = now;
      this.toHost({ t: "ping", s: now });
    }
    const limit = this.hostHidden ? (this.opts.hostQuietHiddenMs ?? 90000) : (this.opts.hostQuietMs ?? 15000);
    if (now - this.hostHeardAt > limit) {
      this.status = "LOST THE HOST · IT STOPPED RESPONDING";
      this.finish("host-silent");
    }
  }

  private push(m: NetMsg): void {
    this.inbox.push(m);
    this.onMessage?.(m);
  }

  /** Messages received since the last drain. */
  drain(): NetMsg[] {
    const out = this.inbox;
    this.inbox = [];
    return out;
  }

  /** Drains and offers each message to the handlers in order until one returns true. */
  dispatch(...handlers: ((m: NetMsg) => boolean | void)[]): NetMsg[] {
    const all = this.drain();
    for (const m of all) for (const h of handlers) if (h(m) === true) break;
    return all;
  }

  private raw(msg: unknown): void {
    if (this.ws && this.ws.readyState === OPEN) this.ws.send(JSON.stringify(msg));
  }

  /** Host: to one guest or all. */
  toPeer(to: number | "all", msg: NetMsg): void {
    if (this.role === "host" && this.open) this.raw({ t: "send", to, msg });
  }

  /** Guest: to the host. */
  toHost(msg: NetMsg): void {
    if (this.role === "peer" && this.open) this.raw({ t: "up", msg });
  }

  /** Host: room meta for the room list (merged by the relay). */
  meta(meta: Partial<RoomMeta>): void {
    if (this.role === "host" && this.open) this.raw({ t: "meta", meta });
  }

  /** Host: disconnects a guest (it gets {t:"kicked", why} and closes without reconnecting). */
  kick(id: number, why?: string): void {
    if (this.role === "host" && this.open) this.raw({ t: "kick", id, why });
  }

  /** Host: a match result for the relay's onResult hook (a stats store). */
  result(res: unknown): void {
    if (this.role === "host" && this.open) this.raw({ t: "result", res });
  }

  /** Host: a guest's RTT in ms (-1 unknown). */
  rttOf(peer: number): number {
    return this.peers.get(peer)?.rtt ?? -1;
  }

  /** Test hook: drops the socket as if the network went away (a guest then reconnects). */
  sever(): void {
    const ws = this.ws;
    if (!ws) return;
    this.ws = null;
    try {
      ws.close();
    } catch {
      // already gone
    }
    this.lost();
  }
}
