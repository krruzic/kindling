"""Procedural shader graphs baked to images on the CPU (from RUST RING's kit.py). Build any Cycles node graph with
the Graph DSL (noise, voronoi, mix, smoothstep, ambient occlusion, bevel edges...), and bake_procedural() unwraps
the objects into one shared UV atlas, bakes the graph's colour through an Emission shader into an image (Cycles,
CPU only), and swaps in a plain Principled material using that image: what glTF / three.js can draw.

Also textured_material() for an image you already have (texgen.to_image) and flat_material() for solid colours
(team / paint materials the runtime dyes are authored near-white and flat).
"""

import math

import bpy

from . import scene as kscene


class Graph:
    """Tiny node-building DSL over a material's node tree (cleared)."""

    def __init__(self, mat):
        mat.use_nodes = True
        self.nt = mat.node_tree
        self.nt.nodes.clear()
        self.nodes = self.nt.nodes

    def new(self, kind, **props):
        n = self.nodes.new(kind)
        for k, v in props.items():
            setattr(n, k, v)
        return n

    @staticmethod
    def sock(n, ident, outputs=False):
        for s in n.outputs if outputs else n.inputs:
            if s.identifier == ident or s.name == ident:
                return s
        raise KeyError(f"{n.bl_idname}: {ident}")

    def feed(self, sock, v):
        if hasattr(v, "is_output") or hasattr(v, "links"):
            self.nt.links.new(v, sock)
        elif isinstance(v, (tuple, list)):
            sock.default_value = tuple(v) + ((1.0,) if len(v) == 3 and len(sock.default_value) == 4 else ())
        else:
            sock.default_value = v

    def math(self, op, a, b=0.0, clamp=False):
        n = self.new("ShaderNodeMath", operation=op, use_clamp=clamp)
        self.feed(n.inputs[0], a)
        self.feed(n.inputs[1], b)
        return n.outputs[0]

    def add(self, a, b):
        return self.math("ADD", a, b)

    def mul(self, a, b):
        return self.math("MULTIPLY", a, b)

    def sat(self, a):
        return self.math("MULTIPLY", a, 1.0, clamp=True)

    def smooth(self, x, lo, hi):
        n = self.new("ShaderNodeMapRange", interpolation_type="SMOOTHSTEP")
        self.feed(n.inputs["Value"], x)
        n.inputs["From Min"].default_value = lo
        n.inputs["From Max"].default_value = hi
        return n.outputs["Result"]

    def mix(self, a, b, f, blend="MIX"):
        n = self.new("ShaderNodeMix", data_type="RGBA", blend_type=blend)
        self.feed(self.sock(n, "Factor_Float"), f)
        self.feed(self.sock(n, "A_Color"), a)
        self.feed(self.sock(n, "B_Color"), b)
        return self.sock(n, "Result_Color", True)

    def noise(self, vec, scale, detail=4.0, rough=0.55, color=False):
        n = self.new("ShaderNodeTexNoise")
        if vec is not None:
            self.feed(n.inputs["Vector"], vec)
        n.inputs["Scale"].default_value = scale
        n.inputs["Detail"].default_value = detail
        n.inputs["Roughness"].default_value = rough
        return n.outputs["Color" if color else "Fac"]

    def voronoi(self, vec, scale, feature="F1", out="Distance"):
        n = self.new("ShaderNodeTexVoronoi", feature=feature)
        if vec is not None:
            self.feed(n.inputs["Vector"], vec)
        n.inputs["Scale"].default_value = scale
        return n.outputs[out]

    def coords(self, kind="Object"):
        return self.new("ShaderNodeTexCoord").outputs[kind]

    def ao(self, distance=0.1, samples=8):
        n = self.new("ShaderNodeAmbientOcclusion", samples=samples, only_local=True)
        n.inputs["Distance"].default_value = distance
        return n.outputs["AO"]

    def edges(self, radius=0.012, sharp=14.0):
        """0..1 near convex edges (Bevel normal vs true normal): chipped / worn edge masks."""
        bev = self.new("ShaderNodeBevel", samples=8)
        bev.inputs["Radius"].default_value = radius
        geo = self.new("ShaderNodeNewGeometry")
        dot = self.new("ShaderNodeVectorMath", operation="DOT_PRODUCT")
        self.feed(dot.inputs[0], bev.outputs[0])
        self.feed(dot.inputs[1], geo.outputs["Normal"])
        return self.sat(self.mul(self.math("SUBTRACT", 1.0, dot.outputs["Value"]), sharp))


