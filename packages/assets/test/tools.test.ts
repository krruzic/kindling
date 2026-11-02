import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test, eq, ok } from "./harness.ts";
import { screenshots, findChromium } from "../src/screenshot.ts";

const here = dirname(fileURLToPath(import.meta.url));
const tmp = () => mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "kassets-"));
const has = (cmd: string) => spawnSync("sh", ["-c", `command -v ${cmd}`]).status === 0;

test("blender smoke: textured part with sockets, CPU bake, thumbnail, rig transfer, all verified", () => {
  if (process.env.SKIP_BLENDER || !has("blender")) {
    console.log("     (skipped: no blender)");
    return;
  }
  const out = tmp();
  const r = spawnSync(
    "nice",
    ["-n", "10", "blender", "-b", "--factory-startup", "-P", join(here, "..", "blender", "smoke.py"), "--", out],
    { encoding: "utf8", env: { ...process.env, KINDLING_THREADS: "2" }, timeout: 300_000 },
  );
  const line = r.stdout.split("\n").find((l) => l.startsWith("RESULT "));
  ok(line, `no RESULT line (status ${r.status}):\n${r.stdout.slice(-2000)}\n${r.stderr.slice(-2000)}`);
  const res = JSON.parse(line.slice(7));
  eq(res.part.extras.S_top.size, 0.5, "socket custom prop exported as glTF extras");
  eq(res.part.extras.S_side.kind, "lamp");
  ok(res.part.materials.includes("team"), "team material kept by name");
  eq(res.rig.clips.join(), "bend");
  ok(existsSync(join(out, "smoke_thumb.png")));
  // The verifier is plain Python: the same checks run outside Blender.
  const v = execFileSync(
    "python3",
    [
      join(here, "..", "blender", "kindling_bpy", "verify.py"),
      join(out, "smoke.glb"),
      "--nodes",
      "body,S_top",
      "--materials",
      "team",
      "--max-tris",
      "200",
      "--ground",
      "0.001",
      "--extras",
      "S_top:size",
      "--json",
    ],
    { encoding: "utf8" },
  );
  ok(JSON.parse(v).ok);
  const bad = spawnSync(
    "python3",
    [
      join(here, "..", "blender", "kindling_bpy", "verify.py"),
      join(out, "smoke.glb"),
      "--max-tris",
      "10",
      "--nodes",
      "S_nope",
    ],
    { encoding: "utf8" },
  );
  eq(bad.status, 1, "budget / missing node fail the verifier");
  ok(bad.stdout.includes("triangles > budget 10") && bad.stdout.includes("missing node S_nope"));
  const rig = execFileSync(
    "python3",
    [
      join(here, "..", "blender", "kindling_bpy", "verify.py"),
      join(out, "rigged.glb"),
      "--clips",
      "bend",
      "--skinned",
      "--json",
    ],
    { encoding: "utf8" },
  );
  ok(JSON.parse(rig).ok, rig);
});

test("screenshot harness: sizes, predicate, console errors", async () => {
  let chromium = "";
  try {
    chromium = findChromium();
  } catch {
    console.log("     (skipped: no chromium)");
    return;
  }
  const out = tmp();
  const html = encodeURIComponent(
    "<body style='margin:0;background:#235'><h1 style='color:#fc0'>hi</h1><script>setTimeout(()=>{window.ready=1;console.error('boom')},50)</script></body>",
  );
  const r = await screenshots({
    targets: [{ name: "page", url: `data:text/html,${html}` }],
    out,
    sizes: [
      { width: 320, height: 200 },
      { width: 200, height: 320, name: "tall" },
    ],
    waitFor: "window.ready === 1",
    chromium,
    timeoutMs: 30_000,
  });
  eq(r.files.length, 2);
  ok(r.files[1].endsWith("page_tall.png"));
  ok(r.files.every((f) => existsSync(f)));
  eq(
    r.problems.filter((p) => p.kind === "console" && p.message === "boom").length,
    2,
    "console errors collected per shot",
  );
});
