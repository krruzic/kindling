// WebHID report decoding (no browser): a GameCube adapter report and a Switch 2 Pro report, through the providers'
// pure decoders, plus the raw debug readout.
import { GcAdapterDecoder, gcPad, ProCon2Decoder, PRO2_PRODUCT, proPad } from "../src/index.ts";
import { eq, near, ok, test } from "./assert.ts";
import { FakePad, setup, XBOX_ID } from "./fake.ts";

test("hid: GameCube adapter report -> port 2", () => {
  const dec = new GcAdapterDecoder();
  const r = new Uint8Array(37);
  const port = (p: number, bytes: number[]) => r.set(bytes, p * 9);
  port(0, [0x04]);
  port(1, [0x14, 0x01 | 0x80, 0x02 | 0x08, 128, 128, 128, 128, 40, 30]);
  port(2, [0x04]);
  port(3, [0x04]);
  dec.feed(0x21, new DataView(r.buffer));
  // centre learned from the first report; then tilt right
  r[9 + 3] = 128 + 88;
  r[9 + 8] = 200;
  dec.feed(0x21, new DataView(r.buffer));
  const g = dec.ports[1];
  eq([g.connected, g.a, g.up, g.z, g.l, g.b], [true, true, true, true, true, false]);
  near(g.stickX, 1);
  eq(g.rRaw, 200);
  eq(dec.ports[0].connected, false);
  const pad = gcPad("gc-port-2", "gc-port-2", "GC", g);
  eq(pad.buttons.south, { digital: true });
  eq(pad.buttons.rb, { digital: true });
  ok(Math.abs(pad.buttons.rt!.analog! - 200 / 170) < 1e-9);
});

test("hid: Switch 2 Pro report", () => {
  const dec = new ProCon2Decoder(PRO2_PRODUCT);
  const r = new Uint8Array(63);
  // report id stripped: byte k at k - 1. B A Y X ZR R + RS in byte 3; Down Right Left Up ZL L - LS in byte 4.
  r[2] = 0x02;
  r[3] = 0x08 | 0x10;
  const centre = [0x00, 0x08, 0x80];
  r.set(centre, 5);
  r.set(centre, 8);
  dec.feed(0x09, new DataView(r.buffer));
  const s = dec.state;
  eq([s.connected, s.a, s.b, s.up, s.zl], [true, true, false, true, true]);
  const pad = proPad(0, s);
  eq(pad.family, "switch");
  eq(pad.buttons.east, { digital: true }, "Switch A sits east");
  eq(pad.buttons.lt, { digital: true }, "ZL is the left trigger");
});

test("debug: raw readout per device", () => {
  const { input, pads, step } = setup();
  const pad = new FakePad(XBOX_ID, 0, "standard", 17, 4);
  pads.push(pad);
  pad.set(6, 0.2);
  step();
  pad.set(6, 0.9).press(1);
  step();
  const [d] = input.debug();
  eq([d.handle, d.family, d.profile, d.seat], ["pad-0", "xbox", "standard", 0]);
  eq(d.raw!.buttons[6].value, 0.9);
  const lt = d.sources.find((s) => s.id === "b6")!;
  eq([lt.label, lt.on, lt.analogTrigger, lt.button], ["LT", true, true, "lt"]);
  near(lt.rest, 0.2, 1e-9, "a trigger resting part-pressed calibrates its rest");
  ok(lt.text.includes("TRAVEL"), lt.text);
  ok(input.debugText().includes("LT: ANALOG 0.90"), input.debugText());
});
