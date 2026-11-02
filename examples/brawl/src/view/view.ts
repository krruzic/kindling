// The 3D view (@kindling/three): a floating platform in a dusk void, rovers assembled from part GLBs by sockets and
// dyed per player, their turrets animated by the AnimationController, budgeted particles / glow sprites / ground
// decals for every event, an ArenaCamera framing whoever is still on the platform, screen shake, holiday snow and
// string lights, adaptive render scale and render / GPU stats. It READS the World and its events and never writes
// back.
import * as THREE from "three";
import {
  AdaptiveResolution,
  AnimationController,
  ArenaCamera,
  AssetCache,
  DecalLayer,
  GlowSprites,
  Particles,
  RenderStats,
  StringLights,
  applyRenderScale,
  assembleBySockets,
  dyeColor,
  dyeTeam,
  festoon,
  fitByExtra,
  flakeTexture,
  glowTexture,
  mergeStatic,
  mulberry32,
  namedNodes,
  ringTexture,
  scorchTexture,
  snowfall,
  type WeatherPoints,
} from "@kindling/three";
import type { GameEvent, RoverId } from "../sim/types.ts";
import type { World } from "../sim/world.ts";

const PARTS = ["chassis_scout", "chassis_brute", "chassis_spark", "wheel", "turret", "barrel", "bumper", "coil", "fin"];
const partUrl = (n: string) => `${import.meta.env.BASE_URL}parts/${n}.glb`;

interface RoverView {
  seat: number;
  kind: RoverId;
  root: THREE.Group;
  body: THREE.Object3D;
  wheels: THREE.Object3D[];
  anim: AnimationController;
  muzzle: THREE.Object3D;
  lamps: { node: THREE.Object3D; glow: number }[];
  spark: { node: THREE.Object3D; glow: number } | null;
  ring: number;
  color: THREE.Color;
  /** Previous tick position (render interpolation). */
  px: number;
  pz: number;
  heading: number;
  charge: number;
}

export interface ViewOptions {
  /** Fixed render scale (0 = adaptive). */
  scale: () => number;
  shake: () => number;
  holiday: () => string | null;
}

