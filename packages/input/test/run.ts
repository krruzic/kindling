// Runs every test file (each registers its tests on import).
import { run } from "./assert.ts";
import "./trigger.test.ts";
import "./families.test.ts";
import "./remap.test.ts";
import "./seats.test.ts";
import "./nav.test.ts";
import "./sticks.test.ts";
import "./hid.test.ts";
import "./rumble.test.ts";

process.exit(await run());
