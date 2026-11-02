"""Thumbnails of exported files (render what ships, not the build scene: the pictures then prove the files and
sockets). import_glb() loads a GLB into a fresh scene; render_thumb() frames the objects' bounding box from a
three-quarter view and renders with Workbench (fast, no compute) or Cycles on the CPU, transparent background.
Assemble many thumbnails into a labelled contact sheet with python/sheets.py contact (system Python + Pillow)."""

import math

import bpy
from mathutils import Vector

from . import scene as kscene


def import_glb(path):
    """Imports a GLB into the current scene; returns the new objects."""
    before = set(bpy.context.scene.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    return [o for o in bpy.context.scene.objects if o not in before]


def bounds(objs):
    lo = Vector((1e9, 1e9, 1e9))
    hi = Vector((-1e9, -1e9, -1e9))
    bpy.context.view_layer.update()
    for o in objs:
        if o.type != "MESH":
            continue
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c)
            lo = Vector(map(min, lo, w))
            hi = Vector(map(max, hi, w))
    return lo, hi


def render_thumb(objs, path, size=256, engine="WORKBENCH", yaw=35.0, pitch=25.0, samples=16, margin=1.15):
    sc = bpy.context.scene
    if engine == "CYCLES":
        kscene.cycles_cpu(sc, samples)
        if not any(o.type == "LIGHT" for o in sc.objects):
            sun = bpy.data.lights.new("thumb_key", "SUN")
            sun.energy = 3.0
            so = bpy.data.objects.new("thumb_key", sun)
            so.rotation_euler = (math.radians(50), 0, math.radians(-145))
            sc.collection.objects.link(so)
        if sc.world is None:
            sc.world = bpy.data.worlds.new("thumb_world")
        sc.world.use_nodes = True
        bg = next(n for n in sc.world.node_tree.nodes if n.type == "BACKGROUND")
        bg.inputs["Strength"].default_value = 0.8
    else:
        kscene.workbench(sc)
    sc.render.resolution_x = sc.render.resolution_y = size
    sc.render.film_transparent = True
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_mode = "RGBA"
    lo, hi = bounds(objs)
    c = (lo + hi) / 2
    r = max((hi - lo).length / 2, 1e-3) * margin
    cam_data = bpy.data.cameras.new("thumb_cam")
    cam_data.lens_unit = "FOV"
    cam_data.angle = math.radians(30)
    cam = bpy.data.objects.new("thumb_cam", cam_data)
    sc.collection.objects.link(cam)
    d = r / math.sin(cam_data.angle / 2)
    yw, pt = math.radians(yaw), math.radians(pitch)
    cam.location = c + Vector((math.sin(yw) * math.cos(pt), -math.cos(yw) * math.cos(pt), math.sin(pt))) * d
    cam.rotation_euler = (c - cam.location).to_track_quat("-Z", "Y").to_euler()
    cam_data.clip_end = d * 4
    sc.camera = cam
    hidden = [o for o in sc.objects if o.type == "MESH" and o not in objs and not o.hide_render]
    for o in hidden:
        o.hide_render = True
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    for o in hidden:
        o.hide_render = False
    bpy.data.objects.remove(cam, do_unlink=True)
    return path
