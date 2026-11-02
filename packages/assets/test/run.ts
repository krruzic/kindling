// Node tests for @kindling/assets. No network and no fal credit: the fal client runs against a mocked fetch. The
// slicer runs on a synthetic sheet, the RL bridge against a toy env, and the Blender modules in one headless smoke
// run (CPU only; skipped without blender, or with SKIP_BLENDER=1).
import { run } from "./harness.ts";
import "./fal.test.ts";
import "./pipeline.test.ts";
import "./rl.test.ts";
import "./tools.test.ts";

await run();
