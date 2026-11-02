"""Builds the part GLBs for the @kindling/three demo (a little socket-composed rover), CPU only:

    nice -n 10 blender -b --factory-startup -P blender/demo_parts.py -- <out_dir>

- chassis.glb: hull (baked procedural grime metal) with a near-white `team_paint` deck the runtime dyes; sockets
  S_turret, S_wheel_{L,R}{1,2} (extra r: wheel radius wanted there), S_lamp_{L,R} (extra glow colour).
- wheel.glb:   tyre + hub, extra r = its own radius (the runtime scales it to the socket's r).
- turret.glb:  team-striped turret with S_barrel; clips "idle" (scan) and "fire" (recoil kick) on the turret node.
- barrel.glb:  the gun barrel.
Also writes <out>/thumbs/<part>.png (Workbench).
"""

import math
import os
import sys

import bmesh
import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from kindling_bpy import bake, export, scene, sockets, texgen, thumbs, verify  # noqa: E402

out = os.path.abspath((scene.script_args() or ["demo_parts"])[0])
os.makedirs(os.path.join(out, "thumbs"), exist_ok=True)


def mesh(name, build, mats, parent=None, loc=(0, 0, 0)):
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    build(bm)
    bm.to_mesh(me)
    bm.free()
    for m in mats:
        me.materials.append(m)
    o = bpy.data.objects.new(name, me)
    scene.link(o)
    o.parent = parent
    o.location = loc
    return o


def box(sx, sy, sz, at=(0, 0, 0), bev=0.0):
    def b(bm):
        bmesh.ops.create_cube(bm, size=1.0)
        bmesh.ops.scale(bm, vec=(sx, sy, sz), verts=bm.verts)
        if bev:
            bmesh.ops.bevel(bm, geom=list(bm.edges), offset=bev, segments=1, affect="EDGES")
        bmesh.ops.translate(bm, verts=bm.verts, vec=at)
    return b


def cyl(r, depth, axis="Z", at=(0, 0, 0), segs=16, r2=None):
    def b(bm):
        bmesh.ops.create_cone(bm, cap_ends=True, segments=segs, radius1=r, radius2=r if r2 is None else r2, depth=depth)
        rot = {"Z": None, "X": ("Y", math.pi / 2), "Y": ("X", math.pi / 2)}[axis]
        if rot:
            from mathutils import Matrix
            bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=Matrix.Rotation(rot[1], 3, rot[0]))
        bmesh.ops.translate(bm, verts=bm.verts, vec=at)
    return b


def grime(g):
    p = g.coords("Object")
    n = g.noise(p, 5.0, 4.0)
    fine = g.noise(p, 30.0, 2.0)
    base = g.mix((0.16, 0.17, 0.18), (0.36, 0.37, 0.38), g.smooth(n, 0.3, 0.7))
    base = g.mix(base, (0.62, 0.6, 0.56), g.mul(g.edges(0.02, 10.0), 0.8))
    return g.mix(base, (0.3, 0.14, 0.06), g.mul(g.smooth(fine, 0.62, 0.75), 0.6))


def finish(name, root, checks):
    path = os.path.join(out, f"{name}.glb")
    export.export_glb(sockets.tree(root), path)
    errors, info = verify.verify(path, **checks)
    if errors:
        raise SystemExit(f"{name}: {errors}")
    thumbs.render_thumb([o for o in sockets.tree(root) if o.type == "MESH"], os.path.join(out, "thumbs", f"{name}.png"),
                        size=192)
    print(f"PART {name} {info['tris']} tris {info['materials']} {info['clips']}")


# ------------------------------------------------------------------------------------------------------- chassis
scene.reset()
team = bake.flat_material("team_paint", (0.92, 0.92, 0.9), rough=0.6)
hull = mesh("chassis", box(1.1, 1.6, 0.36, (0, 0, 0.42), bev=0.05), [])
deck = mesh("deck", box(0.8, 1.0, 0.06, (0, 0.05, 0.63)), [team], parent=hull)
bake.bake_procedural([hull], grime, name="chassis_metal", res=128, samples=4)
for side, x in (("L", 0.62), ("R", -0.62)):
    for i, y in ((1, -0.5), (2, 0.5)):
        sockets.socket(f"wheel_{side}{i}", hull, (x, y, 0.28), r=0.28 if i == 1 else 0.24)
    sockets.socket(f"lamp_{side}", hull, (x * 0.6, -0.82, 0.5), color="#ffd890")
