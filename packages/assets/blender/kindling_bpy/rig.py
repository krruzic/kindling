"""Rig transfer: put an AI-generated mesh (Tripo) onto an existing armature and its clips (generalised from Grudge's
build_tripo_hero.py / build_tripo_unit.py). Steps:

1. import_mesh: import the GLB, join its meshes, apply transforms, turn it to face the rig's forward (yaw), scale to
   a height (or the rig's), put its feet on z = 0 and centre it; optional decimate to a triangle budget.
2. load_rig: import the rig GLB (or append from a .blend), drop its meshes, keep the armature and every action.
3. auto_weights: heat weights computed on a *welded copy* (AI meshes are split along UV seams, which breaks the heat
   solve), then copied back to the real mesh by nearest vertex (Data Transfer).
4. fill_unweighted: any vertex left without weights goes fully to the nearest bone segment.
5. bind: parent with an Armature modifier; every action becomes an NLA track so the exporter writes them as clips.

transfer() runs all of it and exports the GLB. Game-specific fixes (rigid islands for props, palm orientation,
swinging arms down from an A-pose) stay in the game's script, between the steps.
"""

import math
import os

import bmesh
import bpy
from mathutils import Matrix, Vector

from . import export as kexport
from . import scene as kscene


def import_mesh(path, name="body", yaw=0.0, height=None, decimate=1.0, center=True):
    before = set(bpy.context.scene.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.context.scene.objects if o not in before]
    meshes = [o for o in new if o.type == "MESH"]
    if not meshes:
        raise RuntimeError(f"{path}: no mesh")
    for o in meshes:
        o.data = o.data.copy()
        o.data.transform(o.matrix_world)
        o.parent = None
        o.matrix_world = Matrix.Identity(4)
    if len(meshes) > 1:
        kscene.select_only(meshes)
        bpy.ops.object.join()
    src = meshes[0]
    for o in new:
        if o is not src and o.name in bpy.data.objects:
            bpy.data.objects.remove(o, do_unlink=True)
    me = src.data
    me.transform(Matrix.Rotation(math.radians(yaw), 4, "Z"))
    zs = [v.co.z for v in me.vertices]
    if height:
        me.transform(Matrix.Scale(height / max(1e-6, max(zs) - min(zs)), 4))
    co = [v.co for v in me.vertices]
    off = Vector((0, 0, -min(c.z for c in co)))
    if center:
        off.x = -(min(c.x for c in co) + max(c.x for c in co)) / 2
        off.y = -(min(c.y for c in co) + max(c.y for c in co)) / 2
    me.transform(Matrix.Translation(off))
    src.name = me.name = name
    if decimate < 1:
        m = src.modifiers.new("dec", "DECIMATE")
        m.ratio = decimate
        m.use_collapse_triangulate = True
        kscene.select_only([src])
        bpy.ops.object.modifier_apply(modifier=m.name)
    return src


def load_rig(path):
    """Returns (armature, actions) from a .glb/.gltf (meshes removed) or a .blend (first armature appended)."""
    before_actions = set(bpy.data.actions)
    if path.endswith(".blend"):
        with bpy.data.libraries.load(path) as (src, dst):
            dst.objects = [n for n in src.objects]
        arm = next(o for o in dst.objects if o and o.type == "ARMATURE")
        bpy.context.scene.collection.objects.link(arm)
    else:
        before = set(bpy.context.scene.objects)
        bpy.ops.import_scene.gltf(filepath=path)
        new = [o for o in bpy.context.scene.objects if o not in before]
        arm = next(o for o in new if o.type == "ARMATURE")
        for o in new:
            if o is not arm and o.type == "MESH":
                bpy.data.objects.remove(o, do_unlink=True)
    actions = [a for a in bpy.data.actions if a not in before_actions]
    return arm, actions


def rig_height(arm):
    return max(max(b.head_local.z, b.tail_local.z) for b in arm.data.bones) * arm.matrix_world.to_scale().z


