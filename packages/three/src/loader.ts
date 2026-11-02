// glTF asset cache: each URL loads once (concurrent requests share the in-flight promise), instances are deep
// clones (SkeletonUtils, so skinned meshes get their own skeletons). DRACO and KTX2 are optional and loaded lazily
// only when configured. loadOr() never rejects: a missing or broken file logs a warning and returns a placeholder,
// so the game always runs (RUST RING builds procedural stand-ins from the same socket contract).
import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as skeletonClone } from "three/examples/jsm/utils/SkeletonUtils.js";

export interface AssetCacheOptions {
  manager?: THREE.LoadingManager;
  /** Path to the DRACO decoder files (e.g. "/draco/"); unset = no DRACO support. */
  dracoPath?: string;
  /** Path to the Basis transcoder (e.g. "/basis/") and the renderer to detect support with; unset = no KTX2. */
  ktx2?: { transcoderPath: string; renderer: THREE.WebGLRenderer };
  /** Called on every loaded scene before caching (material conversion, shadows, merging...). */
  prepare?: (scene: THREE.Group, gltf: GLTF) => void;
}

export class AssetCache {
  private loader: GLTFLoader;
  private ready: Promise<void>;
  private cache = new Map<string, Promise<GLTF>>();
  private loaded = new Map<string, GLTF>();

  constructor(private o: AssetCacheOptions = {}) {
    this.loader = new GLTFLoader(o.manager);
    this.ready = this.configure();
  }

  private async configure(): Promise<void> {
    if (this.o.dracoPath) {
      const { DRACOLoader } = await import("three/examples/jsm/loaders/DRACOLoader.js");
      const d = new DRACOLoader();
      d.setDecoderPath(this.o.dracoPath);
      this.loader.setDRACOLoader(d);
    }
    if (this.o.ktx2) {
      const { KTX2Loader } = await import("three/examples/jsm/loaders/KTX2Loader.js");
      const k = new KTX2Loader().setTranscoderPath(this.o.ktx2.transcoderPath).detectSupport(this.o.ktx2.renderer);
      this.loader.setKTX2Loader(k);
    }
  }

  /** Loads (once) and returns the glTF. Rejects on failure (and forgets it, so a retry reloads). */
  load(url: string): Promise<GLTF> {
    let p = this.cache.get(url);
    if (!p) {
      p = this.ready
        .then(() => this.loader.loadAsync(url))
        .then((g) => {
          this.o.prepare?.(g.scene, g);
          this.loaded.set(url, g);
          return g;
        });
      p.catch(() => this.cache.delete(url));
      this.cache.set(url, p);
    }
    return p;
  }

  /** Parses an in-memory GLB/glTF (tests, generated content) and caches it under `key`. */
  async parse(key: string, data: ArrayBuffer | string, path = ""): Promise<GLTF> {
    await this.ready;
    const g = await this.loader.parseAsync(data, path);
    this.o.prepare?.(g.scene, g);
    this.loaded.set(key, g);
    this.cache.set(key, Promise.resolve(g));
    return g;
  }

  /** The loaded glTF, if already loaded. */
  get(url: string): GLTF | undefined {
    return this.loaded.get(url);
  }

  /** A fresh deep clone of a loaded scene (throws if not loaded). */
  instance(url: string): THREE.Object3D {
    const g = this.loaded.get(url);
    if (!g) throw new Error(`asset not loaded: ${url}`);
    return skeletonClone(g.scene);
  }

  /** Loads and returns a fresh instance. */
  async instanceAsync(url: string): Promise<THREE.Object3D> {
    await this.load(url);
    return this.instance(url);
  }

  /** Loads, or warns and returns `placeholder()` when the file is missing or broken. Never rejects. */
  async loadOr(url: string, placeholder: () => THREE.Object3D): Promise<{ scene: THREE.Object3D; fallback: boolean }> {
    try {
      const g = await this.load(url);
      return { scene: g.scene, fallback: false };
    } catch (err) {
      console.warn(`asset ${url} failed to load, using placeholder`, err);
      return { scene: placeholder(), fallback: true };
    }
  }

  /** Clips of a loaded asset. */
  clips(url: string): THREE.AnimationClip[] {
    return this.loaded.get(url)?.animations ?? [];
  }

  dispose(): void {
    for (const g of this.loaded.values())
      g.scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        m.geometry.dispose();
        for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
          for (const v of Object.values(mat)) if ((v as THREE.Texture)?.isTexture) (v as THREE.Texture).dispose();
          mat.dispose();
        }
      });
    this.loaded.clear();
    this.cache.clear();
  }
}
