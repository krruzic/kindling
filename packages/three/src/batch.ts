// Draw-call reduction (from Grudge's batch/ and models/mergedModel.ts). mergeStatic() bakes every static mesh under
// a root into one mesh per material (world transforms applied), so a dressed map of hundreds of props costs a few
// draws. InstancePool keeps one InstancedMesh per template with add / move / remove handles (swap-remove keeps the
// live instances packed) and grows by doubling, for many copies of the same moving thing.
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/**
 * Merges the meshes under root (skipping skinned / instanced meshes and anything with userData.noMerge) into one
 * mesh per material, in root's local space. Attributes missing on some meshes are dropped from that material's
 * merge. Returns a group holding the merged meshes; the source is not modified.
 */
export function mergeStatic(root: THREE.Object3D): THREE.Group {
  root.updateWorldMatrix(true, true);
  const inv = root.matrixWorld.clone().invert();
  const groups = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const m = new THREE.Matrix4();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || (o as THREE.SkinnedMesh).isSkinnedMesh || (o as THREE.InstancedMesh).isInstancedMesh) return;
    if (o.userData.noMerge || Array.isArray(mesh.material)) return;
    m.multiplyMatrices(inv, mesh.matrixWorld);
    const g = (mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone()).applyMatrix4(m);
    let list = groups.get(mesh.material);
    if (!list) groups.set(mesh.material, (list = []));
    list.push(g);
  });
  const out = new THREE.Group();
  out.name = `${root.name || "static"}_merged`;
  for (const [mat, geos] of groups) {
    const common = Object.keys(geos[0].attributes).filter((k) => geos.every((g) => g.getAttribute(k)));
    for (const g of geos) for (const k of Object.keys(g.attributes)) if (!common.includes(k)) g.deleteAttribute(k);
    for (const g of geos) g.morphAttributes = {};
    const merged = mergeGeometries(geos, false);
    for (const g of geos) g.dispose();
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, mat);
    mesh.name = mat.name;
    out.add(mesh);
  }
  return out;
}

/** Counts the draw calls a subtree would take (visible meshes x materials; instanced meshes count once). */
export function drawCount(root: THREE.Object3D): number {
  let n = 0;
  root.traverseVisible((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh || (o as THREE.Points).isPoints) n += Array.isArray(m.material) ? m.material.length : 1;
  });
  return n;
}

export class InstancePool {
  mesh: THREE.InstancedMesh;
  private owner: number[] = [];
  private slotOf = new Map<number, number>();
  private next = 1;

  constructor(
    readonly geometry: THREE.BufferGeometry,
    readonly material: THREE.Material,
    capacity = 16,
  ) {
    this.mesh = this.make(capacity);
  }

  private make(cap: number): THREE.InstancedMesh {
    const m = new THREE.InstancedMesh(this.geometry, this.material, cap);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.count = 0;
    m.frustumCulled = false;
    return m;
  }

  get count(): number {
    return this.owner.length;
  }

  /** Adds an instance; returns its handle. */
  add(matrix: THREE.Matrix4, color?: THREE.ColorRepresentation): number {
    const i = this.owner.length;
    if (i >= this.mesh.instanceMatrix.count) this.grow();
    const id = this.next++;
    this.owner.push(id);
    this.slotOf.set(id, i);
    this.mesh.setMatrixAt(i, matrix);
    if (color !== undefined) this.mesh.setColorAt(i, new THREE.Color(color));
    this.mesh.count = this.owner.length;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    return id;
  }

  set(id: number, matrix: THREE.Matrix4): void {
    const i = this.slotOf.get(id);
    if (i === undefined) return;
    this.mesh.setMatrixAt(i, matrix);
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  setColor(id: number, color: THREE.ColorRepresentation): void {
    const i = this.slotOf.get(id);
    if (i === undefined) return;
    this.mesh.setColorAt(i, new THREE.Color(color));
    this.mesh.instanceColor!.needsUpdate = true;
  }

  /** Removes an instance (the last one moves into its slot). */
  remove(id: number): void {
    const i = this.slotOf.get(id);
    if (i === undefined) return;
    const last = this.owner.length - 1;
    if (i !== last) {
      const m = new THREE.Matrix4();
      this.mesh.getMatrixAt(last, m);
      this.mesh.setMatrixAt(i, m);
      if (this.mesh.instanceColor) {
        const c = new THREE.Color();
        this.mesh.getColorAt(last, c);
        this.mesh.setColorAt(i, c);
        this.mesh.instanceColor.needsUpdate = true;
      }
      const moved = this.owner[last];
      this.owner[i] = moved;
      this.slotOf.set(moved, i);
    }
    this.owner.pop();
    this.slotOf.delete(id);
    this.mesh.count = this.owner.length;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  private grow(): void {
    const old = this.mesh;
    const next = this.make(old.instanceMatrix.count * 2);
    next.instanceMatrix.array.set(old.instanceMatrix.array);
    if (old.instanceColor) {
      next.setColorAt(0, new THREE.Color());
      next.instanceColor!.array.set(old.instanceColor.array);
    }
    next.count = old.count;
    old.parent?.add(next);
    old.removeFromParent();
    old.dispose();
    this.mesh = next;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.dispose();
  }
}
