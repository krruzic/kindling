// Remaps: defaults per family, rebinding (swap), save through hooks, apply on reconnect, guided sessions with
// hold-to-skip and timeout, glyphs.
import { HOLD_SKIP, rebind, RemapStore, type Bindings } from "../src/index.ts";
import { eq, ok, test } from "./assert.ts";
import { DS4_ID, FakePad, setup, XBOX_ID, type Act } from "./fake.ts";

test("remap: family defaults through the profile", () => {
  const { input, pads, step } = setup();
  pads.push(new FakePad(XBOX_ID, 0), new FakePad("Pro Controller (STANDARD GAMEPAD Vendor: 057e Product: 2009)", 1));
  step();
  eq(input.getDevice("pad-0")!.defaults.jump, ["b0"], "xbox: south");
  eq(input.getDevice("pad-1")!.defaults.jump, ["b1"], "switch: east (the game's per-family default)");
  eq(input.getDevice("pad-1")!.defaults.special, ["b7"], "family override merges over default");
});

test("remap: rebind swaps with the action that owned the source", () => {
  const defaults: Bindings<Act> = {
    jump: ["b0"],
    attack: ["b2"],
    special: ["b7"],
    pause: ["b9"],
    up: [],
    down: [],
    left: [],
    right: [],
  };
  const b = rebind(defaults, structuredClone(defaults), "jump", "b2");
  eq(b.jump, ["b2"]);
  eq(b.attack, ["b0"], "attack takes jump's old button");
  const back = rebind(defaults, b, "jump", "b0");
  eq(back.jump, ["b0"], "pressing a default restores it");
});

test("remap: bind saves, applies, and survives reconnect at another index", () => {
  const { input, pads, saved, step } = setup();
  input.joining = false;
  const pad = new FakePad(XBOX_ID, 0);
  pads.push(pad);
  step();
  input.bind("pad-0", "jump", "b3");
  eq(saved.writes, 1);
  eq(saved.data?.[XBOX_ID]?.jump, ["b3"]);
  pad.press(3);
  step();
  eq(input.devicePads()[0].held.jump, true, "remapped button jumps");
  pads.length = 0;
  step();
  eq(input.devicePads().length, 0, "gone");
  const again = new FakePad(XBOX_ID, 2);
  pads[2] = again;
  step();
  again.press(3);
  step();
  eq(input.getDevice("pad-2")!.state.held.jump, true, "remap applied on reconnect");
  input.resetBindings(XBOX_ID);
  eq(saved.data?.[XBOX_ID], undefined, "reset saved");
});

test("remap: store loads from hooks and ignores junk", () => {
  const store = new RemapStore({ load: () => ({ "pad x": { jump: ["b1", 5 as never], bad: "x" as never } }) });
  eq(store.get("pad x"), { jump: ["b1"] });
  const s2 = setup();
  s2.saved.data = { [DS4_ID]: { attack: ["b0"] } };
  s2.input.remaps.reload();
  s2.pads.push(new FakePad(DS4_ID, 0));
  s2.step();
  eq(s2.input.bindingsOf(s2.input.getDevice("pad-0")!).attack, ["b0"]);
});

test("remap: guided session binds on release, in order, and blanks the device", () => {
  const { input, pads, step, saved } = setup();
  const pad = new FakePad(XBOX_ID, 0);
  pads.push(pad);
  pad.press(0);
  step();
  pad.up(0);
  step(2);
  eq(input.seatOf("pad-0"), 0);
  const s = input.startRemap("pad-0", ["jump", "attack"])!;
  eq(s.action, "jump");
  pad.press(5);
  step();
  eq(input.players[0].held.jump, false, "captured device is blank");
  pad.up(5);
  step();
  eq(s.action, "attack", "bound on release");
  pad.press(4);
  step();
  pad.up(4);
  step();
  eq(s.status, "done");
  eq(input.session, null);
  eq(saved.data?.[XBOX_ID]?.jump, ["b5"]);
  eq(saved.data?.[XBOX_ID]?.attack, ["b4"]);
});

