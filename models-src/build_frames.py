"""VISUALIZED frame generator.

Usage (from repo root):
  blender --background --factory-startup --python models-src/build_frames.py -- [options]

Options:
  --only id1,id2     build only these frame ids
  --no-render        skip preview renders
  --no-draco         export without Draco compression
  --samples N        render samples (default 64)
"""
import json
import math
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
sys.path.append(os.path.join(HERE, ".pydeps"))  # shapely (after Blender's numpy)

import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402

from lib import shapes, builders as B, materials as M, render, parts, metal  # noqa: E402

OUT_GLB = os.path.join(ROOT, "public", "models", "frames")
OUT_PNG = os.path.join(ROOT, "public", "models", "previews")
TEX_DIR = os.path.join(ROOT, "public", "models", "textures")


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    opts = {"only": None, "render": True, "draco": True, "samples": 64}
    i = 0
    while i < len(argv):
        a = argv[i]
        if a == "--only":
            opts["only"] = set(argv[i + 1].split(","))
            i += 1
        elif a == "--no-render":
            opts["render"] = False
        elif a == "--no-draco":
            opts["draco"] = False
        elif a == "--samples":
            opts["samples"] = int(argv[i + 1])
            i += 1
        i += 1
    return opts


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.unit_settings.system = "METRIC"


def merged(defaults, cfg):
    out = json.loads(json.dumps(defaults))
    for k, v in cfg.items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k].update(v)
        else:
            out[k] = v
    return out


# ------------------------------------------------------------------ acetate frames
def build_acetate(cfg, lib):
    d, f, t = cfg["dims"], cfg.get("front", {}), cfg.get("temple", {})
    front_poly, lens_L, lens_R, info = shapes.acetate_front(cfg)
    depth = f.get("depth", 5.0)
    cx = info["centre_x"]
    wrap_deg = cfg.get("angles", {}).get("wrap", 5)
    wrap = B.Wrap(cx / math.tan(math.radians(wrap_deg)) if wrap_deg else 0)

    rings = []
    for ext, holes in shapes.polygon_rings(front_poly):
        rings.append((shapes.resample(ext, 640), [shapes.resample(h, 260) for h in holes]))
    front = B.extrude_rings("Front_body", rings, depth, f.get("edge_round", 1.4), wrap)
    B.assign_material(front, lib.finish("frame", cfg["finish"]))

    metal = lib.metal(cfg.get("metal", "silver"))
    hx, hy = info["hinge_x"], info["hinge_y"]
    extras = []
    for s in (1, -1):
        x = s * (hx - 2.6)
        bar = B.cylinder("hinge", (x, hy, wrap.dz(x) - 1.2), 1.25, 6.5, axis="y")
        B.assign_material(bar, metal)
        extras.append(bar)
        if f.get("rivets", True):
            for k, dy in enumerate(f.get("rivet_dy", [1.6, -1.6])):
                rx = s * (hx - 5.0 - k * 0.0)
                rv = B.cylinder("rivet", (rx - s * 0.0, hy + dy + f.get("rivet_y", 0.0),
                                          depth + wrap.dz(rx) + 0.05), 0.75, 0.5, axis="z")
                B.assign_material(rv, metal)
                extras.append(rv)
    front = B.join([front] + extras, "Front")

    # lenses (sit in the rim groove)
    lens_mat = lib.lens(cfg.get("lens", "clear"))
    lens_objs = []
    for name, lp in (("Lens_L", lens_L), ("Lens_R", lens_R)):
        pts = list(lp.buffer(0.55, quad_segs=12).exterior.coords)[:-1]
        pts = shapes.resample(pts, 192)
        c = ((lp.bounds[0] + lp.bounds[2]) / 2, (lp.bounds[1] + lp.bounds[3]) / 2)
        lo = B.lens_mesh(name, pts, c, depth * 0.5, cfg.get("lens_base_r", 130.0),
                         cfg.get("lens_thickness", 1.8), wrap)
        B.assign_material(lo, lens_mat)
        lens_objs.append(lo)

    temples = parts.acetate_temples(cfg, lib, hx, hy, wrap.dz(hx) - 0.6, info["endpiece_height"])

    anchor = (0.0, info["bridge_bottom"], wrap.dz(0) - 1.0)
    return dict(front=front, lenses=lens_objs, temples=temples, pads=None,
                info=info, anchor=anchor)


# ------------------------------------------------------------------ assembly / export
def assemble(cfg, parts):
    root = bpy.data.objects.new("Frame", None)
    B.link(root)
    anc = bpy.data.objects.new("Anchor_Bridge", None)
    B.link(anc)
    anc.location = B.g2b(*parts["anchor"])
    objs = [parts["front"]] + parts["lenses"] + parts["temples"] + ([parts["pads"]] if parts["pads"] else []) + [anc]
    for o in objs:
        o.parent = root
    return root, objs


