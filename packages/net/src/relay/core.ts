// Relay core: room routing with no I/O, shared by the node WebSocket relay (relay/node.ts) and the in-memory
// transport (memory.ts). A host opens a room (a short code) of some kind; peers join it by code or "the first
// open room of this kind". The relay never runs the game: peer messages ("up") go to the host as "from", host
// messages ("send") go to one peer or all of them, and the host's room meta feeds the room list. Joining a room
// whose host runs another build is refused here, before any game message flows.
//
// Heartbeat: every heartbeat() each connection is pinged; one that leaves `missedPings` pings in a row unanswered
// (no pong and no message) is terminated, which runs the normal leave path ("hostgone" to guests, "left" to the
// host). Grudge first dropped after one missed pong (3-6 s) and lost players on a LAN game night over short
// stalls (docs/LESSONS.md "Online (lockstep)"); ~3 missed pings rides those out.
import type { RelayError, RelayMsg, RoomInfo, RoomMeta } from "../protocol.ts";

/** One client connection as the core sees it. */
export interface RelayConn {
  send(text: string): void;
  /** Graceful close. */
  close(): void;
  /** Immediate close without a handshake (heartbeat timeout). */
  terminate(): void;
  /** Sends a transport-level ping (answered with core.alive(conn)). */
  ping(): void;
}

export interface RelayCoreOptions {
  /** Most rooms open at once (default 32). */
  maxRooms?: number;
  /** Most peers per room, the host excluded (default 8). */
  maxPeers?: number;
  /** Unanswered pings in a row before a connection is dropped (default 3). */
  missedPings?: number;
  /** Room code length (default 4 letters). */
  codeLength?: number;
  /** Allowed room kinds (default: any short string; "default" when none is given). */
  kinds?: string[];
  /** Host "result" messages (match results for a stats store). Called at most once a minute per room. */
  onResult?: (room: RoomInfo, result: unknown) => void;
  /** Random source for room codes (default Math.random; the relay is not part of any simulation). */
  random?: () => number;
  /** Wall clock in ms (default Date.now). */
  now?: () => number;
}

interface Client {
  conn: RelayConn;
  id: number;
  name: string;
  cid: string;
  role: "host" | "peer" | null;
  room: Room | null;
  missed: number;
}

interface Room {
  code: string;
  host: Client;
  peers: Map<number, Client>;
  meta: RoomMeta;
  created: number;
  reported: number;
}

export interface RelayCounters {
  opened: number;
  joins: number;
  refused: number;
  matches: number;
  messages: number;
  bytes: number;
  dropped: number;
}

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ";

