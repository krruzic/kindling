// Lockstep over the in-memory transport: sync under latency / jitter / reordering, desync detection by section,
// stalls, drops to CPU, rejoin by replay, late-join spectating, version refusal.
import { test, ok, eq } from "./harness.ts";
import { World, coreStyle, type Machine } from "./world.ts";
import { LockstepGuest, hashRow, inputDelay, mergeFields, sectionNamesOf, type NetMsg } from "../src/index.ts";
import { codec, IDLE, SECTIONS, Toy, type Cmd, type Spec } from "./toy.ts";

const hashes = (ms: Machine[]) => ms.map((m) => m.sim!.hash());
const allSame = (xs: number[]) => xs.every((x) => x === xs[0]);

test("codec and mergeFields keep taps between ticks", () => {
  const c: Cmd = { mx: -0.25, my: 1, fire: true };
  eq(codec.unpack(codec.pack(c)), c);
  const merged = mergeFields<Cmd>(
    [
      { mx: 1, my: 0, fire: true },
      { mx: 0.5, my: -1, fire: false },
    ],
    IDLE,
    IDLE,
    ["mx", "my"],
  );
  eq(merged, { mx: 0.5, my: -1, fire: true });
  eq(mergeFields<Cmd>([], { mx: 0.3, my: 0, fire: true }, IDLE, ["mx", "my"]), { mx: 0.3, my: 0, fire: false });
  eq(inputDelay([40, -1, 90], 1000 / 60), 3 + 6);
  eq(inputDelay([5000], 1000 / 60), 12);
});

test("host + 3 guests (one with two local seats) + CPU stay in sync under jitter and reordering", () => {
  const w = new World({ seed: 11, latencyMs: [20, 120], reorder: true, guests: [[0], [0, 1], [0]], cpus: 1 });
  w.run(2500);
  // lobby: every device of every guest got a seat, mirrored on each guest
  const lobby = w.host.lobbyHost!;
  eq(lobby.seats.filter((s) => s).length, 5);
  for (const g of w.guests) eq(g.lobbyGuest!.mine.size, g.devices.length, `${g.name} seats`);
  // RTTs reached the host and drive the input delay
  for (const g of w.guests) ok(w.host.link.rttOf(g.link.id) > 0, "rtt known");
  w.start();
  const delay = w.host.host!.delay;
  ok(delay > 3 && delay <= 12, `delay ${delay}`);
  w.playTo(900);
  const hs = hashes(w.all);
  ok(allSame(hs), `hashes differ: ${hs}`);
  for (const g of w.guests) {
    eq(g.guest!.tick, w.host.host!.tick);
    ok(g.guest!.stats.hashChecks >= 29, `${g.name} hash checks ${g.guest!.stats.hashChecks}`);
    eq(g.desyncs.length, 0);
  }
  eq(w.host.desyncs.length, 0);
  // inputs really flowed: every human seat moved
  ok(
    w.host.sim!.players.slice(0, 5).every((p, i) => p.x !== i * 100 || p.y !== 0),
    "players moved",
  );
  ok(w.host.cpuSeatsAsked.has(5), "cpu seat played by the host");
});

test("desync injection is detected with the right section", () => {
  const w = new World({ seed: 3, guests: [[0], [0]] });
  w.guests[0].corruptAt = 100;
  w.run(1500);
  w.start();
  w.playTo(200);
  const g = w.guests[0];
  ok(g.desyncs.length > 0, "guest saw the desync");
  eq(g.desyncs[0].tick, 120);
  eq(g.desyncs[0].sections, ["players"]);
  ok(w.host.desyncs.length === 1, "host got one report");
  eq(w.host.desyncs[0].peer, g.link.id);
  eq(w.host.desyncs[0].sections, ["players"]);
  eq(w.guests[1].desyncs.length, 0);
});

test("a core-style sim (named sections(), no sectionHashes) is hashed and desyncs are named", () => {
  const toy = new Toy({ seed: 1, players: 2 });
  const sim = coreStyle(toy);
  eq(sectionNamesOf(sim), SECTIONS);
  eq(hashRow(sim, ["rng", "players"]), [toy.hash() >>> 0, toy.sectionHashes()[2] >>> 0, toy.sectionHashes()[0] >>> 0]);
  eq(sectionNamesOf(toy), undefined);
  const w = new World({ seed: 3, guests: [[0], [0]], coreSections: true });
  w.guests[0].corruptAt = 100;
  w.run(1500);
  w.start();
  w.playTo(200);
  ok(w.guests[0].desyncs.length > 0, "guest saw the desync");
  eq(w.guests[0].desyncs[0].sections, ["players"]);
  eq(w.host.desyncs[0]?.sections, ["players"]);
  eq(w.guests[1].desyncs.length, 0);
  eq(w.guests[1].sim!.hash(), w.host.sim!.hash());
});

test("a stalled guest shows 'waiting for' everywhere, then a CPU takes its seat", () => {
  const w = new World({ seed: 5, guests: [[0], [0]], host: { dropAfterMs: 3000, stallShowMs: 300 } });
  w.run(1500);
  w.start();
  w.until(() => w.host.host!.tick >= 120, 10000);
  const slow = w.guests[1];
  const seat = w.host.lobbyHost!.seatOf(slow.link.id, 0);
  slow.paused = true;
  w.run(1500);
  const stall = w.host.stalls.find((s) => s && s.stopped);
  ok(stall, "host stalled");
  eq(stall!.seats, [seat]);
  eq(stall!.reason, "slow");
  ok(
    w.guests[0].stalls.some((s) => s?.seats.includes(seat)),
    "other guest told who we wait for",
  );
  const t0 = w.host.host!.tick;
  w.run(2500);
  eq(w.host.drops[0]?.seats, [seat]);
  eq(w.host.drops[0]?.reason, "slow");
  ok(w.host.host!.tick > t0 + 30, "match goes on after the drop");
  ok(w.host.cpuSeatsAsked.has(seat), "cpu plays the dropped seat");
  ok(w.guests[0].drops.length === 1, "guests told about the drop");
  w.playTo(w.host.host!.tick + 120);
  eq(w.guests[0].sim!.hash(), w.host.sim!.hash());
});

