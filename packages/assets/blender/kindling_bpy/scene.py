"""Scene setup for headless asset scripts. Cycles is always forced onto the CPU: GPU compute on the machine driving
the desktop once hung the whole session (see docs/LESSONS.md, Rendering)."""

import os
import sys

import bpy


def script_args():
    """Arguments after `--` on the Blender command line."""
    return sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def reset():
    """Empty factory scene (no default cube, camera or light)."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    return bpy.context.scene


def cycles_cpu(scene=None, samples=16, threads=None):
    """Cycles on the CPU with a fixed thread count (env KINDLING_THREADS, default 4). Never touches GPU devices."""
    scene = scene or bpy.context.scene
    try:
        scene.render.engine = "CYCLES"
    except TypeError as e:
        raise RuntimeError(f"Cycles unavailable: {e}")
    prefs = bpy.context.preferences.addons.get("cycles")
    if prefs:
        prefs.preferences.compute_device_type = "NONE"
    scene.cycles.device = "CPU"
    scene.cycles.samples = samples
    try:
        scene.cycles.denoising_use_gpu = False
    except AttributeError:
        pass
    scene.render.threads_mode = "FIXED"
    scene.render.threads = threads or int(os.environ.get("KINDLING_THREADS", "4"))
    return scene


def workbench(scene=None, color="TEXTURE", light="STUDIO"):
    """Workbench (rasteriser, no compute) for quick thumbnails and previews."""
    scene = scene or bpy.context.scene
    # The engine enum under-reports in background mode: try the names, the TypeError lists the valid ones.
    for e in ("BLENDER_WORKBENCH", "WORKBENCH"):
        try:
            scene.render.engine = e
            break
        except TypeError as err:
            last = err
    else:
        raise RuntimeError(f"Workbench unavailable: {last}")
    scene.display.shading.light = light
    scene.display.shading.color_type = color
    return scene


def link(obj, scene=None):
    (scene or bpy.context.scene).collection.objects.link(obj)
    return obj


def select_only(objs, active=None):
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = active or (objs[0] if objs else None)


def tri_count(objs):
    return sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in objs if o.type == "MESH")