/** Uppercase name-ish text: letters, digits and a little punctuation. */
export const cleanText = (v: unknown, n: number): string =>
  String(v ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9 '!.\-]/g, "")
    .trim()
    .slice(0, n);
const cleanId = (v: unknown, n: number) =>
  String(v ?? "")
    .replace(/[^A-Za-z0-9._\-]/g, "")
    .slice(0, n);
const clampInt = (v: unknown, lo: number, hi: number, d: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d;
};

export class RelayCore {
  readonly counters: RelayCounters = { opened: 0, joins: 0, refused: 0, matches: 0, messages: 0, bytes: 0, dropped: 0 };
  readonly started: number;
  private clients = new Map<RelayConn, Client>();
  private rooms = new Map<string, Room>();
  private nextId = 1;
  private opts: Required<Omit<RelayCoreOptions, "kinds" | "onResult">> & Pick<RelayCoreOptions, "kinds" | "onResult">;

  constructor(opts: RelayCoreOptions = {}) {
    this.opts = {
      maxRooms: opts.maxRooms ?? 32,
      maxPeers: opts.maxPeers ?? 8,
      missedPings: opts.missedPings ?? 3,
      codeLength: opts.codeLength ?? 4,
      kinds: opts.kinds,
      onResult: opts.onResult,
      random: opts.random ?? Math.random,
      now: opts.now ?? Date.now,
    };
    this.started = this.opts.now();
  }

  /** A new connection. */
  open(conn: RelayConn): void {
    this.clients.set(conn, { conn, id: 0, name: "", cid: "", role: null, room: null, missed: 0 });
  }

  /** The connection answered a ping (any message counts too). */
  alive(conn: RelayConn): void {
    const c = this.clients.get(conn);
    if (c) c.missed = 0;
  }

  /** Pings everyone; terminates connections that missed too many pings in a row. */
  heartbeat(): void {
    for (const c of [...this.clients.values()]) {
      if (c.missed >= this.opts.missedPings) {
        this.counters.dropped++;
        c.conn.terminate();
        this.closed(c.conn);
        continue;
      }
      c.missed++;
      try {
        c.conn.ping();
      } catch {
        c.conn.terminate();
        this.closed(c.conn);
      }
    }
  }

  get size(): number {
    return this.clients.size;
  }

  roomList(): RoomInfo[] {
    const now = this.opts.now();
    return [...this.rooms.values()].map((r) => this.info(r, now));
  }

  private info(r: Room, now = this.opts.now()): RoomInfo {
    return { code: r.code, ...r.meta, peers: r.peers.size, age: Math.round((now - r.created) / 1000) };
  }

  private send(c: Client, msg: RelayMsg | Record<string, unknown>): void {
    c.conn.send(JSON.stringify(msg));
  }

  private error(c: Client, code: RelayError, msg: string): void {
    this.counters.refused++;
    this.send(c, { t: "error", code, msg });
  }

  private newCode(): string {
    for (let tries = 0; ; tries++) {
      const len = this.opts.codeLength + (tries > 200 ? 1 : 0);
      let s = "";
      for (let i = 0; i < len; i++) s += CODE_CHARS[Math.floor(this.opts.random() * CODE_CHARS.length)];
      if (!this.rooms.has(s)) return s;
    }
  }

  private kind(v: unknown): string | null {
    const k = cleanId(v, 16).toLowerCase() || "default";
    if (this.opts.kinds && !this.opts.kinds.includes(k)) return null;
    return k;
  }

  /** A text frame from a connection. `extra` is merged into "hosting"/"welcome" replies (LAN addresses...). */
  message(conn: RelayConn, text: string, extra: Record<string, unknown> = {}): void {
    const c = this.clients.get(conn);
    if (!c) return;
    c.missed = 0;
    this.counters.messages++;
    this.counters.bytes += text.length;
    let m: { t?: unknown; [k: string]: unknown };
    try {
      m = JSON.parse(text);
    } catch {
      return;
    }
    if (!m || typeof m !== "object") return;
    const room = c.room;
    if (!c.role && m.t === "host") return this.host(c, m, extra);
    if (!c.role && m.t === "join") return this.join(c, m, extra);
    if (!room) return;
    if (c.role === "host") {
      if (m.t === "send") {
        const out = JSON.stringify(m.msg ?? null);
        if (m.to === "all") for (const p of room.peers.values()) p.conn.send(out);
        else room.peers.get(Number(m.to))?.conn.send(out);
      } else if (m.t === "meta") this.meta(room, (m.meta ?? {}) as Partial<RoomMeta>);
      else if (m.t === "kick") {
        const p = room.peers.get(Number(m.id));
        if (p) {
          if (typeof m.why === "string") this.send(p, { t: "kicked", why: m.why.slice(0, 120) });
          p.conn.close();
        }
      } else if (m.t === "result") {
        const now = this.opts.now();
        if (!this.opts.onResult || room.peers.size === 0 || now - room.reported < 60000) return;
        room.reported = now;
        this.opts.onResult(this.info(room, now), m.res);
      }
      return;
    }
    if (c.role === "peer" && m.t === "up") this.send(room.host, { t: "from", id: c.id, msg: m.msg ?? null });
  }

  private host(c: Client, m: Record<string, unknown>, extra: Record<string, unknown>): void {
    if (this.rooms.size >= this.opts.maxRooms) return this.error(c, "full", "THE SERVER IS FULL · TRY LATER");
    const kind = this.kind(m.kind);
    if (!kind) return this.error(c, "kind", "UNKNOWN ROOM KIND");
    c.role = "host";
    c.id = 0;
    c.name = cleanText(m.name, 16) || "HOST";
    c.cid = cleanId(m.cid, 40);
    const meta = (m.meta ?? {}) as Partial<RoomMeta>;
    const room: Room = {
      code: this.newCode(),
      host: c,
      peers: new Map(),
      created: this.opts.now(),
      reported: 0,
      meta: {
        name: `${c.name}'S ROOM`,
        kind,
        build: cleanId(m.build, 40),
        mode: "",
        players: 1,
        seats: 4,
        phase: "lobby",
        extra: {},
      },
    };
    c.room = room;
    this.rooms.set(room.code, room);
    this.meta(room, meta);
    this.counters.opened++;
    this.send(c, { t: "hosting", room: room.code, ...extra });
  }

  private join(c: Client, m: Record<string, unknown>, extra: Record<string, unknown>): void {
    const kind = this.kind(m.kind);
    if (!kind) return this.error(c, "kind", "UNKNOWN ROOM KIND");
    const code = cleanText(m.room, 8).replace(/[^A-Z]/g, "");
    const open = (r: Room) => r.meta.kind === kind && r.meta.phase === "lobby" && r.meta.players < r.meta.seats;
    const list = [...this.rooms.values()];
    const room = code ? this.rooms.get(code) : (list.find(open) ?? list.find((r) => r.meta.kind === kind));
    if (!room) return this.error(c, code ? "noroom" : "nobody", code ? `NO ROOM ${code}` : "NOBODY IS HOSTING YET");
    if (room.meta.kind !== kind) return this.error(c, "noroom", `NO ROOM ${code}`);
    const build = cleanId(m.build, 40);
    if (room.meta.build && build && room.meta.build !== build)
      return this.error(c, "build", `THE HOST RUNS ANOTHER VERSION (${room.meta.build} VS ${build}) · REFRESH BOTH`);
    if (room.peers.size >= this.opts.maxPeers) return this.error(c, "roomfull", "THAT ROOM IS FULL");
    c.role = "peer";
    c.id = this.nextId++;
    c.name = cleanText(m.name, 16) || "GUEST";
    c.cid = cleanId(m.cid, 40);
    c.room = room;
    room.peers.set(c.id, c);
    this.counters.joins++;
    this.send(c, { t: "welcome", id: c.id, room: room.code, name: room.meta.name, meta: room.meta, ...extra });
    this.send(room.host, { t: "joined", id: c.id, name: c.name, cid: c.cid });
  }

  private meta(room: Room, v: Partial<RoomMeta>): void {
    const phase = typeof v.phase === "string" ? cleanId(v.phase, 16) || room.meta.phase : room.meta.phase;
    if (phase !== "lobby" && room.meta.phase === "lobby") this.counters.matches++;
    const extra: Record<string, string | number | boolean> = {};
    const src = v.extra && typeof v.extra === "object" ? v.extra : room.meta.extra;
    for (const [k, x] of Object.entries(src).slice(0, 16))
      if (typeof x === "number" || typeof x === "boolean") extra[cleanId(k, 24)] = x;
      else if (typeof x === "string") extra[cleanId(k, 24)] = x.slice(0, 48);
    room.meta = {
      name: v.name === undefined ? room.meta.name : cleanText(v.name, 32) || room.meta.name,
      kind: room.meta.kind,
      build: room.meta.build,
      mode: v.mode === undefined ? room.meta.mode : cleanText(v.mode, 24),
      players: clampInt(v.players, 0, 64, room.meta.players),
      seats: clampInt(v.seats, 1, 64, room.meta.seats),
      phase,
      extra,
    };
  }

  /** The connection closed (either side). */
  closed(conn: RelayConn): void {
    const c = this.clients.get(conn);
    if (!c) return;
    this.clients.delete(conn);
    const room = c.room;
    if (!room) return;
    if (c.role === "host" && room.host === c) {
      this.rooms.delete(room.code);
      for (const p of room.peers.values()) {
        this.send(p, { t: "hostgone" });
        p.conn.close();
      }
      room.peers.clear();
    } else if (c.role === "peer") {
      room.peers.delete(c.id);
      this.send(room.host, { t: "left", id: c.id });
    }
  }

  /** Drops every connection (server shutdown). */
  closeAll(): void {
    for (const c of [...this.clients.values()]) {
      c.conn.close();
      this.closed(c.conn);
    }
  }
}
