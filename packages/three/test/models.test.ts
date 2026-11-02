import * as THREE from "three";
import { test, eq, ok, near } from "./harness.ts";
import { assembleBySockets, findSockets, fitByExtra, socketMatrix } from "../src/sockets.ts";
import { dyeTeam, recolor, dyeColor } from "../src/dye.ts";
import { AnimationController } from "../src/animation.ts";
import { AssetCache } from "../src/loader.ts";
import { mergeStatic, InstancePool, drawCount } from "../src/batch.ts";

function socket(name: string, x: number, y: number, z: number, extras: Record<string, unknown> = {}) {
  const s = new THREE.Object3D();
  s.name = name;
  s.position.set(x, y, z);
  Object.assign(s.userData, extras);
  return s;
}

const box = (name: string, mat: THREE.Material = new THREE.MeshBasicMaterial()) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat);
  m.name = name;
  return m;
};

test("assembleBySockets: transforms compose through chained sockets", () => {
  const body = new THREE.Group();
  body.name = "body";
  const top = socket("S_top", 0, 1, 0);
  top.rotation.y = Math.PI / 2;
  body.add(top, socket("S_wheel_L1", 0.5, 0, 0.5, { r: 0.3 }), socket("S_wheel_R1", -0.5, 0, 0.5, { r: 0.2 }));
  body.position.set(10, 0, 0);
  const turret = box("turret");
  turret.position.set(5, 5, 5);
  turret.add(socket("S_tip", 0, 0, 1));
  const barrel = box("barrel");
  const wheel = box("wheel");
  wheel.userData.r = 0.1;
  const a = assembleBySockets(body, [
    { socket: "S_top", part: turret },
    { socket: "S_tip", part: barrel },
    { socket: /^S_wheel_/, part: wheel, fit: fitByExtra("r") },
    { socket: "S_gadget", part: box("gadget") },
  ]);
  eq(a.missing.join(), "S_gadget", "missing socket reported, not thrown");
  ok(a.sockets.has("S_tip"), "sockets brought by attached parts are found");
  const b = a.attached.get("S_tip")![0];
  const p = b.getWorldPosition(new THREE.Vector3());
  near(p.x, 11, 1e-9, "x: body 10 + rotated tip 1");
  near(p.y, 1, 1e-9);
  near(p.z, 0, 1e-9);
  eq(turret.position.x, 5, "template untouched (cloned)");
  eq(turret.parent, null);
  const wl = a.attached.get("S_wheel_L1")![0];
  const wr = a.attached.get("S_wheel_R1")![0];
  near(wl.scale.x, 3, 1e-9, "wheel scaled to socket radius");
  near(wr.scale.x, 2, 1e-9);
  const m = socketMatrix(body, a.sockets.get("S_tip")!);
  const local = new THREE.Vector3().setFromMatrixPosition(m);
  near(local.x, 1, 1e-9, "socketMatrix is body-local");
  eq(findSockets(body).size, 4);
});

test("dyeTeam: per-instance copies of team materials only", () => {
  const team = new THREE.MeshLambertMaterial({ name: "team_cloth", color: 0xffffff });
  const stone = new THREE.MeshLambertMaterial({ name: "stone", color: 0x808080 });
  const make = () => {
    const g = new THREE.Group();
    g.add(box("a", team), box("b", stone));
    const multi = new THREE.Mesh(new THREE.BoxGeometry(), [team, stone]);
    g.add(multi);
    return g;
  };
  const red = make();
  const blue = make();
  const mr = dyeTeam(red, 0xff0000);
  const mb = dyeTeam(blue, 0x0000ff, { mode: "multiply" });
  eq(mr.length, 1, "one copy per source material per call");
  const ra = red.children[0] as THREE.Mesh<THREE.BoxGeometry, THREE.MeshLambertMaterial>;
  const ba = blue.children[0] as THREE.Mesh<THREE.BoxGeometry, THREE.MeshLambertMaterial>;
  eq(ra.material.color.getHex(), 0xff0000);
  eq(ba.material.color.getHex(), 0x0000ff);
  eq(team.color.getHex(), 0xffffff, "source untouched");
  eq((red.children[1] as THREE.Mesh).material, stone, "other materials shared");
  const multi = red.children[2] as THREE.Mesh;
  eq((multi.material as THREE.Material[])[0], ra.material, "multi-material meshes share the same copy");
  recolor(mb, 0x00ff00, { mode: "multiply" });
  eq(ba.material.color.getHex(), 0x00ff00);
  const d = dyeColor(new THREE.Color(0xff0000));
  ok(d.r < 1 && d.g > 0, "dyeColor desaturates and darkens");
});