def weld_copy(src, dist=0.002):
    me = src.data.copy()
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=dist)
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new(src.name + "_weld", me)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def auto_weights(src, arm, weld=0.002):
    """Heat weights through a welded proxy, copied back by nearest vertex. Returns bones that got no weight."""
    proxy = weld_copy(src, weld)
    kscene.select_only([proxy, arm], active=arm)
    bpy.ops.object.parent_set(type="ARMATURE_AUTO")
    used = {g.group for v in proxy.data.vertices for g in v.groups if g.weight > 0.01}
    empty = [g.name for g in proxy.vertex_groups if g.index not in used]
    for b in arm.data.bones:
        if b.name not in src.vertex_groups:
            src.vertex_groups.new(name=b.name)
    dt = src.modifiers.new("dt", "DATA_TRANSFER")
    dt.object = proxy
    dt.use_vert_data = True
    dt.data_types_verts = {"VGROUP_WEIGHTS"}
    dt.vert_mapping = "NEAREST"
    dt.layers_vgroup_select_src = "ALL"
    dt.layers_vgroup_select_dst = "NAME"
    kscene.select_only([src])
    bpy.ops.object.modifier_apply(modifier=dt.name)
    bpy.data.objects.remove(proxy, do_unlink=True)
    return empty


def fill_unweighted(src, arm, skip=("root",)):
    """Vertices with (almost) no weight go fully to the nearest bone segment. Returns how many were filled."""
    inv = src.matrix_world.inverted() @ arm.matrix_world
    segs = [(b.name, inv @ b.head_local, inv @ b.tail_local) for b in arm.data.bones if b.name not in skip and b.use_deform]
    names = {g.index: g.name for g in src.vertex_groups}
    n = 0
    for v in src.data.vertices:
        if sum(g.weight for g in v.groups if names[g.group] in arm.data.bones) > 0.01:
            continue
        best, bd = None, 1e18
        for name, h, t in segs:
            d = t - h
            u = max(0.0, min(1.0, (v.co - h).dot(d) / max(d.length_squared, 1e-9)))
            dist = (v.co - (h + d * u)).length
            if dist < bd:
                best, bd = name, dist
        if best:
            src.vertex_groups[best].add([v.index], 1.0, "REPLACE")
            n += 1
    return n


def bind(src, arm, actions=()):
    """Parents with an Armature modifier and lays every action out as an NLA track (one clip each on export)."""
    src.parent = arm
    src.matrix_parent_inverse = arm.matrix_world.inverted()
    m = src.modifiers.new("Armature", "ARMATURE")
    m.object = arm
    ad = arm.animation_data or arm.animation_data_create()
    have = {s.action for t in ad.nla_tracks for s in t.strips}
    for act in actions:
        if act in have:
            continue
        tr = ad.nla_tracks.new()
        tr.name = act.name
        start = int(act.frame_range[0])
        tr.strips.new(act.name, start, act)
    ad.action = None
    return m


def transfer(mesh_path, rig_path, out_path, yaw=0.0, height=None, decimate=1.0, weld=0.002, name="body"):
    """The whole transfer into a fresh scene; returns a report dict (tris, empty bones, filled verts, clips, bytes)."""
    kscene.reset()
    arm, actions = load_rig(rig_path)
    src = import_mesh(mesh_path, name, yaw, height or rig_height(arm), decimate)
    empty = auto_weights(src, arm, weld)
    filled = fill_unweighted(src, arm)
    bind(src, arm, actions)
    size = kexport.export_glb([src, arm], out_path, animations=True)
    return {
        "tris": kscene.tri_count([src]),
        "empty_bones": empty,
        "filled": filled,
        "clips": sorted(t.name for t in arm.animation_data.nla_tracks),
        "bytes": size,
        "out": os.path.abspath(out_path),
    }
