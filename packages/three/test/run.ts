// Node tests for @kindling/three: the pure maths (camera framing, locked follow, adaptive scale), socket transform
// composition, dyeing, animation fallbacks and the fx bookkeeping, all on real three.js objects (no WebGL).
import { run } from "./harness.ts";
import "./camera.test.ts";
import "./adaptive.test.ts";
import "./models.test.ts";
import "./fx.test.ts";

await run();
