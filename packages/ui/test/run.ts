// Runs every UI test file (plain node, no framework): node --experimental-transform-types test/run.ts
import { run } from "./harness.ts";
import "./layout.test.ts";
import "./text.test.ts";
import "./components.test.ts";

await run();
