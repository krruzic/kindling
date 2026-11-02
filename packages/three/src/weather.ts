// Weather points (from Grudge's Christmas snowfall): thousands of flakes in one THREE.Points draw with zero CPU work
// per frame. Each point falls at its own pace and sways on a slow drift, wrapping round a column of air in the
// vertex shader; only a time uniform changes. Presets for snow, rain and rising embers; positions come from a
// seeded RNG so screenshots are reproducible.
import * as THREE from "three";
import { flakeTexture } from "./textures.ts";

export interface WeatherOptions {
  /** Ground-plane area covered. */
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  /** Bottom of the column (points wrap from base + height back to base). */
  base?: number;
  height?: number;
  count?: number;
  /** World size of a point (perspective-attenuated). */
  size?: number;
  /** Fall speed (units/s); negative rises (embers). Each point gets 1x..1+fallJitter x. */
  fall?: number;
  fallJitter?: number;
  /** Horizontal sway amplitude (units). */
  sway?: number;
  /** Size varies 0.55x..(0.55 + sizeJitter)x. */
  sizeJitter?: number;
  color?: THREE.ColorRepresentation;
  opacity?: number;
  additive?: boolean;
  texture?: THREE.Texture;
  seed?: number;
}

export const WEATHER_PRESETS = {
  snow: {
    count: 3200,
    size: 0.5,
    fall: 0.9,
    fallJitter: 0.8,
    sway: 0.8,
    sizeJitter: 0.9,
    color: 0xffffff,
    opacity: 0.95,
  },
  rain: {
    count: 4000,
    size: 0.12,
    fall: 14,
    fallJitter: 0.3,
    sway: 0.05,
    sizeJitter: 0.3,
    color: 0xa8c0e0,
    opacity: 0.6,
  },
  embers: {
    count: 600,
    size: 0.22,
    fall: -0.8,
    fallJitter: 0.9,
    sway: 0.6,
    sizeJitter: 0.8,
    color: 0xff8a30,
    opacity: 1,
    additive: true,
  },
} satisfies Record<string, Partial<WeatherOptions>>;

/** mulberry32: a tiny seeded RNG for presentation-side scatter. */
export function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class WeatherPoints {
  readonly points: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  private time = { value: 0 };

  constructor(o: WeatherOptions) {
    const H = o.height ?? 16;
    const count = o.count ?? 3200;
    const rand = mulberry32(o.seed ?? 1);
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = o.x0 + rand() * (o.x1 - o.x0);
      pos[i * 3 + 1] = rand() * H;
      pos[i * 3 + 2] = o.z0 + rand() * (o.z1 - o.z0);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.boundingSphere = new THREE.Sphere(
      new THREE.Vector3((o.x0 + o.x1) / 2, (o.base ?? 0) + H / 2, (o.z0 + o.z1) / 2),
      Math.hypot(o.x1 - o.x0, H, o.z1 - o.z0) / 2,
    );
    const mat = new THREE.PointsMaterial({
      map: o.texture ?? flakeTexture(),
      size: o.size ?? 0.5,
      color: o.color ?? 0xffffff,
      transparent: true,
      opacity: o.opacity ?? 0.95,
      depthWrite: false,
      blending: o.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    const f = (v: number) => v.toFixed(4);
    const base = o.base ?? 0;
    const fall = o.fall ?? 0.9;
    const fj = o.fallJitter ?? 0.8;
    const sway = o.sway ?? 0.8;
    const sj = o.sizeJitter ?? 0.9;
    const time = this.time;
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = time;
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nuniform float uTime;")
        .replace(
          "#include <begin_vertex>",
          `#include <begin_vertex>
          float seed = fract(position.x * 0.137 + position.z * 0.711);
          transformed.y = ${f(base)} + mod(position.y - uTime * ${f(fall)} * (1.0 + seed * ${f(fj)}), ${f(H)});
          transformed.x += sin(uTime * (0.4 + seed * 0.5) + seed * 40.0) * ${f(sway)};
          transformed.z += cos(uTime * 0.3 + seed * 23.0) * ${f(sway * 0.6)};`,
        )
        .replace(
          "#include <worldpos_vertex>",
          `gl_PointSize *= 0.55 + seed * seed * ${f(sj)};\n#include <worldpos_vertex>`,
        );
    };
    mat.customProgramCacheKey = () => `kweather|${f(base)}|${f(fall)}|${f(fj)}|${f(sway)}|${f(sj)}|${f(H)}`;
    this.points = new THREE.Points(g, mat);
    this.points.frustumCulled = false;
  }

  /** Seconds since start (any monotonic clock). */
  update(time: number): void {
    this.time.value = time;
  }

  dispose(): void {
    this.points.geometry.dispose();
    this.points.material.dispose();
  }
}

/** Snowfall over an area with the snow preset (override anything). */
export const snowfall = (area: WeatherOptions) => new WeatherPoints({ ...WEATHER_PRESETS.snow, ...area });