function clip(name: string, dur: number) {
  return new THREE.AnimationClip(name, dur, [new THREE.VectorKeyframeTrack(".position", [0, dur], [0, 0, 0, 1, 0, 0])]);
}

test("AnimationController: fallbacks, one-shots, return to idle, cross-fade", () => {
  const root = new THREE.Object3D();
  const ac = new AnimationController(root, [clip("idle", 1), clip("run", 0.8), clip("attack_a", 0.5)], {
    oneShot: ["attack_a", "attack_b", "throw"],
    fallbacks: { throw: "attack_b", attack_b: "attack_a", fly: ["glide", "run"] },
    fallbackClip: "idle",
    returnTo: "idle",
    fade: 0.1,
  });
  eq(ac.resolve("throw"), "attack_a", "two hops");
  eq(ac.resolve("fly"), "run", "first available of a list");
  eq(ac.resolve("dance"), "idle", "default clip");
  eq(ac.play("run"), "run");
  ac.update(0.3);
  let finished = "";
  ac.onFinished((n) => (finished = n));
  eq(ac.play("throw"), "attack_a");
  eq(ac.actions.get("attack_a")!.loop, THREE.LoopOnce);
  ac.update(0.05);
  ok(ac.actions.get("run")!.getEffectiveWeight() > 0, "cross-fading: old clip still weighted");
  for (let i = 0; i < 20; i++) ac.update(0.05);
  eq(finished, "attack_a");
  eq(ac.current, "idle", "returned to idle after the one-shot");
  eq(ac.actions.get("idle")!.loop, THREE.LoopRepeat);
  eq(ac.play("idle"), "idle", "already playing: no restart");
  near(ac.duration("throw"), 0.5, 1e-9);
  const hold = new AnimationController(new THREE.Object3D(), [clip("death", 0.4), clip("idle", 1)], {
    oneShot: ["death"],
  });
  hold.play("death");
  for (let i = 0; i < 20; i++) hold.update(0.05);
  ok(hold.done, "done flag");
  eq(hold.current, "death", "no returnTo: holds the last frame");
  eq(hold.play("nothing"), null);
});

test("AssetCache.loadOr: a missing file gives the placeholder, never rejects", async () => {
  const warn = console.warn;
  console.warn = () => {};
  try {
    const c = new AssetCache();
    const r = await c.loadOr("does/not/exist.glb", () => box("placeholder"));
    ok(r.fallback);
    eq(r.scene.name, "placeholder");
  } finally {
    console.warn = warn;
  }
});

test("mergeStatic: one mesh per material, world transforms baked", () => {
  const a = new THREE.MeshBasicMaterial();
  const b = new THREE.MeshBasicMaterial();
  const root = new THREE.Group();
  for (let i = 0; i < 10; i++) {
    const m = box("m" + i, i % 2 ? a : b);
    m.position.set(i * 2, 0, 0);
    root.add(m);
  }
  eq(drawCount(root), 10);
  const merged = mergeStatic(root);
  eq(merged.children.length, 2);
  eq(drawCount(merged), 2);
  const g = (merged.children[0] as THREE.Mesh).geometry;
  eq(g.getAttribute("position").count, 5 * 36);
  g.computeBoundingBox();
  ok(g.boundingBox!.max.x > 15, "positions moved into place");
});

test("InstancePool: add / remove swap-packs, grows", () => {
  const scene = new THREE.Scene();
  const pool = new InstancePool(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial(), 2);
  scene.add(pool.mesh);
  const m = new THREE.Matrix4();
  const ids = [0, 1, 2, 3, 4].map((i) => pool.add(m.makeTranslation(i, 0, 0), 0xffffff));
  eq(pool.count, 5);
  eq(pool.mesh.parent, scene, "grown mesh re-parented");
  pool.remove(ids[1]);
  eq(pool.count, 4);
  pool.mesh.getMatrixAt(1, m);
  eq(new THREE.Vector3().setFromMatrixPosition(m).x, 4, "last moved into the hole");
  pool.set(ids[4], new THREE.Matrix4().makeTranslation(9, 0, 0));
  pool.mesh.getMatrixAt(1, m);
  eq(new THREE.Vector3().setFromMatrixPosition(m).x, 9, "handle follows the move");
});
