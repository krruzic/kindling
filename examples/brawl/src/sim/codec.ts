// How Commands travel online: one integer per seat per tick (sticks offset into a byte each, buttons as bits), and
// how several frames of local input within one tick merge into one command (sticks from the newest input, a press
// anywhere in the queue counts, so a tap between two ticks is never lost).
import { mergeFields, type CommandCodec } from "@kindling/net";
import { IDLE, type Command } from "./types.ts";

const clampStick = (v: number) => Math.max(-100, Math.min(100, Math.round(v)));

export function packCommand(c: Command): number {
  return (
    (clampStick(c.mx) + 128) |
    ((clampStick(c.mz) + 128) << 8) |
    (c.attack ? 1 << 16 : 0) |
    (c.dash ? 1 << 17 : 0) |
    (c.special ? 1 << 18 : 0)
  );
}

export function unpackCommand(p: number): Command {
  return {
    mx: (p & 0xff) - 128,
    mz: ((p >> 8) & 0xff) - 128,
    attack: !!(p & (1 << 16)),
    dash: !!(p & (1 << 17)),
    special: !!(p & (1 << 18)),
  };
}

export const codec: CommandCodec<Command, number> = {
  pack: packCommand,
  unpack: unpackCommand,
  merge: (queue, last) => mergeFields(queue, last, IDLE, ["mx", "mz"]),
  idle: IDLE,
};
