"""Builds BRAWL's rover parts as GLBs with @kindling/assets' Blender modules, CPU only (never hand-edited; rerun to
reproduce):

    nice -n 10 blender -b --factory-startup -P tools/parts.py -- public/parts      (pnpm parts)

Every rover is a chassis plus parts attached by sockets at runtime (@kindling/three assembleBySockets). Forward is
Blender -Y (glTF +Z). Each `team_paint` material is near-white and dyed per player at runtime (dyeTeam).

- chassis_scout / chassis_brute / chassis_spark: hull (baked procedural grime metal) + team deck; sockets
  S_wheel_{L,R}{1,2} (extra r: wheel radius there), S_turret, S_lamp_{L,R} (extra color), and per type S_front
  (brute: bumper), S_top (spark: coil), S_tail (scout: fin).
- wheel:  tyre + hub, extra r = its own radius.
- turret: team-striped turret with S_barrel; clips "idle" (scan) and "fire" (recoil kick).
- barrel: gun barrel with a `muzzle` node.
- bumper: steel plow with a team stripe (brute).
- coil:   antenna coil with a glowing tip and S_spark (spark).
- fin:    tail fin in team paint (scout).
Thumbnails go to <out>/thumbs/<part>.png (Workbench).
"""

import math
import os
import sys

import bmesh
import bpy

KINDLING = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "packages", "assets", "blender")
sys.path.insert(0, os.path.abspath(KINDLING))
from kindling_bpy import bake, export, scene, sockets, texgen, thumbs, verify  # noqa: E402

out = os.path.abspath((scene.script_args() or ["public/parts"])[0])
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


def box(sx, sy, sz, at=(0, 0, 0), bev=0.0, taper=None):
    def b(bm):
        bmesh.ops.create_cube(bm, size=1.0)
        if taper:
            for v in bm.verts:
                if v.co.y < 0:
                    v.co.x *= taper
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