export class View {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(38, 16 / 9, 0.1, 300);
  readonly arenaCam: ArenaCamera;
  readonly stats: RenderStats;
  readonly adaptive = new AdaptiveResolution({ budgetMs: 1000 / 60, levels: [1, 0.85, 0.72, 0.6, 0.5] });
  private cache = new AssetCache({
    prepare: (root) =>
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) m.castShadow = m.receiveShadow = true;
      }),
  });
  private rovers: RoverView[] = [];
  private world: World | null = null;
  private colors: string[] = [];
  readonly particles = new Particles(1800);
  private glows = new GlowSprites(glowTexture(64));
  private rings = new DecalLayer(ringTexture(128), 24, { additive: true });
  private scorch = new DecalLayer(scorchTexture(128, 5), 40);
  private feet = new DecalLayer(ringTexture(64, 0.74, 0.94, 0.05), 8, { additive: true });
  private edge: DecalLayer;
  private edgeId = -1;
  private sparkTex = glowTexture(32);
  private smokeTex = flakeTexture(32);
  private rand = mulberry32(3);
  private time = 0;
  private shakeT = 0;
  private shakeAmp = 0;
  private platform: THREE.Mesh;
  private rimGlows: number[] = [];
  private snow: WeatherPoints | null = null;
  private lights: StringLights | null = null;
  private dressedFor: string | null = "";
  /** Slow orbit for the attract mode (radians / s); 0 in matches. */
  orbit = 0;
  ready = false;
  private o: ViewOptions;
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();

  constructor(parent: HTMLElement, o: ViewOptions) {
    this.o = o;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.className = "view";
    parent.appendChild(this.renderer.domElement);
    this.stats = new RenderStats(this.renderer);
    const sc = this.scene;
    sc.background = new THREE.Color(0x141a2a);
    sc.fog = new THREE.Fog(0x141a2a, 40, 95);
    sc.add(new THREE.HemisphereLight(0xc8d4ff, 0x302418, 1.15));
    const sun = new THREE.DirectionalLight(0xfff0dc, 1.7);
    sun.position.set(-9, 18, 7);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    Object.assign(sun.shadow.camera, { left: -13, right: 13, top: 13, bottom: -13, near: 1, far: 60 });
    sc.add(sun);
    // The platform: a deck with painted rings and a hazard rim, on a rocky underside.
    this.platform = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 64), [
      new THREE.MeshLambertMaterial({ color: 0x3b3f48 }),
      new THREE.MeshLambertMaterial({ map: deckTexture() }),
      new THREE.MeshLambertMaterial({ color: 0x2a2d34 }),
    ]);
    this.platform.receiveShadow = true;
    sc.add(this.platform);
    const under = new THREE.Mesh(
      new THREE.ConeGeometry(1, 1, 24, 1),
      new THREE.MeshLambertMaterial({ color: 0x2a2420 }),
    );
    under.rotation.x = Math.PI;
    under.name = "under";
    this.platform.add(under);
    this.edge = new DecalLayer(ringTexture(256, 0.955, 0.985, 0.012), 2, { additive: true });
    sc.add(
      this.particles.root,
      this.glows.object,
      this.rings.object,
      this.scorch.object,
      this.feet.object,
      this.edge.object,
    );
    this.sizePlatform(10);
    this.dressing(10);
    this.arenaCam = new ArenaCamera(this.camera, {
      rig: { pitchDeg: 56, fovDeg: 38, lookAhead: 0.03 },
      margin: 4.5,
      minWidth: 17,
      maxWidth: 30,
      bounds: { x0: -12, z0: -12, x1: 12, z1: 12 },
      rate: 3,
      safe: [-0.85, 0.85, -0.42, 0.62],
      keepHeight: 0.8,
    });
  }

  async load(): Promise<void> {
    await Promise.all(PARTS.map((p) => this.cache.load(partUrl(p))));
    this.ready = true;
  }

  private node(file: string, name = file): THREE.Object3D {
    const n = namedNodes(this.cache.get(partUrl(file))!.scene).get(name);
    if (!n) throw new Error(`part ${file}: no node ${name}`);
    return n;
  }

  private sizePlatform(r: number): void {
    this.platform.scale.set(r + 0.35, 0.8, r + 0.35);
    this.platform.position.y = -0.4;
    const under = this.platform.getObjectByName("under")!;
    under.scale.set(1, 7, 1);
    under.position.y = -4;
  }

  /** Static dressing round the platform: pylons with lamps, merged into one mesh per material. */
  private dressing(r: number): void {
    const g = new THREE.Group();
    const pylon = new THREE.MeshLambertMaterial({ color: 0x4a4e58 });
    const cap = new THREE.MeshLambertMaterial({ color: 0xd8a040, emissive: 0x6a3a08 });
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      const x = Math.cos(a) * (r + 2.4);
      const z = Math.sin(a) * (r + 2.4);
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.4, 5, 8), pylon);
      p.position.set(x, -1.5, z);
      const c = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.25, 8), cap);
      c.position.set(x, 1.1, z);
      g.add(p, c);
      this.rimGlows.push(
        this.glows.add({
          x,
          y: 1.5,
          z,
          color: 0xffb860,
          size: 2.2,
          intensity: 1,
          pulseRate: 2.2,
          pulseDepth: 0.25,
          phase: i,
        }),
      );
    }
    const merged = mergeStatic(g);
    merged.traverse((o) => ((o as THREE.Mesh).isMesh ? (o.castShadow = true) : null));
    this.scene.add(merged);
  }

  /** Christmas: snow and string lights round the rim, only while the holiday is on (assets made on demand). */
  private holidayDressing(): void {
    const h = this.o.holiday();
    if (h === this.dressedFor) return;
    this.dressedFor = h;
    if (this.snow) this.snow.points.visible = h === "xmas";
    if (this.lights) this.lights.points.visible = h === "xmas";
    if (h === "xmas" && !this.snow) {
      this.snow = snowfall({
        x0: -22,
        z0: -22,
        x1: 22,
        z1: 22,
        base: -6,
        height: 22,
        count: 2400,
        size: 0.3,
        seed: 12,
      });
      this.lights = new StringLights(festoon(0, 0, 1.3, 12.4, 8, 0.6, Math.PI / 8), {
        spacing: 0.5,
        size: 0.8,
        warmShare: 0.35,
      });
      this.scene.add(this.snow.points, this.lights.points);
    }
  }

  /** Builds the rover views for a world (new match, attract world). */
  setWorld(world: World, colors: string[]): void {
    for (const r of this.rovers) this.disposeRover(r);
    this.rovers = [];
    this.world = world;
    this.colors = colors;
    if (!this.ready) return;
    for (const r of world.state.rovers) this.rovers.push(this.makeRover(r.seat, r.kind, colors[r.seat] ?? "#cccccc"));
    this.arenaCam.snap();
    this.scorch.clear();
  }

  get hasWorld(): boolean {
    return !!this.world;
  }

  private makeRover(seat: number, kind: RoverId, color: string): RoverView {
    const body = this.node(`chassis_${kind}`).clone(true);
    const parts = [
      { socket: /^S_wheel_/, part: this.node("wheel"), fit: fitByExtra("r") },
      { socket: "S_turret", part: this.node("turret") },
      { socket: "S_barrel", part: this.node("barrel") },
      { socket: "S_front", part: this.node("bumper") },
      { socket: "S_top", part: this.node("coil") },
      { socket: "S_tail", part: this.node("fin") },
    ];
    const a = assembleBySockets(body, parts);
    const root = new THREE.Group();
    root.add(body);
    const c = new THREE.Color(color);
    dyeTeam(root, c, { adjust: (x) => dyeColor(x, 0.95, 1) });
    const turret = a.attached.get("S_turret")![0];
    const anim = new AnimationController(turret, this.cache.clips(partUrl("turret")), {
      oneShot: ["fire"],
      returnTo: "idle",
      fade: 0.08,
    });
    anim.play("idle", { timeScale: 0.6 + seat * 0.13 });
    const lamps = ["S_lamp_L", "S_lamp_R"].map((n) => {
      const s = a.sockets.get(n)!;
      return {
        node: s,
        glow: this.glows.add({ x: 0, y: -50, z: 0, color: String(s.userData.color ?? "#ffd890"), size: 0.9 }),
      };
    });
    const coil = a.attached.get("S_top")?.[0];
    const sparkNode = coil ? namedNodes(coil).get("S_spark") : undefined;
    const spark = sparkNode
      ? {
          node: sparkNode,
          glow: this.glows.add({ x: 0, y: -50, z: 0, color: 0x9affd0, size: 1.2, pulseRate: 9, pulseDepth: 0.5 }),
        }
      : null;
    const muzzle = namedNodes(a.attached.get("S_barrel")![0]).get("muzzle")!;
    this.scene.add(root);
    return {
      seat,
      kind,
      root,
      body,
      wheels: [...a.attached].filter(([k]) => k.startsWith("S_wheel_")).flatMap(([, v]) => v),
      anim,
      muzzle,
      lamps,
      spark,
      ring: this.feet.pin({ x: 0, z: 0, size: 2.3, color: c, opacity: 0.85 }),
      color: c,
      px: 0,
      pz: 0,
      heading: 0,
      charge: 0,
    };
  }

  private disposeRover(r: RoverView): void {
    this.scene.remove(r.root);
    r.anim.dispose();
    this.feet.unpin(r.ring);
    for (const l of r.lamps) this.glows.remove(l.glow);
    if (r.spark) this.glows.remove(r.spark.glow);
  }

  /** Call before each sim step: remembers positions for interpolation. */
  beforeStep(): void {
    const w = this.world;
    if (!w) return;
    for (const r of this.rovers) {
      const s = w.state.rovers[r.seat];
      r.px = s.x;
      r.pz = s.z;
    }
  }

  /** Presentation for one tick's events. */
  events(evs: readonly GameEvent[]): void {
    for (const e of evs) this.event(e);
  }

  private event(e: GameEvent): void {
    const R = this.rovers;
    const col = (seat: number) => R[seat]?.color ?? new THREE.Color(0xffffff);
    switch (e.type) {
      case "attack": {
        const r = R[e.seat];
        r?.anim.play("fire", { restart: true });
        if (r) {
          r.muzzle.getWorldPosition(this.tmp);
          this.particles.emit(
            {
              tex: this.sparkTex,
              n: 26,
              x: this.tmp.x,
              y: this.tmp.y,
              z: this.tmp.z,
              color: 0xffc070,
              additive: true,
              size: [0.12, 0.3],
              life: [0.18, 0.4],
              speed: [4, 9],
              dir: { x: e.fx, y: 0.1, z: e.fz },
              cone: 0.5,
              drag: 3,
              stretch: 1.6,
            },
            this.rand,
          );
          this.rings.spawn({
            x: e.x + e.fx * 1.4,
            z: e.z + e.fz * 1.4,
            size: 1.2,
            grow: 2.2,
            life: 0.3,
            color: 0xffb060,
            opacity: 0.8,
          });
        }
        break;
      }
      case "dash":
        this.particles.emit(
          {
            tex: this.smokeTex,
            n: 14,
            x: e.x,
            y: 0.15,
            z: e.z,
            color: 0xb8b0a0,
            opacity: 0.55,
            size: [0.3, 0.6],
            grow: 2.5,
            life: [0.4, 0.8],
            speed: [0.5, 2],
            cone: 3.1,
            up: [0.2, 0.6],
            drag: 2,
          },
          this.rand,
        );
        break;
      case "slamCharge":
        this.rings.spawn({ x: e.x, z: e.z, size: 3.2, grow: 0.3, life: 0.35, color: col(e.seat), opacity: 0.9 });
        break;
      case "slam":
        this.rings.spawn({ x: e.x, z: e.z, size: 1, grow: e.r * 2, life: 0.5, color: 0xfff0c0 });
        this.rings.spawn({ x: e.x, z: e.z, size: 0.6, grow: e.r * 1.4, life: 0.7, color: col(e.seat), opacity: 0.9 });
        this.scorch.spawn({
          x: e.x,
          z: e.z,
          size: e.r * 0.9,
          life: 9,
          color: 0x120c08,
          opacity: 0.7,
          rot: this.rand() * 6.28,
          fadeOut: 0.3,
        });
        this.particles.emit(
          {
            tex: this.smokeTex,
            n: 30,
            x: e.x,
            y: 0.2,
            z: e.z,
            color: 0x9a948a,
            opacity: 0.6,
            size: [0.4, 0.8],
            grow: 2,
            life: [0.6, 1.2],
            speed: [3, 7],
            cone: 3.1,
            up: [0.1, 0.4],
            drag: 2.5,
          },
          this.rand,
        );
        this.particles.emit(
          {
            tex: this.sparkTex,
            n: 30,
            x: e.x,
            y: 0.3,
            z: e.z,
            color: col(e.seat),
            additive: true,
            size: [0.12, 0.28],
            life: [0.3, 0.7],
            speed: [4, 9],
            cone: 3.1,
            up: [0.4, 1],
            gravity: 12,
            floor: 0.05,
          },
          this.rand,
        );
        this.shake(0.5);
        break;
      case "hit": {
        const big = e.power > 12;
        this.particles.emit(
          {
            tex: this.sparkTex,
            n: big ? 40 : 22,
            x: e.x,
            y: 0.6,
            z: e.z,
            color: 0xfff0b0,
            additive: true,
            size: [0.1, 0.26],
            life: [0.2, 0.5],
            speed: [3, big ? 11 : 7],
            cone: 3.1,
            up: [0.2, 0.9],
            gravity: 10,
            floor: 0.05,
            stretch: 1.4,
          },
          this.rand,
        );
        this.rings.spawn({ x: e.x, z: e.z, size: 0.8, grow: 3, life: 0.35, color: col(e.by), opacity: 0.9 });
        this.shake(Math.min(0.6, e.power * 0.025));
        break;
      }
      case "bump":
        this.particles.emit(
          {
            tex: this.sparkTex,
            n: 8,
            x: e.x,
            y: 0.5,
            z: e.z,
            color: 0xffe0a0,
            additive: true,
            size: [0.08, 0.18],
            life: [0.15, 0.3],
            speed: [2, 5],
            cone: 3.1,
            gravity: 8,
          },
          this.rand,
        );
        break;
      case "fall": {
        this.particles.emit(
          {
            tex: this.sparkTex,
            n: 40,
            x: e.x,
            y: 0.2,
            z: e.z,
            color: col(e.seat),
            additive: true,
            size: [0.15, 0.35],
            life: [0.5, 1.1],
            speed: [2, 6],
            cone: 3.1,
            up: [0.6, 1],
            gravity: 4,
          },
          this.rand,
        );
        this.shake(0.7);
        break;
      }
      case "fight":
        this.scorch.clear();
        break;
      default:
        break;
    }
  }

  shake(amount: number): void {
    const k = [0, 0.4, 1][this.o.shake()] ?? 1;
    this.shakeAmp = Math.max(this.shakeAmp, amount * k);
    this.shakeT = 0.3;
  }

  /** Draws a frame. `alpha` interpolates between the last two ticks. */
  render(dt: number, alpha: number, sizeW: number, sizeH: number): void {
    this.time += dt;
    const fixed = this.o.scale();
    applyRenderScale(this.renderer, fixed ? fixed / 100 : this.adaptive.scale, sizeW, sizeH, devicePixelRatio);
    if (this.camera.aspect !== sizeW / sizeH) {
      this.camera.aspect = sizeW / sizeH;
      this.camera.updateProjectionMatrix();
    }
    this.holidayDressing();
    const w = this.world;
    const ring = w ? w.state.match.ringR : 10;
    if (this.edgeId < 0)
      this.edgeId = this.edge.pin({ x: 0, z: 0, y: 0.03, size: ring * 2, color: 0xffd060, opacity: 0.9 });
    this.edge.move(this.edgeId, { size: ring * 2.02, color: w && ring < w.t.match.arenaRadius ? 0xff5040 : 0xffc860 });
    const focus: THREE.Vector3[] = [];
    if (w) {
      const tick = w.tick;
      for (const r of this.rovers) {
        const s = w.state.rovers[r.seat];
        const x = r.px + (s.x - r.px) * alpha;
        const z = r.pz + (s.z - r.pz) * alpha;
        r.root.position.set(x, 0, z);
        const want = Math.atan2(s.fx, s.fz);
        let d = want - r.heading;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        r.heading += d * Math.min(1, dt * 18);
        r.root.rotation.set(0, r.heading, 0);
        if (!s.alive && s.fellAt >= 0) {
          const t = (tick - s.fellAt) / 60;
          r.root.position.y = -t * t * 9;
          r.root.rotation.x = t * 3;
          r.root.rotation.z = t * 2;
        } else if (s.stun > 0) r.body.rotation.z = Math.sin(this.time * 40) * 0.08;
        else r.body.rotation.z = 0;
        const charging = s.slamAt >= 0;
        r.charge += ((charging ? 1 : 0) - r.charge) * Math.min(1, dt * 12);
        r.body.position.y = r.charge * 0.35;
        const speed = Math.hypot(s.vx, s.vz);
        for (const wh of r.wheels) wh.rotation.x += dt * speed * 4;
        r.anim.update(dt);
        this.feet.move(r.ring, { x, z, opacity: s.alive ? 0.85 : 0, size: 2.3 + r.charge * 0.8 });
        if (s.alive) focus.push(r.root.position);
        if (s.dashT > 0 && this.rand() < 0.6)
          this.particles.emit(
            {
              tex: this.sparkTex,
              n: 2,
              x,
              y: 0.3,
              z,
              color: r.color,
              additive: true,
              size: [0.15, 0.3],
              life: [0.2, 0.35],
              speed: [0, 0.5],
            },
            this.rand,
          );
      }
    }
    this.scene.updateMatrixWorld();
    for (const r of this.rovers) {
      for (const l of r.lamps) {
        l.node.getWorldPosition(this.tmp);
        this.glows.set(l.glow, { x: this.tmp.x, y: this.tmp.y, z: this.tmp.z });
      }
      if (r.spark) {
        r.spark.node.getWorldPosition(this.tmp);
        this.glows.set(r.spark.glow, { x: this.tmp.x, y: this.tmp.y, z: this.tmp.z, intensity: 0.8 + r.charge * 1.5 });
      }
    }
    this.particles.update(dt);
    this.rings.update(dt);
    this.scorch.update(dt);
    this.feet.update(dt);
    this.edge.update(dt);
    this.glows.update(this.time);
    this.snow?.update(this.time);
    this.lights?.update(this.time);
    if (!focus.length) focus.push(this.tmp2.set(0, 0, 0));
    if (this.orbit) {
      this.arenaCam.yaw += this.orbit * dt;
      this.arenaCam.update([new THREE.Vector3(-8, 0, -8), new THREE.Vector3(8, 0, 8)], dt, []);
    } else {
      this.arenaCam.yaw *= Math.max(0, 1 - dt * 3);
      this.arenaCam.update(focus, dt);
    }
    if (this.shakeT > 0) {
      this.shakeT -= dt;
      const a = this.shakeAmp * Math.max(0, this.shakeT / 0.3);
      this.camera.position.x += (this.rand() - 0.5) * a;
      this.camera.position.y += (this.rand() - 0.5) * a;
      if (this.shakeT <= 0) this.shakeAmp = 0;
    }
    this.stats.gpu.begin("scene");
    this.renderer.render(this.scene, this.camera);
    this.stats.gpu.end();
  }

  /** Feed the frame time to the adaptive scale (true when it changed). */
  adapt(frameMs: number): boolean {
    return !this.o.scale() && this.adaptive.frame(frameMs);
  }

  /** Projects a world point to CSS pixels (HUD labels over rovers). */
  project(x: number, y: number, z: number, w: number, h: number): { x: number; y: number; visible: boolean } {
    const p = this.tmp.set(x, y, z).project(this.camera);
    return {
      x: ((p.x + 1) / 2) * w,
      y: ((1 - p.y) / 2) * h,
      visible: p.z < 1 && Math.abs(p.x) < 1.1 && Math.abs(p.y) < 1.1,
    };
  }

  get particleCount(): number {
    return this.particles.live;
  }
}

