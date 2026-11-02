// Headless online play over @kindling/net/memory with the game's own OnlineSession (the code the browser runs):
// a host and two guests (one bringing two local players) plus a CPU slot play a whole match with jitter; every
// machine ends with the same world hash and winner. Then a guest drops mid-match (a CPU takes its seat and the
// match finishes in sync), and a guest that reconnects replays the match and catches up.
import { NetLink } from "@kindling/net";
import { MemoryNet, type MemorySocket } from "@kindling/net/memory";
import { assert, test } from "./harness.ts";
import { OnlineSession, ROOM_KIND, type SessionNote } from "../src/net/session.ts";
import { addCpu, canStart } from "../src/app/select.ts";
import { Bot } from "../src/sim/bot.ts";
import { ROVERS, type Command } from "../src/sim/types.ts";

const BUILD = "test";

interface Machine {
  name: string;
  link: NetLink;
  session: OnlineSession;
  devices: number[];
  notes: SessionNote[];
  sockets: MemorySocket[];
  /** A bot per local device, playing from this machine's own world copy. */
  pilots: Map<number, Bot>;
  frozen: boolean;
}

class Net {
  net = new MemoryNet({ seed: 5, latencyMs: [15, 70], reorder: false });
  host: Machine;
  guests: Machine[] = [];

  constructor() {
    this.host = this.machine("host", "host", [0], {});
    this.host.link.host({ name: "HOST", kind: ROOM_KIND, meta: { seats: 4, mode: "FFA" } });
    this.until(() => this.host.link.room !== "", 2000);
    this.host.session.setLocal([{ device: 0, name: "HOSTY" }]);
  }

  machine(name: string, role: "host" | "guest", devices: number[], linkOpts: { reconnectMs?: number }): Machine {
    const sockets: MemorySocket[] = [];
    const link = new NetLink({
      url: "mem://relay/net/ws",
      socket: (u) => {
        const s = this.net.socket(u);
        sockets.push(s);
        return s;
      },
      now: this.net.clock,
      build: BUILD,
      cid: `${name}-cid`,
      ...linkOpts,
    });
    const notes: SessionNote[] = [];
    const session = new OnlineSession({
      link,
      role,
      build: BUILD,
      seed: () => 4242,
      note: (n) => notes.push(n),
      graceMs: 1500,
      dropAfterMs: 3000,
    });
    return { name, link, session, devices, notes, sockets, pilots: new Map(), frozen: false };
  }

  addGuest(devices: number[], o: { reconnectMs?: number } = {}): Machine {
    const g = this.machine(`guest${this.guests.length}`, "guest", devices, o);
    g.link.join({ name: g.name.toUpperCase(), kind: ROOM_KIND, room: this.host.link.room });
    g.session.setLocal(devices.map((d) => ({ device: d, name: `${g.name}${d}` })));
    this.guests.push(g);
    this.until(() => g.link.state === "open", 3000);
    return g;
  }

  get all(): Machine[] {
    return [this.host, ...this.guests];
  }

  frame(m: Machine): void {
    const s = m.session;
    const w = s.world;
    if (w && s.inMatch)
      for (const d of m.devices) {
        const seat = s.seatsOf(d)[0];
        if (seat === undefined) continue;
        let bot = m.pilots.get(d);
        if (!bot || bot.seat !== seat) m.pilots.set(d, (bot = new Bot(seat, 900 + d + m.name.length, 0.6)));
        const cmd: Command = bot.command(w);
        s.input(d, cmd);
      }
    s.update(this.net.now);
    s.drain();
  }

  step(ms = 16): void {
    this.net.advance(ms);
    for (const m of this.all) if (!m.frozen) this.frame(m);
  }

  until(pred: () => boolean, maxMs: number, what = "condition"): void {
    const end = this.net.now + maxMs;
    while (!pred()) {
      if (this.net.now > end) throw new Error(`timed out waiting for ${what}`);
      this.step();
    }
  }

  readyAll(): void {
    for (const m of this.all)
      for (const d of m.devices) {
        const slot = m.session.slotOf(d);
        if (slot >= 0 && !m.session.state!.slots[slot].ready) m.session.request(d, { op: "ready", on: true });
      }
  }