def catalog_entry(cfg, parts, tris):
    d, info = cfg["dims"], parts["info"]
    return {
        "id": cfg["id"], "model_id": cfg["model_id"], "name": cfg["name"], "style": cfg["style"],
        "construction": cfg["construction"], "size": cfg.get("size", "M"),
        "finish": cfg["finish"], "finish_name": cfg.get("finish_name", cfg["finish"]),
        "lens": cfg.get("lens", "clear"),
        "finishes": cfg.get("finishes", [cfg["finish"]]),
        "dims_mm": {
            "lens_width": d["lens_width"], "lens_height": d["lens_height"],
            "bridge": d["bridge"], "temple_length": d["temple_length"],
            "total_width": round(info["total_width"], 1),
            "frame_pd": d["lens_width"] + d["bridge"],
        },
        "angles_deg": cfg["angles"],
        "face_shapes": cfg.get("face_shapes", []),
        "triangles": tris,
        "model": f"models/frames/{cfg['id']}.glb",
        "preview": f"models/previews/{cfg['model_id']}.png",
    }


def export_glb(cfg, root, objs, draco):
    bpy.ops.object.select_all(action="DESELECT")
    root.select_set(True)
    for o in objs:
        o.select_set(True)
    path = os.path.join(OUT_GLB, cfg["id"] + ".glb")
    kw = dict(filepath=path, export_format="GLB", use_selection=True, export_apply=True,
              export_yup=True, export_extras=True, export_cameras=False, export_lights=False,
              export_image_format="JPEG")
    if draco:
        kw.update(export_draco_mesh_compression_enable=True,
                  export_draco_mesh_compression_level=6,
                  export_draco_position_quantization=16,
                  export_draco_normal_quantization=12)
    bpy.ops.export_scene.gltf(**kw)
    return path


def expand(spec):
    """Expand each model into its size variants (S/M/L) -> list of build configs."""
    defaults = spec.get("defaults", {})
    deltas = spec.get("size_deltas", {"M": {}})
    out = []
    for raw in spec["frames"]:
        base = merged(defaults, raw)
        for size in base.get("sizes", ["M"]):
            cfg = json.loads(json.dumps(base))
            dl = deltas.get(size, {})
            d = cfg["dims"]
            lw0 = d["lens_width"]
            for k, v in dl.items():
                d[k] = d[k] + v
            d["lens_height"] = round(d["lens_height"] * d["lens_width"] / lw0, 1)
            cfg["size"] = size
            cfg["model_id"] = raw["id"]
            cfg["id"] = f"{raw['id']}-{size.lower()}"
            out.append(cfg)
    return out


def write_finishes():
    data = {"finishes": {}, "lenses": M.LENSES}
    for k, f in M.FINISHES.items():
        e = dict(f)
        if f["kind"] == "tortoise":
            e["texture"] = f"models/textures/tex_{k}.jpg"
        data["finishes"][k] = e
    json.dump(data, open(os.path.join(ROOT, "public", "models", "finishes.json"), "w",
                         encoding="utf-8"), indent=2)


def main():
    opts = parse_args()
    spec = json.load(open(os.path.join(HERE, "frames.json"), encoding="utf-8"))
    os.makedirs(OUT_GLB, exist_ok=True)
    os.makedirs(OUT_PNG, exist_ok=True)
    cat_path = os.path.join(OUT_GLB, "catalog.json")
    catalog = {}
    if os.path.exists(cat_path):
        for e in json.load(open(cat_path, encoding="utf-8")).get("frames", []):
            catalog[e["id"]] = e
    cfgs = expand(spec)
    ids = [c["id"] for c in cfgs]
    for cfg in cfgs:
        if opts["only"] and cfg["id"] not in opts["only"] and cfg["model_id"] not in opts["only"]:
            continue
        t0 = time.time()
        reset_scene()
        lib = M.Library(TEX_DIR)
        if cfg["construction"] == "acetate":
            built = build_acetate(cfg, lib)
        else:
            built = metal.build_metal(cfg, lib)
        root, objs = assemble(cfg, built)
        root["visualized"] = json.dumps({"id": cfg["id"], "dims_mm": cfg["dims"]})
        tris = sum(B.tri_count(o) for o in objs if o.type == "MESH")
        path = export_glb(cfg, root, objs, opts["draco"])
        if opts["render"] and (cfg["size"] == "M" or opts.get("all_previews")):
            render.preview(os.path.join(OUT_PNG, cfg["model_id"] + ".png"), opts["samples"])
        entry = catalog_entry(cfg, built, tris)
        entry["bytes"] = os.path.getsize(path)
        catalog[cfg["id"]] = entry
        print(f"[frame] {cfg['id']}: {tris} tris, {entry['bytes'] // 1024} KB, "
              f"{time.time() - t0:.1f}s")
    frames = [catalog[i] for i in ids if i in catalog]
    json.dump({"version": 1, "frames": frames}, open(cat_path, "w", encoding="utf-8"), indent=2)
    write_finishes()
    print(f"[catalog] {len(frames)} frames -> {cat_path}")


if __name__ == "__main__":
    main()