test("remap: hold-to-skip (guided) and hold-to-cancel (single) can't trap a one-pad player", () => {
  const { input, pads, step } = setup();
  const pad = new FakePad(XBOX_ID, 0);
  pads.push(pad);
  step();
  const s = input.startRemap("pad-0", ["jump", "attack", "special"])!;
  pad.press(0);
  step(Math.ceil((HOLD_SKIP + 0.1) * 60));
  eq(s.skipped, ["jump"], "held past HOLD_SKIP skips");
  eq(s.action, "attack");
  // Still holding: the held button can't bind the next step.
  pad.up(0);
  step();
  eq(s.action, "attack", "old held button doesn't bind on release");
  pad.press(1);
  step(10);
  ok(s.hold > 0 && s.hold < 1, "hold progress exposed");
  pad.up(1);
  step();
  eq(s.bound, ["attack"]);
  const single = input.startRemap("pad-0", ["pause"])!;
  pad.press(2);
  step(Math.ceil((HOLD_SKIP + 0.1) * 60));
  eq(single.status, "cancelled", "single action: hold cancels");
  eq(input.session, null);
  ok(s.status === "cancelled", "starting a new session cancels the old one");
});

test("remap: timeout ends a session nobody answers", () => {
  const { input, pads, step } = setup();
  pads.push(new FakePad(XBOX_ID, 0));
  step();
  const s = input.startRemap("pad-0", ["jump"], { timeout: 2 })!;
  step(60);
  eq(s.status, "active");
  ok(s.timeLeft(1.5) > 0);
  step(70);
  eq(s.status, "timeout");
  eq(input.session, null);
});

test("remap: session ends if its device unplugs", () => {
  const { input, pads, step } = setup();
  pads.push(new FakePad(XBOX_ID, 0));
  step();
  const s = input.startRemap("pad-0", ["jump"])!;
  pads.length = 0;
  step();
  eq(s.status, "lost");
});

test("remap: keyboard keys capture and save under the half's key", () => {
  const { input, step, saved } = setup({
    keyboards: [
      { stick: { up: ["KeyW"], down: ["KeyS"], left: ["KeyA"], right: ["KeyD"] }, buttons: { jump: ["Space"] } },
    ],
  });
  step();
  input.startRemap("keyboard-1", ["jump"]);
  input.keyboard.keyDown("KeyH");
  step();
  input.keyboard.keyUp("KeyH");
  step();
  eq(saved.data?.["keyboard-1"]?.jump, ["KeyH"]);
  ok(input.keyboard.captured.has("KeyH"), "remapped key's default is prevented");
});

test("glyphs: game letters by default, physical on request, keys on keyboards", () => {
  const { input, pads, step } = setup({
    keyboards: [
      { stick: { up: ["KeyW"], down: ["KeyS"], left: ["KeyA"], right: ["KeyD"] }, buttons: { jump: ["Space"] } },
    ],
  });
  const ds4 = new FakePad(DS4_ID, 0);
  pads.push(ds4);
  step();
  ds4.press(0);
  step();
  eq(input.glyph("jump"), { label: "A", color: "#2f5fd8", family: "playstation", kind: "game" });
  eq(input.glyph("jump", { mode: "physical" }).label, "CROSS");
  eq(input.glyph("jump", { mode: "physical" }).shape, "cross");
  input.bind("pad-0", "jump", "b3");
  eq(input.glyph("jump").label, "A", "remap doesn't change game-letter prompts");
  eq(input.glyph("jump", { mode: "physical" }).label, "TRIANGLE");
  input.keyboard.keyDown("Space");
  step();
  eq(input.lastDevice, "keyboard-1");
  eq(input.glyph("jump"), { label: "SPACE", color: "#3a3a44", family: "keyboard", kind: "key", source: "Space" });
  eq(input.glyph("attack").kind, "none");
  eq(
    input.glyph("jump", { family: "switch", device: "nope", mode: "physical" }).label,
    "A",
    "no device: family default",
  );
});
