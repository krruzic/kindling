"""Smoke run of the Blender modules (CPU only):

    nice -n 10 blender -b --factory-startup -P blender/smoke.py -- <out_dir>

1. A tiny textured part: a 1 m cube on the ground with a texgen brick texture, a near-white "team" material on its
   top face, a child crate whose texture is a procedural graph baked with Cycles on the CPU, and two sockets with
   custom props; exported to smoke.glb, verified (nodes, materials, tris, ground contact, extras) and thumbnailed.
2. Rig transfer: a two-bone rig with a "bend" clip (rig.glb) and an unrigged column standing in for an AI mesh
   (ai_mesh.glb); transfer() binds the column to the rig and exports rigged.glb, verified for a skin and the clip.

Prints "RESULT {json}" on success.
"""

import json
import math
import os
import sys

import bmesh
import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from kindling_bpy import bake, export, rig, scene, sockets, texgen, thumbs, verify  # noqa: E402

out = os.path.abspath((scene.script_args() or ["/tmp/opencode/kindling-smoke"])[0])
os.makedirs(out, exist_ok=True)


def cube(name, size, z0=0.0, mats=()):
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=size)
    bmesh.ops.translate(bm, verts=bm.verts, vec=(0, 0, size / 2 + z0))
    bm.to_mesh(me)
    bm.free()
    for m in mats:
        me.materials.append(m)
    o = bpy.data.objects.new(name, me)
    scene.link(o)
    return o


# ---------------------------------------------------------------------------------------------------- 1. a part
scene.reset()
stone = bake.textured_material("stone", texgen.to_image("stone_tex", texgen.bricks(seed=3, size=32), retro_look=True))
team = bake.flat_material("team", (0.95, 0.95, 0.95))
body = cube("body", 1.0, mats=(stone, team))
for p in body.data.polygons:
    p.material_index = 1 if p.normal.z > 0.9 else 0
bake.unwrap([body])
crate = cube("crate", 0.3, z0=0.0)
crate.parent = body
crate.location = (0.7, 0, 0)


def crate_graph(g):
    n = g.noise(g.coords("Object"), 6.0, 3.0)
    return g.mix((0.35, 0.2, 0.08), (0.75, 0.5, 0.25), g.smooth(n, 0.35, 0.65))


crate_img, crate_mat = bake.bake_procedural([crate], crate_graph, name="crate", res=64, samples=1)
sockets.socket("top", body, (0, 0, 1.0), size=0.5)
sockets.socket("side", body, (-0.5, 0, 0.5), (0, 0, math.pi), kind="lamp")
body["ref_size"] = 1.0
glb = os.path.join(out, "smoke.glb")
nbytes = export.export_glb(sockets.tree(body), glb)
errors, info = verify.verify(glb, nodes=("body", "crate", "S_top", "S_side"), materials=("team", "stone", "crate"),
                             max_tris=200, ground=0.001, extras=("S_top:size", "S_side:kind", "body:ref_size"))
if errors:
    raise SystemExit(f"smoke.glb failed verification: {errors}")
thumbs.render_thumb([body, crate], os.path.join(out, "smoke_thumb.png"), size=128)

# --------------------------------------------------------------------------------------------- 2. rig transfer
scene.reset()
arm_data = bpy.data.armatures.new("rig")
arm = bpy.data.objects.new("rig", arm_data)
scene.link(arm)
scene.select_only([arm])
bpy.ops.object.mode_set(mode="EDIT")
lower = arm_data.edit_bones.new("lower")
lower.head, lower.tail = (0, 0, 0), (0, 0, 1)
upper = arm_data.edit_bones.new("upper")
upper.head, upper.tail, upper.parent = (0, 0, 1), (0, 0, 2), lower
bpy.ops.object.mode_set(mode="OBJECT")
for pb in arm.pose.bones:
    pb.rotation_mode = "XYZ"
arm.animation_data_create()
act = bpy.data.actions.new("bend")
arm.animation_data.action = act
for f, a in ((1, 0), (12, 40), (24, 0)):
    arm.pose.bones["upper"].rotation_euler = (math.radians(a), 0, 0)
    arm.pose.bones["upper"].keyframe_insert("rotation_euler", frame=f)
tr = arm.animation_data.nla_tracks.new()
tr.name = "bend"
tr.strips.new("bend", 1, act)
arm.animation_data.action = None
rig_glb = os.path.join(out, "rig.glb")
export.export_glb([arm], rig_glb, animations=True)

scene.reset()
me = bpy.data.meshes.new("column")
bm = bmesh.new()
bmesh.ops.create_cone(bm, cap_ends=True, segments=8, radius1=0.25, radius2=0.25, depth=2.0)
bmesh.ops.subdivide_edges(bm, edges=[e for e in bm.edges if abs(e.verts[0].co.z - e.verts[1].co.z) > 1], cuts=7)
# A seam split like AI meshes have: duplicate verts the weld proxy has to stitch.
bmesh.ops.split_edges(bm, edges=[e for e in bm.edges if abs(e.verts[0].co.x - e.verts[1].co.x) < 1e-6 and e.verts[0].co.y > 0.2])
bm.to_mesh(me)
bm.free()
col = bpy.data.objects.new("column", me)
scene.link(col)
col.location = (3, 1, 5)
ai_glb = os.path.join(out, "ai_mesh.glb")
export.export_glb([col], ai_glb)

report = rig.transfer(ai_glb, rig_glb, os.path.join(out, "rigged.glb"), name="body")
errors, rinfo = verify.verify(report["out"], nodes=("body", "lower", "upper"), clips=("bend",), skinned=True, ground=0.001)
if errors:
    raise SystemExit(f"rigged.glb failed verification: {errors} {report}")

print("RESULT " + json.dumps({"part": {"bytes": nbytes, **info}, "rig": {**report, "verify": rinfo["clips"]}}))
