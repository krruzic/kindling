"""Socket empties and part roots (RUST RING's part contract). A part file holds one or more named root nodes (the
runtime looks parts up by node name); sockets are empties named S_<name> parented under them, placed and rotated
where a child part's origin goes. Custom properties on any object export as glTF extras, which three.js puts in
userData: a wheel socket's radius, a tread socket's length, a part's own reference size.

Blender is Z-up with the glTF exporter converting to Y-up; author with +Z up and keep parts at their own origin.
"""

import bpy

PREFIX = "S_"


def empty(name, loc=(0, 0, 0), rot=(0, 0, 0), parent=None, display_size=0.12, **props):
    o = bpy.data.objects.new(name, None)
    o.empty_display_type = "ARROWS"
    o.empty_display_size = display_size
    bpy.context.scene.collection.objects.link(o)
    if parent is not None:
        o.parent = parent
    o.location = loc
    o.rotation_euler = rot
    for k, v in props.items():
        o[k] = v
    return o


def socket(name, parent, loc=(0, 0, 0), rot=(0, 0, 0), **props):
    """A socket empty S_<name> under `parent` (location relative to the parent)."""
    return empty(name if name.startswith(PREFIX) else PREFIX + name, loc, rot, parent, **props)


def set_props(obj, **props):
    for k, v in props.items():
        obj[k] = v
    return obj


def sockets_of(root):
    """{name: object} for every socket under root (recursive)."""
    out = {}
    stack = [root]
    while stack:
        o = stack.pop()
        if o.name.startswith(PREFIX):
            out[o.name] = o
        stack.extend(o.children)
    return out


def tree(root):
    """root and every descendant."""
    out, stack = [], [root]
    while stack:
        o = stack.pop()
        out.append(o)
        stack.extend(o.children)
    return out
