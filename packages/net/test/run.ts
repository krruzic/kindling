// Test entry: registers every suite, then runs them in order.
import { run } from "./harness.ts";
import "./lockstep.test.ts";
import "./lobby.test.ts";
import "./relay.test.ts";

await run();
