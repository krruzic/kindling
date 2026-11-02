// Mirrored lobby over the in-memory transport: seats for guests with several devices, validated requests,
// mirroring, seats freed when devices or guests leave, lockstep seats.
import { test, ok, eq } from "./harness.ts";
import { World } from "./world.ts";

test("lobby seats every device, validates requests and mirrors the state", () => {
  const w = new World({ seed: 8, guests: [[0, 1, 2], [0]], cpus: 1 });
  w.run(1000);
  const lobby = w.host.lobbyHost!;
  const [a, b] = w.guests;
  eq(
    lobby.seats.map((s) => (s ? `${s.peer}:${s.device}` : null)),
    ["0:0", `${a.link.id}:0`, `${a.link.id}:1`, `${a.link.id}:2`, `${b.link.id}:0`, null],
  );
  eq(lobby.seats[1]!.name, "G01");
  eq(lobby.seats[4]!.name, "G1");
  eq(
    [...a.lobbyGuest!.mine],
    [
      [0, 1],
      [1, 2],
      [2, 3],
    ],
  );

  // a valid pick for its own seat applies and mirrors; an invalid one is refused
  a.lobbyGuest!.request(1, { pick: "birch" }, (s) => (s.picks[2] = "birch"));
  eq(a.lobbyGuest!.state!.picks[2], "birch", "optimistic");
  b.lobbyGuest!.request(0, { pick: "not-a-hero" });
  b.lobbyGuest!.request(5, { pick: "ash" });
  w.run(500);
  eq(lobby.state.picks, { 2: "birch" });
  for (const g of w.guests) eq(g.lobbyGuest!.state!.picks, { 2: "birch" }, `${g.name} mirror`);

  // a device goes away: its seat frees; the guest leaves: all its seats free
  a.lobbyGuest!.setDevices([0, 2]);
  w.run(300);
  eq(lobby.seatOf(a.link.id, 1), -1);
  eq(a.lobbyGuest!.mine.size, 2);
  b.link.close();
  b.paused = true;
  w.run(300);
  eq(lobby.seatOf(b.link.id, 0), -1);
  const kinds = lobby.lockstepSeats().map((s) => s.kind);
  eq(kinds, ["local", "remote", "cpu", "remote", "cpu", "cpu"]);
  ok(lobby.lockstepSeats(false).length === 3, "empty seats skipped");
});

test("a frozen lobby keeps seats during a match and re-seats after", () => {
  const w = new World({ seed: 12, guests: [[0], [0]] });
  w.run(800);
  const lobby = w.host.lobbyHost!;
  const g = w.guests[0];
  lobby.setOpen(false);
  g.lobbyGuest!.setDevices([]);
  w.run(300);
  ok(lobby.seatOf(g.link.id, 0) >= 0, "seat kept while closed");
  lobby.setOpen(true);
  eq(lobby.seatOf(g.link.id, 0), -1);
});
