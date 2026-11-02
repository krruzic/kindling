import * as THREE from "three";
import { test, ok, eq, near } from "./harness.ts";
import {
  ArenaCamera,
  LockedFollowCam,
  frameTargets,
  placeCamera,
  depthToWidth,
  type FollowTarget,
} from "../src/camera.ts";

const rig = { pitchDeg: 55, fovDeg: 38, lookAhead: 0 };

test("placeCamera: width spans the screen at the focus", () => {
  const cam = new THREE.PerspectiveCamera(38, 16 / 9, 0.1, 500);
  const focus = new THREE.Vector3(10, 0, 5);
  placeCamera(cam, rig, focus, 20);
  const l = new THREE.Vector3(0, 0, 5).project(cam);
  const r = new THREE.Vector3(20, 0, 5).project(cam);
  const c = focus.clone().project(cam);
  near(l.x, -1, 1e-6, "left edge");
  near(r.x, 1, 1e-6, "right edge");
  near(c.x, 0, 1e-9, "centred x");
  near(c.y, 0, 1e-9, "centred y");
  ok(cam.position.y > 0 && cam.position.z > focus.z, "camera above and behind");
});

test("frameTargets: min width, margin, max width", () => {
  const base = { aspect: 16 / 9, pitchDeg: 55, margin: 8, minWidth: 20 };
  const one = frameTargets([{ x: 3, z: 4 }], base);
  eq(one.width, 20, "single target uses minWidth");
  eq(one.x, 3);
  eq(one.z, 4);
  const two = frameTargets(
    [
      { x: 0, z: 0 },
      { x: 30, z: 0 },
    ],
    base,
  );
  eq(two.width, 38, "extent + margin");
  eq(two.x, 15);
  const deep = frameTargets(
    [
      { x: 0, z: 0 },
      { x: 0, z: 10 },
    ],
    base,
  );
  near(deep.width, 10 * depthToWidth(16 / 9, 55) + 8, 1e-9, "depth converted to width");
  const capped = frameTargets(
    [
      { x: 0, z: 0 },
      { x: 300, z: 0 },
    ],
    { ...base, maxWidth: 60 },
  );
  eq(capped.width, 60, "maxWidth");
});

test("frameTargets: clamps to the map", () => {
  const bounds = { x0: 0, z0: 0, x1: 100, z1: 60 };
  const o = { aspect: 16 / 9, pitchDeg: 55, margin: 8, minWidth: 30, bounds };
  // A lone target in the map corner: the view may show at most `slack` beyond the edge.
  const f = frameTargets([{ x: 0, z: 0 }], o);
  const slack = 6 + f.width * 0.15;
  near(f.x, f.width / 2 - slack, 1e-9, "x clamped");
  ok(f.z >= 0 && f.z < 1, "z within slack of the edge");
  // Targets spread wider than the whole map: capped at the full-map width and centred.
  const wide = frameTargets(
    [
      { x: -500, z: 0 },
      { x: 600, z: 0 },
    ],
    o,
  );
  const full = Math.max(100, 60 * depthToWidth(16 / 9, 55)) * 1.3 + 12;
  near(wide.width, full, 1e-9, "full-map cap");
  eq(wide.x, 50, "centred");
  // No targets: the map centre.
  const none = frameTargets([], o);
  eq(none.x, 50);
});

test("ArenaCamera: snaps first, then eases and keeps points in view", () => {
  const cam = new THREE.PerspectiveCamera(38, 16 / 9, 0.1, 500);
  const ac = new ArenaCamera(cam, { rig, margin: 6, minWidth: 16, rate: 4 });
  ac.update([new THREE.Vector3(0, 0, 0)], 1 / 60);
  near(ac.focus.x, 0, 1e-6);
  eq(ac.width, 16);
  ac.update([new THREE.Vector3(40, 0, 0)], 1 / 60);
  ok(ac.focus.x > 0 && ac.focus.x < 4, "eases, does not jump");
  for (let i = 0; i < 600; i++) ac.update([new THREE.Vector3(40, 0, 0)], 1 / 60);
  near(ac.focus.x, 40, 0.05, "converges");
  const p = new THREE.Vector3(40, 1.5, 0).project(cam);
  ok(Math.abs(p.x) < 0.8 && p.y > -0.66 && p.y < 0.5, "kept inside the safe box");
});

function walk(cam: LockedFollowCam, t: FollowTarget, ticks: number, start: number, vx: number, vy = 0) {
  const xs: number[] = [];
  for (let k = 0; k < ticks; k++) {
    t.vx = vx;
    t.vy = vy;
    t.moving = vx !== 0 || vy !== 0;
    t.x += vx;
    t.y += vy;
    cam.update(start + k, t, null);
    xs.push(cam.ix);
  }
  return xs;
}

test("LockedFollowCam: whole pixels, no back-and-forth, no drift after stopping", () => {
  const cam = new LockedFollowCam(320, 180);
  const t: FollowTarget = { x: 100.3, y: 50, vx: 0, vy: 0, moving: false, speed: 1.3 };
  cam.update(0, t, null);
  eq(cam.ix, Math.round(100.3) - 160);
  const going = walk(cam, t, 120, 1, 1.3);
  for (let i = 1; i < going.length; i++)
    ok(going[i] >= going[i - 1], `camera never steps back while walking (tick ${i})`);
  for (const x of going) ok(Number.isInteger(x));
  // Lean settled: the target sits exactly leanX ahead of centre.
  eq(cam.lean[0], 24);
  eq(Math.round(t.x) + 24 - 160, cam.ix);
  const stop = walk(cam, t, 120, 121, 0);
  for (let i = 1; i < stop.length; i++) ok(stop[i] <= stop[i - 1], `recentres monotonically (tick ${i})`);
  eq(stop[stop.length - 1], Math.round(t.x) - 160, "centred");
  const still = walk(cam, t, 60, 241, 0);
  ok(
    still.every((x) => x === still[0]),
    "no drift once stopped",
  );
});

test("LockedFollowCam: velocity wobble keeps the lean; bounds clamp; key change snaps", () => {
  const cam = new LockedFollowCam(320, 180);
  const t: FollowTarget = { x: 500, y: 300, vx: 0, vy: 0, moving: false, speed: 1 };
  cam.update(0, t, null);
  walk(cam, t, 60, 1, 1);
  const before = cam.lean[1];
  // Small vertical wobble while walking right (a wall slide): no vertical lean.
  for (let k = 0; k < 40; k++) {
    t.vy = k % 2 ? 0.3 : -0.3;
    t.vx = 1;
    t.moving = true;
    t.x += 1;
    cam.update(61 + k, t, null);
  }
  eq(cam.lean[1], before, "vertical lean unchanged by wobble");
  cam.update(200, t, { x0: 0, y0: 0, x1: 400, y1: 400 }, "room");
  eq(cam.ix, 80, "clamped to bounds (x1 - vw)");
  cam.update(201, { ...t, x: 100 }, { x0: 0, y0: 0, x1: 4000, y1: 400 }, "other");
  eq(cam.ix, 0, "snapped on key change and clamped at the left edge");
});
