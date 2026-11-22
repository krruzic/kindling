// TouchPad: stick maths (deadzone, full tilt, 8-way, re-centring, fixed vs floating), multi-touch buttons (hold,
// tap latch, slide, cancel), palms, taps for menus, and the pad as a seat through InputManager.
import { InputManager, stickOutput, TouchPad, type TouchLayout } from "../src/index.ts";
import { eq, near, ok, test } from "./assert.ts";

const LAYOUT: TouchLayout = {
  stick: { zone: { x: 0, y: 0, w: 400, h: 400 }, mode: "floating", cx: 100, cy: 300, radius: 50, deadzone: 0.2 },
  buttons: [
    { id: "east", x: 700, y: 300, r: 40 },
    { id: "south", x: 620, y: 340, r: 32 },
    { id: "north", x: 640, y: 250, r: 30 },
    { id: "start", x: 400, y: 20, w: 60, h: 30 },
  ],
};

function pad(): { t: TouchPad; at: (s: number) => void } {
  let now = 0;
  const t = new TouchPad({ clock: () => now });
  t.setLayout(LAYOUT);
  return { t, at: (s) => (now = s) };
}

test("touch: stick output: deadzone, rescaled rise, full tilt at the radius, 8-way snap", () => {
  eq(stickOutput(5, 0, 50, 0.2), [0, 0], "inside the deadzone");
  near(stickOutput(10, 0, 50, 0.2)[0], 0, 1e-9, "the deadzone's edge is 0, not a jump");
  near(stickOutput(30, 0, 50, 0.2)[0], 0.5);
  near(stickOutput(50, 0, 50, 0.2)[0], 1);
  near(stickOutput(500, 0, 50, 0.2)[0], 1, 1e-9, "never past 1");
  const [x, y] = stickOutput(30, -28, 50, 0.2, true);
  near(x, Math.SQRT1_2);
  near(y, -Math.SQRT1_2);
  eq(stickOutput(40, 3, 50, 0.2, true), [1, 0], "8-way: snaps to the nearest of 8");
});

test("touch: floating stick appears under the thumb, re-centres past the radius, lets go to zero", () => {
  const { t } = pad();
  t.down(1, 150, 200);
  eq(t.output(), [0, 0], "centred where it landed");
  eq(t.stickView().cx, 150);
  t.move(1, 175, 200);
  near(t.output()[0], (25 - 10) / 40);
  t.move(1, 250, 200);
  near(t.output()[0], 1);
  eq(t.stickView().cx, 200, "the centre followed (thumb 100 px out, radius 50)");
  t.move(1, 150, 200);
  near(t.output()[0], -1, 1e-9, "reversing is instant: full tilt the other way after 50 px, not 150");
  t.up(1);
  eq(t.output(), [0, 0]);
  // near the zone's edge the centre is kept inside it
  t.down(2, 5, 395);
  eq([t.stickView().cx, t.stickView().cy], [50, 350]);
});

test("touch: fixed stick takes touches near its centre only", () => {
  const { t } = pad();
  t.setLayout({ ...LAYOUT, stick: { ...LAYOUT.stick!, mode: "fixed" } });
  t.down(1, 300, 100);
  eq(t.stickView().active, false, "too far from the fixed stick");
  t.up(1);
  t.down(2, 130, 300);
  ok(t.stickView().active);
  eq(t.stickView().cx, 100, "centre stays put");
  near(t.output()[0], (30 - 10) / 40);
});

test("touch: multi-touch: stick + held B + a tap on A in one frame; a quick tap still reads once", () => {
  const { t, at } = pad();
  t.down(1, 100, 300);
  t.move(1, 150, 300);
  t.down(2, 620, 340);
  at(0.01);
  t.down(3, 700, 300);
  t.up(3);
  let r = t.read()[0];
  near(r.stick[0], 1);
  eq(r.buttons.south?.digital, true, "B held");
  eq(r.buttons.east?.digital, true, "A tapped between reads: on for this read");
  r = t.read()[0];
  eq(r.buttons.east?.digital, false, "and only once");
  eq(r.buttons.south?.digital, true);
  t.up(2);
  eq(t.read()[0].buttons.south?.digital, false);
});

