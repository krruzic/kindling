// @kindling/three demo: two rovers assembled by sockets from part GLBs made by @kindling/assets'
// blender/demo_parts.py (chassis + wheels scaled by socket extras + turret + barrel), team-dyed, with the turret's
// glTF clips driven by the AnimationController (idle loop, "fire" one-shot returning to idle). Firing spawns
// budgeted additive particles, a shockwave ring and a scorch decal; the lamps are glow sprites; snow falls; string
// lights hang between posts and spiral up a tree. Camera: arena framing of both rovers (default) or ?cam=follow
// (locked follow with a whole-pixel lean). Adaptive render scale and ?perf stats overlay.
//   ?cam=follow  ?perf  ?t=<seconds to pre-roll>  ?scale=<fixed render scale>
import * as THREE from "three";
import {
  AdaptiveResolution,
  AnimationController,
  ArenaCamera,
  AssetCache,
  DecalLayer,
  GlowSprites,
  LockedFollowCam,
  Particles,
  PerfOverlay,
  RenderStats,
  StringLights,
  applyRenderScale,
  assembleBySockets,
  dyeTeam,
  dyeColor,
  fitByExtra,
  flakeTexture,
  glowTexture,
  namedNodes,
  placeCamera,
  ringTexture,
  sagLine,
  scorchTexture,
  snowfall,
  spiral,
  mulberry32,
  mergeStatic,
} from "../src/index.ts";

const params = new URLSearchParams(location.search);
const ARENA = 14;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a2233);
scene.fog = new THREE.Fog(0x1a2233, 30, 70);
const camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 200);

scene.add(new THREE.HemisphereLight(0xb8c8ff, 0x2a2018, 1.1));
const sun = new THREE.DirectionalLight(0xfff0dd, 1.6);
sun.position.set(-8, 14, 6);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
Object.assign(sun.shadow.camera, { left: -16, right: 16, top: 16, bottom: -16, near: 1, far: 50 });
scene.add(sun);

const ground = new THREE.Mesh(
  new THREE.CircleGeometry(ARENA + 4, 48).rotateX(-Math.PI / 2),
  new THREE.MeshLambertMaterial({ color: 0x4a5560 }),
);
ground.receiveShadow = true;
scene.add(ground);

// ── Dressing: posts with string lights, a tree with a spiral of bulbs, snow ──
const posts: THREE.Vector3[] = [];
const postMat = new THREE.MeshLambertMaterial({ color: 0x5a4030 });
const dressing = new THREE.Group();
for (let i = 0; i < 10; i++) {
  const a = (i / 10) * Math.PI * 2;
  const p = new THREE.Vector3(Math.cos(a) * (ARENA - 1), 2.6, Math.sin(a) * (ARENA - 1));
  const m = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 2.6, 6), postMat);
  m.position.set(p.x, 1.3, p.z);
  dressing.add(m);
  posts.push(p);
}
const tree = new THREE.Mesh(new THREE.ConeGeometry(1.5, 4.2, 10), new THREE.MeshLambertMaterial({ color: 0x1f5a2c }));
tree.position.y = 2.1 + 0.4;
const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.25, 0.6, 6), postMat);
trunk.position.y = 0.3;
dressing.add(tree, trunk);
// Static dressing merged into one mesh per material: 12 meshes, 2 draws (4 with the shadow pass).
const merged = mergeStatic(dressing);
merged.traverse((o) => (o.castShadow = (o as THREE.Mesh).isMesh));
scene.add(merged);
const lights = new StringLights(
  [
    ...posts.map((p, i) => sagLine(p, posts[(i + 1) % posts.length], 0.7)),
    spiral(0, 0, 0.55, 4.4, 0.7, (t) => 1.55 * (1 - t) + 0.08),
  ],
  { spacing: 0.45, size: 0.75, warmShare: 0.3 },
);
scene.add(lights.points);
const snow = snowfall({ x0: -20, z0: -20, x1: 20, z1: 20, base: 0, height: 14, count: 1800, size: 0.28, seed: 4 });
scene.add(snow.points);

// ── FX ──
const particles = new Particles(1500);
scene.add(particles.root);
const sparkTex = glowTexture(32);
const smokeTex = flakeTexture(32);
const rings = new DecalLayer(ringTexture(128), 32, { additive: true });
const scorches = new DecalLayer(scorchTexture(128, 3), 24);
const footRings = new DecalLayer(ringTexture(64, 0.8, 0.95, 0.04), 8, { additive: true });
const glows = new GlowSprites(glowTexture(64));
scene.add(rings.object, scorches.object, footRings.object, glows.object);
const star = glows.add({
  x: 0,
  y: 4.85,
  z: 0,
  color: 0xffd23a,
  size: 1.6,
  intensity: 1.4,
  pulseRate: 3,
  pulseDepth: 0.3,
});
void star;

