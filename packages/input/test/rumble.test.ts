// Rumble: pulses go to the right pad, weaker pulses don't cut a strong one short, scale 0 disables.
import { eq, ok, test } from "./assert.ts";
import { Rumble } from "../src/rumble.ts";

test("rumble: dual-rumble to the addressed pad, merged and never cut short", () => {
  let now = 0;
  const sent: { pad: number; duration: number; strongMagnitude: number; weakMagnitude: number }[] = [];
  const pad = (index: number) => ({
    id: "x",
    index,
    connected: true,
    mapping: "standard",
    axes: [],
    buttons: [],
    vibrationActuator: {
      playEffect: (_t: string, p: { duration: number; strongMagnitude: number; weakMagnitude: number }) => {
        sent.push({ pad: index, ...p });
        return Promise.resolve();
      },
    },
  });
  const r = new Rumble(() => [pad(0), null, pad(2)], () => now);
  ok(r.play("pad-2", { strong: 1, weak: 0.5, ms: 200 }));
  eq(sent[0], { pad: 2, duration: 200, strongMagnitude: 1, weakMagnitude: 0.5, startDelay: 0 });
  now = 50;
  ok(!r.play(2, { strong: 0.2, weak: 0.2, ms: 50 }), "a weaker, shorter pulse inside a strong one is dropped");
  ok(r.play(2, { strong: 0.2, weak: 0.9, ms: 300 }), "a longer pulse extends");
  eq(sent[1], { pad: 2, duration: 300, strongMagnitude: 0.2, weakMagnitude: 0.9, startDelay: 0 });
  ok(!r.play("pad-1", { strong: 1, weak: 1, ms: 100 }), "no such pad");
  ok(!r.play("kb-0", { strong: 1, weak: 1, ms: 100 }), "keyboards don't rumble");
  r.scale = 0;
  ok(!r.play(0, { strong: 1, weak: 1, ms: 100 }), "scale 0 disables");
});
