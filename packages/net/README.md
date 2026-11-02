# @kindling/net

Online play for deterministic games: a dumb WebSocket room relay (node, plus a Vite plugin for dev), a client link,
host-authoritative **lockstep** with hash checks, stalls, drops to CPU and rejoin by replay, a mirrored **lobby**, and
an **in-memory transport** so all of it can be tested in node without sockets or real time.

## Why

Grudge (2v2 arena RTS) and QUICKLORE (party game) both shipped online play built on one deterministic simulation:
only per-tick commands travel, every machine steps the same world. This package is that stack with nothing
game-specific left in it. The rules it follows, and the bugs behind them, are in
[docs/LESSONS.md "Online (lockstep)"](../../docs/LESSONS.md#online-lockstep) (and "Architecture" for why the
simulation has to be deterministic in the first place):

- the relay never runs the game; it routes and lists rooms (with LAN addresses and a kind);
- the host merges everyone's commands (input delay = a few ticks + one RTT), steps, broadcasts frames, and a world
  hash plus **section hashes** every 30 ticks, so a desync says _where_;
- heartbeats tolerate ~3 missed pings (dropping after 3-6 s killed a LAN game night);
- guests may bring several local seats (the case that broke in our 8-player test);
- version check on join, a "waiting for P3..." stall overlay, a dropped guest becomes a CPU after a grace period,
  rejoin by replaying every frame, a clear message when the host leaves;
- an online pause is a local menu: the sim keeps running.

## Layout

| Import                 | What                                                                                       |
| ---------------------- | ------------------------------------------------------------------------------------------ |
| `@kindling/net`        | `NetLink`, `LockstepHost`, `LockstepGuest`, `LobbyHost`, `LobbyGuest`, helpers, wire types |
| `@kindling/net/relay`  | `createRelay()` (node, `ws`), `lanAddresses()`, `RelayCore`                                |
| `@kindling/net/memory` | `MemoryNet`: the real relay core behind fake sockets on a virtual clock                    |

## API

### Relay (node)

```ts
import { createRelay } from "@kindling/net/relay";

const relay = createRelay({
  path: "/net", // ws at /net/ws, JSON at /net/info and /net/stats
  maxRooms: 32,
  maxPeers: 8,
  heartbeatMs: 3500, // ping interval
  missedPings: 3, // unanswered pings in a row before a socket is dropped (~10-14 s)
  stats: true, // serve /net/stats counters
  kinds: ["versus", "campaign"], // optional whitelist of room kinds
  publicUrl: () => process.env.PUBLIC_URL ?? "",
  onResult: (room, result) => saveResult(room, result), // host's link.result(...)
});

// Vite (dev + preview): plugins: [relay.vitePlugin()]
// Production node server on the same port:
const server = http.createServer((req, res) => relay.handleRequest(req, res) || serveStatic(req, res));
relay.attach(server); // or call relay.handleUpgrade(req, socket, head) from your own "upgrade" listener
```

Rooms have a 4-letter code, a kind, and meta the host sets (`name`, `mode`, `players`, `seats`, `phase`, `build`,
`extra`). A code-less join finds the first `phase: "lobby"` room of its kind with free seats. Joining a room whose
host runs another build is refused by the relay (`{t:"error", code:"build"}`). `GET /net/info` returns
`{ rooms, addrs, public, players }` (`fetchRooms()` in the browser).

Relay protocol: `host`/`join` -> `hosting`/`welcome` | `error`; host `send {to, msg}`, `meta`, `kick`, `result`;
guest `up {msg}`; the host receives `joined {id, name, cid}`, `left {id}`, `from {id, msg}`; guests receive the host's
messages as they are, and `hostgone`.

### NetLink (client)

```ts
const link = new NetLink({ build: BUILD, cid: tabId() /* sessionStorage */, autoUpdateMs: 500 });
link.host({ name: "KAY", kind: "versus", meta: { seats: 4 } }); // or link.join({ name, kind, room: "ABCD" })

// every frame:
link.update(now);
link.dispatch(
  (m) => lockstep.receive(m),
  (m) => lobby.receive(m),
  (m) => myGameMessages(m),
);
```

- `toPeer(id | "all", msg)` (host), `toHost(msg)` (guest), `meta({...})`, `kick(id, why)`, `result(res)`.
- `rtt` (guest, median of 5) and `rttOf(peer)` / `peers` (host: name, cid, rtt).
- The guest pings every second, the host answers immediately; the host sends a heartbeat (with its tab's hidden
  flag); a guest closes with `host-silent` after 15 s of silence (90 s if the host said it was hidden).
