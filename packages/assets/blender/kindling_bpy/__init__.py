"""Kindling Blender modules (run inside Blender 5.x, headless: `nice blender -b -P script.py -- args`).

- scene:   factory reset, Cycles forced onto the CPU (never GPU compute), Workbench, script args
- texgen:  pure-Python tileable procedural textures (value noise / fbm / voronoi), retro palette reduction, to images
- bake:    a tiny shader-node DSL and a CPU Cycles emission bake of any procedural graph to an image
- sockets: socket empties with custom props (exported as glTF extras), part roots
- export:  GLB export settings (static parts, animated rigs)
- thumbs:  thumbnail renders (Workbench or Cycles CPU) of exported files, framed automatically
- rig:     transfer an AI-generated mesh onto an existing armature (normalise, weld proxy, auto weights, fill)
- verify:  GLB verifier in plain Python (no Blender needed): node names, materials, triangle budgets, ground contact

Add this folder's parent to sys.path in your script:

    sys.path.insert(0, "<kindling>/packages/assets/blender")
    from kindling_bpy import scene, sockets, export
"""