def sphere(r, at=(0, 0, 0), segs=10):
    def b(bm):
        bmesh.ops.create_uvsphere(bm, u_segments=segs, v_segments=max(4, segs // 2), radius=r)
        bmesh.ops.translate(bm, verts=bm.verts, vec=at)

    return b


def grime(tint):
    lo = tuple(c * 0.45 for c in tint)
    def build(g):
        p = g.coords("Object")
        n = g.noise(p, 5.0, 4.0)
        fine = g.noise(p, 30.0, 2.0)
        base = g.mix(lo, tint, g.smooth(n, 0.3, 0.7))
        base = g.mix(base, (0.75, 0.72, 0.66), g.mul(g.edges(0.02, 10.0), 0.85))
        return g.mix(base, (0.3, 0.14, 0.06), g.mul(g.smooth(fine, 0.64, 0.76), 0.5))

    return build


def finish(name, root, checks, animations=False):
    path = os.path.join(out, f"{name}.glb")
    export.export_glb(sockets.tree(root), path, animations=animations)
    errors, info = verify.verify(path, **checks)
    if errors:
        raise SystemExit(f"{name}: {errors}")
    if animations:
        ad = root.animation_data
        ad.action = None
        for t in ad.nla_tracks:
            t.mute = True
    meshes = [o for o in sockets.tree(root) if o.type == "MESH"]
    thumbs.render_thumb(meshes, os.path.join(out, "thumbs", f"{name}.png"), size=192)
    print(f"PART {name} {info['tris']} tris {info['materials']} {info['clips']}")


def wheel_sockets(hull, half_w, ys, r, z):
    for side, x in (("L", half_w), ("R", -half_w)):
        for i, y in enumerate(ys, 1):
            sockets.socket(f"wheel_{side}{i}", hull, (x, y, z), r=r)


def lamps(hull, x, y, z, color="#ffd890"):
    for side, sx in (("L", x), ("R", -x)):
        sockets.socket(f"lamp_{side}", hull, (sx, y, z), color=color)


CHASSIS_CHECKS = dict(materials=("team_paint",), extras=("S_wheel_L1:r", "S_lamp_L:color"), max_tris=800)

# ----------------------------------------------------------------------------------------------------- chassis
# scout: narrow wedge, small wheels, a tail fin
scene.reset()
team = bake.flat_material("team_paint", (0.92, 0.92, 0.9), rough=0.55)
hull = mesh("chassis_scout", box(0.82, 1.55, 0.28, (0, 0, 0.36), bev=0.05, taper=0.62), [])
mesh("deck", box(0.5, 0.9, 0.05, (0, 0.1, 0.52), taper=0.7), [team], parent=hull)
bake.bake_procedural([hull], grime((0.52, 0.55, 0.6)), name="scout_metal", res=128, samples=4)
wheel_sockets(hull, 0.5, (-0.5, 0.52), 0.22, 0.24)
lamps(hull, 0.18, -0.8, 0.42, "#bfe8ff")
sockets.socket("turret", hull, (0, 0.18, 0.55))
sockets.socket("tail", hull, (0, 0.72, 0.52))
finish("chassis_scout", hull, dict(nodes=("chassis_scout", "deck", "S_turret", "S_tail", "S_wheel_R2"), **CHASSIS_CHECKS))

# brute: wide heavy box with a front socket for the bumper
scene.reset()
team = bake.flat_material("team_paint", (0.92, 0.92, 0.9), rough=0.55)
hull = mesh("chassis_brute", box(1.25, 1.5, 0.44, (0, 0, 0.5), bev=0.07), [])
mesh("deck", box(0.95, 0.95, 0.06, (0, 0.12, 0.74)), [team], parent=hull)
mesh("skirt", box(1.32, 0.9, 0.12, (0, 0.05, 0.3)), [team], parent=hull)
bake.bake_procedural([hull], grime((0.45, 0.42, 0.38)), name="brute_metal", res=128, samples=4)
wheel_sockets(hull, 0.7, (-0.48, 0.48), 0.32, 0.32)
lamps(hull, 0.38, -0.76, 0.6, "#ffcf70")
sockets.socket("turret", hull, (0, 0.2, 0.77))
sockets.socket("front", hull, (0, -0.78, 0.36))
finish("chassis_brute", hull, dict(nodes=("chassis_brute", "deck", "S_front", "S_turret"), **CHASSIS_CHECKS))

# spark: round drum hull with a coil on top
scene.reset()
team = bake.flat_material("team_paint", (0.92, 0.92, 0.9), rough=0.55)
hull = mesh("chassis_spark", cyl(0.66, 0.36, "Z", at=(0, 0, 0.42), segs=18, r2=0.56), [])
mesh("ring", cyl(0.68, 0.09, "Z", at=(0, 0, 0.36), segs=18), [team], parent=hull)
bake.bake_procedural([hull], grime((0.4, 0.46, 0.52)), name="spark_metal", res=128, samples=4)
wheel_sockets(hull, 0.62, (-0.36, 0.36), 0.26, 0.26)
lamps(hull, 0.24, -0.6, 0.5, "#a8ffcf")
sockets.socket("turret", hull, (0, -0.12, 0.6))
sockets.socket("top", hull, (0, 0.3, 0.6))
finish("chassis_spark", hull, dict(nodes=("chassis_spark", "ring", "S_top", "S_turret"), **CHASSIS_CHECKS))

# --------------------------------------------------------------------------------------------------------- wheel
scene.reset()
rubber = bake.textured_material(
    "rubber",
    texgen.to_image("rubber_tex", texgen.noise_ramp([(0, "#151515"), (0.6, "#2a2826"), (1, "#3c3a36")], seed=4, size=32)),
)
hubm = bake.flat_material("hub", (0.78, 0.64, 0.3), rough=0.4, metal=0.8)
wheel = mesh("wheel", cyl(0.2, 0.16, "X", segs=14), [rubber])
mesh("hub", cyl(0.09, 0.18, "X", segs=8), [hubm], parent=wheel)
wheel["r"] = 0.2
bake.unwrap([wheel])
finish("wheel", wheel, dict(nodes=("wheel", "hub"), extras=("wheel:r",), max_tris=200))

# -------------------------------------------------------------------------------------------- turret (animated)
scene.reset()
team = bake.flat_material("team_paint", (0.92, 0.92, 0.9), rough=0.55)
steel = bake.textured_material(
    "steel",
    texgen.to_image(
        "steel_tex",
        texgen.noise_ramp(
            [(0, "#3a3d42"), (0.5, "#5b6068"), (1, "#7d828a")], seed=8, size=32, specks=30, speck_colors=("#2a1a10",)
        ),
    ),
)
turret = mesh("turret", cyl(0.3, 0.24, "Z", at=(0, 0, 0.12), segs=12, r2=0.22), [steel])
mesh("stripe", cyl(0.305, 0.07, "Z", at=(0, 0, 0.09), segs=12), [team], parent=turret)
bake.unwrap([turret])
sockets.socket("barrel", turret, (0, -0.2, 0.14))
turret.rotation_mode = "XYZ"
ad = turret.animation_data_create()


def clip(obj, name, keys, path, index):
    act = bpy.data.actions.new(name)
    obj.animation_data.action = act
    for f, v in keys:
        vec = list(getattr(obj, path))
        vec[index] = v
        setattr(obj, path, vec)
        obj.keyframe_insert(path, index=index, frame=f)
    tr = obj.animation_data.nla_tracks.new()
    tr.name = name
    tr.strips.new(name, 1, act)
    obj.animation_data.action = None
    obj.rotation_euler = (0, 0, 0)
    obj.location = (0, 0, 0)


clip(turret, "idle", [(1, 0), (40, math.radians(18)), (100, math.radians(-18)), (140, 0)], "rotation_euler", 2)
clip(turret, "fire", [(1, 0), (3, 0.12), (14, 0)], "location", 1)
finish("turret", turret, dict(nodes=("turret", "S_barrel"), materials=("team_paint",), clips=("idle", "fire")), animations=True)

# -------------------------------------------------------------------------------------------------------- barrel
scene.reset()
gun = bake.flat_material("gunmetal", (0.12, 0.12, 0.13), rough=0.35, metal=0.9)
glow = bake.flat_material("muzzle", (1, 0.7, 0.3), emission=(1, 0.6, 0.2, 3.0))
barrel = mesh("barrel", cyl(0.07, 0.5, "Y", at=(0, -0.25, 0), segs=10), [gun])
mesh("muzzle", cyl(0.09, 0.06, "Y", at=(0, -0.5, 0), segs=10), [glow], parent=barrel)
finish("barrel", barrel, dict(nodes=("barrel", "muzzle"), max_tris=200))

# -------------------------------------------------------------------------------------------------------- bumper
scene.reset()
team = bake.flat_material("team_paint", (0.92, 0.92, 0.9), rough=0.55)
plate = bake.flat_material("plate", (0.5, 0.5, 0.52), rough=0.35, metal=0.85)
bumper = mesh("bumper", box(1.45, 0.16, 0.36, (0, -0.06, 0), bev=0.04), [plate])
mesh("bumper_stripe", box(1.2, 0.05, 0.1, (0, -0.15, 0.04)), [team], parent=bumper)
for x in (-0.5, 0.5):
    mesh(f"bolt_{'L' if x < 0 else 'R'}", cyl(0.05, 0.06, "Y", at=(x, -0.16, -0.08), segs=6), [plate], parent=bumper)
finish("bumper", bumper, dict(nodes=("bumper", "bumper_stripe"), materials=("team_paint",), max_tris=300))

# ---------------------------------------------------------------------------------------------------------- coil
scene.reset()
copper = bake.flat_material("copper", (0.78, 0.42, 0.2), rough=0.35, metal=0.9)
tip = bake.flat_material("spark_tip", (0.7, 1, 0.85), emission=(0.5, 1, 0.75, 4.0))
coil = mesh("coil", cyl(0.05, 0.6, "Z", at=(0, 0, 0.3), segs=8), [copper])
for i, z in enumerate((0.15, 0.27, 0.39)):
    mesh(f"winding{i}", cyl(0.12 - i * 0.02, 0.05, "Z", at=(0, 0, z), segs=10), [copper], parent=coil)
mesh("tip", sphere(0.1, (0, 0, 0.66)), [tip], parent=coil)
sockets.socket("spark", coil, (0, 0, 0.66))
finish("coil", coil, dict(nodes=("coil", "tip", "S_spark"), max_tris=400))

# ----------------------------------------------------------------------------------------------------------- fin
scene.reset()
team = bake.flat_material("team_paint", (0.92, 0.92, 0.9), rough=0.55)
fin = mesh("fin", box(0.06, 0.4, 0.34, (0, 0.08, 0.17), taper=0.3), [team])
finish("fin", fin, dict(nodes=("fin",), materials=("team_paint",), max_tris=100))
