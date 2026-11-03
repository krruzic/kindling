// Budgeted instanced billboard particles (from Grudge's fx/particles.ts). Particles are grouped into slots by
// (texture, additive, depth test, draw order); slots with the same order share "lanes" of instanced quad batches
// whose shader samples up to MAPS textures, so a busy fight stays at a handful of draw calls. `budget` caps live
// particles: spawn() returns null once it's reached (bursts degrade, the frame doesn't). emit() is the usual way in:
// a burst of n particles with ranges for speed, size and life, a direction cone, gravity, drag and a floor.
import * as THREE from "three";

export interface Particle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  sx: number;
  sy: number;
  rot: number;
  spin: number;
  r: number;
  g: number;
  b: number;
  a: number;
  age: number;
  life: number;
  size0: number;
  grow: number;
  op: number;
  fadeIn: number;
  gravity: number;
  drag: number;
  floor: number;
  stretch: number;
  /** Rotate to the screen-space direction of travel each update (needs a camera in update()). */
  align: boolean;
}

/** Textures one batch can sample (WebGL2 guarantees 16 fragment samplers). */
const MAPS = 12;

const VERT = `
attribute vec3 iPos;
attribute vec4 iSize;
attribute vec4 iColor;
varying vec2 vUv;
varying vec4 vColor;
flat varying float vTex;
#include <common>
#include <fog_pars_vertex>
void main() {
  vUv = uv;
  vColor = iColor;
  vTex = iSize.w;
  vec4 mvPosition = modelViewMatrix * vec4(iPos, 1.0);
  float c = cos(iSize.z);
  float s = sin(iSize.z);
  vec2 p = position.xy * iSize.xy;
  mvPosition.xy += vec2(c * p.x - s * p.y, s * p.x + c * p.y);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const FRAG = `