// ── Rovers ──
const cache = new AssetCache({
  prepare: (root) =>
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.castShadow = m.receiveShadow = true;
    }),
});
const url = (n: string) => `./parts/${n}.glb`;
await Promise.all(["chassis", "wheel", "turret", "barrel"].map((n) => cache.load(url(n))));
const node = (file: string, name: string) => namedNodes(cache.get(url(file))!.scene).get(name)!;

interface Rover {
  root: THREE.Object3D;
  wheels: THREE.Object3D[];
  anim: AnimationController;
  lamps: { socket: THREE.Object3D; glow: number }[];
  muzzle: THREE.Object3D;
  ring: number;
  phase: number;
  dir: number;
  radius: number;
  nextFire: number;
  color: THREE.Color;
}

function makeRover(color: number, phase: number, dir: number, radius: number): Rover {
  const base = node("chassis", "chassis").clone(true);
  const a = assembleBySockets(base, [
    { socket: /^S_wheel_/, part: node("wheel", "wheel"), fit: fitByExtra("r") },
    { socket: "S_turret", part: node("turret", "turret") },
    { socket: "S_barrel", part: node("barrel", "barrel") },
  ]);
  if (a.missing.length) console.warn("missing sockets", a.missing);
  const root = new THREE.Group();
  root.add(base);
  const c = new THREE.Color(color);
  dyeTeam(root, c, { adjust: (x) => dyeColor(x, 0.9, 0.95) });
  const turret = a.attached.get("S_turret")![0];
  const anim = new AnimationController(turret, cache.clips(url("turret")), {
    oneShot: ["fire"],
    returnTo: "idle",
    fallbacks: { shoot: "fire" },
    fade: 0.12,
  });
  anim.play("idle");
  const lamps = ["S_lamp_L", "S_lamp_R"].map((n) => {
    const s = a.sockets.get(n)!;
    return {
      socket: s,
      glow: glows.add({ x: 0, y: 0, z: 0, color: String(s.userData.color ?? "#ffd890"), size: 1.1 }),
    };
  });
  const muzzle = namedNodes(a.attached.get("S_barrel")![0]).get("muzzle")!;
  scene.add(root);
  return {
    root,
    wheels: [...a.attached].filter(([k]) => k.startsWith("S_wheel_")).flatMap(([, v]) => v),
    anim,
    lamps,
    muzzle,
    ring: footRings.pin({ x: 0, z: 0, size: 2.6, color: c, opacity: 0.8 }),
    phase,
    dir,
    radius,
    nextFire: 1 + phase,
    color: c,
  };
}

const rovers = [makeRover(0xe8453c, 0, 1, 7), makeRover(0x3c8ce8, 2.2, -1, 4.5)];

// ── Cameras ──
const rig = { pitchDeg: 52, fovDeg: 40, lookAhead: 0.04 };
const arena = new ArenaCamera(camera, {
  rig,
  margin: 5,
  minWidth: 15,
  maxWidth: 40,
  bounds: { x0: -ARENA, z0: -ARENA, x1: ARENA, z1: ARENA },
});
const PPU = 32;
const follow = new LockedFollowCam(18 * PPU, 10 * PPU);
const useFollow = params.get("cam") === "follow";

// ── Loop ──
const adaptive = new AdaptiveResolution({ budgetMs: 1000 / 60 });
const fixedScale = params.has("scale") ? Number(params.get("scale")) : 0;
const stats = new RenderStats(renderer);
const overlay = params.has("perf") ? new PerfOverlay() : null;
const rand = mulberry32(11);
const tmp = new THREE.Vector3();
const fwd = new THREE.Vector3();
let time = 0;
let tick = 0;
let acc = 0;
let frames = 0;

