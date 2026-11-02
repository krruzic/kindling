// Runs every audio test (plain node, no framework): node --experimental-transform-types test/run.ts
import { run } from "./harness.ts";
import "./audio.test.ts";

await run();