${Array.from({ length: MAPS }, (_, i) => `uniform sampler2D map${i};`).join("\n")}
varying vec2 vUv;
varying vec4 vColor;
flat varying float vTex;
#include <common>
#include <fog_pars_fragment>
void main() {
  vec4 t;
  ${Array.from({ length: MAPS }, (_, i) => (i < MAPS - 1 ? `if (vTex < ${i}.5) t = texture2D(map${i}, vUv);` : `t = texture2D(map${i}, vUv);`)).join("\n  else ")}
  gl_FragColor = vec4(t.rgb * vColor.rgb, t.a * vColor.a);
  if (gl_FragColor.a < 0.004) discard;
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

interface Slot {
  tex: THREE.Texture;
  additive: boolean;
  depthTest: boolean;
  list: Particle[];
}

interface Lane {
  order: number;
  slots: Slot[];
  pool: Batch[];
}

class Batch {
  readonly mesh: THREE.Mesh;
  private geo: THREE.InstancedBufferGeometry;
  private mat: THREE.ShaderMaterial;
  private pos: Float32Array;
  private size: Float32Array;
  private col: Float32Array;
  private cap: number;
  private n = 0;
  texCount = 0;

  constructor(order: number) {
    this.cap = 256;
    this.geo = new THREE.InstancedBufferGeometry();
    const base = new THREE.PlaneGeometry(1, 1);
    this.geo.index = base.index;
    this.geo.setAttribute("position", base.getAttribute("position"));
    this.geo.setAttribute("uv", base.getAttribute("uv"));
    this.pos = new Float32Array(this.cap * 3);
    this.size = new Float32Array(this.cap * 4);
    this.col = new Float32Array(this.cap * 4);
    this.bind();
    const maps: Record<string, THREE.IUniform> = {};
    for (let i = 0; i < MAPS; i++) maps[`map${i}`] = { value: null };
    this.mat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, maps]),
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      fog: true,
      blending: THREE.NormalBlending,
    });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = order;
    this.mesh.visible = false;
  }

  private bind(): void {
    this.geo.setAttribute("iPos", new THREE.InstancedBufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute("iSize", new THREE.InstancedBufferAttribute(this.size, 4).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute("iColor", new THREE.InstancedBufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
  }

  begin(additive: boolean, depthTest: boolean): void {
    const blending = additive ? THREE.AdditiveBlending : THREE.NormalBlending;
    if (this.mat.blending !== blending) this.mat.blending = blending;
    if (this.mat.depthTest !== depthTest) this.mat.depthTest = depthTest;
    this.n = 0;
    this.texCount = 0;
  }

  add(tex: THREE.Texture, list: Particle[]): void {
    const t = this.texCount++;
    this.mat.uniforms[`map${t}`].value = tex;
    const need = this.n + list.length;
    if (need > this.cap) {
      while (this.cap < need) this.cap *= 2;
      const pos = new Float32Array(this.cap * 3);
      const size = new Float32Array(this.cap * 4);
      const col = new Float32Array(this.cap * 4);
      pos.set(this.pos.subarray(0, this.n * 3));
      size.set(this.size.subarray(0, this.n * 4));
      col.set(this.col.subarray(0, this.n * 4));
      this.pos = pos;
      this.size = size;
      this.col = col;
      this.bind();
    }
    let i = this.n;
    for (const p of list) {
      this.pos[i * 3] = p.x;
      this.pos[i * 3 + 1] = p.y;
      this.pos[i * 3 + 2] = p.z;
      this.size[i * 4] = p.sx;
      this.size[i * 4 + 1] = p.sy;
      this.size[i * 4 + 2] = p.rot;
      this.size[i * 4 + 3] = t;
      this.col[i * 4] = p.r;
      this.col[i * 4 + 1] = p.g;
      this.col[i * 4 + 2] = p.b;
      this.col[i * 4 + 3] = p.a;
      i++;
    }
    this.n = i;
  }

  end(): void {
    const n = this.n;
    const first = this.mat.uniforms.map0.value;
    for (let t = this.texCount; t < MAPS; t++) this.mat.uniforms[`map${t}`].value = first;
    this.geo.instanceCount = n;
    this.mesh.visible = n > 0;
    if (n === 0) return;
    for (const [name, size] of [
      ["iPos", 3],
      ["iSize", 4],
      ["iColor", 4],
    ] as const) {
      const a = this.geo.getAttribute(name) as THREE.InstancedBufferAttribute;
      a.clearUpdateRanges();
      a.addUpdateRange(0, n * size);
      a.needsUpdate = true;
    }
  }

  hide(): void {
    this.geo.instanceCount = 0;
    this.mesh.visible = false;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.geo.dispose();
    this.mat.dispose();
  }
}

const tmp = new THREE.Color();

export class Particles {
  readonly root = new THREE.Group();
  /** Bursts scale their counts by this (reduced-effects option, adaptive quality). */
  density = 1;
  private slots = new Map<string, Slot>();
  private lanes = new Map<number, Lane>();
  private ids = new WeakMap<THREE.Texture, number>();
  private nextId = 1;
  budget: number;
  private count = 0;

  constructor(budget = 2500) {
    this.budget = budget;
  }

  private slot(tex: THREE.Texture, additive: boolean, depthTest: boolean, order: number): Slot {
    let id = this.ids.get(tex);
    if (!id) {
      id = this.nextId++;
      this.ids.set(tex, id);
    }
    const key = `${id}|${additive ? 1 : 0}|${depthTest ? 1 : 0}|${order}`;
    let s = this.slots.get(key);
    if (!s) {
      s = { tex, additive, depthTest, list: [] };
      this.slots.set(key, s);
      let lane = this.lanes.get(order);
      if (!lane) {
        lane = { order, slots: [], pool: [] };
        this.lanes.set(order, lane);
      }
      lane.slots.push(s);
    }
    return s;
  }

  spawn(
    tex: THREE.Texture,
    color: THREE.ColorRepresentation,
    additive: boolean,
    depthTest = true,
    order = 0,
  ): Particle | null {
    if (this.count >= this.budget) return null;
    tmp.set(color);
    const p: Particle = {
      x: 0,
      y: 0,
      z: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      sx: 1,
      sy: 1,
      rot: 0,
      spin: 0,
      r: tmp.r,
      g: tmp.g,
      b: tmp.b,
      a: 1,
      age: 0,
      life: 1,
      size0: 1,
      grow: 1,
      op: 1,
      fadeIn: 0,
      gravity: 0,
      drag: 0,
      floor: -1e9,
      stretch: 1,
      align: false,
    };
    this.slot(tex, additive, depthTest, order).list.push(p);
    this.count++;
    return p;
  }

  /**
   * Advance every particle. With a camera, `align` particles turn to their screen-space direction of travel
   * (velocity-aligned streaks: sparks, speed lines).
   */
  update(dt: number, camera?: THREE.Camera): void {
    dt = Math.max(0, dt);
    let total = 0;
    const view = camera ? camera.matrixWorldInverse.elements : null;
    for (const b of this.slots.values()) {
      if (b.list.length === 0) continue;
      const out: Particle[] = [];
      for (const p of b.list) {
        p.age += dt;
        const k = p.age / p.life;
        if (k >= 1) continue;
        p.vy -= p.gravity * dt;
        if (p.drag) {
          const d = Math.max(0, 1 - p.drag * dt);
          p.vx *= d;
          p.vy *= d;
          p.vz *= d;
        }
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.z += p.vz * dt;
        if (p.y < p.floor) {
          p.y = p.floor;
          p.vx *= 0.5;
          p.vz *= 0.5;
          p.vy = Math.abs(p.vy) * 0.25;
        }
        if (p.align && view) {
          const vx = view[0] * p.vx + view[4] * p.vy + view[8] * p.vz;
          const vy = view[1] * p.vx + view[5] * p.vy + view[9] * p.vz;
          if (vx * vx + vy * vy > 1e-6) p.rot = Math.atan2(vy, vx);
        } else p.rot += p.spin * dt;
        const s = p.size0 * (1 + (p.grow - 1) * (1 - (1 - k) * (1 - k)));
        p.sx = s * p.stretch;
        p.sy = s;
        const fin = p.fadeIn > 0 && k < p.fadeIn ? k / p.fadeIn : 1;
        p.a = p.op * fin * (k < 0.55 ? 1 : 1 - (k - 0.55) / 0.45);
        out.push(p);
      }
      b.list = out;
      total += out.length;
    }
    this.count = total;
    for (const lane of this.lanes.values()) this.build(lane);
  }

  private build(lane: Lane): void {
    let used = this.fill(lane, 0, false, true);
    used = this.fill(lane, used, false, false);
    used = this.fill(lane, used, true, true);
    used = this.fill(lane, used, true, false);
    for (let k = used; k < lane.pool.length; k++) lane.pool[k].hide();
  }

  private fill(lane: Lane, used: number, additive: boolean, depthTest: boolean): number {
    let b: Batch | null = null;
    for (const s of lane.slots) {
      if (s.list.length === 0 || s.additive !== additive || s.depthTest !== depthTest) continue;
      if (b && b.texCount >= MAPS) {
        b.end();
        b = null;
      }
      if (!b) {
        if (used === lane.pool.length) {
          const nb = new Batch(lane.order);
          lane.pool.push(nb);
          this.root.add(nb.mesh);
        }
        b = lane.pool[used++];
        b.begin(additive, depthTest);
      }
      b.add(s.tex, s.list);
    }
    if (b) b.end();
    return used;
  }

  get live(): number {
    return this.count;
  }

  /** Draw calls the particles currently take. */
  get batches(): number {
    let n = 0;
    for (const lane of this.lanes.values()) for (const b of lane.pool) if (b.mesh.visible) n++;
    return n;
  }

  /** Spawns a burst; returns how many particles were actually spawned (fewer at the budget). */
  emit(o: EmitOptions, rand: () => number = Math.random): number {
    const r = (v: Range) => (typeof v === "number" ? v : v[0] + rand() * (v[1] - v[0]));
    const n = Math.max(o.n > 0 ? 1 : 0, Math.round(o.n * this.density));
    const dir = o.dir ? new THREE.Vector3(o.dir.x, o.dir.y, o.dir.z).normalize() : null;
    const v = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      const p = this.spawn(o.tex, o.color ?? 0xffffff, !!o.additive, o.depthTest ?? true, o.order ?? 0);
      if (!p) return i;
      const j = o.jitter ?? 0;
      p.x = o.x + (rand() - 0.5) * j;
      p.y = o.y + (rand() - 0.5) * j * 0.5;
      p.z = o.z + (rand() - 0.5) * j;
      randomDir(v, dir, o.cone ?? Math.PI, !!o.flat, rand).multiplyScalar(r(o.speed));
      if (o.up !== undefined) v.y += r(o.up);
      p.vx = v.x;
      p.vy = v.y;
      p.vz = v.z;
      p.size0 = r(o.size);
      p.grow = o.grow ?? 1;
      p.spin = (rand() - 0.5) * 2 * (o.spin ?? 0);
      p.rot = rand() * Math.PI * 2;
      p.op = o.opacity ?? 1;
      p.gravity = o.gravity ?? 0;
      p.drag = o.drag ?? 0;
      p.fadeIn = o.fadeIn ?? 0;
      p.life = Math.max(1e-3, r(o.life));
      p.stretch = o.stretch ?? 1;
      p.align = !!o.align;
      if (o.floor !== undefined) p.floor = o.floor;
      p.sx = p.size0 * p.stretch;
      p.sy = p.size0;
      p.a = p.fadeIn > 0 ? 0 : p.op;
    }
    return n;
  }

  dispose(): void {
    for (const lane of this.lanes.values()) for (const b of lane.pool) b.dispose();
    this.lanes.clear();
    this.slots.clear();
    this.count = 0;
  }
}

/** A fixed value or a [min, max] range. */
export type Range = number | readonly [number, number];

export interface EmitOptions {
  tex: THREE.Texture;
  n: number;
  x: number;
  y: number;
  z: number;
  color?: THREE.ColorRepresentation;
  additive?: boolean;
  opacity?: number;
  size: Range;
  /** Size multiplier at end of life (eased out). */
  grow?: number;
  life: Range;
  speed: Range;
  /** Cone axis; omit for a sphere. */
  dir?: { x: number; y: number; z: number };
  /** Cone half-angle in radians (default PI: any direction). */
  cone?: number;
  /** Spread in the ground plane only (rings of dust). */
  flat?: boolean;
  /** Extra upward speed. */
  up?: Range;
  gravity?: number;
  drag?: number;
  /** Max spin (rad/s), random sign. */
  spin?: number;
  /** Particles bounce off this height. */
  floor?: number;
  /** Spawn position jitter (box size). */
  jitter?: number;
  fadeIn?: number;
  depthTest?: boolean;
  order?: number;
  /** Width / height ratio (streaks). */
  stretch?: number;
  /** Long axis follows the screen-space velocity (pass the camera to update()). */
  align?: boolean;
}

const UP = new THREE.Vector3(0, 1, 0);
const q = new THREE.Quaternion();

function randomDir(out: THREE.Vector3, dir: THREE.Vector3 | null, cone: number, flat: boolean, rand: () => number) {
  if (flat) {
    const a = rand() * Math.PI * 2;
    return out.set(Math.cos(a), 0, Math.sin(a));
  }
  if (!dir || cone >= Math.PI) {
    const u = rand() * 2 - 1;
    const a = rand() * Math.PI * 2;
    const s = Math.sqrt(1 - u * u);
    return out.set(s * Math.cos(a), u, s * Math.sin(a));
  }
  const cosMax = Math.cos(cone);
  const cz = cosMax + rand() * (1 - cosMax);
  const sz = Math.sqrt(1 - cz * cz);
  const a = rand() * Math.PI * 2;
  return out.set(sz * Math.cos(a), cz, sz * Math.sin(a)).applyQuaternion(q.setFromUnitVectors(UP, dir));
}
