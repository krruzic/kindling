# @kindling/three

three.js helpers for the presentation side of a Kindling game: loading and composing models, team colours,
animation, cheap effects, dressing, cameras and performance control. Extracted from Grudge's `src/render`, RUST
RING's socket-composed bots and QUICKLORE's follow camera. `three` is a peer dependency. Nothing here may write back
into a simulation.

## Why

See [docs/LESSONS.md](../../docs/LESSONS.md), **Rendering**:

- Budget for the weakest machine (a Ryzen 5 3400G iGPU at 1080p): measure draw calls and GPU time (`RenderStats`,
  `PerfOverlay`), instanced particles (`Particles`), additive fake glow instead of real lights (`GlowSprites`,
  `StringLights`), merged static geometry (`mergeStatic`), and an adaptive render scale (`AdaptiveResolution`).
- A spring-follow plus velocity lookahead plus pixel rounding jitters. `LockedFollowCam` locks the target to its
  rounded position and eases only a whole-pixel lean toward a _steady_ direction.
- Composable models: each part its own GLB with named socket empties and glTF extras, assembled at runtime
  (`assembleBySockets`), team colour through a dedicated material name dyed at runtime (`dyeTeam`).

And **Architecture**: presentation-only features (cameras, holiday dressing, effects) stay out of the sim.

## API