  /** Lobby: everyone seated, rovers changed, CPU added, all ready; then the host starts. */
  lobbyAndStart(cpus = 1): void {
    this.until(
      () => this.host.session.seats.filter(Boolean).length === this.all.reduce((n, m) => n + m.devices.length, 0),
      6000,
      "seats",
    );
    this.guests[0].session.request(this.guests[0].devices[0], { op: "rover", dir: 1 });
    for (let i = 0; i < cpus; i++) this.host.session.edit((s) => void addCpu(s));
    this.until(() => (this.readyAll(), canStart(this.host.session.state!)), 6000, "ready");
    // every guest sees the same lobby the host has
    this.until(
      () => this.guests.every((g) => JSON.stringify(g.session.state) === JSON.stringify(this.host.session.state)),
      4000,
      "lobby mirrored",
    );
    assert.ok(this.host.session.startMatch(2), "match starts");
    this.until(() => this.guests.every((g) => g.session.inMatch), 3000, "guests started");
  }

  finish(maxMs = 600000): void {
    const h = this.host.session;
    this.until(() => !!h.world?.over, maxMs, "match over");
    // Freeze the host (it keeps stepping idle ticks after the match) and let the guests drain every frame.
    this.host.frozen = true;
    const live = this.guests.filter((g) => !g.frozen && g.link.state === "open");
    this.until(() => live.every((g) => g.session.world!.tick >= h.world!.tick), 20000, "guests catch up");
    this.host.frozen = false;
  }
}

test("online: host + 2 guests (one with two players) play a whole match in lockstep", () => {
  const n = new Net();
  const a = n.addGuest([0]);
  const b = n.addGuest([0, 1]);
  n.lobbyAndStart(0);
  const spec = n.host.session.spec!;
  assert.equal(spec.rovers.length, 4);
  assert.deepEqual(spec.cpu, [false, false, false, false]);
  const aSlot = n.host.session.lobbyHost!.seatOf(a.link.id, 0);
  assert.equal(spec.rovers[aSlot], ROVERS[(aSlot + 1) % ROVERS.length], "a's rover pick reached the spec");
  n.finish();
  const h = n.host.session.world!;
  for (const g of [a, b]) {
    const w = g.session.world!;
    assert.equal(w.tick, h.tick, `${g.name} tick`);
    assert.equal(w.hash(), h.hash(), `${g.name} hash`);
    assert.equal(w.state.match.winner, h.state.match.winner);
    assert.ok(!g.notes.some((x) => x.type === "desync"), `${g.name} desync`);
  }
  assert.ok(h.state.match.winner >= 0, "someone won");
  assert.ok((n.host.session.host!.stats.steps ?? 0) > 600, "real match length");
  // rematch: back to the lobby for everyone, ready flags cleared
  n.host.session.endMatch();
  n.until(() => n.guests.every((g) => !g.session.inMatch && g.session.state?.phase === "pick"), 4000, "back to lobby");
  assert.ok(n.host.session.state!.slots.every((x) => x.kind !== "human" || !x.ready));
});

test("online: a guest that drops is taken over by a CPU; a reconnecting guest replays and catches up", () => {
  const n = new Net();
  const a = n.addGuest([0], { reconnectMs: 0 });
  const b = n.addGuest([0]);
  n.lobbyAndStart(1);
  assert.deepEqual(n.host.session.spec!.cpu, [false, false, false, true]);
  n.until(() => n.host.session.world!.tick > 300, 20000, "tick 300");
  // a: the network cable goes (no reconnect): idle grace, then a CPU plays its seat
  const aSeat = n.host.session.lobbyHost!.seatOf(a.link.id, 0);
  a.frozen = true;
  for (const s of a.sockets) s.kill();
  n.until(() => n.host.session.bots.filter((x) => x !== null).length === 2, 10000, "cpu takeover");
  assert.ok(aSeat >= 0);
  assert.ok(
    n.host.notes.some((x) => x.type === "drop"),
    "host noted the drop",
  );
  // b: its socket dies but it reconnects with the same client id and replays every frame
  for (const s of b.sockets) s.kill();
  n.until(() => b.link.state === "reconnecting" || b.link.state === "open", 3000);
  n.until(() => b.session.guest!.live && b.session.world!.tick > n.host.session.world!.tick - 30, 20000, "b rejoined");
  n.guests = [b];
  n.finish();
  assert.equal(b.session.world!.hash(), n.host.session.world!.hash());
  assert.equal(b.session.world!.state.match.winner, n.host.session.world!.state.match.winner);
});
