// Runs every core test file.
import "./rng.test.ts";
import "./hash.test.ts";
import "./loop.test.ts";
import "./determinism.test.ts";
import "./headless.test.ts";
import "./misc.test.ts";
import { run } from "./harness.ts";

await run();
