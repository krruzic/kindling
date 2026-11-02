// Socket-composed models (from RUST RING's bots): every part is its own GLB authored at its own origin, and carries
// named socket empties ("S_engine", "S_wheel_L1"...) with custom props exported as glTF extras (three puts them in
// userData: a wheel socket's radius, a tread socket's length). assembleBySockets() clones each part onto its socket;
// parts attached earlier may bring sockets of their own (a turret with S_barrel), so order matters and chains
// work. Missing sockets are reported, never thrown: any combination of parts must still assemble.
import * as THREE from "three";

export const SOCKET_PREFIX = "S_";

/** Every socket empty under root by name (first wins on duplicates). */
export function findSockets(root: THREE.Object3D, prefix = SOCKET_PREFIX): Map<string, THREE.Object3D> {
  const out = new Map<string, THREE.Object3D>();
  root.traverse((o) => {
    if (o.name.startsWith(prefix) && !out.has(o.name)) out.set(o.name, o);
  });
  return out;
}

/** Every named node under root (first wins), e.g. a part file's roots: chassis / wheel / weapon. */
export function namedNodes(root: THREE.Object3D): Map<string, THREE.Object3D> {
  const out = new Map<string, THREE.Object3D>();
  root.traverse((o) => {
    if (o.name && !out.has(o.name)) out.set(o.name, o);
  });
  return out;
}

export interface SocketPart {
  /** Socket name, or a pattern attaching a copy to every matching socket (/^S_wheel_/). */
  socket: string | RegExp;
  part: THREE.Object3D;
  /** Clone the part (default true); false attaches the object itself (single socket only). */
  clone?: boolean;
  /** Keep the part's own root transform instead of resetting it to the socket's origin. */
  keepTransform?: boolean;
  /** Adjust the attached copy from the socket's extras (scale a wheel to the socket's radius...). */
  fit?: (part: THREE.Object3D, socket: THREE.Object3D) => void;
  /** Name given to the attached copy (default: the part's name). */
  name?: string;
}

export interface Assembly {
  root: THREE.Object3D;
  /** Every socket known after assembly, including those brought by attached parts. */
  sockets: Map<string, THREE.Object3D>;
  /** Attached copies per socket name. */
  attached: Map<string, THREE.Object3D[]>;
  /** Socket names / patterns that matched nothing. */
  missing: string[];
}

/** Clones (deep) and attaches each part to its socket on `base`, in order. */
export function assembleBySockets(
  base: THREE.Object3D,
  parts: readonly SocketPart[],
  opts: { prefix?: string } = {},
): Assembly {
  const prefix = opts.prefix ?? SOCKET_PREFIX;
  const sockets = findSockets(base, prefix);
  const attached = new Map<string, THREE.Object3D[]>();
  const missing: string[] = [];
  for (const p of parts) {
    const targets =
      typeof p.socket === "string"
        ? [sockets.get(p.socket)].filter((s): s is THREE.Object3D => !!s)
        : [...sockets.entries()].filter(([n]) => (p.socket as RegExp).test(n)).map(([, s]) => s);
    if (!targets.length) {
      missing.push(String(p.socket));
      continue;
    }
    for (const s of targets) {
      const c = p.clone === false && targets.length === 1 ? p.part : p.part.clone(true);
      if (!p.keepTransform) {
        c.position.set(0, 0, 0);
        c.quaternion.identity();
      }
      if (p.name) c.name = p.name;
      s.add(c);
      p.fit?.(c, s);
      let list = attached.get(s.name);
      if (!list) attached.set(s.name, (list = []));
      list.push(c);
      for (const [n, o] of findSockets(c, prefix)) if (!sockets.has(n)) sockets.set(n, o);
    }
  }
  base.updateMatrixWorld(true);
  return { root: base, sockets, attached, missing };
}

/** fit() helper: uniform scale so the part's extra `key` matches the socket's (wheel radius r -> socket r). */
export const fitByExtra =
  (key: string, fallback?: number) =>
  (part: THREE.Object3D, socket: THREE.Object3D): void => {
    const want = Number(socket.userData[key] ?? NaN);
    const have = Number(part.userData[key] ?? fallback ?? NaN);
    if (want > 0 && have > 0) part.scale.multiplyScalar(want / have);
  };

/** World matrix of a socket relative to `root` (root-local transform of whatever sits on it). */
export function socketMatrix(root: THREE.Object3D, socket: THREE.Object3D, out = new THREE.Matrix4()): THREE.Matrix4 {
  root.updateWorldMatrix(true, true);
  return out.copy(root.matrixWorld).invert().multiply(socket.matrixWorld);
}
