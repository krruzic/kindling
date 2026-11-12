// Seats: press to join, the join press swallowed, release + must-let-go, drop on unplug and rejoin the same seat,
// blocked seats, keyboard halves as seats, the mouse on one half.
import { eq, ok, test } from "./assert.ts";
import { DS4_ID, FakePad, KB_LEFT, KB_RIGHT, setup, XBOX_ID } from "./fake.ts";

test("seats: press any button to join; join press doesn't act", () => {
  const { input, pads, step } = setup();
  const joins: [number, string][] = [];
  input.onJoin = (s, h) => joins.push([s, h]);
  const a = new FakePad(XBOX_ID, 0);
  const b = new FakePad(DS4_ID, 1);
  pads.push(a, b);
  step(3);
  eq(input.seatMap(), [null, null, null, null], "idle pads don't join");
  b.press(0);
  step();
  eq(input.seatOf("pad-1"), 0, "first to press gets seat 0");
  eq(input.players[0].pressed.jump, false, "join press swallowed");
  eq(input.players[0].connected, true);
  eq(input.players[0].family, "playstation");
  b.up(0);
  step();
  b.press(0);
  step();
  eq(input.players[0].pressed.jump, true, "next press acts");
  a.axis(0, 1);
  step();
  eq(input.seatOf("pad-0"), -1, "stick movement doesn't join");
  a.press(9);
  step();
  eq(input.seatOf("pad-0"), 1);
  eq(joins, [
    [0, "pad-1"],
    [1, "pad-0"],
  ]);
});

test("seats: a button held when joining turns on (the menu press that opened the screen) doesn't seat", () => {
  const { input, pads, step } = setup();
  input.joining = false;
  const a = new FakePad(XBOX_ID, 0);
  pads.push(a);
  step();
  a.press(0);
  step();
  input.joining = true;
  step(3);
  eq(input.seatOf("pad-0"), -1, "still held from the menu");
  a.up(0);
  step();
  a.press(0);
  step();
  eq(input.seatOf("pad-0"), 0, "a fresh press joins");
});

test("seats: joinPressCounts lets the join press act", () => {
  const { input, pads, step } = setup({ joinPressCounts: true });
  const a = new FakePad(XBOX_ID, 0);
  pads.push(a);
  step();
  a.press(0);
  step();
  eq(input.players[0].pressed.jump, true);
});

test("seats: release needs a full let-go before rejoining", () => {
  const { input, pads, step } = setup();
  const a = new FakePad(XBOX_ID, 0);
  pads.push(a);
  a.press(0);
  step();
  input.release(0);
  step(5);
  eq(input.seatOf("pad-0"), -1, "still holding: stays out");
  a.up(0);
  step();
  a.press(1);
  step();
  eq(input.seatOf("pad-0"), 0, "rejoins after letting go");
});

test("seats: unplug drops the seat; the same pad gets it back on rejoin", () => {
  const { input, pads, step } = setup();
  const leaves: string[] = [];
  input.onLeave = (s, h, why) => leaves.push(`${s}:${h}:${why}`);
  const a = new FakePad(XBOX_ID, 0);
  const b = new FakePad(DS4_ID, 1);
  pads.push(a, b);
  a.press(0);
  step();
  b.press(0);
  step();
  eq(input.seatMap(), ["pad-0", "pad-1", null, null]);
  pads[0] = null;
  step();
  eq(input.seatMap(), [null, "pad-1", null, null]);
  eq(input.players[0].connected, false);
  eq(leaves, ["0:pad-0:disconnect"]);
  const c = new FakePad("Logitech Dual Action (Vendor: 046d Product: c216)", 2, "");
  pads[2] = c;
  c.press(1);
  step();
  eq(input.seatOf("pad-2"), 2, "a different pad doesn't take the dropped player's seat");
  const back = new FakePad(XBOX_ID, 3);
  pads[3] = back;
  back.press(0);
  step();
  eq(input.seatOf("pad-3"), 0, "same pad id rejoins its old seat");
});

test("seats: blocked seats, joining off, move", () => {
  const { input, pads, step } = setup();
  input.blocked = [true, false];
  const a = new FakePad(XBOX_ID, 0);
  pads.push(a);
  input.joining = false;
  a.press(0);
  step();
  eq(input.seatOf("pad-0"), -1, "joining off");
  input.joining = true;
  a.up(0);
  step();
  a.press(0);
  step();
  eq(input.seatOf("pad-0"), 1, "skips blocked seat 0");
  ok(input.move(1, 3));
  eq(input.seatOf("pad-0"), 3);
  eq(input.players[3].connected, true);
  eq(input.players[1].connected, false);
});

