// Determinism check: fixed seeded CPU matches hashed (with sections) against the committed baseline. Run before
// every commit; `--write` only for intended sim changes (and say so in the commit message).
//   pnpm determinism --check | --write | (print)
import { defineDeterminismCases } from "@kindling/core";
import { runDeterminism } from "@kindling/core/node";
import { fileURLToPath } from "node:url";
import { playCpuMatch } from "../src/sim/headless.ts";
import type { RoverId } from "../src/sim/types.ts";

interface Case {
  name: string;
  seed: number;
  rovers: RoverId[];
  skill: number[];
}

const CASES: Case[] = [
  { name: "duel-scout-brute-11", seed: 11, rovers: ["scout", "brute"], skill: [0.8, 0.8] },
  { name: "trio-23", seed: 23, rovers: ["spark", "brute", "scout"], skill: [0.5, 0.9, 0.7] },
  { name: "four-way-37", seed: 37, rovers: ["scout", "brute", "spark", "spark"], skill: [0.7, 0.7, 0.7, 0.7] },
  { name: "mirror-brutes-5", seed: 5, rovers: ["brute", "brute", "brute", "brute"], skill: [0.2, 0.4, 0.6, 1] },
  { name: "long-duel-99", seed: 99, rovers: ["spark", "scout"], skill: [0.1, 0.1] },
];

const suite = defineDeterminismCases(CASES, (c) =>
  playCpuMatch({ seed: c.seed, rovers: c.rovers }, { skill: c.skill }).world.sections(),
);
process.exitCode = runDeterminism(suite, {
  baselinePath: fileURLToPath(new URL("determinism.baseline.json", import.meta.url)),
}).code;