/** The deck: concentric rings, spokes and a hazard-striped rim, painted once into a canvas texture. */
function deckTexture(): THREE.Texture {
  const S = 1024;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d")!;
  const cx = S / 2;
  const grad = g.createRadialGradient(cx, cx, 0, cx, cx, cx);
  grad.addColorStop(0, "#5c6270");
  grad.addColorStop(0.85, "#4a4f5a");
  grad.addColorStop(1, "#3a3e47");
  g.fillStyle = grad;
  g.fillRect(0, 0, S, S);
  const rnd = mulberry32(9);
  for (let i = 0; i < 2200; i++) {
    g.fillStyle = `rgba(${rnd() < 0.5 ? "0,0,0" : "255,255,255"},${0.03 + rnd() * 0.05})`;
    g.fillRect(rnd() * S, rnd() * S, 2 + rnd() * 6, 2 + rnd() * 6);
  }
  g.strokeStyle = "rgba(255,255,255,0.12)";
  g.lineWidth = 4;
  for (const k of [0.18, 0.42, 0.66]) {
    g.beginPath();
    g.arc(cx, cx, cx * k, 0, Math.PI * 2);
    g.stroke();
  }
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    g.beginPath();
    g.moveTo(cx + Math.cos(a) * cx * 0.18, cx + Math.sin(a) * cx * 0.18);
    g.lineTo(cx + Math.cos(a) * cx * 0.86, cx + Math.sin(a) * cx * 0.86);
    g.stroke();
  }
  // hazard rim
  const r0 = cx * 0.9;
  const r1 = cx * 0.985;
  for (let i = 0; i < 64; i++) {
    const a0 = (i / 64) * Math.PI * 2;
    const a1 = ((i + 1) / 64) * Math.PI * 2;
    g.fillStyle = i % 2 ? "#e8b020" : "#1c1c20";
    g.beginPath();
    g.arc(cx, cx, r1, a0, a1);
    g.arc(cx, cx, r0, a1, a0, true);
    g.closePath();
    g.fill();
  }
  g.strokeStyle = "rgba(255,200,80,0.35)";
  g.lineWidth = 10;
  g.beginPath();
  g.arc(cx, cx, cx * 0.1, 0, Math.PI * 2);
  g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
