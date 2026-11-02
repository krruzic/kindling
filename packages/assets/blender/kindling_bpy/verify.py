#!/usr/bin/env python3
"""GLB verifier in plain Python (from RUST RING's verify_assets.py): runs with or without Blender.

    python3 verify.py part.glb [--nodes body,S_top] [--materials team] [--max-tris 2000] [--ground 0.01]
                      [--extras S_top:size,S_wheel_L1:r] [--clips idle,run] [--skinned] [--json]

Checks: required node names, required material names, total triangle budget, ground contact (lowest vertex of the
scene's world bounds within tolerance of y = 0, glTF Y-up), required extras keys on nodes, required animation clips,
a skin present. Exits non-zero on any failure. verify() returns (errors, info) for use from other scripts.
"""

import json
import struct
import sys

COMPONENTS = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}


def load_glb(path):
    with open(path, "rb") as f:
        data = f.read()
    magic, _version, _length = struct.unpack_from("<III", data, 0)
    if magic != 0x46546C67:
        raise ValueError(f"{path}: not a GLB")
    off, js, binary = 12, None, b""
    while off < len(data):
        clen, ctype = struct.unpack_from("<II", data, off)
        chunk = data[off + 8: off + 8 + clen]
        if ctype == 0x4E4F534A:
            js = json.loads(chunk.decode("utf-8"))
        elif ctype == 0x004E4942:
            binary = chunk
        off += 8 + clen
    return js, binary


def _quat(q):
    x, y, z, w = q
    return [[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
            [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
            [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]]


def local_matrix(node):
    if "matrix" in node:
        m = node["matrix"]
        return [[m[c * 4 + r] for c in range(4)] for r in range(4)]
    t = node.get("translation", [0, 0, 0])
    r = _quat(node.get("rotation", [0, 0, 0, 1]))
    s = node.get("scale", [1, 1, 1])
    return [[r[i][0] * s[0], r[i][1] * s[1], r[i][2] * s[2], t[i]] for i in range(3)] + [[0, 0, 0, 1]]


def mul(a, b):
    return [[sum(a[i][k] * b[k][j] for k in range(4)) for j in range(4)] for i in range(4)]


def apply(m, p):
    return [sum(m[i][k] * p[k] for k in range(3)) + m[i][3] for i in range(3)]


class Glb:
    def __init__(self, path):
        self.path = path
        self.js, self.bin = load_glb(path)
        self.nodes = self.js.get("nodes", [])
        self.world = {}
        roots = self.js["scenes"][self.js.get("scene", 0)]["nodes"]
        ident = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]]
        stack = [(r, ident) for r in roots]
        while stack:
            i, pm = stack.pop()
            m = mul(pm, local_matrix(self.nodes[i]))
            self.world[i] = m
            for c in self.nodes[i].get("children", []):
                stack.append((c, m))
        self.by_name = {}
        for i, n in enumerate(self.nodes):
            self.by_name.setdefault(n.get("name"), i)

    def node(self, name):
        i = self.by_name.get(name)
        return None if i is None else self.nodes[i]

    def pos(self, name):
        m = self.world[self.by_name[name]]
        return [m[0][3], m[1][3], m[2][3]]

    def materials(self):
        return [m.get("name") for m in self.js.get("materials", [])]

    def clips(self):
        return [a.get("name") for a in self.js.get("animations", [])]

    def mesh_tris(self, mi):
        t = 0
        for p in self.js["meshes"][mi]["primitives"]:
            if p.get("mode", 4) != 4:
                continue
            acc = self.js["accessors"][p["indices"]] if "indices" in p else self.js["accessors"][p["attributes"]["POSITION"]]
            t += acc["count"] // 3
        return t

    def total_tris(self):
        return sum(self.mesh_tris(n["mesh"]) for i, n in enumerate(self.nodes) if "mesh" in n and i in self.world)

    def bounds(self):
        """World AABB from each mesh's POSITION min/max box corners (exact for axis-aligned transforms)."""
        lo, hi = [1e18] * 3, [-1e18] * 3
        for i, n in enumerate(self.nodes):
            if "mesh" not in n or i not in self.world:
                continue
            for p in self.js["meshes"][n["mesh"]]["primitives"]:
                a = self.js["accessors"][p["attributes"]["POSITION"]]
                mn, mx = a.get("min"), a.get("max")
                if not mn:
                    continue
                for cx in (mn[0], mx[0]):
                    for cy in (mn[1], mx[1]):
                        for cz in (mn[2], mx[2]):
                            w = apply(self.world[i], [cx, cy, cz])
                            lo = [min(a_, b_) for a_, b_ in zip(lo, w)]
                            hi = [max(a_, b_) for a_, b_ in zip(hi, w)]
        return lo, hi


def verify(path, nodes=(), materials=(), max_tris=None, ground=None, extras=(), clips=(), skinned=False):
    errors = []
    g = Glb(path)
    for n in nodes:
        if g.node(n) is None:
            errors.append(f"missing node {n}")
    mats = g.materials()
    for m in materials:
        if not any(x == m or (x or "").startswith(m) for x in mats):
            errors.append(f"missing material {m} (have {mats})")
    tris = g.total_tris()
    if max_tris is not None and tris > max_tris:
        errors.append(f"{tris} triangles > budget {max_tris}")
    lo, hi = g.bounds()
    if ground is not None and abs(lo[1]) > ground:
        errors.append(f"not on the ground: lowest y = {lo[1]:.4f}")
    for spec in extras:
        name, key = spec.split(":")
        n = g.node(name)
        if n is None or key not in n.get("extras", {}):
            errors.append(f"node {name} lacks extra {key}")
    have = g.clips()
    for c in clips:
        if c not in have:
            errors.append(f"missing clip {c} (have {have})")
    if skinned and not g.js.get("skins"):
        errors.append("no skin")
    info = {
        "file": path,
        "tris": tris,
        "nodes": [n.get("name") for n in g.nodes],
        "materials": mats,
        "clips": have,
        "skins": len(g.js.get("skins", [])),
        "bounds": [lo, hi],
        "extras": {n.get("name"): n["extras"] for n in g.nodes if n.get("extras")},
    }
    return errors, info


def main(argv):
    import argparse

    ap = argparse.ArgumentParser()
    ap.add_argument("files", nargs="+")
    ap.add_argument("--nodes", default="")
    ap.add_argument("--materials", default="")
    ap.add_argument("--max-tris", type=int)
    ap.add_argument("--ground", type=float)
    ap.add_argument("--extras", default="")
    ap.add_argument("--clips", default="")
    ap.add_argument("--skinned", action="store_true")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args(argv)
    split = lambda s: [x for x in s.split(",") if x]
    failed = 0
    for f in a.files:
        errors, info = verify(f, split(a.nodes), split(a.materials), a.max_tris, a.ground, split(a.extras),
                              split(a.clips), a.skinned)
        failed += bool(errors)
        if a.json:
            print(json.dumps({"ok": not errors, "errors": errors, **info}))
        else:
            for e in errors:
                print("FAIL", f, e)
            print(("ok  " if not errors else "BAD ") + f, f"{info['tris']} tris", info["materials"], info["clips"])
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