function resize(): void {
  applyRenderScale(renderer, fixedScale || adaptive.scale, innerWidth, innerHeight, devicePixelRatio);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener("resize", resize);
resize();

function fire(r: Rover): void {
  r.anim.play("shoot", { restart: true });
  r.muzzle.getWorldPosition(tmp);
  r.root.getWorldDirection(fwd);
  particles.emit(
    {
      tex: sparkTex,
      n: 40,
      x: tmp.x,
      y: tmp.y,
      z: tmp.z,
      color: 0xffb050,
      additive: true,
      size: [0.12, 0.3],
      life: [0.25, 0.6],
      speed: [3, 8],
      dir: fwd,
      cone: 0.35,
      gravity: 6,
      drag: 1.5,
      floor: 0.05,
      stretch: 1.8,
    },
    rand,
  );
  particles.emit(
    {
      tex: smokeTex,
      n: 10,
      x: tmp.x,
      y: tmp.y,
      z: tmp.z,
      color: 0x8a8f99,
      opacity: 0.5,
      size: [0.3, 0.5],
      grow: 3,
      life: [0.8, 1.4],
      speed: [0.3, 1],
      dir: fwd,
      cone: 0.6,
      up: [0.4, 0.9],
      drag: 0.8,
    },
    rand,
  );
  const hit = tmp.clone().addScaledVector(fwd, 5);
  hit.y = 0;
  rings.spawn({ x: hit.x, z: hit.z, size: 0.8, grow: 4, life: 0.6, color: 0xffa040 });
  scorches.spawn({
    x: hit.x,
    z: hit.z,
    size: 1.4 + rand() * 0.6,
    life: 8,
    color: 0x140c08,
    opacity: 0.85,
    rot: rand() * 6.28,
    fadeOut: 0.3,
  });
  particles.emit(
    {
      tex: sparkTex,
      n: 30,
      x: hit.x,
      y: 0.1,
      z: hit.z,
      color: 0xffd080,
      additive: true,
      size: [0.1, 0.25],
      life: [0.3, 0.7],
      speed: [2, 5],
      dir: { x: 0, y: 1, z: 0 },
      cone: 1.2,
      gravity: 9,
      floor: 0.02,
    },
    rand,
  );
}

function step(dt: number): void {
  time += dt;
  for (const r of rovers) {
    const a = r.phase + (time * r.dir * 3.2) / r.radius;
    r.root.position.set(Math.cos(a) * r.radius, 0, Math.sin(a) * r.radius);
    r.root.rotation.y = -a + (r.dir < 0 ? Math.PI : 0);
    for (const w of r.wheels) w.rotation.x += (dt * 3.2) / 0.2;
    if (time >= r.nextFire) {
      fire(r);
      r.nextFire = time + 1.6 + rand();
    }
    r.anim.update(dt);
  }
}

function frame(dt: number): void {
  dt = Math.min(dt, 1 / 20);
  acc += dt;
  while (acc >= 1 / 60) {
    acc -= 1 / 60;
    tick++;
    step(1 / 60);
  }
  scene.updateMatrixWorld();
  for (const r of rovers) {
    for (const l of r.lamps) {
      l.socket.getWorldPosition(tmp);
      glows.set(l.glow, { x: tmp.x, y: tmp.y, z: tmp.z, intensity: 0.9 + 0.1 * Math.sin(time * 20) });
    }
    footRings.move(r.ring, { x: r.root.position.x, z: r.root.position.z });
  }
  particles.update(dt);
  rings.update(dt);
  scorches.update(dt);
  footRings.update(dt);
  glows.update(time);
  lights.update(time);
  snow.update(time);
  if (useFollow) {
    const p = rovers[0].root.position;
    const v = new THREE.Vector3(Math.sin(rovers[0].root.rotation.y), 0, Math.cos(rovers[0].root.rotation.y));
    follow.update(tick, { x: p.x * PPU, y: p.z * PPU, vx: v.x * 3.2, vy: v.z * 3.2, moving: true, speed: 3.2 }, null);
    placeCamera(camera, rig, tmp.set((follow.ix + follow.vw / 2) / PPU, 0, (follow.iy + follow.vh / 2) / PPU), 18);
  } else
    arena.update(
      rovers.map((r) => r.root.position),
      dt,
    );
  stats.gpu.begin("scene");
  renderer.render(scene, camera);
  stats.gpu.end();
}

const preroll = Number(params.get("t") ?? 0);
for (let t = 0; t < preroll; t += 1 / 30) frame(1 / 30);

let last = performance.now();
renderer.setAnimationLoop((now) => {
  const dt = (now - last) / 1000;
  last = now;
  frame(dt);
  frames++;
  if (!fixedScale && adaptive.frame(dt * 1000)) resize();
  const snap = stats.frame(now);
  if (snap && overlay)
    overlay.show(snap, { scale: fixedScale || adaptive.scale, particles: particles.live, bulbs: lights.count });
  (window as unknown as { demo: unknown }).demo = {
    frames,
    time,
    scale: fixedScale || adaptive.scale,
    particles: particles.live,
    stats: stats.snapshot,
  };
});