test("touch: sliding between adjacent buttons; pointercancel releases (no stuck button)", () => {
  const { t } = pad();
  t.down(1, 700, 300);
  ok(t.held("east"));
  t.move(1, 690, 300);
  ok(t.held("east"), "hysteresis: still A near its edge");
  t.move(1, 625, 338);
  ok(t.held("south") && !t.held("east"), "slid onto B");
  t.cancel(1);
  ok(!t.held("south"), "cancel lets go");
  t.read();
  eq(t.read()[0].buttons.south?.digital, false);
  ok(t.drainTaps().length === 0, "a cancel is no tap");
});

test("touch: a second finger in the stick zone (a palm) is ignored; taps off the controls go to menus", () => {
  const { t, at } = pad();
  t.down(1, 100, 300);
  t.move(1, 100, 260);
  t.down(2, 200, 320);
  t.move(2, 300, 320);
  near(t.output()[1], -0.75, 1e-9, "the first thumb still drives");
  t.up(2);
  near(t.output()[1], -0.75, 1e-9);
  t.up(1);
  // taps: short and still; a long press or a drag isn't one
  t.drainTaps();
  t.down(3, 500, 100);
  at(0.1);
  t.up(3);
  t.down(4, 500, 100);
  at(1);
  t.up(4);
  t.down(5, 500, 100);
  t.move(5, 560, 100);
  t.up(5);
  eq(t.drainTaps(), [{ x: 500, y: 100, onControl: false }]);
});

test("touch: as a seat in InputManager (family touch, actions by canonical buttons, stick untouched)", () => {
  const t = new TouchPad({ clock: () => 0 });
  t.setLayout(LAYOUT);
  type A = "attack" | "item" | "pause";
  const input = new InputManager<A>({
    actions: ["attack", "item", "pause"],
    seats: 2,
    bindings: { default: { attack: ["east"], item: ["south"], pause: ["start"] } },
    gamepads: () => [],
    providers: [t],
    joinPressCounts: true,
  });
  input.poll(0);
  eq(input.devicePads().length, 0, "not a device until touched");
  t.down(1, 700, 300);
  input.poll(0.016);
  eq(input.seatOf("touch-1"), 0, "a button press seats it");
  eq(input.players[0].family, "touch");
  eq(input.players[0].held.attack, true);
  t.up(1);
  t.down(2, 100, 300);
  t.move(2, 125, 300);
  input.poll(0.032);
  near(input.players[0].stickX, (25 - 10) / 40, 1e-9, "no second deadzone on top of the touch stick's");
  eq(input.players[0].held.attack, false);
});

test("touch: buttons first laid out after the pad joined (a menu had none) still bind", () => {
  const t = new TouchPad({ clock: () => 0, buttons: ["east", "south"] });
  t.setLayout({ stick: LAYOUT.stick, buttons: [] });
  const input = new InputManager<"attack" | "item">({
    actions: ["attack", "item"],
    seats: 1,
    bindings: { default: { attack: ["east"], item: ["south"] } },
    gamepads: () => [],
    providers: [t],
  });
  t.down(1, 100, 300);
  t.up(1);
  input.poll(0);
  input.join("touch-1");
  t.setLayout(LAYOUT);
  t.down(2, 620, 340);
  input.poll(0.016);
  input.poll(0.032);
  eq(input.players[0].held.item, true);
});

test("touch: holds() lists fingers held outside the controls (not on a button, not dragged), with their time", () => {
  let now = 0;
  const t = new TouchPad({ clock: () => now });
  t.setLayout({ stick: null, buttons: [{ id: "east", x: 50, y: 50, r: 20 }] });
  t.down(1, 500, 100);
  t.down(2, 50, 50);
  now = 0.5;
  eq(t.holds(), [{ x: 500, y: 100, held: 0.5 }]);
  t.move(1, 540, 100);
  eq(t.holds(), [], "dragged away: no longer a hold");
  t.up(1);
  t.up(2);
});

test("touch: a pointer id of any sign takes the stick (iOS touch identifiers go negative)", () => {
  for (const id of [-1967427532, -1, 0, 2147483647]) {
    const { t } = pad();
    t.down(id, 150, 200);
    ok(t.stickView().active, `the stick is held (id ${id})`);
    t.move(id, 200, 200);
    near(t.output()[0], 1, 1e-9, `full tilt (id ${id})`);
    // (and a second finger there is still a palm, not a second stick)
    t.down(id + 7, 160, 210);
    t.move(id + 7, 100, 210);
    near(t.output()[0], 1, 1e-9, `the first finger keeps it (id ${id})`);
    t.up(id);
    eq(t.output(), [0, 0], `let go (id ${id})`);
    ok(!t.stickView().active);
  }
});
