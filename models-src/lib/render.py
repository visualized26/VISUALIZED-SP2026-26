"""Catalog preview renders (3/4 view, transparent background)."""
import math
import os
import bpy
from mathutils import Vector
from .builders import g2b


def _world():
    sc = bpy.context.scene
    w = bpy.data.worlds.new("studio")
    sc.world = w
    w.use_nodes = True
    nt = w.node_tree
    bg = nt.nodes.get("Background")
    hdr_dir = bpy.utils.system_resource("DATAFILES", path="studiolights/world")
    hdr = None
    for cand in ("studio.exr", "city.exr", "interior.exr", "forest.exr"):
        p = os.path.join(hdr_dir or "", cand)
        if os.path.exists(p):
            hdr = p
            break
    if hdr:
        env = nt.nodes.new("ShaderNodeTexEnvironment")
        env.image = bpy.data.images.load(hdr)
        nt.links.new(env.outputs["Color"], bg.inputs["Color"])
        bg.inputs["Strength"].default_value = 0.35
    else:
        bg.inputs["Color"].default_value = (0.8, 0.8, 0.82, 1)


def _area(name, loc, target, size, energy, color=(1, 1, 1)):
    ld = bpy.data.lights.new(name, "AREA")
    ld.size = size
    ld.energy = energy
    ld.color = color
    o = bpy.data.objects.new(name, ld)
    bpy.context.scene.collection.objects.link(o)
    o.location = loc
    d = (target - loc).normalized()
    o.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    return o


def _camera(loc, target, lens=85):
    cd = bpy.data.cameras.new("cam")
    cd.lens = lens
    cd.clip_start = 0.01
    o = bpy.data.objects.new("cam", cd)
    bpy.context.scene.collection.objects.link(o)
    o.location = loc
    o.rotation_euler = (target - loc).normalized().to_track_quat("-Z", "Y").to_euler()
    bpy.context.scene.camera = o
    return o


def _preview_lenses():
    """Transmission against a transparent background refracts the HDRI and reads as
    a brown sunglass lens. For catalog shots, swap lenses to a thin glossy alpha
    material (runs after export, so the GLB keeps the physical lens)."""
    m = bpy.data.materials.get("lens")
    if not m:
        return
    b = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    col = b.inputs["Base Color"].default_value
    bright = (col[0] + col[1] + col[2]) / 3
    b.inputs["Transmission Weight"].default_value = 0.0
    b.inputs["Roughness"].default_value = 0.03
    b.inputs["Alpha"].default_value = 0.08 if bright > 0.5 else 0.82
    try:
        m.surface_render_method = "BLENDED"
    except Exception:
        pass


def preview(path, samples=64, res=(900, 600), view="three_quarter"):
    sc = bpy.context.scene
    try:
        sc.render.engine = "BLENDER_EEVEE"
        if hasattr(sc.eevee, "use_raytracing"):
            sc.eevee.use_raytracing = True
        sc.eevee.taa_render_samples = samples
    except TypeError:
        sc.render.engine = "CYCLES"
        sc.cycles.samples = samples
    sc.render.film_transparent = True
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_mode = "RGBA"
    try:
        sc.view_settings.view_transform = "AgX"
        sc.view_settings.look = "AgX - Medium High Contrast"
    except Exception:
        pass
    _world()
    _preview_lenses()
    target = g2b(0, -2, -18)
    if view == "front":
        cam = g2b(0, 4, 560)
    else:
        cam = g2b(210, 70, 440)
    _camera(cam, target, lens=85)
    _area("key", g2b(200, 220, 300), target, 0.35, 2.2)
    _area("fill", g2b(-260, 40, 200), target, 0.5, 0.8)
    _area("rim", g2b(0, 140, -280), target, 0.3, 1.6)
    _area("top", g2b(0, 320, 0), target, 0.6, 1.0)
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