- A guest whose socket drops reconnects to the same room with the same `cid` for `reconnectMs` (10 s).
- Synthesised messages: `{t:"closed", reason}` (`left`, `host-left`, `host-silent`, `lost`, `refused`, `kicked`,
  `unreachable`), `{t:"reconnecting"}`, and `welcome` with `again: true` after a reconnect.
- `socket` option: any WebSocket-like factory (browser default, `ws` in node, `MemoryNet.socket` in tests).

### Lockstep

```ts
interface CommandCodec<Cmd, Packed> {
  pack(c: Cmd): Packed; // JSON-safe, compact (QUICKLORE packed a whole command into one integer)
  unpack(p: Packed): Cmd;
  merge(queue: Cmd[], last: Cmd): Cmd; // several inputs within one tick -> one command; never lose a tap
  idle: Cmd;
}
interface LockstepSim<Cmd> {
  step(cmds: Cmd[]): void; // one command per seat
  hash(): number;
  sectionHashes?(): number[]; // named by the `sections` option
  sections?(): { total: number; sections: Record<string, number> }; // or @kindling/core's form: a core Sim plugs in as is
}
```

With a core-style `sections()` the host takes the section names from the sim (no `sections` option needed) and sends
them to guests; `hashRow(sim, names)` / `sectionNamesOf(sim)` are the helpers. `mergeFields(queue, last, idle, ["moveX", "moveY", "block"])` is a ready-made merge for object commands (listed
fields from the newest input, every other field's first truthy value), `quantize()` rounds sticks, `inputDelay()`
is the default delay policy (3 + one RTT in ticks, at most 12), `mathPrint()` fingerprints the engine's float math.

**Host**

```ts
const host = new LockstepHost<Cmd, Packed, Spec>({
  link,
  codec,
  tickMs: 1000 / 60,
  build: BUILD,
  sections: ["players", "units", "rng", "match"],
  cpu: (seat, tick) => bots[seat].command(world), // CPU seats think only on the host
  leave: "idle",
  graceMs: 10000, // a disconnected guest's seats idle, then a CPU takes them
  dropAfterMs: 10000,
  stallShowMs: 300, // late inputs: stall, show, then CPU
  onStall: (s) => hud.wait(s && `WAITING FOR ${s.names.join(", ")}... CPU IN ${Math.ceil(s.dropInMs / 1000)}`),
  onDrop: ({ seats }) => seats.forEach((i) => (bots[i] = new Bot(i))),
  onReturn: ({ seats }) => seats.forEach((i) => (bots[i] = null)),
  onDesync: (r) => console.warn(`P${r.seats} out of sync at ${r.tick}: ${r.sections}`),
  onStep: (tick) => presentation.consume(world.events),
});
host.start(spec, lobby.lockstepSeats(), world); // seats: {kind:"local",device} | {kind:"remote",peer,device} | {kind:"cpu"}
// every frame: host.input(device, cmd) for each local device, then host.update(now)
host.end(); // back to the lobby for everyone
```

**Guest**

```ts
const guest = new LockstepGuest<Cmd, Packed, Spec>({
  link,
  codec,
  build: BUILD,
  createSim: (spec, info) => (world = new World(spec)), // info.mine: device -> seats, info.resume, info.mathDiffers
  onStep: (tick, cmds, replaying) => replaying || presentation.consume(world.events),
  onStall: (s) => hud.wait(s && (s.reason === "host" ? "WAITING FOR THE HOST..." : `WAITING FOR ${s.names}...`)),
  onDesync: (r) => hud.banner(`OUT OF SYNC (${r.sections.join(", ")})`),
  onDrop: (e) => e.mine && hud.banner("YOU WERE DROPPED · A CPU PLAYS FOR YOU"),
  onEnd: (why) => toMenu(why === "host-left" ? "THE HOST HAS LEFT" : ""),
  onRefused: (why) => toMenu(why),
});
// every frame: guest.input(device, cmd) for each local device, then guest.update(now)
```

Messages are `ls:start`, `ls:f` (frames + hash rows), `ls:in`, `ls:live`, `ls:wait`, `ls:drop`, `ls:back`,
`ls:desync`, `ls:end`. Frames, inputs and hashes are keyed by tick and carry a match id, so reordered or stale
messages are harmless.

### Lobby

```ts
const lobby = new LobbyHost<SelectState, SelectReq>({
  link,
  state: initialSelect(),
  seats: 4,
  apply: (req, { seat, state }) => seat >= 0 && pick(state, seat, req), // validate! return true if changed
});
lobby.setLocal(localDevices); // the host's own devices
lobby.change((s) => (s.map = next)); // host-side edits; broadcast on change + every second
lobby.update(now);

const mirror = new LobbyGuest<SelectState, SelectReq>({ link, onState: draw });
mirror.setDevices(connectedDevices); // every device that pressed a button wants a seat
mirror.request(device, { pick: "ash" }, (s) => (s.picks[mirror.mine.get(device)!] = "ash")); // optimistic
mirror.update(now);
```

Each guest device gets its own seat (`mine: device -> seat`); seats free when a device or guest leaves.
`setOpen(false)` freezes seats during a match (lockstep handles departures), `lockstepSeats()` converts the table.

### In-memory transport

```ts
import { MemoryNet } from "@kindling/net/memory";
const net = new MemoryNet({ seed: 1, latencyMs: [20, 120], reorder: true });
const link = new NetLink({ url: "mem://x/net/ws", socket: net.socket, now: net.clock });
net.advance(16); // deliver what is due, run relay heartbeats; then call each machine's update(net.now)
```

`socket.kill()` simulates a network drop, `socket.frozen` a sleeping laptop, `socket.latencyMs` a bad link.

## Integration guide

1. **Serve the relay** from the dev server (`relay.vitePlugin()`) and from the production server on the same port.
2. **Lobby phase.** Host: `link.host(...)`, a `LobbyHost` over your select-screen state, `link.meta(...)` when the
   room's name/players/phase change (the room list reads it). Guest: browse `fetchRooms()` or type a code,
   `link.join(...)`, a `LobbyGuest`, forward device input as requests. Every request is validated on the host.
3. **Start.** The host builds the spec (everything `new World()` needs: seed, map, rules, characters, levels), calls
   `host.start(spec, lobby.lockstepSeats(), world)` and `lobby.setOpen(false)`; guests build the same world in
   `createSim`.
4. **Every frame**, on both sides: `link.update(now)`, `link.dispatch(...)`, `input(device, cmd)` for every local
   device (feed idle for a player whose local pause menu is open: the sim must keep running), `update(now)`, then
   render from the world.
5. **After the match:** `host.end()`, `lobby.setOpen(true)`, back to select.
6. **Keep the host's tab in the foreground** (browsers throttle background tabs); `autoUpdateMs` keeps the
   heartbeat alive meanwhile, and guests wait 90 s for a host that said it was hidden.

What the game must keep **deterministic** (everything inside `step`):

- the world reads only the spec and the commands: no `Math.random` (use a seeded RNG stored in the world), no
  `Date`/`performance.now`, no DOM, camera or renderer state, no module-level caches (two worlds in one process
  must not share state);
- iteration order must be stable (arrays, not object key order from untrusted data; no `Set`/`Map` iteration over
  things inserted in non-deterministic order);
- commands are quantised (`quantize`) before they enter the world, and the host steps on the _unpacked_ commands
  exactly like guests do (LockstepHost does this);
- CPU bots run only on the host, inside the `cpu` callback, deterministically from the world;
- presentation (sounds, particles, cosmetics, holidays) stays outside the world; hash every section that matters
  (players, units, projectiles, rng state, match clock) so a desync report points at it;
- transcendental float math (`sin`, `pow`...) is not bit-exact across engines: compare `info.mathDiffers` and warn.

Run a determinism check (fixed seeded matches hashed against a committed baseline) before every commit; the tests
here show the online side with a toy sim.

## How Grudge used it

Grudge's `tools/netrelay.ts`, `src/net/link.ts`, `src/net/session.ts`, `src/app/net.ts`, `src/app/lobby.ts` and the
campaign co-op code (`src/app/coop.ts`), via QUICKLORE's generalised port, are what this package replaces:
versus rooms and campaign rooms are room `kind`s; the select screen mirrored to guests (picks, seals, costumes,
cursors) is a `LobbyHost` state; the 30-tick world hash with section hashes, "WAITING FOR P3...", the co-op guest's
champion standing idle for 10 s before a CPU plays it, and a returning guest replaying the stage's frames are
`LockstepHost` options; QUICKLORE's input delay (3 + RTT in ticks) is the default delay policy.

## Tests

`pnpm test`: a toy deterministic sim run by a host and 2-3 guests (one with two local seats) over the in-memory
transport with jitter and reordering (identical hashes), desync injection detected with the right section, stall ->
CPU, disconnect -> idle grace -> CPU, rejoin by replay, late-join spectating, version refusal, host leaving, the
mirrored lobby, and the node relay over real WebSockets on an ephemeral port (rooms, routing, meta, room list,
kinds, build refusal, heartbeat drop after missed pings but not after one miss).
