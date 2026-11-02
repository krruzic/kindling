// Wire types shared by the relay (relay/core.ts), the client (client.ts) and the higher layers. Messages are JSON
// objects with a `t` field. Relay messages are listed here; lockstep messages use the "ls:" prefix and lobby
// messages "lb:", so one drained message stream can be offered to every layer and each takes its own.

/** Any message. */
export type NetMsg = { t: string; [k: string]: unknown };

/** Room metadata the host sets (shown in room lists). `players`/`seats` decide whether a room is "open". */
export interface RoomMeta {
  name: string;
  /** Room kind (e.g. "versus" / "campaign"): joins without a code only find rooms of their own kind. */
  kind: string;
  /** The host's build id: a guest on another build is refused by the relay. */
  build: string;
  mode: string;
  players: number;
  seats: number;
  /** "lobby" rooms with free seats are offered to code-less joins; anything else ("match"...) is in progress. */
  phase: string;
  /** Free-form small values for the game's room list (map name, stage...). */
  extra: Record<string, string | number | boolean>;
}

export interface RoomInfo extends RoomMeta {
  code: string;
  /** Guests connected (the host excluded). */
  peers: number;
  /** Seconds since the room opened. */
  age: number;
}

/** The relay's JSON info endpoint (GET {path}/info). */
export interface RelayInfo {
  rooms: RoomInfo[];
  /** host:port of each LAN interface of the server (so players on the same network can type it in). */
  addrs: string[];
  /** A public URL to advertise (tunnel), or "". */
  public: string;
  players: number;
}

export type RelayError = "full" | "kind" | "noroom" | "nobody" | "build" | "roomfull";

/** Messages the relay sends. */
export type RelayMsg =
  | { t: "hosting"; room: string; addrs?: string[]; public?: string }
  | { t: "welcome"; id: number; room: string; name: string; meta: RoomMeta; addrs?: string[]; public?: string }
  | { t: "error"; code: RelayError; msg: string }
  | { t: "joined"; id: number; name: string; cid: string }
  | { t: "left"; id: number }
  | { t: "from"; id: number; msg: unknown }
  | { t: "hostgone" }
  | { t: "kicked"; why: string };
