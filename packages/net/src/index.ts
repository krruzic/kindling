// @kindling/net: online play for deterministic games (docs/LESSONS.md "Online (lockstep)"). Browser-safe exports:
// the relay client (NetLink), host-authoritative lockstep (LockstepHost / LockstepGuest), the mirrored lobby and
// the wire types. The node relay is at "@kindling/net/relay" and the in-memory test transport at
// "@kindling/net/memory".
export type { NetMsg, RoomMeta, RoomInfo, RelayInfo, RelayError, RelayMsg } from "./protocol.ts";
export {
  NetLink,
  type NetLinkOptions,
  type SocketLike,
  type SocketFactory,
  type PeerInfo,
  type CloseReason,
  type LinkState,
} from "./client.ts";
export {
  inputDelay,
  resolveDelay,
  mergeFields,
  quantize,
  mathPrint,
  diffSections,
  type CommandCodec,
  type LockstepSim,
  type SeatSpec,
  type WireSeat,
  type HostLink,
  type GuestLink,
  type StallInfo,
  type DesyncReport,
  type DropEvent,
  type DelayPolicy,
} from "./lockstep/types.ts";
export { LockstepHost, type LockstepHostOptions } from "./lockstep/host.ts";
export { LockstepGuest, type LockstepGuestOptions, type GuestStartInfo } from "./lockstep/guest.ts";
export {
  LobbyHost,
  LobbyGuest,
  type LobbySeat,
  type LobbyHostOptions,
  type LobbyGuestOptions,
  type LobbyRequestContext,
} from "./lobby.ts";

/** Fetches a relay's room list and LAN addresses (GET {base}{path}/info). */
export async function fetchRooms(base = "", path = "/net"): Promise<import("./protocol.ts").RelayInfo> {
  const res = await fetch(`${base}${path}/info`, { cache: "no-store" });
  if (!res.ok) throw new Error(`relay info: HTTP ${res.status}`);
  return res.json();
}