| Module         | Exports                                                                                                                                                                                                                                                   |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `loader.ts`    | `AssetCache` (each GLB loads once, in-flight requests shared, SkeletonUtils clones, optional DRACO / KTX2 loaded lazily, `loadOr(url, placeholder)` never rejects, `prepare` hook)                                                                        |
| `sockets.ts`   | `assembleBySockets(base, parts)` -> `{ root, sockets, attached, missing }`; parts attach to a socket name or a RegExp (every match), bring their own sockets (chains), `fit` from extras (`fitByExtra("r")`); `findSockets`, `namedNodes`, `socketMatrix` |
| `dye.ts`       | `dyeTeam(root, color, { match: /^team/i, mode: "replace" \| "multiply", emissive, adjust })` clones matching materials per instance; `recolor`, `dyeColor` (Grudge's desaturated team tint)                                                               |
| `animation.ts` | `AnimationController(root, clips, { oneShot, fallbacks, fallbackClip, fade, returnTo })`: `play(name, { fade, timeScale, restart, once })`, `resolve`, `duration`, `onFinished`, `done`, `update(dt)`                                                     |
| `particles.ts` | `Particles(budget)`: `emit({ tex, n, x, y, z, size, life, speed, dir, cone, gravity, drag, floor, additive, ... }, rand)`, `spawn`, `update(dt)`, `live`, `batches`, `density`; one draw per (blend, depth test, order) lane for up to 12 textures        |
| `quads.ts`     | `QuadBatch(tex, { mode: "billboard" \| "ground", additive })`: one instanced draw of textured quads                                                                                                                                                       |
| `glow.ts`      | `GlowSprites`: persistent additive billboards (`add`, `set`, `remove`, pulse), the fake-light workhorse                                                                                                                                                   |
| `decals.ts`    | `DecalLayer(tex, budget)`: ground quads that grow and fade (`spawn`), oldest recycled at budget; `pin` / `move` / `unpin` for persistent rings                                                                                                            |
| `weather.ts`   | `WeatherPoints`, `snowfall(area)`, `WEATHER_PRESETS` (snow, rain, embers): one Points draw, motion in the vertex shader, seeded scatter; `mulberry32`                                                                                                     |
| `lights.ts`    | `StringLights(polylines, { spacing, colors, warmShare, size, twinkle })` and curve helpers `pointsAlong`, `sagLine`, `festoon`, `spiral`, `sampleCurve`                                                                                                   |
| `textures.ts`  | DataTexture sprites (work in node): `glowTexture`, `bulbTexture`, `flakeTexture`, `ringTexture`, `scorchTexture`, `radialTexture`, `alphaTexture`                                                                                                         |
| `batch.ts`     | `mergeStatic(root)` (one mesh per material), `InstancePool` (add / set / remove handles, swap-remove, grows), `drawCount`                                                                                                                                 |
| `camera.ts`    | `placeCamera(cam, rig, focus, width, yaw)`, `frameTargets(points, opts)` (pure), `ArenaCamera` (eased, clamped to the map, keeps points in a safe box), `LockedFollowCam` (tick-stepped, whole-pixel lean, bounds, pans between rooms, cuts on warps)     |
| `adaptive.ts`  | `AdaptiveResolution({ budgetMs, levels, window, upHeadroom, upAfterMs })`: `frame(ms)` returns true when `scale` changed; `applyRenderScale(renderer, scale, cssW, cssH, dpr)`                                                                            |
| `stats.ts`     | `RenderStats(renderer)` (calls / triangles summed over every render of a frame, frame p90, custom counters), `GpuTimer` (EXT_disjoint_timer_query_webgl2, no-op without it), `PerfOverlay`, `formatStats`                                                 |

## Usage

```ts
import * as THREE from "three";
import {
  AssetCache,
  assembleBySockets,
  fitByExtra,
  dyeTeam,
  AnimationController,
  Particles,
  glowTexture,
} from "@kindling/three";

const cache = new AssetCache();
await Promise.all(["chassis", "wheel", "turret"].map((p) => cache.load(`/parts/${p}.glb`)));
const base = cache.instance("/parts/chassis.glb");
const bot = assembleBySockets(base, [
  { socket: /^S_wheel_/, part: cache.get("/parts/wheel.glb")!.scene, fit: fitByExtra("r") },
  { socket: "S_turret", part: cache.get("/parts/turret.glb")!.scene },
]);
dyeTeam(bot.root, 0xe8453c);
const turret = new AnimationController(bot.attached.get("S_turret")![0], cache.clips("/parts/turret.glb"), {
  oneShot: ["fire"],
  returnTo: "idle",
  fallbacks: { shoot: "fire" },
});
turret.play("idle");

const fx = new Particles(1500);
scene.add(fx.root);
fx.emit({
  tex: glowTexture(),
  n: 30,
  x: 0,
  y: 1,
  z: 0,
  additive: true,
  size: [0.1, 0.3],
  life: [0.3, 0.6],
  speed: [2, 6],
});
// per frame: turret.update(dt); fx.update(dt);
```

Locked follow (2D pixels, or world units times pixels-per-unit for a 3D view):

```ts
const cam = new LockedFollowCam(320, 180);
// once per sim tick:
cam.update(
  world.tick,
  { x: p.x, y: p.y, vx: p.vx, vy: p.vy, moving: p.walking, speed: p.maxSpeed },
  roomBounds,
  roomId,
);
ctx.drawImage(level, -cam.ix, -cam.iy);
```

## Demo

`pnpm --filter @kindling/three demo` serves `demo/`: two rovers assembled from the part GLBs in
`demo/public/parts/` (made by `@kindling/assets`' `blender/demo_parts.py`), team-dyed, turret clips through the
animation controller, firing particles, shockwave rings and scorch decals, lamp glow sprites, snowfall, string lights
on posts and a tree, merged static dressing, arena camera (or `?cam=follow`), adaptive scale, `?perf` overlay.
`pnpm --filter @kindling/three demo:shots [outDir]` screenshots it at 1920x1080, 1280x720 and 1440x900 with the
`@kindling/assets` harness and writes a contact sheet; it fails on any console error.

## Tests

`pnpm test`: node tests on real three objects (no WebGL): camera framing and clamping, the locked follow cam never
stepping back or drifting, adaptive scale stepping, socket transform composition through chained sockets,
per-instance dyeing, animation fallbacks / one-shot return, particle budget, decal recycling, string light spacing.

## In Grudge

`camera.ts` is Grudge's `placeCam` / `aimCamera` (shared and split-screen match views), `particles.ts` its
`fx/particles.ts` (every ability effect), `animation.ts` the clip tables and `play()` of `entities/`, `dye.ts` the hero
and unit team dye, `weather.ts` / `lights.ts` / `glow.ts` the Christmas and Halloween dressing (snow, bulbs on trees
and towers, lanterns), `decals.ts` the ground rings and scorch marks, `stats.ts` the `?perf` overlay. Sockets come
from RUST RING's bot assembly and the follow camera from QUICKLORE.
