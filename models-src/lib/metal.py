"""Metal (wire) and combo (browline) frame builder."""
import math
from shapely.geometry import Polygon, Point, box
from shapely.ops import unary_union, nearest_points

from . import shapes, builders as B, parts


def _rim_point(ring_poly, x, y):
    p = nearest_points(ring_poly.exterior, Point(x, y))[0]
    return p.x, p.y


def _arch(p0, p1, rise, forward, wrap, n=24):
    """parabolic arch between two g-space (x, y, z) points."""
    pts = []
    for i in range(n + 1):
        t = i / n
        x = p0[0] + (p1[0] - p0[0]) * t
        y = p0[1] + (p1[1] - p0[1]) * t + rise * 4 * t * (1 - t)
        z = p0[2] + (p1[2] - p0[2]) * t + forward * 4 * t * (1 - t)
        pts.append((x, y, z))
    return pts


def build_metal(cfg, lib):
    d, f = cfg["dims"], cfg.get("front", {})
    left, right, cx = shapes.placed_lenses(cfg)
    lens_L, lens_R = Polygon(left), Polygon(right)
    hh = d["lens_height"] / 2.0
    wrap_deg = cfg.get("angles", {}).get("wrap", 4)
    wrap = B.Wrap(cx / math.tan(math.radians(wrap_deg)) if wrap_deg else 0)
    combo = cfg["construction"] == "combo"

    wire_r = f.get("wire", 0.8)
    wire_depth = f.get("wire_depth", 2.1)
    z_mid = f.get("z_mid", 1.4)
    frame_mat = lib.finish("frame", cfg["finish"])
    rim_finish = cfg.get("rim_finish", cfg["finish"] if not combo else cfg.get("metal", "silver"))
    rim_mat = frame_mat if not combo else lib.finish("metal", rim_finish)
    metal = lib.metal(cfg.get("metal", "silver")) if not combo else rim_mat

    def g(x, y, dz=0.0):
        return (x, y, z_mid + dz + wrap.dz(x))

    front_parts = []
    rim_rings = {}
    # ---- eye wires
    for s, lp in ((1, lens_L), (-1, lens_R)):
        ring = lp.buffer(wire_r * 0.55, quad_segs=16)
        rim_rings[s] = ring
        pts2 = shapes.resample(list(ring.exterior.coords)[:-1], 220)
        path = [g(x, y) for x, y in pts2]
        o = B.sweep("rim", path, lambda sv, L: wire_depth, lambda sv, L: wire_r * 2,
                    (0, 0, 1), segs=12, closed=True, exp_fn=lambda sv, L: 2.6)
        B.assign_material(o, rim_mat)
        front_parts.append(o)

    inner_x = d["bridge"] / 2.0
    # ---- bridges
    bridge_type = f.get("bridge_type", "arch")
    bridges = []
    if bridge_type in ("double", "arch"):
        yb = hh * f.get("bridge_y", 0.3)
        a = _rim_point(rim_rings[1], inner_x, yb)
        b = (-a[0], a[1])
        bridges.append(_arch(g(*a), g(*b), f.get("bridge_rise", 3.5), 0.8, wrap))
    if bridge_type == "double" or f.get("top_bar", False):
        yt = hh * f.get("top_bar_y", 0.82)
        a = _rim_point(rim_rings[1], inner_x + 6, yt + 6)
        b = (-a[0], a[1])
        bridges.append(_arch(g(*a), g(*b), 1.0, 0.6, wrap))
    for i, bp in enumerate(bridges):
        o = B.tube(f"bridge{i}", bp, wire_r * (1.0 if i == 0 else 0.85), segs=12)
        B.assign_material(o, frame_mat if not combo else rim_mat)
        front_parts.append(o)

    # ---- combo brow (acetate) / metal end pieces
    hinges = {}
    if combo:
        brow_rim = f.get("brow", 6.0)
        y_cut = hh * f.get("brow_cut", 0.05)
        pieces = []
        for lp in (lens_L, lens_R):
            pieces.append(lp.buffer(brow_rim, quad_segs=24).intersection(box(-500, y_cut, 500, 500)))
        xs_out = max(x for x, _ in left)
        y_h = hh * 0.5
        for s in (1, -1):
            x0 = xs_out + brow_rim * 0.3
            pieces.append(box(min(s * x0, s * (x0 + 3.5)), y_h - 4, max(s * x0, s * (x0 + 3.5)), y_h + 4))
        brow = shapes.smooth(unary_union(pieces), 1.4).difference(unary_union([lens_L, lens_R]))
        rings = []
        for ext, holes in shapes.polygon_rings(brow):
            rings.append((shapes.resample(ext, 420), [shapes.resample(h, 200) for h in holes]))
        bo = B.extrude_rings("brow", rings, f.get("depth", 4.6), 1.3, wrap, z_back=-0.2)
        B.assign_material(bo, frame_mat)
        front_parts.append(bo)
        hx = brow.bounds[2]
        for s in (1, -1):
            x = s * (hx - 2.6)
            bar = B.cylinder("hinge", (x, y_h, wrap.dz(x) - 1.0), 1.2, 6.0)
            B.assign_material(bar, metal)
            front_parts.append(bar)
            for dy in (1.4, -1.4):
                rx = s * (hx - 5.0)
                rv = B.cylinder("rivet", (rx, y_h + dy + 1.5, 4.4 + wrap.dz(rx)), 0.7, 0.5, axis="z")
                B.assign_material(rv, metal)
                front_parts.append(rv)
        temples = parts.acetate_temples(cfg, lib, hx, y_h, wrap.dz(hx) - 0.6, 8.0)
        total_width = hx * 2
        hinge_y = y_h
    else:
        y_e = hh * f.get("endpiece_y", 0.45)
        ep_mat = frame_mat
        for s, lp in ((1, lens_L), (-1, lens_R)):
            ox, oy = _rim_point(rim_rings[s], s * 200, y_e)
            p0 = g(ox, oy)
            p1 = (p0[0] + s * 2.2, p0[1], p0[2] - 0.3)
            p2 = (p0[0] + s * 3.6, p0[1], p0[2] - 2.0)
            p3 = (p0[0] + s * 3.9, p0[1], p0[2] - 4.6)
            path = []
            for i in range(13):
                t = i / 12
                # quadratic-ish bezier through p1/p2
                a = [(1 - t) ** 3 * p0[k] + 3 * (1 - t) ** 2 * t * p1[k] + 3 * (1 - t) * t * t * p2[k] + t ** 3 * p3[k] for k in range(3)]
                path.append(tuple(a))
            o = B.sweep("endpiece", path, lambda sv, L: 2.8, lambda sv, L: 1.6, (0, 1, 0),
                        segs=14, exp_fn=lambda sv, L: 2.4, round_end=False)
            # sweep orients width along "outward"; for a horizontal path use vertical ref
            B.assign_material(o, ep_mat)
            front_parts.append(o)
            hb = B.cylinder("hinge", (p3[0], p3[1], p3[2] + 0.4), 1.05, 4.2)
            B.assign_material(hb, metal)
            front_parts.append(hb)
            hinges[s] = (p3[0] + s * 0.3, p3[1], p3[2] - 0.6)
        temples = parts.wire_temples(cfg, lib, hinges)
        total_width = abs(hinges[1][0]) * 2 + 1.0
        hinge_y = y_e

    # ---- nose pads (on pad arms)
    pads = []
    if f.get("pads", True):
        pad_mat = lib.pad()
        for s in (1, -1):
            ax, ay = _rim_point(rim_rings[s], s * (inner_x - 2), -hh * 0.05)
            p0 = g(ax, ay)
            arm = _arch(p0, (s * (inner_x - 1.8), ay - 4.0, p0[2] - 6.5), 0.0, -1.5, wrap, n=14)
            ao = B.tube("padarm", arm, 0.42, segs=10)
            B.assign_material(ao, metal)
            front_parts.append(ao)
            end = arm[-1]
            po = B.ellipsoid("pad", (end[0] - s * 1.0, end[1] - 1.5, end[2] - 0.5),
                             (1.0, 5.2, 3.0), rot_deg=(8, s * 28, s * 12))
            B.assign_material(po, pad_mat)
            pads.append(po)
    front = B.join(front_parts, "Front")
    pad_obj = B.join(pads, "NosePads") if pads else None

    # ---- lenses
    lens_mat = lib.lens(cfg.get("lens", "clear"))
    lens_objs = []
    for name, lp in (("Lens_L", lens_L), ("Lens_R", lens_R)):
        pts = shapes.resample(list(lp.buffer(0.3, quad_segs=12).exterior.coords)[:-1], 192)
        c = ((lp.bounds[0] + lp.bounds[2]) / 2, (lp.bounds[1] + lp.bounds[3]) / 2)
        lo = B.lens_mesh(name, pts, c, z_mid, cfg.get("lens_base_r", 120.0),
                         cfg.get("lens_thickness", 1.6), wrap)
        B.assign_material(lo, lens_mat)
        lens_objs.append(lo)

    info = {"centre_x": cx, "total_width": total_width, "hinge_y": hinge_y}
    anchor = (0.0, hh * f.get("bridge_y", 0.3), wrap.dz(0) - 1.0)
    return dict(front=front, lenses=lens_objs, temples=temples, pads=pad_obj,
                info=info, anchor=anchor)