def flat_material(name, color=(1, 1, 1), rough=0.8, metal=0.0, emission=None):
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    g = Graph(mat)
    out = g.new("ShaderNodeOutputMaterial")
    bsdf = g.new("ShaderNodeBsdfPrincipled")
    g.nt.links.new(bsdf.outputs[0], out.inputs["Surface"])
    bsdf.inputs["Base Color"].default_value = tuple(color) + (1,)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    if emission:
        bsdf.inputs["Emission Color"].default_value = tuple(emission[:3]) + (1,)
        bsdf.inputs["Emission Strength"].default_value = emission[3] if len(emission) > 3 else 1.0
    return mat


def textured_material(name, image, rough=0.85, nearest=False):
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    g = Graph(mat)
    out = g.new("ShaderNodeOutputMaterial")
    bsdf = g.new("ShaderNodeBsdfPrincipled")
    g.nt.links.new(bsdf.outputs[0], out.inputs["Surface"])
    t = g.new("ShaderNodeTexImage", image=image, interpolation="Closest" if nearest else "Linear")
    g.nt.links.new(t.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = rough
    return mat


def unwrap(objs, angle=55.0, margin=0.012):
    """Smart-project every object into one shared UV layout."""
    meshes = [o for o in objs if o.type == "MESH"]
    kscene.select_only(meshes)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(angle), island_margin=margin, area_weight=0.0,
                             scale_to_bounds=False)
    bpy.ops.object.mode_set(mode="OBJECT")


def bake_procedural(objs, build, name="baked", res=256, samples=4, margin=4, rough=0.8, keep=None):
    """Bakes build(graph) -> colour socket over `objs` into an image; replaces their materials (except names in
    `keep`) with one Principled material `name` using it. Returns (image, material)."""
    kscene.cycles_cpu(bpy.context.scene, samples)
    meshes = [o for o in objs if o.type == "MESH" and len(o.data.polygons)]
    keep = set(keep or ())
    unwrap(meshes)
    img = bpy.data.images.new(name, res, res, alpha=False)
    src = bpy.data.materials.new(name + "_src")
    g = Graph(src)
    out = g.new("ShaderNodeOutputMaterial")
    em = g.new("ShaderNodeEmission")
    g.nt.links.new(em.outputs[0], out.inputs["Surface"])
    g.feed(em.inputs["Color"], build(g))
    tex = g.new("ShaderNodeTexImage", image=img)
    g.nodes.active = tex
    # Every face bakes with the source graph (kept faces too: a little atlas space, simpler bookkeeping).
    saved = {}
    for o in meshes:
        idx = [0] * len(o.data.polygons)
        o.data.polygons.foreach_get("material_index", idx)
        saved[o.name] = (list(o.data.materials), idx)
        o.data.materials.clear()
        o.data.materials.append(src)
        o.data.polygons.foreach_set("material_index", [0] * len(idx))
    kscene.select_only(meshes)
    bpy.ops.object.bake(type="EMIT", margin=margin, use_clear=True)
    img.pack()
    final = textured_material(name, img, rough)
    for o in meshes:
        old, idx = saved[o.name]
        o.data.materials.clear()
        remap = []
        mats = [final]
        for m in old:
            if m and m.name in keep:
                if m not in mats:
                    mats.append(m)
                remap.append(mats.index(m))
            else:
                remap.append(0)
        for m in mats:
            o.data.materials.append(m)
        o.data.polygons.foreach_set("material_index", [remap[i] if i < len(remap) else 0 for i in idx])
        o.data.update()
    bpy.data.materials.remove(src)
    return img, final
