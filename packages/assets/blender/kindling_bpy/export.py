"""GLB export settings that worked for Grudge and RUST RING: selection only, Y-up, extras on (socket props), no
cameras / lights, transforms not applied (sockets keep their place). Static parts embed JPEG textures (small);
rigs export NLA tracks as clips with skins and only deforming bones."""

import os

import bpy

from . import scene as kscene


def export_glb(objs, path, animations=False, image_format="AUTO", jpeg_quality=88, vertex_colors=False):
    """Writes `objs` (include every descendant you want: sockets.tree(root)) to a GLB. Returns its size in bytes."""
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    kscene.select_only(objs)
    kw = dict(
        filepath=path,
        export_format="GLB",
        use_selection=True,
        export_yup=True,
        export_apply=False,
        export_extras=True,
        export_cameras=False,
        export_lights=False,
        export_animations=animations,
        export_image_format=image_format,
        export_materials="EXPORT",
    )
    if image_format == "JPEG":
        kw["export_jpeg_quality"] = jpeg_quality
    if vertex_colors:
        kw["export_vertex_color"] = "ACTIVE"
    if animations:
        kw.update(export_animation_mode="NLA_TRACKS", export_skins=True, export_def_bones=False)
    bpy.ops.export_scene.gltf(**kw)
    return os.path.getsize(path)