sockets.socket("turret", hull, (0, 0.1, 0.66))
finish("chassis", hull, dict(nodes=("chassis", "deck", "S_turret", "S_wheel_L1", "S_lamp_R"), materials=("team_paint",),
                              extras=("S_wheel_L1:r", "S_lamp_L:color"), max_tris=600))

# --------------------------------------------------------------------------------------------------------- wheel
scene.reset()
rubber = bake.textured_material("rubber", texgen.to_image("rubber_tex", texgen.noise_ramp(
    [(0, "#151515"), (0.6, "#2a2826"), (1, "#3c3a36")], seed=4, size=32)))
hubm = bake.flat_material("hub", (0.75, 0.62, 0.3), rough=0.4, metal=0.8)
wheel = mesh("wheel", cyl(0.2, 0.16, "X", segs=14), [rubber])
mesh("hub", cyl(0.09, 0.18, "X", segs=8), [hubm], parent=wheel)
wheel["r"] = 0.2
bake.unwrap([wheel])
finish("wheel", wheel, dict(nodes=("wheel", "hub"), extras=("wheel:r",), max_tris=200))

# -------------------------------------------------------------------------------------------- turret (animated)
scene.reset()
team = bake.flat_material("team_paint", (0.92, 0.92, 0.9), rough=0.6)
steel = bake.textured_material("steel", texgen.to_image("steel_tex", texgen.noise_ramp(
    [(0, "#3a3d42"), (0.5, "#5b6068"), (1, "#7d828a")], seed=8, size=32, specks=30, speck_colors=("#2a1a10",))))
turret = mesh("turret", cyl(0.32, 0.26, "Z", at=(0, 0, 0.13), segs=12, r2=0.24), [steel])
mesh("stripe", cyl(0.325, 0.07, "Z", at=(0, 0, 0.1), segs=12), [team], parent=turret)
bake.unwrap([turret])
sockets.socket("barrel", turret, (0, -0.22, 0.15))
turret.rotation_mode = "XYZ"
ad = turret.animation_data_create()


def clip(name, keys, path, index):
    act = bpy.data.actions.new(name)
    ad.action = act
    for f, v in keys:
        vec = list(getattr(turret, path))
        vec[index] = v
        setattr(turret, path, vec)
        turret.keyframe_insert(path, index=index, frame=f)
    tr = ad.nla_tracks.new()
    tr.name = name
    tr.strips.new(name, 1, act)
    ad.action = None
    turret.rotation_euler = (0, 0, 0)
    turret.location = (0, 0, 0)


clip("idle", [(1, 0), (30, math.radians(35)), (90, math.radians(-35)), (120, 0)], "rotation_euler", 2)
clip("fire", [(1, 0), (3, 0.09), (12, 0)], "location", 1)
path = os.path.join(out, "turret.glb")
export.export_glb(sockets.tree(turret), path, animations=True)
errors, info = verify.verify(path, nodes=("turret", "S_barrel"), materials=("team_paint",), clips=("idle", "fire"))
if errors:
    raise SystemExit(f"turret: {errors}")
ad.action = None
for t in ad.nla_tracks:
    t.mute = True
thumbs.render_thumb([turret, *[c for c in turret.children if c.type == "MESH"]], os.path.join(out, "thumbs", "turret.png"),
                    size=192)
print(f"PART turret {info['tris']} tris {info['materials']} {info['clips']}")

# -------------------------------------------------------------------------------------------------------- barrel
scene.reset()
gun = bake.flat_material("gunmetal", (0.12, 0.12, 0.13), rough=0.35, metal=0.9)
glow = bake.flat_material("muzzle", (1, 0.7, 0.3), emission=(1, 0.6, 0.2, 3.0))
barrel = mesh("barrel", cyl(0.06, 0.55, "Y", at=(0, -0.27, 0), segs=10), [gun])
mesh("muzzle", cyl(0.075, 0.05, "Y", at=(0, -0.55, 0), segs=10), [glow], parent=barrel)
finish("barrel", barrel, dict(nodes=("barrel", "muzzle"), max_tris=200))