test("keyboard halves: two seats on one keyboard, with their own bindings", () => {
  const { input, step } = setup({ keyboards: [KB_LEFT, KB_RIGHT] });
  const kb = input.keyboard;
  kb.keyDown("KeyD");
  step();
  eq(input.seatMap(), [null, null, null, null], "movement keys don't join");
  kb.keyDown("Period");
  step();
  eq(input.seatOf("keyboard-2"), 0, "right half joins on its button");
  kb.keyUp("Period");
  kb.keyDown("KeyJ");
  step();
  eq(input.seatOf("keyboard-1"), 1, "left half joins");
  kb.keyUp("KeyJ");
  step();
  kb.keyDown("KeyJ");
  kb.keyDown("ArrowLeft");
  kb.keyDown("ArrowUp");
  step();
  eq(input.players[1].pressed.jump, true, "left half jumps");
  eq(input.players[0].held.jump, false, "right half doesn't");
  eq(input.players[1].stickX, 1, "left half stick (D held)");
  ok(Math.abs(input.players[0].stickX + Math.SQRT1_2) < 1e-9, "right half stick diagonal normalised");
  eq(input.players[0].held.up, true, "ArrowUp also bound to up");
  eq(input.players[0].family, "keyboard");
  ok(input.keyboard.captured.has("ArrowUp"), "arrow default prevented");
});

test("keyboard: a tap between polls still registers; typing mutes keys; mouse on its half", () => {
  const { input, step } = setup({ keyboards: [KB_LEFT, KB_RIGHT], joinPressCounts: true });
  const kb = input.keyboard;
  kb.keyDown("KeyJ");
  kb.keyUp("KeyJ");
  step();
  eq(input.seatOf("keyboard-1"), 0, "tap joins");
  eq(input.players[0].pressed.jump, true, "tap pressed");
  step();
  eq(input.players[0].held.jump, false, "tap over");
  kb.mouseMove(120, 80);
  kb.mouseDown(0);
  kb.wheel(3);
  step();
  eq(input.players[0].pointer, { x: 120, y: 80, left: true, right: false, middle: false, wheel: 3 });
  eq(input.getDevice("keyboard-2")!.state.pointer, undefined, "the other half has no pointer");
  kb.mouseUp(0);
  kb.typing = true;
  kb.keyDown("KeyK");
  step();
  eq(input.players[0].held.attack, false, "typing mutes the keyboard");
  kb.typing = false;
  kb.blur();
  input.keyboardEnabled = false;
  step();
  eq(input.seatOf("keyboard-1"), -1, "keyboard off drops its seat");
});

test("seats: mid-match (joining off) a pad that unplugs gets its seat back on reconnect, at any index, at once", () => {
  const { input, pads, step } = setup();
  const a = new FakePad(XBOX_ID, 0);
  const b = new FakePad(DS4_ID, 1);
  pads.push(a, b);
  a.press(0);
  step();
  b.press(0);
  step();
  a.up(0);
  b.up(0);
  step();
  input.joining = false;
  pads[0] = null;
  step();
  ok(input.orphaned(0), "seat 0 waits for its pad");
  eq(input.players[0].connected, false);
  // the same pad comes back at another index: no press needed, its input is live again
  const back = new FakePad(XBOX_ID, 2);
  pads[2] = back;
  step();
  eq(input.seatOf("pad-2"), 0, "back in its seat");
  ok(!input.orphaned(0));
  back.press(12);
  step();
  eq(input.players[0].held.up, true, "and it plays");
});

test("seats: mid-match, another pad's A takes over an orphaned seat (the press doesn't act); not on join screens", () => {
  const { input, pads, step } = setup();
  const a = new FakePad(XBOX_ID, 0);
  pads.push(a);
  a.press(0);
  step();
  a.up(0);
  step();
  input.joining = false;
  pads[0] = null;
  step();
  const c = new FakePad("Logitech Dual Action (Vendor: 046d Product: c216)", 1, "");
  pads[1] = c;
  step();
  eq(input.seatOf("pad-1"), -1, "a new pad doesn't just take it");
  c.press(1);
  step();
  eq(input.seatOf("pad-1"), 0, "its A takes the orphaned seat");
  eq(input.players[0].pressed.jump || input.players[0].pressed.attack, false, "that press doesn't act");
  // releasing an orphan forgets it
  const { input: i2, pads: p2, step: s2 } = setup();
  const x = new FakePad(XBOX_ID, 0);
  p2.push(x);
  x.press(0);
  s2();
  p2[0] = null;
  s2();
  ok(i2.orphaned(0));
  i2.release(0);
  ok(!i2.orphaned(0));
});