test("a guest that disconnects plays idle for the grace period, then becomes a CPU", () => {
  const w = new World({
    seed: 9,
    guests: [[0], [0, 1]],
    host: { graceMs: 2000 },
    link: (i) => (i === 1 ? { reconnectMs: 0 } : {}),
  });
  w.run(1500);
  w.start();
  w.until(() => w.host.host!.tick >= 200, 10000);
  const gone = w.guests[1];
  const seats = [0, 1].map((d) => w.host.lobbyHost!.seatOf(gone.link.id, d)).sort();
  killLink(w, gone);
  w.run(500);
  const away = w.host.stalls.find((s) => s && s.reason === "gone");
  ok(away && !away.stopped, "away countdown without stopping the match");
  eq(away!.seats, seats);
  const t0 = w.host.host!.tick;
  ok(t0 > 200, "match kept going during the grace period");
  w.run(2000);
  eq(w.host.drops[0]?.seats, seats);
  eq(w.host.drops[0]?.reason, "left");
  for (const s of seats) ok(w.host.cpuSeatsAsked.has(s), `cpu plays seat ${s}`);
  gone.paused = true;
  w.playTo(w.host.host!.tick + 60);
  eq(w.guests[0].sim!.hash(), w.host.sim!.hash());
});

/** Severs a machine's socket the way a network drop does (client sees a close, relay notices). */
function killLink(w: World, m: Machine): void {
  const sock = w.net.sockets
    .filter((s) => s.readyState === 1)
    .find((s) => (m.link as unknown as { ws: unknown }).ws === s);
  ok(sock, "socket found");
  sock!.kill(true);
}

test("a guest that drops and reconnects replays every frame and reaches the same state", () => {
  const w = new World({ seed: 21, latencyMs: [15, 60], reorder: true, guests: [[0], [0]], host: { graceMs: 1000 } });
  w.run(1500);
  w.start();
  w.until(() => w.host.host!.tick >= 400, 20000);
  const g = w.guests[1];
  const seat = w.host.lobbyHost!.seatOf(g.link.id, 0);
  killLink(w, g);
  // gone for longer than the grace period: a CPU takes the seat, then the guest comes back and takes it back
  w.until(() => g.link.state === "open" && g.guest!.stats.resumes === 1, 15000, "rejoin");
  ok(
    w.host.drops.some((d) => d.seats.includes(seat)),
    "cpu took over while away",
  );
  w.until(() => g.guest!.live, 10000, "caught up");
  w.until(() => w.host.returns.length > 0, 5000, "seat returned");
  eq(w.host.returns[0], [seat]);
  eq(w.host.host!.seatKinds()[seat], "remote");
  w.playTo(w.host.host!.tick + 300);
  const hs = hashes(w.all);
  ok(allSame(hs), `hashes differ after rejoin: ${hs}`);
  eq(g.guest!.tick, w.host.host!.tick);
  eq(g.desyncs.length, 0);
  // its inputs drive the seat again
  const before = { ...w.host.sim!.players[seat] };
  w.playTo(w.host.host!.tick + 200);
  ok(JSON.stringify(before) !== JSON.stringify(w.host.sim!.players[seat]), "rejoined seat moves");
});

test("a late joiner spectates: replays the match so far and stays in sync", () => {
  const w = new World({ seed: 33, guests: [[0]] });
  w.run(1500);
  w.start();
  w.until(() => w.host.host!.tick >= 600, 20000);
  const late = w.addGuest([0], 1);
  w.until(() => late.guest!.running && late.guest!.live, 10000, "spectator caught up");
  eq(late.guest!.myDevices.size, 0);
  w.playTo(w.host.host!.tick + 120);
  eq(late.sim!.hash(), w.host.sim!.hash());
  eq(w.host.host!.stats.resumes, 1);
});

test("version mismatch is refused (relay join and lockstep start)", () => {
  const w = new World({ seed: 2, guests: [] });
  const bad = w.machine("bad", [0], { build: "b2" });
  bad.link.join({ kind: "versus", room: w.host.link.room });
  w.until(() => bad.link.state === "closed", 2000, "refusal");
  const msgs: NetMsg[] = bad.link.drain();
  eq(
    msgs.map((m) => [m.t, m.code ?? m.reason]),
    [
      ["error", "build"],
      ["closed", "refused"],
    ],
  );
  ok(bad.link.status.includes("ANOTHER VERSION"), bad.link.status);
  // lockstep level: a start from another build is refused even without the relay check
  const refused: string[] = [];
  const g = new LockstepGuest<Cmd, number, Spec>({
    link: { id: 1, cid: "x", toHost: () => {} },
    codec,
    build: "b2",
    createSim: (spec) => new Toy(spec),
    onRefused: (why) => refused.push(why),
  });
  g.receive({ t: "ls:start", id: 1, spec: { seed: 1, players: 1 }, seats: [], delay: 3, tickMs: 16, build: "b1" });
  eq(refused.length, 1);
  ok(!g.running, "not started");
});

test("host leaving ends the match for guests", () => {
  const w = new World({ seed: 4, guests: [[0], [0]] });
  w.run(1500);
  w.start();
  w.until(() => w.host.host!.tick >= 60, 10000);
  w.host.link.close();
  w.host.paused = true;
  w.run(500);
  for (const g of w.guests) eq(g.ends, ["host-left"]);
});
