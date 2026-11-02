// One instanced quad batch: a single draw for any number of textured quads, each with its own position, size,
// rotation and RGBA colour. "billboard" quads face the camera (glow sprites, fake lights); "ground" quads lie flat
// in the XZ plane (decals, rings, scorch marks). The texture's alpha shapes them, the instance colour tints them;
// additive blending makes them glow. Capacity grows by doubling.
import * as THREE from "three";

export type QuadMode = "billboard" | "ground";

export interface QuadBatchOptions {
  mode?: QuadMode;
  additive?: boolean;
  /** Depth test against the scene (default true); quads never write depth. */
  depthTest?: boolean;
  fog?: boolean;
  renderOrder?: number;
  capacity?: number;
}

const VERT = (mode: QuadMode) => `
attribute vec3 iPos;
attribute vec4 iSize;
attribute vec4 iColor;
varying vec2 vUv;
varying vec4 vColor;
#include <common>
#include <fog_pars_vertex>
void main() {
  vUv = uv;
  vColor = iColor;
  float c = cos(iSize.z);
  float s = sin(iSize.z);
  vec2 p = position.xy * iSize.xy;
  p = vec2(c * p.x - s * p.y, s * p.x + c * p.y);
  ${
    mode === "billboard"
      ? `vec4 mvPosition = modelViewMatrix * vec4(iPos, 1.0);
  mvPosition.xy += p;`
      : `vec4 mvPosition = modelViewMatrix * vec4(iPos + vec3(p.x, 0.0, -p.y), 1.0);`
  }
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const FRAG = `
uniform sampler2D map;
varying vec2 vUv;
varying vec4 vColor;
#include <common>
#include <fog_pars_fragment>
void main() {
  vec4 t = texture2D(map, vUv);
  gl_FragColor = vec4(t.rgb * vColor.rgb, t.a * vColor.a);
  if (gl_FragColor.a < 0.004) discard;
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

export class QuadBatch {
  readonly mesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
  private geo = new THREE.InstancedBufferGeometry();
  private pos!: Float32Array;
  private size!: Float32Array;
  private col!: Float32Array;
  private cap: number;
  /** Instances drawn (the first `count` slots). */
  count = 0;

  constructor(tex: THREE.Texture, o: QuadBatchOptions = {}) {
    this.cap = Math.max(4, o.capacity ?? 64);
    const base = new THREE.PlaneGeometry(1, 1);
    this.geo.index = base.index;
    this.geo.setAttribute("position", base.getAttribute("position"));
    this.geo.setAttribute("uv", base.getAttribute("uv"));
    this.alloc(this.cap);
    const mat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { map: { value: null } }]),
      vertexShader: VERT(o.mode ?? "billboard"),
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: o.depthTest ?? true,
      fog: o.fog ?? true,
      blending: o.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    mat.uniforms.map.value = tex;
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = o.renderOrder ?? 0;
    this.geo.instanceCount = 0;
  }

  get capacity(): number {
    return this.cap;
  }

  private alloc(cap: number): void {
    const pos = new Float32Array(cap * 3);
    const size = new Float32Array(cap * 4);
    const col = new Float32Array(cap * 4);
    if (this.pos) {
      pos.set(this.pos);
      size.set(this.size);
      col.set(this.col);
    }
    this.pos = pos;
    this.size = size;
    this.col = col;
    this.cap = cap;
    this.geo.setAttribute("iPos", new THREE.InstancedBufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute("iSize", new THREE.InstancedBufferAttribute(size, 4).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute("iColor", new THREE.InstancedBufferAttribute(col, 4).setUsage(THREE.DynamicDrawUsage));
  }

  /** Writes slot i (growing as needed); call commit() after a frame's writes. */
  set(
    i: number,
    x: number,
    y: number,
    z: number,
    sx: number,
    sy: number,
    rot: number,
    r: number,
    g: number,
    b: number,
    a: number,
  ): void {
    if (i >= this.cap) {
      let c = this.cap;
      while (c <= i) c *= 2;
      this.alloc(c);
    }
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = z;
    this.size[i * 4] = sx;
    this.size[i * 4 + 1] = sy;
    this.size[i * 4 + 2] = rot;
    this.col[i * 4] = r;
    this.col[i * 4 + 1] = g;
    this.col[i * 4 + 2] = b;
    this.col[i * 4 + 3] = a;
  }

  /** Uploads the first `count` slots. */
  commit(count = this.count): void {
    this.count = count;
    this.geo.instanceCount = count;
    this.mesh.visible = count > 0;
    if (!count) return;
    for (const [name, n] of [
      ["iPos", 3],
      ["iSize", 4],
      ["iColor", 4],
    ] as const) {
      const a = this.geo.getAttribute(name) as THREE.InstancedBufferAttribute;
      a.clearUpdateRanges();
      a.addUpdateRange(0, count * n);
      a.needsUpdate = true;
    }
  }

  dispose(): void {
    this.geo.dispose();
    this.mesh.material.dispose();
  }
}
