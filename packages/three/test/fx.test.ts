import * as THREE from "three";
import { test, eq, ok, near } from "./harness.ts";
import { Particles } from "../src/particles.ts";
import { DecalLayer } from "../src/decals.ts";
import { GlowSprites } from "../src/glow.ts";
import { StringLights, pointsAlong, sagLine, festoon, spiral } from "../src/lights.ts";
import { WeatherPoints, mulberry32, snowfall } from "../src/weather.ts";
import { glowTexture, ringTexture } from "../src/textures.ts";
import { GpuTimer, formatStats } from "../src/stats.ts";

test("Particles: budget caps a burst; they die; batches by blend", () => {
  const p = new Particles(100);
  const a = glowTexture(8);
  const b = glowTexture(8);
  const rand = mulberry32(3);
  const base = { x: 0, y: 1, z: 0, size: [0.2, 0.4] as const, life: 0.5, speed: [1, 2] as const };
  eq(p.emit({ ...base, tex: a, n: 60, additive: true }, rand), 60);
  eq(p.emit({ ...base, tex: b, n: 60 }, rand), 40, "only 40 fit under the budget");
  eq(p.live, 100);
  p.update(0.1);
  eq(p.batches, 2, "additive and normal draws");
  p.update(1);
  eq(p.live, 0);
  eq(p.batches, 0);
  p.density = 0.5;
  eq(p.emit({ ...base, tex: a, n: 10, floor: 0, gravity: 9.8 }, rand), 5, "density scales bursts");
});

test("DecalLayer: grow/fade, budget recycles the oldest, pins persist", () => {
  const d = new DecalLayer(ringTexture(16), 3);
  d.spawn({ x: 0, z: 0, life: 1, grow: 3 });
  d.spawn({ x: 1, z: 0, life: 1 });
  const pin = d.pin({ x: 5, z: 5, size: 2 });
  d.spawn({ x: 2, z: 0, life: 1 });
  eq(d.live, 3, "at budget the oldest was recycled");
  d.update(0.5);
  eq(d.batch.count, 3);
  d.move(pin, { x: 7 });
  d.update(0.6);
  eq(d.batch.count, 1, "transients expired, the pin stays");
  d.unpin(pin);
  d.update(0.1);
  eq(d.batch.count, 0);
  ok(!d.object.visible);
});

test("GlowSprites: handles, pulse, reuse", () => {
  const g = new GlowSprites(glowTexture(8));
  const a = g.add({ x: 0, y: 1, z: 0, color: 0xff0000, size: 2, pulseRate: 3, pulseDepth: 0.5 });
  const b = g.add({ x: 1, y: 1, z: 0 });
  g.remove(a);
  eq(g.live, 1);
  const c = g.add({ x: 2, y: 1, z: 0 });
  eq(c, a, "slot reused");
  g.set(b, { intensity: 2 });
  g.update(0);
  eq(g.batch.count, 2);
});

test("pointsAlong: even arc-length spacing across segments", () => {
  const line = [
    { x: 0, y: 0, z: 0 },
    { x: 3, y: 0, z: 0 },
    { x: 3, y: 0, z: 7 },
  ];
  const pts = pointsAlong(line, 1);
  eq(pts.length, 10);
  near(pts[0].x, 0.5, 1e-9);
  near(pts[3].x, 3, 1e-9);
  near(pts[3].z, 0.5, 1e-9, "continues round the corner");
  for (let i = 1; i < pts.length; i++) ok(pts[i].distanceTo(pts[i - 1]) <= 1 + 1e-9);
  const sag = sagLine({ x: 0, y: 5, z: 0 }, { x: 10, y: 5, z: 0 }, 1);
  near(sag[8].y, 4, 1e-9, "sags 1 at the middle");
  eq(festoon(0, 0, 3, 1, 6, 0.2).length, 6);
  const sp = spiral(0, 0, 0, 4, 1, (t) => 1 - t);
  near(sp[sp.length - 1].y, 4, 1e-9);
  const lights = new StringLights([sag, ...festoon(0, 0, 3, 1, 6, 0.2)], { spacing: 0.5 });
  ok(lights.count > 20);
  lights.update(1.2);
});

test("WeatherPoints: seeded scatter inside the area", () => {
  const w = snowfall({ x0: -5, z0: -5, x1: 5, z1: 5, count: 500, seed: 9 });
  const pos = w.points.geometry.getAttribute("position");
  eq(pos.count, 500);
  for (let i = 0; i < pos.count; i++) ok(Math.abs(pos.getX(i)) <= 5 && pos.getY(i) >= 0);
  const again = new WeatherPoints({ x0: -5, z0: -5, x1: 5, z1: 5, count: 500, seed: 9 });
  eq(again.points.geometry.getAttribute("position").getX(77), pos.getX(77), "reproducible");
  w.update(3);
});

test("textures: ring alpha profile", () => {
  const t = ringTexture(64, 0.7, 0.9, 0.05);
  const d = t.image.data as Uint8Array;
  const at = (x: number, y: number) => d[(y * 64 + x) * 4 + 3];
  eq(at(32, 32), 0, "hollow centre");
  ok(at(32 + 25, 32) > 200, "solid on the ring (r ~ 0.8)");
  eq(at(0, 0), 0, "clear corners");
});

test("stats: GpuTimer degrades without the extension; formatStats", () => {
  const fake = { getExtension: () => null } as unknown as WebGL2RenderingContext;
  const t = new GpuTimer(fake);
  ok(!t.supported);
  t.begin("scene");
  t.end();
  t.poll();
  eq(t.take().size, 0);
  const s = formatStats({
    fps: 60,
    frameMs: 16.6,
    frameP90: 17,
    frameMax: 20,
    calls: 42,
    triangles: 1000,
    points: 0,
    lines: 0,
    gpu: { scene: 3.2 },
    programs: 5,
    textures: 3,
    geometries: 9,
    stats: {},
  });
  ok(s.includes("draw calls") && s.includes("42.00") && s.includes("gpu scene"));
  void THREE;
});
